import "../setup";
import express from "express";
import { createServer } from "http";
import type { Server } from "http";
import request from "supertest";

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

afterAll(() => {
  httpServer.close();
});

describe("Auth Routes", () => {
  describe("GET /api/public/tenant/:slug", () => {
    it("should return 404 for non-existent tenant slug", async () => {
      const res = await request(app).get("/api/public/tenant/nonexistent-slug");
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Company not found");
    });
  });

  describe("POST /api/auth/request-login", () => {
    it("should return 400 when identifier is missing", async () => {
      const res = await request(app)
        .post("/api/auth/request-login")
        .send({ mode: "phone" });
      expect(res.status).toBe(400);
    });

    it("should return 400 when mode is invalid", async () => {
      const res = await request(app)
        .post("/api/auth/request-login")
        .send({ identifier: "0585020130", mode: "fax" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/verify-otp", () => {
    it("should return 400 or 401 when OTP fields are missing", async () => {
      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({});
      expect([400, 401]).toContain(res.status);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return 401 when no authorization header is present", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Unauthorized");
    });

    it("should return 401 with invalid bearer token", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer invalid-token");
      expect(res.status).toBe(401);
    });
  });
});
