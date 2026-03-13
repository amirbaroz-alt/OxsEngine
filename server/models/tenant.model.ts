import mongoose, { Schema, Document } from "mongoose";

export interface IWhatsappConfig {
  phoneNumberId?: string | null;
  accessToken?: string | null;
  verifyToken?: string | null;
  wabaId?: string | null;
  tokenExpiredAt?: Date | null;
}

export interface ISmsConfig {
  userName?: string | null;
  accessToken?: string | null;
  source?: string | null;
}

export interface IMailConfig {
  sendGridKey?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
}

export interface IQuotaGuardConfig {
  proxyUrl?: string | null;
  enabled?: boolean;
}

export interface IAiSettings {
  systemPrompt?: string | null;
  provider?: string | null;
  modelName?: string | null;
}

export interface ISlaConfig {
  responseTimeMinutes?: number;
  warningTimeMinutes?: number;
  enabled?: boolean;
}

export interface ICustomerFieldDef {
  key: string;
  label: string;
  fieldType: string;
  uiWidth: number;
  options?: string[];
  isFilterable: boolean;
  forceNewRow: boolean;
  order: number;
}

export interface ITenant extends Document {
  nameHe: string;
  nameEn: string;
  logo?: string;
  primaryColor?: string;
  slug: string;
  defaultLanguage: string;
  active: boolean;
  tenantDbUri?: string | null;
  monthlyMessageQuota: number;
  messagesUsedThisMonth: number;
  inboundMessagesThisMonth: number;
  whatsappConfig?: IWhatsappConfig;
  smsConfig?: ISmsConfig;
  mailConfig?: IMailConfig;
  aiSettings?: IAiSettings;
  quotaGuardConfig?: IQuotaGuardConfig;
  slaConfig?: ISlaConfig;
  customerFields?: ICustomerFieldDef[];
  busyReasons?: string[];
}

const TenantSchema = new Schema<ITenant>(
  {
    nameHe: { type: String, required: true },
    nameEn: { type: String, required: true },
    logo: { type: String },
    primaryColor: { type: String },
    slug: { type: String, required: true, unique: true, lowercase: true },
    defaultLanguage: { type: String, enum: ["he", "en", "ar", "ru", "tr"], default: "he" },
    active: { type: Boolean, default: true },
    tenantDbUri: { type: String, default: null, select: false },
    monthlyMessageQuota: { type: Number, default: 999999 },
    messagesUsedThisMonth: { type: Number, default: 0 },
    inboundMessagesThisMonth: { type: Number, default: 0 },
    whatsappConfig: {
      type: {
        phoneNumberId: { type: String, default: null },
        accessToken: { type: String, default: null },
        verifyToken: { type: String, default: null },
        wabaId: { type: String, default: null },
        tokenExpiredAt: { type: Date, default: null },
      },
      default: { phoneNumberId: null, accessToken: null, verifyToken: null, wabaId: null, tokenExpiredAt: null },
      _id: false,
    },
    smsConfig: {
      type: {
        userName: { type: String, default: null },
        accessToken: { type: String, default: null },
        source: { type: String, default: null },
      },
      default: { userName: null, accessToken: null, source: null },
      _id: false,
    },
    mailConfig: {
      type: {
        sendGridKey: { type: String, default: null },
        fromEmail: { type: String, default: null },
        fromName: { type: String, default: null },
      },
      default: { sendGridKey: null, fromEmail: null, fromName: null },
      _id: false,
    },
    aiSettings: {
      type: {
        systemPrompt: { type: String, default: null },
        provider: { type: String, default: null },
        modelName: { type: String, default: null },
      },
      default: { systemPrompt: null, provider: null, modelName: null },
      _id: false,
    },
    quotaGuardConfig: {
      type: {
        proxyUrl: { type: String, default: null },
        enabled: { type: Boolean, default: false },
      },
      default: { proxyUrl: null, enabled: false },
      _id: false,
    },
    slaConfig: {
      type: {
        responseTimeMinutes: { type: Number, default: 15 },
        warningTimeMinutes: { type: Number, default: 10 },
        enabled: { type: Boolean, default: false },
      },
      default: { responseTimeMinutes: 15, warningTimeMinutes: 10, enabled: false },
      _id: false,
    },
    customerFields: {
      type: [
        {
          key: { type: String, required: true },
          label: { type: String, required: true },
          fieldType: { type: String, default: "text" },
          uiWidth: { type: Number, default: 12 },
          options: [String],
          isFilterable: { type: Boolean, default: true },
          forceNewRow: { type: Boolean, default: false },
          order: { type: Number, default: 0 },
        },
      ],
      default: [],
      _id: false,
    },
    busyReasons: {
      type: [String],
      default: ["meeting", "training", "backoffice"],
    },
  },
  { timestamps: false }
);

export const TenantModel = mongoose.model<ITenant>("Tenant", TenantSchema);
