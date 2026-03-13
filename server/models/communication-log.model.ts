import mongoose, { Schema, Document } from "mongoose";

export type MessageType =
  | "text"
  | "template"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "reaction"
  | "interactive"
  | "button"
  | "unknown";

export interface IMediaInfo {
  mediaId?: string;
  mimeType?: string;
  sha256?: string;
  fileName?: string;
  fileSize?: number;
  caption?: string;
  url?: string;
  downloadUrl?: string;
  urlExpiresAt?: Date;
  base64?: string;
}

export interface ILocationInfo {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface IContactInfo {
  name: { formatted_name: string; first_name?: string; last_name?: string };
  phones?: Array<{ phone: string; type?: string }>;
  emails?: Array<{ email: string; type?: string }>;
  org?: { company?: string; title?: string };
}

export interface ICommunicationLog extends Document {
  timestamp: Date;
  recipient: string;
  content: string;
  status: "Success" | "Failed" | "Pending";
  messageId?: string;
  retryCount: number;
  errorMessage?: string;
  tenantId: mongoose.Types.ObjectId;
  channel?: "sms" | "email" | "whatsapp";
  direction?: "inbound" | "outbound";
  sender?: string;
  messageType?: MessageType;
  media?: IMediaInfo;
  location?: ILocationInfo;
  contacts?: IContactInfo[];
  metadata?: Record<string, any>;
}

const MediaInfoSchema = new Schema(
  {
    mediaId: { type: String },
    mimeType: { type: String },
    sha256: { type: String },
    fileName: { type: String },
    fileSize: { type: Number },
    caption: { type: String },
    url: { type: String },
    downloadUrl: { type: String },
    urlExpiresAt: { type: Date },
    base64: { type: String },
  },
  { _id: false }
);

const LocationInfoSchema = new Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    name: { type: String },
    address: { type: String },
  },
  { _id: false }
);

const ContactInfoSchema = new Schema(
  {
    name: {
      formatted_name: { type: String, required: true },
      first_name: { type: String },
      last_name: { type: String },
    },
    phones: [{ phone: { type: String }, type: { type: String } }],
    emails: [{ email: { type: String }, type: { type: String } }],
    org: { company: { type: String }, title: { type: String } },
  },
  { _id: false }
);

const CommunicationLogSchema = new Schema<ICommunicationLog>(
  {
    timestamp: { type: Date, default: Date.now },
    recipient: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ["Success", "Failed", "Pending"], default: "Pending" },
    messageId: { type: String },
    retryCount: { type: Number, default: 0 },
    errorMessage: { type: String },
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
    channel: { type: String, enum: ["sms", "email", "whatsapp"], default: "sms" },
    direction: { type: String, enum: ["inbound", "outbound"], default: "outbound" },
    sender: { type: String },
    messageType: {
      type: String,
      enum: ["text", "template", "image", "video", "audio", "document", "sticker", "location", "contacts", "reaction", "interactive", "button", "unknown"],
      default: "text",
    },
    media: { type: MediaInfoSchema },
    location: { type: LocationInfoSchema },
    contacts: [ContactInfoSchema],
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: false }
);

export const CommunicationLogModel = mongoose.model<ICommunicationLog>("CommunicationLog", CommunicationLogSchema);
