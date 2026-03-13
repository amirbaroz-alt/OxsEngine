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

describe("Inbox Routes - Auth Guard", () => {
  describe("GET /api/inbox/conversations", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/inbox/conversations");
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Unauthorized");
    });

    it("should return 401 with malformed Authorization header", async () => {
      const res = await request(app)
        .get("/api/inbox/conversations")
        .set("Authorization", "Basic abc123");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/inbox/conversations/:id/messages", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/inbox/conversations/someid/messages");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/inbox/conversations/:id/assign", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/inbox/conversations/someid/assign")
        .send({ agentId: "agent1" });
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/inbox/conversations/:id/status", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .patch("/api/inbox/conversations/someid/status")
        .send({ status: "closed" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/inbox/send-template", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/inbox/send-template")
        .send({ templateId: "t1", conversationId: "c1" });
      expect(res.status).toBe(401);
    });
  });
});

describe("Inbox Routes - Public Endpoints", () => {
  describe("GET /api/translations/merged/:lang", () => {
    it("should return 200 for translation endpoint (public)", async () => {
      const res = await request(app).get("/api/translations/merged/he");
      expect(res.status).toBe(200);
    });

    it("should return 200 for English translations", async () => {
      const res = await request(app).get("/api/translations/merged/en");
      expect(res.status).toBe(200);
    });
  });
});
