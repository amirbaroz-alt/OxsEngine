import type { Express } from "express";
import { authService } from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) return false;
  entry.count++;
  return true;
}

export function registerAuthRoutes(app: Express) {

  app.get("/api/public/tenant/:slug", async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const tenant = await TenantModel.findOne({
        slug: req.params.slug,
        active: true,
      });
      if (!tenant) {
        return res.status(404).json({ message: "Company not found" });
      }
      res.json({
        _id: tenant._id,
        nameHe: tenant.nameHe,
        nameEn: tenant.nameEn,
        logo: tenant.logo,
        primaryColor: tenant.primaryColor,
        defaultLanguage: tenant.defaultLanguage,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });


  app.post("/api/auth/request-login", async (req, res) => {
    try {
      const { identifier, mode, language, tenantId } = req.body;
      if (!identifier || !mode || !["phone", "email"].includes(mode)) {
        return res.status(400).json({ message: "identifier and mode (phone|email) are required" });
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const key = mode === "phone" ? identifier.replace(/[-\s]/g, "") : identifier.toLowerCase();

      if (!rateLimit(`login-req:${key}`, 5, 10 * 60 * 1000)) {
        return res.status(429).json({ message: "TOO_MANY_REQUESTS" });
      }
      if (!rateLimit(`login-ip:${ip}`, 15, 10 * 60 * 1000)) {
        return res.status(429).json({ message: "TOO_MANY_REQUESTS" });
      }

      const result = await authService.requestLogin(
        identifier,
        mode,
        req.headers["user-agent"],
        ip,
        language,
        tenantId
      );

      if (!result.success) {
        return res.status(401).json({ message: result.error || "LOGIN_FAILED" });
      }

      if (!result.requiresOtp) {
        return res.json({
          requiresOtp: false,
          token: result.token,
          user: result.user,
        });
      }

      res.json({ requiresOtp: true, message: "OTP_SENT" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/verify-login", async (req, res) => {
    try {
      const { identifier, mode, otp, tenantId } = req.body;
      if (!identifier || !mode || !otp) {
        return res.status(400).json({ message: "identifier, mode, and otp are required" });
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const key = mode === "phone" ? identifier.replace(/[-\s]/g, "") : identifier.toLowerCase();

      if (!rateLimit(`login-verify:${key}:${ip}`, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ message: "TOO_MANY_REQUESTS" });
      }

      const result = await authService.verifyLogin(
        identifier,
        mode,
        otp,
        req.headers["user-agent"],
        ip,
        tenantId
      );

      if (!result) {
        return res.status(401).json({ message: "INVALID_OTP" });
      }

      res.json({ token: result.token, user: result.user });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/request-otp", async (req, res) => {
    try {
      const { phone, tenantId, language } = req.body;
      if (!phone || !tenantId) {
        return res.status(400).json({ message: "Phone and tenantId are required" });
      }

      const normalizedPhone = phone.replace(/[-\s]/g, "");
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!rateLimit(`otp:${normalizedPhone}:${tenantId}`, 3, 10 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many OTP requests. Try again later." });
      }
      if (!rateLimit(`otp-ip:${ip}`, 10, 10 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many requests. Try again later." });
      }

      const result = await authService.requestOtp(phone, tenantId, language);
      res.json({ success: result.success, message: "OTP sent if user exists" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const { phone, tenantId, otp } = req.body;
      if (!phone || !tenantId || !otp) {
        return res.status(400).json({ message: "Phone, tenantId, and OTP are required" });
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const normalizedPhone = phone.replace(/[-\s]/g, "");
      if (!rateLimit(`verify-otp:${normalizedPhone}:${ip}`, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ message: "Too many verification attempts. Try again later." });
      }

      const result = await authService.verifyOtp(phone, tenantId, otp);
      if (!result) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }

      res.json({
        token: result.token,
        user: {
          _id: result.user._id,
          name: result.user.name,
          phone: result.user.phone,
          role: result.user.role,
          tenantId: result.user.tenantId,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      let tenantBusyReasons: string[] = [];
      if (user.tenantId) {
        const { TenantModel } = await import("../models/tenant.model");
        const tenant = await TenantModel.findById(user.tenantId).select("busyReasons").lean();
        if (tenant?.busyReasons && tenant.busyReasons.length > 0) {
          tenantBusyReasons = tenant.busyReasons;
        }
      }
      const userAllowed: string[] = (user as any).allowedBusyReasons || [];
      const effectiveBusyReasons = userAllowed.length > 0
        ? tenantBusyReasons.filter((r: string) => userAllowed.includes(r))
        : tenantBusyReasons;

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        tenantId: user.tenantId,
        teamIds: (user as any).teamIds || [],
        acwTimeLimit: (user as any).acwTimeLimit ?? 3,
        presenceStatus: (user as any).presenceStatus || "active",
        presenceReason: (user as any).presenceReason || "",
        allowedBusyReasons: userAllowed,
        busyReasons: effectiveBusyReasons,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/auth/presence", requireAuth, async (req, res) => {
    try {
      const { presenceStatus, presenceReason } = req.body;
      if (!["active", "busy", "break", "offline"].includes(presenceStatus)) {
        return res.status(400).json({ message: "Invalid presence status" });
      }
      let reason = (presenceStatus === "busy" || presenceStatus === "break") ? (presenceReason || "") : "";
      if (presenceStatus === "busy" && reason) {
        const { TenantModel } = await import("../models/tenant.model");
        const { UserModel: UM } = await import("../models/user.model");
        const currentUser = await UM.findById(req.user!._id).select("tenantId allowedBusyReasons").lean();
        let tenantReasons: string[] = [];
        if (currentUser?.tenantId) {
          const tenant = await TenantModel.findById(currentUser.tenantId).select("busyReasons").lean();
          if (tenant?.busyReasons && tenant.busyReasons.length > 0) {
            tenantReasons = tenant.busyReasons;
          }
        }
        const userAllowed: string[] = (currentUser as any)?.allowedBusyReasons || [];
        const effectiveReasons = userAllowed.length > 0
          ? tenantReasons.filter((r: string) => userAllowed.includes(r))
          : tenantReasons;
        if (!effectiveReasons.includes(reason)) {
          reason = effectiveReasons[0] || "";
        }
      }
      const { PresenceLogModel } = await import("../models/presence-log.model");
      const now = new Date();
      await PresenceLogModel.updateMany(
        { userId: req.user!._id, endedAt: null },
        { $set: { endedAt: now } }
      );
      await PresenceLogModel.create({
        userId: req.user!._id,
        tenantId: req.user!.tenantId || undefined,
        status: presenceStatus,
        reason,
        startedAt: now,
      });

      const { UserModel } = await import("../models/user.model");
      const user = await UserModel.findByIdAndUpdate(
        req.user!._id,
        { $set: { presenceStatus, presenceReason: reason } },
        { new: true }
      ).select("name tenantId presenceStatus presenceReason isOnline").lean();
      if (!user) return res.status(404).json({ message: "User not found" });

      const { getIO } = await import("../services/socket.service");
      const io = getIO();
      if (io && user.tenantId) {
        io.to(`tenant:${String(user.tenantId)}`).emit("agent-status", {
          userId: String(user._id),
          userName: user.name,
          isOnline: user.isOnline,
          presenceStatus: user.presenceStatus,
          presenceReason: (user as any).presenceReason || "",
        });
      }
      res.json({ presenceStatus: user.presenceStatus, presenceReason: (user as any).presenceReason || "" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/auth/presence-log", requireAuth, async (req, res) => {
    try {
      const { PresenceLogModel } = await import("../models/presence-log.model");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const logs = await PresenceLogModel.find({
        userId: req.user!._id,
        $or: [
          { startedAt: { $gte: today, $lt: tomorrow } },
          { startedAt: { $lt: today }, endedAt: { $gt: today } },
          { startedAt: { $lt: today }, endedAt: null },
        ],
      }).sort({ startedAt: 1 }).lean();

      res.json(logs.map((log) => ({
        _id: String(log._id),
        status: log.status,
        reason: log.reason,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(200).json({ success: true });
      }
      const token = authHeader.substring(7);
      await authService.logout(token);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
