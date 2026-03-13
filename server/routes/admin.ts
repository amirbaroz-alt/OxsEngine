import type { Express } from "express";
import { tenantService } from "../services/tenant.service";
import { userService } from "../services/user.service";
import { communicationLogService } from "../services/communication-log.service";
import { smsService } from "../services/sms.service";
import { smsTemplateService } from "../services/sms-template.service";
import { translationOverrideService } from "../services/translation-override.service";
import { systemSettingsService } from "../services/system-settings.service";
import { auditLogService } from "../services/audit-log.service";
import { emailService } from "../services/email.service";
import { auditService } from "../services/audit.service";
import { syncTenantAlertEmails } from "../services/audit-alert.service";
import { ChannelModel } from "../models/channel.model";
import { decryptChannelFields } from "../services/channel.service";
import { requireAuth, requireRole, requireTenant } from "../middleware/auth.middleware";
import { insertUserSchema, insertTranslationOverrideSchema } from "@shared/schema";
import { z } from "zod";

function classifyFailure(failedSteps: Array<{ step: string; error?: string }>, traceDoc: any): string {
  if (!failedSteps.length) {
    if (traceDoc.pipelineStatus === "STUCK") return "STUCK_NO_PROGRESS";
    return "NO_FAILURE_DETECTED";
  }

  for (const s of failedSteps) {
    const err = (s.error || "").toLowerCase();
    const stepName = (s.step || "").toUpperCase();

    if ((err.includes("db timeout") || err.includes("did not complete within")) && stepName.includes("TENANT")) return "DB_TIMEOUT";
    if (err.includes("tenant") || (err.includes("no tenant") || (err.includes("not found") && stepName.includes("TENANT")))) return "TENANT_NOT_FOUND";
    if ((err.includes("no credentials") || err.includes("missing credentials")) && stepName.includes("CREDENTIAL")) return "AUTH_MISSING";
    if (stepName.includes("MEDIA") || err.includes("media") || err.includes("minio") || err.includes("s3")) return "MEDIA_FAILED";
    if (err.includes("timeout") || err.includes("timed out") || err.includes("econnaborted")) return "TIMEOUT";
    if (err.includes("token") || err.includes("unauthorized") || err.includes("401") || err.includes("access_token")) return "AUTH_TOKEN_EXPIRED";
    if (err.includes("rate limit") || err.includes("429") || err.includes("throttl")) return "RATE_LIMITED";
    if (stepName === "WEBHOOK_URL_VALIDATION" && err.includes("meta sent message")) return "WEBHOOK_URL_MISMATCH";
    if (err.includes("webhook") || err.includes("callback")) return "WEBHOOK_DELIVERY_FAILED";
    if (err.includes("duplicate") || err.includes("already exists") || err.includes("11000")) return "DUPLICATE_MESSAGE";
    if (err.includes("template") || err.includes("does not exist") || err.includes("payment required") || err.includes("not enough")) return "TEMPLATE_ERROR";
    if (err.includes("schema") || err.includes("validation") || (err.includes("invalid") && !err.includes("token"))) return "PAYLOAD_VALIDATION";
    if (err.includes("econnrefused") || err.includes("enotfound") || err.includes("network")) return "NETWORK_ERROR";
    if (err.includes("decrypt") || err.includes("cipher") || err.includes("encryption")) return "DECRYPTION_ERROR";
  }

  return "UNKNOWN";
}

export function registerAdminRoutes(app: Express) {

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const commFilter = tenantId ? { tenantId } : {};

      const [tenants, users, totalComms, successComms, failedComms, pendingComms, recentLogs] = await Promise.all([
        tenantService.count({ active: true }),
        userService.count(tenantId ? { tenantId } : undefined),
        communicationLogService.count(commFilter),
        communicationLogService.count({ ...commFilter, status: "Success" }),
        communicationLogService.count({ ...commFilter, status: "Failed" }),
        communicationLogService.count({ ...commFilter, status: "Pending" }),
        communicationLogService.getRecent(5, tenantId),
      ]);

      res.json({
        tenants,
        users,
        communications: { total: totalComms, success: successComms, failed: failedComms, pending: pendingComms },
        recentLogs: recentLogs.map((l) => ({
          _id: l._id,
          timestamp: l.timestamp,
          recipient: l.recipient,
          sender: l.sender,
          direction: l.direction,
          content: l.content,
          status: l.status,
          messageId: l.messageId,
          retryCount: l.retryCount,
          errorMessage: l.errorMessage,
          tenantId: l.tenantId,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/system-settings/tenant-form-layout", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const layout = await systemSettingsService.getTenantFormLayout();
      res.json(layout);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/system-settings/tenant-form-layout", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const layout = req.body;
      if (!Array.isArray(layout)) {
        return res.status(400).json({ message: "Layout must be an array" });
      }
      const saved = await systemSettingsService.saveTenantFormLayout(layout);
      res.json(saved);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/users", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const users = tenantId
        ? await userService.getByTenant(tenantId)
        : await userService.getAll();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      if (!data.tenantId || data.tenantId === "") { delete (data as any).tenantId; }
      const callerRole = (req as any).user?.role;
      const isPrivileged = ["superadmin", "businessadmin", "teamleader"].includes(callerRole);
      if (!isPrivileged && data.acwTimeLimit !== undefined) {
        delete (data as any).acwTimeLimit;
      }
      const user = await userService.create(data);
      await auditLogService.log({ action: "CREATE", entityType: "User", entityId: user._id as string, tenantId: data.tenantId || undefined, details: `Created user: ${user.name}` });
      res.status(201).json(user);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "Phone or email already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      const partialSchema = insertUserSchema.partial();
      const data = partialSchema.parse(req.body);
      if (data.tenantId === "") { delete (data as any).tenantId; }
      if (data.role === "superadmin") { (data as any).tenantId = null; }
      const callerRole = (req as any).user?.role;
      const isPrivileged = ["superadmin", "businessadmin", "teamleader"].includes(callerRole);
      if (!isPrivileged && data.acwTimeLimit !== undefined) {
        delete (data as any).acwTimeLimit;
      }
      const user = await userService.update(req.params.id, data);
      if (!user) return res.status(404).json({ message: "User not found" });
      await auditLogService.log({ action: "UPDATE", entityType: "User", entityId: req.params.id, details: `Updated user: ${user.name}` });
      res.json(user);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "Phone or email already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/communication-logs", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const logs = tenantId
        ? await communicationLogService.getByTenant(tenantId)
        : await communicationLogService.getAll();
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sms/send", async (req, res) => {
    try {
      const sendSchema = z.object({
        recipient: z.string().min(9),
        content: z.string().min(1),
        tenantId: z.string().min(1),
      });
      const data = sendSchema.parse(req.body);
      const result = await smsService.sendSms(data);
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sms/retry/:id", async (req, res) => {
    try {
      const result = await smsService.retrySms(req.params.id);
      if (!result) return res.status(404).json({ message: "Log not found" });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/audit-logs", requireAuth, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const action = req.query.action as string | undefined;
      const entityType = req.query.entityType as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      const filter: any = {};
      if (tenantId) filter.tenantId = tenantId;
      if (action) filter.action = action;
      if (entityType) filter.entityType = entityType;
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) filter.createdAt.$lte = new Date(to);
      }

      const { AuditLogModel } = await import("../models/audit-log.model");
      const total = await AuditLogModel.countDocuments(filter);
      const logs = await AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      res.json({ logs, total, page, pages: Math.ceil(total / limit) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sms-templates", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const templates = await smsTemplateService.getAll(tenantId);
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sms-templates/:id", async (req, res) => {
    try {
      const template = await smsTemplateService.getById(req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sms-templates", async (req, res) => {
    try {
      const template = await smsTemplateService.create(req.body);
      await auditLogService.log({
        action: "CREATE",
        entityType: "SmsTemplate",
        entityId: template._id as string,
        details: `Created SMS template: ${template.name}`,
      });
      res.status(201).json(template);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/sms-templates/:id", async (req, res) => {
    try {
      const template = await smsTemplateService.update(req.params.id, req.body);
      if (!template) return res.status(404).json({ message: "Template not found" });
      await auditLogService.log({
        action: "UPDATE",
        entityType: "SmsTemplate",
        entityId: req.params.id,
        details: `Updated SMS template: ${template.name}`,
      });
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sms-templates/:id", async (req, res) => {
    try {
      const deleted = await smsTemplateService.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Template not found" });
      await auditLogService.log({
        action: "DELETE",
        entityType: "SmsTemplate",
        entityId: req.params.id,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/analytics/overview", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const commFilter = tenantId ? { tenantId } : {};

      const [tenants, users, totalComms, successComms, failedComms, auditCount] = await Promise.all([
        tenantService.count({ active: true }),
        userService.count(tenantId ? { tenantId } : undefined),
        communicationLogService.count(commFilter),
        communicationLogService.count({ ...commFilter, status: "Success" }),
        communicationLogService.count({ ...commFilter, status: "Failed" }),
        auditLogService.count(tenantId ? { tenantId } : undefined),
      ]);

      res.json({
        tenants,
        users,
        communications: { total: totalComms, success: successComms, failed: failedComms },
        auditEntries: auditCount,
        successRate: totalComms > 0 ? Math.round((successComms / totalComms) * 100) : 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/export/communication-logs", async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string | undefined;
      const logs = tenantId
        ? await communicationLogService.getByTenant(tenantId)
        : await communicationLogService.getAll();

      const header = "ID,Timestamp,Recipient,Content,Status,Message ID,Retry Count,Error\n";
      const rows = logs.map((l: any) =>
        `"${l._id}","${l.timestamp}","${l.recipient}","${(l.content || '').replace(/"/g, '""')}","${l.status}","${l.messageId || ''}",${l.retryCount},"${l.errorMessage || ''}"`
      ).join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=communication-logs.csv");
      res.send("\uFEFF" + header + rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/translations", async (req, res) => {
    try {
      const language = req.query.language as string | undefined;
      const overrides = language
        ? await translationOverrideService.getByLanguage(language)
        : await translationOverrideService.getAll();
      res.json(overrides);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/translations/merged/:language", async (req, res) => {
    try {
      const map = await translationOverrideService.getMergedMap(req.params.language);
      res.json(map);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/translations", async (req, res) => {
    try {
      const data = insertTranslationOverrideSchema.parse(req.body);
      const override = await translationOverrideService.upsert(data.language, data.key, data.value);
      res.json(override);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/translations/batch", async (req, res) => {
    try {
      const batchSchema = z.array(insertTranslationOverrideSchema);
      const data = batchSchema.parse(req.body);
      await translationOverrideService.upsertBatch(data);
      res.json({ success: true, count: data.length });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/translations", async (req, res) => {
    try {
      const language = req.query.language as string;
      const key = req.query.key as string;
      if (!language || !key) {
        return res.status(400).json({ message: "language and key query params required" });
      }
      const deleted = await translationOverrideService.deleteByKey(language, key);
      if (!deleted) return res.status(404).json({ message: "Translation override not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/test/email", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { to, subject, html, tenantId } = req.body;
      if (!to || !subject || !html) {
        return res.status(400).json({ message: "to, subject, and html are required" });
      }
      const result = await emailService.send({
        to,
        subject,
        html,
        tenantId: tenantId || undefined,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/encryption/status", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const { ChannelModel } = await import("../models/channel.model");
      const { encryptionService } = await import("../services/encryption.service");

      const tenants = await TenantModel.find({});
      const channels = await ChannelModel.find({});

      let totalFields = 0;
      let encryptedFields = 0;
      let plaintextFields = 0;
      const issues: string[] = [];

      const TENANT_SENSITIVE: Record<string, string[]> = {
        smsConfig: ["accessToken"],
        mailConfig: ["sendGridKey"],
        whatsappConfig: ["accessToken", "verifyToken"],
        quotaGuardConfig: ["proxyUrl"],
      };

      for (const t of tenants) {
        const obj = t.toObject();
        for (const [configKey, fields] of Object.entries(TENANT_SENSITIVE)) {
          const config = (obj as any)[configKey];
          if (!config) continue;
          for (const field of fields) {
            const val = config[field];
            if (!val) continue;
            totalFields++;
            if (encryptionService.isEncrypted(val)) {
              encryptedFields++;
            } else {
              plaintextFields++;
              issues.push(`Tenant ${obj.nameEn || obj._id}: ${configKey}.${field}`);
            }
          }
        }
      }

      const CHANNEL_SENSITIVE = ["accessToken", "verifyToken", "sendGridKey", "appSecret"];
      for (const ch of channels) {
        const obj = ch.toObject();
        for (const field of CHANNEL_SENSITIVE) {
          const val = (obj as any)[field];
          if (!val) continue;
          totalFields++;
          if (encryptionService.isEncrypted(val)) {
            encryptedFields++;
          } else {
            plaintextFields++;
            issues.push(`Channel ${obj.name || obj._id}: ${field}`);
          }
        }
      }

      res.json({
        ok: plaintextFields === 0,
        totalFields,
        encryptedFields,
        plaintextFields,
        issues,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/encryption/verify", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const { ChannelModel } = await import("../models/channel.model");
      const { encryptionService } = await import("../services/encryption.service");

      let fixed = 0;

      const TENANT_SENSITIVE: Record<string, string[]> = {
        smsConfig: ["accessToken"],
        mailConfig: ["sendGridKey"],
        whatsappConfig: ["accessToken", "verifyToken"],
        quotaGuardConfig: ["proxyUrl"],
      };

      const tenants = await TenantModel.find({});
      for (const t of tenants) {
        const obj = t.toObject();
        let needsSave = false;
        for (const [configKey, fields] of Object.entries(TENANT_SENSITIVE)) {
          const config = (obj as any)[configKey];
          if (!config) continue;
          for (const field of fields) {
            const val = config[field];
            if (val && !encryptionService.isEncrypted(val)) {
              (t as any)[configKey][field] = encryptionService.encrypt(val);
              needsSave = true;
              fixed++;
            }
          }
        }
        if (needsSave) {
          t.markModified("smsConfig");
          t.markModified("mailConfig");
          t.markModified("whatsappConfig");
          t.markModified("quotaGuardConfig");
          await t.save();
        }
      }

      const CHANNEL_SENSITIVE = ["accessToken", "verifyToken", "sendGridKey", "appSecret"];
      const channels = await ChannelModel.find({});
      for (const ch of channels) {
        let needsSave = false;
        for (const field of CHANNEL_SENSITIVE) {
          const val = (ch as any)[field];
          if (val && !encryptionService.isEncrypted(val)) {
            (ch as any)[field] = encryptionService.encrypt(val);
            needsSave = true;
            fixed++;
          }
        }
        if (needsSave) await ch.save();
      }

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        action: "ENCRYPTION_VERIFY",
        entityType: "System",
        details: `Encryption verification: ${fixed} fields re-encrypted`,
      });

      res.json({ success: true, fixed });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/suggested-knowledge", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, async (req, res) => {
    try {
      const { SuggestedKnowledgeModel } = await import("../models/suggested-knowledge.model");
      const { MessageModel } = await import("../models/message.model");
      const { ConversationModel } = await import("../models/conversation.model");

      const schema = z.object({
        messageId: z.string().min(1),
        teamId: z.string().min(1),
        question: z.string().min(1),
        answer: z.string().min(1),
      });
      const data = schema.parse(req.body);

      const message = await MessageModel.findById(data.messageId).lean();
      if (!message) return res.status(404).json({ message: "Message not found" });

      const tenantId = req.query.tenantId as string || String(req.user?.tenantId);

      const suggestion = await SuggestedKnowledgeModel.create({
        tenantId,
        teamId: data.teamId,
        conversationId: message.conversationId,
        messageId: data.messageId,
        question: data.question.trim(),
        answer: data.answer.trim(),
        status: "pending",
        createdBy: req.user?._id,
        createdByName: req.user?.name || "Unknown",
      });

      const internalNote = await MessageModel.create({
        conversationId: message.conversationId,
        tenantId,
        direction: "OUTBOUND",
        content: `${req.user?.name} submitted knowledge suggestion to team (ID: ${data.teamId})`,
        type: "SYSTEM",
        channel: (await ConversationModel.findById(message.conversationId).lean())?.channel || "WHATSAPP",
        isInternal: true,
        senderName: "System",
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        ...(req.user?.role ? { senderRole: req.user.role } : {}),
        metadata: { systemEvent: "knowledge_suggestion", agentName: req.user?.name, teamId: data.teamId },
      });

      const { emitNewMessage } = await import("../services/socket.service");
      emitNewMessage(tenantId, String(message.conversationId), internalNote.toObject());

      const { getIO } = await import("../services/socket.service");
      const ioRef = getIO();
      if (ioRef) {
        ioRef.to(`tenant:${tenantId}`).emit("knowledge-count-update", { teamId: data.teamId });
      }

      res.status(201).json(suggestion);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors.map(e => e.message).join(", ") });
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suggested-knowledge", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { SuggestedKnowledgeModel } = await import("../models/suggested-knowledge.model");
      const tenantId = req.query.tenantId as string;
      const status = req.query.status as string || "pending";
      const teamId = req.query.teamId as string | undefined;

      const filter: any = { tenantId, status };
      if (teamId) filter.teamId = teamId;

      if (req.user?.role === "teamleader") {
        const { TeamModel } = await import("../models/team.model");
        const managedTeams = await TeamModel.find({ tenantId, managerId: req.user._id }).lean();
        const managedTeamIds = managedTeams.map(t => String(t._id));
        if (managedTeamIds.length === 0) return res.json([]);
        filter.teamId = { $in: managedTeamIds };
      }

      const suggestions = await SuggestedKnowledgeModel.find(filter).sort({ createdAt: -1 }).lean();
      res.json(suggestions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/suggested-knowledge/count", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { SuggestedKnowledgeModel } = await import("../models/suggested-knowledge.model");
      const tenantId = req.query.tenantId as string;

      let filter: any = { tenantId, status: "pending" };

      if (req.user?.role === "teamleader") {
        const { TeamModel } = await import("../models/team.model");
        const managedTeams = await TeamModel.find({ tenantId, managerId: req.user._id }).lean();
        const managedTeamIds = managedTeams.map(t => String(t._id));
        if (managedTeamIds.length === 0) return res.json({ count: 0 });
        filter.teamId = { $in: managedTeamIds };
      }

      const count = await SuggestedKnowledgeModel.countDocuments(filter);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/suggested-knowledge/:id/approve", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { SuggestedKnowledgeModel } = await import("../models/suggested-knowledge.model");
      const { answer } = req.body;

      const suggestion = await SuggestedKnowledgeModel.findById(req.params.id);
      if (!suggestion) return res.status(404).json({ message: "Suggestion not found" });
      if (suggestion.status !== "pending") return res.status(400).json({ message: "Already processed" });

      if (req.user?.role === "teamleader") {
        const { TeamModel } = await import("../models/team.model");
        const team = await TeamModel.findById(suggestion.teamId).lean();
        if (!team || String(team.managerId) !== String(req.user._id)) {
          return res.status(403).json({ message: "Not the manager of this team" });
        }
      }

      suggestion.status = "approved";
      suggestion.approvedBy = req.user?._id;
      suggestion.approvedByName = req.user?.name || "Unknown";
      if (answer) suggestion.answer = answer.trim();
      await suggestion.save();

      const { getIO: getIO2 } = await import("../services/socket.service");
      const ioRef2 = getIO2();
      if (ioRef2) {
        ioRef2.to(`tenant:${String(suggestion.tenantId)}`).emit("knowledge-count-update", { teamId: String(suggestion.teamId) });
      }

      res.json(suggestion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/suggested-knowledge/:id/reject", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { SuggestedKnowledgeModel } = await import("../models/suggested-knowledge.model");
      const { rejectionReason } = req.body;

      const suggestion = await SuggestedKnowledgeModel.findById(req.params.id);
      if (!suggestion) return res.status(404).json({ message: "Suggestion not found" });
      if (suggestion.status !== "pending") return res.status(400).json({ message: "Already processed" });

      if (req.user?.role === "teamleader") {
        const { TeamModel } = await import("../models/team.model");
        const team = await TeamModel.findById(suggestion.teamId).lean();
        if (!team || String(team.managerId) !== String(req.user._id)) {
          return res.status(403).json({ message: "Not the manager of this team" });
        }
      }

      suggestion.status = "rejected";
      suggestion.approvedBy = req.user?._id;
      suggestion.approvedByName = req.user?.name || "Unknown";
      if (rejectionReason) suggestion.rejectionReason = rejectionReason.trim();
      await suggestion.save();

      const { getIO: getIO3 } = await import("../services/socket.service");
      const ioRef3 = getIO3();
      if (ioRef3) {
        ioRef3.to(`tenant:${String(suggestion.tenantId)}`).emit("knowledge-count-update", { teamId: String(suggestion.teamId) });
      }

      res.json(suggestion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id/deactivate", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const user = await UserModel.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
      if (!user) return res.status(404).json({ message: "User not found" });
      await auditLogService.log({ actorId: String(req.user?._id), actorName: req.user?.name, action: "DEACTIVATE", entityType: "User", entityId: req.params.id, details: `Deactivated user: ${user.name}` });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id/activate", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const user = await UserModel.findByIdAndUpdate(req.params.id, { active: true }, { new: true }).lean();
      if (!user) return res.status(404).json({ message: "User not found" });
      await auditLogService.log({ actorId: String(req.user?._id), actorName: req.user?.name, action: "ACTIVATE", entityType: "User", entityId: req.params.id, details: `Activated user: ${user.name}` });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const pipelineStatus = req.query.pipelineStatus as string | undefined;
      const direction = req.query.direction as string | undefined;
      const tenantId = req.query.tenantId as string | undefined;
      const whatsappMessageId = req.query.whatsappMessageId as string | undefined;
      const phoneSearch = req.query.phoneSearch as string | undefined;

      const result = await auditService.queryTraces({
        tenantId,
        direction: direction as "INBOUND" | "OUTBOUND" | undefined,
        pipelineStatus,
        whatsappMessageId,
        phoneSearch,
        page,
        limit,
      });

      res.json({
        traces: result.traces,
        total: result.totalCount,
        page,
        pages: Math.ceil(result.totalCount / limit),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs/buffer-stats", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const stats = auditService.getBufferStats();

      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [totalLast24h, failedLast24h] = await Promise.all([
        SystemAuditLogModel.countDocuments({ createdAt: { $gte: twentyFourHoursAgo } }),
        SystemAuditLogModel.countDocuments({ createdAt: { $gte: twentyFourHoursAgo }, pipelineStatus: { $in: ["FAILED", "STUCK", "PARTIAL", "PARTIAL_BUFFER_EXCEEDED"] } }),
      ]);

      res.json({
        buffer: stats,
        failureRate: totalLast24h > 0 ? Math.round((failedLast24h / totalLast24h) * 1000) / 10 : 0,
        totalLast24h,
        failedLast24h,
        serverUptime: process.uptime(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/audit-logs/decrypt/:traceId", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { traceId } = req.params;
      const { trace } = await auditService.getTrace(traceId);
      if (!trace) {
        return res.status(404).json({ message: "Trace not found" });
      }

      const encryptedContent = (trace as any).encryptedContent;
      if (!encryptedContent) {
        return res.status(404).json({ message: "No encrypted content for this trace" });
      }

      const decrypted = auditService.decryptContent(encryptedContent);

      auditService.logAccess({
        traceId,
        viewedBy: String(req.user?._id),
        viewerRole: req.user?.role || "unknown",
        fieldsAccessed: ["encryptedContent"],
      });

      res.json({ traceId, decryptedContent: decrypted });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/audit-logs/sync-emails", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const result = await syncTenantAlertEmails();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  let managerSummaryCache: { data: any; timestamp: number } | null = null;
  const MANAGER_SUMMARY_TTL = 60_000;

  app.get("/api/admin/audit-logs/manager-summary", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      if (managerSummaryCache && Date.now() - managerSummaryCache.timestamp < MANAGER_SUMMARY_TTL) {
        return res.json(managerSummaryCache.data);
      }

      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const failedTraces = await SystemAuditLogModel.find({
        createdAt: { $gte: twentyFourHoursAgo },
        pipelineStatus: { $in: ["FAILED", "STUCK"] },
      }).select("traceId pipelineStatus steps tenantId direction").lean();

      const codeCounts: Record<string, number> = {};
      let total = 0;

      for (const trace of failedTraces) {
        const traceDoc = trace as any;
        const steps: Array<{ step: string; status: string; error?: string }> = traceDoc.steps || [];
        const failedSteps = steps.filter((s: any) => s.status === "FAIL");
        const diagCode = classifyFailure(failedSteps, traceDoc);
        if (diagCode === "NO_FAILURE_DETECTED") continue;
        codeCounts[diagCode] = (codeCounts[diagCode] || 0) + 1;
        total++;
      }

      const result = { codeCounts, total, tracesScanned: failedTraces.length };
      managerSummaryCache = { data: result, timestamp: Date.now() };
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs/diagnose/:traceId", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { traceId } = req.params;
      const { trace } = await auditService.getTrace(traceId);
      if (!trace) {
        return res.status(404).json({ message: "Trace not found" });
      }

      const traceDoc = trace as any;
      const steps: Array<{ step: string; status: string; error?: string }> = traceDoc.steps || [];
      const failedSteps = steps.filter((s: any) => s.status === "FAIL");
      const diagCode = classifyFailure(failedSteps, traceDoc);

      res.json({
        traceId,
        pipelineStatus: traceDoc.pipelineStatus,
        diagnosisCode: diagCode,
        failedSteps: failedSteps.map((s: any) => ({ step: s.step, error: s.error })),
        tenantId: traceDoc.tenantId ? String(traceDoc.tenantId) : null,
        direction: traceDoc.direction,
        timestamp: traceDoc.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/audit-logs/retry/:traceId", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { traceId } = req.params;
      const { trace } = await auditService.getTrace(traceId);
      if (!trace) {
        return res.status(404).json({ message: "Trace not found" });
      }

      const traceDoc = trace as any;
      if (!["FAILED", "STUCK"].includes(traceDoc.pipelineStatus)) {
        return res.status(400).json({ message: "Only FAILED or STUCK traces can be retried" });
      }

      const encryptedContent = traceDoc.encryptedContent;
      if (!encryptedContent) {
        return res.status(400).json({ message: "No encrypted content available for retry" });
      }

      let payload: any;
      try {
        const decrypted = auditService.decryptContent(encryptedContent);
        payload = JSON.parse(decrypted);
      } catch (err: any) {
        return res.status(400).json({ message: `Failed to decrypt payload: ${err.message}` });
      }

      const firstChange = payload?.entry?.[0]?.changes?.[0];
      const firstValue = firstChange?.value;
      const firstMsg = firstValue?.messages?.[0];
      const firstStatus = firstValue?.statuses?.[0];
      const extractedPhoneNumberId = firstValue?.metadata?.phone_number_id;
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

      const retryTraceId = `retry-${traceId}-${Date.now()}`;
      await auditService.startTrace({
        traceId: retryTraceId,
        direction: traceDoc.direction || "INBOUND",
        encryptedContent: encryptedContent,
        whatsappMessageId: traceDoc.whatsappMessageId,
        tenantId: traceDoc.tenantId ? String(traceDoc.tenantId) : undefined,
        parentTraceId: traceDoc.traceId || traceId,
        phoneNumberId: extractedPhoneNumberId || traceDoc.phoneNumberId,
        senderPhone: extractedSenderPhone || traceDoc.senderPhone,
        senderName: extractedContactName || traceDoc.senderName,
        messageType: extractedMsgType || traceDoc.messageType,
        mimeType: extractedMimeType || traceDoc.mimeType,
        fileSize: extractedFileSize ?? traceDoc.fileSize,
      });

      auditService.updateStep({
        traceId: retryTraceId,
        step: "RETRY_INITIATED",
        status: "OK",
      });

      try {
        const { whatsappService } = await import("../services/whatsapp.service");
        payload._traceId = retryTraceId;
        payload._isRetry = true;
        await whatsappService.processIncomingWebhook(payload);

        res.json({
          success: true,
          originalTraceId: traceId,
          retryTraceId,
          message: "Retry submitted successfully",
        });
      } catch (err: any) {
        auditService.updateStep({
          traceId: retryTraceId,
          step: "RETRY_FAILED",
          status: "FAIL",
          error: err.message,
        });

        const { getTenantDbConnection } = await import("../lib/db-manager");
        let tenantDbConnection;
        try {
          if (traceDoc.tenantId) {
            tenantDbConnection = await getTenantDbConnection(String(traceDoc.tenantId));
          }
        } catch {}

        await auditService.finalizeTrace({
          traceId: retryTraceId,
          pipelineStatus: "FAILED",
          tenantDbConnection,
        });

        res.status(500).json({
          success: false,
          originalTraceId: traceId,
          retryTraceId,
          message: `Retry failed: ${err.message}`,
        });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs/check-channels", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const channels = await ChannelModel.find({
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
        phoneNumberId: { $ne: null },
      }).lean();

      const results: Array<{
        phoneNumberId: string;
        channelName: string;
        tenantId: string;
        status: "connected" | "auth_error" | "unreachable";
        displayName?: string;
        error?: string;
      }> = [];

      for (const channel of channels) {
        const decrypted = decryptChannelFields(channel);
        const phoneNumberId = decrypted.phoneNumberId;
        const accessToken = decrypted.accessToken;

        if (!phoneNumberId || !accessToken) {
          results.push({
            phoneNumberId: phoneNumberId || "unknown",
            channelName: (channel as any).name || phoneNumberId || "unknown",
            tenantId: String(channel.tenantId),
            status: "auth_error",
            error: "Missing credentials",
          });
          continue;
        }

        try {
          const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(8000),
          });

          if (response.ok) {
            const data = await response.json();
            results.push({
              phoneNumberId,
              channelName: (channel as any).name || phoneNumberId,
              tenantId: String(channel.tenantId),
              status: "connected",
              displayName: data.verified_name || data.display_phone_number || phoneNumberId,
            });
          } else {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = (errorData as any)?.error?.message || `HTTP ${response.status}`;
            const isAuthError = response.status === 401 || response.status === 403 ||
              errorMsg.toLowerCase().includes("token") || errorMsg.toLowerCase().includes("expired");
            results.push({
              phoneNumberId,
              channelName: (channel as any).name || phoneNumberId,
              tenantId: String(channel.tenantId),
              status: isAuthError ? "auth_error" : "unreachable",
              error: errorMsg,
            });
          }
        } catch (err: any) {
          results.push({
            phoneNumberId,
            channelName: (channel as any).name || phoneNumberId,
            tenantId: String(channel.tenantId),
            status: "unreachable",
            error: err.message || "Network error",
          });
        }
      }

      const { channelCache } = await import("../services/channel-cache.service");
      const cacheCount = await channelCache.rebuild();

      res.json({ channels: results, checkedAt: new Date().toISOString(), cacheRebuilt: cacheCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/system-stats", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { channelCache } = await import("../services/channel-cache.service");
      const metrics = channelCache.getMetrics();

      const channels = await ChannelModel.find({
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
        phoneNumberId: { $ne: null },
      }).lean();

      let activeTokens = 0;
      let expiredTokens = 0;
      let totalChannels = channels.length;

      for (const channel of channels) {
        const decrypted = decryptChannelFields(channel);
        if (decrypted.accessToken && decrypted.accessToken.length > 10) {
          if ((channel as any).tokenExpired) {
            expiredTokens++;
          } else {
            activeTokens++;
          }
        } else {
          expiredTokens++;
        }
      }

      res.json({
        cache: {
          cacheHits: metrics.cacheHits,
          dbFallbacks: metrics.dbFallbacks,
          totalResolutions: metrics.totalResolutions,
          cacheHitRate: metrics.cacheHitRate,
          channelsLoaded: metrics.channelsLoaded,
          channelsByPhone: metrics.channelsByPhone,
          lastRebuiltAt: metrics.lastRebuiltAt,
          initialized: channelCache.isInitialized,
        },
        latency: {
          avgMs: metrics.avgLatencyMs,
          samples: metrics.latencySamples,
        },
        tokens: {
          active: activeTokens,
          expired: expiredTokens,
          total: totalChannels,
        },
        serverUptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/audit-logs/check-credentials", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const channels = await ChannelModel.find({
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
        phoneNumberId: { $ne: null },
      }).lean();

      const results: Array<{
        phoneNumberId: string;
        channelName: string;
        tenantId: string;
        hasToken: boolean;
        tokenLength?: number;
        error?: string;
      }> = [];

      for (const channel of channels) {
        const decrypted = decryptChannelFields(channel);
        const phoneNumberId = decrypted.phoneNumberId || "unknown";
        const accessToken = decrypted.accessToken;
        const channelName = (channel as any).name || phoneNumberId;
        const tenantId = String(channel.tenantId);

        if (!accessToken || accessToken.trim().length === 0) {
          results.push({
            phoneNumberId,
            channelName,
            tenantId,
            hasToken: false,
            error: "No access token found in database",
          });
        } else {
          results.push({
            phoneNumberId,
            channelName,
            tenantId,
            hasToken: true,
            tokenLength: accessToken.length,
          });
        }
      }

      res.json({ channels: results, checkedAt: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/audit-logs/backfill-metadata", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { decryptPayload } = await import("../utils/encryption");
      const missing = (field: string) => ({ $or: [{ [field]: null }, { [field]: "" }, { [field]: { $exists: false } }] });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      let clientDisconnected = false;
      _req.on("close", () => { clientDisconnected = true; });

      const sendProgress = (data: any) => {
        if (clientDisconnected) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const totalCount = await SystemAuditLogModel.countDocuments({
        $or: [
          missing("messageType"),
          missing("senderPhone"),
          missing("mimeType"),
          missing("fileSize"),
          missing("senderName"),
          missing("phoneNumberId"),
        ],
        encryptedContent: { $exists: true, $ne: null },
      });

      sendProgress({ type: "start", total: totalCount });

      const BATCH_SIZE = 50;
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      let processed = 0;

      const cursor = SystemAuditLogModel.find({
        $or: [
          missing("messageType"),
          missing("senderPhone"),
          missing("mimeType"),
          missing("fileSize"),
          missing("senderName"),
          missing("phoneNumberId"),
        ],
        encryptedContent: { $exists: true, $ne: null },
      }).cursor();

      let batch: any[] = [];

      const processBatch = async (docs: any[]) => {
        for (const doc of docs) {
          try {
            const raw = decryptPayload(doc.encryptedContent!);
            let payload: any;
            try {
              payload = JSON.parse(raw);
            } catch {
              skipped++;
              continue;
            }

            const firstChange = payload?.entry?.[0]?.changes?.[0];
            const firstValue = firstChange?.value;
            const firstMsg = firstValue?.messages?.[0];
            const firstStatus = firstValue?.statuses?.[0];

            const updateFields: Record<string, any> = {};

            if (firstMsg) {
              if (!doc.messageType && firstMsg.type) updateFields.messageType = firstMsg.type;
            } else if (firstStatus) {
              if (!doc.messageType) updateFields.messageType = "status_update";
            }

            if (!doc.senderPhone) {
              const deepPhone =
                firstMsg?.from ||
                firstStatus?.recipient_id ||
                firstValue?.contacts?.[0]?.wa_id ||
                firstValue?.metadata?.display_phone_number ||
                undefined;
              if (deepPhone) updateFields.senderPhone = deepPhone;
            }

            if (!doc.senderName && firstValue?.contacts?.[0]?.profile?.name) {
              updateFields.senderName = firstValue.contacts[0].profile.name;
            }

            if (!doc.phoneNumberId && firstValue?.metadata?.phone_number_id) {
              updateFields.phoneNumberId = firstValue.metadata.phone_number_id;
            }

            const msgType = firstMsg?.type;
            const mediaTypes = ["image", "video", "audio", "document", "sticker"];
            if (msgType && mediaTypes.includes(msgType)) {
              const mediaObj = firstMsg[msgType];
              if (!doc.mimeType && mediaObj?.mime_type) updateFields.mimeType = mediaObj.mime_type;
              if (!doc.fileSize && mediaObj?.file_size) updateFields.fileSize = Number(mediaObj.file_size);
            }

            if (Object.keys(updateFields).length > 0) {
              await SystemAuditLogModel.updateOne({ _id: doc._id }, { $set: updateFields });
              updated++;
            } else {
              skipped++;
            }
          } catch (err: any) {
            errors++;
          }
        }
        processed += docs.length;
        sendProgress({ type: "progress", processed, total: totalCount, updated, skipped, errors });
      };

      for await (const doc of cursor) {
        if (clientDisconnected) break;
        batch.push(doc);
        if (batch.length >= BATCH_SIZE) {
          await processBatch(batch);
          batch = [];
        }
      }
      if (batch.length > 0 && !clientDisconnected) {
        await processBatch(batch);
      }

      sendProgress({ type: "done", updated, skipped, errors, total: totalCount });
      res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      res.end();
    }
  });

  app.get("/api/admin/audit-logs/orphans", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const orphanTraces = await SystemAuditLogModel.find({
        createdAt: { $gte: twentyFourHoursAgo },
        direction: "INBOUND",
        messageType: { $nin: [null, "status_update"] },
        senderPhone: { $exists: true, $ne: null },
        "steps.step": "TENANT_RESOLUTION",
        $or: [
          { pipelineStatus: "FAILED", "steps.status": "FAIL" },
          { "steps.status": "WARN" },
        ],
      }).sort({ createdAt: -1 }).lean();

      const tenantNotFoundOrphans = orphanTraces.filter((trace: any) => {
        const steps = trace.steps || [];
        const tenantStep = steps.find((s: any) => s.step === "TENANT_RESOLUTION");
        if (!tenantStep) return false;
        if (tenantStep.status === "WARN") return true;
        const failedSteps = steps.filter((s: any) => s.status === "FAIL");
        return classifyFailure(failedSteps, trace) === "TENANT_NOT_FOUND";
      });

      res.json({
        orphans: tenantNotFoundOrphans.map((t: any) => {
          const tenantStep = (t.steps || []).find((s: any) => s.step === "TENANT_RESOLUTION");
          const isFallbackDelivered = tenantStep?.status === "WARN";
          return {
            traceId: t.traceId,
            whatsappMessageId: t.whatsappMessageId,
            senderPhone: t.senderPhone,
            senderName: t.senderName,
            phoneNumberId: t.phoneNumberId,
            messageType: t.messageType,
            createdAt: t.createdAt,
            pipelineStatus: t.pipelineStatus,
            hasEncryptedContent: !!t.encryptedContent,
            isFallbackDelivered,
          };
        }),
        count: tenantNotFoundOrphans.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/audit-logs/recovery-push", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const { whatsappService } = await import("../services/whatsapp.service");
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const orphanTraces = await SystemAuditLogModel.find({
        createdAt: { $gte: twentyFourHoursAgo },
        pipelineStatus: "FAILED",
        direction: "INBOUND",
        messageType: { $nin: [null, "status_update"] },
        encryptedContent: { $exists: true, $ne: null },
        "steps.step": "TENANT_RESOLUTION",
        "steps.status": "FAIL",
      }).lean();

      const toRecover = orphanTraces.filter((trace: any) => {
        const steps = trace.steps || [];
        const failedSteps = steps.filter((s: any) => s.status === "FAIL");
        return classifyFailure(failedSteps, trace) === "TENANT_NOT_FOUND";
      });

      let recovered = 0;
      let failed = 0;
      const failureDetails: { phone: string; error: string; traceId: string }[] = [];

      const { findChannelByDisplayPhone } = await import("../services/channel.service");

      for (const trace of toRecover) {
        try {
          const decrypted = auditService.decryptContent((trace as any).encryptedContent);
          const payload = JSON.parse(decrypted);

          const entries = payload.entry || [];
          for (const entry of entries) {
            for (const change of (entry.changes || [])) {
              const meta = change?.value?.metadata;
              if (meta?.display_phone_number && meta?.phone_number_id) {
                try {
                  await findChannelByDisplayPhone(meta.display_phone_number, meta.phone_number_id);
                } catch {}
              }
            }
          }

          const retryTraceId = `recovery-${(trace as any).traceId}-${Date.now()}`;
          await auditService.startTrace({
            traceId: retryTraceId,
            direction: "INBOUND",
            encryptedContent: (trace as any).encryptedContent,
            whatsappMessageId: (trace as any).whatsappMessageId,
            tenantId: (trace as any).tenantId ? String((trace as any).tenantId) : undefined,
            parentTraceId: (trace as any).traceId,
            phoneNumberId: (trace as any).phoneNumberId,
            senderPhone: (trace as any).senderPhone,
            senderName: (trace as any).senderName,
            messageType: (trace as any).messageType,
          });

          auditService.updateStep({ traceId: retryTraceId, step: "RECOVERY_PUSH", status: "OK" });

          payload._traceId = retryTraceId;
          payload._isRetry = true;
          await whatsappService.processIncomingWebhook(payload);
          recovered++;

          await SystemAuditLogModel.updateOne(
            { traceId: (trace as any).traceId },
            { $set: { handlingStatus: "RESOLVED", pipelineStatus: "COMPLETED" } }
          );
        } catch (err: any) {
          failed++;
          failureDetails.push({
            phone: (trace as any).senderPhone || "—",
            error: err.message || "Unknown error",
            traceId: (trace as any).traceId,
          });
        }
      }

      managerSummaryCache = null;

      res.json({
        success: true,
        total: toRecover.length,
        recovered,
        failed,
        failureDetails: failureDetails.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/db-health/:tenantId", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { tenantId } = req.params;
      const { tenantDbManager } = await import("../lib/db-manager");
      const health = await tenantDbManager.checkHealth(tenantId);
      res.json({ tenantId, ...health });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/data-migration/static-routes", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { STATIC_PHONE_ROUTES } = await import("../lib/constants/static-routes");
      const { TenantModel } = await import("../models/tenant.model");
      const { CommunicationLogModel } = await import("../models/communication-log.model");
      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const { channelCache } = await import("../services/channel-cache.service");

      const slugToTenant = new Map<string, string>();
      for (const [phoneNumberId, slug] of Object.entries(STATIC_PHONE_ROUTES)) {
        const tenant = await TenantModel.findOne({ slug, active: true }).lean();
        if (tenant) {
          slugToTenant.set(phoneNumberId, String((tenant as any)._id));
        }
      }

      let logsUpdated = 0;
      let tracesUpdated = 0;

      for (const [phoneNumberId, correctTenantId] of slugToTenant.entries()) {
        const logResult = await CommunicationLogModel.updateMany(
          {
            $or: [
              { "metadata.phoneNumberId": phoneNumberId },
              { sender: phoneNumberId },
            ],
            tenantId: { $ne: correctTenantId },
          },
          { $set: { tenantId: correctTenantId } }
        );
        logsUpdated += logResult.modifiedCount;

        const traceResult = await SystemAuditLogModel.updateMany(
          {
            phoneNumberId,
            tenantId: { $ne: correctTenantId },
          },
          { $set: { tenantId: correctTenantId } }
        );
        tracesUpdated += traceResult.modifiedCount;
      }

      await channelCache.rebuild();

      res.json({
        success: true,
        logsUpdated,
        tracesUpdated,
        tenantsResolved: Object.fromEntries(slugToTenant),
        cacheRebuilt: true,
        channelsInCache: channelCache.size,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/analytics/dashboard", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
      const TenantModel = (await import("../models/tenant.model")).default;

      const period = (_req.query.period as string) || "24h";
      const periodMs = period === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      const twentyFourHoursAgo = new Date(Date.now() - periodMs);

      const [tenantVolume, gatekeeperStats, speedStats, allTenants] = await Promise.all([
        SystemAuditLogModel.aggregate([
          { $match: { createdAt: { $gte: twentyFourHoursAgo } } },
          { $group: { _id: "$tenantId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        SystemAuditLogModel.aggregate([
          { $match: { createdAt: { $gte: twentyFourHoursAgo }, "steps.step": "WEBHOOK_URL_VALIDATION" } },
          { $unwind: "$steps" },
          { $match: { "steps.step": "WEBHOOK_URL_VALIDATION" } },
          { $group: {
            _id: null,
            matches: { $sum: { $cond: [{ $eq: ["$steps.status", "OK"] }, 1, 0] } },
            mismatches: { $sum: { $cond: [{ $eq: ["$steps.status", "FAIL"] }, 1, 0] } },
            total: { $sum: 1 },
          }},
        ]),
        SystemAuditLogModel.aggregate([
          { $match: { createdAt: { $gte: twentyFourHoursAgo }, pipelineStatus: "COMPLETED", direction: "INBOUND" } },
          { $project: {
            duration: {
              $subtract: [
                { $max: "$steps.timestamp" },
                { $min: "$steps.timestamp" },
              ],
            },
          }},
          { $match: { duration: { $gt: 0 } } },
          { $group: {
            _id: null,
            avgMs: { $avg: "$duration" },
            minMs: { $min: "$duration" },
            maxMs: { $max: "$duration" },
            count: { $sum: 1 },
          }},
        ]),
        TenantModel.find({ active: true }).select("_id slug nameEn nameHe").lean(),
      ]);

      const tenantLookup = new Map<string, { slug: string; name: string }>();
      for (const t of allTenants) {
        tenantLookup.set(String(t._id), { slug: t.slug || "", name: t.nameEn || t.nameHe || t.slug || "" });
      }

      const volumeByTenant = tenantVolume.map((v: any) => {
        const info = tenantLookup.get(String(v._id));
        return {
          tenantId: String(v._id),
          slug: info?.slug || "unknown",
          name: info?.name || "Unknown",
          count: v.count,
        };
      });

      const gk = gatekeeperStats[0] || { matches: 0, mismatches: 0, total: 0 };
      const sp = speedStats[0] || { avgMs: 0, minMs: 0, maxMs: 0, count: 0 };

      res.json({
        volumeByTenant,
        gatekeeper: {
          matches: gk.matches,
          mismatches: gk.mismatches,
          total: gk.total,
          accuracy: gk.total > 0 ? Math.round((gk.matches / gk.total) * 100) : 100,
        },
        processingSpeed: {
          avgMs: Math.round(sp.avgMs || 0),
          minMs: Math.round(sp.minMs || 0),
          maxMs: Math.round(sp.maxMs || 0),
          samplesCount: sp.count,
        },
        period,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/admin/force-rebuild-sessions", requireAuth, requireRole("superadmin"), async (_req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const { tenantDbManager } = await import("../lib/db-manager");
      const { getActiveSessionModel } = await import("../models/active-session.model");
      const { getMessageModel } = await import("../models/message.model");
      const { getCustomerModel } = await import("../models/customer.model");

      const envDbUrl = process.env.DATABASE_URL;
      const mongoEnvUrl = envDbUrl && envDbUrl.startsWith("mongodb") ? envDbUrl : undefined;
      const fallbackUri = mongoEnvUrl || process.env.MONGODB_URI || "";

      const tenants = await TenantModel.find({ active: true }).select("+tenantDbUri").lean();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const results: Record<string, number> = {};

      for (const t of tenants) {
        const tenantId = String(t._id);
        const tenantName = (t as any).name || (t as any).slug || tenantId;
        const dbUri = (t as any).tenantDbUri || fallbackUri;
        if (!dbUri) { results[tenantName] = -1; continue; }

        try {
          const conn = await tenantDbManager.getTenantConnection(tenantId, dbUri);
          const ASModel = getActiveSessionModel(conn);
          const MsgModel = getMessageModel(conn);
          const CustModel = getCustomerModel(conn);

          await ASModel.deleteMany({ tenantId });

          const inboundAgg = await MsgModel.aggregate([
            { $match: { tenantId: t._id, direction: "INBOUND", createdAt: { $gte: cutoff } } },
            { $sort: { createdAt: -1 } },
            { $group: {
              _id: "$conversationId",
              lastInboundAt: { $first: "$createdAt" },
            }},
          ]);

          if (inboundAgg.length === 0) { results[tenantName] = 0; continue; }

          const { getConversationModel } = await import("../models/conversation.model");
          const ConvModel = getConversationModel(conn);
          const convIds = inboundAgg.map((r: any) => r._id);
          const convs = await ConvModel.find({ _id: { $in: convIds } }, { customerId: 1 }).lean();
          const convCustMap: Record<string, any> = {};
          convs.forEach((c: any) => { convCustMap[String(c._id)] = String(c.customerId); });

          const custIds = [...new Set(Object.values(convCustMap))];
          const custs = await CustModel.find({ _id: { $in: custIds } }, { firstName: 1, lastName: 1, phone: 1 }).lean();
          const custMap: Record<string, any> = {};
          custs.forEach((c: any) => { custMap[String(c._id)] = c; });

          const seen = new Set<string>();
          const ops: any[] = [];

          for (const agg of inboundAgg) {
            const custId = convCustMap[String(agg._id)];
            if (!custId) continue;
            const cust = custMap[custId];
            if (!cust?.phone || seen.has(cust.phone)) continue;
            seen.add(cust.phone);
            ops.push({
              insertOne: {
                document: {
                  tenantId: t._id,
                  customerPhone: cust.phone,
                  customerName: `${cust.firstName || ""} ${cust.lastName || ""}`.trim() || cust.phone,
                  lastCustomerMessageAt: agg.lastInboundAt,
                },
              },
            });
          }

          if (ops.length > 0) await ASModel.bulkWrite(ops);
          results[tenantName] = ops.length;
        } catch (tErr: any) {
          results[tenantName] = -1;
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
}
