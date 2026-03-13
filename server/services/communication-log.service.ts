import { CommunicationLogModel, type ICommunicationLog } from "../models/communication-log.model";

export class CommunicationLogService {
  async getAll(): Promise<ICommunicationLog[]> {
    return CommunicationLogModel.find().sort({ timestamp: -1 });
  }

  async getByTenant(tenantId: string): Promise<ICommunicationLog[]> {
    return CommunicationLogModel.find({ tenantId }).sort({ timestamp: -1 });
  }

  async getById(id: string): Promise<ICommunicationLog | null> {
    return CommunicationLogModel.findById(id);
  }

  async getRecent(limit: number = 5, tenantId?: string): Promise<ICommunicationLog[]> {
    const filter = tenantId ? { tenantId } : {};
    return CommunicationLogModel.find(filter).sort({ timestamp: -1 }).limit(limit);
  }

  async create(data: Partial<ICommunicationLog>): Promise<ICommunicationLog> {
    const logEntry = new CommunicationLogModel(data);
    return logEntry.save();
  }

  async update(id: string, data: Partial<ICommunicationLog>): Promise<ICommunicationLog | null> {
    return CommunicationLogModel.findByIdAndUpdate(id, data, { new: true });
  }

  async count(filter?: Record<string, any>): Promise<number> {
    return CommunicationLogModel.countDocuments(filter || {});
  }
}

export const communicationLogService = new CommunicationLogService();
