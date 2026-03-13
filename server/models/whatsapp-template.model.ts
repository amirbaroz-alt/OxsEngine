import mongoose, { Schema, Document } from "mongoose";

export interface IWhatsAppTemplate extends Document {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  friendlyName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DRAFT";
  category: string;
  language: string;
  components: any[];
  bodyText: string;
  rawBodyContent: string;
  metaTemplateId: string | null;
  variableMapping: Record<string, any>;
  variables: any[];
  buttons: any[];
  isActive: boolean;
  teamId: mongoose.Types.ObjectId | null;
  tagIds: mongoose.Types.ObjectId[];
  lastSynced: Date | null;
  rejectedReason: string | null;
}

const WhatsAppTemplateSchema = new Schema<IWhatsAppTemplate>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, lowercase: true, match: /^[a-z0-9_]+$/ },
    friendlyName: { type: String, default: "" },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DRAFT"], default: "PENDING" },
    category: { type: String, required: true },
    language: { type: String, required: true },
    components: { type: Schema.Types.Mixed, default: [] },
    bodyText: { type: String, default: "" },
    rawBodyContent: { type: String, default: "" },
    metaTemplateId: { type: String, default: null },
    variableMapping: { type: Schema.Types.Mixed, default: {} },
    variables: { type: [Schema.Types.Mixed], default: [] },
    buttons: { type: [Schema.Types.Mixed], default: [] },
    isActive: { type: Boolean, default: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null, index: true },
    tagIds: [{ type: Schema.Types.ObjectId, ref: "TemplateTag" }],
    lastSynced: { type: Date, default: null },
    rejectedReason: { type: String, default: null },
  },
  { timestamps: true }
);

WhatsAppTemplateSchema.index({ tenantId: 1, name: 1, language: 1 }, { unique: true });

export const WhatsAppTemplateModel = mongoose.model<IWhatsAppTemplate>("WhatsAppTemplate", WhatsAppTemplateSchema);

export function getWhatsAppTemplateModel(conn: mongoose.Connection) {
  return conn.models.WhatsAppTemplate || conn.model<IWhatsAppTemplate>("WhatsAppTemplate", WhatsAppTemplateSchema);
}
