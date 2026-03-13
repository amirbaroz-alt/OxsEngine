import "../setup";
import express from "express";
import { createServer } from "http";
import type { Server } from "http";
import request from "supertest";
import mongoose from "mongoose";
import { createTestTenant, createAuthenticatedUser } from "../helpers/auth-helper";

jest.setTimeout(60000);

jest.mock("../../server/index", () => ({
  log: jest.fn(),
}));

let app: express.Express;
let httpServer: Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  httpServer = createServer(app);

  const { registerRoutes } = await import("../../server/routes");
  await registerRoutes(httpServer, app);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const { tenantDbManager } = await import("../../server/lib/db-manager");
  await tenantDbManager.closeAll();
  httpServer.close();
});

async function freshCtx(role = "superadmin") {
  const slug = `chaos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  return createAuthenticatedUser(tenantId, role);
}

async function createConversation(tenantId: string, overrides: Record<string, any> = {}) {
  const { getCustomerModel } = await import("../../server/models/customer.model");
  const { getConversationModel } = await import("../../server/models/conversation.model");
  const { tenantDbManager } = await import("../../server/lib/db-manager");

  const uri = process.env.MONGODB_URI!;
  const conn = await tenantDbManager.getTenantConnection(tenantId, uri);
  const CustomerModel = getCustomerModel(conn);
  const ConversationModel = getConversationModel(conn);

  const customer = await CustomerModel.create({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    firstName: "Chaos",
    lastName: `Test-${Date.now()}`,
    phone: `05${Math.floor(10000000 + Math.random() * 90000000)}`,
    channel: "WHATSAPP",
  });

  const conv = await ConversationModel.create({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    customerId: customer._id,
    status: "ACTIVE",
    channel: "WHATSAPP",
    unreadCount: 0,
    lastMessageAt: new Date(),
    ...overrides,
  });

  return { customer, conv, conn, CustomerModel, ConversationModel };
}

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
}

describe("Ultimate Chaos Suite", () => {

  describe("1. Security, Isolation & Auth Chaos (Zero Trust)", () => {

    it("Cross-Pollination Attack: payload tenantId of Tenant B is ignored when authed as Tenant A", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await freshCtx("employee");

      const { conv: convA } = await createConversation(ctxA.tenantId);

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctxA.token}`)
        .query({ tenantId: ctxB.tenantId });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Access denied to this tenant");

      const res2 = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctxA.token}`);

      expect(res2.status).toBe(200);
      if (Array.isArray(res2.body)) {
        for (const c of res2.body) {
          expect(String(c.tenantId)).toBe(ctxA.tenantId);
        }
      }

      const res3 = await request(app)
        .patch(`/api/inbox/conversations/${convA._id}/resolve`)
        .set("Authorization", `Bearer ${ctxB.token}`)
        .send({ tenantId: ctxA.tenantId });

      expect([403, 404]).toContain(res3.status);
    });

    it("Deactivated Tenant Mid-Flight: returns 503 when tenant DB connection is blocked", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const ctx = await freshCtx("employee");

      jest.spyOn(tenantDbManager, "getTenantConnection").mockRejectedValue(
        new Error("Tenant deactivated — connection blocked")
      );

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctx.token}`);

      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Tenant database unavailable");
    });

    it("Deactivated user session returns 401", async () => {
      const { UserModel } = await import("../../server/models/user.model");
      const ctx = await freshCtx("employee");

      await UserModel.findByIdAndUpdate(ctx.userId, { active: false });

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctx.token}`);

      expect(res.status).toBe(401);
    });
  });

  describe("2. Database & Resource Exhaustion (Noisy Neighbor)", () => {

    it("Event Loop & Pool Exhaustion: Tenant B is not starved by 50 concurrent Tenant A requests", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await freshCtx("employee");

      await createConversation(ctxA.tenantId);
      await createConversation(ctxB.tenantId);

      const tenantARequests = Array.from({ length: 50 }, () =>
        request(app)
          .get("/api/inbox/conversations")
          .set("Authorization", `Bearer ${ctxA.token}`)
      );

      const tenantBRequests = Array.from({ length: 5 }, () =>
        request(app)
          .get("/api/inbox/conversations")
          .set("Authorization", `Bearer ${ctxB.token}`)
      );

      const allResults = await Promise.all([...tenantARequests, ...tenantBRequests]);

      const tenantBResults = allResults.slice(50);
      for (const res of tenantBResults) {
        expect(res.status).toBe(200);
      }

      const tenantASuccesses = allResults.slice(0, 50).filter((r) => r.status === 200).length;
      expect(tenantASuccesses).toBeGreaterThan(0);
    });

    it("Mid-Query DB Drop: gracefully catches connection drop and returns 500", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const { _getTenantUriCache } = await import("../../server/middleware/auth.middleware");
      const ctx = await freshCtx("employee");

      _getTenantUriCache().clear();

      const originalGetConn = tenantDbManager.getTenantConnection.bind(tenantDbManager);

      jest.spyOn(tenantDbManager, "getTenantConnection").mockImplementation(async (...args: any[]) => {
        const conn = await originalGetConn(...(args as [string, string]));

        const fakeConn = Object.create(conn);
        const origModel = conn.model.bind(conn);
        Object.defineProperty(fakeConn, "readyState", { get: () => 1 });
        fakeConn.models = conn.models;
        fakeConn.model = function (...mArgs: any[]) {
          const Model = origModel(...(mArgs as [string]));
          Model.find = function () {
            throw new Error("MongoNetworkError: connection closed");
          };
          return Model;
        };

        return fakeConn;
      });

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctx.token}`);

      expect([500, 503]).toContain(res.status);
    });
  });

  describe("3. WhatsApp Webhook & Third-Party Chaos", () => {

    it("Malformed Meta Payload: missing messages structure returns 200 without crashing", async () => {
      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");

      const malformedPayloads = [
        { object: "whatsapp_business_account" },
        { object: "whatsapp_business_account", entry: [] },
        { object: "whatsapp_business_account", entry: [{}] },
        { object: "whatsapp_business_account", entry: [{ changes: [] }] },
        { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages" }] }] },
        { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {} }] }] },
        { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [] } }] }] },
        { object: "not_whatsapp" },
        {},
        null,
        undefined,
      ];

      for (const payload of malformedPayloads) {
        const result = await whatsappWebhookService.processIncomingWebhook(payload);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
      }
    });

    it("Media Download Timeout: processDeferredMedia catches timeout and sets status to failed", async () => {
      const { whatsappMediaService } = await import("../../server/services/whatsapp-media.service");
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const { getMessageModel } = await import("../../server/models/message.model");
      const axios = (await import("axios")).default;

      const tenantId = await createTestTenant({ slug: `media-timeout-${Date.now()}` });
      const uri = process.env.MONGODB_URI!;
      const conn = await tenantDbManager.getTenantConnection(tenantId, uri);
      const MsgModel = getMessageModel(conn);

      const convId = new mongoose.Types.ObjectId();
      const msg = await MsgModel.create({
        conversationId: convId,
        tenantId: new mongoose.Types.ObjectId(tenantId),
        direction: "INBOUND",
        content: "[image]",
        type: "IMAGE",
        channel: "WHATSAPP",
        isInternal: false,
        metadata: { waMessageId: `wamid.timeout_${Date.now()}`, mediaId: "fake-media-id", mediaStatus: "pending" },
      });

      jest.spyOn(axios, "get").mockImplementation(() =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("timeout of 30000ms exceeded")), 50);
        })
      );

      jest.spyOn(whatsappMediaService as any, "getTenantDbConnection").mockResolvedValue(conn);

      await whatsappMediaService.processDeferredMedia(
        String(msg._id),
        "fake-media-id",
        "fake-access-token",
        tenantId,
        convId.toString()
      );

      const updated = await MsgModel.findById(msg._id).lean();
      expect(updated).toBeTruthy();
      expect((updated as any).metadata?.mediaStatus).toBe("failed");
    });
  });

  describe("4. Business Logic Concurrency (Race Conditions)", () => {

    it("Concurrent Agent Resolution: two agents resolve same conversation simultaneously without crash", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await createAuthenticatedUser(ctxA.tenantId, "employee", {
        name: "Agent B",
        email: `agent-b-${Date.now()}@test.com`,
        phone: `05${Math.floor(10000000 + Math.random() * 90000000)}`,
      });

      const { conv } = await createConversation(ctxA.tenantId, {
        assignedTo: new mongoose.Types.ObjectId(ctxA.userId),
        assignedName: "Agent A",
      });

      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/inbox/conversations/${conv._id}/resolve`)
          .set("Authorization", `Bearer ${ctxA.token}`)
          .send({ resolutionTag: "done-A" }),
        request(app)
          .patch(`/api/inbox/conversations/${conv._id}/resolve`)
          .set("Authorization", `Bearer ${ctxB.token}`)
          .send({ resolutionTag: "done-B" }),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).not.toContain(500);
      const successCount = statuses.filter((s) => s === 200).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      const { getConversationModel } = await import("../../server/models/conversation.model");
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const conn = await tenantDbManager.getTenantConnection(ctxA.tenantId, process.env.MONGODB_URI!);
      const ConvModel = getConversationModel(conn);
      const finalConv = await ConvModel.findById(conv._id).lean();
      expect(finalConv).toBeTruthy();
      expect((finalConv as any).status).toBe("RESOLVED");
    });

    it("Thundering Herd Upsert: 5 identical webhook payloads produce exactly 1 message", async () => {
      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");
      const { ChannelModel } = await import("../../server/models/channel.model");
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const { getMessageModel } = await import("../../server/models/message.model");

      const tenantId = await createTestTenant({
        slug: `herd-${Date.now()}`,
        nameEn: "Herd Test",
      });

      const conn = await tenantDbManager.getTenantConnection(tenantId, process.env.MONGODB_URI!);
      const MsgModel = getMessageModel(conn);
      await MsgModel.ensureIndexes();

      const channel = await ChannelModel.create({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        name: "Herd WA Channel",
        type: "WHATSAPP",
        status: "active",
        isActive: true,
        phoneNumberId: `herd-pnid-${Date.now()}`,
        accessToken: "fake-token",
        verifyToken: "fake-verify",
      });

      jest.spyOn(whatsappWebhookService as any, "findTenantByPhoneNumberId").mockResolvedValue({
        tenant: await TenantModel.findById(tenantId).lean(),
        credentials: {
          phoneNumberId: channel.phoneNumberId,
          accessToken: "fake-token",
          verifyToken: "fake-verify",
        },
        channelId: String(channel._id),
      });

      jest.spyOn(whatsappWebhookService as any, "batchMarkMessageRead").mockImplementation(() => {});

      const sharedWamid = `wamid.herd_test_${Date.now()}`;
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const payload = {
        object: "whatsapp_business_account",
        entry: [{
          id: "test-waba",
          changes: [{
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: channel.phoneNumberId, display_phone_number: "15551234567" },
              contacts: [{ profile: { name: "Herd User" }, wa_id: "972501234567" }],
              messages: [{
                from: "972501234567",
                id: sharedWamid,
                timestamp,
                type: "text",
                text: { body: "Thundering herd test message" },
              }],
            },
          }],
        }],
      };

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          whatsappWebhookService.processIncomingWebhook({ ...payload, _webhookReceivedAt: Date.now() })
        )
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const rejected = results.filter((r) => r.status === "rejected");
      for (const r of rejected) {
        if (r.status === "rejected") {
          const errMsg = r.reason?.message || "";
          expect(errMsg).not.toContain("UnhandledPromiseRejection");
        }
      }

      await waitForCondition(async () => {
        const count = await MsgModel.countDocuments({ "metadata.waMessageId": sharedWamid });
        return count >= 1;
      }, 5000);

      const msgs = await MsgModel.find({ "metadata.waMessageId": sharedWamid }).lean();
      expect(msgs.length).toBe(1);
    });
  });
});
