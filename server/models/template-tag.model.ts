import mongoose, { Schema, Document } from "mongoose";

export interface ITemplateTag extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  color: string;
}

const TemplateTagSchema = new Schema<ITemplateTag>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    color: { type: String, default: "#6366f1" },
  },
  { timestamps: true }
);

TemplateTagSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const TemplateTagModel = mongoose.model<ITemplateTag>("TemplateTag", TemplateTagSchema);

export function getTemplateTagModel(conn: mongoose.Connection) {
  return conn.models.TemplateTag || conn.model<ITemplateTag>("TemplateTag", TemplateTagSchema);
}
