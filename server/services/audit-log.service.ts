import { AuditLogModel, type IAuditLog } from "../models/audit-log.model";

export class AuditLogService {
  async getAll(tenantId?: string): Promise<IAuditLog[]> {
    const filter = tenantId ? { tenantId } : {};
    return AuditLogModel.find(filter).sort({ createdAt: -1 }).limit(200);
  }

  async getByEntity(entityType: string, entityId: string): Promise<IAuditLog[]> {
    return AuditLogModel.find({ entityType, entityId }).sort({ createdAt: -1 });
  }

  async count(filter?: Record<string, any>): Promise<number> {
    return AuditLogModel.countDocuments(filter || {});
  }

  async log(params: {
    actorName?: string;
    role?: string;
    tenantId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    details?: string;
  }): Promise<IAuditLog> {
    const entry = new AuditLogModel(params);
    return entry.save();
  }
}

export const auditLogService = new AuditLogService();
