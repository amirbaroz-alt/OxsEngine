import mongoose, { Schema, Document } from "mongoose";

export interface IActiveSession extends Document {
  tenantId: mongoose.Types.ObjectId;
  customerPhone: string;
  customerName: string;
  lastCustomerMessageAt: Date;
}

const ActiveSessionSchema = new Schema<IActiveSession>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    customerPhone: { type: String, required: true },
    customerName: { type: String, default: "" },
    lastCustomerMessageAt: { type: Date, required: true },
  },
  { timestamps: true }
);

ActiveSessionSchema.index({ tenantId: 1, customerPhone: 1 }, { unique: true });
ActiveSessionSchema.index({ tenantId: 1, lastCustomerMessageAt: -1 });

export const ActiveSessionModel = mongoose.model<IActiveSession>("ActiveSession", ActiveSessionSchema);

export function getActiveSessionModel(conn: mongoose.Connection) {
  return conn.models.ActiveSession || conn.model<IActiveSession>("ActiveSession", ActiveSessionSchema);
}
