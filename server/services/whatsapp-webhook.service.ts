import { log } from "../index";
import { TenantModel, type ITenant } from "../models/tenant.model";
import { ChannelModel } from "../models/channel.model";
import { getWhatsAppTemplateModel } from "../models/whatsapp-template.model";
import { getCustomerModel } from "../models/customer.model";
import { getConversationModel } from "../models/conversation.model";
import { getMessageModel } from "../models/message.model";
import { tenantDbManager } from "../lib/db-manager";
import type mongoose from "mongoose";
import { getDefaultWhatsAppChannel, findChannelByPhoneNumberId, findChannelByDisplayPhone, flagChannelTokenExpired, clearChannelTokenExpired, decryptChannelFields, normalizePhoneForMatch, type ChannelCredentials } from "./channel.service";
import axios from "axios";
import { communicationLogService } from "./communication-log.service";
import { emitNewMessage, emitNewConversation, emitMessageStatus, emitConversationAssigned, emitStatusChanged, emitTemplateUpdate } from "./socket.service";
import { markLocalEmit } from "./change-stream.service";
import { routeConversation } from "./routing.service";
import type { IMediaInfo, ILocationInfo, IContactInfo, MessageType } from "../models/communication-log.model";
import { whatsappMediaService, META_GRAPH_API as _META_GRAPH_API, isMetaTokenError as _isMetaTokenError } from "./whatsapp-media.service";
import { MEDIA_MAX_DOWNLOAD_SIZE, META_LIGHTWEIGHT_TIMEOUT_MS } from "../lib/constants/limits";
import { auditService } from "./audit.service";
import { withTimeout, PIPELINE_TIMEOUT_MS, TENANT_RESOLUTION_TIMEOUT_MS } from "../lib/with-timeout";
import { encryptionService } from "./encryption.service";
import { channelCache } from "./channel-cache.service";
import { STATIC_PHONE_ROUTES } from "../lib/constants/static-routes";

export const META_GRAPH_API = _META_GRAPH_API;

const tenantLookupCache = new Map<string, { result: TenantLookupResult; expiresAt: number }>();
const TENANT_CACHE_TTL = 60_000;
const staticTenantCache = new Map<string, ITenant>();

const markReadBatch = new Map<string, { messageIds: string[]; creds: WhatsAppCredentials; timer: ReturnType<typeof setTimeout> }>();
const MARK_READ_DELAY = 2000;

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

export interface SendWhatsAppParams {
  recipient: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  templateButtonParams?: Array<{ type: string; sub_type?: string; index: number; parameters: any[] }>;
  textBody?: string;
  tenantId: string;
  channelId?: string;
  replyToWaMessageId?: string;
}

export interface SendMediaParams {
  recipient: string;
  tenantId: string;
  channelId?: string;
  mediaType: "image" | "video" | "audio" | "document" | "sticker";
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  fileName?: string;
  replyToWaMessageId?: string;
}

export interface SendLocationParams {
  recipient: string;
  tenantId: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface SendContactsParams {
  recipient: string;
  tenantId: string;
  contacts: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone: string; type?: string }>;
    emails?: Array<{ email: string; type?: string }>;
    org?: { company?: string; title?: string };
  }>;
}

export interface SendWhatsAppResult {
  success: boolean;
  messageId?: string;
  errorMessage?: string;
  code?: "WHATSAPP_TOKEN_EXPIRED" | "SEND_FAILED";
}

export interface IncomingWhatsAppMessage {
  from: string;
  messageId: string;
  timestamp: string;
  type: string;
  text?: string;
  tenantId: string;
  tenantName: string;
  phoneNumberId: string;
  media?: IMediaInfo;
  location?: ILocationInfo;
  contacts?: IContactInfo[];
}

export interface TenantLookupResult {
  tenant: ITenant;
  credentials: WhatsAppCredentials;
  channelId?: string;
}

export interface MediaMetadata {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export const isMetaTokenError = _isMetaTokenError;

export class WhatsAppWebhookService {
  private _expiredClearedChannels?: Set<string>;

  private async getTenantDbConnection(tenantId: string): Promise<mongoose.Connection> {
    const tenant = await TenantModel.findById(tenantId).select("+tenantDbUri");
    const envDbUrl = process.env.DATABASE_URL;
    const mongoEnvUrl = envDbUrl && envDbUrl.startsWith("mongodb") ? envDbUrl : undefined;
    const dbUri = tenant?.tenantDbUri || mongoEnvUrl || process.env.MONGODB_URI || "mongodb://localhost:27017/cpaas-platform";
    return tenantDbManager.getTenantConnection(tenantId, dbUri);
  }

  async flagTokenExpired(tenantId: string): Promise<void> {
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

  async clearTokenExpired(tenantId: string): Promise<void> {
    try {
      const channel = await ChannelModel.findOne({
        tenantId,
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
      }).sort({ createdAt: 1 }).lean();

      if (channel) {
        await clearChannelTokenExpired(String(channel._id));
      }
    } catch {}
  }

  async getCredentials(tenantId?: string): Promise<ChannelCredentials | null> {
    if (tenantId) {
      try {
        const channelCreds = await getDefaultWhatsAppChannel(tenantId);
        if (channelCreds) {
          return channelCreds;
        }
      } catch (err: any) {
        log(`Failed to fetch channel WhatsApp config: ${err.message}`, "whatsapp");
      }
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";

    if (!phoneNumberId || !accessToken) return null;
    return {
      channelId: "",
      tenantId: tenantId || "",
      phoneNumberId,
      accessToken,
      verifyToken,
    };
  }

  async getValidToken(tenantId: string): Promise<ChannelCredentials | null> {
    const channelCreds = await getDefaultWhatsAppChannel(tenantId);
    if (channelCreds) {
      return channelCreds;
    }

    const expiredChannel = await ChannelModel.findOne({
      tenantId,
      type: "WHATSAPP",
      tokenExpiredAt: { $ne: null },
    }).lean();

    if (expiredChannel) {
      log(
        `getValidToken: tenant ${tenantId} channel token flagged expired at ${expiredChannel.tokenExpiredAt}. Blocking usage.`,
        "whatsapp"
      );
      return null;
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";

    if (!phoneNumberId || !accessToken) {
      log(`getValidToken: no channel or env credentials for tenant ${tenantId}`, "whatsapp");
      return null;
    }

    return {
      channelId: "",
      tenantId,
      phoneNumberId,
      accessToken,
      verifyToken,
    };
  }

  async findTenantByPhoneNumberId(phoneNumberId: string, displayPhone?: string): Promise<TenantLookupResult | null> {
    const cached = tenantLookupCache.get(phoneNumberId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const staticSlug = STATIC_PHONE_ROUTES[phoneNumberId];
    if (staticSlug) {
      let tenant = staticTenantCache.get(staticSlug) || null;
      if (!tenant) {
        tenant = await TenantModel.findOne({ slug: staticSlug, active: true }).lean() as ITenant | null;
        if (tenant) staticTenantCache.set(staticSlug, tenant);
      }
      if (tenant) {
        channelCache.recordCacheHit();
        log(`[static-route] phoneNumberId=${phoneNumberId} → tenant slug="${staticSlug}" (${(tenant as any).nameEn || (tenant as any).nameHe})`, "whatsapp");
        const result: TenantLookupResult = {
          tenant,
          credentials: {
            phoneNumberId,
            accessToken: "",
            verifyToken: "",
          },
          channelId: undefined,
        };
        tenantLookupCache.set(phoneNumberId, { result, expiresAt: Date.now() + TENANT_CACHE_TTL });
        return result;
      }
      log(`[static-route] Tenant slug="${staticSlug}" not found in DB for phoneNumberId=${phoneNumberId}`, "whatsapp");
    }

    const cacheHit = channelCache.lookupByPhoneNumberId(phoneNumberId);
    if (cacheHit) {
      const tenant = await TenantModel.findById(cacheHit.tenantId).lean();
      if (tenant) {
        channelCache.recordCacheHit();
        log(`[channel-cache] HIT for phoneNumberId=${phoneNumberId} → tenant ${(tenant as any).nameEn || (tenant as any).nameHe}`, "whatsapp");
        const result: TenantLookupResult = {
          tenant: tenant as ITenant,
          credentials: channelCache.toCredentials(cacheHit),
          channelId: cacheHit.channelId,
        };
        tenantLookupCache.set(phoneNumberId, { result, expiresAt: Date.now() + TENANT_CACHE_TTL });
        return result;
      }
    }

    try {
      const channelResult = await findChannelByPhoneNumberId(phoneNumberId, displayPhone);
      if (channelResult) {
        const tenant = await TenantModel.findById(channelResult._decrypted.tenantId).lean();
        if (tenant) {
          channelCache.recordDbFallback();
          const result: TenantLookupResult = {
            tenant: tenant as ITenant,
            credentials: {
              phoneNumberId: channelResult._decrypted.phoneNumberId,
              accessToken: channelResult._decrypted.accessToken,
              verifyToken: channelResult._decrypted.verifyToken,
            },
            channelId: String(channelResult._id),
          };
          tenantLookupCache.set(phoneNumberId, { result, expiresAt: Date.now() + TENANT_CACHE_TTL });
          channelCache.upsert({
            channelId: String(channelResult._id),
            tenantId: String(channelResult._decrypted.tenantId),
            phoneNumberId: channelResult._decrypted.phoneNumberId,
            displayPhone: displayPhone || "",
            accessToken: channelResult._decrypted.accessToken,
            verifyToken: channelResult._decrypted.verifyToken,
            wabaId: channelResult._decrypted.wabaId,
          });
          return result;
        }
      }
    } catch (err: any) {
      log(`Error looking up tenant by phoneNumberId ${phoneNumberId}: ${err.message}`, "whatsapp");
    }

    channelCache.recordDbFallback();
    return null;
  }

  async findFallbackChannel(): Promise<TenantLookupResult | null> {
    try {
      const channels = await ChannelModel.find({
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
        phoneNumberId: { $ne: null },
      }).sort({ createdAt: 1 }).lean();

      for (const channel of channels) {
        const decrypted = decryptChannelFields(channel);
        if (decrypted.accessToken && decrypted.phoneNumberId) {
          const tenant = await TenantModel.findById(channel.tenantId).lean();
          if (tenant) {
            log(`[fallback] Using fallback channel ${channel.name} (${channel._id}) → tenant ${channel.tenantId}`, "whatsapp");
            return {
              tenant: tenant as ITenant,
              credentials: {
                phoneNumberId: decrypted.phoneNumberId,
                accessToken: decrypted.accessToken,
                verifyToken: decrypted.verifyToken || "",
              },
              channelId: String(channel._id),
            };
          }
        }
      }
    } catch (err: any) {
      log(`Error finding fallback channel: ${err.message}`, "whatsapp");
    }
    return null;
  }

  async verifyWebhook(verifyToken: string, phoneNumberId?: string): Promise<boolean> {
    if (phoneNumberId) {
      const result = await this.findTenantByPhoneNumberId(phoneNumberId);
      if (result && result.credentials.verifyToken === verifyToken) {
        return true;
      }
    }

    const channels = await ChannelModel.find({
      type: "WHATSAPP",
      status: "active",
      isActive: { $ne: false },
      verifyToken: { $ne: null },
    }).lean();

    for (const channel of channels) {
      const decrypted = decryptChannelFields(channel);
      if (decrypted.verifyToken === verifyToken) {
        return true;
      }
    }

    const globalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (globalVerifyToken && globalVerifyToken === verifyToken) {
      return true;
    }

    return false;
  }

  async validateMediaToken(accessToken: string, tenantId: string): Promise<{ valid: boolean; status: "valid" | "expired" | "unknown"; error?: string }> {
    return whatsappMediaService.validateMediaToken(accessToken, tenantId);
  }

  async fetchMediaMetadata(mediaId: string, accessToken: string, tenantId: string): Promise<MediaMetadata | null> {
    return whatsappMediaService.fetchMediaMetadata(mediaId, accessToken, tenantId);
  }

  async downloadMediaAsBuffer(mediaId: string, accessToken: string, tenantId: string, maxSize = MEDIA_MAX_DOWNLOAD_SIZE): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return whatsappMediaService.downloadMediaAsBuffer(mediaId, accessToken, tenantId, maxSize);
  }

  async downloadMediaAsBase64(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    return whatsappMediaService.downloadMediaAsBase64(mediaId, accessToken, tenantId);
  }

  async downloadMediaDirect(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    return whatsappMediaService.downloadMediaDirect(mediaId, accessToken, tenantId);
  }

  private extractMediaFromMessage(msg: any): IMediaInfo {
    return whatsappMediaService.extractMediaFromMessage(msg);
  }

  private extractLocationFromMessage(msg: any): ILocationInfo | undefined {
    return whatsappMediaService.extractLocationFromMessage(msg);
  }

  private extractContactsFromMessage(msg: any): IContactInfo[] | undefined {
    return whatsappMediaService.extractContactsFromMessage(msg);
  }

  private getMessageType(whatsappType: string): MessageType {
    return whatsappMediaService.getMessageType(whatsappType);
  }

  async processIncomingWebhook(body: any): Promise<IncomingWhatsAppMessage[]> {
    const messages: IncomingWhatsAppMessage[] = [];
    const queuePickupMs = Date.now();
    const enqueuedAt = body?._enqueuedAt;
    const webhookReceivedAt = body?._webhookReceivedAt;
    const traceId: string | undefined = body?._traceId;
    const urlIdentifier: string | undefined = body?._urlIdentifier;
    if (enqueuedAt) {
      log(`[perf] queue wait: ${queuePickupMs - enqueuedAt}ms`, "whatsapp");
    }
    if (webhookReceivedAt) {
      log(`[perf] webhook arrival→pickup: ${queuePickupMs - webhookReceivedAt}ms`, "whatsapp");
    }

    if (body?.object !== "whatsapp_business_account") {
      return messages;
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field === "message_template_status_update") {
          this.processTemplateStatusUpdate(change.value, entry.id).catch(
            (err: any) => log(`Template status update error: ${err.message}`, "whatsapp")
          );
          continue;
        }

        if (change.field !== "messages") continue;

        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        const displayPhoneNumber = value.metadata?.display_phone_number;

        if (!phoneNumberId) {
          log("Incoming webhook missing phone_number_id in metadata", "whatsapp");
          continue;
        }

        let isUrlMismatch = false;
        if (urlIdentifier && displayPhoneNumber) {
          const normalizedUrl = normalizePhoneForMatch(urlIdentifier);
          const normalizedDisplay = normalizePhoneForMatch(displayPhoneNumber);
          if (normalizedUrl && normalizedDisplay && normalizedUrl !== normalizedDisplay) {
            isUrlMismatch = true;
            log(`[gatekeeper] WEBHOOK_URL_MISMATCH: Meta sent message for ${displayPhoneNumber} to URL for ${urlIdentifier} (phoneNumberId=${phoneNumberId})`, "whatsapp");
            if (traceId) {
              auditService.updateStep({
                traceId,
                step: "WEBHOOK_URL_VALIDATION",
                status: "FAIL",
                error: `Meta sent message for ${displayPhoneNumber} to URL for ${urlIdentifier}`,
              });
            }
          } else if (traceId) {
            auditService.updateStep({ traceId, step: "WEBHOOK_URL_VALIDATION", status: "OK" });
          }
        }

        const tenantLookupStart = Date.now();
        let tenantResult: Awaited<ReturnType<typeof this.findTenantByPhoneNumberId>> | null = null;
        let isFallbackTenant = false;

        const resolveTenant = async (): Promise<{ result: Awaited<ReturnType<typeof this.findTenantByPhoneNumberId>> | null; fallback: boolean }> => {
          let res = await this.findTenantByPhoneNumberId(phoneNumberId, displayPhoneNumber);
          if (res) return { result: res, fallback: false };
          log(`No tenant found for phoneNumberId: ${phoneNumberId}, attempting display_phone cross-reference...`, "whatsapp");

          if (displayPhoneNumber) {
            const cachePhoneHit = channelCache.lookupByDisplayPhone(displayPhoneNumber);
            if (cachePhoneHit) {
              const tenant = await TenantModel.findById(cachePhoneHit.tenantId).lean();
              if (tenant) {
                log(`[channel-cache] HIT by displayPhone=${displayPhoneNumber} → tenant ${(tenant as any).nameEn || (tenant as any).nameHe}, healing phoneNumberId`, "whatsapp");
                channelCache.upsert({ ...cachePhoneHit, phoneNumberId });
                tenantLookupCache.delete(phoneNumberId);
                const result: TenantLookupResult = {
                  tenant: tenant as ITenant,
                  credentials: { ...channelCache.toCredentials(cachePhoneHit), phoneNumberId },
                  channelId: cachePhoneHit.channelId,
                };
                tenantLookupCache.set(phoneNumberId, { result, expiresAt: Date.now() + TENANT_CACHE_TTL });
                return { result, fallback: false };
              }
            }

            try {
              const healedChannel = await findChannelByDisplayPhone(displayPhoneNumber, phoneNumberId);
              if (healedChannel) {
                const tenant = await TenantModel.findById(healedChannel._decrypted.tenantId).lean();
                if (tenant) {
                  log(`[channel-heal] Resolved tenant ${(tenant as any).nameEn || (tenant as any).nameHe} via display_phone ${displayPhoneNumber} → healed phoneNumberId`, "whatsapp");
                  channelCache.upsert({
                    channelId: healedChannel._decrypted.channelId,
                    tenantId: healedChannel._decrypted.tenantId,
                    phoneNumberId,
                    displayPhone: displayPhoneNumber,
                    accessToken: healedChannel._decrypted.accessToken,
                    verifyToken: healedChannel._decrypted.verifyToken,
                    wabaId: healedChannel._decrypted.wabaId,
                  });
                  tenantLookupCache.delete(phoneNumberId);
                  const result: TenantLookupResult = {
                    tenant: tenant as ITenant,
                    credentials: {
                      phoneNumberId: healedChannel._decrypted.phoneNumberId,
                      accessToken: healedChannel._decrypted.accessToken,
                      verifyToken: healedChannel._decrypted.verifyToken,
                    },
                    channelId: healedChannel._decrypted.channelId,
                  };
                  tenantLookupCache.set(phoneNumberId, { result, expiresAt: Date.now() + TENANT_CACHE_TTL });
                  return { result, fallback: false };
                }
              }
            } catch (healErr: any) {
              log(`[channel-heal] Display phone cross-reference failed: ${healErr.message}`, "whatsapp");
            }
          }

          log(`No match by display_phone either, attempting fallback...`, "whatsapp");
          try {
            res = await this.findFallbackChannel();
            if (res) {
              log(`[fallback] Routed orphan message to fallback tenant ${res.tenant.nameEn || res.tenant.nameHe}`, "whatsapp");
              return { result: res, fallback: true };
            }
          } catch (fbErr: any) {
            log(`[fallback] Fallback channel lookup failed: ${fbErr.message}`, "whatsapp");
          }
          return { result: null, fallback: false };
        };

        try {
          const resolved = await withTimeout(
            resolveTenant(),
            TENANT_RESOLUTION_TIMEOUT_MS,
            `tenantResolution(${phoneNumberId})`
          );
          tenantResult = resolved.result;
          isFallbackTenant = resolved.fallback;

          if (isFallbackTenant && traceId) {
            auditService.updateStep({ traceId, step: "TENANT_RESOLUTION", status: "WARN", error: `No tenant for phoneNumberId: ${phoneNumberId} — using fallback`, durationMs: Date.now() - tenantLookupStart });
          }
        } catch (timeoutErr: any) {
          const durationMs = Date.now() - tenantLookupStart;
          channelCache.recordLatency(durationMs);
          log(`[timeout] tenant resolution timed out after ${durationMs}ms for ${phoneNumberId}`, "whatsapp");
          if (traceId) {
            auditService.updateStep({ traceId, step: "TENANT_RESOLUTION", status: "FAIL", error: `DB timeout: tenant resolution exceeded ${TENANT_RESOLUTION_TIMEOUT_MS}ms`, durationMs });
            auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
          }
          continue;
        }

        if (!tenantResult) {
          const failedLookupMs = Date.now() - tenantLookupStart;
          channelCache.recordLatency(failedLookupMs);
          log(`No tenant or fallback found for phoneNumberId: ${phoneNumberId}`, "whatsapp");
          if (traceId) {
            auditService.updateStep({ traceId, step: "TENANT_RESOLUTION", status: "FAIL", error: `No tenant for phoneNumberId: ${phoneNumberId}`, durationMs: failedLookupMs });
            auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
          }
          continue;
        }
        const tenantLookupMs = Date.now() - tenantLookupStart;
        channelCache.recordLatency(tenantLookupMs);
        log(`[perf] tenantLookup: ${tenantLookupMs}ms${isFallbackTenant ? " (fallback)" : ""}`, "whatsapp");

        const { tenant, credentials, channelId: resolvedChannelId } = tenantResult;
        const tenantId = String(tenant._id);
        const tenantName = tenant.nameEn || tenant.nameHe;

        if (credentials.accessToken) {
          const tokenPrefix = credentials.accessToken.substring(0, 4);
          const isEncryptedStill = credentials.accessToken.startsWith("enc:");
          log(`[credentials] Using token starting with: ${tokenPrefix}... (length=${credentials.accessToken.length}, encrypted=${isEncryptedStill})`, "whatsapp");
          if (isEncryptedStill) {
            log(`[credentials] WARNING: Token appears still encrypted for tenant ${tenantName}!`, "whatsapp");
          }
        } else {
          log(`[credentials] WARNING: No accessToken for tenant ${tenantName}, channel ${resolvedChannelId}`, "whatsapp");
        }

        if (traceId) {
          if (!isFallbackTenant) {
            auditService.updateStep({ traceId, step: "TENANT_RESOLUTION", status: "OK", durationMs: tenantLookupMs });
          }
          auditService.updateTenantId(traceId, tenantId);
        }

        let tenantDbConn: mongoose.Connection;
        try {
          tenantDbConn = await withTimeout(
            this.getTenantDbConnection(tenantId),
            PIPELINE_TIMEOUT_MS,
            `getTenantDbConnection(${tenantId})`
          );
        } catch (dbErr: any) {
          log(`[FATAL] Tenant DB connection failed for ${tenantId}: ${dbErr.message} — rejecting webhook batch`, "whatsapp");
          if (traceId) auditService.updateStep({ traceId, step: "TENANT_DB_CONNECTION", status: "FAIL", error: dbErr.message });
          const connErr = new Error(`Tenant DB unavailable for ${tenantId}: ${dbErr.message}`);
          (connErr as any).isTenantDbError = true;
          throw connErr;
        }

        const MessageModel = getMessageModel(tenantDbConn);
        const ConversationModel = getConversationModel(tenantDbConn);
        const CustomerModel = getCustomerModel(tenantDbConn);
        const { getActiveSessionModel } = await import("../models/active-session.model");
        const ActiveSessionModel = getActiveSessionModel(tenantDbConn);

        if (resolvedChannelId && !this._expiredClearedChannels?.has(resolvedChannelId)) {
          const { ChannelModel } = await import("../models/channel.model");
          const chan = await ChannelModel.findById(resolvedChannelId).select("tokenExpiredAt").lean();
          if (chan?.tokenExpiredAt) {
            await clearChannelTokenExpired(resolvedChannelId);
            log(`Webhook cleared stale tokenExpiredAt for channel ${resolvedChannelId}`, "whatsapp");
          }
          if (!this._expiredClearedChannels) this._expiredClearedChannels = new Set();
          this._expiredClearedChannels.add(resolvedChannelId);
        }

        let statusBatchFailed = false;
        if (value.statuses) {
          const statusPromises = value.statuses.map(async (status: any) => {
            const validStatuses = ["sent", "delivered", "read", "failed"];
            if (validStatuses.includes(status.status)) {
              try {
                const update: Record<string, any> = {
                  deliveryStatus: status.status,
                };
                if (status.status === "delivered") {
                  update.deliveredAt = status.timestamp
                    ? new Date(parseInt(status.timestamp) * 1000)
                    : new Date();
                }
                if (status.status === "read") {
                  update.readAt = status.timestamp
                    ? new Date(parseInt(status.timestamp) * 1000)
                    : new Date();
                  if (!update.deliveredAt) {
                    update.deliveredAt = update.readAt;
                  }
                }

                const updatedMsg = await withTimeout(
                  MessageModel.findOneAndUpdate(
                    { "metadata.waMessageId": status.id, tenantId },
                    { $set: update },
                    { new: true }
                  ).lean(),
                  PIPELINE_TIMEOUT_MS,
                  `statusUpdate(${status.id})`
                );

                if (updatedMsg) {
                  emitMessageStatus(
                    tenantId,
                    String(updatedMsg.conversationId),
                    {
                      waMessageId: status.id,
                      messageId: String(updatedMsg._id),
                      status: status.status as "sent" | "delivered" | "read" | "failed",
                      timestamp: status.timestamp,
                    }
                  );
                }
              } catch (statusErr: any) {
                log(`Error updating message status: ${statusErr.message}`, "whatsapp");
              }
            }
          });
          try {
            await withTimeout(
              Promise.all(statusPromises),
              PIPELINE_TIMEOUT_MS,
              `statusBatch(${tenantId})`
            );
          } catch (err: any) {
            statusBatchFailed = true;
            log(`Status batch error: ${err.message}`, "whatsapp");
            if (traceId) {
              auditService.updateStep({ traceId, step: "STATUS_UPDATE", status: "FAIL", error: err.message });
            }
          }
        }

        const incomingMessages = value.messages || [];

        if (value.statuses && incomingMessages.length === 0 && traceId) {
          if (!statusBatchFailed) {
            auditService.updateStep({ traceId, step: "STATUS_UPDATE", status: "OK" });
          }
          auditService.finalizeTrace({ traceId, pipelineStatus: statusBatchFailed ? "FAILED" : "COMPLETED" }).catch((err: any) =>
            log(`[audit] finalizeTrace error (status-only): ${err.message}`, "audit")
          );
        }

        for (const msg of incomingMessages) {
          const rawMsgType = msg.type || "unknown";
          const isVideoNote = rawMsgType === "video_note";
          const msgType = isVideoNote ? "video" : rawMsgType;
          if (isVideoNote && !msg.video && msg.video_note) {
            msg.video = msg.video_note;
          }
          const messageType = this.getMessageType(msgType);
          const mediaTypes = ["image", "video", "audio", "document", "sticker"];
          const isMediaType = mediaTypes.includes(msgType);
          if (traceId) {
            const contactNameForMeta = value.contacts?.[0]?.profile?.name;
            const mediaObj = isMediaType ? (msg[msgType] || msg[rawMsgType]) : undefined;
            const mediaMimeType = mediaObj?.mime_type;
            const mediaFileSize = mediaObj?.file_size ? Number(mediaObj.file_size) : undefined;
            auditService.updateMetadata(traceId, {
              messageType: msgType,
              mimeType: mediaMimeType,
              fileSize: mediaFileSize,
              senderPhone: msg.from,
              senderName: contactNameForMeta,
              phoneNumberId,
            });
          }

          const MAX_TEXT_LENGTH = 5000;
          let rawText = msg.text?.body || "";
          if (rawText.length > MAX_TEXT_LENGTH) {
            const originalLength = rawText.length;
            rawText = rawText.substring(0, MAX_TEXT_LENGTH);
            log(`Truncated oversized text message from ${msg.from} (${originalLength} -> ${MAX_TEXT_LENGTH})`, "whatsapp");
          }
          let textContent = rawText;
          let mediaInfo: IMediaInfo | undefined;
          let locationInfo: ILocationInfo | undefined;
          let contactsInfo: IContactInfo[] | undefined;

          if (isMediaType) {
            const extracted = this.extractMediaFromMessage(msg);
            if (extracted.mediaId) {
              mediaInfo = extracted;
              textContent = extracted.caption || `[${msgType}]`;
            } else {
              textContent = `[${msgType}]`;
            }
          } else if (msgType === "location") {
            locationInfo = this.extractLocationFromMessage(msg);
            if (locationInfo) {
              textContent = locationInfo.name
                ? `${locationInfo.name} (${locationInfo.latitude}, ${locationInfo.longitude})`
                : `(${locationInfo.latitude}, ${locationInfo.longitude})`;
              if (locationInfo.address) {
                textContent += ` - ${locationInfo.address}`;
              }
            } else {
              textContent = "[location]";
            }
          } else if (msgType === "contacts") {
            contactsInfo = this.extractContactsFromMessage(msg);
            if (contactsInfo?.length) {
              textContent = contactsInfo.map((c) => c.name.formatted_name).join(", ");
            } else {
              textContent = "[contacts]";
            }
          } else if (msgType === "reaction") {
            textContent = msg.reaction?.emoji || "[reaction]";
          } else if (msgType === "interactive") {
            const interactiveReply = msg.interactive;
            if (interactiveReply?.type === "button_reply") {
              textContent = interactiveReply.button_reply?.title || "[button]";
            } else if (interactiveReply?.type === "list_reply") {
              textContent = interactiveReply.list_reply?.title || "[list]";
            } else if (interactiveReply?.type === "nfm_reply") {
              textContent = interactiveReply.nfm_reply?.body || interactiveReply.nfm_reply?.name || "[flow]";
            } else {
              textContent = `[interactive:${interactiveReply?.type || "unknown"}]`;
            }
          } else if (msgType === "button") {
            textContent = msg.button?.text || msg.button?.payload || "[button]";
          } else if (msgType === "unsupported") {
            const subType = msg.unsupported?.type || "unknown";
            textContent = `[unsupported:${subType}]`;
          } else if (!textContent) {
            textContent = `[unsupported:${msgType}]`;
          }

          log(
            `Message received for Tenant: ${tenantName}${isFallbackTenant ? " [ORPHAN/FALLBACK]" : ""} | ` +
            `from: ${msg.from}, type: ${msgType}` +
            (mediaInfo?.mimeType ? `, mime: ${mediaInfo.mimeType}` : ""),
            "whatsapp"
          );

          const webhookStartMs = Date.now();

          if (msg.timestamp && webhookReceivedAt) {
            const metaTs = parseInt(msg.timestamp) * 1000;
            log(`[perf] Meta→server delay: ${webhookReceivedAt - metaTs}ms (msg ${msg.id})`, "whatsapp");
          }

          communicationLogService.create({
            timestamp: new Date(parseInt(msg.timestamp) * 1000),
            recipient: msg.from,
            sender: phoneNumberId,
            content: textContent,
            status: "Success",
            messageId: msg.id,
            retryCount: 0,
            tenantId: tenantId as any,
            channel: "whatsapp",
            direction: "inbound",
            messageType,
            media: mediaInfo,
            location: locationInfo,
            contacts: contactsInfo,
            metadata: {
              type: msgType,
              phoneNumberId,
              rawPayload: msg,
            },
          }).catch((err: any) => log(`Comm log write error (non-blocking): ${err.message}`, "whatsapp"));

          this.batchMarkMessageRead(msg.id, credentials, tenantId);

          const BUSINESS_PHONE_BLOCKLIST = ["97235020115"];
          if (BUSINESS_PHONE_BLOCKLIST.includes(msg.from)) {
            log(`[skip] Ignoring message from own business line: ${msg.from}`, "whatsapp");
            continue;
          }

          const rawContactName = value.contacts?.[0]?.profile?.name || "";
          const contactName = (rawContactName && !rawContactName.toLowerCase().includes("unknown")) ? rawContactName : msg.from;
          const nameParts = contactName.split(" ");
          const firstName = nameParts[0] || msg.from;
          const lastName = nameParts.slice(1).join(" ");

          try {
            const t0 = Date.now();
            let customer = await withTimeout(
              CustomerModel.findOne({ tenantId, phone: msg.from }),
              PIPELINE_TIMEOUT_MS,
              `customerLookup(${msg.from})`
            );
            log(`[perf] customerLookup: ${Date.now() - t0}ms (msg ${msg.id})`, "whatsapp");

            {
              if (!customer) {
                customer = await CustomerModel.create({
                  tenantId,
                  firstName,
                  lastName,
                  phone: msg.from,
                  channel: "WHATSAPP",
                });
                log(`New customer created for Tenant ${tenantName}: ${msg.from} (${contactName})`, "whatsapp");
              } else {
                let needsSave = false;
                if (!customer.phone && msg.from) {
                  customer.phone = msg.from;
                  needsSave = true;
                }
                if (customer.firstName && customer.firstName.toLowerCase().includes("unknown") && msg.from) {
                  const oldName = customer.firstName;
                  customer.firstName = msg.from;
                  customer.lastName = "";
                  needsSave = true;
                  log(`[DeepClean] Sanitized Customer ID: ${customer._id} - Name "${oldName}" set to ${msg.from}`, "whatsapp");
                }
                if (needsSave) {
                  await customer.save();
                  log(`Patched customer ${customer._id}: phone=${customer.phone}, firstName=${customer.firstName}`, "whatsapp");
                }
              }

              ActiveSessionModel.updateOne(
                { tenantId, customerPhone: msg.from },
                { $set: { customerName: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || msg.from, lastCustomerMessageAt: new Date() } },
                { upsert: true },
              ).catch((err: any) => log(`[active-session] upsert error (non-blocking): ${err.message}`, "whatsapp"));

              const convFilter: any = {
                tenantId,
                customerId: customer._id,
                status: { $in: ["UNASSIGNED", "ACTIVE", "SNOOZED"] },
              };
              if (resolvedChannelId) {
                convFilter.channelId = resolvedChannelId;
              }
              const msgTimestamp = new Date(parseInt(msg.timestamp) * 1000);

              const t2 = Date.now();
              const convResult: any = await withTimeout(
                ConversationModel.findOneAndUpdate(
                  convFilter,
                  {
                    $set: {
                      lastMessageAt: msgTimestamp,
                      lastInboundAt: msgTimestamp,
                      channel: "WHATSAPP",
                      ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
                      ...(isFallbackTenant ? { isOrphan: true, orphanPhoneNumberId: phoneNumberId } : {}),
                    },
                    $inc: { unreadCount: 1 },
                    $setOnInsert: {
                      tenantId,
                      customerId: customer._id,
                      status: "UNASSIGNED",
                    },
                  },
                  { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true }
                ),
                PIPELINE_TIMEOUT_MS,
                `convUpsert(${msg.from})`
              );
              let conversation = convResult.value;
              const isNewConversation = !!convResult.lastErrorObject?.upserted;
              log(`[perf] convUpsert: ${Date.now() - t2}ms (msg ${msg.id})`, "whatsapp");

              if (!isNewConversation && conversation?.status === "SNOOZED") {
                conversation = await ConversationModel.findByIdAndUpdate(
                  conversation._id,
                  {
                    $set: {
                      status: conversation.assignedTo ? "ACTIVE" : "UNASSIGNED",
                      snoozedUntil: undefined,
                    },
                    $unset: { snoozedUntil: 1 },
                  },
                  { new: true }
                );
                log(`Snooze interrupted: customer ${msg.from} sent message, conversation ${conversation._id} woke up`, "whatsapp");

                emitConversationAssigned(String(tenantId), String(conversation._id), {
                  assignedTo: conversation.assignedTo ? String(conversation.assignedTo) : null,
                  assignedName: conversation.assignedName || null,
                  status: conversation.status,
                });
                emitStatusChanged(String(tenantId), String(conversation._id), {
                  status: conversation.status,
                  previousStatus: "SNOOZED",
                });
              }

              const contentTypeMap: Record<string, string> = {
                text: "TEXT", image: "IMAGE", video: "VIDEO", audio: "AUDIO",
                document: "DOCUMENT", sticker: "STICKER", location: "LOCATION",
                contacts: "CONTACTS",
              };

              const hasMediaToDownload = isMediaType && mediaInfo?.mediaId;

              const t3 = Date.now();
              const orphanSenderName = isFallbackTenant
                ? (msg.from ? `+${msg.from.replace(/^(\d{3})(\d{3})(\d{4,})$/, "$1-$2-$3")}` : contactName)
                : contactName;

              let newMsg;
              try {
                newMsg = await withTimeout(
                  MessageModel.create({
                    conversationId: conversation._id,
                    tenantId,
                    ...(resolvedChannelId ? { channelId: resolvedChannelId } : {}),
                    direction: "INBOUND",
                    content: textContent,
                    type: contentTypeMap[msgType] || "TEXT",
                    channel: "WHATSAPP",
                    isInternal: false,
                    senderName: orphanSenderName,
                    metadata: {
                      waMessageId: msg.id,
                      mediaInfo,
                      locationInfo,
                      contactsInfo,
                      ...(hasMediaToDownload ? { mediaStatus: "pending" } : {}),
                      ...(isVideoNote ? { isVideoNote: true } : {}),
                      ...(isFallbackTenant ? { isOrphan: true, originalPhoneNumberId: phoneNumberId } : {}),
                    },
                  }),
                  PIPELINE_TIMEOUT_MS,
                  `msgCreate(${msg.id})`
                );
              } catch (dupErr: any) {
                if (dupErr.code === 11000) {
                  log(`Duplicate message ${msg.id} blocked by unique index for Tenant ${tenantName}`, "whatsapp");
                  if (traceId) auditService.updateStep({ traceId, step: "TENANT_DB_SAVE", status: "SKIP", error: "Duplicate message (unique index)" });
                  continue;
                }
                if (traceId) auditService.updateStep({ traceId, step: "TENANT_DB_SAVE", status: "FAIL", error: dupErr.message });
                throw dupErr;
              }
              const msgCreateMs = Date.now() - t3;
              log(`[perf] msgCreate: ${msgCreateMs}ms (msg ${msg.id})`, "whatsapp");
              if (traceId) auditService.updateStep({ traceId, step: "TENANT_DB_SAVE", status: "OK", durationMs: msgCreateMs });

              try {
                const { TenantModel } = await import("../models/tenant.model");
                await TenantModel.updateOne(
                  { _id: tenantId },
                  { $inc: { inboundMessagesThisMonth: 1 } },
                );
              } catch (incErr: any) {
                log(`Failed to increment inbound counter for tenant ${tenantId}: ${incErr.message}`, "whatsapp");
              }

              markLocalEmit(String(newMsg._id));

              const convObj = typeof conversation.toObject === 'function' ? conversation.toObject() : conversation;
              if (isNewConversation) {
                emitNewConversation(tenantId, {
                  ...convObj,
                  customer: { firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone },
                });
              }
              emitNewMessage(tenantId, String(conversation._id), newMsg.toObject());
              log(`[perf] TOTAL webhook→emit: ${Date.now() - webhookStartMs}ms (msg ${msg.id})`, "whatsapp");

              if (isNewConversation) {
                (async () => {
                  try {
                    const routing = await routeConversation(
                      String(tenantId),
                      String(customer!._id),
                      "WHATSAPP",
                      undefined,
                      resolvedChannelId || undefined
                    );
                    const routeUpdate: any = { routingRule: routing.rule };
                    if (routing.assignedTo) {
                      routeUpdate.assignedTo = routing.assignedTo;
                      routeUpdate.assignedName = routing.assignedName;
                      routeUpdate.status = "ACTIVE";
                    }
                    if (routing.groupId) {
                      routeUpdate.groupId = routing.groupId;
                    }
                    await ConversationModel.findByIdAndUpdate(
                      conversation._id,
                      { $set: routeUpdate },
                      { new: true }
                    );
                    log(`Auto-routed conversation ${conversation._id} via [${routing.rule}] → ${routing.assignedName || 'pool'}`, "whatsapp");
                    emitConversationAssigned(String(tenantId), String(conversation._id), {
                      assignedTo: routing.assignedTo || null,
                      assignedName: routing.assignedName || null,
                      status: routeUpdate.status || "UNASSIGNED",
                    });
                  } catch (routeErr: any) {
                    log(`Routing error (non-blocking): ${routeErr.message}`, "whatsapp");
                  }
                })();
              }

              if (hasMediaToDownload) {
                if (traceId) auditService.updateStep({ traceId, step: "MEDIA_PROCESSING", status: "OK", durationMs: 0 });
                this.processDeferredMediaWithRetry(
                  String(newMsg._id),
                  mediaInfo!.mediaId!,
                  credentials.accessToken,
                  tenantId,
                  String(conversation._id)
                );
              }

              if (traceId) {
                auditService.finalizeTrace({
                  traceId,
                  pipelineStatus: "COMPLETED",
                  tenantDbConnection: tenantDbConn,
                }).catch((err: any) => log(`[audit] finalizeTrace error: ${err.message}`, "audit"));
              }
            }
          } catch (identityErr: any) {
            log(`Identity logic error for ${msg.from}: ${identityErr.message}`, "whatsapp");
            if (traceId) {
              auditService.updateStep({ traceId, step: "IDENTITY_LOGIC", status: "FAIL", error: identityErr.message });
              auditService.finalizeTrace({ traceId, pipelineStatus: "FAILED" }).catch(() => {});
            }
          }

          messages.push({
            from: msg.from,
            messageId: msg.id,
            timestamp: msg.timestamp,
            type: msgType,
            text: textContent,
            tenantId,
            tenantName,
            phoneNumberId,
            media: mediaInfo,
            location: locationInfo,
            contacts: contactsInfo,
          });
        }
      }
    }

    return messages;
  }

  async processTemplateStatusUpdate(value: any, wabaId: string): Promise<void> {
    if (!value) return;

    log(`[webhook] Template status raw payload: ${JSON.stringify(value)}`, "whatsapp");

    const templateName = value.message_template_name;
    const newStatus = value.event?.toUpperCase();
    const rejectedReason = value.reason || value.rejected_reason || null;

    if (!templateName || !newStatus) {
      log(`Template status update missing name or event: ${JSON.stringify(value)}`, "whatsapp");
      return;
    }

    const statusMap: Record<string, string> = {
      APPROVED: "APPROVED",
      REJECTED: "REJECTED",
      PENDING: "PENDING",
      DISABLED: "REJECTED",
      PAUSED: "REJECTED",
    };
    const mappedStatus = statusMap[newStatus] || "PENDING";

    const channels = await ChannelModel.find({
      type: "WHATSAPP",
      status: "active",
      wabaId: { $ne: null },
    }).lean();

    let matchedTenantId: string | null = null;
    let matchedTenantName: string | null = null;

    for (const channel of channels) {
      if (channel.wabaId === wabaId) {
        const tenant = await TenantModel.findById(channel.tenantId).lean();
        if (tenant) {
          matchedTenantId = String(tenant._id);
          matchedTenantName = tenant.nameEn || tenant.nameHe;
          break;
        }
      }
    }

    if (!matchedTenantId) {
      log(`Template status update: no tenant found for WABA ID ${wabaId}`, "whatsapp");
      return;
    }

    let tenantDbConn: mongoose.Connection;
    try {
      tenantDbConn = await this.getTenantDbConnection(matchedTenantId);
    } catch (dbErr: any) {
      log(`[FATAL] Tenant DB connection failed for template update (${matchedTenantId}): ${dbErr.message}`, "whatsapp");
      throw new Error(`Tenant DB unavailable for template update: ${dbErr.message}`);
    }

    const WhatsAppTemplateModel = getWhatsAppTemplateModel(tenantDbConn);

    const updateFields: Record<string, any> = {
      status: mappedStatus,
      lastSynced: new Date(),
      rejectedReason: mappedStatus === "REJECTED" ? rejectedReason : null,
    };

    const result = await WhatsAppTemplateModel.findOneAndUpdate(
      { tenantId: matchedTenantId, name: templateName },
      { $set: updateFields },
      { new: true }
    );

    if (result) {
      log(`Template [${templateName}] status updated to [${mappedStatus}] for Tenant [${matchedTenantId}]`, "whatsapp");

      emitTemplateUpdate(matchedTenantId, {
        templateId: String(result._id),
        status: mappedStatus,
        templateName: templateName,
      });
    } else {
      log(`Template [${templateName}] not found in DB for Tenant [${matchedTenantId}] — status: ${mappedStatus}`, "whatsapp");
    }
  }

  private batchMarkMessageRead(messageId: string, creds: WhatsAppCredentials, tenantId: string): void {
    const key = `${creds.phoneNumberId}:${tenantId}`;
    let batch = markReadBatch.get(key);
    if (!batch) {
      batch = {
        messageIds: [],
        creds,
        timer: setTimeout(() => this.flushMarkReadBatch(key), MARK_READ_DELAY),
      };
      markReadBatch.set(key, batch);
    }
    batch.messageIds.push(messageId);
  }

  private async flushMarkReadBatch(key: string): Promise<void> {
    const batch = markReadBatch.get(key);
    if (!batch) return;
    markReadBatch.delete(key);

    for (const msgId of batch.messageIds) {
      try {
        await axios.post(
          `${META_GRAPH_API}/${batch.creds.phoneNumberId}/messages`,
          {
            messaging_product: "whatsapp",
            status: "read",
            message_id: msgId,
          },
          {
            timeout: META_LIGHTWEIGHT_TIMEOUT_MS,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${batch.creds.accessToken.startsWith("enc:") ? encryptionService.decrypt(batch.creds.accessToken) : batch.creds.accessToken}`,
            },
          }
        );
      } catch (err: any) {
        log(`Failed to mark message ${msgId} as read: ${err.message}`, "whatsapp");
      }
    }
  }

  private processDeferredMediaWithRetry(
    messageId: string,
    mediaId: string,
    accessToken: string,
    tenantId: string,
    conversationId: string
  ): void {
    whatsappMediaService.processDeferredMediaWithRetry(messageId, mediaId, accessToken, tenantId, conversationId);
  }
}

export const whatsappWebhookService = new WhatsAppWebhookService();
