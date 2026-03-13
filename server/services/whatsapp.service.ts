import { whatsappWebhookService } from "./whatsapp-webhook.service";
import { whatsappSenderService } from "./whatsapp-sender.service";
import type { ChannelCredentials } from "./channel.service";
import { MEDIA_MAX_DOWNLOAD_SIZE } from "../lib/constants/limits";
import type {
  SendWhatsAppParams,
  SendMediaParams,
  SendLocationParams,
  SendContactsParams,
  SendWhatsAppResult,
  IncomingWhatsAppMessage,
  WhatsAppCredentials,
  TenantLookupResult,
  MediaMetadata,
} from "./whatsapp-webhook.service";

export type {
  SendWhatsAppParams,
  SendMediaParams,
  SendLocationParams,
  SendContactsParams,
  SendWhatsAppResult,
  IncomingWhatsAppMessage,
  WhatsAppCredentials,
  TenantLookupResult,
  MediaMetadata,
};

export class WhatsAppService {
  private webhook = whatsappWebhookService;
  private sender = whatsappSenderService;

  async flagTokenExpired(tenantId: string): Promise<void> {
    return this.webhook.flagTokenExpired(tenantId);
  }

  async clearTokenExpired(tenantId: string): Promise<void> {
    return this.webhook.clearTokenExpired(tenantId);
  }

  async getCredentials(tenantId?: string): Promise<ChannelCredentials | null> {
    return this.webhook.getCredentials(tenantId);
  }

  async getValidToken(tenantId: string): Promise<ChannelCredentials | null> {
    return this.webhook.getValidToken(tenantId);
  }

  async findTenantByPhoneNumberId(phoneNumberId: string): Promise<TenantLookupResult | null> {
    return this.webhook.findTenantByPhoneNumberId(phoneNumberId);
  }

  async verifyWebhook(verifyToken: string, phoneNumberId?: string): Promise<boolean> {
    return this.webhook.verifyWebhook(verifyToken, phoneNumberId);
  }

  async validateMediaToken(accessToken: string, tenantId: string): Promise<{ valid: boolean; status: "valid" | "expired" | "unknown"; error?: string }> {
    return this.webhook.validateMediaToken(accessToken, tenantId);
  }

  async fetchMediaMetadata(mediaId: string, accessToken: string, tenantId: string): Promise<MediaMetadata | null> {
    return this.webhook.fetchMediaMetadata(mediaId, accessToken, tenantId);
  }

  async downloadMediaAsBuffer(mediaId: string, accessToken: string, tenantId: string, maxSize = MEDIA_MAX_DOWNLOAD_SIZE): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return this.webhook.downloadMediaAsBuffer(mediaId, accessToken, tenantId, maxSize);
  }

  async downloadMediaAsBase64(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    return this.webhook.downloadMediaAsBase64(mediaId, accessToken, tenantId);
  }

  async downloadMediaDirect(mediaId: string, accessToken: string, tenantId: string): Promise<{ base64: string; mimeType: string } | null> {
    return this.webhook.downloadMediaDirect(mediaId, accessToken, tenantId);
  }

  async processIncomingWebhook(body: any): Promise<IncomingWhatsAppMessage[]> {
    return this.webhook.processIncomingWebhook(body);
  }

  async sendTextMessage(params: SendWhatsAppParams): Promise<SendWhatsAppResult> {
    return this.sender.sendTextMessage(params);
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SendWhatsAppResult> {
    return this.sender.sendMediaMessage(params);
  }

  async sendLocationMessage(params: SendLocationParams): Promise<SendWhatsAppResult> {
    return this.sender.sendLocationMessage(params);
  }

  async sendContactsMessage(params: SendContactsParams): Promise<SendWhatsAppResult> {
    return this.sender.sendContactsMessage(params);
  }

  async uploadMedia(params: { tenantId: string; channelId?: string; buffer: Buffer; mimeType: string; fileName: string }): Promise<{ success: boolean; mediaId?: string; errorMessage?: string }> {
    return this.sender.uploadMedia(params);
  }
}

export const whatsappService = new WhatsAppService();
