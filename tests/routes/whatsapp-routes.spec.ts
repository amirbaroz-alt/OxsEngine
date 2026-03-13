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

describe("WhatsApp Routes", () => {
  describe("GET /api/whatsapp/webhook (verification)", () => {
    it("should return 403 for invalid verify token", async () => {
      const res = await request(app)
        .get("/api/whatsapp/webhook")
        .query({
          "hub.mode": "subscribe",
          "hub.verify_token": "wrong-token",
          "hub.challenge": "test-challenge",
        });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/webhook/stats", () => {
    it("should return webhook stats (public endpoint)", async () => {
      const res = await request(app).get("/api/webhook/stats");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("pending");
      expect(res.body).toHaveProperty("dedupCacheSize");
      expect(res.body).toHaveProperty("totalProcessed");
    });
  });

  describe("POST /api/whatsapp/send (auth guard)", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/whatsapp/send")
        .send({ tenantId: "t1", recipient: "123", textBody: "hello" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/whatsapp/send-media (auth guard)", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/whatsapp/send-media")
        .send({ tenantId: "t1", recipient: "123" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/whatsapp-templates (auth guard)", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/whatsapp-templates");
      expect(res.status).toBe(401);
    });
  });
});
