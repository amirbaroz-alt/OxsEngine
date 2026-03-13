import type { Express } from "express";
import { tenantService } from "../services/tenant.service";
import { channelService } from "../services/channel.service";
import { auditLogService } from "../services/audit-log.service";
import { requireAuth, requireRole, requireTenant } from "../middleware/auth.middleware";
import { insertTenantSchema, customFieldDefinitionSchema } from "@shared/schema";
import { z } from "zod";
import { log } from "../index";

export function registerTenantRoutes(app: Express) {

  app.get("/api/tenants", async (_req, res) => {
    try {
      const tenants = await tenantService.getAll();
      res.json(tenants);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tenants/:id", async (req, res) => {
    try {
      const tenant = await tenantService.getById(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tenants/:id/reveal-secrets", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const tenant = await tenantService.getByIdDecrypted(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      const secrets: Record<string, Record<string, string>> = {};
      const paths: Record<string, string[]> = {
        smsConfig: ["accessToken"],
        mailConfig: ["sendGridKey"],
        whatsappConfig: ["accessToken", "verifyToken"],
        quotaGuardConfig: ["proxyUrl"],
      };
      for (const [configKey, fields] of Object.entries(paths)) {
        for (const field of fields) {
          const val = tenant[configKey]?.[field];
          if (val) {
            if (!secrets[configKey]) secrets[configKey] = {};
            secrets[configKey][field] = val;
          }
        }
      }
      res.json(secrets);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tenants", async (req, res) => {
    try {
      const data = insertTenantSchema.parse(req.body);
      const tenant = await tenantService.create(data);
      await auditLogService.log({ action: "CREATE", entityType: "Tenant", entityId: tenant._id as string, details: `Created tenant: ${tenant.nameEn}` });
      res.status(201).json(tenant);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "Slug already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/tenants/:id", async (req, res) => {
    try {
      const partialSchema = insertTenantSchema.partial();
      const data = partialSchema.parse(req.body);
      const tenant = await tenantService.update(req.params.id, data);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      await auditLogService.log({ action: "UPDATE", entityType: "Tenant", entityId: req.params.id, details: `Updated tenant: ${tenant.nameEn}` });
      res.json(tenant);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      if (error.code === 11000) {
        return res.status(409).json({ message: "Slug already exists" });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tenants/:id/customer-fields", requireAuth, async (req, res) => {
    try {
      const tenant = await tenantService.getById(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant.customerFields || []);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/tenants/:id/customer-fields", requireAuth, requireRole("superadmin", "businessadmin"), async (req, res) => {
    try {
      const fields = z.array(customFieldDefinitionSchema).parse(req.body);
      const tenant = await tenantService.update(req.params.id, { customerFields: fields } as any);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      await auditLogService.log({ action: "UPDATE", entityType: "Tenant", entityId: req.params.id, details: `Updated customer fields (${fields.length} fields)` });
      res.json(tenant.customerFields || []);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tenants/:id/busy-reasons", requireAuth, async (req, res) => {
    try {
      const tenant = await tenantService.getById(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      res.json(tenant.busyReasons || ["meeting", "training", "backoffice"]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/tenants/:id/busy-reasons", requireAuth, requireRole("superadmin", "businessadmin"), async (req, res) => {
    try {
      const reasons = z.array(z.string().min(1)).parse(req.body);
      const { TenantModel } = await import("../models/tenant.model");
      const tenant = await TenantModel.findByIdAndUpdate(
        req.params.id,
        { $set: { busyReasons: reasons } },
        { new: true }
      ).lean();
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });
      await auditLogService.log({ action: "UPDATE", entityType: "Tenant", entityId: req.params.id, details: `Updated busy reasons (${reasons.length} items)` });
      res.json(tenant.busyReasons || []);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors.map((e) => e.message).join(", ") });
      }
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { CustomerModel } = await import("../models/customer.model");
      const tenantId = req.query.tenantId as string;
      const search = req.query.search as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const filter: any = {};
      if (tenantId) filter.tenantId = tenantId;
      if (search) {
        filter.$or = [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }

      const [customers, total] = await Promise.all([
        CustomerModel.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        CustomerModel.countDocuments(filter),
      ]);

      res.json({ customers, total, page, totalPages: Math.ceil(total / limit) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { CustomerModel } = await import("../models/customer.model");
      const { ConversationModel } = await import("../models/conversation.model");

      const filter: any = { _id: req.params.id };
      const tenantId = req.query.tenantId as string;
      if (tenantId) filter.tenantId = tenantId;

      const customer = await CustomerModel.findOne(filter).lean();
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const conversations = await ConversationModel.find({ customerId: customer._id, tenantId: customer.tenantId })
        .sort({ lastMessageAt: -1 })
        .limit(10)
        .lean();

      res.json({ ...customer, conversations });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/customers/:id/assign-agent", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { CustomerModel } = await import("../models/customer.model");
      const { UserModel } = await import("../models/user.model");
      const tenantId = req.query.tenantId as string;

      const filter: any = { _id: req.params.id };
      if (tenantId) filter.tenantId = tenantId;

      const { agentId } = req.body;
      if (agentId) {
        const agent = await UserModel.findById(agentId).select("name").lean();
        if (!agent) return res.status(404).json({ message: "Agent not found" });
        const updated = await CustomerModel.findOneAndUpdate(
          filter,
          { $set: { assignedAgentId: agentId, assignedAgentName: agent.name } },
          { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Customer not found" });
        res.json(updated);
      } else {
        const updated = await CustomerModel.findOneAndUpdate(
          filter,
          { $unset: { assignedAgentId: 1, assignedAgentName: 1 } },
          { new: true }
        );
        if (!updated) return res.status(404).json({ message: "Customer not found" });
        res.json(updated);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers/:id/messages", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { MessageModel } = await import("../models/message.model");
      const { ConversationModel } = await import("../models/conversation.model");
      const { CustomerModel } = await import("../models/customer.model");

      const customerFilter: any = { _id: req.params.id };
      const tenantId = req.query.tenantId as string;
      if (tenantId) customerFilter.tenantId = tenantId;

      const customer = await CustomerModel.findOne(customerFilter).lean();
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const conversations = await ConversationModel.find({ customerId: customer._id, tenantId: customer.tenantId }).select("_id");
      const conversationIds = conversations.map((c: any) => c._id);

      const messages = await MessageModel.find({ conversationId: { $in: conversationIds } })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();

      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const channelCreateSchema = z.object({
    type: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
    name: z.string().min(1),
    phoneNumberId: z.string().nullable().optional(),
    wabaId: z.string().nullable().optional(),
    accessToken: z.string().nullable().optional(),
    verifyToken: z.string().nullable().optional(),
    smsUserName: z.string().nullable().optional(),
    smsSource: z.string().nullable().optional(),
    sendGridKey: z.string().nullable().optional(),
    fromEmail: z.string().nullable().optional(),
    fromName: z.string().nullable().optional(),
    teamIds: z.array(z.string()).optional(),
  });

  app.get("/api/channels", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string;
      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;

      if (userRole === "superadmin") {
        if (tenantId) {
          const channels = await channelService.getAllForTenant(tenantId);
          return res.json(channels);
        }
        const channels = await channelService.getAll();
        return res.json(channels);
      }

      if (userTenantId) {
        const channels = await channelService.getAllForTenant(String(userTenantId));
        return res.json(channels);
      }

      res.json([]);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const revealRateLimit = new Map<string, { count: number; resetAt: number }>();
  app.get("/api/channels/:id/reveal/:field", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const userId = String(req.user?._id || "");
      const now = Date.now();
      const entry = revealRateLimit.get(userId);
      if (entry && entry.resetAt > now) {
        if (entry.count >= 20) {
          return res.status(429).json({ message: "Too many reveal requests. Try again later." });
        }
        entry.count++;
      } else {
        revealRateLimit.set(userId, { count: 1, resetAt: now + 60_000 });
      }

      const { decryptChannelFields } = await import("../services/channel.service");
      const { ChannelModel } = await import("../models/channel.model");
      const allowedFields = ["accessToken", "verifyToken", "appSecret"];
      const { id, field } = req.params;
      if (!allowedFields.includes(field)) {
        return res.status(400).json({ message: "Invalid field" });
      }
      const channel = await ChannelModel.findById(id).lean();
      if (!channel) return res.status(404).json({ message: "Channel not found" });
      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(channel.tenantId) !== String(userTenantId)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const decrypted = decryptChannelFields(channel);
      const value = decrypted[field] || "";

      console.log(`[audit] User ${req.user?.email || userId} (${userRole}) revealed ${field} for channel ${id}`);

      res.json({ value });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/channels", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const parsed = channelCreateSchema.parse(req.body);
      const userRole = req.user?.role;
      const tenantId = req.query.tenantId as string || String(req.user?.tenantId || "");
      if (!tenantId) return res.status(400).json({ message: "tenantId required" });

      if (userRole !== "superadmin" && String(req.user?.tenantId) !== String(tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const channel = await channelService.create({ ...parsed, tenantId: tenantId as any });
      res.status(201).json(channel);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: error.errors });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/channels/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });

      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const body = { ...req.body };
      if (Array.isArray(body.teamIds)) {
        body.teamIds = [...new Set(body.teamIds)];
      }
      const updated = await channelService.update(req.params.id, body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/channels/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });

      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      await channelService.delete(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/channels/:id/activate", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });
      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const channel = await channelService.activate(req.params.id);
      res.json(channel);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/channels/:id/deactivate", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });
      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const channel = await channelService.deactivate(req.params.id);
      res.json(channel);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/channels/:id/logs", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const channel = await channelService.getById(req.params.id);
      if (!channel) return res.status(404).json({ message: "Channel not found" });

      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(channel.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const direction = req.query.direction as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const skip = (page - 1) * limit;

      const phoneNumberId = (channel as any).phoneNumberId;
      const tenantId = String(channel.tenantId);

      const filter: any = { tenantId };

      if (phoneNumberId) {
        if (direction === "inbound") {
          filter.sender = phoneNumberId;
          filter.direction = "inbound";
        } else if (direction === "outbound") {
          filter.direction = "outbound";
          filter.channel = "whatsapp";
        } else {
          filter.channel = "whatsapp";
          filter.$or = [
            { sender: phoneNumberId, direction: "inbound" },
            { direction: "outbound" },
          ];
        }
      } else {
        if (direction) filter.direction = direction;
      }

      const { CommunicationLogModel } = await import("../models/communication-log.model");
      const [logs, totalCount] = await Promise.all([
        CommunicationLogModel.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
        CommunicationLogModel.countDocuments(filter),
      ]);

      const { TenantModel } = await import("../models/tenant.model");
      const tenantDoc = await TenantModel.findById(tenantId).select("nameHe nameEn slug").lean();
      const tenantName = tenantDoc?.nameHe || tenantDoc?.nameEn || tenantDoc?.slug || tenantId;

      const allChannels = await channelService.getByTenant(tenantId);
      const phoneIdToChannel: Record<string, string> = {};
      for (const ch of allChannels) {
        const pid = (ch as any).phoneNumberId;
        if (pid) phoneIdToChannel[pid] = ch.name;
      }

      res.json({
        logs: logs.map((l: any) => ({
          _id: l._id,
          timestamp: l.timestamp,
          direction: l.direction,
          sender: l.sender,
          senderName: l.sender ? (phoneIdToChannel[l.sender] || l.sender) : undefined,
          recipient: l.recipient,
          content: l.content,
          status: l.status,
          channel: l.channel,
          messageType: l.messageType,
          tenantId: l.tenantId?.toString(),
          tenantName,
          messageId: l.messageId,
          errorMessage: l.errorMessage,
        })),
        totalCount,
        page,
        limit,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/channels/:id/test", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { testChannelConnectivity } = await import("../services/channel.service");
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });

      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const result = await testChannelConnectivity(req.params.id, String(existing.tenantId));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/channels/:id/clear-token-expired", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { clearChannelTokenExpired } = await import("../services/channel.service");
      const existing = await channelService.getById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Channel not found" });

      const userRole = req.user?.role;
      const userTenantId = req.user?.tenantId;
      if (userRole !== "superadmin" && String(userTenantId) !== String(existing.tenantId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      await clearChannelTokenExpired(req.params.id);
      log(`Channel ${req.params.id}: token expired flag cleared by ${req.user?.name || req.user?.userId}`, "channel");
      res.json({ success: true, message: "Token expired flag cleared" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/channels/migrate-from-tenant", requireAuth, requireRole("superadmin"), async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const { ChannelModel } = await import("../models/channel.model");
      const { decryptTenantSensitiveFields } = await import("../services/encryption.service");
      const { encryptChannelFields } = await import("../services/channel.service");

      const tenants = await TenantModel.find({
        "whatsappConfig.phoneNumberId": { $ne: null },
      }).lean();

      let migrated = 0;
      let skipped = 0;

      for (const tenant of tenants) {
        const decrypted = decryptTenantSensitiveFields(tenant);
        const wc = decrypted.whatsappConfig;
        if (!wc?.phoneNumberId) { skipped++; continue; }

        const existing = await ChannelModel.findOne({
          tenantId: tenant._id,
          type: "WHATSAPP",
          phoneNumberId: { $ne: null },
        }).lean();

        if (existing) {
          const { decryptChannelFields } = await import("../services/channel.service");
          const dec = decryptChannelFields(existing);
          if (dec.phoneNumberId === wc.phoneNumberId) {
            skipped++;
            continue;
          }
        }

        const channelData = encryptChannelFields({
          tenantId: tenant._id,
          type: "WHATSAPP",
          name: `WhatsApp ${tenant.nameEn || tenant.nameHe}`,
          phoneNumberId: wc.phoneNumberId,
          wabaId: wc.wabaId || null,
          accessToken: wc.accessToken || null,
          verifyToken: wc.verifyToken || null,
          status: wc.tokenExpiredAt ? "disconnected" : "active",
          tokenExpiredAt: wc.tokenExpiredAt || null,
        });

        await ChannelModel.create(channelData);
        migrated++;
      }

      res.json({ migrated, skipped, total: tenants.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/teams", requireAuth, requireTenant, async (req, res) => {
    try {
      const { TeamModel } = await import("../models/team.model");
      const tenantId = req.query.tenantId as string;
      const filter: any = {};
      if (tenantId) filter.tenantId = tenantId;
      const teams = await TeamModel.find(filter).sort({ name: 1 }).lean();
      res.json(teams);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/teams", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { TeamModel } = await import("../models/team.model");
      const tenantId = req.query.tenantId || req.body.tenantId;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const { name, description, color, managerId, managerIds } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });
      const team = await TeamModel.create({ tenantId, name: name.trim(), description: description?.trim() || "", color: color || "#6B7280", ...(managerId ? { managerId } : {}), managerIds: managerIds || [] });
      res.status(201).json(team);
    } catch (error: any) {
      if (error.code === 11000) return res.status(409).json({ message: "Team already exists" });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/teams/:id", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { TeamModel } = await import("../models/team.model");
      const { name, description, color, active, managerId, managerIds } = req.body;
      const update: any = {};
      if (name !== undefined) update.name = name.trim();
      if (description !== undefined) update.description = description.trim();
      if (color !== undefined) update.color = color;
      if (active !== undefined) update.active = active;
      if (managerId !== undefined) update.managerId = managerId || null;
      if (managerIds !== undefined) update.managerIds = managerIds;
      const team = await TeamModel.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
      if (!team) return res.status(404).json({ message: "Team not found" });
      res.json(team);
    } catch (error: any) {
      if (error.code === 11000) return res.status(409).json({ message: "Team name already exists" });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/teams/:id", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { TeamModel } = await import("../models/team.model");
      const team = await TeamModel.findByIdAndDelete(req.params.id);
      if (!team) return res.status(404).json({ message: "Team not found" });
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tags", requireAuth, requireTenant, async (req, res) => {
    try {
      const { TagModel } = await import("../models/tag.model");
      const tenantId = req.query.tenantId as string;
      const scope = (req.query.scope as string) || "conversation";
      const teamIds = req.query.teamIds as string | undefined;
      const filter: any = { scope };
      if (tenantId) filter.tenantId = tenantId;
      if (teamIds && tenantId) {
        const ids = teamIds.split(",").filter(Boolean);
        if (ids.length > 0) filter.$or = [{ teamId: { $in: ids } }, { teamId: { $exists: false } }, { teamId: null }];
      } else if (req.query.teamId) {
        filter.teamId = req.query.teamId;
      }
      const tags = await TagModel.find(filter).sort({ name: 1 }).lean();
      res.json(tags);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tags", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { TagModel } = await import("../models/tag.model");
      const tenantId = req.query.tenantId || req.body.tenantId;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const { name, color, scope, teamId } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });
      const tag = await TagModel.create({
        tenantId,
        teamId: teamId || undefined,
        name: name.trim(),
        color: color || "#6B7280",
        scope: scope || "conversation",
      });
      res.status(201).json(tag);
    } catch (error: any) {
      if (error.code === 11000) return res.status(409).json({ message: "Tag already exists" });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/tags/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { TagModel } = await import("../models/tag.model");
      const { name, color, teamId } = req.body;
      const update: any = {};
      if (name !== undefined) update.name = name.trim();
      if (color !== undefined) update.color = color;
      if (teamId !== undefined) update.teamId = teamId || null;
      const tag = await TagModel.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
      if (!tag) return res.status(404).json({ message: "Tag not found" });
      res.json(tag);
    } catch (error: any) {
      if (error.code === 11000) return res.status(409).json({ message: "Tag name already exists" });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/tags/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { TagModel } = await import("../models/tag.model");
      const tag = await TagModel.findByIdAndDelete(req.params.id);
      if (!tag) return res.status(404).json({ message: "Tag not found" });
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/quick-replies", requireAuth, requireTenant, async (req, res) => {
    try {
      const { QuickReplyModel } = await import("../models/quickReply.model");
      const tenantId = req.query.tenantId as string;
      const filter: any = {};
      if (tenantId) filter.tenantId = tenantId;
      const replies = await QuickReplyModel.find(filter).sort({ category: 1, title: 1 }).lean();
      res.json(replies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/quick-replies", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { QuickReplyModel } = await import("../models/quickReply.model");
      const tenantId = req.query.tenantId || req.body.tenantId;
      if (!tenantId) return res.status(400).json({ message: "tenantId is required" });
      const { title, content, category } = req.body;
      if (!title?.trim() || !content?.trim()) return res.status(400).json({ message: "title and content are required" });
      const reply = await QuickReplyModel.create({
        tenantId,
        title: title.trim(),
        content: content.trim(),
        category: category?.trim() || "general",
        createdBy: req.user?._id,
      });
      res.status(201).json(reply);
    } catch (error: any) {
      if (error.code === 11000) return res.status(409).json({ message: "Quick reply with this title already exists" });
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/quick-replies/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { QuickReplyModel } = await import("../models/quickReply.model");
      const { title, content, category } = req.body;
      const update: any = {};
      if (title?.trim()) update.title = title.trim();
      if (content?.trim()) update.content = content.trim();
      if (category !== undefined) update.category = category?.trim() || "general";
      const reply = await QuickReplyModel.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!reply) return res.status(404).json({ message: "Quick reply not found" });
      res.json(reply);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/quick-replies/:id", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, async (req, res) => {
    try {
      const { QuickReplyModel } = await import("../models/quickReply.model");
      const reply = await QuickReplyModel.findByIdAndDelete(req.params.id);
      if (!reply) return res.status(404).json({ message: "Quick reply not found" });
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/tenants/:id/sla", requireAuth, requireRole("superadmin", "businessadmin"), async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const tenant = await TenantModel.findById(req.params.id);
      if (!tenant) return res.status(404).json({ message: "Tenant not found" });

      const { responseTimeMinutes, warningTimeMinutes, enabled } = req.body;
      if (!tenant.slaConfig) {
        (tenant as any).slaConfig = { responseTimeMinutes: 15, warningTimeMinutes: 10, enabled: false };
      }
      if (typeof responseTimeMinutes === "number") (tenant as any).slaConfig.responseTimeMinutes = responseTimeMinutes;
      if (typeof warningTimeMinutes === "number") (tenant as any).slaConfig.warningTimeMinutes = warningTimeMinutes;
      if (typeof enabled === "boolean") (tenant as any).slaConfig.enabled = enabled;
      await tenant.save();

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: req.params.id,
        action: "UPDATE_SLA",
        entityType: "Tenant",
        entityId: req.params.id,
        details: `SLA config updated: response=${(tenant as any).slaConfig.responseTimeMinutes}min, warning=${(tenant as any).slaConfig.warningTimeMinutes}min, enabled=${(tenant as any).slaConfig.enabled}`,
      });

      res.json(tenant.slaConfig);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/teams/:id/manager", requireAuth, requireRole("superadmin", "businessadmin"), requireTenant, async (req, res) => {
    try {
      const { TeamModel } = await import("../models/team.model");
      const { managerId } = req.body;

      const team = await TeamModel.findByIdAndUpdate(
        req.params.id,
        { managerId: managerId || null },
        { new: true }
      ).lean();
      if (!team) return res.status(404).json({ message: "Team not found" });
      res.json(team);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
