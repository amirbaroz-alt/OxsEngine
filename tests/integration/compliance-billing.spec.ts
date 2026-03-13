import "../setup";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

jest.mock("../../server/index", () => ({
  log: jest.fn(),
}));

jest.mock("../../server/middleware/auth.middleware", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  requireTenant: (req: any, _res: any, next: any) => next(),
  requireTenantDb: (req: any, _res: any, next: any) => next(),
}));

jest.mock("../../server/services/socket.service", () => ({
  emitNewMessage: jest.fn(),
  emitNewConversation: jest.fn(),
  emitMessageStatus: jest.fn(),
  emitConversationAssigned: jest.fn(),
  emitStatusChanged: jest.fn(),
  emitTemplateUpdate: jest.fn(),
}));

jest.mock("../../server/services/change-stream.service", () => ({
  markLocalEmit: jest.fn(),
}));

jest.mock("../../server/services/communication-log.service", () => ({
  communicationLogService: {
    create: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../server/services/routing.service", () => ({
  routeConversation: jest.fn().mockResolvedValue({ rule: "pool" }),
}));

jest.mock("../../server/services/whatsapp-media.service", () => ({
  whatsappMediaService: {
    extractMediaFromMessage: jest.fn().mockReturnValue({}),
    extractLocationFromMessage: jest.fn().mockReturnValue(undefined),
    extractContactsFromMessage: jest.fn().mockReturnValue(undefined),
    getMessageType: jest.fn().mockReturnValue("TEXT"),
    processDeferredMediaWithRetry: jest.fn(),
    validateMediaToken: jest.fn(),
    fetchMediaMetadata: jest.fn(),
    downloadMediaAsBuffer: jest.fn(),
    downloadMediaAsBase64: jest.fn(),
    downloadMediaDirect: jest.fn(),
  },
  META_GRAPH_API: "https://graph.facebook.com/v21.0",
  isMetaTokenError: jest.fn().mockReturnValue(false),
}));

jest.mock("axios", () => ({
  default: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

function buildApp(tenantId: string, conn: mongoose.Connection) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = {
      _id: new mongoose.Types.ObjectId(),
      name: "Agent",
      role: "superadmin",
      tenantId,
    };
    req.tenantDbConnection = conn;
    next();
  });
  return app;
}

function buildWebhookPayload(phoneNumberId: string, messages: any[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_ID",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { phone_number_id: phoneNumberId, display_phone_number: "15551234567" },
          contacts: [{ profile: { name: "Test User" } }],
          messages,
        },
      }],
    }],
  };
}

describe("Compliance & Billing Suite", () => {
  describe("Test A: Flexi-Quota (999999 default allows sends)", () => {
    it("allows a tenant with 999999 quota to send messages without blocking", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { getConversationModel } = await import("../../server/models/conversation.model");
      const whatsappMod = await import("../../server/services/whatsapp.service");
      const sendSpy = jest.spyOn(whatsappMod.whatsappService, "sendTextMessage")
        .mockResolvedValue({ success: true, messageId: "wamid.test123" } as any);

      const tenant = await TenantModel.create({
        nameHe: "Flexi Test",
        nameEn: "Flexi Test",
        slug: "flexi-test-" + Date.now(),
        monthlyMessageQuota: 999999,
        messagesUsedThisMonth: 500,
        active: true,
      });

      const conn = mongoose.createConnection(process.env.MONGODB_URI!, {
        dbName: `tenant_flexi_${Date.now()}`,
      });
      const ConvModel = getConversationModel(conn);
      const { CustomerModel } = await import("../../server/models/customer.model");

      const customer = await CustomerModel.create({
        tenantId: tenant._id,
        phone: "+972501234567",
        firstName: "Test",
        lastName: "Customer",
      });

      const conv = await ConvModel.create({
        tenantId: tenant._id,
        customerId: customer._id,
        channel: "WHATSAPP",
        status: "UNASSIGNED",
        lastInboundAt: new Date(),
      });

      const app = buildApp(String(tenant._id), conn);
      const { registerInboxRoutes } = await import("../../server/routes/inbox");
      registerInboxRoutes(app);

      const res = await request(app)
        .post(`/api/inbox/conversations/${conv._id}/messages?tenantId=${tenant._id}`)
        .send({ content: "Hello from flexi tenant!" });

      expect(res.status).not.toBe(402);
      expect(sendSpy).toHaveBeenCalled();

      const updated = await TenantModel.findById(tenant._id);
      expect(updated!.messagesUsedThisMonth).toBe(501);

      sendSpy.mockRestore();
      await conn.close();
    });
  });

  describe("Test B: Hard Limit (quota 2, blocked on 3rd)", () => {
    it("rejects outbound message with 402 when quota is exhausted and never calls Meta API", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { getConversationModel } = await import("../../server/models/conversation.model");
      const whatsappMod = await import("../../server/services/whatsapp.service");
      const sendSpy = jest.spyOn(whatsappMod.whatsappService, "sendTextMessage");

      const tenant = await TenantModel.create({
        nameHe: "Hard Limit",
        nameEn: "Hard Limit",
        slug: "hard-limit-" + Date.now(),
        monthlyMessageQuota: 2,
        messagesUsedThisMonth: 2,
        active: true,
      });

      const conn = mongoose.createConnection(process.env.MONGODB_URI!, {
        dbName: `tenant_hardlimit_${Date.now()}`,
      });
      const ConvModel = getConversationModel(conn);

      const conv = await ConvModel.create({
        tenantId: tenant._id,
        customerId: new mongoose.Types.ObjectId(),
        channel: "WHATSAPP",
        status: "UNASSIGNED",
        lastInboundAt: new Date(),
      });

      const app = buildApp(String(tenant._id), conn);
      const { registerInboxRoutes } = await import("../../server/routes/inbox");
      registerInboxRoutes(app);

      const res = await request(app)
        .post(`/api/inbox/conversations/${conv._id}/messages?tenantId=${tenant._id}`)
        .send({ content: "This should be blocked!" });

      expect(res.status).toBe(402);
      expect(res.body.message).toBe("QUOTA_EXCEEDED");
      expect(sendSpy).not.toHaveBeenCalled();

      sendSpy.mockRestore();
      await conn.close();
    });
  });

  describe("Test C: Inbound Tracking (webhook increments counter)", () => {
    it("increments inboundMessagesThisMonth for every valid incoming message", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { tenantDbManager } = await import("../../server/lib/db-manager");

      const tenant = await TenantModel.create({
        nameHe: "Inbound Track",
        nameEn: "Inbound Track",
        slug: "inbound-track-" + Date.now(),
        active: true,
        inboundMessagesThisMonth: 0,
      });

      const tenantId = String(tenant._id);
      const phoneNumberId = `PH_INBOUND_${Date.now()}`;

      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");

      jest.spyOn(whatsappWebhookService, "findTenantByPhoneNumberId").mockImplementation(
        async (pnId: string) => {
          if (pnId === phoneNumberId) {
            return {
              tenant: tenant.toObject(),
              credentials: {
                phoneNumberId,
                accessToken: "test-access-token",
                verifyToken: "test-verify-token",
              },
              channelId: undefined,
            };
          }
          return null;
        }
      );

      jest.spyOn(whatsappWebhookService as any, "getTenantDbConnection")
        .mockResolvedValue(mongoose.connection);

      const payload = buildWebhookPayload(phoneNumberId, [
        {
          id: `wamid.inbound_${Date.now()}_1`,
          from: "972501111111",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "First message" },
        },
        {
          id: `wamid.inbound_${Date.now()}_2`,
          from: "972501111111",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Second message" },
        },
      ]);

      await whatsappWebhookService.processIncomingWebhook(payload);

      const updated = await TenantModel.findById(tenant._id);
      expect(updated!.inboundMessagesThisMonth).toBe(2);

      jest.restoreAllMocks();
      await tenantDbManager.closeAll();
    });
  });

  describe("Test D: GDPR Right to be Forgotten (Data Purge)", () => {
    it("drops all tenant collections and marks tenant inactive", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { getMessageModel } = await import("../../server/models/message.model");
      const { tenantService } = await import("../../server/services/tenant.service");

      const tenantDbUri = process.env.MONGODB_URI!;
      const dbName = `tenant_gdpr_${Date.now()}`;
      const fullUri = tenantDbUri.replace(/\/?(\?|$)/, `/${dbName}$1`);

      const tenant = await TenantModel.create({
        nameHe: "GDPR Test",
        nameEn: "GDPR Test",
        slug: "gdpr-test-" + Date.now(),
        tenantDbUri: fullUri,
        active: true,
      });

      const tenantConn = mongoose.createConnection(tenantDbUri, { dbName });
      await tenantConn.asPromise();
      const MsgModel = getMessageModel(tenantConn);
      await MsgModel.ensureIndexes();

      for (let i = 0; i < 5; i++) {
        await MsgModel.create({
          conversationId: new mongoose.Types.ObjectId(),
          tenantId: tenant._id,
          direction: "INBOUND",
          content: `Test message ${i}`,
          type: "TEXT",
          channel: "WHATSAPP",
        });
      }

      const countBefore = await MsgModel.countDocuments();
      expect(countBefore).toBe(5);
      await tenantConn.close();

      await tenantService.purgeTenantData(String(tenant._id));

      const updatedTenant = await TenantModel.findById(tenant._id);
      expect(updatedTenant!.active).toBe(false);

      const verifyConn = mongoose.createConnection(tenantDbUri, { dbName });
      await verifyConn.asPromise();
      const collections = await verifyConn.db.listCollections().toArray();
      const dataCollections = collections.filter((c) => !c.name.startsWith("system."));
      expect(dataCollections.length).toBe(0);

      await verifyConn.close();
    });
  });
});
