import mongoose from "mongoose";
import { UserModel } from "../../server/models/user.model";
import { TenantModel } from "../../server/models/tenant.model";
import { SessionModel } from "../../server/models/session.model";

export interface TestContext {
  tenantId: string;
  userId: string;
  token: string;
}

export async function createTestTenant(overrides: Record<string, any> = {}): Promise<string> {
  const tenant = await TenantModel.create({
    nameHe: "Test Tenant",
    nameEn: "Test Tenant",
    slug: `test-tenant-${Date.now()}`,
    active: true,
    defaultLanguage: "he",
    ...overrides,
  });
  return String(tenant._id);
}

export async function createAuthenticatedUser(
  tenantId: string,
  role: string = "superadmin",
  overrides: Record<string, any> = {}
): Promise<TestContext> {
  const user = await UserModel.create({
    name: "Test User",
    email: `test-${Date.now()}@test.com`,
    phone: "0585020130",
    role,
    tenantId: new mongoose.Types.ObjectId(tenantId),
    active: true,
    teamIds: [],
    ...overrides,
  });

  const token = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await SessionModel.create({
    token,
    userId: user._id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return {
    tenantId,
    userId: String(user._id),
    token,
  };
}
