import { log } from "../index";
import { communicationLogService } from "./communication-log.service";
import type { ICommunicationLog } from "../models/communication-log.model";
import { TenantModel } from "../models/tenant.model";
import { decryptTenantSensitiveFields } from "./encryption.service";
import axios from "axios";
import { API_REQUEST_TIMEOUT_MS } from "../lib/constants/limits";

const SMS019_ENDPOINT = "https://019sms.co.il/api";

interface Sms019Response {
  status: number;
  message: string;
  shipment_id?: string;
}

interface SendSmsParams {
  recipient: string;
  content: string;
  tenantId: string;
}

interface SmsCredentials {
  userName: string;
  accessToken: string;
  source: string;
}

const RETRY_DELAYS = [0, 30000, 300000];

export class SmsService {
  private async getCredentials(tenantId?: string): Promise<SmsCredentials> {
    if (tenantId) {
      try {
        const tenant = await TenantModel.findById(tenantId).lean();
        if (tenant) {
          const decrypted = decryptTenantSensitiveFields(tenant);
          if (decrypted.smsConfig?.userName && decrypted.smsConfig?.accessToken && decrypted.smsConfig?.source) {
            return {
              userName: decrypted.smsConfig.userName,
              accessToken: decrypted.smsConfig.accessToken,
              source: decrypted.smsConfig.source,
            };
          }
        }
      } catch (err: any) {
        log(`Failed to fetch tenant SMS config: ${err.message}`, "sms");
      }
    }

    const envCreds = {
      userName: process.env.SMS019_USER_NAME || "",
      accessToken: process.env.SMS019_ACCESS_TOKEN || "",
      source: process.env.SMS019_SOURCE || "",
    };

    if (envCreds.userName && envCreds.accessToken && envCreds.source) {
      return envCreds;
    }

    try {
      const fallbackTenant = await TenantModel.findOne({
        "smsConfig.userName": { $nin: [null, ""] },
        "smsConfig.accessToken": { $nin: [null, ""] },
        "smsConfig.source": { $nin: [null, ""] },
        active: true,
      }).lean();
      if (fallbackTenant) {
        const decrypted = decryptTenantSensitiveFields(fallbackTenant);
        if (decrypted.smsConfig?.userName && decrypted.smsConfig?.accessToken && decrypted.smsConfig?.source) {
          log(`Using fallback tenant SMS config from tenant ${fallbackTenant._id}`, "sms");
          return {
            userName: decrypted.smsConfig.userName,
            accessToken: decrypted.smsConfig.accessToken,
            source: decrypted.smsConfig.source,
          };
        }
      }
    } catch (err: any) {
      log(`Failed to fetch fallback tenant SMS config: ${err.message}`, "sms");
    }

    return envCreds;
  }

  private buildPayload(recipient: string, content: string, creds: SmsCredentials) {
    const phone = recipient.startsWith("0") ? recipient.substring(1) : recipient;
    return {
      sms: {
        user: {
          username: creds.userName,
        },
        source: creds.source,
        destinations: {
          phone: [phone],
        },
        message: content,
      },
    };
  }

  private async attemptSend(recipient: string, content: string, creds: SmsCredentials, tenantId?: string): Promise<{ success: boolean; messageId?: string; errorMessage?: string }> {
    try {
      const payload = this.buildPayload(recipient, content, creds);
      const response = await axios.post<Sms019Response>(SMS019_ENDPOINT, payload, {
        timeout: API_REQUEST_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${creds.accessToken}`,
        },
      });

      const result = response.data;
      if (result.status === 0) {
        return { success: true, messageId: result.shipment_id || String(Date.now()) };
      } else {
        return { success: false, errorMessage: result.message || "Unknown error from 019SMS API" };
      }
    } catch (error: any) {
      return { success: false, errorMessage: error.message || "Network error" };
    }
  }

  private scheduleAutoRetry(logId: string, recipient: string, content: string, currentRetry: number, creds: SmsCredentials) {
    if (currentRetry >= 3) return;

    const delayMs = RETRY_DELAYS[currentRetry] || 0;
    const retryNumber = currentRetry + 1;

    setTimeout(async () => {
      log(`Auto-retry #${retryNumber} for ${recipient} (delay: ${delayMs}ms)`, "sms");

      await communicationLogService.update(logId, {
        status: "Pending",
        retryCount: retryNumber,
        errorMessage: undefined,
      });

      const result = await this.attemptSend(recipient, content, creds);

      if (result.success) {
        await communicationLogService.update(logId, {
          status: "Success",
          messageId: result.messageId,
          retryCount: retryNumber,
        });
        log(`Auto-retry #${retryNumber} succeeded for ${recipient}`, "sms");
      } else {
        await communicationLogService.update(logId, {
          status: "Failed",
          errorMessage: result.errorMessage,
          retryCount: retryNumber,
        });
        log(`Auto-retry #${retryNumber} failed for ${recipient}: ${result.errorMessage}`, "sms");
        this.scheduleAutoRetry(logId, recipient, content, retryNumber, creds);
      }
    }, delayMs);
  }

  async sendSms(params: SendSmsParams): Promise<ICommunicationLog> {
    const creds = await this.getCredentials(params.tenantId);

    const logEntry = await communicationLogService.create({
      timestamp: new Date(),
      recipient: params.recipient,
      content: params.content,
      status: "Pending",
      retryCount: 0,
      tenantId: params.tenantId as any,
    });

    const result = await this.attemptSend(params.recipient, params.content, creds, params.tenantId);

    if (result.success) {
      const updated = await communicationLogService.update(String(logEntry._id), {
        status: "Success",
        messageId: result.messageId,
      });
      log(`SMS sent successfully to ${params.recipient}`, "sms");
      return updated || logEntry;
    } else {
      const updated = await communicationLogService.update(String(logEntry._id), {
        status: "Failed",
        errorMessage: result.errorMessage,
      });
      log(`SMS failed for ${params.recipient}: ${result.errorMessage}`, "sms");

      this.scheduleAutoRetry(String(logEntry._id), params.recipient, params.content, 0, creds);

      return updated || logEntry;
    }
  }

  async retrySms(logId: string): Promise<ICommunicationLog | null> {
    const existingLog = await communicationLogService.getById(logId);
    if (!existingLog) return null;
    if (existingLog.retryCount >= 3) return existingLog;

    const creds = await this.getCredentials(String(existingLog.tenantId));
    const newRetryCount = existingLog.retryCount + 1;
    await communicationLogService.update(logId, {
      status: "Pending",
      retryCount: newRetryCount,
      errorMessage: undefined,
    });

    const result = await this.attemptSend(existingLog.recipient, existingLog.content, creds);

    if (result.success) {
      const updated = await communicationLogService.update(logId, {
        status: "Success",
        messageId: result.messageId,
        retryCount: newRetryCount,
      });
      log(`Manual retry #${newRetryCount} succeeded for ${existingLog.recipient}`, "sms");
      return updated;
    } else {
      const updated = await communicationLogService.update(logId, {
        status: "Failed",
        errorMessage: result.errorMessage,
        retryCount: newRetryCount,
      });
      log(`Manual retry #${newRetryCount} failed for ${existingLog.recipient}: ${result.errorMessage}`, "sms");

      if (newRetryCount < 3) {
        this.scheduleAutoRetry(logId, existingLog.recipient, existingLog.content, newRetryCount, creds);
      }

      return updated;
    }
  }
}

export const smsService = new SmsService();
