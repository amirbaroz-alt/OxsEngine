import mongoose, { Schema, Document } from "mongoose";

export interface ICustomer extends Document {
  tenantId: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  crmId?: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  assignedAgentId?: mongoose.Types.ObjectId;
  assignedAgentName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, default: "" },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    crmId: { type: String, default: null },
    channel: {
      type: String,
      enum: ["WHATSAPP", "SMS", "EMAIL"],
      default: "WHATSAPP",
    },
    assignedAgentId: { type: Schema.Types.ObjectId, ref: "User" },
    assignedAgentName: { type: String },
  },
  { timestamps: true }
);

CustomerSchema.index({ tenantId: 1, phone: 1 }, { unique: true, sparse: true });
CustomerSchema.index({ tenantId: 1, email: 1 }, { sparse: true });
CustomerSchema.index({ tenantId: 1, crmId: 1 }, { sparse: true });
CustomerSchema.index({ tenantId: 1, createdAt: -1 });

export const CustomerModel = mongoose.model<ICustomer>("Customer", CustomerSchema);

export function getCustomerModel(conn: mongoose.Connection) {
  return conn.models.Customer || conn.model<ICustomer>("Customer", CustomerSchema);
}
