import crypto from "crypto";
import { UserModel, type IUser } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { smsService } from "./sms.service";
import { emailService } from "./email.service";
import { log } from "../lib/logger";

const ADMIN_SESSION_HOURS = 8;
const USER_SESSION_HOURS = 24;
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

function formatPhone(phone: string): string {
  const digits = phone.replace(/[-\s]/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return phone;
}

type SupportedLang = "he" | "en" | "ar" | "ru" | "tr";

const otpTemplates: Record<SupportedLang, {
  sms: (code: string) => string;
  emailSubject: string;
  emailHtml: (code: string, minutes: number) => string;
}> = {
  he: {
    sms: (code) => `קוד האימות שלך: ${code}`,
    emailSubject: "קוד אימות",
    emailHtml: (code, minutes) => `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2>קוד האימות שלך</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${code}</p>
        <p style="color: #6b7280;">הקוד תקף ל-${minutes} דקות</p>
      </div>`,
  },
  en: {
    sms: (code) => `Your verification code: ${code}`,
    emailSubject: "Verification Code",
    emailHtml: (code, minutes) => `
      <div dir="ltr" style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2>Your Verification Code</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${code}</p>
        <p style="color: #6b7280;">This code is valid for ${minutes} minutes.</p>
      </div>`,
  },
  ar: {
    sms: (code) => `رمز التحقق الخاص بك: ${code}`,
    emailSubject: "رمز التحقق",
    emailHtml: (code, minutes) => `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2>رمز التحقق الخاص بك</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${code}</p>
        <p style="color: #6b7280;">هذا الرمز صالح لمدة ${minutes} دقائق.</p>
      </div>`,
  },
  ru: {
    sms: (code) => `Ваш код подтверждения: ${code}`,
    emailSubject: "Код подтверждения",
    emailHtml: (code, minutes) => `
      <div dir="ltr" style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2>Ваш код подтверждения</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${code}</p>
        <p style="color: #6b7280;">Код действителен ${minutes} минут.</p>
      </div>`,
  },
  tr: {
    sms: (code) => `Doğrulama kodunuz: ${code}`,
    emailSubject: "Doğrulama Kodu",
    emailHtml: (code, minutes) => `
      <div dir="ltr" style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2>Doğrulama Kodunuz</h2>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; margin: 20px 0;">${code}</p>
        <p style="color: #6b7280;">Bu kod ${minutes} dakika geçerlidir.</p>
      </div>`,
  },
};

function getOtpTemplate(lang?: string) {
  const supported: SupportedLang[] = ["he", "en", "ar", "ru", "tr"];
  const key = (lang && supported.includes(lang as SupportedLang) ? lang : "he") as SupportedLang;
  return otpTemplates[key];
}

const LOCKOUT_MINUTES = 15;

type LoginMode = "phone" | "email";

interface RequestLoginResult {
  success: boolean;
  requiresOtp: boolean;
  token?: string;
  user?: any;
  error?: string;
}

class AuthService {

  private isTestMode(): boolean {
    return process.env.APP_MODE === "test";
  }

  private isSuperAdminIdentifier(identifier: string, mode: LoginMode): boolean {
    if (mode === "email") {
      const adminEmail = process.env.ADMIN_EMAIL || "";
      return adminEmail.length > 0 && identifier.toLowerCase() === adminEmail.toLowerCase();
    } else {
      const adminPhone = process.env.ADMIN_MOBILE_NUMBER || "";
      const normalizedInput = identifier.replace(/[-\s]/g, "");
      return adminPhone.length > 0 && normalizedInput === adminPhone.replace(/[-\s]/g, "");
    }
  }

  private async findUserByIdentifier(identifier: string, mode: LoginMode, tenantId?: string): Promise<IUser | null> {
    const filter: any = { active: true };
    if (tenantId) {
      filter.tenantId = tenantId;
    }
    if (mode === "email") {
      filter.email = identifier.toLowerCase();
    } else {
      filter.phone = identifier.replace(/[-\s]/g, "");
    }
    return UserModel.findOne(filter);
  }

  async requestLogin(identifier: string, mode: LoginMode, userAgent?: string, ip?: string, language?: string, tenantId?: string): Promise<RequestLoginResult> {
    const isSuperAdmin = this.isSuperAdminIdentifier(identifier, mode);

    const user = await this.findUserByIdentifier(identifier, mode, tenantId);
    if (!user) {
      return { success: false, requiresOtp: false, error: "USER_NOT_FOUND" };
    }

    if (isSuperAdmin && this.isTestMode()) {
      await UserModel.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });
      const token = await this.createSession(String(user._id), true, userAgent, ip);
      return {
        success: true,
        requiresOtp: false,
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          tenantId: user.tenantId,
        },
      };
    }

    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      return { success: false, requiresOtp: false, error: "ACCOUNT_LOCKED" };
    }

    if (user.isLocked && user.lockedUntil && user.lockedUntil <= new Date()) {
      await UserModel.findByIdAndUpdate(user._id, {
        isLocked: false,
        lockedUntil: null,
        otpAttempts: 0,
      });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await UserModel.findByIdAndUpdate(user._id, {
      otpCode,
      otpExpiresAt,
      otpAttempts: 0,
    });

    const tpl = getOtpTemplate(language);

    try {
      if (mode === "phone") {
        const normalizedPhone = identifier.replace(/[-\s]/g, "");
        await smsService.sendSms({
          recipient: normalizedPhone,
          content: tpl.sms(otpCode),
          tenantId: String(user.tenantId),
        });
        log(`OTP sent via SMS to ${formatPhone(normalizedPhone)}`, "auth");
      } else {
        const emailResult = await emailService.send({
          to: identifier.toLowerCase(),
          subject: tpl.emailSubject,
          html: tpl.emailHtml(otpCode, OTP_EXPIRY_MINUTES),
          tenantId: user.tenantId ? String(user.tenantId) : undefined,
        });
        if (!emailResult.success) {
          throw new Error(emailResult.message);
        }
        log(`OTP sent via email to ${identifier}`, "auth");
      }
    } catch (err: any) {
      log(`Failed to send OTP to ${identifier}: ${err.message}`, "auth");
      await UserModel.findByIdAndUpdate(user._id, {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      });
      return { success: false, requiresOtp: false, error: "DELIVERY_FAILED" };
    }

    return { success: true, requiresOtp: true };
  }

  async verifyLogin(identifier: string, mode: LoginMode, otp: string, userAgent?: string, ip?: string, tenantId?: string): Promise<{ token: string; user: any } | null> {
    const user = await this.findUserByIdentifier(identifier, mode, tenantId);
    if (!user) return null;

    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      return null;
    }

    if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return null;
    }

    if (user.otpCode !== otp) {
      const newAttempts = (user.otpAttempts || 0) + 1;
      const updateData: any = { otpAttempts: newAttempts };

      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        updateData.isLocked = true;
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        updateData.otpCode = null;
        updateData.otpExpiresAt = null;
        log(`User ${identifier} locked after ${MAX_OTP_ATTEMPTS} failed OTP attempts`, "auth");
      }

      await UserModel.findByIdAndUpdate(user._id, updateData);
      return null;
    }

    await UserModel.findByIdAndUpdate(user._id, {
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      isLocked: false,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });

    const isAdmin = user.role === "superadmin";
    const token = await this.createSession(String(user._id), isAdmin, userAgent, ip);

    return {
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }


  async createSession(userId: string, isAdmin: boolean, userAgent?: string, ip?: string): Promise<string> {
    const existingSession = await SessionModel.findOne({
      userId,
      expiresAt: { $gt: new Date() },
    });
    if (existingSession) {
      return existingSession.token;
    }

    await SessionModel.deleteMany({ userId });

    const token = crypto.randomBytes(32).toString("hex");
    const hours = isAdmin ? ADMIN_SESSION_HOURS : USER_SESSION_HOURS;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    await SessionModel.create({
      userId,
      token,
      userAgent,
      ipAddress: ip,
      expiresAt,
    });

    return token;
  }

  async requestOtp(phone: string, tenantId: string, language?: string): Promise<{ success: boolean }> {
    const normalizedPhone = phone.replace(/[-\s]/g, "");
    const user = await UserModel.findOne({ phone: normalizedPhone, tenantId, active: true });

    if (!user) {
      return { success: true };
    }

    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      return { success: true };
    }

    if (user.isLocked && user.lockedUntil && user.lockedUntil <= new Date()) {
      await UserModel.findByIdAndUpdate(user._id, {
        isLocked: false,
        lockedUntil: null,
        otpAttempts: 0,
      });
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await UserModel.findByIdAndUpdate(user._id, {
      otpCode,
      otpExpiresAt,
      otpAttempts: 0,
    });

    const tpl = getOtpTemplate(language);
    try {
      await smsService.sendSms({
        recipient: normalizedPhone,
        content: tpl.sms(otpCode),
        tenantId,
      });
      log(`OTP sent to ${formatPhone(normalizedPhone)}`, "auth");
    } catch (err: any) {
      log(`Failed to send OTP to ${normalizedPhone}: ${err.message}`, "auth");
    }

    return { success: true };
  }

  async verifyOtp(phone: string, tenantId: string, otp: string): Promise<{ token: string; user: IUser } | null> {
    const normalizedPhone = phone.replace(/[-\s]/g, "");
    const user = await UserModel.findOne({ phone: normalizedPhone, tenantId, active: true });

    if (!user) return null;

    if (user.isLocked && user.lockedUntil && user.lockedUntil > new Date()) {
      return null;
    }

    if (!user.otpCode || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return null;
    }

    if (user.otpCode !== otp) {
      const newAttempts = (user.otpAttempts || 0) + 1;
      const updateData: any = { otpAttempts: newAttempts };

      if (newAttempts >= MAX_OTP_ATTEMPTS) {
        updateData.isLocked = true;
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        updateData.otpCode = null;
        updateData.otpExpiresAt = null;
        log(`User ${normalizedPhone} locked after ${MAX_OTP_ATTEMPTS} failed OTP attempts`, "auth");
      }

      await UserModel.findByIdAndUpdate(user._id, updateData);
      return null;
    }

    await UserModel.findByIdAndUpdate(user._id, {
      otpCode: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      isLocked: false,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });

    const token = await this.createSession(String(user._id), false);
    return { token, user };
  }

  async validateSession(token: string): Promise<IUser | null> {
    const session = await SessionModel.findOne({ token });
    if (!session || session.expiresAt < new Date()) {
      if (session) await SessionModel.deleteOne({ _id: session._id });
      return null;
    }

    const user = await UserModel.findById(session.userId);
    if (!user || !user.active) {
      await SessionModel.deleteOne({ _id: session._id });
      return null;
    }

    return user;
  }

  async validateSocketSession(token: string): Promise<{ userId: string; role: string; tenantId?: string; name?: string; presenceStatus?: string } | null> {
    const session = await SessionModel.findOne({ token, expiresAt: { $gt: new Date() } }).lean();
    if (!session) return null;

    const user = await UserModel.findById(session.userId).lean();
    if (!user) return null;

    return {
      userId: String(user._id),
      role: user.role,
      tenantId: user.tenantId ? String(user.tenantId) : undefined,
      name: user.name,
      presenceStatus: (user as any).presenceStatus || "active",
    };
  }

  async logout(token: string): Promise<void> {
    await SessionModel.deleteOne({ token });
  }

  async seedSuperAdmin(email: string): Promise<void> {
    const adminPhone = process.env.ADMIN_MOBILE_NUMBER || "0000000000";
    const existing = await UserModel.findOne({ email, role: "superadmin" });
    if (existing) {
      await UserModel.findByIdAndUpdate(existing._id, { phone: adminPhone });
      log("Super admin synced", "auth");
      return;
    }

    const dummyTenantId = new (await import("mongoose")).Types.ObjectId();

    await UserModel.create({
      name: "Super Admin",
      phone: adminPhone,
      email,
      role: "superadmin",
      tenantId: dummyTenantId,
      active: true,
    });

    log("Super admin user created", "auth");
  }
}

export const authService = new AuthService();
