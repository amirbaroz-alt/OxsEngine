import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { whatsappService } from "../services/whatsapp.service";
import { whatsappTemplateService } from "../services/whatsapp-template.service";
import { verifyWhatsAppSignature } from "../middleware/webhook-signature.middleware";
import { webhookQueue, isDuplicateMessage, getDedupCacheSize } from "../services/message-queue.service";
import { requireAuth, requireRole, requireTenant, requireTenantDb } from "../middleware/auth.middleware";
import { auditLogService } from "../services/audit-log.service";
import { auditService } from "../services/audit.service";
import { z } from "zod";

const webhookRateLimits = new Map<string, { count: number; resetAt: number }>();
const WEBHOOK_RATE_LIMIT = 100;
const WEBHOOK_RATE_WINDOW = 10_000;
const CIRCUIT_BREAKER_THRESHOLD = 500;

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later" },
  validate: { xForwardedForHeader: false },
});

export function registerWhatsappRoutes(app: Express) {

  app.get(["/api/whatsapp/webhook", "/api/whatsapp/webhook/:identifier"], async (req, res) => {
    const mode = req.query["hub.mode"] as string;
    const token = req.query["hub.verify_token"] as string;
    const challenge = req.query["hub.challenge"] as string;
    const identifier = req.params.identifier;

    console.log("[whatsapp] Webhook verification attempt:", { mode, tokenReceived: !!token, challenge: !!challenge, identifier: identifier || "(none)" });

    if (mode === "subscribe" && token) {
      const isValid = await whatsappService.verifyWebhook(token);
      if (isValid) {
        console.log("[whatsapp] Webhook verification PASSED");
        return res.status(200).send(challenge);
      }
    }

    console.log("[whatsapp] Webhook verification FAILED");
    res.sendStatus(403);
  });

  app.post(["/api/whatsapp/webhook", "/api/whatsapp/webhook/:identifier"], webhookRateLimiter, verifyWhatsAppSignature, async (req, res) => {
    try {
      res.sendStatus(200);
      console.log("RAW WEBHOOK:", JSON.stringify(req.body).substring(0, 2000));
      const urlIdentifier = req.params.identifier || undefined;

      const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || "unknown";
      const now = Date.now();
      const key = `rl:${phoneNumberId}`;
      let rl = webhookRateLimits.get(key);
      if (!rl || rl.resetAt <= now) {
        rl = { count: 0, resetAt: now + WEBHOOK_RATE_WINDOW };
        webhookRateLimits.set(key, rl);
      }
      rl.count++;
      if (rl.count > WEBHOOK_RATE_LIMIT) {
        console.log(`[whatsapp] Rate limit exceeded for ${phoneNumberId}: ${rl.count} in window`);
        return;
      }

      const queueSize = webhookQueue.size + webhookQueue.pending;
      if (queueSize >= CIRCUIT_BREAKER_THRESHOLD) {
        console.log(`[whatsapp] Circuit breaker tripped: queue depth ${queueSize} ≥ ${CIRCUIT_BREAKER_THRESHOLD}`);
        return;
      }

      const msgEntries = req.body?.entry || [];
      const firstMsg = msgEntries?.[0]?.changes?.[0]?.value?.messages?.[0];
      const firstWamid = firstMsg?.id;
      const firstMsgTimestamp = firstMsg?.timestamp ? new Date(parseInt(firstMsg.timestamp) * 1000) : undefined;

      for (const entry of msgEntries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const msgs = change.value?.messages || [];
          for (const msg of msgs) {
            if (msg.id && isDuplicateMessage(msg.id)) {
              console.log(`[whatsapp] Duplicate message ${msg.id} — dropping`);
              if (msg.id) {
                const existing = await auditService.findExistingTrace(msg.id);
                if (existing) {
                  await auditService.incrementRetry(existing.traceId, existing.source);
                }
              }
              return;
            }
          }
        }
      }

      const firstChange = msgEntries?.[0]?.changes?.[0];
      const firstValue = firstChange?.value;
      const extractedPhoneNumberId = firstValue?.metadata?.phone_number_id;
      const firstStatus = firstValue?.statuses?.[0];
      const extractedSenderPhone =
        firstMsg?.from ||
        firstStatus?.recipient_id ||
        firstValue?.contacts?.[0]?.wa_id ||
        firstValue?.metadata?.display_phone_number ||
        undefined;
      const extractedContactName = firstValue?.contacts?.[0]?.profile?.name;
      const extractedMsgType = firstMsg?.type || (firstStatus ? "status_update" : undefined);
      const mediaTypes = ["image", "video", "audio", "document", "sticker"];
      const isMediaType = extractedMsgType && mediaTypes.includes(extractedMsgType);
      const mediaObj = isMediaType ? firstMsg?.[extractedMsgType] : undefined;
      const extractedMimeType = mediaObj?.mime_type;
      const extractedFileSize = mediaObj?.file_size ? Number(mediaObj.file_size) : undefined;

      let traceId: string | null = null;
      if (firstWamid) {
        const existing = await auditService.findExistingTrace(firstWamid);
        if (existing) {
          await auditService.incrementRetry(existing.traceId, existing.source);
          traceId = existing.traceId;
        } else {
          traceId = await auditService.startTrace({
            direction: "INBOUND",
            whatsappMessageId: firstWamid,
            rawPayload: JSON.stringify(req.body).substring(0, 2000),
            sequenceTimestamp: firstMsgTimestamp,
            phoneNumberId: extractedPhoneNumberId,
            senderPhone: extractedSenderPhone,
            senderName: extractedContactName,
            messageType: extractedMsgType,
            mimeType: extractedMimeType,
            fileSize: extractedFileSize,
          });
        }
      } else {
        traceId = await auditService.startTrace({
          direction: "INBOUND",
          rawPayload: JSON.stringify(req.body).substring(0, 2000),
          phoneNumberId: extractedPhoneNumberId,
          senderPhone: extractedSenderPhone,
          senderName: extractedContactName,
          messageType: extractedMsgType,
          mimeType: extractedMimeType,
          fileSize: extractedFileSize,
        });
      }

      const enrichedBody = {
        ...req.body,
        _webhookReceivedAt: Date.now(),
        _traceId: traceId,
        _urlIdentifier: urlIdentifier,
      };

      webhookQueue.add(async () => {
        try {
          enrichedBody._enqueuedAt = Date.now();
          await whatsappService.processIncomingWebhook(enrichedBody);
        } catch (err: any) {
          if (traceId) {
            auditService.updateStep({ traceId, step: "QUEUE_PROCESSING", status: "FAIL", error: err.message });
            auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
          }
          if (err.isTenantDbError) {
            console.error(`[whatsapp-queue] Tenant DB error — message may need retry: ${err.message}`);
            return;
          }
          console.error("[whatsapp-queue] Error processing webhook:", err.message);
        }
      });
    } catch (err: any) {
      console.error("[whatsapp] Webhook handler error:", err.message);
    }
  });

  app.get("/api/whatsapp/dedup-cache-size", requireAuth, requireRole("superadmin"), (req, res) => {
    res.json({ size: getDedupCacheSize() });
  });

  app.post("/api/whatsapp/send", requireAuth, requireTenant, async (req, res) => {
    try {
      const schema = z.object({
        recipient: z.string().min(1),
        textBody: z.string().optional(),
        templateName: z.string().optional(),
        templateLanguage: z.string().optional(),
        templateParams: z.array(z.string()).optional(),
        templateButtonParams: z.array(z.any()).optional(),
        tenantId: z.string().min(1),
        channelId: z.string().optional(),
      }).refine((data) => data.textBody || data.templateName, {
        message: "Either textBody or templateName is required",
      });

      const data = schema.parse(req.body);
      const result = await whatsappService.sendTextMessage(data);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp/send-media", requireAuth, requireTenant, async (req, res) => {
    try {
      const schema = z.object({
        recipient: z.string().min(1),
        tenantId: z.string().min(1),
        channelId: z.string().optional(),
        mediaType: z.enum(["image", "video", "audio", "document", "sticker"]),
        mediaUrl: z.string().optional(),
        mediaId: z.string().optional(),
        caption: z.string().optional(),
        fileName: z.string().optional(),
      }).refine((data) => data.mediaUrl || data.mediaId, {
        message: "Either mediaUrl or mediaId is required",
      });

      const data = schema.parse(req.body);
      const result = await whatsappService.sendMediaMessage(data);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp/send-location", requireAuth, requireTenant, async (req, res) => {
    try {
      const schema = z.object({
        recipient: z.string().min(1),
        tenantId: z.string().min(1),
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
      });

      const data = schema.parse(req.body);
      const result = await whatsappService.sendLocationMessage(data);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp/send-contacts", requireAuth, requireTenant, async (req, res) => {
    try {
      const schema = z.object({
        recipient: z.string().min(1),
        tenantId: z.string().min(1),
        contacts: z.array(z.object({
          name: z.object({
            formatted_name: z.string(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
          }),
          phones: z.array(z.object({ phone: z.string(), type: z.string().optional() })).optional(),
          emails: z.array(z.object({ email: z.string(), type: z.string().optional() })).optional(),
          org: z.object({ company: z.string().optional(), title: z.string().optional() }).optional(),
        })),
      });

      const data = schema.parse(req.body);
      const result = await whatsappService.sendContactsMessage(data);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/whatsapp-templates/config-check", requireAuth, requireTenant, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const result = await whatsappTemplateService.checkTenantConfig(tenantId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/whatsapp-templates", requireAuth, requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const templates = await whatsappTemplateService.getByTenant(tenantId, req.tenantDbConnection!);
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp-templates", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const schema = z.object({
        tenantId: z.string().min(1),
        name: z.string().min(1).regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
        friendlyName: z.string().optional(),
        category: z.string().min(1),
        language: z.string().min(1),
        bodyText: z.string().optional(),
        rawBodyContent: z.string().optional(),
        variableMapping: z.record(z.string(), z.any()).optional(),
        variables: z.array(z.object({
          index: z.number(),
          fieldName: z.string(),
          fieldType: z.string().default("TEXT"),
          friendlyLabel: z.string(),
          order: z.number(),
          options: z.array(z.string()).optional(),
          hasDefault: z.boolean().default(false),
          defaultValue: z.string().optional(),
        })).optional(),
        buttons: z.array(z.object({
          type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
          text: z.string().min(1),
          url: z.string().optional(),
          phoneNumber: z.string().optional(),
          payload: z.string().optional(),
          urlDynamic: z.boolean().optional().default(false),
        })).optional(),
        isActive: z.boolean().optional().default(true),
        teamId: z.string().nullable().optional(),
      }).refine((d) => d.bodyText || d.rawBodyContent, { message: "bodyText or rawBodyContent is required" });
      const data = schema.parse(req.body);
      const template = await whatsappTemplateService.create(data, req.tenantDbConnection!);
      await auditLogService.log({
        action: "CREATE",
        entityType: "WhatsAppTemplate",
        entityId: String(template._id),
        tenantId: data.tenantId,
        details: `Created WhatsApp template: ${template.name}`,
      });
      res.status(201).json(template);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "Template with this name and language already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/whatsapp-templates/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = String(req.body.tenantId || req.query.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });

      const existing = await whatsappTemplateService.getById(req.params.id, req.tenantDbConnection!);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      if (existing.metaTemplateId) {
        return res.status(403).json({
          message: "IMMUTABLE_TEMPLATE",
          detail: "Meta does not support editing approved templates. To change text, delete and create a new one.",
        });
      }

      const schema = z.object({
        name: z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
        friendlyName: z.string().optional(),
        category: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
        bodyText: z.string().optional(),
        rawBodyContent: z.string().optional(),
        variableMapping: z.record(z.string(), z.string()).optional(),
        variables: z.array(z.any()).optional(),
        buttons: z.array(z.any()).optional(),
        isActive: z.boolean().optional(),
        teamId: z.string().nullable().optional(),
      });
      const data = schema.parse(req.body);
      const template = await whatsappTemplateService.update(req.params.id, tenantId, data, req.tenantDbConnection!);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/whatsapp-templates/:id/metadata", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = String(req.body.tenantId || req.query.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const schema = z.object({
        friendlyName: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
      });
      const data = schema.parse(req.body);
      const template = await whatsappTemplateService.updateMetadata(req.params.id, tenantId, data, req.tenantDbConnection!);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/whatsapp-templates/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = String(req.query.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const result = await whatsappTemplateService.delete(req.params.id, tenantId, req.tenantDbConnection!);
      if (!result.success) {
        if (result.error === "NOT_FOUND") return res.status(404).json({ message: "Template not found" });
        return res.status(502).json({ message: result.error });
      }
      await auditLogService.log({
        action: "DELETE",
        entityType: "WhatsAppTemplate",
        entityId: req.params.id,
        tenantId: tenantId,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp-templates/sync", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = req.body.tenantId as string;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const result = await whatsappTemplateService.syncFromMeta(tenantId, req.tenantDbConnection!);
      if (result.error === "CONFIG_REQUIRED") {
        return res.status(400).json({ message: "CONFIG_REQUIRED", missing: ["wabaId", "accessToken"] });
      }
      if (result.error) {
        return res.status(502).json({ message: result.error });
      }
      res.json({ synced: result.synced });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp-templates/:id/submit", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = req.body.tenantId as string;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const result = await whatsappTemplateService.submitToMeta(req.params.id, tenantId, req.tenantDbConnection!);
      if (result.error === "CONFIG_REQUIRED") {
        return res.status(400).json({ message: "CONFIG_REQUIRED" });
      }
      if (!result.success) {
        return res.status(502).json({ message: result.error });
      }
      res.json({ success: true, metaTemplateId: result.metaTemplateId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/whatsapp-templates/:id/resolve", requireAuth, requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string || req.body.tenantId;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const { customerId, manualValues } = req.body;
      const userId = String(req.user?._id || "");
      const result = await whatsappTemplateService.resolveTemplateParams(
        req.params.id,
        tenantId,
        customerId || "",
        userId,
        req.tenantDbConnection!,
        manualValues
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/template-tags", requireAuth, requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const tags = await whatsappTemplateService.getTagsByTenant(tenantId, req.tenantDbConnection!);
      res.json(tags);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/template-tags", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const schema = z.object({
        tenantId: z.string().min(1),
        name: z.string().min(1),
        color: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const tag = await whatsappTemplateService.createTag(data.tenantId, data.name, data.color || "#6366f1", req.tenantDbConnection!);
      res.status(201).json(tag);
    } catch (error: any) {
      if (error.code === 11000) {
        return res.status(409).json({ message: "Tag with this name already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/template-tags/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = String(req.body.tenantId || req.query.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const data: any = {};
      if (req.body.name) data.name = req.body.name;
      if (req.body.color) data.color = req.body.color;
      const tag = await whatsappTemplateService.updateTag(req.params.id, tenantId, data, req.tenantDbConnection!);
      if (!tag) return res.status(404).json({ message: "Tag not found" });
      res.json(tag);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/template-tags/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const tenantId = String(req.query.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const deleted = await whatsappTemplateService.deleteTag(req.params.id, tenantId, req.tenantDbConnection!);
      if (!deleted) return res.status(404).json({ message: "Tag not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
