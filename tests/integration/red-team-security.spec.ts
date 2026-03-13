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
  const slug = `redteam-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  return createAuthenticatedUser(tenantId, role);
}

describe("Red Team Security Suite", () => {
  describe("Test 1: NoSQL Injection Attack (Auth Bypass)", () => {
    it("query string operator injection is neutralized — returns only user's own data", async () => {
      const ctxA = await freshCtx("employee");
      const ctxB = await freshCtx("employee");

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${ctxA.token}`)
        .query({ "tenantId[$ne]": "null" });

      expect([200, 400, 403]).toContain(res.status);

      if (res.status === 200 && Array.isArray(res.body)) {
        for (const conv of res.body) {
          expect(String(conv.tenantId)).toBe(ctxA.tenantId);
        }
      }
    });

    it("rejects tenantId as MongoDB operator object in POST body", async () => {
      const ctx = await freshCtx("employee");

      const res = await request(app)
        .post("/api/whatsapp/send")
        .set("Authorization", `Bearer ${ctx.token}`)
        .send({
          tenantId: { "$ne": null },
          recipient: "972501234567",
          textBody: "injection test",
        });

      expect([400, 403]).toContain(res.status);
    });

    it("requireTenant rejects non-string tenantId in body with 400", async () => {
      const ctx = await freshCtx("employee");

      const { requireTenant } = await import("../../server/middleware/auth.middleware");

      let statusCode = 0;
      let responseBody: any = {};

      const mockReq = {
        user: { role: "employee", tenantId: ctx.tenantId, _id: ctx.userId },
        query: {},
        body: { tenantId: { "$gt": "" } },
      } as any;

      const mockRes = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (body: any) => { responseBody = body; },
          };
        },
      } as any;

      const mockNext = jest.fn();

      requireTenant(mockReq, mockRes, mockNext);

      expect(statusCode).toBe(400);
      expect(responseBody.message).toBe("Invalid tenantId");
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("requireTenant rejects non-ObjectId string tenantId with 400", async () => {
      const ctx = await freshCtx("employee");

      const { requireTenant } = await import("../../server/middleware/auth.middleware");

      let statusCode = 0;
      let responseBody: any = {};

      const mockReq = {
        user: { role: "employee", tenantId: ctx.tenantId, _id: ctx.userId },
        query: { tenantId: "not-a-valid-objectid" },
        body: {},
      } as any;

      const mockRes = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (body: any) => { responseBody = body; },
          };
        },
      } as any;

      const mockNext = jest.fn();

      requireTenant(mockReq, mockRes, mockNext);

      expect(statusCode).toBe(400);
      expect(responseBody.message).toBe("Invalid tenantId");
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("Test 2: Brute Force / DDoS Attack (Rate Limiter)", () => {
    it("returns 429 after exceeding 100 requests per minute to webhook", async () => {
      const { webhookRateLimiter } = await import("../../server/routes/whatsapp");

      const rateLimitApp = express();
      rateLimitApp.use(express.json());

      rateLimitApp.post("/api/whatsapp/webhook", webhookRateLimiter, (_req, res) => {
        res.sendStatus(200);
      });

      const responses: number[] = [];
      const batchSize = 20;
      const totalRequests = 120;

      for (let batch = 0; batch < totalRequests / batchSize; batch++) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          promises.push(
            request(rateLimitApp)
              .post("/api/whatsapp/webhook")
              .set("X-Forwarded-For", "1.2.3.4")
              .send({ object: "whatsapp_business_account", entry: [] })
              .then((r) => r.status)
          );
        }
        const batchResults = await Promise.all(promises);
        responses.push(...batchResults);
      }

      const okCount = responses.filter((s) => s === 200).length;
      const rateLimitedCount = responses.filter((s) => s === 429).length;

      expect(okCount).toBe(100);
      expect(rateLimitedCount).toBe(20);
      expect(responses.length).toBe(120);
    });

    it("server does not crash during DDoS burst", async () => {
      const { webhookRateLimiter } = await import("../../server/routes/whatsapp");

      const ddosApp = express();
      ddosApp.use(express.json());
      ddosApp.post("/api/test-ddos", webhookRateLimiter, (_req, res) => {
        res.sendStatus(200);
      });

      const promises = [];
      for (let i = 0; i < 150; i++) {
        promises.push(
          request(ddosApp)
            .post("/api/test-ddos")
            .set("X-Forwarded-For", "5.6.7.8")
            .send({})
            .then((r) => r.status)
        );
      }

      const results = await Promise.all(promises);
      const validStatuses = results.every((s) => s === 200 || s === 429);
      expect(validStatuses).toBe(true);
    });
  });

  describe("Test 3: Forged & Expired Tokens", () => {
    it("Scenario A: rejects a completely forged/random token with 401", async () => {
      const forgedToken = "forged-token-" + Math.random().toString(36).slice(2) + "-INVALID";

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/unauthorized|invalid|expired/i);
    });

    it("Scenario A2: rejects a token that looks like a valid ObjectId but doesn't exist", async () => {
      const fakeObjectIdToken = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${fakeObjectIdToken}`);

      expect(res.status).toBe(401);
    });

    it("Scenario B: rejects an expired session token with 401", async () => {
      const { SessionModel } = await import("../../server/models/session.model");
      const { UserModel } = await import("../../server/models/user.model");

      const tenantId = await createTestTenant({
        slug: `expired-${Date.now()}`,
      });

      const user = await UserModel.create({
        name: "Expired User",
        email: `expired-${Date.now()}@test.com`,
        phone: "0585999999",
        role: "employee",
        tenantId: new mongoose.Types.ObjectId(tenantId),
        active: true,
        teamIds: [],
      });

      const expiredToken = `expired-session-${Date.now()}`;
      await SessionModel.create({
        token: expiredToken,
        userId: user._id,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
    });

    it("rejects request with no Authorization header", async () => {
      const res = await request(app)
        .get("/api/inbox/conversations");

      expect(res.status).toBe(401);
    });

    it("rejects request with malformed Authorization header", async () => {
      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", "Basic dXNlcjpwYXNz");

      expect(res.status).toBe(401);
    });
  });
});
