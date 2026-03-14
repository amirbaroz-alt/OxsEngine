import crypto from "crypto";
import { log } from "../lib/logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCODING = "base64";
const PREFIX = "enc:";

class EncryptionService {
  private getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error("ENCRYPTION_KEY environment variable is not set");
    }
    return Buffer.from(key, "hex");
  }

  encrypt(plainText: string): string {
    if (!plainText) return plainText;
    if (plainText.startsWith(PREFIX)) return plainText;

    const key = this.getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, tag, encrypted]);
    return PREFIX + combined.toString(ENCODING);
  }

  decrypt(encryptedText: string): string {
    if (!encryptedText) return encryptedText;
    if (!encryptedText.startsWith(PREFIX)) return encryptedText;

    const key = this.getKey();
    const raw = encryptedText.slice(PREFIX.length);
    const combined = Buffer.from(raw, ENCODING);

    const iv = combined.subarray(0, IV_LENGTH);
    const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
  }

  isEncrypted(value: string): boolean {
    return !!value && value.startsWith(PREFIX);
  }

  static generateKey(): string {
    return crypto.randomBytes(32).toString("hex");
  }
}

export const encryptionService = new EncryptionService();

const SENSITIVE_FIELDS: Record<string, string[]> = {
  smsConfig: ["accessToken"],
  mailConfig: ["sendGridKey"],
  whatsappConfig: ["accessToken", "verifyToken"],
  quotaGuardConfig: ["proxyUrl"],
};

export function encryptTenantSensitiveFields(data: any): any {
  if (!data) return data;
  const result = { ...data };

  for (const [configKey, fields] of Object.entries(SENSITIVE_FIELDS)) {
    if (result[configKey]) {
      result[configKey] = { ...result[configKey] };
      for (const field of fields) {
        const val = result[configKey][field];
        if (val && !encryptionService.isEncrypted(val)) {
          result[configKey][field] = encryptionService.encrypt(val);
        }
      }
    }
  }

  return result;
}

export function decryptTenantSensitiveFields(data: any): any {
  if (!data) return data;
  const result = typeof data.toObject === "function" ? data.toObject() : { ...data };

  for (const [configKey, fields] of Object.entries(SENSITIVE_FIELDS)) {
    if (result[configKey]) {
      result[configKey] = { ...result[configKey] };
      for (const field of fields) {
        const val = result[configKey][field];
        if (val && encryptionService.isEncrypted(val)) {
          result[configKey][field] = encryptionService.decrypt(val);
        }
      }
    }
  }

  return result;
}
