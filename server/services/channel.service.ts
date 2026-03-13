import { ChannelModel, type IChannel, type ChannelType } from "../models/channel.model";
import { encryptionService } from "./encryption.service";
import { log } from "../index";
import { API_REQUEST_TIMEOUT_MS } from "../lib/constants/limits";

const CHANNEL_SENSITIVE_FIELDS = ["accessToken", "verifyToken", "sendGridKey", "appSecret"];

export function encryptChannelFields(data: any): any {
  if (!data) return data;
  const result = { ...data };
  for (const field of CHANNEL_SENSITIVE_FIELDS) {
    const val = result[field];
    if (val && !encryptionService.isEncrypted(val)) {
      result[field] = encryptionService.encrypt(val);
    }
  }
  return result;
}

export function decryptChannelFields(data: any): any {
  if (!data) return data;
  const result = typeof data.toObject === "function" ? data.toObject() : { ...data };
  for (const field of CHANNEL_SENSITIVE_FIELDS) {
    const val = result[field];
    if (val && encryptionService.isEncrypted(val)) {
      result[field] = encryptionService.decrypt(val);
    }
  }
  return result;
}

export function maskChannelFields(data: any): any {
  if (!data) return data;
  const result = typeof data.toObject === "function" ? data.toObject() : { ...data };
  for (const field of CHANNEL_SENSITIVE_FIELDS) {
    const val = result[field];
    if (val) {
      let plain = val;
      if (encryptionService.isEncrypted(val)) {
        try { plain = encryptionService.decrypt(val); } catch { plain = val; }
      }
      result[field] = plain.length > 6 ? "****" + plain.slice(-6) : "****";
    }
  }
  return result;
}

export interface ChannelCredentials {
  channelId: string;
  tenantId: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  wabaId?: string;
}

export async function getChannelToken(channelId: string): Promise<ChannelCredentials | null> {
  const channel = await ChannelModel.findById(channelId).lean();
  if (!channel) {
    log(`getChannelToken: channel ${channelId} not found`, "channel");
    return null;
  }

  if (channel.status === "disconnected") {
    log(`getChannelToken: channel ${channelId} is disconnected`, "channel");
    return null;
  }

  if (channel.isActive === false) {
    log(`getChannelToken: channel ${channelId} is inactive`, "channel");
    return null;
  }

  if (channel.tokenExpiredAt) {
    log(`getChannelToken: channel ${channelId} token expired at ${channel.tokenExpiredAt}`, "channel");
    return null;
  }

  const decrypted = decryptChannelFields(channel);
  if (!decrypted.accessToken) {
    log(`getChannelToken: channel ${channelId} has no access token`, "channel");
    return null;
  }

  return {
    channelId: String(channel._id),
    tenantId: String(channel.tenantId),
    phoneNumberId: decrypted.phoneNumberId || "",
    accessToken: decrypted.accessToken,
    verifyToken: decrypted.verifyToken || "",
    wabaId: decrypted.wabaId || undefined,
  };
}

export function normalizePhoneForMatch(phone: string): string {
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("972")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export async function findChannelByDisplayPhone(
  displayPhone: string,
  newPhoneNumberId: string
): Promise<(IChannel & { _decrypted: ChannelCredentials }) | null> {
  const normalized = normalizePhoneForMatch(displayPhone);
  if (!normalized || normalized.length < 6) return null;

  const channels = await ChannelModel.find({
    type: "WHATSAPP",
    status: "active",
    isActive: { $ne: false },
    phoneNumber: { $ne: null },
  }).lean();

  for (const channel of channels) {
    const channelNorm = normalizePhoneForMatch(channel.phoneNumber || "");
    if (channelNorm && channelNorm === normalized) {
      const decrypted = decryptChannelFields(channel);
      if (decrypted.phoneNumberId === newPhoneNumberId) {
        log(`[channel-heal] Channel "${channel.name}" already has correct phoneNumberId — no update needed`, "channel");
      } else {
        log(`[channel-heal] Matched channel "${channel.name}" (${channel._id}) by phoneNumber ${displayPhone} → healing phoneNumberId from ${decrypted.phoneNumberId || "null"} to ${newPhoneNumberId}`, "channel");
        const updateResult = await ChannelModel.updateOne(
          { _id: channel._id, $or: [{ phoneNumberId: null }, { phoneNumberId: channel.phoneNumberId }] },
          { $set: { phoneNumberId: encryptionService.encrypt(newPhoneNumberId) } }
        );
        if (updateResult.modifiedCount === 0) {
          log(`[channel-heal] Concurrent update detected — skipping heal for channel ${channel._id}`, "channel");
          continue;
        }
      }
      return {
        ...channel,
        _decrypted: {
          channelId: String(channel._id),
          tenantId: String(channel.tenantId),
          phoneNumberId: newPhoneNumberId,
          accessToken: decrypted.accessToken || "",
          verifyToken: decrypted.verifyToken || "",
          wabaId: decrypted.wabaId || undefined,
        },
      } as any;
    }
  }

  return null;
}

export async function findChannelByPhoneNumberId(phoneNumberId: string, displayPhone?: string): Promise<(IChannel & { _decrypted: ChannelCredentials }) | null> {
  const channels = await ChannelModel.find({
    type: "WHATSAPP",
    status: "active",
    isActive: { $ne: false },
    phoneNumberId: { $ne: null },
  }).lean();

  console.log(`[channel-lookup] Looking for phoneNumberId=${phoneNumberId}, found ${channels.length} active channels: ${channels.map(c => `${c.name}(${c._id}, isActive=${c.isActive})`).join(", ")}`);

  for (const channel of channels) {
    const decrypted = decryptChannelFields(channel);
    if (decrypted.phoneNumberId === phoneNumberId) {
      console.log(`[channel-lookup] Matched channel: ${channel.name} (${channel._id}) -> tenant ${channel.tenantId}`);
      if (displayPhone && !channel.phoneNumber) {
        ChannelModel.updateOne({ _id: channel._id }, { $set: { phoneNumber: displayPhone } }).catch(() => {});
        log(`[channel-heal] Auto-populated phoneNumber=${displayPhone} on matched channel ${channel._id}`, "channel");
      }
      return {
        ...channel,
        _decrypted: {
          channelId: String(channel._id),
          tenantId: String(channel.tenantId),
          phoneNumberId: decrypted.phoneNumberId,
          accessToken: decrypted.accessToken || "",
          verifyToken: decrypted.verifyToken || "",
          wabaId: decrypted.wabaId || undefined,
        },
      } as any;
    }
  }
  console.log(`[channel-lookup] No matching channel found for phoneNumberId=${phoneNumberId}`);
  return null;
}

export async function getDefaultWhatsAppChannel(tenantId: string): Promise<ChannelCredentials | null> {
  const channel = await ChannelModel.findOne({
    tenantId,
    type: "WHATSAPP",
    status: "active",
    isActive: { $ne: false },
    tokenExpiredAt: null,
  }).sort({ createdAt: 1 }).lean();

  if (!channel) return null;

  const decrypted = decryptChannelFields(channel);
  if (!decrypted.accessToken || !decrypted.phoneNumberId) return null;

  return {
    channelId: String(channel._id),
    tenantId: String(channel.tenantId),
    phoneNumberId: decrypted.phoneNumberId,
    accessToken: decrypted.accessToken,
    verifyToken: decrypted.verifyToken || "",
    wabaId: decrypted.wabaId || undefined,
  };
}

export async function flagChannelTokenExpired(channelId: string): Promise<void> {
  try {
    await ChannelModel.findByIdAndUpdate(channelId, { tokenExpiredAt: new Date() });
    log(`Channel ${channelId}: token flagged as expired`, "channel");
  } catch (err: any) {
    log(`Failed to flag token expired for channel ${channelId}: ${err.message}`, "channel");
  }
}

export async function clearChannelTokenExpired(channelId: string): Promise<void> {
  try {
    await ChannelModel.findByIdAndUpdate(channelId, { tokenExpiredAt: null });
  } catch {}
}

export const getValidClient = getChannelToken;

export interface ChannelTestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
}

export async function testChannelConnectivity(channelId: string, tenantId?: string): Promise<ChannelTestResult> {
  const channel = await ChannelModel.findById(channelId).lean();
  if (!channel) return { success: false, message: "Channel not found" };

  const decrypted = decryptChannelFields(channel);

  if (channel.type === "WHATSAPP") {
    if (!decrypted.accessToken || !decrypted.phoneNumberId) {
      return { success: false, message: "Missing WhatsApp credentials (Access Token or Phone Number ID)" };
    }
    try {
      const axios = (await import("axios")).default;
      const resp = await axios.get(
        `https://graph.facebook.com/v21.0/${decrypted.phoneNumberId}`,
        {
          params: { fields: "display_phone_number,verified_name,quality_rating" },
          headers: { Authorization: `Bearer ${decrypted.accessToken}` },
          timeout: API_REQUEST_TIMEOUT_MS,
        }
      );
      await clearChannelTokenExpired(channelId);
      if (resp.data.display_phone_number) {
        await ChannelModel.updateOne(
          { _id: channel._id },
          { $set: { phoneNumber: resp.data.display_phone_number } }
        );
        log(`[channel-heal] Auto-populated phoneNumber=${resp.data.display_phone_number} for channel ${channelId}`, "channel");
      }
      return {
        success: true,
        message: "WhatsApp channel is connected",
        details: {
          phoneNumber: resp.data.display_phone_number,
          verifiedName: resp.data.verified_name,
          qualityRating: resp.data.quality_rating,
        },
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message || "Unknown error";
      const code = err.response?.data?.error?.code;
      if (code === 190 || errMsg.toLowerCase().includes("token")) {
        await flagChannelTokenExpired(channelId);
        return { success: false, message: `Token error: ${errMsg}` };
      }
      return { success: false, message: errMsg };
    }
  }

  if (channel.type === "EMAIL") {
    if (!decrypted.sendGridKey) {
      return { success: false, message: "Missing SendGrid API Key" };
    }
    try {
      const { createTenantQuotaGuardAxios } = await import("./proxy.service");
      const axiosInstance = await createTenantQuotaGuardAxios(tenantId || String(channel.tenantId));
      const resp = await axiosInstance.get("https://api.sendgrid.com/v3/user/profile", {
        headers: { Authorization: `Bearer ${decrypted.sendGridKey}` },
        timeout: API_REQUEST_TIMEOUT_MS,
      });
      return {
        success: true,
        message: "Email channel is connected",
        details: { email: decrypted.fromEmail || resp.data?.email },
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.errors?.[0]?.message || err.message || "Unknown error";
      return { success: false, message: errMsg };
    }
  }

  if (channel.type === "SMS") {
    if (!decrypted.accessToken) {
      return { success: false, message: "Missing SMS Access Token" };
    }
    return {
      success: true,
      message: "SMS channel credentials are configured",
      details: { userName: channel.smsUserName, source: channel.smsSource },
    };
  }

  return { success: false, message: `Unsupported channel type: ${channel.type}` };
}

export class ChannelService {
  async getAll(): Promise<any[]> {
    const channels = await ChannelModel.find({}).sort({ createdAt: 1 }).lean();
    return channels.map(maskChannelFields);
  }

  async getAllForTenant(tenantId: string): Promise<any[]> {
    const channels = await ChannelModel.find({ tenantId }).sort({ createdAt: 1 }).lean();
    return channels.map(maskChannelFields);
  }

  async getById(id: string): Promise<any | null> {
    const channel = await ChannelModel.findById(id).lean();
    if (!channel) return null;
    return maskChannelFields(channel);
  }

  async create(data: Partial<IChannel>): Promise<any> {
    const encrypted = encryptChannelFields(data);
    const channel = new ChannelModel(encrypted);
    const saved = await channel.save();
    return maskChannelFields(saved);
  }

  async update(id: string, data: Partial<IChannel>): Promise<any | null> {
    const existing = await ChannelModel.findById(id).lean();
    if (!existing) return null;

    const updateData = { ...data } as any;
    for (const field of CHANNEL_SENSITIVE_FIELDS) {
      const val = updateData[field];
      if (val && val.startsWith("****")) {
        updateData[field] = (existing as any)[field] || null;
      }
    }

    const encrypted = encryptChannelFields(updateData);
    const channel = await ChannelModel.findByIdAndUpdate(id, encrypted, { new: true }).lean();
    if (!channel) return null;

    if (data.accessToken && !data.accessToken.startsWith("****")) {
      await clearChannelTokenExpired(id);
    }

    return maskChannelFields(channel);
  }

  async activate(id: string): Promise<any | null> {
    const channel = await ChannelModel.findByIdAndUpdate(id, { isActive: true }, { new: true }).lean();
    if (!channel) return null;
    return maskChannelFields(channel);
  }

  async deactivate(id: string): Promise<any | null> {
    const channel = await ChannelModel.findByIdAndUpdate(id, { isActive: false }, { new: true }).lean();
    if (!channel) return null;
    return maskChannelFields(channel);
  }

  async delete(id: string): Promise<boolean> {
    const result = await ChannelModel.findByIdAndDelete(id);
    return !!result;
  }
}

export const channelService = new ChannelService();
