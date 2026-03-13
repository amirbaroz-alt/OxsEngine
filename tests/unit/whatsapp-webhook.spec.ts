import "../setup";
import mongoose from "mongoose";

jest.mock("../../server/index", () => ({
  log: jest.fn(),
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

import { TenantModel } from "../../server/models/tenant.model";
import { MessageModel } from "../../server/models/message.model";
import { tenantDbManager } from "../../server/lib/db-manager";

function buildWebhookPayload(phoneNumberId: string, messages: any[], statuses?: any[]) {
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
          ...(statuses ? { statuses } : {}),
        },
      }],
    }],
  };
}

let _service: any;

async function setupTenantWithChannel() {
  const tenant = await TenantModel.create({
    nameHe: "Test Tenant",
    nameEn: "TestCo",
    slug: `webhook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    active: true,
    defaultLanguage: "he",
  });

  const phoneNumberId = `PH_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tenantId = String(tenant._id);

  jest.spyOn(_service, "findTenantByPhoneNumberId").mockImplementation(
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

  jest.spyOn(_service as any, "getTenantDbConnection").mockResolvedValue(mongoose.connection);

  return { tenant, tenantId, phoneNumberId };
}

describe("WhatsApp Webhook Service — PROD Edge Cases", () => {
  let whatsappWebhookService: any;

  beforeAll(async () => {
    const mod = await import("../../server/services/whatsapp-webhook.service");
    whatsappWebhookService = mod.whatsappWebhookService;
    _service = whatsappWebhookService;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await tenantDbManager.closeAll();
  });

  describe("Test A: Retry Loop Prevention (Phantom Numbers)", () => {
    it("should gracefully ignore payload with unknown phoneNumberId and return empty messages", async () => {
      const payload = buildWebhookPayload("PHANTOM_NUMBER_999", [{
        id: "wamid.phantom_001",
        from: "972501234567",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Hello from unknown" },
      }]);

      const result = await whatsappWebhookService.processIncomingWebhook(payload);

      expect(result).toEqual([]);
    });

    it("should not throw for unknown phoneNumberId (no UnhandledPromiseRejection)", async () => {
      const payload = buildWebhookPayload("TOTALLY_UNKNOWN_ID", [{
        id: "wamid.phantom_002",
        from: "972509876543",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Ghost message" },
      }]);

      await expect(
        whatsappWebhookService.processIncomingWebhook(payload)
      ).resolves.not.toThrow();
    });

    it("should return 200 worth result (empty array) for multiple unknown numbers in batch", async () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA1",
            changes: [{
              field: "messages",
              value: {
                metadata: { phone_number_id: "UNKNOWN_1" },
                contacts: [{ profile: { name: "Phantom 1" } }],
                messages: [{ id: "wamid.phantom_batch_1", from: "1111", timestamp: "1700000000", type: "text", text: { body: "x" } }],
              },
            }],
          },
          {
            id: "WABA2",
            changes: [{
              field: "messages",
              value: {
                metadata: { phone_number_id: "UNKNOWN_2" },
                contacts: [{ profile: { name: "Phantom 2" } }],
                messages: [{ id: "wamid.phantom_batch_2", from: "2222", timestamp: "1700000000", type: "text", text: { body: "y" } }],
              },
            }],
          },
        ],
      };

      const result = await whatsappWebhookService.processIncomingWebhook(payload);
      expect(result).toEqual([]);
    });
  });

  describe("Test B: Tenant DB Crash Handling", () => {
    it("should throw with isTenantDbError flag when tenant DB connection fails", async () => {
      const { tenantId, phoneNumberId } = await setupTenantWithChannel();

      jest.spyOn(_service as any, "getTenantDbConnection").mockRejectedValueOnce(
        new Error("ECONNREFUSED — tenant DB is down")
      );

      const payload = buildWebhookPayload(phoneNumberId, [{
        id: "wamid.db_crash_001",
        from: "972501111111",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "This should fail" },
      }]);

      try {
        await whatsappWebhookService.processIncomingWebhook(payload);
        fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Tenant DB unavailable");
        expect(err.isTenantDbError).toBe(true);
      }
    });

    it("should NOT cause UnhandledPromiseRejection on DB crash — error is properly caught", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      jest.spyOn(_service as any, "getTenantDbConnection").mockRejectedValueOnce(
        new Error("Connection timeout")
      );

      const payload = buildWebhookPayload(phoneNumberId, [{
        id: "wamid.db_crash_002",
        from: "972502222222",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Connection test" },
      }]);

      const rejectionHandler = jest.fn();
      process.on("unhandledRejection", rejectionHandler);

      try {
        await whatsappWebhookService.processIncomingWebhook(payload);
      } catch {
      }

      await new Promise((r) => setTimeout(r, 100));

      expect(rejectionHandler).not.toHaveBeenCalled();
      process.removeListener("unhandledRejection", rejectionHandler);
    });

    it("should not write any messages to central DB on tenant DB crash", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      jest.spyOn(_service as any, "getTenantDbConnection").mockRejectedValueOnce(
        new Error("DB down")
      );

      const msgCountBefore = await MessageModel.countDocuments({});

      const payload = buildWebhookPayload(phoneNumberId, [{
        id: "wamid.db_crash_003",
        from: "972503333333",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Should not be saved" },
      }]);

      try {
        await whatsappWebhookService.processIncomingWebhook(payload);
      } catch {
      }

      const msgCountAfter = await MessageModel.countDocuments({});
      expect(msgCountAfter).toBe(msgCountBefore);
    });
  });

  describe("Test C: Idempotency Check (Duplicate Webhooks)", () => {
    it("should save message once and gracefully skip duplicate wamid", async () => {
      const { tenantId, phoneNumberId } = await setupTenantWithChannel();

      const wamid = `wamid.dedup_${Date.now()}`;
      const msgPayload = {
        id: wamid,
        from: "972504444444",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Duplicate test message" },
      };

      const payload1 = buildWebhookPayload(phoneNumberId, [msgPayload]);
      const result1 = await whatsappWebhookService.processIncomingWebhook(payload1);
      expect(result1.length).toBe(1);

      const payload2 = buildWebhookPayload(phoneNumberId, [msgPayload]);
      const result2 = await whatsappWebhookService.processIncomingWebhook(payload2);

      const allMsgs = await MessageModel.find({ "metadata.waMessageId": wamid });
      expect(allMsgs.length).toBe(1);
    });

    it("should return successfully on duplicate (no throw) so Meta gets 200-equivalent", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      const wamid = `wamid.dedup_ok_${Date.now()}`;
      const msgPayload = {
        id: wamid,
        from: "972505555555",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "Idempotent test" },
      };

      const payload = buildWebhookPayload(phoneNumberId, [msgPayload]);

      await whatsappWebhookService.processIncomingWebhook(payload);

      await expect(
        whatsappWebhookService.processIncomingWebhook(buildWebhookPayload(phoneNumberId, [msgPayload]))
      ).resolves.not.toThrow();
    });
  });

  describe("Test D: Poison Pill Validation", () => {
    it("should catch ValidationError from Mongoose and continue without throwing", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      const poisonWamid = `wamid.poison_${Date.now()}`;
      const payload = buildWebhookPayload(phoneNumberId, [{
        id: poisonWamid,
        from: "972506666666",
        timestamp: "INVALID_NOT_A_NUMBER",
        type: "text",
        text: { body: "" },
      }]);

      await expect(
        whatsappWebhookService.processIncomingWebhook(payload)
      ).resolves.toBeDefined();
    });

    it("should not cause infinite Meta retries on validation error (process stays up)", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      const payload = buildWebhookPayload(phoneNumberId, [{
        id: `wamid.poison_safe_${Date.now()}`,
        from: "972507777777",
        timestamp: "GARBAGE",
        type: "text",
        text: { body: "Bad data" },
      }]);

      const rejectionHandler = jest.fn();
      process.on("unhandledRejection", rejectionHandler);

      await expect(
        whatsappWebhookService.processIncomingWebhook(payload)
      ).resolves.toBeDefined();

      await new Promise((r) => setTimeout(r, 100));
      expect(rejectionHandler).not.toHaveBeenCalled();

      process.removeListener("unhandledRejection", rejectionHandler);
    });

    it("should process valid messages in same batch even if one is a poison pill", async () => {
      const { phoneNumberId } = await setupTenantWithChannel();

      const goodWamid = `wamid.good_${Date.now()}`;
      const poisonWamid = `wamid.poison_batch_${Date.now()}`;

      const payload = buildWebhookPayload(phoneNumberId, [
        {
          id: goodWamid,
          from: "972508888888",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "I am a good message" },
        },
        {
          id: poisonWamid,
          from: "972509999999",
          timestamp: "NOT_VALID_TIMESTAMP",
          type: "text",
          text: { body: "I am a poison pill" },
        },
      ]);

      const result = await whatsappWebhookService.processIncomingWebhook(payload);

      expect(result.length).toBeGreaterThanOrEqual(1);

      const goodMsg = await MessageModel.find({ "metadata.waMessageId": goodWamid });
      expect(goodMsg.length).toBe(1);
    });
  });
});
