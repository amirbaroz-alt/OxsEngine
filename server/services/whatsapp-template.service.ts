import { getWhatsAppTemplateModel, type IWhatsAppTemplate } from "../models/whatsapp-template.model";
import { getTemplateTagModel, type ITemplateTag } from "../models/template-tag.model";
import { ChannelModel } from "../models/channel.model";
import { getCustomerModel } from "../models/customer.model";
import { decryptChannelFields } from "./channel.service";
import axios from "axios";
import { log } from "../lib/logger";
import { emitTemplateUpdate } from "./socket.service";
import { normalizeVariableMapping, type ResolvedVariable, type VariableDefinition, type TemplateVariable, type TemplateFieldType, type TemplateButton } from "@shared/schema";
import { API_REQUEST_TIMEOUT_MS, TEMPLATE_SYNC_TIMEOUT_MS } from "../lib/constants/limits";
import type mongoose from "mongoose";

const META_GRAPH_API = "https://graph.facebook.com/v24.0";

interface TenantWhatsAppConfig {
  wabaId: string;
  accessToken: string;
}

async function getTenantWAConfig(tenantId: string): Promise<TenantWhatsAppConfig | null> {
  const channel = await ChannelModel.findOne({
    tenantId,
    type: "WHATSAPP",
    status: "active",
    isActive: { $ne: false },
  }).lean();
  if (!channel) return null;
  const decrypted = decryptChannelFields(channel);
  if (!decrypted.wabaId || !decrypted.accessToken) return null;
  return { wabaId: decrypted.wabaId, accessToken: decrypted.accessToken };
}

export function processTemplateContent(rawText: string, existingVars?: TemplateVariable[]): { formattedBody: string; variables: TemplateVariable[] } {
  const fieldRegex = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
  const seen = new Map<string, number>();
  const variables: TemplateVariable[] = [];
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(rawText)) !== null) {
    const fieldName = match[1];
    if (!seen.has(fieldName)) {
      index++;
      seen.set(fieldName, index);
      const existing = existingVars?.find((v) => v.fieldName === fieldName);
      variables.push({
        index,
        fieldName,
        fieldType: existing?.fieldType || "TEXT",
        friendlyLabel: existing?.friendlyLabel || fieldName,
        order: existing?.order || index,
        options: existing?.options,
        hasDefault: existing?.hasDefault || false,
        defaultValue: existing?.defaultValue,
      });
    }
  }

  let formattedBody = rawText;
  for (const [fieldName, idx] of seen.entries()) {
    formattedBody = formattedBody.replace(new RegExp(`\\{\\{${fieldName}\\}\\}`, "g"), `{{${idx}}}`);
  }

  return { formattedBody, variables };
}

function buildMetaComponents(bodyText: string, buttons: TemplateButton[], variables?: TemplateVariable[]): any[] {
  const varMatches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  const maxIndex = varMatches.reduce((max, m) => {
    const idx = parseInt(m.replace(/[{}]/g, ""), 10);
    return idx > max ? idx : max;
  }, 0);
  const bodyComponent: any = { type: "BODY", text: bodyText };
  if (maxIndex > 0) {
    const varMap = new Map((variables || []).map((v) => [v.index, v]));
    const examples: string[] = [];
    for (let i = 1; i <= maxIndex; i++) {
      const v = varMap.get(i);
      examples.push(v ? (v.friendlyLabel || v.fieldName || `example${i}`) : `example${i}`);
    }
    bodyComponent.example = { body_text: [examples] };
  }
  const components: any[] = [bodyComponent];

  if (buttons.length > 0) {
    const metaButtons: any[] = buttons.map((btn) => {
      if (btn.type === "QUICK_REPLY") {
        return { type: "QUICK_REPLY", text: btn.text };
      } else if (btn.type === "URL") {
        let url = btn.url || "";
        if (btn.urlDynamic && !url.includes("{{1}}")) {
          url = url.replace(/\/?$/, "/{{1}}");
        }
        const urlBtn: any = { type: "URL", text: btn.text, url };
        if (btn.urlDynamic) {
          urlBtn.example = [url.replace(/\{\{1\}\}/, "example")];
        }
        return urlBtn;
      } else if (btn.type === "PHONE_NUMBER") {
        return { type: "PHONE_NUMBER", text: btn.text, phone_number: btn.phoneNumber || "" };
      }
      return { type: btn.type, text: btn.text };
    });
    components.push({ type: "BUTTONS", buttons: metaButtons });
  }

  return components;
}

function validateButtons(buttons: TemplateButton[]): void {
  const qrCount = buttons.filter((b) => b.type === "QUICK_REPLY").length;
  const ctaCount = buttons.filter((b) => b.type === "URL" || b.type === "PHONE_NUMBER").length;

  if (qrCount > 3) {
    throw new Error("Maximum 3 Quick Reply buttons allowed");
  }
  if (ctaCount > 2) {
    throw new Error("Maximum 2 Call-to-Action buttons (URL + Phone Number) allowed");
  }
  if (qrCount > 0 && ctaCount > 0) {
    throw new Error("Cannot mix Quick Reply and Call-to-Action buttons in the same template");
  }

  for (const btn of buttons) {
    if (!btn.text || btn.text.trim().length === 0) {
      throw new Error("Button text is required");
    }
    if (btn.type === "URL" && !btn.url) {
      throw new Error("URL is required for URL-type buttons");
    }
    if (btn.type === "PHONE_NUMBER" && !btn.phoneNumber) {
      throw new Error("Phone number is required for Phone Number-type buttons");
    }
  }
}

function validateBodyPlaceholders(rawBody: string, variables: TemplateVariable[]): void {
  const fieldRegex = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
  const definedNames = new Set(variables.map((v) => v.fieldName));
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(rawBody)) !== null) {
    const fieldName = match[1];
    if (!definedNames.has(fieldName)) {
      throw new Error(`Unknown placeholder {{${fieldName}}} in body text. All placeholders must be defined as fields.`);
    }
  }
}

function resolveDefaultValue(
  defaultValue: string | undefined,
  customer: any,
  user: any,
  tenant: any
): string {
  if (!defaultValue) return "";
  switch (defaultValue) {
    case "CURRENT_DATE": {
      const d = new Date();
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    }
    case "USER_NAME": return user?.name || "";
    case "USER_EMAIL": return user?.email || "";
    case "USER_PHONE": return user?.phone || "";
    case "TENANT_NAME": return tenant?.nameHe || tenant?.nameEn || "";
    case "CUSTOMER_FIRST_NAME": return customer?.firstName || "";
    case "CUSTOMER_LAST_NAME": return customer?.lastName || "";
    case "CUSTOMER_FULL_NAME": return [customer?.firstName, customer?.lastName].filter(Boolean).join(" ");
    case "CUSTOMER_PHONE": return customer?.phone || "";
    case "CUSTOMER_EMAIL": return customer?.email || "";
    default: return defaultValue;
  }
}

export class WhatsAppTemplateService {
  async getByTenant(tenantId: string, conn: mongoose.Connection): Promise<any[]> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const TemplateTagModel = getTemplateTagModel(conn);
    const templates = await WhatsAppTemplateModel.find({ tenantId }).sort({ name: 1 }).lean();
    const tagIds = [...new Set(templates.flatMap((t) => (t.tagIds || []).map(String)))];
    const tags = tagIds.length > 0 ? await TemplateTagModel.find({ _id: { $in: tagIds } }).lean() : [];
    const tagMap = new Map(tags.map((t) => [String(t._id), t]));

    return templates.map((tpl) => ({
      ...tpl,
      tags: (tpl.tagIds || []).map((id: any) => tagMap.get(String(id))).filter(Boolean),
    }));
  }

  async getById(id: string, conn: mongoose.Connection): Promise<IWhatsAppTemplate | null> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    return WhatsAppTemplateModel.findById(id).lean();
  }

  async create(data: {
    tenantId: string;
    name: string;
    friendlyName?: string;
    category: string;
    language: string;
    bodyText?: string;
    rawBodyContent?: string;
    variableMapping?: Record<string, any>;
    variables?: TemplateVariable[];
    buttons?: TemplateButton[];
    components?: any[];
    teamId?: string | null;
    isActive?: boolean;
  }, conn: mongoose.Connection): Promise<IWhatsAppTemplate> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    let finalBodyText = data.bodyText || "";
    let finalRawBody = data.rawBodyContent || "";
    let finalVariables: TemplateVariable[] = data.variables || [];
    let finalButtons: TemplateButton[] = data.buttons || [];

    if (finalRawBody) {
      const parsed = processTemplateContent(finalRawBody, finalVariables);
      finalBodyText = parsed.formattedBody;
      finalVariables = parsed.variables;
    }

    if (finalRawBody && finalVariables.length > 0) {
      validateBodyPlaceholders(finalRawBody, finalVariables);
    }

    if (finalButtons.length > 0) {
      validateButtons(finalButtons);
    }

    const components = buildMetaComponents(finalBodyText, finalButtons, finalVariables);

    const template = new WhatsAppTemplateModel({
      tenantId: data.tenantId,
      name: data.name.toLowerCase().replace(/\s+/g, "_"),
      friendlyName: data.friendlyName || "",
      category: data.category,
      language: data.language,
      bodyText: finalBodyText,
      rawBodyContent: finalRawBody,
      variableMapping: data.variableMapping || {},
      variables: finalVariables,
      buttons: finalButtons,
      components: data.components || components,
      status: "DRAFT",
      isActive: data.isActive !== false,
      teamId: data.teamId || null,
      tagIds: [],
    });
    return template.save();
  }

  async update(id: string, tenantId: string, data: Partial<{
    name: string;
    friendlyName: string;
    category: string;
    language: string;
    bodyText: string;
    rawBodyContent: string;
    variableMapping: Record<string, any>;
    variables: TemplateVariable[];
    buttons: TemplateButton[];
    components: any[];
    status: string;
    isActive: boolean;
    teamId: string | null;
  }>, conn: mongoose.Connection): Promise<IWhatsAppTemplate | null> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    if (data.name) {
      data.name = data.name.toLowerCase().replace(/\s+/g, "_");
    }
    if (data.rawBodyContent) {
      const parsed = processTemplateContent(data.rawBodyContent, data.variables);
      data.bodyText = parsed.formattedBody;
      data.variables = parsed.variables;
      const buttons = data.buttons || [];
      if (buttons.length > 0) {
        validateButtons(buttons);
      }
      data.components = buildMetaComponents(parsed.formattedBody, buttons, parsed.variables);
    }
    return WhatsAppTemplateModel.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: data },
      { new: true }
    ).lean();
  }

  async updateMetadata(id: string, tenantId: string, data: {
    friendlyName?: string;
    tagIds?: string[];
  }, conn: mongoose.Connection): Promise<IWhatsAppTemplate | null> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const update: any = {};
    if (data.friendlyName !== undefined) update.friendlyName = data.friendlyName;
    if (data.tagIds !== undefined) update.tagIds = data.tagIds;
    if (Object.keys(update).length === 0) return this.getById(id, conn);
    return WhatsAppTemplateModel.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: update },
      { new: true }
    ).lean();
  }

  async delete(id: string, tenantId: string, conn: mongoose.Connection): Promise<{ success: boolean; error?: string }> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const template = await WhatsAppTemplateModel.findOne({ _id: id, tenantId });
    if (!template) return { success: false, error: "NOT_FOUND" };

    if (template.metaTemplateId) {
      const config = await getTenantWAConfig(tenantId);
      if (config) {
        try {
          await axios.delete(
            `${META_GRAPH_API}/${config.wabaId}/message_templates?name=${template.name}`,
            {
              timeout: API_REQUEST_TIMEOUT_MS,
              headers: { Authorization: `Bearer ${config.accessToken}` },
            }
          );
          log(`Template ${template.name} deleted from Meta for tenant ${tenantId}`, "whatsapp");
        } catch (error: any) {
          const errMsg = error?.response?.data?.error?.message || error.message;
          log(`Meta template delete failed for ${template.name}: ${errMsg}`, "whatsapp");
          return { success: false, error: `META_DELETE_FAILED: ${errMsg}` };
        }
      }
    }

    await WhatsAppTemplateModel.deleteOne({ _id: id, tenantId });
    return { success: true };
  }

  async syncFromMeta(tenantId: string, conn: mongoose.Connection): Promise<{ synced: number; error?: string }> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const config = await getTenantWAConfig(tenantId);
    if (!config) {
      return { synced: 0, error: "CONFIG_REQUIRED" };
    }

    try {
      const url = `${META_GRAPH_API}/${config.wabaId}/message_templates?limit=100`;
      const response = await axios.get(url, {
        timeout: TEMPLATE_SYNC_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
        },
      });

      const metaTemplates = response.data?.data || [];
      let synced = 0;

      let statusChanges = 0;
      for (const mt of metaTemplates) {
        const bodyComponent = mt.components?.find((c: any) => c.type === "BODY");
        const bodyText = bodyComponent?.text || "";
        const rejectedReason = mt.rejected_reason || mt.quality_score?.reasons?.join(", ") || null;
        const mappedStatus = this.mapMetaStatus(mt.status);

        const existing = await WhatsAppTemplateModel.findOne({ tenantId, name: mt.name, language: mt.language }).lean();
        const statusChanged = !existing || existing.status !== mappedStatus;

        const updated = await WhatsAppTemplateModel.findOneAndUpdate(
          { tenantId, name: mt.name, language: mt.language },
          {
            $set: {
              status: mappedStatus,
              category: mt.category || "UTILITY",
              components: mt.components || [],
              bodyText,
              metaTemplateId: mt.id || null,
              lastSynced: new Date(),
              rejectedReason: rejectedReason,
            },
          },
          { upsert: true, new: true }
        );
        synced++;

        if (statusChanged && updated) {
          statusChanges++;
          emitTemplateUpdate(tenantId, {
            templateId: String(updated._id),
            status: mappedStatus,
            templateName: mt.name,
          });
        }
      }

      log(`Synced ${synced} templates from Meta for tenant ${tenantId} (${statusChanges} status change(s))`, "whatsapp");
      return { synced: statusChanges };
    } catch (error: any) {
      const errMsg = error.response?.data?.error?.message || error.message;
      log(`Meta template sync failed for tenant ${tenantId}: ${errMsg}`, "whatsapp");
      return { synced: 0, error: errMsg };
    }
  }

  async submitToMeta(templateId: string, tenantId: string, conn: mongoose.Connection): Promise<{ success: boolean; metaTemplateId?: string; error?: string }> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const config = await getTenantWAConfig(tenantId);
    if (!config) {
      return { success: false, error: "CONFIG_REQUIRED" };
    }

    const template = await WhatsAppTemplateModel.findOne({ _id: templateId, tenantId });
    if (!template) {
      return { success: false, error: "Template not found" };
    }

    try {
      const url = `${META_GRAPH_API}/${config.wabaId}/message_templates`;

      const components = buildMetaComponents(template.bodyText, template.buttons || [], template.variables || []);

      const payload: any = {
        name: template.name,
        category: template.category.toUpperCase(),
        language: template.language,
        components,
      };

      const response = await axios.post(url, payload, {
        timeout: TEMPLATE_SYNC_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.accessToken}`,
        },
      });

      const metaId = response.data?.id;
      await WhatsAppTemplateModel.findByIdAndUpdate(templateId, {
        $set: {
          metaTemplateId: metaId || null,
          status: "PENDING",
          rejectedReason: null,
        },
      });

      log(`Template ${template.name} submitted to Meta for tenant ${tenantId}, metaId: ${metaId}`, "whatsapp");
      return { success: true, metaTemplateId: metaId };
    } catch (error: any) {
      const errData = error.response?.data?.error;
      const errMsg = errData?.error_user_msg || errData?.message || error.message;
      log(`Meta template submit failed for ${template.name}: ${errMsg} | full error: ${JSON.stringify(errData)}`, "whatsapp");
      return { success: false, error: errMsg };
    }
  }

  async checkTenantConfig(tenantId: string): Promise<{ configured: boolean; missing: string[] }> {
    const channel = await ChannelModel.findOne({
      tenantId,
      type: "WHATSAPP",
      status: "active",
      isActive: { $ne: false },
    }).lean();
    if (!channel) return { configured: false, missing: ["channel"] };

    const decrypted = decryptChannelFields(channel);
    const missing: string[] = [];
    if (!decrypted.wabaId) missing.push("wabaId");
    if (!decrypted.accessToken) missing.push("accessToken");

    return { configured: missing.length === 0, missing };
  }

  async getTagsByTenant(tenantId: string, conn: mongoose.Connection): Promise<ITemplateTag[]> {
    const TemplateTagModel = getTemplateTagModel(conn);
    return TemplateTagModel.find({ tenantId }).sort({ name: 1 }).lean();
  }

  async createTag(tenantId: string, name: string, color: string, conn: mongoose.Connection): Promise<ITemplateTag> {
    const TemplateTagModel = getTemplateTagModel(conn);
    const tag = new TemplateTagModel({ tenantId, name, color: color || "#6366f1" });
    return tag.save();
  }

  async updateTag(id: string, tenantId: string, data: { name?: string; color?: string }, conn: mongoose.Connection): Promise<ITemplateTag | null> {
    const TemplateTagModel = getTemplateTagModel(conn);
    return TemplateTagModel.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: data },
      { new: true }
    ).lean();
  }

  async deleteTag(id: string, tenantId: string, conn: mongoose.Connection): Promise<boolean> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const TemplateTagModel = getTemplateTagModel(conn);
    const result = await TemplateTagModel.deleteOne({ _id: id, tenantId });
    if (result.deletedCount > 0) {
      await WhatsAppTemplateModel.updateMany(
        { tenantId, tagIds: id },
        { $pull: { tagIds: id } }
      );
      return true;
    }
    return false;
  }

  async resolveTemplateParams(
    templateId: string,
    tenantId: string,
    customerId: string,
    userId: string,
    conn: mongoose.Connection,
    manualValues?: Record<string, string>
  ): Promise<{ fields: ResolvedVariable[]; params: string[]; buttons?: TemplateButton[] }> {
    const WhatsAppTemplateModel = getWhatsAppTemplateModel(conn);
    const CustomerModel = getCustomerModel(conn);
    const template = await WhatsAppTemplateModel.findOne({ _id: templateId, tenantId }).lean();
    if (!template) throw new Error("Template not found");

    const customer = customerId ? await CustomerModel.findById(customerId).lean() : null;

    let user: any = null;
    if (userId) {
      const { UserModel } = await import("../models/user.model");
      user = await UserModel.findById(userId).lean();
    }

    const { TenantModel } = await import("../models/tenant.model");
    const tenant = await TenantModel.findById(tenantId).lean();

    const fields: ResolvedVariable[] = [];

    if (template.variables && template.variables.length > 0) {
      const sortedVars = [...template.variables].sort((a: any, b: any) => a.index - b.index);
      for (const v of sortedVars) {
        const pos = String(v.index);
        let value = "";
        const hasValidDefault = v.hasDefault && !!v.defaultValue;
        const isManual = !hasValidDefault;

        if (manualValues?.[pos]) {
          value = manualValues[pos];
        } else if (hasValidDefault) {
          value = resolveDefaultValue(v.defaultValue, customer, user, tenant);
        }

        fields.push({
          position: pos,
          label: v.friendlyLabel || v.fieldName,
          source: v.defaultValue || "manual",
          value,
          isManual,
          fieldType: v.fieldType || "TEXT",
          options: v.options,
        });
      }
    } else {
      const normalized = normalizeVariableMapping(template.variableMapping || {});
      const positions = Object.keys(normalized).sort((a, b) => Number(a) - Number(b));

      for (const pos of positions) {
        const def = normalized[pos];
        const isManual = def.source === "manual";
        let value = "";

        if (isManual) {
          value = manualValues?.[pos] || "";
        } else {
          value = this.resolveFieldValue(def.source, customer, user, tenant) || "";
        }

        fields.push({
          position: pos,
          label: def.label,
          source: def.source,
          value,
          isManual,
          fieldType: "TEXT",
        });
      }
    }

    return {
      fields,
      params: fields.map((f) => f.value),
      buttons: template.buttons || [],
    };
  }

  private resolveFieldValue(source: string, customer: any, user: any, tenant: any): string {
    const [group, field] = source.split(".");
    if (!group || !field) return "";

    if (group === "customer" && customer) {
      if (field === "fullName") return [customer.firstName, customer.lastName].filter(Boolean).join(" ");
      return String(customer[field] || "");
    }
    if (group === "user" && user) {
      return String(user[field] || "");
    }
    if (group === "tenant" && tenant) {
      if (field === "name") return tenant.nameHe || tenant.nameEn || "";
      return String(tenant[field] || "");
    }
    return "";
  }

  private mapMetaStatus(metaStatus: string): "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" {
    const statusMap: Record<string, "PENDING" | "APPROVED" | "REJECTED" | "PAUSED"> = {
      APPROVED: "APPROVED",
      REJECTED: "REJECTED",
      PENDING: "PENDING",
      DISABLED: "REJECTED",
      PAUSED: "PAUSED",
      IN_APPEAL: "PENDING",
    };
    return statusMap[metaStatus?.toUpperCase()] || "PENDING";
  }
}

export const whatsappTemplateService = new WhatsAppTemplateService();
