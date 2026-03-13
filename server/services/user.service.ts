import { UserModel, type IUser } from "../models/user.model";

export class UserService {
  async getAll(): Promise<IUser[]> {
    return UserModel.find().sort({ name: 1 });
  }

  async getById(id: string): Promise<IUser | null> {
    return UserModel.findById(id);
  }

  async getByTenant(tenantId: string): Promise<IUser[]> {
    return UserModel.find({ tenantId }).sort({ name: 1 });
  }

  async create(data: Partial<IUser>): Promise<IUser> {
    const user = new UserModel(data);
    return user.save();
  }

  async update(id: string, data: Partial<IUser>): Promise<IUser | null> {
    return UserModel.findByIdAndUpdate(id, data, { new: true });
  }

  async count(filter?: Record<string, any>): Promise<number> {
    return UserModel.countDocuments(filter || {});
  }

  async setOnline(userId: string): Promise<{ tenantId?: string; name?: string; presenceStatus?: string } | null> {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { isOnline: true, lastSeenAt: new Date() } },
      { new: true },
    ).select("tenantId name presenceStatus").lean();
    if (!user) return null;
    return { tenantId: user.tenantId ? String(user.tenantId) : undefined, name: user.name, presenceStatus: (user as any).presenceStatus };
  }

  async setOffline(userId: string): Promise<{ tenantId?: string; name?: string; presenceStatus?: string } | null> {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      { $set: { isOnline: false, lastSeenAt: new Date() } },
      { new: true },
    ).select("tenantId name presenceStatus").lean();
    if (!user) return null;
    return { tenantId: user.tenantId ? String(user.tenantId) : undefined, name: user.name, presenceStatus: (user as any).presenceStatus };
  }
}

export const userService = new UserService();
