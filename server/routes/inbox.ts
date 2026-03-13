import type { Express } from "express";
import { whatsappService } from "../services/whatsapp.service";
import { userService } from "../services/user.service";
import { auditLogService } from "../services/audit-log.service";
import { requireAuth, requireRole, requireTenant, requireTenantDb } from "../middleware/auth.middleware";
import { MEDIA_SIZE_LIMITS as MEDIA_LIMITS_MAP, MEDIA_SIZE_DEFAULT } from "../lib/constants/limits";
const DOCUMENT_LIMIT_BYTES = 100 * 1024 * 1024;
import { getMessageModel } from "../models/message.model";
import { getConversationModel } from "../models/conversation.model";
import { getCustomerModel } from "../models/customer.model";

async function resolveRecipientPhone(
  customer: { _id: any; phone?: string; firstName?: string } | null,
  conversationId: string,
  MessageModel: any,
  CustomerModel: any,
): Promise<string | null> {
  if (customer?.phone) {
    if (customer.firstName && customer.firstName.toLowerCase().includes("unknown")) {
      console.log(`[DeepClean] Sanitized Customer ID: ${customer._id} - Name "${customer.firstName}" set to ${customer.phone}`);
      CustomerModel.updateOne({ _id: customer._id }, { $set: { firstName: customer.phone, lastName: "" } }).catch(() => {});
    }
    return customer.phone;
  }

  const lastInbound = await MessageModel.findOne(
    { conversationId, direction: "INBOUND", "metadata.waMessageId": { $exists: true } },
    { metadata: 1 },
  ).sort({ createdAt: -1 }).lean();

  const waFrom = lastInbound?.metadata?.waFrom || lastInbound?.metadata?.senderPhone;
  if (waFrom) {
    console.log(`[resolve-phone] Resolved phone from inbound message metadata: ${waFrom} (conv=${conversationId})`);
    if (customer && CustomerModel) {
      await CustomerModel.updateOne({ _id: customer._id, $or: [{ phone: null }, { phone: "" }, { phone: { $exists: false } }] }, { $set: { phone: waFrom } });
    }
    return waFrom;
  }

  const waMessageId = lastInbound?.metadata?.waMessageId;
  if (waMessageId) {
    const { SystemAuditLogModel } = await import("../models/SystemAuditLog");
    const auditTrace = await SystemAuditLogModel.findOne(
      { whatsappMessageId: waMessageId, direction: "INBOUND", senderPhone: { $exists: true, $ne: null } },
      { senderPhone: 1 },
    ).lean();

    if (auditTrace?.senderPhone) {
      console.log(`[resolve-phone] Resolved phone from audit log (waMessageId=${waMessageId}): ${auditTrace.senderPhone} (conv=${conversationId})`);
      if (customer && CustomerModel) {
        await CustomerModel.updateOne({ _id: customer._id, $or: [{ phone: null }, { phone: "" }, { phone: { $exists: false } }] }, { $set: { phone: auditTrace.senderPhone } });
      }
      return auditTrace.senderPhone;
    }
  }

  console.warn(`[resolve-phone] Could not resolve phone for conversation ${conversationId}`);
  return null;
}

export function registerInboxRoutes(app: Express) {

  app.get("/api/active-sessions", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.json([]);

      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const convFilter: any = {
        tenantId,
        lastMessageAt: { $gte: cutoff },
        status: { $nin: ["RESOLVED", "SPAM"] },
      };

      const convs = await ConversationModel.find(convFilter)
        .sort({ lastMessageAt: -1 })
        .limit(200)
        .select("customerId lastMessageAt lastInboundAt tenantId")
        .lean();

      if (convs.length === 0) return res.json([]);

      const customerIds = [...new Set(convs.map((c: any) => String(c.customerId)).filter(Boolean))];
      const customers = await CustomerModel.find({ _id: { $in: customerIds } })
        .select("firstName lastName phone")
        .lean();
      const customerMap = new Map(customers.map((c: any) => [String(c._id), c]));

      const searchQuery = req.query.searchQuery as string | undefined;
      const stripped = searchQuery ? searchQuery.replace(/[-\s]/g, "") : "";
      const searchRegex = stripped ? new RegExp(stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

      const sessions: any[] = [];
      const seenPhones = new Set<string>();
      for (const conv of convs) {
        const cust = customerMap.get(String((conv as any).customerId));
        const phone = (cust as any)?.phone || "";
        const name = cust
          ? ([(cust as any).firstName, (cust as any).lastName].filter(Boolean).join(" ").trim() || phone || "Unknown")
          : "Unknown";

        const dedupeKey = phone || String((conv as any)._id);
        if (seenPhones.has(dedupeKey)) continue;

        if (searchRegex) {
          const normalizedPhone = phone ? phone.replace(/[-\s]/g, "") : "";
          const localPhone = phone.startsWith("972") ? "0" + phone.slice(3) : "";
          const normalizedLocal = localPhone.replace(/[-\s]/g, "");
          if (!searchRegex.test(name) && !searchRegex.test(normalizedPhone) && !searchRegex.test(phone) && !searchRegex.test(localPhone) && !searchRegex.test(normalizedLocal)) continue;
        }

        seenPhones.add(dedupeKey);
        sessions.push({
          _id: String((conv as any)._id),
          tenantId: String(tenantId),
          customerPhone: phone,
          customerName: name,
          lastCustomerMessageAt: (conv as any).lastInboundAt || (conv as any).lastMessageAt,
        });
      }

      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inbox/channel-types", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, async (req, res) => {
    try {
      const { ChannelModel } = await import("../models/channel.model");
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.json([]);
      const types = await ChannelModel.distinct("type", { tenantId, status: "active" });
      res.json(types);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inbox/conversations/tab-counts", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const tenantId = req.query.tenantId as string;
      const agentId = req.query.agentId as string;
      const isAllAgents = agentId === "__all__" && (req.user?.role === "superadmin" || req.user?.role === "businessadmin");
      const base: any = {};
      if (tenantId) base.tenantId = tenantId;
      const targetUserId = isAllAgents ? undefined : (agentId === "__all__" ? req.user?._id : (agentId || req.user?._id));

      const [mine, pool, closed, spam, snoozed] = await Promise.all([
        isAllAgents
          ? ConversationModel.countDocuments({ ...base, assignedTo: { $exists: true }, status: "ACTIVE" })
          : ConversationModel.countDocuments({ ...base, assignedTo: targetUserId, status: "ACTIVE" }),
        ConversationModel.countDocuments({ ...base, assignedTo: { $exists: false }, status: { $in: ["UNASSIGNED", "OPEN"] } }),
        ConversationModel.countDocuments({ ...base, status: "RESOLVED" }),
        ConversationModel.countDocuments({ ...base, status: "SPAM" }),
        isAllAgents
          ? ConversationModel.countDocuments({ ...base, status: "SNOOZED" })
          : ConversationModel.countDocuments({ ...base, status: "SNOOZED", $or: [{ snoozedBy: targetUserId }, { snoozedBy: null, assignedTo: targetUserId }] }),
      ]);
      res.json({ mine, pool, closed, spam, snoozed });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/inbox/conversations", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const tenantId = req.query.tenantId as string;
      const tab = req.query.tab as string;
      const status = (req.query.status as string) || "";
      const search = req.query.search as string;
      const channels = (req.query.channels as string) || "";
      const statuses = (req.query.statuses as string) || "";
      const tags = (req.query.tags as string) || "";
      const starred = req.query.starred as string;
      const agentId = req.query.agentId as string;
      const isAllAgents = agentId === "__all__" && (req.user?.role === "superadmin" || req.user?.role === "businessadmin");
      const targetUserId = isAllAgents ? undefined : (agentId === "__all__" ? req.user?._id : (agentId || req.user?._id));

      const filter: any = {};
      if (tenantId) filter.tenantId = tenantId;
      if (starred === "true") filter.starred = true;

      const userId = String(req.user?._id || "");
      const userRole = req.user?.role;
      const userTeamIds = (req.user as any)?.teamIds || [];

      let isTeamLeader = false;
      let leaderChannelIds: any[] = [];
      if (userRole !== "superadmin" && userRole !== "businessadmin" && userTeamIds.length > 0) {
        const { TeamModel } = await import("../models/team.model");
        const { ChannelModel } = await import("../models/channel.model");
        const leaderTeams = await TeamModel.find({
          tenantId,
          managerIds: userId,
        }).select("_id").lean();
        if (leaderTeams.length > 0) {
          isTeamLeader = true;
          const leaderTeamIdStrings = leaderTeams.map((t: any) => String(t._id));
          const leaderChannels = await ChannelModel.find({
            tenantId,
            isActive: { $ne: false },
            teamIds: { $in: leaderTeamIdStrings },
          }).select("_id").lean();
          leaderChannelIds = leaderChannels.map((ch: any) => ch._id);
        }
      }

      if (tab === "mine") {
        if (isAllAgents) {
          filter.assignedTo = { $exists: true };
        } else {
          filter.assignedTo = targetUserId;
        }
        if (statuses) {
          filter.status = { $in: statuses.split(",") };
        } else {
          filter.status = "ACTIVE";
        }
      } else if (tab === "pool") {
        if (statuses) {
          filter.status = { $in: statuses.split(",") };
        } else {
          filter.status = { $in: ["UNASSIGNED", "OPEN", "ACTIVE"] };
        }
        if (isTeamLeader && leaderChannelIds.length > 0) {
          filter.$or = [
            { assignedTo: { $exists: false }, channelId: { $in: leaderChannelIds } },
            { channelId: { $in: leaderChannelIds } },
          ];
        } else {
          filter.assignedTo = { $exists: false };
        }
        if (userRole !== "superadmin" && userRole !== "businessadmin") {
          const { ChannelModel } = await import("../models/channel.model");

          const channelsWithoutTeams = await ChannelModel.find({
            tenantId: tenantId,
            isActive: { $ne: false },
            $or: [{ teamIds: { $exists: false } }, { teamIds: { $size: 0 } }],
          }).select("_id").lean();
          const noTeamChannelIds = channelsWithoutTeams.map((ch: any) => ch._id);

          if (userTeamIds.length > 0) {
            const channelsWithTeams = await ChannelModel.find({
              tenantId: tenantId,
              isActive: { $ne: false },
              teamIds: { $exists: true, $not: { $size: 0 } },
            }).select("_id teamIds").lean();

            const allowedChannelIds = channelsWithTeams
              .filter((ch: any) => {
                const chTeams = (ch.teamIds || []).map((t: any) => String(t));
                return userTeamIds.some((ut: string) => chTeams.includes(String(ut)));
              })
              .map((ch: any) => ch._id);

            if (isTeamLeader && leaderChannelIds.length > 0) {
              const allAllowed = [...new Set([...allowedChannelIds.map(String), ...noTeamChannelIds.map(String), ...leaderChannelIds.map(String)])];
              if (filter.$or) {
                filter.$or = filter.$or.map((cond: any) => ({ ...cond, channelId: { $in: allAllowed } }));
              } else {
                filter.channelId = { $in: allAllowed };
              }
            } else {
              filter.channelId = { $in: [...allowedChannelIds, ...noTeamChannelIds] };
            }
          } else {
            filter.channelId = { $in: noTeamChannelIds };
          }
        }
      } else if (tab === "others") {
        filter.assignedTo = isAllAgents ? { $exists: true } : { $exists: true, $ne: targetUserId };
        if (statuses) {
          filter.status = { $in: statuses.split(",") };
        } else {
          filter.status = "ACTIVE";
        }
      } else if (tab === "closed") {
        if (statuses) {
          filter.status = { $in: statuses.split(",") };
        } else {
          filter.status = "RESOLVED";
        }
      } else if (tab === "snoozed") {
        filter.status = "SNOOZED";
        if (!isAllAgents) {
          filter.$or = [{ snoozedBy: targetUserId }, { snoozedBy: null, assignedTo: targetUserId }];
        }
      } else if (tab === "spam") {
        filter.status = "SPAM";
      } else if (statuses) {
        filter.status = { $in: statuses.split(",") };
      } else if (status) {
        const statusList = status.split(",");
        const mappedStatuses = new Set<string>();
        for (const s of statusList) {
          mappedStatuses.add(s);
          if (s === "OPEN") mappedStatuses.add("UNASSIGNED");
          if (s === "PENDING") mappedStatuses.add("SNOOZED");
        }
        filter.status = { $in: Array.from(mappedStatuses) };
      } else {
        filter.status = { $in: ["UNASSIGNED", "ACTIVE", "SNOOZED", "OPEN", "PENDING"] };
      }

      if (channels) {
        filter.channel = { $in: channels.split(",") };
      }

      if (tags) {
        filter.tags = { $in: tags.split(",") };
      }

      if (search) {
        const searchTerm = search.trim();
        const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const orConditions: any[] = [];

        const digitsOnly = searchTerm.replace(/\D/g, "");
        const phoneVariants: any[] = [{ phone: { $regex: escaped, $options: "i" } }];
        if (digitsOnly.startsWith("0") && digitsOnly.length >= 9) {
          const intl = "972" + digitsOnly.slice(1);
          phoneVariants.push({ phone: { $regex: intl, $options: "i" } });
        } else if (digitsOnly.startsWith("972") && digitsOnly.length >= 12) {
          const local = "0" + digitsOnly.slice(3);
          phoneVariants.push({ phone: { $regex: local, $options: "i" } });
        }
        if (digitsOnly.length >= 4) {
          phoneVariants.push({ phone: { $regex: digitsOnly, $options: "i" } });
        }
        const customers = await CustomerModel.find({
          ...(tenantId ? { tenantId } : {}),
          $or: [
            { firstName: { $regex: escaped, $options: "i" } },
            { lastName: { $regex: escaped, $options: "i" } },
            ...phoneVariants,
            { crmId: { $regex: escaped, $options: "i" } },
          ],
        }).select("_id").lean();
        const customerIds = customers.map((c: any) => c._id);
        if (customerIds.length > 0) {
          orConditions.push({ customerId: { $in: customerIds } });
        }

        orConditions.push({ assignedName: { $regex: escaped, $options: "i" } });

        const mongoose = (await import("mongoose")).default;
        if (mongoose.Types.ObjectId.isValid(searchTerm) && searchTerm.length === 24) {
          orConditions.push({ _id: new mongoose.Types.ObjectId(searchTerm) });
        }

        if (orConditions.length > 0) {
          filter.$or = orConditions;
        } else {
          return res.json([]);
        }
      }

      const conversations = await ConversationModel.find(filter)
        .sort({ starred: -1, lastMessageAt: -1 })
        .limit(100)
        .lean();

      const customerIds = [...new Set(conversations.map((c: any) => String(c.customerId)))];
      const customersResult = await CustomerModel.find({ _id: { $in: customerIds } }).lean();
      const customerMap: Record<string, any> = {};
      customersResult.forEach((c: any) => { customerMap[String(c._id)] = c; });

      const { ChannelModel } = await import("../models/channel.model");
      const channelIds = [...new Set(conversations.map((c: any) => c.channelId).filter(Boolean))];
      const channelPhoneMap: Record<string, string> = {};
      if (channelIds.length > 0) {
        const channels = await ChannelModel.find({ _id: { $in: channelIds } }).select("_id phoneNumberId").lean();
        channels.forEach((ch: any) => { if (ch.phoneNumberId) channelPhoneMap[String(ch._id)] = ch.phoneNumberId; });
      }

      const convIds = conversations.map((c: any) => c._id);
      const lastMessages = await MessageModel.aggregate([
        { $match: { conversationId: { $in: convIds }, isInternal: { $ne: true } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: "$conversationId", lastMsg: { $first: "$$ROOT" } } },
      ]);
      const lastMsgMap: Record<string, any> = {};
      lastMessages.forEach((m: any) => { lastMsgMap[String(m._id)] = m.lastMsg; });

      const convsToBackfill = conversations.filter((c: any) => !c.lastInboundAt);
      if (convsToBackfill.length > 0) {
        const backfillConvIds = convsToBackfill.map((c: any) => c._id);
        const lastInbounds = await MessageModel.aggregate([
          { $match: { conversationId: { $in: backfillConvIds }, direction: "INBOUND" } },
          { $sort: { createdAt: -1 } },
          { $group: { _id: "$conversationId", lastInbound: { $first: "$$ROOT" } } },
        ]);
        for (const li of lastInbounds) {
          await ConversationModel.updateOne(
            { _id: li._id },
            { $set: { lastInboundAt: li.lastInbound.createdAt } }
          );
          const conv = conversations.find((c: any) => String(c._id) === String(li._id));
          if (conv) (conv as any).lastInboundAt = li.lastInbound.createdAt;
        }
      }

      const customerCountMap: Record<string, number> = {};
      if (customerIds.length > 0) {
        const mongoose = (await import("mongoose")).default;
        const countMatch: any = { customerId: { $in: customerIds.map((id: string) => new mongoose.Types.ObjectId(id)) } };
        if (tenantId) countMatch.tenantId = new mongoose.Types.ObjectId(tenantId);
        const customerConvCounts = await ConversationModel.aggregate([
          { $match: countMatch },
          { $group: { _id: "$customerId", count: { $sum: 1 } } },
        ]);
        customerConvCounts.forEach((c: any) => { customerCountMap[String(c._id)] = c.count; });
      }

      const result = conversations.map((conv: any) => ({
        ...conv,
        customer: customerMap[String(conv.customerId)] || null,
        lastMessage: lastMsgMap[String(conv._id)] || null,
        customerConversationCount: customerCountMap[String(conv.customerId)] || 1,
        channelPhoneNumberId: conv.channelId ? channelPhoneMap[String(conv.channelId)] || null : null,
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/conversations/:id/messages", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const ConversationModel = getConversationModel(req.tenantDbConnection!);

      const conv = await ConversationModel.findById(req.params.id).lean();
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const query: Record<string, any> = { conversationId: req.params.id };
      const since = req.query.since as string;
      if (since) {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          query.createdAt = { $gt: sinceDate };
        }
      }

      const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "FILE", "STICKER"]);
      const enrichMessages = (msgs: any[]) => msgs.map((m: any) => {
        const hasMedia = MEDIA_TYPES.has(m.type) && !!(m.metadata?.mimeType || m.metadata?.mediaInfo?.mimeType);
        return { ...m, hasMedia };
      });

      if (since) {
        const messages = await MessageModel.find(query)
          .sort({ createdAt: -1 })
          .limit(500)
          .select("-metadata.base64 -metadata.mediaInfo.base64")
          .lean();
        messages.reverse();
        return res.json(enrichMessages(messages));
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const skip = (page - 1) * limit;

      const [messages, totalCount] = await Promise.all([
        MessageModel.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("-metadata.base64 -metadata.mediaInfo.base64")
          .lean(),
        MessageModel.countDocuments(query),
      ]);

      messages.reverse();

      res.json({ messages: enrichMessages(messages), totalCount, page, limit });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/messages/media-batch", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) {
        return res.status(400).json({ message: "Provide 1-20 message IDs" });
      }
      const query: Record<string, any> = { _id: { $in: ids } };
      if (req.user?.role !== "superadmin") {
        query.tenantId = req.user?.tenantId;
      }
      const msgs = await MessageModel.find(query)
        .select("_id metadata.mediaKey metadata.base64 metadata.mediaInfo.base64 metadata.mimeType metadata.mediaInfo.mimeType metadata.fileName metadata.mediaInfo.fileName")
        .lean();
      const result: Record<string, any> = {};
      for (const msg of msgs) {
        const md = msg.metadata as any;
        const mimeType = md?.mimeType || md?.mediaInfo?.mimeType || "application/octet-stream";
        const fileName = md?.fileName || md?.mediaInfo?.fileName || null;
        if (md?.mediaKey) {
          result[String(msg._id)] = { useStream: true, mimeType, fileName };
          continue;
        }
        const base64 = md?.base64 || md?.mediaInfo?.base64 || null;
        if (base64) {
          result[String(msg._id)] = { base64, mimeType, fileName };
        }
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/messages/:id/media", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const query: Record<string, any> = { _id: req.params.id };
      const user = (req as any).user;
      if (user?.role !== "superadmin") {
        query.tenantId = user?.tenantId;
      }
      const msg = await MessageModel.findOne(query).select("metadata.mediaKey metadata.base64 metadata.mediaInfo.base64 metadata.mimeType metadata.mediaInfo.mimeType metadata.fileName metadata.mediaInfo.fileName").lean();
      if (!msg) return res.status(404).json({ message: "Message not found" });
      const md = msg.metadata as any;
      const mimeType = md?.mimeType || md?.mediaInfo?.mimeType || "application/octet-stream";
      const fileName = md?.fileName || md?.mediaInfo?.fileName || null;
      if (md?.mediaKey) {
        return res.json({ useStream: true, mimeType, fileName });
      }
      const base64 = md?.base64 || md?.mediaInfo?.base64 || null;
      if (!base64) return res.status(404).json({ message: "No media data" });
      res.json({ base64, mimeType, fileName });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/messages/:id/media/stream", async (req, res, next) => {
    if (!req.headers.authorization && req.query.token) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  }, requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      if (req.headers["if-none-match"] === `"${req.params.id}"`) {
        return res.status(304).end();
      }
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const query: Record<string, any> = { _id: req.params.id };
      if (req.user?.role !== "superadmin" && req.user?.tenantId) {
        query.tenantId = req.user.tenantId;
      }
      console.log(`[media-stream] Request for message ${req.params.id}, query:`, JSON.stringify(query));
      const msg = await MessageModel.findOne(query)
        .select("tenantId channelId createdAt metadata.mediaKey metadata.base64 metadata.mediaInfo.base64 metadata.mimeType metadata.mediaInfo.mimeType metadata.fileName metadata.mediaInfo.fileName metadata.mediaStatus metadata.mediaInfo.mediaId")
        .lean();
      if (!msg) {
        console.warn(`[media-stream] 404 Message not found: ${req.params.id}, query: ${JSON.stringify(query)}`);
        return res.status(404).json({ error: "not_found", message: `Message not found (id=${req.params.id})` });
      }
      const md = msg.metadata as any;
      const mediaKey = md?.mediaKey || null;
      const base64 = md?.base64 || md?.mediaInfo?.base64 || null;
      const mimeType = md?.mimeType || md?.mediaInfo?.mimeType || "application/octet-stream";
      const fileName = md?.fileName || md?.mediaInfo?.fileName || "file";
      const safeDisposition = (() => {
        const ascii = fileName.replace(/[^\x20-\x7E]/g, "_");
        const encoded = encodeURIComponent(fileName);
        if (ascii === fileName) return `inline; filename="${fileName}"`;
        return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
      })();
      console.log(`[media-stream] Message ${req.params.id}: mediaKey=${mediaKey || "none"}, hasBase64=${!!base64}, mimeType=${mimeType}, mediaStatus=${md?.mediaStatus || "n/a"}, mediaId=${md?.mediaInfo?.mediaId || "n/a"}`);

      let minioMissing = false;
      if (mediaKey) {
        try {
          const { getObject, objectExists } = await import("../services/storage.service");
          if (await objectExists(mediaKey)) {
            console.log(`[media-stream] Proxying ${req.params.id} from MinIO key=${mediaKey}`);
            const obj = await getObject(mediaKey);
            res.setHeader("Content-Type", obj.contentType || mimeType);
            if (obj.contentLength) res.setHeader("Content-Length", obj.contentLength);
            res.setHeader("Content-Disposition", safeDisposition);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
            res.setHeader("ETag", `"${req.params.id}"`);
            if (req.headers["if-none-match"] === `"${req.params.id}"`) {
              return res.status(304).end();
            }
            if (obj.body && typeof obj.body.pipe === "function") {
              obj.body.pipe(res);
            } else if (obj.body && typeof obj.body.transformToByteArray === "function") {
              const bytes = await obj.body.transformToByteArray();
              const buffer = Buffer.from(bytes);
              const range = req.headers.range;
              if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = Math.min(parts[1] ? parseInt(parts[1], 10) : buffer.length - 1, buffer.length - 1);
                if (isNaN(start) || isNaN(end) || start < 0 || start >= buffer.length || end < start) {
                  res.status(416).setHeader("Content-Range", `bytes */${buffer.length}`).send();
                  return;
                }
                res.status(206);
                res.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
                res.setHeader("Content-Length", end - start + 1);
                res.send(buffer.subarray(start, end + 1));
              } else {
                res.send(buffer);
              }
            } else {
              res.status(500).json({ error: "stream_error", message: "Cannot read MinIO object" });
            }
            return;
          }
          console.warn(`[media-stream] mediaKey ${mediaKey} not found in MinIO for ${req.params.id}, will attempt re-download`);
          minioMissing = true;
        } catch (storageErr: any) {
          console.warn(`[media-stream] MinIO proxy failed for ${req.params.id}: ${storageErr.message}`);
          minioMissing = true;
        }
      }

      if (base64) {
        const buffer = Buffer.from(base64, "base64");
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Content-Disposition", safeDisposition);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.setHeader("ETag", `"${req.params.id}"`);
        if (req.headers["if-none-match"] === `"${req.params.id}"`) {
          return res.status(304).end();
        }
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = Math.min(parts[1] ? parseInt(parts[1], 10) : buffer.length - 1, buffer.length - 1);
          if (isNaN(start) || isNaN(end) || start < 0 || start >= buffer.length || end < start) {
            res.status(416).setHeader("Content-Range", `bytes */${buffer.length}`).send();
            return;
          }
          res.status(206);
          res.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
          res.setHeader("Content-Length", end - start + 1);
          res.send(buffer.subarray(start, end + 1));
        } else {
          res.send(buffer);
        }
        return;
      }

      const mediaStatus = md?.mediaStatus || "unknown";
      const mediaId = md?.mediaInfo?.mediaId;
      if (mediaStatus === "pending") {
        const msgCreatedAt = (msg as any).createdAt ? new Date((msg as any).createdAt).getTime() : 0;
        const ageMs = Date.now() - msgCreatedAt;
        const STALE_THRESHOLD_MS = 10_000;
        if (ageMs < STALE_THRESHOLD_MS) {
          console.log(`[media-stream] 202 pending for ${req.params.id} (age=${Math.round(ageMs / 1000)}s, waiting for deferred download)`);
          return res.status(202).json({ error: "pending", message: "Media is still being downloaded" });
        }
        console.log(`[media-stream] Stale pending for ${req.params.id} (age=${Math.round(ageMs / 1000)}s), will attempt re-download`);
      }
      if (mediaId && (mediaStatus !== "completed" || minioMissing)) {
        console.log(`[media-stream] Attempting re-download for ${req.params.id}, mediaId=${mediaId}, reason=${minioMissing ? "minio_missing" : mediaStatus}`);
        try {
          const { whatsappService } = await import("../services/whatsapp.service");
          const { ChannelModel } = await import("../models/channel.model");
          const { decryptChannelFields } = await import("../services/channel.service");
          const msgTenantId = String((msg as any).tenantId);
          const channelId = (msg as any).channelId;
          const channel = channelId ? await ChannelModel.findById(channelId).lean() : null;
          const decrypted = channel ? decryptChannelFields(channel) : null;
          const accessToken = decrypted?.accessToken;
          if (!accessToken) {
            console.warn(`[media-stream] No channel credentials for ${req.params.id}, channelId=${channelId}, tenantId=${msgTenantId}`);
            return res.status(404).json({ error: "no_media", message: `Media data unavailable - no channel credentials (channelId=${channelId})`, mediaStatus });
          }
          const tokenCheck = await whatsappService.validateMediaToken(accessToken, msgTenantId);
          if (tokenCheck.status === "expired") {
            console.error(`[media-stream] CRITICAL: TOKEN_EXPIRED — pre-check failed for ${req.params.id}: ${tokenCheck.error}`);
            await whatsappService.flagTokenExpired(msgTenantId);
            await MessageModel.findOneAndUpdate(
              { _id: req.params.id },
              { $set: { "metadata.mediaStatus": "failed_auth" } },
            );
            return res.status(404).json({ error: "token_expired", message: "Media unavailable - channel access token expired", mediaStatus: "failed_auth" });
          }
          if (tokenCheck.status === "unknown") {
            console.warn(`[media-stream] Token pre-check inconclusive for ${req.params.id}: ${tokenCheck.error} — proceeding with download attempt`);
          }
          if (tokenCheck.status === "valid" && channel?.tokenExpiredAt) {
            const { clearChannelTokenExpired } = await import("../services/channel.service");
            await clearChannelTokenExpired(String(channel._id));
            console.log(`[media-stream] Cleared stale tokenExpiredAt for channel ${channel._id}`);
          }
          const downloaded = await whatsappService.downloadMediaAsBuffer(mediaId, accessToken, msgTenantId);
          if (downloaded) {
            let finalBuffer = downloaded.buffer;
            let finalMimeType = downloaded.mimeType;

            if (finalMimeType.startsWith("video/")) {
              try {
                const { processVideoForBrowserCompat } = await import("../services/video-processing.service");
                const result = await processVideoForBrowserCompat(finalBuffer, finalMimeType);
                finalBuffer = result.buffer;
                finalMimeType = result.mimeType;
              } catch (videoErr: any) {
                console.warn(`[media-stream] Video processing failed for ${req.params.id}, using original: ${videoErr.message}`);
              }
            }

            const { uploadMedia, buildMediaKey } = await import("../services/storage.service");
            const ext = finalMimeType.split("/")[1]?.split(";")[0] || "bin";
            const savedKey = buildMediaKey(msgTenantId, req.params.id, `media.${ext}`);
            await uploadMedia(finalBuffer, savedKey, finalMimeType);

            await MessageModel.findOneAndUpdate(
              { _id: req.params.id, tenantId: msgTenantId },
              {
                $set: {
                  "metadata.mimeType": finalMimeType,
                  "metadata.mediaInfo.mimeType": finalMimeType,
                  "metadata.mediaStatus": "completed",
                  "metadata.mediaKey": savedKey,
                },
                $unset: { "metadata.base64": "", "metadata.mediaInfo.base64": "" },
              },
            );
            console.log(`[media-stream] Re-download success for ${req.params.id}, stored in MinIO key=${savedKey}`);

            res.setHeader("Content-Type", finalMimeType);
            res.setHeader("Content-Length", finalBuffer.length);
            res.setHeader("Content-Disposition", safeDisposition);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
            res.setHeader("ETag", `"${req.params.id}"`);
            return res.send(finalBuffer);
          } else {
            console.warn(`[media-stream] Re-download returned null for ${req.params.id}`);
          }
        } catch (dlErr: any) {
          if (dlErr?.code === "TOKEN_EXPIRED") {
            console.error(`[media-stream] CRITICAL: TOKEN_EXPIRED for ${req.params.id} — channel token is invalid/expired`);
            await MessageModel.findOneAndUpdate(
              { _id: req.params.id },
              { $set: { "metadata.mediaStatus": "failed_auth" } },
            );
            return res.status(404).json({ error: "token_expired", message: "Media unavailable - channel access token expired", mediaStatus: "failed_auth" });
          }
          console.error(`[media-stream] Re-download failed for ${req.params.id}:`, dlErr.message);
        }
      }
      console.warn(`[media-stream] 404 no_media for ${req.params.id}: mediaStatus=${mediaStatus}, mediaId=${mediaId || "none"}`);
      return res.status(404).json({ error: "no_media", message: `Media data unavailable (mediaStatus=${mediaStatus}, mediaId=${mediaId || "none"})`, mediaStatus });
    } catch (error: any) {
      res.status(500).send(error.message);
    }
  });

  app.post("/api/inbox/conversations/:id/messages", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const { emitNewMessage } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string || String(conv.tenantId);
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { content, htmlContent, isInternal, replyToMessageId, replyToContent, replyToSender } = req.body;

      if (!isInternal && conv.assignedTo && String(conv.assignedTo) !== String(req.user?._id)) {
        const isAdmin = req.user?.role === "superadmin" || req.user?.role === "businessadmin";
        if (!isAdmin) {
          return res.status(403).json({ message: "CONV_LOCKED", assignedName: conv.assignedName });
        }
      }

      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ message: "Content is required" });
      }

      const senderName = req.user?.name || "Agent";
      const senderFields = {
        senderName,
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        ...(req.user?.role ? { senderRole: req.user.role } : {}),
      };

      const replyToFields = replyToMessageId ? { replyToMessageId, replyToContent, replyToSender } : {};

      if (isInternal) {
        const note = await MessageModel.create({
          conversationId: conv._id,
          tenantId: conv.tenantId,
          ...(conv.channelId ? { channelId: conv.channelId } : {}),
          direction: "OUTBOUND",
          content: content.trim(),
          ...(htmlContent ? { htmlContent } : {}),
          type: "TEXT",
          channel: conv.channel,
          isInternal: true,
          ...senderFields,
          ...replyToFields,
        });

        conv.lastMessageAt = new Date();
        await conv.save();

        emitNewMessage(String(conv.tenantId), String(conv._id), note.toObject());
        return res.json(note);
      }

      const { TenantModel } = await import("../models/tenant.model");
      const tenantDoc = await TenantModel.findById(conv.tenantId);
      if (tenantDoc) {
        const quota = tenantDoc.monthlyMessageQuota ?? 999999;
        const used = tenantDoc.messagesUsedThisMonth ?? 0;
        if (quota > 0 && used >= quota) {
          return res.status(402).json({
            message: "QUOTA_EXCEEDED",
            detail: `Monthly message quota reached (${used}/${quota}). Upgrade your plan to send more messages.`,
          });
        }
      }

      if (conv.channel === "WHATSAPP") {
        if (conv.lastInboundAt) {
          const hoursSince = (Date.now() - new Date(conv.lastInboundAt).getTime()) / (1000 * 60 * 60);
          if (hoursSince > 24) {
            return res.status(400).json({ message: "24H_WINDOW_EXPIRED", hoursSince: Math.round(hoursSince) });
          }
        }

        const customer = await CustomerModel.findById(conv.customerId).lean();
        const recipient = await resolveRecipientPhone(customer, String(conv._id), MessageModel, CustomerModel);
        console.log(`DEBUG: Attempting to send message to: ${recipient} for conversation: ${conv._id}`);
        if (!recipient) {
          return res.status(400).json({ message: "Customer has no phone number" });
        }

        let replyToWaMessageId: string | undefined;
        if (replyToMessageId) {
          const replyMsg = await MessageModel.findById(replyToMessageId, { "metadata.waMessageId": 1 }).lean();
          const waId = (replyMsg?.metadata as any)?.waMessageId;
          if (waId) replyToWaMessageId = waId;
        }

        const sendResult = await whatsappService.sendTextMessage({
          recipient,
          textBody: content.trim(),
          tenantId: String(conv.tenantId),
          ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
          ...(replyToWaMessageId ? { replyToWaMessageId } : {}),
        });

        if (!sendResult.success) {
          const errMsg = sendResult.errorMessage || "Failed to send";
          const isTokenError = sendResult.code === "WHATSAPP_TOKEN_EXPIRED";
          const statusCode = isTokenError ? 401 : 500;

          const failedMsg = await MessageModel.create({
            conversationId: conv._id,
            tenantId: conv.tenantId,
            ...(conv.channelId ? { channelId: conv.channelId } : {}),
            direction: "OUTBOUND",
            content: content.trim(),
            ...(htmlContent ? { htmlContent } : {}),
            type: "TEXT",
            channel: "WHATSAPP",
            isInternal: false,
            ...senderFields,
            deliveryStatus: "failed",
            metadata: { errorMessage: errMsg, errorCode: sendResult.code || "SEND_FAILED" },
            ...replyToFields,
          });

          conv.lastMessageAt = new Date();
          await conv.save();

          emitNewMessage(String(conv.tenantId), String(conv._id), failedMsg.toObject());

          return res.status(statusCode).json({
            message: errMsg,
            code: sendResult.code || "SEND_FAILED",
            failedMessageId: failedMsg._id,
          });
        }

        const msg = await MessageModel.create({
          conversationId: conv._id,
          tenantId: conv.tenantId,
          ...(conv.channelId ? { channelId: conv.channelId } : {}),
          direction: "OUTBOUND",
          content: content.trim(),
          ...(htmlContent ? { htmlContent } : {}),
          type: "TEXT",
          channel: "WHATSAPP",
          isInternal: false,
          ...senderFields,
          deliveryStatus: "sent",
          metadata: { waMessageId: sendResult.messageId },
          ...replyToFields,
        });

        conv.lastMessageAt = new Date();
        await conv.save();

        await TenantModel.updateOne(
          { _id: conv.tenantId },
          { $inc: { messagesUsedThisMonth: 1 } },
        );

        emitNewMessage(String(conv.tenantId), String(conv._id), msg.toObject());
        return res.json(msg);
      }

      return res.status(400).json({ message: "Channel not yet supported for sending" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/messages/:id/retry", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const { emitMessageStatus } = await import("../services/socket.service");

      const failedMsg = await MessageModel.findById(req.params.id);
      if (!failedMsg) return res.status(404).json({ message: "Message not found" });
      if (failedMsg.deliveryStatus !== "failed") return res.status(400).json({ message: "Message is not in failed state" });
      if (failedMsg.direction !== "OUTBOUND") return res.status(400).json({ message: "Can only retry outbound messages" });

      const conv = await ConversationModel.findById(failedMsg.conversationId);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (conv.channel === "WHATSAPP") {
        const customer = await CustomerModel.findById(conv.customerId).lean();
        const recipient = await resolveRecipientPhone(customer, String(conv._id), MessageModel, CustomerModel);
        console.log(`DEBUG: Attempting to retry message to: ${recipient} for conversation: ${conv._id}`);
        if (!recipient) return res.status(400).json({ message: "Customer has no phone number" });

        const sendResult = await whatsappService.sendTextMessage({
          recipient,
          textBody: failedMsg.content,
          tenantId: String(conv.tenantId),
          ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
        });

        if (!sendResult.success) {
          return res.status(500).json({
            message: sendResult.errorMessage || "Retry failed",
            code: sendResult.code || "SEND_FAILED",
          });
        }

        failedMsg.deliveryStatus = "sent";
        failedMsg.metadata = { ...failedMsg.metadata, waMessageId: sendResult.messageId, errorMessage: undefined, errorCode: undefined, retriedAt: new Date() };
        await failedMsg.save();

        emitMessageStatus(String(conv.tenantId), String(conv._id), {
          waMessageId: sendResult.messageId || "",
          messageId: String(failedMsg._id),
          status: "sent",
        });

        return res.json(failedMsg);
      }

      return res.status(400).json({ message: "Channel retry not yet supported" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/resolve", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitConversationResolved, emitStatusChanged } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const previousStatus = conv.status;
      const { resolutionTag, resolutionSummary, tags } = req.body || {};

      (conv as any).status = "RESOLVED";
      conv.assignedTo = undefined;
      conv.assignedName = undefined;
      if (resolutionTag) (conv as any).resolutionTag = resolutionTag;
      if (resolutionSummary) (conv as any).resolutionSummary = resolutionSummary;
      if (tags && Array.isArray(tags)) (conv as any).tags = tags;
      await conv.save();

      emitConversationResolved(String(conv.tenantId), String(conv._id));
      emitStatusChanged(String(conv.tenantId), String(conv._id), { status: "RESOLVED", previousStatus });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "RESOLVE_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `Resolved conversation (${previousStatus} -> RESOLVED)${resolutionTag ? `, tag: ${resolutionTag}` : ""}`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/tags", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });
      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const { tags } = req.body || {};
      if (!Array.isArray(tags)) return res.status(400).json({ message: "tags must be an array" });
      (conv as any).tags = tags;
      await conv.save();

      const { emitConversationUpdated } = await import("../services/socket.service");
      emitConversationUpdated(String(conv.tenantId), conv.toObject());

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/tag-usage", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const agentId = req.user?._id ? String(req.user._id) : undefined;
      if (!agentId) return res.json([]);

      const results = await ConversationModel.aggregate([
        { $match: { assignedTo: agentId, tags: { $exists: true, $ne: [] } } },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);
      res.json(results.map((r: any) => ({ tag: r._id, count: r.count })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/snooze", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitConversationAssigned, emitStatusChanged } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const previousStatus = conv.status;
      const { snoozedUntil, snoozeWakeAgentId } = req.body;
      if (!snoozedUntil) return res.status(400).json({ message: "snoozedUntil is required" });

      const snoozeDate = new Date(snoozedUntil);
      if (isNaN(snoozeDate.getTime()) || snoozeDate <= new Date()) {
        return res.status(400).json({ message: "snoozedUntil must be a future date" });
      }

      let wakeAgentId = snoozeWakeAgentId || String(req.user?._id);
      let wakeAgentName = req.user?.name || "";
      if (snoozeWakeAgentId && snoozeWakeAgentId !== String(req.user?._id)) {
        const { UserModel } = await import("../models/user.model");
        const targetAgent = await UserModel.findById(snoozeWakeAgentId).select("name tenantId active").lean();
        if (!targetAgent || !(targetAgent as any).active) {
          return res.status(400).json({ message: "Target agent not found or inactive" });
        }
        const convTenant = String(conv.tenantId);
        const agentTenant = String((targetAgent as any).tenantId);
        if (req.user?.role !== "superadmin" && agentTenant !== convTenant) {
          return res.status(400).json({ message: "Target agent does not belong to this tenant" });
        }
        wakeAgentName = (targetAgent as any).name;
      }

      (conv as any).status = "SNOOZED";
      (conv as any).snoozedUntil = snoozeDate;
      (conv as any).snoozedBy = req.user?._id;
      (conv as any).snoozeWakeAgentId = wakeAgentId;
      (conv as any).snoozeWakeAgentName = wakeAgentName;
      await conv.save();

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: conv.assignedTo ? String(conv.assignedTo) : null,
        assignedName: conv.assignedName || null,
        status: "SNOOZED",
      });
      emitStatusChanged(String(conv.tenantId), String(conv._id), { status: "SNOOZED", previousStatus });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "SNOOZE_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `Snoozed conversation until ${snoozeDate.toISOString()}${wakeAgentId !== String(req.user?._id) ? ` → will assign to ${wakeAgentName}` : ""}`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/wake", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitConversationAssigned, emitStatusChanged } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const previousStatus = conv.status;
      const wakeAgentId = (conv as any).snoozeWakeAgentId;
      const wakeAgentName = (conv as any).snoozeWakeAgentName;
      if (wakeAgentId) {
        (conv as any).assignedTo = wakeAgentId;
        (conv as any).assignedName = wakeAgentName || "";
      }
      const newStatus = conv.assignedTo ? "ACTIVE" : "UNASSIGNED";
      (conv as any).status = newStatus;
      (conv as any).snoozedUntil = undefined;
      (conv as any).snoozedBy = undefined;
      (conv as any).snoozeWakeAgentId = undefined;
      (conv as any).snoozeWakeAgentName = undefined;
      await conv.save();

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: conv.assignedTo ? String(conv.assignedTo) : null,
        assignedName: conv.assignedName || null,
        status: newStatus,
      });
      emitStatusChanged(String(conv.tenantId), String(conv._id), { status: newStatus, previousStatus });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "WAKE_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `Woke conversation (${previousStatus} -> ${newStatus})`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/star", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const tenantId = (req.query.tenantId as string) || req.user?.tenantId?.toString();
      const filter: any = { _id: req.params.id };
      if (tenantId) filter.tenantId = tenantId;
      const conv = await ConversationModel.findOne(filter);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const newStarred = !conv.starred;
      conv.starred = newStarred;
      conv.starredBy = newStarred ? req.user?._id : undefined;
      await conv.save();

      res.json({ _id: conv._id, starred: conv.starred });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/read", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const filter: any = { _id: req.params.id };
      if (req.user?.role !== "superadmin") {
        const tenantId = (req.query.tenantId as string) || req.user?.tenantId?.toString();
        if (tenantId) filter.tenantId = tenantId;
      }
      const conv = await ConversationModel.findOneAndUpdate(filter, { $set: { unreadCount: 0 } }, { new: true });
      if (!conv) return res.status(404).json({ message: "Conversation not found" });
      res.json({ _id: conv._id, unreadCount: 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/claim", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const { emitConversationAssigned } = await import("../services/socket.service");

      const tenantId = req.query.tenantId as string;
      const userId = req.user?._id;
      const userName = req.user?.name || "Agent";

      const filter: any = {
        _id: req.params.id,
        $or: [
          { assignedTo: { $exists: false } },
          { assignedTo: null },
          { assignedTo: userId },
        ],
      };
      if (tenantId) filter.tenantId = tenantId;

      const conv = await ConversationModel.findOneAndUpdate(
        filter,
        {
          $set: {
            assignedTo: userId,
            assignedName: userName,
            assignedAt: new Date(),
            status: "ACTIVE",
            routingRule: "manual",
          },
        },
        { new: true }
      );

      if (!conv) {
        const existing = await ConversationModel.findById(req.params.id);
        if (!existing) return res.status(404).json({ message: "Conversation not found" });
        return res.status(409).json({ message: "ALREADY_CLAIMED", assignedName: existing.assignedName });
      }

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: String(conv.assignedTo),
        assignedName: conv.assignedName || null,
        status: conv.status,
      });

      const systemMsg = await MessageModel.create({
        conversationId: conv._id,
        tenantId: conv.tenantId,
        ...(conv.channelId ? { channelId: conv.channelId } : {}),
        direction: "OUTBOUND",
        content: `${userName} claimed the conversation`,
        type: "SYSTEM",
        channel: conv.channel,
        isInternal: true,
        senderName: "System",
        senderId: req.user?._id,
        senderRole: req.user?.role,
        metadata: { systemEvent: "claim", agentName: userName, agentId: String(userId) },
      });
      const { emitNewMessage } = await import("../services/socket.service");
      emitNewMessage(String(conv.tenantId), String(conv._id), systemMsg.toObject());

      auditLogService.log({
        actorName: userName,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "CLAIM_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `${userName} claimed conversation`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/release", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitConversationAssigned } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const isAdmin = req.user?.role === "superadmin" || req.user?.role === "businessadmin";
      if (!isAdmin && conv.assignedTo && String(conv.assignedTo) !== String(req.user?._id)) {
        return res.status(403).json({ message: "Only the assigned agent or admin can release" });
      }

      conv.assignedTo = undefined;
      conv.assignedName = undefined;
      (conv as any).status = "UNASSIGNED";
      await conv.save();

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: null,
        assignedName: null,
        status: "UNASSIGNED",
      });

      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const releaseSystemMsg = await MessageModel.create({
        conversationId: conv._id,
        tenantId: conv.tenantId,
        ...(conv.channelId ? { channelId: conv.channelId } : {}),
        direction: "OUTBOUND",
        content: `${req.user?.name} released the conversation`,
        type: "SYSTEM",
        channel: conv.channel,
        isInternal: true,
        senderName: "System",
        senderId: req.user?._id,
        senderRole: req.user?.role,
        metadata: { systemEvent: "release", agentName: req.user?.name },
      });
      const { emitNewMessage } = await import("../services/socket.service");
      emitNewMessage(String(conv.tenantId), String(conv._id), releaseSystemMsg.toObject());

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "RELEASE_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `${req.user?.name} released conversation back to pool`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/transfer", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitConversationAssigned } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { targetUserId, targetUserName } = req.body;
      if (!targetUserId) {
        return res.status(400).json({ message: "targetUserId is required" });
      }

      const isAdmin = req.user?.role === "superadmin" || req.user?.role === "businessadmin";
      if (!isAdmin && conv.assignedTo && String(conv.assignedTo) !== String(req.user?._id)) {
        return res.status(403).json({ message: "Only the assigned agent or admin can transfer" });
      }

      conv.assignedTo = targetUserId;
      conv.assignedName = targetUserName || "Agent";
      (conv as any).assignedAt = new Date();
      (conv as any).routingRule = "manual";
      if (conv.status === "UNASSIGNED" || (conv as any).status === "OPEN") {
        (conv as any).status = "ACTIVE";
      }
      await conv.save();

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: String(conv.assignedTo),
        assignedName: conv.assignedName || null,
        status: conv.status,
      });

      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const transferSystemMsg = await MessageModel.create({
        conversationId: conv._id,
        tenantId: conv.tenantId,
        ...(conv.channelId ? { channelId: conv.channelId } : {}),
        direction: "OUTBOUND",
        content: `${req.user?.name} transferred the conversation to ${targetUserName || "another agent"}`,
        type: "SYSTEM",
        channel: conv.channel,
        isInternal: true,
        senderName: "System",
        senderId: req.user?._id,
        senderRole: req.user?.role,
        metadata: {
          systemEvent: "transfer",
          fromAgent: req.user?.name,
          toAgent: targetUserName || targetUserId,
          toAgentId: targetUserId,
        },
      });
      const { emitNewMessage } = await import("../services/socket.service");
      emitNewMessage(String(conv.tenantId), String(conv._id), transferSystemMsg.toObject());

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "TRANSFER_CONVERSATION",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `${req.user?.name} transferred conversation to ${targetUserName || targetUserId}`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/spam", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitStatusChanged } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const previousStatus = conv.status;
      (conv as any).status = "SPAM";
      conv.assignedTo = undefined;
      conv.assignedName = undefined;
      await conv.save();

      emitStatusChanged(String(conv.tenantId), String(conv._id), { status: "SPAM", previousStatus });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "MARK_SPAM",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `Marked conversation as spam (${previousStatus} -> SPAM)`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/conversations/:id/unspam", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitStatusChanged } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      (conv as any).status = "UNASSIGNED";
      await conv.save();

      emitStatusChanged(String(conv.tenantId), String(conv._id), { status: "UNASSIGNED", previousStatus: "SPAM" });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: tenantId || String(conv.tenantId),
        action: "UNMARK_SPAM",
        entityType: "Conversation",
        entityId: String(conv._id),
        details: `Removed spam mark, restored to UNASSIGNED`,
      });

      res.json(conv);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/conversations/merge", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);

      const { targetConvId, sourceConvId } = req.body;
      if (!targetConvId || !sourceConvId) {
        return res.status(400).json({ message: "targetConvId and sourceConvId are required" });
      }

      const [targetConv, sourceConv] = await Promise.all([
        ConversationModel.findById(targetConvId),
        ConversationModel.findById(sourceConvId),
      ]);

      if (!targetConv || !sourceConv) {
        return res.status(404).json({ message: "One or both conversations not found" });
      }

      if (String(targetConv.tenantId) !== String(sourceConv.tenantId)) {
        return res.status(400).json({ message: "Cannot merge conversations from different tenants" });
      }

      if (String(targetConv.customerId) !== String(sourceConv.customerId)) {
        return res.status(400).json({ message: "Cannot merge conversations from different customers" });
      }

      await MessageModel.updateMany(
        { conversationId: sourceConv._id },
        { $set: { conversationId: targetConv._id } }
      );

      const latestDate = sourceConv.lastMessageAt > targetConv.lastMessageAt ? sourceConv.lastMessageAt : targetConv.lastMessageAt;
      targetConv.lastMessageAt = latestDate;
      if (sourceConv.lastInboundAt && (!targetConv.lastInboundAt || sourceConv.lastInboundAt > targetConv.lastInboundAt)) {
        targetConv.lastInboundAt = sourceConv.lastInboundAt;
      }
      const sourceTags = (sourceConv as any).tags || [];
      const targetTags = (targetConv as any).tags || [];
      (targetConv as any).tags = [...new Set([...targetTags, ...sourceTags])];
      await targetConv.save();

      (sourceConv as any).status = "RESOLVED";
      (sourceConv as any).mergedInto = targetConv._id;
      (sourceConv as any).resolutionSummary = `Merged into conversation ${targetConvId}`;
      await sourceConv.save();

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: String(targetConv.tenantId),
        action: "MERGE_CONVERSATIONS",
        entityType: "Conversation",
        entityId: String(targetConv._id),
        details: `Merged conversation ${sourceConvId} into ${targetConvId}`,
      });

      res.json({ target: targetConv, source: sourceConv });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/messages/:id/flag", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const msg = await MessageModel.findById(req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      (msg as any).flagged = !(msg as any).flagged;
      await msg.save();
      res.json(msg);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/messages/:id/delete", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const { emitMessageEdited } = await import("../services/socket.service");
      const msg = await MessageModel.findById(req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      if (msg.channel === "WHATSAPP") {
        return res.status(403).json({ message: "WHATSAPP_NOT_SUPPORTED", detail: "WhatsApp does not support editing or deleting messages via API." });
      }

      if (!msg.metadata) msg.metadata = {};
      if (!msg.metadata.original_archive) {
        const archive: any = {
          content: msg.content,
          type: msg.type,
          archivedAt: new Date(),
          archivedBy: req.user?.name,
          archivedById: String(req.user?._id),
        };
        if (msg.metadata?.mediaKey) archive.mediaKey = msg.metadata.mediaKey;
        if (msg.metadata?.mimeType) archive.mimeType = msg.metadata.mimeType;
        if (msg.metadata?.fileName) archive.fileName = msg.metadata.fileName;
        if (msg.metadata?.caption) archive.caption = msg.metadata.caption;
        if (msg.metadata?.waMediaId) archive.waMediaId = msg.metadata.waMediaId;
        msg.metadata.original_archive = archive;
      }
      msg.metadata.deletedBy = req.user?.name;
      msg.metadata.deletedById = String(req.user?._id);
      msg.metadata.deletedByRole = req.user?.role;
      msg.markModified("metadata");
      (msg as any).deletedAt = new Date();
      await msg.save();

      emitMessageEdited(String(msg.tenantId), String(msg.conversationId), {
        messageId: String(msg._id),
        deletedAt: (msg as any).deletedAt.toISOString(),
      });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: String(msg.tenantId),
        action: "DELETE_MESSAGE",
        entityType: "Message",
        entityId: String(msg._id),
        details: `${req.user?.name} deleted message`,
      });

      res.json(msg.toObject());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/inbox/messages/:id/edit", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const { emitMessageEdited } = await import("../services/socket.service");
      const msg = await MessageModel.findById(req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });

      if (msg.channel === "WHATSAPP") {
        return res.status(403).json({ message: "WHATSAPP_NOT_SUPPORTED", detail: "WhatsApp does not support editing or deleting messages via API." });
      }

      if (msg.type !== "TEXT") {
        return res.status(400).json({ message: "EDIT_MEDIA_NOT_SUPPORTED", detail: "Media messages cannot be edited. Please delete and re-send." });
      }

      const ageMinutes = (Date.now() - new Date(msg.createdAt).getTime()) / (1000 * 60);
      if (ageMinutes > 15) {
        return res.status(400).json({ message: "EDIT_EXPIRED", detail: "Message editing expired (15 min limit)", ageMinutes: Math.round(ageMinutes) });
      }

      const { content } = req.body;
      if (!content || !content.trim()) return res.status(400).json({ message: "content is required" });

      if (!msg.metadata) msg.metadata = {};
      if (!msg.metadata.original_archive) {
        msg.metadata.original_archive = {
          content: msg.content,
          archivedAt: new Date(),
          archivedBy: req.user?.name,
          archivedById: String(req.user?._id),
        };
      }
      msg.metadata.editedBy = req.user?.name;
      msg.metadata.editedById = String(req.user?._id);
      msg.metadata.editedByRole = req.user?.role;
      msg.markModified("metadata");

      if (!(msg as any).editedContent) {
        (msg as any).editedContent = msg.content;
      }
      msg.content = content.trim();
      (msg as any).editedAt = new Date();
      await msg.save();

      emitMessageEdited(String(msg.tenantId), String(msg.conversationId), {
        messageId: String(msg._id),
        content: content.trim(),
        editedAt: (msg as any).editedAt.toISOString(),
        editedBy: req.user?.name,
      });

      auditLogService.log({
        actorName: req.user?.name,
        role: req.user?.role,
        tenantId: String(msg.tenantId),
        action: "EDIT_MESSAGE",
        entityType: "Message",
        entityId: String(msg._id),
        details: `${req.user?.name} edited message`,
      });

      res.json(msg.toObject());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/conversations/:id/audit", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const ConversationModel = getConversationModel(req.tenantDbConnection!);

      const conv = await ConversationModel.findById(req.params.id).lean();
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string;
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const allMessages = await MessageModel.find({ conversationId: conv._id }).sort({ createdAt: 1 }).lean();

      const participantMap: Record<string, { userId: string; name: string; role: string; messageCount: number }> = {};
      const auditTrail: any[] = [];
      const timeline: any[] = [];

      for (const m of allMessages) {
        if (m.direction === "OUTBOUND" && !m.isInternal && m.type !== "SYSTEM") {
          const key = m.senderId ? String(m.senderId) : m.senderName || "Unknown";
          if (!participantMap[key]) {
            participantMap[key] = {
              userId: m.senderId ? String(m.senderId) : "",
              name: m.senderName || "Unknown",
              role: m.senderRole || "employee",
              messageCount: 0,
            };
          }
          participantMap[key].messageCount++;
        }

        if ((m as any).metadata?.original_archive) {
          auditTrail.push({
            messageId: m._id,
            originalContent: (m as any).metadata.original_archive.content,
            originalType: (m as any).metadata.original_archive.type,
            archivedAt: (m as any).metadata.original_archive.archivedAt,
            archivedBy: (m as any).metadata.original_archive.archivedBy,
            currentContent: m.content,
            editedAt: m.editedAt,
            deletedAt: m.deletedAt,
            editedBy: (m as any).metadata?.editedBy,
            deletedBy: (m as any).metadata?.deletedBy,
          });
        }

        if (m.type === "SYSTEM") {
          timeline.push({
            messageId: m._id,
            content: m.content,
            createdAt: m.createdAt,
            metadata: m.metadata,
            senderName: m.senderName,
          });
        }
      }

      res.json({
        participants: Object.values(participantMap).sort((a, b) => b.messageCount - a.messageCount),
        auditTrail,
        timeline,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/messages/:id/forward", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const { emitNewMessage } = await import("../services/socket.service");

      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const originalMsg = await MessageModel.findById(req.params.id);
      if (!originalMsg) return res.status(404).json({ message: "Message not found" });
      if (String(originalMsg.tenantId) !== String(req.query.tenantId || req.user?.tenantId)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { targetConversationId, targetPhone } = req.body;
      let targetConv: any = null;

      const sourceConv = await ConversationModel.findById(originalMsg.conversationId).lean();
      const sourceCustomer = sourceConv ? await CustomerModel.findById(sourceConv.customerId).lean() : null;
      const sourcePhone = sourceCustomer?.phone;

      const normalizePhone = (p: string) => p.replace(/[^0-9]/g, "");
      if (targetPhone && sourcePhone && normalizePhone(targetPhone) === normalizePhone(sourcePhone)) {
        return res.status(400).json({ message: "Cannot forward a message to the same conversation" });
      }

      if (targetConversationId) {
        targetConv = await ConversationModel.findById(targetConversationId);
        if (!targetConv) return res.status(404).json({ message: "Target conversation not found" });
        if (String(originalMsg.tenantId) !== String(targetConv.tenantId)) {
          return res.status(403).json({ message: "Cannot forward across tenants" });
        }
        if (String(targetConv._id) === String(originalMsg.conversationId)) {
          return res.status(400).json({ message: "Cannot forward a message to the same conversation" });
        }
        if (sourcePhone) {
          const targetCust = await CustomerModel.findById(targetConv.customerId).lean();
          if (targetCust?.phone && normalizePhone(targetCust.phone) === normalizePhone(sourcePhone)) {
            return res.status(400).json({ message: "Cannot forward a message to the same conversation" });
          }
        }
      } else if (targetPhone) {
        const customer = await CustomerModel.findOne({ tenantId: originalMsg.tenantId, phone: targetPhone }).lean();
        if (customer) {
          targetConv = await ConversationModel.findOne({
            tenantId: originalMsg.tenantId,
            customerId: customer._id,
            status: { $in: ["UNASSIGNED", "ACTIVE", "SNOOZED"] },
          });
        }
        if (!targetConv) {
          let cust = customer;
          if (!cust) {
            cust = await CustomerModel.create({
              tenantId: originalMsg.tenantId,
              firstName: targetPhone,
              lastName: "",
              phone: targetPhone,
              channel: "WHATSAPP",
            });
          }
          targetConv = await ConversationModel.create({
            tenantId: originalMsg.tenantId,
            customerId: cust._id,
            channelId: originalMsg.channelId,
            channel: "WHATSAPP",
            status: "ACTIVE",
            assignedTo: req.user?._id,
          });
          const { emitNewConversation } = await import("../services/socket.service");
          emitNewConversation(String(originalMsg.tenantId), targetConv.toObject());
        }
      } else {
        return res.status(400).json({ message: "targetConversationId or targetPhone is required" });
      }

      const recipient = targetPhone || (await (async () => {
        const cust = await CustomerModel.findById(targetConv.customerId).lean();
        return cust?.phone;
      })());

      let waStatus = "local_only";
      if (recipient) {
        const msgType = (originalMsg.type || "TEXT").toUpperCase();
        const channelOpt = targetConv.channelId ? { channelId: String(targetConv.channelId) } : {};
        const tenantIdStr = String(targetConv.tenantId);

        try {
          if (msgType === "TEXT") {
            if (!originalMsg.content) { waStatus = "local_only"; }
            else {
              const sendResult = await whatsappService.sendTextMessage({
                recipient, tenantId: tenantIdStr, ...channelOpt, textBody: originalMsg.content,
              });
              waStatus = sendResult?.messageId ? "sent" : "failed";
            }
          } else if (["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(msgType)) {
            const md = originalMsg.metadata as Record<string, any> | undefined;
            const mediaKey = md?.mediaKey;
            if (!mediaKey) {
              return res.status(400).json({ message: "Cannot forward this media: missing attachment" });
            }

            const { getObject } = await import("../services/storage.service");
            const obj = await getObject(mediaKey);
            const chunks: Buffer[] = [];
            for await (const chunk of obj.body) { chunks.push(Buffer.from(chunk)); }
            const buffer = Buffer.concat(chunks);

            const mimeType = md?.mimeType || md?.mediaInfo?.mimeType || obj.contentType || "application/octet-stream";
            const fileName = md?.fileName || md?.mediaInfo?.fileName || "file";

            const uploadResult = await whatsappService.uploadMedia({
              tenantId: tenantIdStr, ...channelOpt, buffer, mimeType, fileName,
            });
            if (!uploadResult.success || !uploadResult.mediaId) {
              return res.status(400).json({ message: `Cannot forward media: ${uploadResult.errorMessage || "upload failed"}` });
            }

            const mediaTypeMap: Record<string, "image" | "video" | "audio" | "document"> = {
              IMAGE: "image", VIDEO: "video", AUDIO: "audio", DOCUMENT: "document",
            };
            const sendResult = await whatsappService.sendMediaMessage({
              recipient, tenantId: tenantIdStr, ...channelOpt,
              mediaType: mediaTypeMap[msgType],
              mediaId: uploadResult.mediaId,
              caption: originalMsg.content || undefined,
              fileName: mediaTypeMap[msgType] === "document" ? fileName : undefined,
            });
            waStatus = sendResult?.messageId ? "sent" : "failed";
          } else {
            waStatus = "local_only";
          }
        } catch (sendErr: any) {
          console.error(`[forward] WhatsApp send failed: ${sendErr.message}`);
          waStatus = "failed";
        }
      }

      const targetCustomer = await CustomerModel.findById(targetConv.customerId).lean();
      const targetName = targetCustomer ? [targetCustomer.firstName, targetCustomer.lastName].filter(Boolean).join(" ").trim() : "";
      const targetDisplay = targetName || recipient || "Unknown";

      const sourceName = sourceCustomer ? [sourceCustomer.firstName, sourceCustomer.lastName].filter(Boolean).join(" ").trim() : "";
      const sourceDisplay = sourceName || sourcePhone || "Unknown";

      const origMd = (originalMsg.metadata as Record<string, any>) || {};
      const forwardedMetadata: Record<string, any> = {
        forwardedFrom: String(originalMsg.conversationId),
        forwardedFromName: sourceDisplay,
        forwardedFromPhone: sourcePhone || null,
        waStatus,
      };
      if (origMd.mediaKey) forwardedMetadata.mediaKey = origMd.mediaKey;
      if (origMd.mimeType) forwardedMetadata.mimeType = origMd.mimeType;
      if (origMd.fileName) forwardedMetadata.fileName = origMd.fileName;
      if (origMd.mediaInfo) forwardedMetadata.mediaInfo = origMd.mediaInfo;
      if (origMd.mediaUrl) forwardedMetadata.mediaUrl = origMd.mediaUrl;

      const forwarded = await MessageModel.create({
        conversationId: targetConv._id,
        tenantId: targetConv.tenantId,
        channelId: targetConv.channelId,
        direction: "OUTBOUND",
        content: originalMsg.content,
        type: originalMsg.type,
        channel: targetConv.channel || "WHATSAPP",
        isInternal: false,
        senderName: req.user?.name,
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        ...(req.user?.role ? { senderRole: req.user.role } : {}),
        forwardedFromMessageId: originalMsg._id,
        metadata: forwardedMetadata,
        ...(waStatus === "failed" ? { deliveryStatus: "failed" } : {}),
      });

      targetConv.lastMessageAt = new Date();
      await targetConv.save();

      emitNewMessage(String(targetConv.tenantId), String(targetConv._id), forwarded.toObject());

      const auditLog = await MessageModel.create({
        conversationId: originalMsg.conversationId,
        tenantId: originalMsg.tenantId,
        channelId: originalMsg.channelId,
        direction: "OUTBOUND",
        content: `הודעה הועברה אל: ${targetDisplay}`,
        type: "SYSTEM",
        channel: originalMsg.channel || "WHATSAPP",
        isInternal: false,
        senderName: req.user?.name,
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        metadata: {
          isForwardLog: true,
          forwardedToConversationId: String(targetConv._id),
          forwardedToName: targetDisplay,
          forwardedToPhone: recipient || null,
          originalMessageId: String(originalMsg._id),
          originalContentPreview: originalMsg.content?.substring(0, 200) || "",
          originalMediaType: origMd.mimeType || originalMsg.type || "text",
          originalMediaUrl: origMd.mediaUrl || origMd.mediaInfo?.url || null,
          originalFileName: origMd.fileName || null,
        },
      });
      emitNewMessage(String(originalMsg.tenantId), String(originalMsg.conversationId), auditLog.toObject());

      res.json(forwarded);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/agents", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, async (req, res) => {
    try {
      const tenantId = req.query.tenantId as string;
      const filter: any = { active: true };
      if (tenantId) filter.tenantId = tenantId;
      const users = await userService.getAll();
      const agents = users.filter((u: any) => {
        if (!u.active) return false;
        if (tenantId && String(u.tenantId) !== tenantId && u.role !== "superadmin") return false;
        return true;
      });
      res.json(agents.map((a: any) => ({ _id: a._id, name: a.name, role: a.role, groupId: a.groupId, teamIds: a.teamIds || [], isOnline: !!a.isOnline })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/channel-status", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, async (req, res) => {
    try {
      const { ChannelModel } = await import("../models/channel.model");
      const tenantId = req.query.tenantId as string;
      if (!tenantId) return res.json({ whatsapp: { tokenExpired: false } });

      let waChannels = await ChannelModel.find({ tenantId, type: "WHATSAPP" }).lean();
      const hasAny = waChannels.length > 0;
      let anyExpired = waChannels.some(ch => !!ch.tokenExpiredAt);

      if (anyExpired) {
        const { decryptChannelFields, clearChannelTokenExpired } = await import("../services/channel.service");
        const axios = (await import("axios")).default;
        for (const ch of waChannels) {
          if (!ch.tokenExpiredAt) continue;
          try {
            const decrypted = decryptChannelFields(ch);
            if (decrypted.accessToken && decrypted.phoneNumberId) {
              console.log(`[channel-status] Validating token for channel ${ch._id} (expired at ${ch.tokenExpiredAt})...`);
              const resp = await axios.get(
                `https://graph.facebook.com/v21.0/${decrypted.phoneNumberId}`,
                {
                  params: { fields: "verified_name" },
                  headers: { Authorization: `Bearer ${decrypted.accessToken}` },
                  timeout: 10000,
                }
              );
              if (resp.status === 200) {
                await clearChannelTokenExpired(String(ch._id));
                console.log(`[channel-status] Auto-cleared stale tokenExpiredAt for channel ${ch._id} — token is valid`);
              }
            } else {
              console.log(`[channel-status] Channel ${ch._id} has no decrypted token or phoneNumberId — cannot validate`);
            }
          } catch (tokenErr: any) {
            const code = tokenErr?.response?.data?.error?.code;
            const errMsg = tokenErr?.response?.data?.error?.message || tokenErr?.message || "unknown";
            console.log(`[channel-status] Token validation failed for channel ${ch._id}: code=${code}, msg=${errMsg}`);
            if (code === 190) {
              continue;
            }
            await clearChannelTokenExpired(String(ch._id));
            console.log(`[channel-status] Cleared tokenExpiredAt for channel ${ch._id} — validation error was not 190 (network issue, not token issue)`);
          }
        }
        const refreshed = await ChannelModel.find({ tenantId, type: "WHATSAPP" }).lean();
        anyExpired = refreshed.some(ch => !!ch.tokenExpiredAt);
        waChannels = refreshed;
      }

      const anyActive = waChannels.some(ch => ch.status === "active" && !ch.tokenExpiredAt && ch.accessToken);

      res.json({
        whatsapp: {
          tokenExpired: anyExpired,
          tokenExpiredAt: anyExpired ? (waChannels.find(ch => ch.tokenExpiredAt)?.tokenExpiredAt || null) : null,
          hasCredentials: anyActive || !anyExpired,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/conversations/:id/send-template", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const { emitNewMessage } = await import("../services/socket.service");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const tenantId = req.query.tenantId as string || String(conv.tenantId);
      if (tenantId && String(conv.tenantId) !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { templateName, templateLanguage, templateParams, templateButtonParams } = req.body;
      if (!templateName) return res.status(400).json({ message: "templateName is required" });

      const customer = await CustomerModel.findById(conv.customerId).lean();
      const recipient = await resolveRecipientPhone(customer, String(conv._id), MessageModel, CustomerModel);
      console.log(`DEBUG: Attempting to send template to: ${recipient} for conversation: ${conv._id}`);
      if (!recipient) return res.status(400).json({ message: "Customer has no phone" });

      const { WhatsAppTemplateModel } = await import("../models/whatsapp-template.model");
      const tplDoc = await WhatsAppTemplateModel.findOne({
        tenantId: String(conv.tenantId),
        name: templateName,
      }).lean();

      let resolvedContent = `[Template: ${templateName}]`;
      if (tplDoc) {
        let body = tplDoc.bodyText || "";
        const params: string[] = templateParams || [];
        for (let i = 0; i < params.length; i++) {
          body = body.split(`{{${i + 1}}}`).join(params[i]);
        }
        resolvedContent = body;
      }

      const sendResult = await whatsappService.sendTextMessage({
        recipient,
        templateName,
        templateLanguage: templateLanguage || "he",
        templateParams: templateParams || [],
        templateButtonParams: templateButtonParams || [],
        tenantId: String(conv.tenantId),
        ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
      });

      if (!sendResult.success) {
        const errMsg = sendResult.errorMessage || "Failed to send template";
        const isTokenError = /access token|session is invalid|OAuthException/i.test(errMsg);
        const statusCode = isTokenError ? 401 : 500;
        return res.status(statusCode).json({
          message: errMsg,
          code: isTokenError ? "WHATSAPP_TOKEN_EXPIRED" : "SEND_FAILED",
        });
      }

      const msg = await MessageModel.create({
        conversationId: conv._id,
        tenantId: conv.tenantId,
        ...(conv.channelId ? { channelId: conv.channelId } : {}),
        direction: "OUTBOUND",
        content: resolvedContent,
        type: "TEXT",
        channel: "WHATSAPP",
        isInternal: false,
        senderName: req.user?.name || "Agent",
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        ...(req.user?.role ? { senderRole: req.user.role } : {}),
        deliveryStatus: "sent",
        metadata: { waMessageId: sendResult.messageId, templateName, templateLanguage, templateParams },
      });

      conv.lastMessageAt = new Date();
      await conv.save();

      emitNewMessage(String(conv.tenantId), String(conv._id), msg.toObject());
      res.json(msg);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/customers/:customerId/journey", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);

      const customerId = req.params.customerId;
      const allConversations = await ConversationModel.find({ customerId })
        .sort({ lastMessageAt: -1 })
        .lean();

      const convIds = allConversations.map((c: any) => c._id);
      const allMessages = await MessageModel.find({ conversationId: { $in: convIds } })
        .sort({ createdAt: 1 })
        .select("conversationId direction content type channel isInternal senderName deliveryStatus createdAt")
        .lean();

      const msgsByConv: Record<string, any[]> = {};
      allMessages.forEach((m: any) => {
        const cid = String(m.conversationId);
        if (!msgsByConv[cid]) msgsByConv[cid] = [];
        msgsByConv[cid].push(m);
      });

      const journey = allConversations.map((conv: any) => ({
        ...conv,
        messages: msgsByConv[String(conv._id)] || [],
      }));

      res.json(journey);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/customers/:customerId/handlers", requireAuth, requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);

      const convs = await ConversationModel.find({
        customerId: req.params.customerId,
        status: "RESOLVED",
      }).select("assignedTo assignedName resolutionTag resolutionSummary channel createdAt updatedAt").lean();

      const outboundMsgs = await MessageModel.aggregate([
        { $match: { conversationId: { $in: convs.map((c: any) => c._id) }, direction: "OUTBOUND", isInternal: { $ne: true } } },
        { $group: { _id: "$conversationId", agents: { $addToSet: "$senderName" } } },
      ]);

      const agentMap: Record<string, string[]> = {};
      outboundMsgs.forEach((m: any) => { agentMap[String(m._id)] = m.agents.filter(Boolean); });

      const handlers = convs.map((c: any) => ({
        conversationId: c._id,
        assignedName: c.assignedName,
        resolutionTag: c.resolutionTag,
        resolutionSummary: c.resolutionSummary,
        channel: c.channel,
        createdAt: c.createdAt,
        resolvedAt: c.updatedAt,
        agents: agentMap[String(c._id)] || [],
      }));

      res.json(handlers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/conversations/:id/media", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const contentType = req.headers["content-type"] || "";
      const isAudio = contentType.includes("audio") || contentType.includes("webm") || contentType.includes("ogg");
      const mediaType = (req.query.type as string || (isAudio ? "AUDIO" : "FILE")).toUpperCase();

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      await new Promise<void>((resolve) => req.on("end", resolve));
      let buffer = Buffer.concat(chunks);

      if (buffer.length === 0) return res.status(400).json({ message: "Empty file" });

      const isVideoUpload = mediaType === "VIDEO" || contentType.startsWith("video/");
      const uploadMaxSize = isVideoUpload
        ? 500 * 1024 * 1024
        : (MEDIA_LIMITS_MAP[mediaType] || MEDIA_SIZE_DEFAULT);
      if (buffer.length > uploadMaxSize) {
        const maxMB = (uploadMaxSize / (1024 * 1024)).toFixed(1);
        return res.status(400).json({ message: `File too large for ${mediaType} (max ${maxMB}MB)` });
      }

      let mimeType = contentType.split(";")[0] || "application/octet-stream";
      let fileName = (req.query.fileName as string) || `media_${Date.now()}`;
      let sendAsDocument = false;

      console.log(`[media-upload] Incoming: file=${fileName}, mime=${mimeType}, origContentType=${contentType}, size=${buffer.length}, type=${mediaType}, convId=${req.params.id}`);

      const { needsTranscoding, transcodeMedia } = await import("../services/transcode.service");
      let transcodeParts: { buffer: Buffer; mimeType: string; fileName: string; size: number }[] | null = null;
      let transcodeTotalParts = 1;
      if (needsTranscoding(mimeType)) {
        try {
          const result = await transcodeMedia(buffer, mimeType, fileName);
          transcodeTotalParts = result.totalParts;
          sendAsDocument = result.sendAsDocument;
          if (result.parts.length === 1) {
            const part = result.parts[0];
            console.log(`[media-upload] Transcoded: ${mimeType} → ${part.mimeType} (${result.originalSize} → ${part.size} bytes, sendAsDocument=${sendAsDocument})`);
            buffer = part.buffer;
            mimeType = part.mimeType;
            fileName = part.fileName;
          } else {
            console.log(`[media-upload] Transcoded into ${result.parts.length} parts (${result.originalSize} → ${result.parts.reduce((s, p) => s + p.size, 0)} bytes total)`);
            transcodeParts = result.parts;
          }
        } catch (transcodeErr: any) {
          console.error(`[media-upload] Transcoding failed: ${transcodeErr.message}`);
          if (buffer.length > DOCUMENT_LIMIT_BYTES) {
            return res.status(400).json({ message: `Video is ${(buffer.length / 1024 / 1024).toFixed(0)}MB and transcoding/splitting failed. Maximum is 100MB per part.` });
          }
          if (buffer.length > 16 * 1024 * 1024 && mimeType.startsWith("video/")) {
            console.log(`[media-upload] Original video > 16MB and transcode failed. Forcing document mode.`);
            sendAsDocument = true;
          }
        }
      }
      if (!sendAsDocument && mimeType.startsWith("video/") && buffer.length > 16 * 1024 * 1024) {
        console.log(`[media-upload] Video buffer > 16MB without transcoding. Forcing document mode.`);
        sendAsDocument = true;
      }
      const senderName = req.user?.name || "Agent";
      const mediaSenderFields = {
        senderName,
        ...(req.user?._id ? { senderId: req.user._id } : {}),
        ...(req.user?.role ? { senderRole: req.user.role } : {}),
      };

      if (conv.channel === "WHATSAPP") {
        if (!conv.lastInboundAt) {
          return res.status(400).json({ message: "24H_WINDOW_EXPIRED", detail: "No inbound message received yet" });
        }
        const hoursSince = (Date.now() - new Date(conv.lastInboundAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) {
          return res.status(400).json({ message: "24H_WINDOW_EXPIRED", hoursSince: Math.round(hoursSince) });
        }

        const customer = await CustomerModel.findById(conv.customerId).lean();
        const recipient = await resolveRecipientPhone(customer, String(conv._id), MessageModel, CustomerModel);
        console.log(`DEBUG: Attempting to send media to: ${recipient} for conversation: ${conv._id}`);
        if (!recipient) {
          return res.status(400).json({ message: "Customer has no phone number" });
        }

        if (transcodeParts && transcodeParts.length > 1) {
          console.log(`[media-upload] Multi-part dispatch: ${transcodeParts.length} parts to ${recipient}`);
          const sentMessages: any[] = [];
          for (let i = 0; i < transcodeParts.length; i++) {
            const part = transcodeParts[i];
            const partCaption = `חלק ${i + 1} מתוך ${transcodeParts.length}`;
            console.log(`[media-upload] Uploading part ${i + 1}/${transcodeParts.length}: ${part.fileName} (${(part.size / 1024 / 1024).toFixed(1)}MB)`);

            const partUpload = await whatsappService.uploadMedia({
              tenantId: String(conv.tenantId),
              ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
              buffer: part.buffer,
              mimeType: part.mimeType,
              fileName: part.fileName,
            });

            if (!partUpload.success || !partUpload.mediaId) {
              console.error(`[media-upload] Part ${i + 1} upload failed: ${partUpload.errorMessage}`);
              const failedMsg = await MessageModel.create({
                conversationId: conv._id, tenantId: conv.tenantId,
                ...(conv.channelId ? { channelId: conv.channelId } : {}),
                direction: "OUTBOUND", content: `${part.fileName} (${partCaption})`,
                type: mediaType as any, channel: conv.channel, isInternal: false,
                ...mediaSenderFields, deliveryStatus: "failed",
                metadata: { mimeType: part.mimeType, fileName: part.fileName, fileSize: part.size, errorMessage: partUpload.errorMessage },
              });
              sentMessages.push(failedMsg);
              continue;
            }

            const partSend = await whatsappService.sendMediaMessage({
              recipient,
              tenantId: String(conv.tenantId),
              ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
              mediaType: "document",
              mediaId: partUpload.mediaId,
              fileName: part.fileName,
              caption: partCaption,
            });
            console.log(`[media-upload] Part ${i + 1} send: success=${partSend.success}, messageId=${partSend.messageId || 'none'}`);

            const msg = await MessageModel.create({
              conversationId: conv._id, tenantId: conv.tenantId,
              ...(conv.channelId ? { channelId: conv.channelId } : {}),
              direction: "OUTBOUND", content: `${part.fileName} (${partCaption})`,
              type: mediaType as any, channel: conv.channel, isInternal: false,
              ...mediaSenderFields, deliveryStatus: partSend.success ? "sent" : "failed",
              metadata: {
                mimeType: part.mimeType, fileName: part.fileName, fileSize: part.size,
                waMessageId: partSend.messageId, waMediaId: partUpload.mediaId,
                mediaStatus: "completed", caption: partCaption,
                partIndex: i + 1, totalParts: transcodeParts.length,
                ...(partSend.success ? {} : { errorMessage: partSend.errorMessage }),
              },
            });
            sentMessages.push(msg);

            const { emitNewMessage } = await import("../services/socket.service");
            emitNewMessage(String(conv.tenantId), String(conv._id), msg.toObject());
          }

          conv.lastMessageAt = new Date();
          await conv.save();

          const allSuccess = sentMessages.every((m: any) => m.deliveryStatus === "sent");
          return res.json({
            success: allSuccess,
            totalParts: transcodeParts.length,
            messages: sentMessages.map((m: any) => ({ _id: m._id, deliveryStatus: m.deliveryStatus })),
          });
        }

        const uploadResult = await whatsappService.uploadMedia({
          tenantId: String(conv.tenantId),
          ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
          buffer,
          mimeType,
          fileName,
        });

        console.log(`[media-upload] WhatsApp uploadMedia result: success=${uploadResult.success}, mediaId=${uploadResult.mediaId || 'none'}, error=${uploadResult.errorMessage || 'none'}`);

        if (!uploadResult.success || !uploadResult.mediaId) {
          const failedMsg = await MessageModel.create({
            conversationId: conv._id,
            tenantId: conv.tenantId,
            ...(conv.channelId ? { channelId: conv.channelId } : {}),
            direction: "OUTBOUND",
            content: fileName,
            type: mediaType as any,
            channel: conv.channel,
            isInternal: false,
            ...mediaSenderFields,
            deliveryStatus: "failed",
            metadata: { mimeType, fileName, fileSize: buffer.length, errorMessage: uploadResult.errorMessage },
          });
          conv.lastMessageAt = new Date();
          await conv.save();
          const { emitNewMessage } = await import("../services/socket.service");
          emitNewMessage(String(conv.tenantId), String(conv._id), failedMsg.toObject());
          return res.status(500).json({ message: uploadResult.errorMessage || "Failed to upload media to WhatsApp" });
        }

        let waMediaType = mediaType === "AUDIO" ? "audio" : mediaType === "IMAGE" ? "image" : mediaType === "VIDEO" ? "video" : "document";
        if (sendAsDocument && waMediaType === "video") {
          console.log(`[media-upload] Video exceeds 16MB limit after transcoding. Sending as document instead.`);
          waMediaType = "document";
        }

        const caption = req.query.caption as string | undefined;
        console.log(`[media-upload] Sending media message: recipient=${recipient}, mediaType=${waMediaType}, mediaId=${uploadResult.mediaId}, fileName=${fileName}`);
        const sendResult = await whatsappService.sendMediaMessage({
          recipient,
          tenantId: String(conv.tenantId),
          ...(conv.channelId ? { channelId: String(conv.channelId) } : {}),
          mediaType: waMediaType as any,
          mediaId: uploadResult.mediaId,
          fileName: waMediaType === "document" ? fileName : undefined,
          caption: caption || undefined,
        });
        console.log(`[media-upload] sendMediaMessage result: success=${sendResult.success}, messageId=${sendResult.messageId || 'none'}, error=${sendResult.errorMessage || 'none'}`);

        const msg = await MessageModel.create({
          conversationId: conv._id,
          tenantId: conv.tenantId,
          ...(conv.channelId ? { channelId: conv.channelId } : {}),
          direction: "OUTBOUND",
          content: caption || fileName,
          type: mediaType as any,
          channel: conv.channel,
          isInternal: false,
          ...mediaSenderFields,
          deliveryStatus: sendResult.success ? "sent" : "failed",
          metadata: {
            mimeType,
            fileName,
            fileSize: buffer.length,
            waMessageId: sendResult.messageId,
            waMediaId: uploadResult.mediaId,
            mediaStatus: "completed",
            ...(caption ? { caption } : {}),
            ...(sendResult.success ? {} : { errorMessage: sendResult.errorMessage }),
          },
        });

        {
          let storageBuffer = buffer;
          let storageMimeType = mimeType;

          if (storageMimeType.startsWith("video/")) {
            try {
              const { processVideoForBrowserCompat } = await import("../services/video-processing.service");
              const result = await processVideoForBrowserCompat(storageBuffer, storageMimeType);
              storageBuffer = result.buffer;
              storageMimeType = result.mimeType;
            } catch (videoErr: any) {
              console.warn(`[media-upload] Video processing failed for outbound message, using original: ${videoErr.message}`);
            }
          }

          const { uploadMedia: uploadToMinio, buildMediaKey } = await import("../services/storage.service");
          const ext = storageMimeType.split("/")[1]?.split(";")[0] || "bin";
          const key = buildMediaKey(String(conv.tenantId), String(msg._id), `${fileName}.${ext}`);
          await uploadToMinio(storageBuffer, key, storageMimeType);
          await MessageModel.findByIdAndUpdate(msg._id, {
            $set: { "metadata.mediaKey": key, "metadata.mimeType": storageMimeType },
          });
        }

        conv.lastMessageAt = new Date();
        await conv.save();

        const { emitNewMessage } = await import("../services/socket.service");
        const updatedMsg = await MessageModel.findById(msg._id).lean();
        emitNewMessage(String(conv.tenantId), String(conv._id), updatedMsg || msg.toObject());

        if (!sendResult.success) {
          return res.status(500).json({ message: sendResult.errorMessage || "Failed to send media" });
        }

        return res.status(201).json(updatedMsg || msg);
      }

      const msg = await MessageModel.create({
        conversationId: conv._id,
        tenantId: conv.tenantId,
        ...(conv.channelId ? { channelId: conv.channelId } : {}),
        direction: "OUTBOUND",
        content: fileName,
        type: mediaType as any,
        channel: conv.channel,
        isInternal: false,
        ...mediaSenderFields,
        deliveryStatus: "sent",
        metadata: {
          mimeType,
          fileName,
          fileSize: buffer.length,
          mediaStatus: "completed",
        },
      });

      {
        const { uploadMedia: uploadToMinio, buildMediaKey } = await import("../services/storage.service");
        const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
        const key = buildMediaKey(String(conv.tenantId), String(msg._id), `${fileName}.${ext}`);
        await uploadToMinio(buffer, key, mimeType);
        await MessageModel.findByIdAndUpdate(msg._id, { $set: { "metadata.mediaKey": key } });
      }

      conv.lastMessageAt = new Date();
      await conv.save();

      const { emitNewMessage } = await import("../services/socket.service");
      emitNewMessage(String(conv.tenantId), String(conv._id), msg.toObject());

      res.status(201).json(msg);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inbox/messages/:messageId/media", requireAuth, requireRole("superadmin", "businessadmin", "teamleader", "employee"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const MessageModel = getMessageModel(req.tenantDbConnection!);
      const msg = await MessageModel.findById(req.params.messageId);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      if (String(msg.tenantId) !== String(req.query.tenantId || req.user?.tenantId)) return res.status(403).json({ message: "Forbidden" });

      const md = msg.metadata as any;

      if (md?.mediaKey) {
        return res.json({ useStream: true, mimeType: md.mimeType || "application/octet-stream", fileName: md.fileName || md.mediaInfo?.fileName });
      }

      if (md?.base64) {
        return res.json({ base64: md.base64, mimeType: md.mimeType || "application/octet-stream", fileName: md.fileName });
      }

      const mediaInfo = md?.mediaInfo;
      if (mediaInfo?.base64) {
        return res.json({ base64: mediaInfo.base64, mimeType: mediaInfo.mimeType || "application/octet-stream", fileName: mediaInfo.fileName });
      }

      if (!mediaInfo?.mediaId) {
        return res.status(404).json({ message: "No media associated with this message" });
      }

      const creds = await whatsappService.getCredentials(String(msg.tenantId));
      const accessToken = creds?.accessToken || "";

      const downloaded = await whatsappService.downloadMediaAsBuffer(mediaInfo.mediaId, accessToken, String(msg.tenantId));
      if (!downloaded) {
        return res.status(502).json({ message: "Failed to download media from WhatsApp" });
      }

      const { uploadMedia, buildMediaKey } = await import("../services/storage.service");
      const ext = downloaded.mimeType.split("/")[1]?.split(";")[0] || "bin";
      const key = buildMediaKey(String(msg.tenantId), String(msg._id), `media.${ext}`);
      await uploadMedia(downloaded.buffer, key, downloaded.mimeType);

      await MessageModel.findByIdAndUpdate(msg._id, {
        $set: {
          "metadata.mimeType": downloaded.mimeType,
          "metadata.mediaStatus": "completed",
          "metadata.mediaKey": key,
        },
        $unset: { "metadata.base64": "", "metadata.mediaInfo.base64": "" },
      });

      res.json({ useStream: true, mimeType: downloaded.mimeType, fileName: mediaInfo.fileName });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inbox/conversations/:id/assign-customer", requireAuth, requireRole("superadmin", "businessadmin", "teamleader"), requireTenant, requireTenantDb, async (req, res) => {
    try {
      const { targetTenantId, firstName, lastName } = req.body;
      if (!targetTenantId || !firstName) {
        return res.status(400).json({ message: "targetTenantId and firstName are required" });
      }

      const ConversationModel = getConversationModel(req.tenantDbConnection!);
      const CustomerModel = getCustomerModel(req.tenantDbConnection!);
      const { TenantModel } = await import("../models/tenant.model");

      const conv = await ConversationModel.findById(req.params.id);
      if (!conv) return res.status(404).json({ message: "Conversation not found" });

      const targetTenant = await TenantModel.findById(targetTenantId);
      if (!targetTenant) return res.status(404).json({ message: "Target tenant not found" });

      const currentTenantId = String(conv.tenantId);
      const isCrossTenant = currentTenantId !== targetTenantId;

      const customer = await CustomerModel.findById(conv.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      customer.firstName = firstName.trim();
      customer.lastName = (lastName || "").trim();
      if (isCrossTenant) {
        customer.tenantId = targetTenantId;
      }
      await customer.save();

      if (isCrossTenant) {
        const MessageModel = getMessageModel(req.tenantDbConnection!);
        const messages = await MessageModel.find({ conversationId: conv._id }).lean();

        const { tenantDbManager } = await import("../lib/db-manager");
        const target = await TenantModel.findById(targetTenantId).select("+tenantDbUri");
        const envDbUrl = process.env.DATABASE_URL;
        const mongoEnvUrl = envDbUrl && envDbUrl.startsWith("mongodb") ? envDbUrl : undefined;
        const dbUri = target?.tenantDbUri || mongoEnvUrl || process.env.MONGODB_URI || "mongodb://localhost:27017/cpaas-platform";
        const targetConn = await tenantDbManager.getTenantConnection(targetTenantId, dbUri);

        const TargetConvModel = getConversationModel(targetConn);
        const TargetMsgModel = getMessageModel(targetConn);

        const convData = conv.toObject();
        delete (convData as any)._id;
        convData.tenantId = targetTenantId;
        convData.isOrphan = false;
        delete (convData as any).orphanPhoneNumberId;

        let newConv: any;
        try {
          newConv = await TargetConvModel.create(convData);

          if (messages.length > 0) {
            const migratedMsgs = messages.map((m: any) => {
              const { _id, ...rest } = m;
              return { ...rest, conversationId: newConv._id, tenantId: targetTenantId };
            });
            await TargetMsgModel.insertMany(migratedMsgs);
          }
        } catch (migrationErr: any) {
          if (newConv?._id) {
            await TargetConvModel.findByIdAndDelete(newConv._id).catch(() => {});
            await TargetMsgModel.deleteMany({ conversationId: newConv._id }).catch(() => {});
          }
          throw new Error(`Cross-tenant migration failed: ${migrationErr.message}`);
        }

        await MessageModel.deleteMany({ conversationId: conv._id });
        await ConversationModel.findByIdAndDelete(conv._id);

        const tenantName = targetTenant.nameHe || targetTenant.nameEn || targetTenant.slug;
        return res.json({
          success: true,
          customerName: `${firstName} ${lastName || ""}`.trim(),
          tenantName,
          newConversationId: String(newConv._id),
          crossTenant: true,
        });
      }

      conv.isOrphan = false;
      conv.orphanPhoneNumberId = undefined;
      await conv.save();

      const tenantName = targetTenant.nameHe || targetTenant.nameEn || targetTenant.slug;
      res.json({
        success: true,
        customerName: `${firstName} ${lastName || ""}`.trim(),
        tenantName,
        crossTenant: false,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
