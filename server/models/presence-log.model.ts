import mongoose, { Schema, Document } from "mongoose";

export interface IPresenceLog extends Document {
  userId: mongoose.Types.ObjectId;
  tenantId?: mongoose.Types.ObjectId;
  status: "active" | "busy" | "break" | "offline";
  reason: string;
  startedAt: Date;
  endedAt?: Date;
}

const PresenceLogSchema = new Schema<IPresenceLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant" },
    status: { type: String, enum: ["active", "busy", "break", "offline"], required: true },
    reason: { type: String, default: "" },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

PresenceLogSchema.index({ userId: 1, startedAt: -1 });
PresenceLogSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const PresenceLogModel = mongoose.model<IPresenceLog>("PresenceLog", PresenceLogSchema);
