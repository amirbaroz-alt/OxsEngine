import "./setup";
import { AuditLogModel } from "../server/models/audit-log.model";

jest.mock("../server/index", () => ({
  log: jest.fn(),
}));

describe("Phase 1: Health Check", () => {
  it("should confirm AuditLogModel.count() works on in-memory database", async () => {
    const initialCount = await AuditLogModel.countDocuments();
    expect(initialCount).toBe(0);

    await AuditLogModel.create({
      action: "HEALTH_CHECK",
      entityType: "System",
      details: "Test environment health check",
    });

    const afterCount = await AuditLogModel.countDocuments();
    expect(afterCount).toBe(1);
  });
});
