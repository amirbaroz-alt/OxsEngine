import { SystemSettingsModel } from "../models/system-settings.model";
import type { StandardFieldLayout } from "@shared/schema";

const SETTINGS_KEY = "global";

class SystemSettingsService {
  async getTenantFormLayout(): Promise<StandardFieldLayout[]> {
    const doc = await SystemSettingsModel.findOne({ key: SETTINGS_KEY });
    return (doc?.tenantFormFieldsLayout as StandardFieldLayout[]) || [];
  }

  async saveTenantFormLayout(layout: StandardFieldLayout[]): Promise<StandardFieldLayout[]> {
    const doc = await SystemSettingsModel.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: { tenantFormFieldsLayout: layout } },
      { upsert: true, new: true }
    );
    return (doc.tenantFormFieldsLayout as StandardFieldLayout[]) || [];
  }
}

export const systemSettingsService = new SystemSettingsService();
