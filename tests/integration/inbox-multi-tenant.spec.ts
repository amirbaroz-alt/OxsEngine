import "../setup";
import express from "express";
import { createServer } from "http";
import type { Server } from "http";
import request from "supertest";
import mongoose from "mongoose";
import { createTestTenant, createAuthenticatedUser } from "../helpers/auth-helper";

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

afterAll(async () => {
  const { tenantDbManager } = await import("../../server/lib/db-manager");
  await tenantDbManager.closeAll();
  httpServer.close();
});

async function freshCtx(role = "superadmin") {
  const slug = `mt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  const ctx = await createAuthenticatedUser(tenantId, role);
  return { ...ctx, slug };
}

describe("Inbox Multi-Tenant Isolation", () => {

  describe("Test A: Data Bleed Prevention", () => {
    it("should return 503 when tenant DB connection fails (no fallback to central DB)", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const originalGet = tenantDbManager.getTenantConnection.bind(tenantDbManager);

      const ctx = await freshCtx();

      jest.spyOn(tenantDbManager, "getTenantConnection").mockRejectedValue(
        new Error("Simulated connection failure")
      );

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctx.token}`);

      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Tenant database unavailable");

      jest.restoreAllMocks();
    });

    it("should return 503 for message endpoints when tenant DB is unavailable", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const ctx = await freshCtx();

      jest.spyOn(tenantDbManager, "getTenantConnection").mockRejectedValue(
        new Error("Simulated connection failure")
      );

      const fakeConvId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get(`/api/inbox/conversations/${fakeConvId}/messages`)
        .set("Authorization", `Bearer ${ctx.token}`);

      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Tenant database unavailable");

      jest.restoreAllMocks();
    });

    it("should NOT write any data to the central DB on connection failure", async () => {
      const { tenantDbManager } = await import("../../server/lib/db-manager");
      const ctx = await freshCtx();
      const fakeConvId = new mongoose.Types.ObjectId().toString();

      jest.spyOn(tenantDbManager, "getTenantConnection").mockRejectedValue(
        new Error("Simulated connection failure")
      );

      const centralMessagesBefore = await mongoose.connection.db!
        .collection("messages")
        .countDocuments({});

      await request(app)
        .post(`/api/inbox/conversations/${fakeConvId}/messages`)
        .set("Authorization", `Bearer ${ctx.token}`)
        .send({ content: "bleed-test-message", type: "TEXT" });

      const centralMessagesAfter = await mongoose.connection.db!
        .collection("messages")
        .countDocuments({});

      expect(centralMessagesAfter).toBe(centralMessagesBefore);

      jest.restoreAllMocks();
    });
  });

  describe("Test B: Payload Injection Guard", () => {
    it("should reject cross-tenant query param for non-superadmin (requireTenant guard)", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await freshCtx("employee");

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctxA.token}`)
        .query({ tenantId: ctxB.tenantId });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Access denied to this tenant");
    });

    it("should override tenantId in query with auth-derived tenantId for employees", async () => {
      const ctxA = await freshCtx("employee");

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctxA.token}`);

      expect(res.status).toBe(200);
      if (Array.isArray(res.body)) {
        res.body.forEach((c: any) => {
          expect(String(c.tenantId)).toBe(ctxA.tenantId);
        });
      }
    });

    it("should not allow body tenantId to override auth context on tab-counts", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await freshCtx("employee");

      const res = await request(app)
        .get("/api/inbox/conversations/tab-counts")
        .set("Authorization", `Bearer ${ctxA.token}`)
        .query({ tenantId: ctxB.tenantId });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Access denied to this tenant");
    });
  });

  describe("Test C: Middleware URI Caching", () => {
    it("should call TenantModel.findById at most once for 50 rapid requests with same tenant", async () => {
      const { _getTenantUriCache } = await import("../../server/middleware/auth.middleware");
      const { TenantModel } = await import("../../server/models/tenant.model");

      const ctx = await freshCtx();

      _getTenantUriCache().clear();

      const findByIdSpy = jest.spyOn(TenantModel, "findById");

      const promises = Array.from({ length: 50 }, () =>
        request(app)
          .get("/api/inbox/channel-types")
          .set("Authorization", `Bearer ${ctx.token}`)
      );

      await Promise.all(promises);

      const callsForThisTenant = findByIdSpy.mock.calls.filter(
        (args) => String(args[0]) === ctx.tenantId
      );

      expect(callsForThisTenant.length).toBeLessThanOrEqual(3);

      findByIdSpy.mockRestore();
    });

    it("should refresh cache after TTL expires", async () => {
      const { _getTenantUriCache } = await import("../../server/middleware/auth.middleware");
      const { TenantModel } = await import("../../server/models/tenant.model");

      const ctx = await freshCtx();

      _getTenantUriCache().clear();

      const findByIdSpy = jest.spyOn(TenantModel, "findById");

      await request(app)
        .get("/api/inbox/channel-types")
        .set("Authorization", `Bearer ${ctx.token}`);

      const initialCalls = findByIdSpy.mock.calls.filter(
        (args) => String(args[0]) === ctx.tenantId
      ).length;

      expect(initialCalls).toBe(1);

      const cached = _getTenantUriCache().get(ctx.tenantId);
      if (cached) {
        cached.expiresAt = Date.now() - 1;
      }

      await request(app)
        .get("/api/inbox/channel-types")
        .set("Authorization", `Bearer ${ctx.token}`);

      const totalCalls = findByIdSpy.mock.calls.filter(
        (args) => String(args[0]) === ctx.tenantId
      ).length;

      expect(totalCalls).toBe(2);

      findByIdSpy.mockRestore();
    });
  });
});
