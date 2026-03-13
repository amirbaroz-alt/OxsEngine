import mongoose, { Schema, Document } from "mongoose";

export type ChannelType = "WHATSAPP" | "SMS" | "EMAIL";
export type ChannelStatus = "active" | "disconnected";

export interface IChannel extends Document {
  tenantId: mongoose.Types.ObjectId;
  type: ChannelType;
  name: string;
  phoneNumber?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  accessToken?: string | null;
  verifyToken?: string | null;
  appSecret?: string | null;
  status: ChannelStatus;
  tokenExpiredAt?: Date | null;
  isActive: boolean;
  smsUserName?: string | null;
  smsSource?: string | null;
  sendGridKey?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  teamIds?: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const ChannelSchema = new Schema<IChannel>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    type: {
      type: String,
      enum: ["WHATSAPP", "SMS", "EMAIL"],
      required: true,
    },
    name: { type: String, required: true },
    phoneNumber: { type: String, default: null },
    phoneNumberId: { type: String, default: null },
    wabaId: { type: String, default: null },
    accessToken: { type: String, default: null },
    verifyToken: { type: String, default: null },
    appSecret: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "disconnected"],
      default: "active",
    },
    tokenExpiredAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    smsUserName: { type: String, default: null },
    smsSource: { type: String, default: null },
    sendGridKey: { type: String, default: null },
    fromEmail: { type: String, default: null },
    fromName: { type: String, default: null },
    teamIds: [{ type: Schema.Types.ObjectId, ref: "Team" }],
  },
  { timestamps: true }
);

ChannelSchema.index({ tenantId: 1, type: 1 });
ChannelSchema.index({ phoneNumberId: 1 }, { sparse: true });
ChannelSchema.index({ phoneNumber: 1 }, { sparse: true });
ChannelSchema.index({ tenantId: 1, status: 1 });

export const ChannelModel = mongoose.model<IChannel>("Channel", ChannelSchema);
