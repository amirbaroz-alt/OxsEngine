import "../setup";
import mongoose from "mongoose";
import axios from "axios";
import AxiosMockAdapter from "axios-mock-adapter";

jest.mock("../../server/index", () => ({
  log: jest.fn(),
}));

jest.mock("../../server/services/socket.service", () => ({
  emitTemplateUpdate: jest.fn(),
}));

const META_GRAPH_API = "https://graph.facebook.com/v24.0";
let axiosMock: AxiosMockAdapter;

beforeEach(() => {
  axiosMock = new AxiosMockAdapter(axios);
});

afterEach(() => {
  axiosMock.restore();
});

function objectId(): string {
  return new mongoose.Types.ObjectId().toString();
}

describe("WhatsAppTemplateService — PROD Chaos", () => {
  const TEST_TENANT_ID = objectId();
  const WABA_ID = "WABA_12345";

  async function getService() {
    const { WhatsAppTemplateService } = await import(
      "../../server/services/whatsapp-template.service"
    );
    return new WhatsAppTemplateService();
  }

  async function setupChannelForTenant(tenantId: string) {
    const { ChannelModel } = await import("../../server/models/channel.model");
    await ChannelModel.create({
      tenantId,
      name: "WA Sync Test",
      type: "WHATSAPP",
      status: "active",
      isActive: true,
      phoneNumberId: "PH_SYNC",
      accessToken: "sync-token",
      verifyToken: "vt",
      wabaId: WABA_ID,
    });
  }

  describe("syncFromMeta — Bulk DB Failure", () => {
    it("should propagate DB error when tenant connection throws during model operations", async () => {
      const svc = await getService();
      await setupChannelForTenant(TEST_TENANT_ID);

      axiosMock.onGet(new RegExp(`${META_GRAPH_API}/${WABA_ID}/message_templates`)).reply(200, {
        data: [
          {
            name: "test_template",
            status: "APPROVED",
            category: "UTILITY",
            language: "en",
            components: [{ type: "BODY", text: "Hello {{1}}" }],
            id: "META_TPL_1",
          },
        ],
      });

      const failingConn = {
        models: {},
        model: jest.fn().mockImplementation(() => {
          throw new Error("MongoServerError: connection pool closed");
        }),
      } as unknown as mongoose.Connection;

      let threwError = false;
      try {
        await svc.syncFromMeta(TEST_TENANT_ID, failingConn);
      } catch (err: any) {
        threwError = true;
        expect(err.message).toContain("connection pool closed");
      }

      if (!threwError) {
        const result = await svc.syncFromMeta(TEST_TENANT_ID, failingConn);
        expect(result.error).toBeDefined();
        expect(result.synced).toBe(0);
      }
    });

    it("should return error in result when findOneAndUpdate fails on tenant DB", async () => {
      const svc = await getService();
      await setupChannelForTenant(TEST_TENANT_ID);

      axiosMock.onGet(new RegExp(`${META_GRAPH_API}/${WABA_ID}/message_templates`)).reply(200, {
        data: [
          {
            name: "failing_template",
            status: "APPROVED",
            category: "MARKETING",
            language: "he",
            components: [{ type: "BODY", text: "שלום {{1}}" }],
            id: "META_TPL_2",
          },
        ],
      });

      const mockModel = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        findOneAndUpdate: jest.fn().mockRejectedValue(
          new Error("MongoServerError: tenant DB disk full")
        ),
      };

      const brokenConn = {
        models: {},
        model: jest.fn().mockReturnValue(mockModel),
      } as unknown as mongoose.Connection;

      const result = await svc.syncFromMeta(TEST_TENANT_ID, brokenConn);

      expect(result.error).toBeDefined();
      expect(result.synced).toBe(0);
    });

    it("should not silently succeed when DB operations fail", async () => {
      const svc = await getService();
      await setupChannelForTenant(TEST_TENANT_ID);

      axiosMock.onGet(new RegExp(`${META_GRAPH_API}/${WABA_ID}/message_templates`)).reply(200, {
        data: [
          { name: "tpl_1", status: "APPROVED", category: "UTILITY", language: "en", components: [] },
          { name: "tpl_2", status: "PENDING", category: "UTILITY", language: "en", components: [] },
          { name: "tpl_3", status: "REJECTED", category: "MARKETING", language: "en", components: [] },
        ],
      });

      const mockModel = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        findOneAndUpdate: jest.fn().mockRejectedValue(
          new Error("MongoServerError: write concern timeout")
        ),
      };

      const brokenConn = {
        models: {},
        model: jest.fn().mockReturnValue(mockModel),
      } as unknown as mongoose.Connection;

      const result = await svc.syncFromMeta(TEST_TENANT_ID, brokenConn);

      expect(result.synced).toBe(0);
      expect(result.error).toBeDefined();
    });

    it("should NOT cause UnhandledPromiseRejection on DB failure during sync", async () => {
      const svc = await getService();
      await setupChannelForTenant(TEST_TENANT_ID);

      axiosMock.onGet(new RegExp(`${META_GRAPH_API}/${WABA_ID}/message_templates`)).reply(200, {
        data: [
          { name: "safe_tpl", status: "APPROVED", category: "UTILITY", language: "en", components: [{ type: "BODY", text: "Test" }] },
        ],
      });

      const mockModel = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        findOneAndUpdate: jest.fn().mockRejectedValue(
          new Error("ECONNRESET")
        ),
      };

      const brokenConn = {
        models: {},
        model: jest.fn().mockReturnValue(mockModel),
      } as unknown as mongoose.Connection;

      const rejectionHandler = jest.fn();
      process.on("unhandledRejection", rejectionHandler);

      const result = await svc.syncFromMeta(TEST_TENANT_ID, brokenConn);

      await new Promise((r) => setTimeout(r, 100));
      expect(rejectionHandler).not.toHaveBeenCalled();
      process.removeListener("unhandledRejection", rejectionHandler);

      expect(result.error).toBeDefined();
    });

    it("should handle Meta API returning valid data but connection dying mid-loop", async () => {
      const svc = await getService();
      await setupChannelForTenant(TEST_TENANT_ID);

      axiosMock.onGet(new RegExp(`${META_GRAPH_API}/${WABA_ID}/message_templates`)).reply(200, {
        data: [
          { name: "tpl_ok", status: "APPROVED", category: "UTILITY", language: "en", components: [{ type: "BODY", text: "OK" }], id: "M1" },
          { name: "tpl_die", status: "APPROVED", category: "UTILITY", language: "en", components: [{ type: "BODY", text: "Die" }], id: "M2" },
        ],
      });

      let callCount = 0;
      const mockModel = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
        findOneAndUpdate: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return { _id: objectId(), name: "tpl_ok", status: "APPROVED" };
          }
          throw new Error("MongoServerError: connection lost mid-batch");
        }),
      };

      const halfBrokenConn = {
        models: {},
        model: jest.fn().mockReturnValue(mockModel),
      } as unknown as mongoose.Connection;

      const result = await svc.syncFromMeta(TEST_TENANT_ID, halfBrokenConn);

      expect(result.error).toBeDefined();
    });
  });
});
