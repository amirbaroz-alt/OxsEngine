import { MailService } from "@sendgrid/mail";
import { TenantModel } from "../models/tenant.model";
import { decryptTenantSensitiveFields } from "./encryption.service";
import { getTenantQuotaGuardAgent } from "./proxy.service";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  tenantId?: string;
  replyTo?: string;
}

interface SendEmailResult {
  success: boolean;
  message: string;
  credentialSource: "tenant" | "global";
}

export class EmailService {
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    const { to, subject, html, tenantId, replyTo } = options;

    let apiKey: string | null = null;
    let fromEmail: string | null = null;
    let fromName: string | null = null;
    let credentialSource: "tenant" | "global" = "global";
    let resolvedTenantId: string | undefined = tenantId;

    if (tenantId) {
      try {
        const tenant = await TenantModel.findById(tenantId).lean();
        if (tenant) {
          const decrypted = decryptTenantSensitiveFields(tenant);
          if (decrypted?.mailConfig?.sendGridKey && decrypted?.mailConfig?.fromEmail) {
            apiKey = decrypted.mailConfig.sendGridKey;
            fromEmail = decrypted.mailConfig.fromEmail;
            fromName = decrypted.mailConfig.fromName || decrypted.nameEn || decrypted.nameHe;
            credentialSource = "tenant";
          }
        }
      } catch (err: any) {
        console.error(`[email] Failed to fetch tenant ${tenantId} mail config:`, err.message);
      }
    }

    if (!apiKey || !fromEmail) {
      apiKey = process.env.SENDGRID_API_KEY || null;
      fromEmail = process.env.DEFAULT_FROM_EMAIL || null;
      fromName = process.env.DEFAULT_FROM_NAME || "System";
      credentialSource = "global";
    }

    if (!apiKey || !fromEmail) {
      try {
        const fallbackTenant = await TenantModel.findOne({
          "mailConfig.sendGridKey": { $nin: [null, ""] },
          "mailConfig.fromEmail": { $nin: [null, ""] },
          active: true,
        }).lean();
        if (fallbackTenant) {
          const decrypted = decryptTenantSensitiveFields(fallbackTenant);
          if (decrypted?.mailConfig?.sendGridKey && decrypted?.mailConfig?.fromEmail) {
            apiKey = decrypted.mailConfig.sendGridKey;
            fromEmail = decrypted.mailConfig.fromEmail;
            fromName = decrypted.mailConfig.fromName || decrypted.nameEn || decrypted.nameHe;
            credentialSource = "tenant";
            resolvedTenantId = String(fallbackTenant._id);
            console.log(`[email] Using fallback tenant mail config from tenant ${fallbackTenant._id}`);
          }
        }
      } catch (err: any) {
        console.error(`[email] Failed to fetch fallback tenant mail config:`, err.message);
      }
    }

    if (!apiKey) {
      return {
        success: false,
        message: "No SendGrid API key configured (neither tenant nor global)",
        credentialSource,
      };
    }

    if (!fromEmail) {
      return {
        success: false,
        message: "No from email configured (neither tenant nor global)",
        credentialSource,
      };
    }

    let proxyUsed = false;

    try {
      const mailer = new MailService();
      mailer.setApiKey(apiKey);

      console.log(`[email] Resolving QuotaGuard proxy for tenantId=${resolvedTenantId || "none"}`);
      const agent = await getTenantQuotaGuardAgent(resolvedTenantId);
      console.log(`[email] QuotaGuard proxy agent resolved: ${agent ? "YES" : "NO"}`);

      if (agent) {
        const mailClient = (mailer as any).client;
        mailClient.setDefaultRequest("httpsAgent", agent);
        mailClient.setDefaultRequest("proxy", false);
        proxyUsed = true;
      }

      const msg: any = {
        to,
        from: { email: fromEmail, name: fromName || undefined },
        subject,
        html,
      };

      if (replyTo) {
        msg.replyTo = replyTo;
      }

      await mailer.send(msg);

      console.log(
        `[email] Sent to ${to} via ${credentialSource} credentials` +
        ` (from: ${fromEmail})` +
        (proxyUsed ? ` [proxy: quotaguard]` : ` [direct]`)
      );

      return {
        success: true,
        message: `Email sent successfully via ${credentialSource} credentials`,
        credentialSource,
      };
    } catch (err: any) {
      const errorMessage = err?.response?.body?.errors?.[0]?.message || err.message || "Unknown SendGrid error";
      console.error(`[email] Failed to send to ${to} via ${credentialSource}:`, errorMessage);

      return {
        success: false,
        message: `SendGrid error (${credentialSource}): ${errorMessage}`,
        credentialSource,
      };
    }
  }
}

export const emailService = new EmailService();
