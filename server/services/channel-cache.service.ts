import { ChannelModel } from "../models/channel.model";
import { decryptChannelFields, normalizePhoneForMatch, type ChannelCredentials } from "./channel.service";
import { log } from "../index";

export interface CachedChannelEntry {
  channelId: string;
  tenantId: string;
  phoneNumberId: string;
  displayPhone: string;
  accessToken: string;
  verifyToken: string;
  wabaId?: string;
}

export interface ResolutionMetrics {
  cacheHits: number;
  dbFallbacks: number;
  totalResolutions: number;
  cacheHitRate: number;
  latencySamples: number[];
  avgLatencyMs: number;
  lastRebuiltAt: string | null;
  channelsLoaded: number;
  channelsByPhone: number;
}

const MAX_LATENCY_SAMPLES = 500;

class ChannelCache {
  private byPhoneNumberId = new Map<string, CachedChannelEntry>();
  private byNormalizedPhone = new Map<string, CachedChannelEntry>();
  private initialized = false;
  private rebuilding = false;

  private _cacheHits = 0;
  private _dbFallbacks = 0;
  private _latencySamples: number[] = [];
  private _lastRebuiltAt: string | null = null;

  get size(): number {
    return this.byPhoneNumberId.size;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  recordCacheHit(): void {
    this._cacheHits++;
  }

  recordDbFallback(): void {
    this._dbFallbacks++;
  }

  recordLatency(ms: number): void {
    this._latencySamples.push(ms);
    if (this._latencySamples.length > MAX_LATENCY_SAMPLES) {
      this._latencySamples = this._latencySamples.slice(-MAX_LATENCY_SAMPLES);
    }
  }

  getMetrics(): ResolutionMetrics {
    const total = this._cacheHits + this._dbFallbacks;
    const avg = this._latencySamples.length > 0
      ? Math.round(this._latencySamples.reduce((a, b) => a + b, 0) / this._latencySamples.length)
      : 0;
    return {
      cacheHits: this._cacheHits,
      dbFallbacks: this._dbFallbacks,
      totalResolutions: total,
      cacheHitRate: total > 0 ? Math.round((this._cacheHits / total) * 10000) / 100 : 0,
      latencySamples: this._latencySamples.slice(-20),
      avgLatencyMs: avg,
      lastRebuiltAt: this._lastRebuiltAt,
      channelsLoaded: this.byPhoneNumberId.size,
      channelsByPhone: this.byNormalizedPhone.size,
    };
  }

  resetMetrics(): void {
    this._cacheHits = 0;
    this._dbFallbacks = 0;
    this._latencySamples = [];
  }

  lookupByPhoneNumberId(phoneNumberId: string): CachedChannelEntry | null {
    return this.byPhoneNumberId.get(phoneNumberId) || null;
  }

  lookupByDisplayPhone(displayPhone: string): CachedChannelEntry | null {
    const normalized = normalizePhoneForMatch(displayPhone);
    if (!normalized || normalized.length < 6) return null;
    return this.byNormalizedPhone.get(normalized) || null;
  }

  upsert(entry: CachedChannelEntry): void {
    const existing = this.byPhoneNumberId.get(entry.phoneNumberId);
    if (existing && existing.displayPhone && existing.displayPhone !== entry.displayPhone) {
      const oldNorm = normalizePhoneForMatch(existing.displayPhone);
      if (oldNorm) this.byNormalizedPhone.delete(oldNorm);
    }

    this.byPhoneNumberId.set(entry.phoneNumberId, entry);
    if (entry.displayPhone) {
      const normalized = normalizePhoneForMatch(entry.displayPhone);
      if (normalized && normalized.length >= 6) {
        this.byNormalizedPhone.set(normalized, entry);
      }
    }
  }

  remove(phoneNumberId: string): void {
    const existing = this.byPhoneNumberId.get(phoneNumberId);
    if (existing) {
      this.byPhoneNumberId.delete(phoneNumberId);
      if (existing.displayPhone) {
        const normalized = normalizePhoneForMatch(existing.displayPhone);
        if (normalized) this.byNormalizedPhone.delete(normalized);
      }
    }
  }

  async rebuild(): Promise<number> {
    if (this.rebuilding) {
      log("[channel-cache] Rebuild already in progress, skipping", "channel");
      return this.byPhoneNumberId.size;
    }
    this.rebuilding = true;

    try {
      const channels = await ChannelModel.find({
        type: "WHATSAPP",
        status: "active",
        isActive: { $ne: false },
      }).lean();

      const newById = new Map<string, CachedChannelEntry>();
      const newByPhone = new Map<string, CachedChannelEntry>();
      let count = 0;

      for (const channel of channels) {
        const decrypted = decryptChannelFields(channel);
        if (!decrypted.phoneNumberId || !decrypted.accessToken) continue;

        const entry: CachedChannelEntry = {
          channelId: String(channel._id),
          tenantId: String(channel.tenantId),
          phoneNumberId: decrypted.phoneNumberId,
          displayPhone: (channel as any).phoneNumber || "",
          accessToken: decrypted.accessToken,
          verifyToken: decrypted.verifyToken || "",
          wabaId: decrypted.wabaId || undefined,
        };

        newById.set(entry.phoneNumberId, entry);

        if (entry.displayPhone) {
          const normalized = normalizePhoneForMatch(entry.displayPhone);
          if (normalized && normalized.length >= 6) {
            newByPhone.set(normalized, entry);
          }
        }

        count++;
      }

      this.byPhoneNumberId = newById;
      this.byNormalizedPhone = newByPhone;
      this.initialized = true;
      this._lastRebuiltAt = new Date().toISOString();

      log(`[channel-cache] Rebuilt: ${count} channels cached (${newById.size} by ID, ${newByPhone.size} by phone)`, "channel");
      return count;
    } finally {
      this.rebuilding = false;
    }
  }

  toCredentials(entry: CachedChannelEntry): ChannelCredentials {
    return {
      channelId: entry.channelId,
      tenantId: entry.tenantId,
      phoneNumberId: entry.phoneNumberId,
      accessToken: entry.accessToken,
      verifyToken: entry.verifyToken,
      wabaId: entry.wabaId,
    };
  }
}

export const channelCache = new ChannelCache();
