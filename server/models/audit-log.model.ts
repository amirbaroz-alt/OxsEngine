import mongoose, { Schema, Document } from "mongoose";

export interface IAuditLog extends Document {
  actorId?: string;
  actorName?: string;
  role?: string;
  tenantId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: String },
    actorName: { type: String },
    role: { type: String },
    tenantId: { type: String },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    details: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1 });

export const AuditLogModel = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
