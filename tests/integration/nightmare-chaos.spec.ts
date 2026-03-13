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
  app.use(express.json({ limit: "50mb" }));
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
  const slug = `nightmare-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  return createAuthenticatedUser(tenantId, role);
}

async function getTenantConn(tenantId: string) {
  const { tenantDbManager } = await import("../../server/lib/db-manager");
  const uri = process.env.MONGODB_URI!;
  return tenantDbManager.getTenantConnection(tenantId, uri);
}

async function createConversation(tenantId: string, overrides: Record<string, any> = {}) {
  const { CustomerModel } = await import("../../server/models/customer.model");
  const { getConversationModel } = await import("../../server/models/conversation.model");

  const conn = await getTenantConn(tenantId);
  const ConversationModel = getConversationModel(conn);

  const customer = await CustomerModel.create({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    firstName: "Nightmare",
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
    lastInboundAt: new Date(),
    ...overrides,
  });

  return { customer, conv, conn, ConversationModel };
}

describe("Nightmare Chaos Suite", () => {
  describe("1. Zombie Connection Cache (LRU Eviction)", () => {
    it("cache size never exceeds MAX_CACHE_SIZE when requesting 60 unique tenant connections", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const maxSize = tenantDbManager.getMaxCacheSize();
      const uri = process.env.MONGODB_URI!;

      for (let i = 0; i < 60; i++) {
        const fakeTenantId = new mongoose.Types.ObjectId().toString();
        await tenantDbManager.getTenantConnection(fakeTenantId, uri);

        const currentSize = tenantDbManager.getActiveConnectionCount();
        expect(currentSize).toBeLessThanOrEqual(maxSize);
      }

      expect(tenantDbManager.getActiveConnectionCount()).toBeLessThanOrEqual(maxSize);

      await tenantDbManager.closeAll();
    });
  });

  describe("2. The Time-Traveler Webhook (Out-of-Order Status)", () => {
    it("gracefully handles a 'read' status for a non-existent wamid without throwing", async () => {
      const ctx = await freshCtx();
      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");
      const { TenantModel } = await import("../../server/models/tenant.model");

      const tenant = await TenantModel.findById(ctx.tenantId).lean();

      jest.spyOn(whatsappWebhookService as any, "findTenantByPhoneNumberId").mockResolvedValue({
        tenant,
        credentials: { accessToken: "FAKE", phoneNumberId: "PHONE_ID_TEST" },
        channelId: null,
      });

      const nonExistentWamid = `wamid.GHOST_${Date.now()}_DOESNOTEXIST`;

      const webhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA_ID_TEST",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15551234567",
                    phone_number_id: "PHONE_ID_TEST",
                  },
                  statuses: [
                    {
                      id: nonExistentWamid,
                      status: "read",
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      recipient_id: "972501234567",
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
        _webhookReceivedAt: Date.now(),
      };

      let threw = false;
      try {
        await whatsappWebhookService.processIncomingWebhook(webhookPayload);
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);

      const conn = await getTenantConn(ctx.tenantId);
      const { getMessageModel } = await import("../../server/models/message.model");
      const MessageModel = getMessageModel(conn);
      const found = await MessageModel.findOne({ "metadata.waMessageId": nonExistentWamid }).lean();
      expect(found).toBeNull();
    });
  });

  describe("3. The Partial Failure (Meta API 500 on Outbound Send)", () => {
    it("saves message with deliveryStatus 'failed' when Meta Graph API returns 500", async () => {
      const ctx = await freshCtx();
      const { conv, conn } = await createConversation(ctx.tenantId);

      const axios = await import("axios");
      jest.spyOn(axios.default, "post").mockRejectedValue({
        response: {
          status: 500,
          data: {
            error: {
              message: "Internal Server Error from Meta",
              code: 2,
              type: "OAuthException",
            },
          },
        },
        message: "Request failed with status code 500",
      });

      const channelService = await import("../../server/services/channel.service");
      jest.spyOn(channelService, "getDefaultWhatsAppChannel").mockResolvedValue({
        accessToken: "FAKE_TOKEN",
        phoneNumberId: "FAKE_PHONE_ID",
        channelId: "fake-channel-id",
      });

      const res = await request(app)
        .post(`/api/inbox/conversations/${conv._id}/messages`)
        .set("Authorization", `Bearer ${ctx.token}`)
        .send({ content: "Hello from the partial failure test" });

      expect(res.status).toBe(500);
      expect(res.body.failedMessageId).toBeDefined();

      const { getMessageModel } = await import("../../server/models/message.model");
      const MessageModel = getMessageModel(conn);

      const savedMsg = await MessageModel.findById(res.body.failedMessageId).lean();
      expect(savedMsg).not.toBeNull();
      expect(savedMsg!.deliveryStatus).toBe("failed");
      expect(savedMsg!.content).toBe("Hello from the partial failure test");
    });
  });

  describe("4. The Overweight Payload (Oversized Text Truncation)", () => {
    it("truncates a 20,000-char text message to 5,000 chars before saving", async () => {
      const ctx = await freshCtx();
      const conn = await getTenantConn(ctx.tenantId);

      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");
      const { TenantModel } = await import("../../server/models/tenant.model");

      const tenant = await TenantModel.findById(ctx.tenantId).lean();

      jest.spyOn(whatsappWebhookService as any, "findTenantByPhoneNumberId").mockResolvedValue({
        tenant,
        credentials: { accessToken: "FAKE", phoneNumberId: "PHONE_ID_HUGE" },
        channelId: null,
      });

      const hugeText = "X".repeat(20000);
      const fromPhone = "972501112222";
      const waMessageId = `wamid.HUGE_${Date.now()}`;

      const webhookPayload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA_ID_TEST",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15551234567",
                    phone_number_id: "PHONE_ID_HUGE",
                  },
                  contacts: [
                    {
                      profile: { name: "Overweight Tester" },
                      wa_id: fromPhone,
                    },
                  ],
                  messages: [
                    {
                      from: fromPhone,
                      id: waMessageId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: hugeText },
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
        _webhookReceivedAt: Date.now(),
      };

      await whatsappWebhookService.processIncomingWebhook(webhookPayload);

      const { getMessageModel } = await import("../../server/models/message.model");
      const MessageModel = getMessageModel(conn);

      let saved: any = null;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        saved = await MessageModel.findOne({ "metadata.waMessageId": waMessageId }).lean();
        if (saved) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(saved).not.toBeNull();
      expect(saved!.content.length).toBe(5000);
      expect(saved!.content).toBe("X".repeat(5000));
    });
  });
});
