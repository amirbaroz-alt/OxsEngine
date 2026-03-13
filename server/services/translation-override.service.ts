import { TranslationOverrideModel, type ITranslationOverride } from "../models/translation-override.model";

export class TranslationOverrideService {
  async getByLanguage(language: string): Promise<ITranslationOverride[]> {
    return TranslationOverrideModel.find({ language }).sort({ key: 1 });
  }

  async getAll(): Promise<ITranslationOverride[]> {
    return TranslationOverrideModel.find().sort({ language: 1, key: 1 });
  }

  async upsert(language: string, key: string, value: string): Promise<ITranslationOverride> {
    return TranslationOverrideModel.findOneAndUpdate(
      { language, key },
      { language, key, value },
      { upsert: true, new: true }
    ) as Promise<ITranslationOverride>;
  }

  async upsertBatch(overrides: Array<{ language: string; key: string; value: string }>): Promise<void> {
    const ops = overrides.map((o) => ({
      updateOne: {
        filter: { language: o.language, key: o.key },
        update: { $set: { language: o.language, key: o.key, value: o.value } },
        upsert: true,
      },
    }));
    if (ops.length > 0) {
      await TranslationOverrideModel.bulkWrite(ops);
    }
  }

  async deleteByKey(language: string, key: string): Promise<boolean> {
    const result = await TranslationOverrideModel.deleteOne({ language, key });
    return result.deletedCount > 0;
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await TranslationOverrideModel.findByIdAndDelete(id);
    return !!result;
  }

  async getMergedMap(language: string): Promise<Record<string, string>> {
    const overrides = await this.getByLanguage(language);
    const map: Record<string, string> = {};
    for (const o of overrides) {
      map[o.key] = o.value;
    }
    return map;
  }
}

export const translationOverrideService = new TranslationOverrideService();
