import mongoose, { Schema, Document } from "mongoose";

export interface ITranslationOverride extends Document {
  language: string;
  key: string;
  value: string;
}

const TranslationOverrideSchema = new Schema<ITranslationOverride>(
  {
    language: { type: String, required: true, enum: ["he", "en", "ar"] },
    key: { type: String, required: true },
    value: { type: String, required: true },
  },
  { timestamps: false }
);

TranslationOverrideSchema.index({ language: 1, key: 1 }, { unique: true });

export const TranslationOverrideModel = mongoose.model<ITranslationOverride>(
  "TranslationOverride",
  TranslationOverrideSchema
);
