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
  app.use(express.json({ limit: "10mb" }));
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
  const slug = `sre-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  return createAuthenticatedUser(tenantId, role);
}

async function getTenantConn(tenantId: string) {
  const { tenantDbManager } = await import("../../server/lib/db-manager");
  const uri = process.env.MONGODB_URI!;
  return tenantDbManager.getTenantConnection(tenantId, uri);
}

describe("SRE Infrastructure Chaos Suite", () => {
  describe("Test 1: Graceful Shutdown Verification", () => {
    it("closes HTTP server and all tenant DB connections on shutdown", async () => {
      const { gracefulShutdown, resetShutdownState } = await import("../../server/lib/graceful-shutdown");

      const testServer = createServer();
      await new Promise<void>((resolve) => testServer.listen(0, resolve));

      const mockTenantDbManager = {
        closeAll: jest.fn().mockResolvedValue(undefined),
      };
      const mockMongoose = {
        disconnect: jest.fn().mockResolvedValue(undefined),
      } as any;

      resetShutdownState();

      await gracefulShutdown("SIGTERM", {
        httpServer: testServer,
        tenantDbManager: mockTenantDbManager,
        mongooseInstance: mockMongoose,
      });

      expect(mockTenantDbManager.closeAll).toHaveBeenCalledTimes(1);
      expect(mockMongoose.disconnect).toHaveBeenCalledTimes(1);

      const isListening = testServer.listening;
      expect(isListening).toBe(false);
    });

    it("idempotent — calling shutdown twice does not double-close", async () => {
      const { gracefulShutdown, resetShutdownState } = await import("../../server/lib/graceful-shutdown");

      const testServer = createServer();
      await new Promise<void>((resolve) => testServer.listen(0, resolve));

      const mockTenantDbManager = {
        closeAll: jest.fn().mockResolvedValue(undefined),
      };
      const mockMongoose = {
        disconnect: jest.fn().mockResolvedValue(undefined),
      } as any;

      resetShutdownState();

      await gracefulShutdown("SIGTERM", {
        httpServer: testServer,
        tenantDbManager: mockTenantDbManager,
        mongooseInstance: mockMongoose,
      });

      await gracefulShutdown("SIGINT", {
        httpServer: testServer,
        tenantDbManager: mockTenantDbManager,
        mongooseInstance: mockMongoose,
      });

      expect(mockTenantDbManager.closeAll).toHaveBeenCalledTimes(1);
      expect(mockMongoose.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("Test 2: DB Write Failure (Disk Full Simulation)", () => {
    it("webhook catches MongoDB write error without crashing the process", async () => {
      const ctx = await freshCtx();
      const conn = await getTenantConn(ctx.tenantId);

      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { getMessageModel } = await import("../../server/models/message.model");

      const tenant = await TenantModel.findById(ctx.tenantId).lean();

      jest.spyOn(whatsappWebhookService as any, "findTenantByPhoneNumberId").mockResolvedValue({
        tenant,
        credentials: { accessToken: "FAKE", phoneNumberId: "PHONE_DISKFULL" },
        channelId: null,
      });

      const MessageModel = getMessageModel(conn);
      jest.spyOn(MessageModel, "create").mockRejectedValue(
        new Error("MongoServerError: Write operation failed: disk full")
      );

      const waMessageId = `wamid.DISKFULL_${Date.now()}`;

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
                    phone_number_id: "PHONE_DISKFULL",
                  },
                  contacts: [
                    {
                      profile: { name: "Disk Full Tester" },
                      wa_id: "972509998888",
                    },
                  ],
                  messages: [
                    {
                      from: "972509998888",
                      id: waMessageId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: "This write will fail" },
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
      } catch (err: any) {
        if (err.isTenantDbError) {
          threw = true;
        }
      }

      expect(threw).toBe(false);
    });
  });

  describe("Test 3: Meta Webhook Retry Storm (Idempotency)", () => {
    it("20 identical webhook payloads produce exactly 1 message", async () => {
      const ctx = await freshCtx();
      const conn = await getTenantConn(ctx.tenantId);

      const { whatsappWebhookService } = await import("../../server/services/whatsapp-webhook.service");
      const { TenantModel } = await import("../../server/models/tenant.model");
      const { getMessageModel } = await import("../../server/models/message.model");

      const tenant = await TenantModel.findById(ctx.tenantId).lean();
      const MsgModel = getMessageModel(conn);

      await MsgModel.ensureIndexes();

      jest.spyOn(whatsappWebhookService as any, "findTenantByPhoneNumberId").mockResolvedValue({
        tenant,
        credentials: { accessToken: "FAKE", phoneNumberId: "PHONE_STORM" },
        channelId: null,
      });

      const waMessageId = `wamid.STORM_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fromPhone = "972507777777";

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
                    phone_number_id: "PHONE_STORM",
                  },
                  contacts: [
                    {
                      profile: { name: "Storm Tester" },
                      wa_id: fromPhone,
                    },
                  ],
                  messages: [
                    {
                      from: fromPhone,
                      id: waMessageId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: "text",
                      text: { body: "Meta retry storm message" },
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

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          whatsappWebhookService.processIncomingWebhook({
            ...webhookPayload,
            _webhookReceivedAt: Date.now(),
          }).catch(() => {})
        );
        if (i % 5 === 4) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      await Promise.all(promises);

      await new Promise((r) => setTimeout(r, 2000));

      const messages = await MsgModel.find({
        "metadata.waMessageId": waMessageId,
      }).lean();

      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Meta retry storm message");
    });
  });
});
