import { log } from "../lib/logger";
import { ChannelModel } from "../models/channel.model";
import { TenantModel } from "../models/tenant.model";
import { getChannelToken, getDefaultWhatsAppChannel, flagChannelTokenExpired, clearChannelTokenExpired, type ChannelCredentials } from "./channel.service";
import axios from "axios";
import { communicationLogService } from "./communication-log.service";
import type { IContactInfo, MessageType } from "../models/communication-log.model";
import { META_GRAPH_API, isMetaTokenError } from "./whatsapp-media.service";
import type { SendWhatsAppParams, SendMediaParams, SendLocationParams, SendContactsParams, SendWhatsAppResult } from "./whatsapp-webhook.service";
import { API_REQUEST_TIMEOUT_MS, MEDIA_SEND_TIMEOUT_MS, MEDIA_UPLOAD_TIMEOUT_MS } from "../lib/constants/limits";
import { auditService } from "./audit.service";
import { encryptionService } from "./encryption.service";
import { READ_ONLY_TENANT_SLUGS, READ_ONLY_ERROR_HE } from "../lib/constants/static-routes";

function safeToken(creds: ChannelCredentials): string {
  if (creds.accessToken.startsWith("enc:")) {
    log(`[credentials] SAFETY-NET: Token still encrypted — decrypting`, "whatsapp");
    return encryptionService.decrypt(creds.accessToken);
  }
  return creds.accessToken;
}

const readOnlySlugCache = new Map<string, boolean>();

async function isReadOnlyTenant(tenantId: string): Promise<boolean> {
  const cached = readOnlySlugCache.get(tenantId);
  if (cached !== undefined) return cached;
  const tenant = await TenantModel.findById(tenantId).lean();
  const isRO = tenant ? READ_ONLY_TENANT_SLUGS.has((tenant as any).slug || "") : false;
  readOnlySlugCache.set(tenantId, isRO);
  return isRO;
}

export class WhatsAppSenderService {
  private async checkReadOnly(tenantId: string): Promise<SendWhatsAppResult | null> {
    if (await isReadOnlyTenant(tenantId)) {
      log(`[read-only] Outbound blocked for tenant ${tenantId} (read-only external channel)`, "whatsapp");
      return { success: false, errorMessage: READ_ONLY_ERROR_HE };
    }
    return null;
  }

  private async flagTokenExpired(tenantId: string): Promise<void> {
    try {
      const channel = await ChannelModel.findOne({
        tenantId,
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
      }).sort({ createdAt: 1 }).lean();

      if (channel) {
        await flagChannelTokenExpired(String(channel._id));
      }
      log(`Tenant ${tenantId}: WhatsApp token flagged as expired`, "whatsapp");
    } catch (err: any) {
      log(`Failed to flag token expired for tenant ${tenantId}: ${err.message}`, "whatsapp");
    }
  }

  private async getCredsOrFail(tenantId: string, channelId?: string, operation = "operation"): Promise<
    { ok: true; creds: ChannelCredentials } | { ok: false; result: SendWhatsAppResult }
  > {
    const creds = channelId
      ? await getChannelToken(channelId)
      : await getDefaultWhatsAppChannel(tenantId);
    if (creds) return { ok: true, creds };

    const expiredChannel = await ChannelModel.findOne({
      tenantId,
      type: "WHATSAPP",
      tokenExpiredAt: { $ne: null },
    }).lean();

    if (expiredChannel) {
      log(`${operation} blocked: token expired for tenant ${tenantId}`, "whatsapp");
      return {
        ok: false,
        result: {
          success: false,
          errorMessage: "WhatsApp access token has expired. Please update the token in Settings.",
          code: "WHATSAPP_TOKEN_EXPIRED" as const,
        },
      };
    }
    return {
      ok: false,
      result: {
        success: false,
        errorMessage: "No WhatsApp credentials configured (neither tenant nor global)",
      },
    };
  }

  async sendTextMessage(params: SendWhatsAppParams): Promise<SendWhatsAppResult> {
    const roBlock = await this.checkReadOnly(params.tenantId);
    if (roBlock) return roBlock;

    const traceId = await auditService.startTrace({
      direction: "OUTBOUND",
      tenantId: params.tenantId,
      rawPayload: JSON.stringify({ recipient: params.recipient, templateName: params.templateName, hasText: !!params.textBody }).substring(0, 500),
      messageType: params.templateName ? "template" : "text",
      senderPhone: params.recipient,
    });

    const creds = params.channelId
      ? await getChannelToken(params.channelId)
      : await getDefaultWhatsAppChannel(params.tenantId);
    if (!creds) {
      const expiredChannel = await ChannelModel.findOne({
        tenantId: params.tenantId,
        type: "WHATSAPP",
        tokenExpiredAt: { $ne: null },
      }).lean();

      const errMsg = expiredChannel
        ? "WhatsApp access token has expired. Please update the token in Settings."
        : "No WhatsApp credentials configured (neither tenant nor global)";

      if (expiredChannel) {
        log(`sendTextMessage blocked: token expired for tenant ${params.tenantId}`, "whatsapp");
        auditService.updateStep({ traceId, step: "CREDENTIAL_CHECK", status: "FAIL", error: "Token expired" });
        auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
        return {
          success: false,
          errorMessage: errMsg,
          code: "WHATSAPP_TOKEN_EXPIRED" as const,
        };
      }
      auditService.updateStep({ traceId, step: "CREDENTIAL_CHECK", status: "FAIL", error: "No credentials" });
      auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
      return {
        success: false,
        errorMessage: errMsg,
      };
    }

    const activeToken = safeToken(creds);
    const tokenPrefix = activeToken.substring(0, 4);
    log(`[credentials] Outbound token starting with: ${tokenPrefix}... (length=${activeToken.length})`, "whatsapp");

    auditService.updateStep({ traceId, step: "CREDENTIAL_CHECK", status: "OK" });

    try {
      const url = `${META_GRAPH_API}/${creds.phoneNumberId}/messages`;

      const payload: any = {
        messaging_product: "whatsapp",
        to: params.recipient,
      };

      if (params.replyToWaMessageId) {
        payload.context = { message_id: params.replyToWaMessageId };
      }

      if (params.templateName) {
        payload.type = "template";
        payload.template = {
          name: params.templateName,
          language: { code: params.templateLanguage || "he" },
        };
        const sendComponents: any[] = [];
        if (params.templateParams?.length) {
          sendComponents.push({
            type: "body",
            parameters: params.templateParams.map((p) => ({
              type: "text",
              text: p,
            })),
          });
        }
        if (params.templateButtonParams?.length) {
          for (const btnParam of params.templateButtonParams) {
            sendComponents.push({
              type: "button",
              sub_type: btnParam.sub_type,
              index: btnParam.index,
              parameters: btnParam.parameters,
            });
          }
        }
        if (sendComponents.length > 0) {
          payload.template.components = sendComponents;
        }
      } else {
        payload.type = "text";
        payload.text = { body: params.textBody || "" };
      }

      const metaStart = Date.now();
      const response = await axios.post(url, payload, {
        timeout: API_REQUEST_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
      });
      const metaDuration = Date.now() - metaStart;

      const msgId = response.data?.messages?.[0]?.id;
      log(`WhatsApp message sent to ${params.recipient}, id: ${msgId}`, "whatsapp");

      auditService.updateStep({ traceId, step: "META_API_SEND", status: "OK", durationMs: metaDuration });

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: params.textBody || params.templateName || "",
        status: "Success",
        messageId: msgId,
        retryCount: 0,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: params.templateName ? "template" : "text",
        metadata: {
          type: params.templateName ? "template" : "text",
          templateName: params.templateName,
        },
      });

      if (creds.channelId) {
        await clearChannelTokenExpired(creds.channelId);
      }

      auditService.finalizeTrace({ traceId, pipelineStatus: "COMPLETED" }).catch(() => {});
      return { success: true, messageId: msgId };
    } catch (error: any) {
      const errMsg =
        error.response?.data?.error?.message || error.message || "Unknown error";
      log(`WhatsApp send failed to ${params.recipient}: ${errMsg}`, "whatsapp");

      auditService.updateStep({ traceId, step: "META_API_SEND", status: "FAIL", error: errMsg });

      if (isMetaTokenError(error)) {
        if (creds.channelId) {
          await flagChannelTokenExpired(creds.channelId);
        } else {
          await this.flagTokenExpired(params.tenantId);
        }
        auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
        return { success: false, errorMessage: errMsg, code: "WHATSAPP_TOKEN_EXPIRED" as const };
      }

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: params.textBody || params.templateName || "",
        status: "Failed",
        retryCount: 0,
        errorMessage: errMsg,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: params.templateName ? "template" : "text",
      });

      auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
      return { success: false, errorMessage: errMsg };
    }
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SendWhatsAppResult> {
    const roBlock = await this.checkReadOnly(params.tenantId);
    if (roBlock) return roBlock;

    const creds = params.channelId
      ? await getChannelToken(params.channelId)
      : await getDefaultWhatsAppChannel(params.tenantId);
    if (!creds) {
      const expiredChannel = await ChannelModel.findOne({
        tenantId: params.tenantId,
        type: "WHATSAPP",
        tokenExpiredAt: { $ne: null },
      }).lean();

      if (expiredChannel) {
        log(`sendMediaMessage blocked: token expired for tenant ${params.tenantId}`, "whatsapp");
        return { success: false, errorMessage: "WhatsApp access token has expired.", code: "WHATSAPP_TOKEN_EXPIRED" as const };
      }
      return { success: false, errorMessage: "No WhatsApp credentials configured (neither tenant nor global)" };
    }

    if (!params.mediaUrl && !params.mediaId) {
      return { success: false, errorMessage: "Either mediaUrl or mediaId is required" };
    }

    try {
      const url = `${META_GRAPH_API}/${creds.phoneNumberId}/messages`;

      const mediaPayload: any = params.mediaId
        ? { id: params.mediaId }
        : { link: params.mediaUrl };

      if (params.caption && ["image", "video", "document"].includes(params.mediaType)) {
        mediaPayload.caption = params.caption;
      }
      if (params.fileName && params.mediaType === "document") {
        mediaPayload.filename = params.fileName;
      }

      const payload: any = {
        messaging_product: "whatsapp",
        to: params.recipient,
        type: params.mediaType,
        [params.mediaType]: mediaPayload,
      };

      if (params.replyToWaMessageId) {
        payload.context = { message_id: params.replyToWaMessageId };
      }

      const response = await axios.post(url, payload, {
        timeout: MEDIA_SEND_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${safeToken(creds)}`,
        },
      });

      const msgId = response.data?.messages?.[0]?.id;
      log(`WhatsApp ${params.mediaType} sent to ${params.recipient}, id: ${msgId}`, "whatsapp");

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: params.caption || `[${params.mediaType}]`,
        status: "Success",
        messageId: msgId,
        retryCount: 0,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: params.mediaType as MessageType,
        media: {
          mediaId: params.mediaId,
          url: params.mediaUrl,
          caption: params.caption,
          fileName: params.fileName,
        },
        metadata: {
          type: params.mediaType,
        },
      });

      return { success: true, messageId: msgId };
    } catch (error: any) {
      const errMsg =
        error.response?.data?.error?.message || error.message || "Unknown error";
      log(`WhatsApp ${params.mediaType} send failed to ${params.recipient}: ${errMsg}`, "whatsapp");

      if (isMetaTokenError(error)) {
        if (creds.channelId) {
          await flagChannelTokenExpired(creds.channelId);
        } else {
          await this.flagTokenExpired(params.tenantId);
        }
        return { success: false, errorMessage: errMsg, code: "WHATSAPP_TOKEN_EXPIRED" };
      }

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: params.caption || `[${params.mediaType}]`,
        status: "Failed",
        retryCount: 0,
        errorMessage: errMsg,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: params.mediaType as MessageType,
        media: {
          mediaId: params.mediaId,
          url: params.mediaUrl,
          caption: params.caption,
          fileName: params.fileName,
        },
      });

      return { success: false, errorMessage: errMsg };
    }
  }

  async sendLocationMessage(params: SendLocationParams): Promise<SendWhatsAppResult> {
    const roBlock = await this.checkReadOnly(params.tenantId);
    if (roBlock) return roBlock;

    const creds = await getDefaultWhatsAppChannel(params.tenantId);
    if (!creds) {
      const expiredChannel = await ChannelModel.findOne({
        tenantId: params.tenantId,
        type: "WHATSAPP",
        tokenExpiredAt: { $ne: null },
      }).lean();

      if (expiredChannel) {
        return { success: false, errorMessage: "WhatsApp access token has expired.", code: "WHATSAPP_TOKEN_EXPIRED" as const };
      }
      return { success: false, errorMessage: "No WhatsApp credentials configured (neither tenant nor global)" };
    }

    try {
      const url = `${META_GRAPH_API}/${creds.phoneNumberId}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        to: params.recipient,
        type: "location",
        location: {
          latitude: params.latitude,
          longitude: params.longitude,
          name: params.name || "",
          address: params.address || "",
        },
      };

      const response = await axios.post(url, payload, {
        timeout: API_REQUEST_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${safeToken(creds)}`,
        },
      });

      const msgId = response.data?.messages?.[0]?.id;
      log(`WhatsApp location sent to ${params.recipient}, id: ${msgId}`, "whatsapp");

      const textContent = params.name
        ? `${params.name} (${params.latitude}, ${params.longitude})`
        : `(${params.latitude}, ${params.longitude})`;

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: textContent,
        status: "Success",
        messageId: msgId,
        retryCount: 0,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: "location",
        location: {
          latitude: params.latitude,
          longitude: params.longitude,
          name: params.name,
          address: params.address,
        },
        metadata: { type: "location" },
      });

      return { success: true, messageId: msgId };
    } catch (error: any) {
      const errMsg =
        error.response?.data?.error?.message || error.message || "Unknown error";
      log(`WhatsApp location send failed to ${params.recipient}: ${errMsg}`, "whatsapp");
      return { success: false, errorMessage: errMsg };
    }
  }

  async sendContactsMessage(params: SendContactsParams): Promise<SendWhatsAppResult> {
    const roBlock = await this.checkReadOnly(params.tenantId);
    if (roBlock) return roBlock;

    const creds = await getDefaultWhatsAppChannel(params.tenantId);
    if (!creds) {
      const expiredChannel = await ChannelModel.findOne({
        tenantId: params.tenantId,
        type: "WHATSAPP",
        tokenExpiredAt: { $ne: null },
      }).lean();

      if (expiredChannel) {
        return { success: false, errorMessage: "WhatsApp access token has expired.", code: "WHATSAPP_TOKEN_EXPIRED" as const };
      }
      return { success: false, errorMessage: "No WhatsApp credentials configured (neither tenant nor global)" };
    }

    try {
      const url = `${META_GRAPH_API}/${creds.phoneNumberId}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        to: params.recipient,
        type: "contacts",
        contacts: params.contacts.map((c) => ({
          name: c.name,
          phones: c.phones || [],
          emails: c.emails || [],
          org: c.org || {},
        })),
      };

      const response = await axios.post(url, payload, {
        timeout: API_REQUEST_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${safeToken(creds)}`,
        },
      });

      const msgId = response.data?.messages?.[0]?.id;
      log(`WhatsApp contacts sent to ${params.recipient}, id: ${msgId}`, "whatsapp");

      const textContent = params.contacts.map((c) => c.name.formatted_name).join(", ");

      await communicationLogService.create({
        timestamp: new Date(),
        recipient: params.recipient,
        content: textContent,
        status: "Success",
        messageId: msgId,
        retryCount: 0,
        tenantId: params.tenantId as any,
        channel: "whatsapp",
        direction: "outbound",
        messageType: "contacts",
        contacts: params.contacts as IContactInfo[],
        metadata: { type: "contacts" },
      });

      return { success: true, messageId: msgId };
    } catch (error: any) {
      const errMsg =
        error.response?.data?.error?.message || error.message || "Unknown error";
      log(`WhatsApp contacts send failed to ${params.recipient}: ${errMsg}`, "whatsapp");
      return { success: false, errorMessage: errMsg };
    }
  }

  async uploadMedia(params: { tenantId: string; channelId?: string; buffer: Buffer; mimeType: string; fileName: string }): Promise<{ success: boolean; mediaId?: string; errorMessage?: string }> {
    const creds = params.channelId
      ? await getChannelToken(params.channelId)
      : await getDefaultWhatsAppChannel(params.tenantId);
    if (!creds) {
      return { success: false, errorMessage: "No WhatsApp credentials configured" };
    }

    log(`uploadMedia: starting upload for tenant=${params.tenantId}, file=${params.fileName}, mime=${params.mimeType}, size=${params.buffer.length} bytes, phoneNumberId=${creds.phoneNumberId}`, "whatsapp");

    try {
      const { Readable } = await import("stream");
      const FormData = (await import("form-data")).default;

      const url = `${META_GRAPH_API}/${creds.phoneNumberId}/media`;

      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      const fileStream = new Readable();
      fileStream.push(params.buffer);
      fileStream.push(null);
      form.append("file", fileStream, {
        filename: params.fileName,
        contentType: params.mimeType,
        knownLength: params.buffer.length,
      });
      form.append("type", params.mimeType);

      log(`uploadMedia: sending POST to ${url} (direct, no proxy)`, "whatsapp");

      const response = await axios.post(url, form, {
        timeout: MEDIA_UPLOAD_TIMEOUT_MS,
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${safeToken(creds)}`,
        },
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024,
      });

      log(`uploadMedia: response status=${response.status}, data=${JSON.stringify(response.data)}`, "whatsapp");

      const mediaId = response.data?.id;
      if (!mediaId) {
        return { success: false, errorMessage: "No media ID returned from WhatsApp" };
      }
      log(`Media uploaded to WhatsApp, mediaId: ${mediaId}`, "whatsapp");
      return { success: true, mediaId };
    } catch (error: any) {
      const status = error.response?.status;
      const metaError = error.response?.data?.error;
      const errMsg = metaError?.message || error.message || "Unknown error";
      const errCode = metaError?.code;
      const errSubcode = metaError?.error_subcode;
      const errType = metaError?.type;
      log(`uploadMedia FAILED: status=${status}, code=${errCode}, subcode=${errSubcode}, type=${errType}, message=${errMsg}, fullError=${JSON.stringify(error.response?.data || {})}`, "whatsapp");

      if (isMetaTokenError(error)) {
        if (creds.channelId) {
          await flagChannelTokenExpired(creds.channelId);
        } else {
          await this.flagTokenExpired(params.tenantId);
        }
        return { success: false, errorMessage: errMsg };
      }

      return { success: false, errorMessage: errMsg };
    }
  }
}

export const whatsappSenderService = new WhatsAppSenderService();
