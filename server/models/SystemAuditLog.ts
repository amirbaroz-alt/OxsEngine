import mongoose, { Schema, Document } from "mongoose";

export interface IAuditStep {
  step: string;
  status: string;
  error?: string;
  duration?: number;
  timestamp: Date;
}

export interface ISystemAuditLog extends Document {
  traceId: string;
  parentTraceId?: string;
  whatsappMessageId?: string;
  tenantId?: mongoose.Types.ObjectId;
  direction: "INBOUND" | "OUTBOUND";
  pipelineStatus: "PENDING" | "COMPLETED" | "FAILED" | "STUCK" | "PARTIAL" | "PARTIAL_BUFFER_EXCEEDED";
  encryptedContent?: string;
  sequenceTimestamp?: Date;
  assignedWorkerId?: mongoose.Types.ObjectId;
  handlingStatus: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  retryCount: number;
  steps: IAuditStep[];
  messageType?: string;
  mimeType?: string;
  fileSize?: number;
  senderPhone?: string;
  senderName?: string;
  phoneNumberId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditStepSchema = new Schema<IAuditStep>(
  {
    step: { type: String, required: true },
    status: { type: String, required: true },
    error: { type: String },
    duration: { type: Number },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SystemAuditLogSchema = new Schema<ISystemAuditLog>(
  {
    traceId: { type: String, required: true, unique: true, index: true },
    parentTraceId: { type: String, default: null, index: true },
    whatsappMessageId: { type: String, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", default: null },
    direction: {
      type: String,
      enum: ["INBOUND", "OUTBOUND"],
      required: true,
    },
    pipelineStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "STUCK", "PARTIAL", "PARTIAL_BUFFER_EXCEEDED"],
      default: "PENDING",
    },
    encryptedContent: { type: String },
    sequenceTimestamp: { type: Date },
    assignedWorkerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    handlingStatus: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      default: "OPEN",
    },
    retryCount: { type: Number, default: 0 },
    messageType: { type: String },
    mimeType: { type: String },
    fileSize: { type: Number },
    senderPhone: { type: String },
    senderName: { type: String },
    phoneNumberId: { type: String },
    steps: [AuditStepSchema],
  },
  { timestamps: true }
);

SystemAuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
SystemAuditLogSchema.index({ tenantId: 1, direction: 1 });
SystemAuditLogSchema.index({ pipelineStatus: 1 });
SystemAuditLogSchema.index({ sequenceTimestamp: -1 });
SystemAuditLogSchema.index({ pipelineStatus: 1, direction: 1, createdAt: -1 });
SystemAuditLogSchema.index({ "steps.step": 1, "steps.status": 1 });
SystemAuditLogSchema.index({ senderPhone: 1 });

export const SystemAuditLogModel = mongoose.model<ISystemAuditLog>(
  "SystemAuditLog",
  SystemAuditLogSchema
);
