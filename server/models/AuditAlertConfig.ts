import mongoose, { Schema, Document } from "mongoose";

export interface IAuditAlertConfig extends Document {
  tenantId: mongoose.Types.ObjectId;
  emails: string[];
  phones: string[];
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AuditAlertConfigSchema = new Schema<IAuditAlertConfig>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true, index: true },
    emails: [{ type: String }],
    phones: [{ type: String }],
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const AuditAlertConfigModel = mongoose.model<IAuditAlertConfig>(
  "AuditAlertConfig",
  AuditAlertConfigSchema
);
