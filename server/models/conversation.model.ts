import mongoose, { Schema, Document } from "mongoose";

export type ConversationStatus = "UNASSIGNED" | "ACTIVE" | "SNOOZED" | "RESOLVED" | "SPAM";
export type ChannelType = "WHATSAPP" | "SMS" | "EMAIL";

export type RoutingRule = "stickiness" | "vip" | "load_balance" | "pool" | "manual";

export interface IConversation extends Document {
  tenantId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId;
  status: ConversationStatus;
  channel: ChannelType;
  assignedTo?: mongoose.Types.ObjectId;
  assignedName?: string;
  assignedAt?: Date;
  groupId?: string;
  teamId?: string;
  routingRule?: RoutingRule;
  tags?: string[];
  resolutionTag?: string;
  resolutionSummary?: string;
  snoozedUntil?: Date;
  snoozedBy?: mongoose.Types.ObjectId;
  snoozeWakeAgentId?: mongoose.Types.ObjectId;
  snoozeWakeAgentName?: string;
  starred?: boolean;
  starredBy?: mongoose.Types.ObjectId;
  mergedInto?: mongoose.Types.ObjectId;
  isOrphan?: boolean;
  orphanPhoneNumberId?: string;
  unreadCount: number;
  lastMessageAt: Date;
  lastInboundAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel" },
    status: {
      type: String,
      enum: ["UNASSIGNED", "ACTIVE", "SNOOZED", "RESOLVED", "SPAM"],
      default: "UNASSIGNED",
    },
    channel: {
      type: String,
      enum: ["WHATSAPP", "SMS", "EMAIL"],
      required: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    assignedName: { type: String },
    assignedAt: { type: Date },
    groupId: { type: String },
    teamId: { type: String },
    routingRule: {
      type: String,
      enum: ["stickiness", "vip", "load_balance", "pool", "manual"],
    },
    tags: [{ type: String }],
    resolutionTag: { type: String },
    resolutionSummary: { type: String },
    snoozedUntil: { type: Date },
    snoozedBy: { type: Schema.Types.ObjectId, ref: "User" },
    snoozeWakeAgentId: { type: Schema.Types.ObjectId, ref: "User" },
    snoozeWakeAgentName: { type: String },
    starred: { type: Boolean, default: false },
    starredBy: { type: Schema.Types.ObjectId, ref: "User" },
    mergedInto: { type: Schema.Types.ObjectId, ref: "Conversation" },
    isOrphan: { type: Boolean, default: false },
    orphanPhoneNumberId: { type: String },
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
    lastInboundAt: { type: Date },
  },
  { timestamps: true }
);

ConversationSchema.index({ tenantId: 1, customerId: 1, status: 1 });
ConversationSchema.index({ tenantId: 1, status: 1, lastMessageAt: -1 });
ConversationSchema.index({ tenantId: 1, assignedTo: 1, status: 1 });
ConversationSchema.index({ tenantId: 1, groupId: 1, status: 1 });
ConversationSchema.index({ status: 1, snoozedUntil: 1 });
ConversationSchema.index(
  { tenantId: 1, customerId: 1, channelId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["UNASSIGNED", "ACTIVE", "SNOOZED"] }, channelId: { $exists: true } } }
);

export const ConversationModel = mongoose.model<IConversation>("Conversation", ConversationSchema);

export const getConversationModel = (conn: mongoose.Connection): mongoose.Model<IConversation> => {
  return conn.models.Conversation || conn.model<IConversation>("Conversation", ConversationSchema);
};
