import { TenantModel, type ITenant } from "../models/tenant.model";
import { encryptTenantSensitiveFields, decryptTenantSensitiveFields, encryptionService } from "./encryption.service";
import { tenantDbManager } from "../lib/db-manager";

const SENSITIVE_PATHS: Record<string, string[]> = {
  smsConfig: ["accessToken"],
  mailConfig: ["sendGridKey"],
  whatsappConfig: ["accessToken", "verifyToken"],
  quotaGuardConfig: ["proxyUrl"],
};

function maskSensitiveFields(data: any): any {
  if (!data) return data;
  const result = typeof data.toObject === "function" ? data.toObject() : { ...data };

  for (const [configKey, fields] of Object.entries(SENSITIVE_PATHS)) {
    if (result[configKey]) {
      result[configKey] = { ...result[configKey] };
      for (const field of fields) {
        const val = result[configKey][field];
        if (val) {
          let plain = val;
          if (encryptionService.isEncrypted(val)) {
            try {
              plain = encryptionService.decrypt(val);
            } catch {
              plain = val;
            }
          }
          if (plain.length > 6) {
            result[configKey][field] = "****" + plain.slice(-6);
          } else {
            result[configKey][field] = "****";
          }
        }
      }
    }
  }

  return result;
}

export class TenantService {
  async getAll(): Promise<any[]> {
    const tenants = await TenantModel.find().sort({ nameHe: 1 }).lean();
    return tenants.map(maskSensitiveFields);
  }

  async getById(id: string): Promise<any | null> {
    const tenant = await TenantModel.findById(id).lean();
    if (!tenant) return null;
    return maskSensitiveFields(tenant);
  }

  async create(data: Partial<ITenant>): Promise<any> {
    const encrypted = encryptTenantSensitiveFields(data);
    const tenant = new TenantModel(encrypted);
    const saved = await tenant.save();
    return maskSensitiveFields(saved);
  }

  async update(id: string, data: Partial<ITenant>): Promise<any | null> {
    const existing = await TenantModel.findById(id).lean();
    if (!existing) return null;

    const updateData = { ...data } as any;
    for (const [configKey, fields] of Object.entries(SENSITIVE_PATHS)) {
      if (updateData[configKey]) {
        for (const field of fields) {
          const val = updateData[configKey]?.[field];
          if (val && val.startsWith("****")) {
            updateData[configKey][field] = (existing as any)[configKey]?.[field] || null;
          }
        }
      }
    }

    const encrypted = encryptTenantSensitiveFields(updateData);
    const tenant = await TenantModel.findByIdAndUpdate(id, encrypted, { new: true }).lean();
    if (!tenant) return null;
    return maskSensitiveFields(tenant);
  }

  async getByIdDecrypted(id: string): Promise<any | null> {
    const tenant = await TenantModel.findById(id).lean();
    if (!tenant) return null;
    return decryptTenantSensitiveFields(tenant);
  }

  async count(filter?: Record<string, any>): Promise<number> {
    return TenantModel.countDocuments(filter || {});
  }

  async purgeTenantData(tenantId: string): Promise<void> {
    const tenant = await TenantModel.findById(tenantId).select("+tenantDbUri");
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

    const dbUri = tenant.tenantDbUri;
    if (dbUri) {
      const conn = await tenantDbManager.getTenantConnection(tenantId, dbUri);
      const collections = await conn.db.listCollections().toArray();
      for (const col of collections) {
        await conn.db.dropCollection(col.name);
      }
    }

    await TenantModel.updateOne({ _id: tenantId }, { $set: { active: false } });
  }
}

export const tenantService = new TenantService();
