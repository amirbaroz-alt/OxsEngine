import "../setup";
import mongoose from "mongoose";
import { createTestTenant, createAuthenticatedUser } from "../helpers/auth-helper";
import { UserModel } from "../../server/models/user.model";
import { SessionModel } from "../../server/models/session.model";

jest.mock("../../server/index", () => ({
  log: jest.fn(),
}));

jest.mock("../../server/services/sms.service", () => ({
  smsService: { sendSms: jest.fn() },
}));

jest.mock("../../server/services/email.service", () => ({
  emailService: { send: jest.fn() },
}));

jest.mock("../../server/services/communication-log.service", () => ({
  communicationLogService: { create: jest.fn() },
}));

jest.mock("../../server/services/encryption.service", () => ({
  decryptTenantSensitiveFields: jest.fn((t: any) => t),
  encryptTenantSensitiveFields: jest.fn((t: any) => t),
}));

jest.mock("../../server/services/proxy.service", () => ({
  getTenantQuotaGuardAgent: jest.fn(() => null),
}));

import { authService } from "../../server/services/auth.service";
import { userService } from "../../server/services/user.service";
import { conversationService } from "../../server/services/conversation.service";

describe("Socket-to-Service Integration", () => {
  describe("authService.validateSocketSession", () => {
    it("should validate a valid session token and return user info", async () => {
      const tenantId = await createTestTenant();
      const ctx = await createAuthenticatedUser(tenantId, "superadmin", { name: "Socket User" });

      const result = await authService.validateSocketSession(ctx.token);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(ctx.userId);
      expect(result!.role).toBe("superadmin");
      expect(result!.tenantId).toBe(tenantId);
      expect(result!.name).toBe("Socket User");
      expect(typeof result!.presenceStatus).toBe("string");
    });

    it("should return null for an invalid token", async () => {
      const result = await authService.validateSocketSession("invalid-token-xyz");
      expect(result).toBeNull();
    });

    it("should return null for an expired session", async () => {
      const tenantId = await createTestTenant();
      const user = await UserModel.create({
        name: "Expired User",
        email: `expired-${Date.now()}@test.com`,
        phone: "0500000000",
        role: "employee",
        tenantId: new mongoose.Types.ObjectId(tenantId),
        active: true,
        teamIds: [],
      });
      const expiredToken = `expired-${Date.now()}`;
      await SessionModel.create({
        token: expiredToken,
        userId: user._id,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await authService.validateSocketSession(expiredToken);
      expect(result).toBeNull();
    });

    it("should return correct tenantId for non-superadmin users", async () => {
      const tenantId = await createTestTenant();
      const ctx = await createAuthenticatedUser(tenantId, "employee");

      const result = await authService.validateSocketSession(ctx.token);

      expect(result).not.toBeNull();
      expect(result!.role).toBe("employee");
      expect(result!.tenantId).toBe(tenantId);
    });

    it("should return presenceStatus defaulting to active", async () => {
      const tenantId = await createTestTenant();
      const ctx = await createAuthenticatedUser(tenantId, "employee");

      const result = await authService.validateSocketSession(ctx.token);

      expect(result).not.toBeNull();
      expect(result!.presenceStatus).toBe("active");
    });
  });

  describe("userService.setOnline / setOffline", () => {
    it("should set user online and return tenantId/name", async () => {
      const tenantId = await createTestTenant();
      const ctx = await createAuthenticatedUser(tenantId, "employee", { name: "Online Agent" });

      const result = await userService.setOnline(ctx.userId);

      expect(result).not.toBeNull();
      expect(result!.tenantId).toBe(tenantId);
      expect(result!.name).toBe("Online Agent");

      const dbUser = await UserModel.findById(ctx.userId).lean();
      expect(dbUser!.isOnline).toBe(true);
      expect(dbUser!.lastSeenAt).toBeInstanceOf(Date);
    });

    it("should set user offline and update lastSeenAt", async () => {
      const tenantId = await createTestTenant();
      const ctx = await createAuthenticatedUser(tenantId, "employee");

      await userService.setOnline(ctx.userId);
      const beforeOffline = Date.now();
      const result = await userService.setOffline(ctx.userId);

      expect(result).not.toBeNull();

      const dbUser = await UserModel.findById(ctx.userId).lean();
      expect(dbUser!.isOnline).toBe(false);
      expect(dbUser!.lastSeenAt).toBeInstanceOf(Date);
      expect(dbUser!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(beforeOffline - 1000);
    });

    it("should return null for non-existent user", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const result = await userService.setOnline(fakeId);
      expect(result).toBeNull();
    });
  });

  describe("conversationService.verifyTenantAccess", () => {
    it("should return true when conversation belongs to tenant", async () => {
      const tenantId = await createTestTenant();
      const { ConversationModel } = await import("../../server/models/conversation.model");
      const conv = await ConversationModel.create({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        customerId: new mongoose.Types.ObjectId(),
        channel: "WHATSAPP",
        status: "ACTIVE",
      });

      const result = await conversationService.verifyTenantAccess(String(conv._id), [tenantId]);
      expect(result).toBe(true);
    });

    it("should return false when conversation belongs to different tenant", async () => {
      const tenantId1 = await createTestTenant();
      const tenantId2 = await createTestTenant({ slug: `other-${Date.now()}` });
      const { ConversationModel } = await import("../../server/models/conversation.model");
      const conv = await ConversationModel.create({
        tenantId: new mongoose.Types.ObjectId(tenantId1),
        customerId: new mongoose.Types.ObjectId(),
        channel: "WHATSAPP",
        status: "ACTIVE",
      });

      const result = await conversationService.verifyTenantAccess(String(conv._id), [tenantId2]);
      expect(result).toBe(false);
    });

    it("should return false for non-existent conversation", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const result = await conversationService.verifyTenantAccess(fakeId, ["some-tenant"]);
      expect(result).toBe(false);
    });
  });
});
