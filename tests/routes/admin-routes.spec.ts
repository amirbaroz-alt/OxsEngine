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

describe("Admin Routes - Auth Guard", () => {
  describe("GET /api/dashboard/stats", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/dashboard/stats");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/users", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/users");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/users", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/users")
        .send({ name: "Test User", email: "test@test.com" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/communication-logs", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/communication-logs");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/system-settings", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/system-settings");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/audit-logs", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/audit-logs");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/analytics/daily", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/analytics/daily");
      expect(res.status).toBe(401);
    });
  });
});
