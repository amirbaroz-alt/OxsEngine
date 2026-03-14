import { log } from "../lib/logger";
import { getMessageModel } from "../models/message.model";
import { TenantModel } from "../models/tenant.model";
import { tenantDbManager } from "../lib/db-manager";
import { getDefaultWhatsAppChannel, flagChannelTokenExpired } from "./channel.service";
import { encryptionService } from "./encryption.service";
import { emitNewMessage } from "./socket.service";
import axios from "axios";

function ensureDecrypted(token: string, context: string): string {
  if (token.startsWith("enc:")) {
    log(`[credentials] SAFETY-NET: Token still encrypted at ${context} — decrypting now`, "whatsapp");
    return encryptionService.decrypt(token);
  }
  return token;
}
import type { IMediaInfo, ILocationInfo, IContactInfo, MessageType } from "../models/communication-log.model";
import {
  MEDIA_MAX_DOWNLOAD_SIZE,
  MEDIA_MAX_BASE64_SIZE,
  DEFERRED_MEDIA_INITIAL_DELAY_MS,
  DEFERRED_MEDIA_RETRY_DELAY_MS,
  MEDIA_URL_EXPIRY_MS,
  API_REQUEST_TIMEOUT_MS,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  META_LIGHTWEIGHT_TIMEOUT_MS,
} from "../lib/constants/limits";

export const META_GRAPH_API = "https://graph.facebook.com/v21.0";

export function isMetaTokenError(error: any): boolean {
  const metaError = error?.response?.data?.error;
  if (metaError?.code === 190) return true;
  const msg = metaError?.message || error?.message || "";
  return /access token|session is invalid|session has expired|OAuthException/i.test(msg);
}

export interface MediaMetadata {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}

export class WhatsAppMediaService {
  private async getTenantDbConnection(tenantId: string) {
    const tenant = await TenantModel.findById(tenantId).select("+tenantDbUri");
    const envDbUrl = process.env.DATABASE_URL;
    const mongoEnvUrl = envDbUrl && envDbUrl.startsWith("mongodb") ? envDbUrl : undefined;
    const dbUri = tenant?.tenantDbUri || mongoEnvUrl || process.env.MONGODB_URI || "mongodb://localhost:27017/cpaas-platform";
    return tenantDbManager.getTenantConnection(tenantId.toString(), dbUri);
  }

  private async flagTokenExpired(tenantId: string): Promise<void> {
    try {
      const { ChannelModel } = await import("../models/channel.model");
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

  async validateMediaToken(accessToken: string, tenantId: string): Promise<{ valid: boolean; status: "valid" | "expired" | "unknown"; error?: string }> {
    try {
      const safeToken = ensureDecrypted(accessToken, "validateMediaToken");
      const response = await axios.get(`${META_GRAPH_API}/me`, {
        timeout: META_LIGHTWEIGHT_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${safeToken}` },
      });
      if (response.data?.id) return { valid: true, status: "valid" };
      return { valid: false, status: "unknown", error: "Unexpected response from Meta API" };
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      if (httpStatus === 401 || isMetaTokenError(err)) {
        return { valid: false, status: "expired", error: "TOKEN_EXPIRED" };
      }
      return { valid: false, status: "unknown", error: err.message };
    }
  }

  async fetchMediaMetadata(mediaId: string, accessToken: string, tenantId: string): Promise<MediaMetadata | null> {
    try {
      const token = ensureDecrypted(accessToken, "fetchMediaMetadata");
      log(`[credentials] Media metadata fetch token: ${token.substring(0, 4)}... (len=${token.length})`, "whatsapp");
      const response = await axios.get(`${META_GRAPH_API}/${mediaId}`, {
        timeout: API_REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        url: response.data.url,
        mime_type: response.data.mime_type,
        sha256: response.data.sha256,
        file_size: response.data.file_size,
        id: response.data.id || mediaId,
      };
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || isMetaTokenError(err)) {
        log(`CRITICAL: TOKEN_EXPIRED — media metadata fetch failed for ${mediaId} (tenant: ${tenantId}). Access token is invalid or expired.`, "whatsapp");
        await this.flagTokenExpired(tenantId);
        throw Object.assign(new Error("TOKEN_EXPIRED"), { code: "TOKEN_EXPIRED" });
      }
      log(`Failed to fetch media metadata for ${mediaId}: ${err.message}`, "whatsapp");
      return null;
    }
  }

  async downloadMediaAsBuffer(mediaId: string, accessToken: string, tenantId: string, maxSize = MEDIA_MAX_DOWNLOAD_SIZE): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const mediaMeta = await this.fetchMediaMetadata(mediaId, accessToken, tenantId);
      if (!mediaMeta?.url) {
        log(`No download URL for media ${mediaId}`, "whatsapp");
        return null;
      }

      if (mediaMeta.file_size && mediaMeta.file_size > maxSize) {
        log(`Media ${mediaId} too large (${mediaMeta.file_size} bytes), max ${maxSize}`, "whatsapp");
        return null;
      }

      const dlToken = ensureDecrypted(accessToken, "downloadMediaAsBuffer");
      const response = await axios.get(mediaMeta.url, {
        timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
        responseType: "arraybuffer",
        headers: {
          Authorization: `Bearer ${dlToken}`,
        },
      });

      const buffer = Buffer.from(response.data);
      const mimeType = mediaMeta.mime_type || "application/octet-stream";
      return { buffer, mimeType };
    } catch (err: any) {
      if ((err as any).code === "TOKEN_EXPIRED") throw err;
      const status = err?.response?.status;
      if (status === 401 || isMetaTokenError(err)) {
        log(`CRITICAL: TOKEN_EXPIRED — media download failed for ${mediaId} (tenant: ${tenantId})`, "whatsapp");
        await this.flagTokenExpired(tenantId);
        throw Object.assign(new Error("TOKEN_EXPIRED"), { code: "TOKEN_EXPIRED" });
      }
      log(`Failed to download media ${mediaId}: ${err.message}`, "whatsapp");
      return null;
    }
  }

  async downloadMediaAsBase64(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    const result = await this.downloadMediaAsBuffer(mediaId, accessToken, tenantId, MEDIA_MAX_BASE64_SIZE);
    if (!result) return null;
    return { base64: result.buffer.toString("base64"), mimeType: result.mimeType };
  }

  async downloadMediaDirect(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const mediaMeta = await this.fetchMediaMetadata(mediaId, accessToken, tenantId);
      if (!mediaMeta?.url) {
        log(`No download URL for media ${mediaId}`, "whatsapp");
        return null;
      }

      if (mediaMeta.file_size && mediaMeta.file_size > MEDIA_MAX_DOWNLOAD_SIZE) {
        log(`Media ${mediaId} too large for direct download (${mediaMeta.file_size} bytes)`, "whatsapp");
        return null;
      }

      const dlToken = ensureDecrypted(accessToken, "downloadMediaDirect");
      const response = await axios.get(mediaMeta.url, {
        timeout: MEDIA_DOWNLOAD_TIMEOUT_MS,
        responseType: "arraybuffer",
        headers: {
          Authorization: `Bearer ${dlToken}`,
        },
      });

      const buffer = Buffer.from(response.data);
      const mimeType = mediaMeta.mime_type || "application/octet-stream";
      return { base64: buffer.toString("base64"), mimeType };
    } catch (err: any) {
      log(`Failed to download media direct ${mediaId}: ${err.message}`, "whatsapp");
      return null;
    }
  }

  extractMediaFromMessage(msg: any): IMediaInfo {
    const type = msg.type;
    const mediaObj = msg[type];
    if (!mediaObj) return {};

    return {
      mediaId: mediaObj.id,
      mimeType: mediaObj.mime_type,
      sha256: mediaObj.sha256,
      fileSize: mediaObj.file_size,
      caption: mediaObj.caption || msg.caption,
      fileName: mediaObj.filename,
      downloadUrl: mediaObj.url,
      urlExpiresAt: mediaObj.url ? new Date(Date.now() + MEDIA_URL_EXPIRY_MS) : undefined,
    };
  }

  extractLocationFromMessage(msg: any): ILocationInfo | undefined {
    if (msg.type !== "location" || !msg.location) return undefined;
    return {
      latitude: msg.location.latitude,
      longitude: msg.location.longitude,
      name: msg.location.name,
      address: msg.location.address,
    };
  }

  extractContactsFromMessage(msg: any): IContactInfo[] | undefined {
    if (msg.type !== "contacts" || !msg.contacts?.length) return undefined;
    return msg.contacts.map((c: any) => ({
      name: {
        formatted_name: c.name?.formatted_name || "Unknown",
        first_name: c.name?.first_name,
        last_name: c.name?.last_name,
      },
      phones: c.phones?.map((p: any) => ({ phone: p.phone, type: p.type })),
      emails: c.emails?.map((e: any) => ({ email: e.email, type: e.type })),
      org: c.org ? { company: c.org.company, title: c.org.title } : undefined,
    }));
  }

  getMessageType(whatsappType: string): MessageType {
    const typeMap: Record<string, MessageType> = {
      text: "text",
      image: "image",
      video: "video",
      audio: "audio",
      document: "document",
      sticker: "sticker",
      location: "location",
      contacts: "contacts",
      reaction: "reaction",
      interactive: "interactive",
      button: "button",
      template: "template",
    };
    return typeMap[whatsappType] || "unknown";
  }

  processDeferredMediaWithRetry(
    messageId: string,
    mediaId: string,
    accessToken: string,
    tenantId: string,
    conversationId: string
  ): void {
    setTimeout(() => {
      this.processDeferredMedia(messageId, mediaId, accessToken, tenantId, conversationId)
        .catch(async (err) => {
          try {
            log(`Deferred media first attempt failed for ${messageId}: ${err.message} — retrying in 30s`, "whatsapp");
            await new Promise((r) => setTimeout(r, DEFERRED_MEDIA_RETRY_DELAY_MS));
            let freshToken = accessToken;
            const freshCreds = await getDefaultWhatsAppChannel(tenantId);
            if (freshCreds?.accessToken) {
              freshToken = freshCreds.accessToken;
              log(`Deferred media retry for ${messageId}: using fresh token`, "whatsapp");
            }
            await this.processDeferredMedia(messageId, mediaId, freshToken, tenantId, conversationId);
          } catch (retryErr: any) {
            log(`Deferred media retry also failed for ${messageId}: ${retryErr.message}`, "whatsapp");
          }
        });
    }, DEFERRED_MEDIA_INITIAL_DELAY_MS);
  }

  async processDeferredMedia(
    messageId: string,
    mediaId: string,
    accessToken: string,
    tenantId: string,
    conversationId: string
  ): Promise<void> {
    let tenantDbConn;
    try {
      tenantDbConn = await this.getTenantDbConnection(tenantId);
    } catch (dbErr: any) {
      log(`[FATAL] Tenant DB connection failed for deferred media ${messageId}: ${dbErr.message}`, "whatsapp");
      const connErr = new Error(`Tenant DB unavailable for deferred media: ${dbErr.message}`);
      (connErr as any).isTenantDbError = true;
      throw connErr;
    }

    const MessageModel = getMessageModel(tenantDbConn);

    try {
      const downloaded = await this.downloadMediaAsBuffer(mediaId, accessToken, tenantId);
      if (downloaded) {
        let finalBuffer = downloaded.buffer;
        let finalMimeType = downloaded.mimeType;

        if (finalMimeType.startsWith("video/")) {
          try {
            const { processVideoForBrowserCompat } = await import("./video-processing.service");
            const result = await processVideoForBrowserCompat(finalBuffer, finalMimeType);
            finalBuffer = result.buffer;
            finalMimeType = result.mimeType;
          } catch (videoErr: any) {
            log(`Video processing failed for message ${messageId}, using original: ${videoErr.message}`, "whatsapp");
          }
        }

        const { uploadMedia, buildMediaKey } = await import("./storage.service");
        const ext = finalMimeType.split("/")[1]?.split(";")[0] || "bin";
        const key = buildMediaKey(tenantId, messageId, `media.${ext}`);
        await uploadMedia(finalBuffer, key, finalMimeType);

        const updateFields: Record<string, any> = {
          "metadata.mimeType": finalMimeType,
          "metadata.mediaInfo.mimeType": finalMimeType,
          "metadata.mediaStatus": "completed",
          "metadata.mediaKey": key,
        };

        await MessageModel.findByIdAndUpdate(messageId, {
          $set: updateFields,
          $unset: { "metadata.base64": "", "metadata.mediaInfo.base64": "" },
        });
        const updatedMsg = await MessageModel.findById(messageId).lean();
        if (updatedMsg) {
          emitNewMessage(tenantId, conversationId, updatedMsg);
        }
        log(`Deferred media uploaded to MinIO for message ${messageId} (key=${key})`, "whatsapp");
      } else {
        await MessageModel.findByIdAndUpdate(messageId, {
          $set: { "metadata.mediaStatus": "failed" },
        });
        log(`Deferred media download returned null for message ${messageId}`, "whatsapp");
      }
    } catch (err: any) {
      const status = (err as any).code === "TOKEN_EXPIRED" ? "failed_auth" : "failed";
      await MessageModel.findByIdAndUpdate(messageId, {
        $set: { "metadata.mediaStatus": status },
      }).catch(() => {});
      log(`Deferred media processing failed for message ${messageId}: ${err.message}`, "whatsapp");
    }
  }
}

export const whatsappMediaService = new WhatsAppMediaService();
