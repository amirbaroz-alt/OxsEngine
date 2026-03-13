import mongoose, { Schema, Document } from "mongoose";

export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageContentType = "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "STICKER" | "LOCATION" | "CONTACTS" | "FILE" | "SYSTEM";
export type MessageChannel = "WHATSAPP" | "SMS" | "EMAIL";
export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId;
  direction: MessageDirection;
  content: string;
  htmlContent?: string;
  type: MessageContentType;
  channel: MessageChannel;
  isInternal: boolean;
  senderId?: mongoose.Types.ObjectId;
  senderRole?: string;
  senderName?: string;
  deliveryStatus?: DeliveryStatus;
  deliveredAt?: Date;
  readAt?: Date;
  metadata?: Record<string, any>;
  replyToMessageId?: mongoose.Types.ObjectId;
  replyToContent?: string;
  replyToSender?: string;
  forwardedFromMessageId?: mongoose.Types.ObjectId;
  flagged?: boolean;
  deletedAt?: Date;
  editedAt?: Date;
  editedContent?: string;
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel" },
    direction: {
      type: String,
      enum: ["INBOUND", "OUTBOUND"],
      required: true,
    },
    content: { type: String, default: "" },
    htmlContent: { type: String },
    type: {
      type: String,
      enum: ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "STICKER", "LOCATION", "CONTACTS", "FILE", "SYSTEM"],
      default: "TEXT",
    },
    channel: {
      type: String,
      enum: ["WHATSAPP", "SMS", "EMAIL"],
      required: true,
    },
    isInternal: { type: Boolean, default: false },
    senderId: { type: Schema.Types.ObjectId, ref: "User" },
    senderRole: { type: String },
    senderName: { type: String },
    deliveryStatus: {
      type: String,
      enum: ["sent", "delivered", "read", "failed"],
    },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
    replyToMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
    replyToContent: { type: String },
    replyToSender: { type: String },
    forwardedFromMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
    flagged: { type: Boolean, default: false },
    deletedAt: { type: Date },
    editedAt: { type: Date },
    editedContent: { type: String },
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ tenantId: 1, createdAt: -1 });
MessageSchema.index(
  { "metadata.waMessageId": 1, tenantId: 1 },
  { unique: true, partialFilterExpression: { "metadata.waMessageId": { $exists: true } } }
);

export const MessageModel = mongoose.model<IMessage>("Message", MessageSchema);

export const getMessageModel = (conn: mongoose.Connection): mongoose.Model<IMessage> => {
  return conn.models.Message || conn.model<IMessage>("Message", MessageSchema);
};
