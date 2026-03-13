import "../setup";
import express from "express";
import { createServer } from "http";
import type { Server } from "http";
import request from "supertest";
import { createTestTenant, createAuthenticatedUser, type TestContext } from "../helpers/auth-helper";

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

async function freshCtx(role = "superadmin") {
  const slug = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tenantId = await createTestTenant({ slug });
  const ctx = await createAuthenticatedUser(tenantId, role);
  return { ...ctx, slug };
}

describe("Auth - Positive Paths", () => {
  it("GET /api/auth/me should return user for valid session", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("_id");
    expect(res.body).toHaveProperty("name", "Test User");
    expect(res.body).toHaveProperty("role", "superadmin");
  });

  it("GET /api/public/tenant/:slug should return tenant info", async () => {
    const ctx = await freshCtx();
    const res = await request(app).get(`/api/public/tenant/${ctx.slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("nameHe", "Test Tenant");
    expect(res.body).toHaveProperty("nameEn", "Test Tenant");
    expect(res.body).toHaveProperty("defaultLanguage", "he");
  });
});

describe("Inbox - Positive Paths", () => {
  it("GET /api/inbox/conversations should return empty array for new tenant", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/inbox/conversations?tenantId=${ctx.tenantId}&tab=pool`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/inbox/conversations/tab-counts should return counts", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/inbox/conversations/tab-counts?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("mine");
    expect(res.body).toHaveProperty("pool");
    expect(res.body).toHaveProperty("closed");
  });

  it("GET /api/inbox/agents should return agents list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/inbox/agents?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/inbox/channel-types should return channel types", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/inbox/channel-types?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("Admin - Positive Paths", () => {
  it("GET /api/dashboard/stats should return dashboard statistics", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/dashboard/stats")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tenants");
    expect(res.body).toHaveProperty("users");
    expect(res.body).toHaveProperty("communications");
  });

  it("GET /api/users should return users list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/communication-logs should return logs", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/communication-logs")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs || res.body)).toBe(true);
  });

  it("GET /api/audit-logs should return audit logs", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("logs");
    expect(Array.isArray(res.body.logs)).toBe(true);
  });
});

describe("Tenants - Positive Paths", () => {
  it("GET /api/tenants should return tenants list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get("/api/tenants")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/tenants/:id should return specific tenant", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/tenants/${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("nameHe", "Test Tenant");
  });

  it("GET /api/customers should return customers list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/customers?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("customers");
    expect(Array.isArray(res.body.customers)).toBe(true);
  });

  it("GET /api/teams should return teams list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/teams?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/tags should return tags list", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/tags?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("WhatsApp - Positive Paths", () => {
  it("GET /api/whatsapp-templates should return templates for authenticated user", async () => {
    const ctx = await freshCtx();
    const res = await request(app)
      .get(`/api/whatsapp-templates?tenantId=${ctx.tenantId}`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("Role-Based Access Control", () => {
  it("Employee should be denied access to tenant form layout (superadmin-only)", async () => {
    const ctx = await freshCtx("employee");
    const res = await request(app)
      .get("/api/system-settings/tenant-form-layout")
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(403);
  });

  it("Employee should be able to access inbox conversations", async () => {
    const ctx = await freshCtx("employee");
    const res = await request(app)
      .get(`/api/inbox/conversations?tenantId=${ctx.tenantId}&tab=pool`)
      .set("Authorization", `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
