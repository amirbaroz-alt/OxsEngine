import { AuditAlertConfigModel } from "../models/AuditAlertConfig";
import { emailService } from "./email.service";
import { smsService } from "./sms.service";
import { log } from "../lib/logger";

const DAILY_SYNC_HOUR = 4;

export async function syncTenantAlertEmails(): Promise<{ synced: number; totalEmails: number }> {
  const { TenantModel } = await import("../models/tenant.model");
  const { UserModel } = await import("../models/user.model");

  const tenants = await TenantModel.find({ active: true }).select("_id nameEn slug").lean();
  let synced = 0;
  let totalEmails = 0;

  for (const tenant of tenants) {
    const superAdmins = await UserModel.find({
      $and: [
        { $or: [
          { role: "superadmin" },
          { role: "businessadmin", tenantId: tenant._id },
        ]},
        { active: { $ne: false } },
        { $or: [
          { email: { $exists: true, $nin: [null, ""] } },
          { phone: { $exists: true, $nin: [null, ""] } },
        ]},
      ],
    })
      .select("email phone")
      .lean();

    const emails = [...new Set(superAdmins.map((u: any) => u.email).filter(Boolean))];
    const phones = [...new Set(superAdmins.map((u: any) => u.phone).filter(Boolean))];

    await AuditAlertConfigModel.findOneAndUpdate(
      { tenantId: tenant._id },
      { emails, phones, lastSyncedAt: new Date() },
      { upsert: true, new: true }
    );

    totalEmails += emails.length;
    synced++;
  }

  log(`[audit-alert] Synced alert emails for ${synced} tenants (${totalEmails} total emails)`, "audit");
  return { synced, totalEmails };
}

export async function getAlertEmails(tenantId: string): Promise<string[]> {
  const config = await AuditAlertConfigModel.findOne({ tenantId }).lean();
  return config?.emails || [];
}

export async function sendFailureAlert(opts: {
  tenantId?: string;
  tenantName?: string;
  traceId: string;
  error?: string;
  whatsappMessageId?: string;
}): Promise<void> {
  if (!opts.tenantId) {
    log(`[audit-alert] No tenantId for trace ${opts.traceId}, skipping alert`, "audit");
    return;
  }

  const config = await AuditAlertConfigModel.findOne({ tenantId: opts.tenantId }).lean();
  const emails = config?.emails || [];
  const phones = config?.phones || [];

  if (!emails.length && !phones.length) {
    log(`[audit-alert] No alert recipients for tenant ${opts.tenantId}, skipping`, "audit");
    return;
  }

  if (emails.length > 0) {
    const subject = `[OMMA Alert] Message Failure - Tenant: ${opts.tenantName || opts.tenantId}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #dc2626; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">Message Pipeline Failure Detected</h2>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; width: 140px;">Trace ID</td>
              <td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${opts.traceId}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Tenant</td>
              <td style="padding: 8px 0;">${opts.tenantName || opts.tenantId}</td>
            </tr>
            ${opts.whatsappMessageId ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">WhatsApp ID</td>
              <td style="padding: 8px 0; font-family: monospace; font-size: 12px;">${opts.whatsappMessageId}</td>
            </tr>` : ""}
            ${opts.error ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Error</td>
              <td style="padding: 8px 0; color: #dc2626;">${opts.error}</td>
            </tr>` : ""}
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">Time</td>
              <td style="padding: 8px 0;">${new Date().toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })}</td>
            </tr>
          </table>
          <div style="margin-top: 20px;">
            <a href="${process.env.APP_BASE_URL || ""}/message-monitor" style="background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">
              View in Message Monitor
            </a>
          </div>
        </div>
      </div>
    `;

    for (const to of emails) {
      try {
        await emailService.send({ to, subject, html });
        log(`[audit-alert] Failure alert sent to ${to} for trace ${opts.traceId}`, "audit");
      } catch (err: any) {
        log(`[audit-alert] Failed to send alert to ${to}: ${err.message}`, "audit");
      }
    }
  }

  if (phones.length > 0) {
    const smsContent = `[OMMA] הודעה נכשלה עבור ${opts.tenantName || opts.tenantId}. ${opts.error ? `שגיאה: ${opts.error.slice(0, 80)}` : ""} בדוק ב-Message Monitor.`;
    for (const phone of phones) {
      try {
        await smsService.sendSms({ recipient: phone, content: smsContent, tenantId: opts.tenantId });
        log(`[audit-alert] SMS alert sent to ${phone} for trace ${opts.traceId}`, "audit");
      } catch (err: any) {
        log(`[audit-alert] Failed to send SMS to ${phone}: ${err.message}`, "audit");
      }
    }
  }
}

export function startAlertSyncCron(): void {
  const checkInterval = 60 * 60 * 1000;
  let lastRunDate = "";

  setInterval(async () => {
    const now = new Date();
    const ilTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    const dateKey = ilTime.toDateString();
    const hour = ilTime.getHours();

    if (hour === DAILY_SYNC_HOUR && dateKey !== lastRunDate) {
      lastRunDate = dateKey;
      try {
        await syncTenantAlertEmails();
      } catch (err: any) {
        log(`[audit-alert] Cron sync failed: ${err.message}`, "audit");
      }
    }
  }, checkInterval);

  log(`[audit-alert] Daily sync cron registered (runs at ${DAILY_SYNC_HOUR}:00 IL time)`, "audit");
}
