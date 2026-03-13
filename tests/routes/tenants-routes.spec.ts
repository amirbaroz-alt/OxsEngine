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

describe("Tenant Routes - Auth Guard", () => {
  describe("GET /api/tenants", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/tenants");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/tenants", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app)
        .post("/api/tenants")
        .send({ nameHe: "Test", nameEn: "Test" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/customers", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/customers");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/teams", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/teams");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/tags", () => {
    it("should return 401 if unauthorized", async () => {
      const res = await request(app).get("/api/tags");
      expect(res.status).toBe(401);
    });
  });
});
