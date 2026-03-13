import mongoose, { Schema, Document } from "mongoose";

export interface ISmsTemplate extends Document {
  tenantId?: string;
  templateType: string;
  name: string;
  content: string;
  active: boolean;
}

const SmsTemplateSchema = new Schema<ISmsTemplate>(
  {
    tenantId: { type: String },
    templateType: { type: String, required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: false }
);

SmsTemplateSchema.index({ tenantId: 1, templateType: 1 });

export const SmsTemplateModel = mongoose.model<ISmsTemplate>("SmsTemplate", SmsTemplateSchema);
