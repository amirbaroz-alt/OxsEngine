import { z } from "zod";

export const supportedLanguages = ["he", "en", "ar", "ru"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const customFieldDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fieldType: z.enum(["text", "number", "date", "select", "combobox", "textarea", "boolean"]).default("text"),
  uiWidth: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(9), z.literal(12)]).default(12),
  options: z.array(z.string()).optional(),
  isFilterable: z.boolean().default(true),
  forceNewRow: z.boolean().default(false),
  order: z.number().default(0),
});

export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const standardFieldLayoutSchema = z.object({
  fieldKey: z.string().min(1),
  uiWidth: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(9), z.literal(12)]).default(6),
  forceNewRow: z.boolean().default(false),
  order: z.number().default(0),
});

export type StandardFieldLayout = z.infer<typeof standardFieldLayoutSchema>;

export const STANDARD_TENANT_FIELDS = ["nameHe", "nameEn", "slug", "defaultLanguage", "logo", "active"] as const;

export const systemSettingsSchema = z.object({
  _id: z.string(),
  key: z.string().min(1),
  tenantFormFieldsLayout: z.array(standardFieldLayoutSchema).optional().default([]),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const whatsappConfigSchema = z.object({
  phoneNumberId: z.string().nullable().optional().default(null),
  accessToken: z.string().nullable().optional().default(null),
  verifyToken: z.string().nullable().optional().default(null),
  wabaId: z.string().nullable().optional().default(null),
});
export type WhatsappConfig = z.infer<typeof whatsappConfigSchema>;

export const smsConfigSchema = z.object({
  userName: z.string().nullable().optional().default(null),
  accessToken: z.string().nullable().optional().default(null),
  source: z.string().nullable().optional().default(null),
});
export type SmsConfig = z.infer<typeof smsConfigSchema>;

export const mailConfigSchema = z.object({
  sendGridKey: z.string().nullable().optional().default(null),
  fromEmail: z.string().nullable().optional().default(null),
  fromName: z.string().nullable().optional().default(null),
});
export type MailConfig = z.infer<typeof mailConfigSchema>;

export const quotaGuardConfigSchema = z.object({
  proxyUrl: z.string().nullable().optional().default(null),
  enabled: z.boolean().optional().default(false),
});
export type QuotaGuardConfig = z.infer<typeof quotaGuardConfigSchema>;

export const slaConfigSchema = z.object({
  responseTimeMinutes: z.number().min(1).optional().default(15),
  warningTimeMinutes: z.number().min(1).optional().default(10),
  enabled: z.boolean().optional().default(false),
});
export type SlaConfig = z.infer<typeof slaConfigSchema>;

export const aiSettingsSchema = z.object({
  systemPrompt: z.string().nullable().optional().default(null),
  provider: z.string().nullable().optional().default(null),
  modelName: z.string().nullable().optional().default(null),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const tenantSchema = z.object({
  _id: z.string(),
  nameHe: z.string().min(1),
  nameEn: z.string().min(1),
  logo: z.string().optional(),
  primaryColor: z.string().optional(),
  slug: z.string().min(1),
  defaultLanguage: z.enum(supportedLanguages).default("he"),
  active: z.boolean().default(true),
  whatsappConfig: whatsappConfigSchema.optional().default({ phoneNumberId: null, accessToken: null, verifyToken: null, wabaId: null }),
  smsConfig: smsConfigSchema.optional().default({ userName: null, accessToken: null, source: null }),
  mailConfig: mailConfigSchema.optional().default({ sendGridKey: null, fromEmail: null, fromName: null }),
  aiSettings: aiSettingsSchema.optional().default({ systemPrompt: null, provider: null, modelName: null }),
  quotaGuardConfig: quotaGuardConfigSchema.optional().default({ proxyUrl: null, enabled: false }),
  slaConfig: slaConfigSchema.optional().default({ responseTimeMinutes: 15, warningTimeMinutes: 10, enabled: false }),
  customerFields: z.array(customFieldDefinitionSchema).optional().default([]),
  busyReasons: z.array(z.string()).optional().default(["meeting", "training", "backoffice"]),
});

export const insertTenantSchema = tenantSchema.omit({ _id: true });
export type Tenant = z.infer<typeof tenantSchema>;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export const userRoles = ["superadmin", "businessadmin", "teamleader", "employee"] as const;
export type UserRole = (typeof userRoles)[number];

export const userSchema = z.object({
  _id: z.string(),
  name: z.string().min(1),
  phone: z.string().min(9),
  email: z.string().email(),
  role: z.enum(userRoles).default("employee"),
  tenantId: z.string().optional().default(""),
  active: z.boolean().default(true),
  teamIds: z.array(z.string()).optional().default([]),
  acwTimeLimit: z.number().min(0).optional().default(3),
  allowedBusyReasons: z.array(z.string()).optional().default([]),
});

export const insertUserSchema = userSchema.omit({ _id: true });
export type User = z.infer<typeof userSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;

export const communicationStatuses = ["Success", "Failed", "Pending"] as const;
export type CommunicationStatus = (typeof communicationStatuses)[number];

export const communicationChannels = ["SMS", "EMAIL", "WHATSAPP"] as const;
export type CommunicationChannel = (typeof communicationChannels)[number];

export const communicationLogSchema = z.object({
  _id: z.string(),
  timestamp: z.string(),
  recipient: z.string(),
  sender: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  content: z.string(),
  channel: z.enum(communicationChannels).default("SMS"),
  status: z.enum(communicationStatuses).default("Pending"),
  messageId: z.string().optional(),
  retryCount: z.number().default(0),
  errorMessage: z.string().optional(),
  tenantId: z.string(),
});

export const insertCommunicationLogSchema = communicationLogSchema.omit({ _id: true });
export type CommunicationLog = z.infer<typeof communicationLogSchema>;
export type InsertCommunicationLog = z.infer<typeof insertCommunicationLogSchema>;

export const auditLogSchema = z.object({
  _id: z.string(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  role: z.enum(userRoles).optional(),
  tenantId: z.string().optional(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().optional(),
  details: z.string().optional(),
  createdAt: z.string().optional(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const smsTemplateSchema = z.object({
  _id: z.string(),
  tenantId: z.string().optional(),
  templateType: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
  active: z.boolean().default(true),
});
export const insertSmsTemplateSchema = smsTemplateSchema.omit({ _id: true });
export type SmsTemplate = z.infer<typeof smsTemplateSchema>;
export type InsertSmsTemplate = z.infer<typeof insertSmsTemplateSchema>;

export const whatsappTemplateStatuses = ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DRAFT"] as const;
export type WhatsAppTemplateStatus = (typeof whatsappTemplateStatuses)[number];

export const templateTagSchema = z.object({
  _id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  color: z.string().default("#6366f1"),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type TemplateTag = z.infer<typeof templateTagSchema>;

export const whatsappTemplateSchema = z.object({
  _id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1).regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
  friendlyName: z.string().default(""),
  status: z.enum(whatsappTemplateStatuses).default("PENDING"),
  category: z.string().min(1),
  language: z.string().min(1),
  components: z.any().optional().default([]),
  bodyText: z.string().default(""),
  rawBodyContent: z.string().default(""),
  metaTemplateId: z.string().nullable().optional().default(null),
  variableMapping: z.record(z.string(), z.union([
    z.string(),
    z.object({ label: z.string(), source: z.string() }),
  ])).default({}),
  variables: z.array(z.object({
    index: z.number(),
    fieldName: z.string(),
    fieldType: z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "CHECKBOX", "RADIO"]).default("TEXT"),
    friendlyLabel: z.string(),
    order: z.number(),
    options: z.array(z.string()).optional(),
    hasDefault: z.boolean().default(false),
    defaultValue: z.string().optional(),
  })).default([]),
  buttons: z.array(z.object({
    type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
    text: z.string().min(1),
    url: z.string().optional(),
    phoneNumber: z.string().optional(),
    payload: z.string().optional(),
    urlDynamic: z.boolean().optional().default(false),
  })).default([]),
  isActive: z.boolean().default(true),
  teamId: z.string().nullable().optional().default(null),
  tagIds: z.array(z.string()).default([]),
  tags: z.array(templateTagSchema).optional().default([]),
  lastSynced: z.string().nullable().optional().default(null),
  rejectedReason: z.string().nullable().optional().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertWhatsappTemplateSchema = whatsappTemplateSchema.omit({ _id: true, createdAt: true, updatedAt: true });
export type WhatsAppTemplate = z.infer<typeof whatsappTemplateSchema>;
export type InsertWhatsAppTemplate = z.infer<typeof insertWhatsappTemplateSchema>;

export const templateFieldTypes = ["TEXT", "NUMBER", "DATE", "SELECT", "CHECKBOX", "RADIO"] as const;
export type TemplateFieldType = (typeof templateFieldTypes)[number];

export interface TemplateVariable {
  index: number;
  fieldName: string;
  fieldType: TemplateFieldType;
  friendlyLabel: string;
  order: number;
  options?: string[];
  hasDefault: boolean;
  defaultValue?: string;
}

export const templateButtonTypes = ["QUICK_REPLY", "URL", "PHONE_NUMBER"] as const;
export type TemplateButtonType = (typeof templateButtonTypes)[number];

export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  payload?: string;
  urlDynamic?: boolean;
}

export const templateButtonSchema = z.object({
  type: z.enum(templateButtonTypes),
  text: z.string().min(1),
  url: z.string().optional(),
  phoneNumber: z.string().optional(),
  payload: z.string().optional(),
  urlDynamic: z.boolean().optional().default(false),
});

export const DEFAULT_VALUE_KEYWORDS = [
  "CURRENT_DATE",
  "USER_NAME",
  "USER_EMAIL",
  "USER_PHONE",
  "TENANT_NAME",
  "CUSTOMER_FIRST_NAME",
  "CUSTOMER_LAST_NAME",
  "CUSTOMER_FULL_NAME",
  "CUSTOMER_PHONE",
  "CUSTOMER_EMAIL",
] as const;

export type DefaultValueKeyword = (typeof DEFAULT_VALUE_KEYWORDS)[number];

export const variableMappingOptions = [
  { value: "manual", label: "Manual (agent fills in)", group: "general" },
  { value: "customer.firstName", label: "First Name", group: "customer" },
  { value: "customer.lastName", label: "Last Name", group: "customer" },
  { value: "customer.fullName", label: "Full Name", group: "customer" },
  { value: "customer.phone", label: "Phone", group: "customer" },
  { value: "customer.email", label: "Email", group: "customer" },
  { value: "customer.idNumber", label: "ID Number", group: "customer" },
  { value: "customer.address", label: "Address", group: "customer" },
  { value: "user.name", label: "Agent Name", group: "user" },
  { value: "user.email", label: "Agent Email", group: "user" },
  { value: "user.phone", label: "Agent Phone", group: "user" },
  { value: "tenant.name", label: "Company Name", group: "tenant" },
] as const;

export interface VariableDefinition {
  label: string;
  source: string;
}

export function normalizeVariableMapping(
  mapping: Record<string, string | VariableDefinition>
): Record<string, VariableDefinition> {
  const result: Record<string, VariableDefinition> = {};
  for (const [key, val] of Object.entries(mapping)) {
    if (typeof val === "string") {
      const opt = variableMappingOptions.find((o) => o.value === val);
      result[key] = { label: opt?.label || `Variable ${key}`, source: val };
    } else {
      result[key] = val;
    }
  }
  return result;
}

export function variablesFromMapping(mapping: Record<string, string | VariableDefinition>): TemplateVariable[] {
  const normalized = normalizeVariableMapping(mapping);
  return Object.entries(normalized).map(([key, def], idx) => ({
    index: Number(key),
    fieldName: def.source === "manual" ? `Variable${key}` : def.source.split(".").pop() || `var${key}`,
    fieldType: "TEXT" as TemplateFieldType,
    friendlyLabel: def.label,
    order: idx + 1,
    hasDefault: def.source !== "manual",
    defaultValue: def.source !== "manual" ? keywordFromSource(def.source) : undefined,
  }));
}

function keywordFromSource(source: string): string | undefined {
  const map: Record<string, string> = {
    "customer.firstName": "CUSTOMER_FIRST_NAME",
    "customer.lastName": "CUSTOMER_LAST_NAME",
    "customer.fullName": "CUSTOMER_FULL_NAME",
    "customer.phone": "CUSTOMER_PHONE",
    "customer.email": "CUSTOMER_EMAIL",
    "user.name": "USER_NAME",
    "user.email": "USER_EMAIL",
    "user.phone": "USER_PHONE",
    "tenant.name": "TENANT_NAME",
  };
  return map[source];
}

export interface ResolvedVariable {
  position: string;
  label: string;
  source: string;
  value: string;
  isManual: boolean;
  fieldType: TemplateFieldType;
  options?: string[];
}

export const translationOverrideSchema = z.object({
  _id: z.string(),
  language: z.enum(supportedLanguages),
  key: z.string().min(1),
  value: z.string(),
});

export const insertTranslationOverrideSchema = translationOverrideSchema.omit({ _id: true });
export type TranslationOverride = z.infer<typeof translationOverrideSchema>;
export type InsertTranslationOverride = z.infer<typeof insertTranslationOverrideSchema>;
