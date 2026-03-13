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
  requireTenant: (_req: any, _res: any, next: any) => next(),
  requireTenantDb: (_req: any, _res: any, next: any) => next(),
}));

let app: express.Express;
let tenantConn: mongoose.Connection;
let tenantId: mongoose.Types.ObjectId;
let convId: mongoose.Types.ObjectId;
let customerId: mongoose.Types.ObjectId;

beforeAll(async () => {
  const { TenantModel } = await import("../../server/models/tenant.model");
  const { getConversationModel } = await import("../../server/models/conversation.model");
  const { CustomerModel } = await import("../../server/models/customer.model");

  const tenant = await TenantModel.create({
    nameHe: "QA Test",
    nameEn: "QA Test",
    slug: "qa-test-" + Date.now(),
    active: true,
    monthlyMessageQuota: 1000,
    messagesUsedThisMonth: 0,
  });
  tenantId = tenant._id;

  customerId = new mongoose.Types.ObjectId();
  const customer = await CustomerModel.create({
    _id: customerId,
    tenantId: tenant._id,
    firstName: "Test",
    lastName: "Customer",
    phone: "972501234567",
    channel: "WHATSAPP",
  });

  tenantConn = mongoose.createConnection(process.env.MONGODB_URI!, {
    dbName: `tenant_qa_${Date.now()}`,
  });
  await tenantConn.asPromise();

  const ConvModel = getConversationModel(tenantConn);
  const conv = await ConvModel.create({
    tenantId: tenant._id,
    customerId: customer._id,
    channel: "WHATSAPP",
    status: "UNASSIGNED",
    lastInboundAt: new Date(),
  });
  convId = conv._id;

  app = express();
  app.use(express.json());

  app.use((req: any, _res: any, next: any) => {
    req.user = {
      _id: new mongoose.Types.ObjectId(),
      name: "Agent",
      role: "superadmin",
      tenantId,
    };
    req.tenantDbConnection = tenantConn;
    next();
  });

  const { registerInboxRoutes } = await import("../../server/routes/inbox");
  registerInboxRoutes(app);
});

afterAll(async () => {
  if (tenantConn) await tenantConn.close();
});

describe("QA & Functional Testing Suite", () => {
  describe("Test 1: E2E Happy Path (Core Flow)", () => {
    it("sends an outbound message and verifies it is saved in the tenant DB", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { CustomerModel } = await import("../../server/models/customer.model");
      await TenantModel.findByIdAndUpdate(tenantId, { messagesUsedThisMonth: 0, monthlyMessageQuota: 1000 }, { upsert: true });
      await CustomerModel.findByIdAndUpdate(customerId, {
        _id: customerId, tenantId, firstName: "Test", lastName: "Customer", phone: "972501234567", channel: "WHATSAPP",
      }, { upsert: true });

      const whatsappMod = await import("../../server/services/whatsapp.service");
      jest.spyOn(whatsappMod.whatsappService, "sendTextMessage").mockResolvedValue({
        success: true,
        messageId: "wamid.test123",
      } as any);

      const sendRes = await request(app)
        .post(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}`)
        .send({ content: "Hello customer!" });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.content).toBe("Hello customer!");
      expect(sendRes.body.direction).toBe("OUTBOUND");

      const fetchRes = await request(app)
        .get(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}&limit=50`);

      expect(fetchRes.status).toBe(200);
      expect(fetchRes.body.messages).toBeDefined();
      expect(fetchRes.body.messages.length).toBe(1);
      expect(fetchRes.body.messages[0].content).toBe("Hello customer!");

      jest.restoreAllMocks();
    });
  });

  describe("Test 2: Pagination & Sorting Stress Test", () => {
    it("bulk inserts 150 messages and returns exactly 50 per page with correct total", async () => {
      const { getMessageModel } = await import("../../server/models/message.model");
      const MsgModel = getMessageModel(tenantConn);

      await MsgModel.deleteMany({ conversationId: convId });

      const docs = [];
      for (let i = 0; i < 150; i++) {
        docs.push({
          conversationId: convId,
          tenantId,
          direction: "INBOUND",
          content: `Message ${String(i).padStart(3, "0")}`,
          type: "TEXT",
          channel: "WHATSAPP",
          createdAt: new Date(Date.now() - (150 - i) * 1000),
        });
      }
      await MsgModel.insertMany(docs);

      const page1 = await request(app)
        .get(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}&limit=50&page=1`);

      expect(page1.status).toBe(200);
      expect(page1.body.messages.length).toBe(50);
      expect(page1.body.totalCount).toBe(150);
      expect(page1.body.page).toBe(1);
      expect(page1.body.limit).toBe(50);

      const page2 = await request(app)
        .get(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}&limit=50&page=2`);

      expect(page2.status).toBe(200);
      expect(page2.body.messages.length).toBe(50);
      expect(page2.body.page).toBe(2);

      const page1Ids = new Set(page1.body.messages.map((m: any) => m._id));
      const page2Ids = new Set(page2.body.messages.map((m: any) => m._id));
      const overlap = [...page2Ids].filter((id) => page1Ids.has(id));
      expect(overlap.length).toBe(0);

      const page3 = await request(app)
        .get(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}&limit=50&page=3`);

      expect(page3.status).toBe(200);
      expect(page3.body.messages.length).toBe(50);
      expect(page3.body.totalCount).toBe(150);
    });
  });

  describe("Test 3: Weird Inputs & Media Types", () => {
    it("Scenario A: saves and retrieves heavy emojis and unicode perfectly", async () => {
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { CustomerModel } = await import("../../server/models/customer.model");

      await TenantModel.findByIdAndUpdate(tenantId, { messagesUsedThisMonth: 0, monthlyMessageQuota: 1000 }, { upsert: true });
      await CustomerModel.findByIdAndUpdate(customerId, {
        _id: customerId, tenantId, firstName: "Test", lastName: "Customer", phone: "972501234567", channel: "WHATSAPP",
      }, { upsert: true });

      const whatsappMod = await import("../../server/services/whatsapp.service");
      jest.spyOn(whatsappMod.whatsappService, "sendTextMessage").mockResolvedValue({
        success: true,
        messageId: "wamid.unicode123",
      } as any);

      const unicodeContent = "🏢 Oks Fintech 🚀 ¯\\_(ツ)_/¯ שלום مرحبا Привет 你好 🎉💯🔥";

      const sendRes = await request(app)
        .post(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}`)
        .send({ content: unicodeContent });

      expect(sendRes.status).toBe(200);
      expect(sendRes.body.content).toBe(unicodeContent);

      const fetchRes = await request(app)
        .get(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}&limit=200`);

      const found = fetchRes.body.messages.find((m: any) => m.content === unicodeContent);
      expect(found).toBeDefined();
      expect(found.content).toBe(unicodeContent);

      jest.restoreAllMocks();
    });

    it("Scenario B: rejects empty/whitespace-only message content with 400", async () => {
      const emptyRes = await request(app)
        .post(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}`)
        .send({ content: "" });
      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.message).toBe("Content is required");

      const whitespaceRes = await request(app)
        .post(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}`)
        .send({ content: "   " });
      expect(whitespaceRes.status).toBe(400);
      expect(whitespaceRes.body.message).toBe("Content is required");

      const missingRes = await request(app)
        .post(`/api/inbox/conversations/${convId}/messages?tenantId=${tenantId}`)
        .send({});
      expect(missingRes.status).toBe(400);
      expect(missingRes.body.message).toBe("Content is required");
    });
  });
});
