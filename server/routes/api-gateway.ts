import type { Express } from "express";
import { authService } from "../services/auth.service";
import { smsService } from "../services/sms.service";
import { emailService } from "../services/email.service";
import { jwtService } from "../services/jwt.service";
import {
  requireJwt,
  requireJwtRole,
  requireJwtTenant,
  attachCorrelationId,
  impersonationAudit,
} from "../middleware/api-gateway.middleware";
import { randomUUID } from "crypto";
import { logAdapter } from "../lib/log.adapter";
import { log } from "../index";

const TAG = "api-gateway";

/**
 * OxsEngine External API Gateway  —  /api/v1/*
 *
 * This is the ONLY entry point for external applications (Bank, Omnichannel, etc.).
 * All routes here issue or validate JWT tokens and proxy calls to the existing services.
 *
 * Authentication flow for an external app:
 *   1. POST /api/v1/auth/request-login   → sends OTP to user
 *   2. POST /api/v1/auth/verify-login    → validates OTP, returns JWT
 *   3. All subsequent calls:  Authorization: Bearer <jwt>
 *
 * Rate limiting, encryption, and tenant isolation are all handled by the
 * underlying services — this file only adds the JWT layer on top.
 */

// Simple in-memory rate limiter (reuse from auth.ts pattern)
const rlMap = new Map<string, { count: number; resetAt: number }>();
function rl(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rlMap.get(key);
  if (!entry || now > entry.resetAt) {
    rlMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

export function registerApiGatewayRoutes(app: Express) {

  // Attach correlationId to every /api/v1 request (read from header or generate)
  app.use("/api/v1", attachCorrelationId);

  // Global impersonation audit — blocks DELETE and logs all writes during impersonation
  app.use("/api/v1", impersonationAudit);

  // ─────────────────────────────────────────────
  // AUTH  (public — no JWT required)
  // ─────────────────────────────────────────────

  /**
   * Step 1 — Request OTP
   * POST /api/v1/auth/request-login
   * Body: { identifier, mode: "phone"|"email", tenantId, language? }
   */
  app.post("/api/v1/auth/request-login", async (req, res) => {
    try {
      const { identifier, mode, tenantId, language } = req.body;

      if (!identifier || !mode || !["phone", "email"].includes(mode)) {
        return res.status(400).json({
          success: false,
          error: "identifier and mode (phone|email) are required",
        });
      }
      // tenantId is optional — superadmin login has no tenant scope

      const ip = req.ip || "unknown";
      const key = mode === "phone" ? identifier.replace(/[-\s]/g, "") : identifier.toLowerCase();
      if (!rl(`gw-req:${key}`, 5, 10 * 60 * 1000)) {
        return res.status(429).json({ success: false, error: "TOO_MANY_REQUESTS" });
      }

      const startMs = Date.now();
      const result = await authService.requestLogin(
        identifier,
        mode,
        req.headers["user-agent"],
        ip,
        language,
        tenantId
      );

      if (!result.success) {
        logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "auth", action: "request-login", status: "error", durationMs: Date.now() - startMs, error: result.error, data: { mode } }).catch(() => {});
        return res.status(401).json({ success: false, error: result.error || "LOGIN_FAILED" });
      }

      // Test mode: superadmin skips OTP — issue JWT immediately
      if (!result.requiresOtp && result.user) {
        const jwt = jwtService.issue({
          userId: String(result.user._id),
          tenantId: String(result.user.tenantId),
          role: result.user.role,
          name: result.user.name,
        });
        logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "auth", action: "request-login-bypass", status: "success", durationMs: Date.now() - startMs, data: { mode, userId: String(result.user._id) } }).catch(() => {});
        return res.json({ success: true, requiresOtp: false, token: jwt, user: result.user });
      }

      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "auth", action: "request-login", status: "success", durationMs: Date.now() - startMs, data: { mode } }).catch(() => {});
      log(`[${TAG}] OTP requested for ${key} on tenant ${tenantId}`, TAG);
      res.json({ success: true, requiresOtp: result.requiresOtp });
    } catch (err: any) {
      log(`[${TAG}] request-login error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /**
   * Step 2 — Verify OTP and receive JWT
   * POST /api/v1/auth/verify-login
   * Body: { identifier, mode, otp, tenantId }
   * Returns: { success, token, user }
   */
  app.post("/api/v1/auth/verify-login", async (req, res) => {
    try {
      const { identifier, mode, otp, tenantId } = req.body;

      if (!identifier || !mode || !otp || !tenantId) {
        return res.status(400).json({
          success: false,
          error: "identifier, mode, otp, tenantId are required",
        });
      }

      const ip = req.ip || "unknown";
      const key = mode === "phone" ? identifier.replace(/[-\s]/g, "") : identifier.toLowerCase();
      if (!rl(`gw-verify:${key}:${ip}`, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ success: false, error: "TOO_MANY_REQUESTS" });
      }

      const startMs = Date.now();
      const result = await authService.verifyLogin(
        identifier,
        mode,
        otp,
        req.headers["user-agent"],
        ip,
        tenantId
      );

      if (!result) {
        logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "auth", action: "verify-login", status: "error", durationMs: Date.now() - startMs, error: "INVALID_OTP", data: { mode } }).catch(() => {});
        return res.status(401).json({ success: false, error: "INVALID_OTP" });
      }

      // Issue JWT — this is the token the external app will use for all future calls
      const jwt = jwtService.issue({
        userId: String(result.user._id),
        tenantId: String(result.user.tenantId),
        role: result.user.role,
        name: result.user.name,
      });

      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "auth", action: "verify-login", status: "success", durationMs: Date.now() - startMs, data: { userId: String(result.user._id), mode } }).catch(() => {});
      log(`[${TAG}] JWT issued for user ${result.user._id} on tenant ${tenantId}`, TAG);

      res.json({
        success: true,
        token: jwt,
        user: {
          _id: result.user._id,
          name: result.user.name,
          email: result.user.email,
          phone: result.user.phone,
          role: result.user.role,
          tenantId: result.user.tenantId,
        },
      });
    } catch (err: any) {
      log(`[${TAG}] verify-login error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /**
   * Verify JWT is still valid — useful for app startup checks
   * GET /api/v1/auth/me
   * Headers: Authorization: Bearer <jwt>
   */
  app.get("/api/v1/auth/me", requireJwt, (req, res) => {
    res.json({ success: true, user: req.jwtPayload });
  });

  // ─────────────────────────────────────────────
  // SMS  (requires JWT + tenant isolation)
  // ─────────────────────────────────────────────

  /**
   * Send SMS via tenant's configured provider
   * POST /api/v1/sms/send
   * Headers: Authorization: Bearer <jwt>
   * Body: { recipient, content, tenantId? }
   * (tenantId auto-injected from JWT if not provided)
   */
  app.post("/api/v1/sms/send", requireJwt, requireJwtTenant, async (req, res) => {
    try {
      const { recipient, content, tenantId } = req.body;

      if (!recipient || !content) {
        return res.status(400).json({ success: false, error: "recipient and content are required" });
      }

      const startMs = Date.now();
      const logEntry = await smsService.sendSms({ recipient, content, tenantId });
      const smsStatus = (logEntry as any).status === "Success" ? "success" : "error";
      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "sms", action: "send", status: smsStatus, durationMs: Date.now() - startMs, data: { recipient, messageId: (logEntry as any).messageId || null } }).catch(() => {});

      log(`[${TAG}] SMS sent to ${recipient} for tenant ${tenantId}`, TAG);

      res.json({
        success: true,
        data: {
          messageId: (logEntry as any).messageId || null,
          status: (logEntry as any).status,
        },
      });
    } catch (err: any) {
      log(`[${TAG}] sms/send error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // EMAIL  (requires JWT + tenant isolation)
  // ─────────────────────────────────────────────

  /**
   * Send Email via tenant's configured SendGrid key
   * POST /api/v1/email/send
   * Headers: Authorization: Bearer <jwt>
   * Body: { to, subject, html, tenantId?, replyTo? }
   */
  app.post("/api/v1/email/send", requireJwt, requireJwtTenant, async (req, res) => {
    try {
      const { to, subject, html, tenantId, replyTo } = req.body;

      if (!to || !subject || !html) {
        return res.status(400).json({ success: false, error: "to, subject, html are required" });
      }

      const startMs = Date.now();
      const result = await emailService.send({ to, subject, html, tenantId, replyTo });
      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "email", action: "send", status: result.success ? "success" : "error", durationMs: Date.now() - startMs, error: result.success ? undefined : result.message, data: { to, credentialSource: result.credentialSource } }).catch(() => {});

      log(`[${TAG}] Email sent to ${to} for tenant ${tenantId}`, TAG);

      res.json({ success: result.success, data: { message: result.message } });
    } catch (err: any) {
      log(`[${TAG}] email/send error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // WHATSAPP — Send  (requires JWT + tenant isolation)
  // ─────────────────────────────────────────────

  /**
   * Send a WhatsApp text message
   * POST /api/v1/whatsapp/send
   * Headers: Authorization: Bearer <jwt>
   * Body: { to, message, tenantId? }
   */
  app.post("/api/v1/whatsapp/send", requireJwt, requireJwtTenant, async (req, res) => {
    try {
      const { to, message, tenantId } = req.body;

      if (!to || !message) {
        return res.status(400).json({ success: false, error: "to and message are required" });
      }

      const { whatsappSenderService } = await import("../services/whatsapp-sender.service");
      const startMs = Date.now();
      const result = await whatsappSenderService.sendText({ to, message, tenantId });
      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "whatsapp", action: "send-text", status: "success", durationMs: Date.now() - startMs, data: { to } }).catch(() => {});

      log(`[${TAG}] WhatsApp sent to ${to} for tenant ${tenantId}`, TAG);

      res.json({ success: true, data: result });
    } catch (err: any) {
      logAdapter.emit({ correlationId: req.correlationId, tenantId: req.body?.tenantId, service: "whatsapp", action: "send-text", status: "error", error: err.message }).catch(() => {});
      log(`[${TAG}] whatsapp/send error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: err.message || "INTERNAL_ERROR" });
    }
  });

  /**
   * Send a WhatsApp template message
   * POST /api/v1/whatsapp/send-template
   * Headers: Authorization: Bearer <jwt>
   * Body: { to, templateName, languageCode, components?, tenantId? }
   */
  app.post("/api/v1/whatsapp/send-template", requireJwt, requireJwtTenant, async (req, res) => {
    try {
      const { to, templateName, languageCode, components, tenantId } = req.body;

      if (!to || !templateName || !languageCode) {
        return res.status(400).json({
          success: false,
          error: "to, templateName, languageCode are required",
        });
      }

      const { whatsappSenderService } = await import("../services/whatsapp-sender.service");
      const startMs = Date.now();
      const result = await whatsappSenderService.sendTemplate({
        to,
        templateName,
        languageCode,
        components,
        tenantId,
      });
      logAdapter.emit({ correlationId: req.correlationId, tenantId, service: "whatsapp", action: "send-template", status: "success", durationMs: Date.now() - startMs, data: { to, templateName, languageCode } }).catch(() => {});

      log(`[${TAG}] WhatsApp template '${templateName}' sent to ${to} for tenant ${tenantId}`, TAG);

      res.json({ success: true, data: result });
    } catch (err: any) {
      logAdapter.emit({ correlationId: req.correlationId, tenantId: req.body?.tenantId, service: "whatsapp", action: "send-template", status: "error", error: err.message, data: { templateName: req.body?.templateName } }).catch(() => {});
      log(`[${TAG}] whatsapp/send-template error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: err.message || "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // LOG  (for external apps — CPaaS, Bank, etc.)
  // ─────────────────────────────────────────────

  /**
   * Emit a structured log event from an external application
   * POST /api/v1/log
   * Headers: Authorization: Bearer <jwt>
   * Body: { service, action, status, tenantId?, level?, durationMs?, error?, data? }
   * The correlationId is auto-attached from the request (x-correlation-id header or generated).
   */
  app.post("/api/v1/log", requireJwt, requireJwtTenant, async (req, res) => {
    try {
      const { service, action, status, tenantId, level, durationMs, error, data } = req.body;

      if (!service || !action || !status) {
        return res.status(400).json({ success: false, error: "service, action, status are required" });
      }

      const id = await logAdapter.emit({
        correlationId: req.correlationId,
        tenantId,
        service,
        action,
        status,
        level,
        durationMs,
        error,
        data,
      });

      res.json({ success: true, data: { id, correlationId: req.correlationId } });
    } catch (err: any) {
      log(`[${TAG}] log emit error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // TENANT INFO  (public — no JWT for basic info)
  // ─────────────────────────────────────────────

  /**
   * Get public tenant info by slug (for login screens)
   * GET /api/v1/tenant/:slug
   */
  app.get("/api/v1/tenant/:slug", async (req, res) => {
    try {
      const { TenantModel } = await import("../models/tenant.model");
      const tenant = await TenantModel.findOne({ slug: req.params.slug, active: true });
      if (!tenant) return res.status(404).json({ success: false, error: "TENANT_NOT_FOUND" });

      res.json({
        success: true,
        data: {
          _id: tenant._id,
          nameHe: tenant.nameHe,
          nameEn: tenant.nameEn,
          logo: tenant.logo,
          primaryColor: tenant.primaryColor,
          defaultLanguage: tenant.defaultLanguage,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // ADMIN  (SuperAdmin only)
  // ─────────────────────────────────────────────

  /**
   * List all tenants
   * GET /api/v1/admin/tenants
   * Headers: Authorization: Bearer <jwt>  (role: superadmin)
   */
  app.get(
    "/api/v1/admin/tenants",
    requireJwt,
    requireJwtRole("superadmin"),
    async (_req, res) => {
      try {
        const { tenantService } = await import("../services/tenant.service");
        const tenants = await tenantService.getAll();
        res.json({ success: true, data: tenants });
      } catch (err: any) {
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  );

  /**
   * Create tenant
   * POST /api/v1/admin/tenants
   * Headers: Authorization: Bearer <jwt>  (role: superadmin)
   */
  app.post(
    "/api/v1/admin/tenants",
    requireJwt,
    requireJwtRole("superadmin"),
    async (req, res) => {
      try {
        const { tenantService } = await import("../services/tenant.service");
        const tenant = await tenantService.create(req.body);
        log(`[${TAG}] Tenant created: ${tenant.nameEn}`, TAG);
        res.status(201).json({ success: true, data: tenant });
      } catch (err: any) {
        if (err.code === 11000) {
          return res.status(409).json({ success: false, error: "SLUG_EXISTS" });
        }
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  );

  /**
   * Get single tenant
   * GET /api/v1/admin/tenants/:id
   */
  app.get(
    "/api/v1/admin/tenants/:id",
    requireJwt,
    requireJwtRole("superadmin"),
    async (req, res) => {
      try {
        const { tenantService } = await import("../services/tenant.service");
        const tenant = await tenantService.getById(req.params.id);
        if (!tenant) return res.status(404).json({ success: false, error: "TENANT_NOT_FOUND" });
        res.json({ success: true, data: tenant });
      } catch (err: any) {
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  );

  /**
   * Update tenant
   * PATCH /api/v1/admin/tenants/:id
   */
  app.patch(
    "/api/v1/admin/tenants/:id",
    requireJwt,
    requireJwtRole("superadmin"),
    async (req, res) => {
      try {
        const { tenantService } = await import("../services/tenant.service");
        const tenant = await tenantService.update(req.params.id, req.body);
        if (!tenant) return res.status(404).json({ success: false, error: "TENANT_NOT_FOUND" });
        log(`[${TAG}] Tenant updated: ${req.params.id}`, TAG);
        res.json({ success: true, data: tenant });
      } catch (err: any) {
        if (err.code === 11000) {
          return res.status(409).json({ success: false, error: "SLUG_EXISTS" });
        }
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  );

  /**
   * Toggle tenant active flag
   * PATCH /api/v1/admin/tenants/:id/active
   * Body: { active: boolean }
   */
  app.patch(
    "/api/v1/admin/tenants/:id/active",
    requireJwt,
    requireJwtRole("superadmin"),
    async (req, res) => {
      try {
        const { tenantService } = await import("../services/tenant.service");
        const { active } = req.body;
        if (typeof active !== "boolean")
          return res.status(400).json({ success: false, error: "active (boolean) required" });
        const tenant = await tenantService.update(req.params.id, { active } as any);
        if (!tenant) return res.status(404).json({ success: false, error: "TENANT_NOT_FOUND" });
        log(`[${TAG}] Tenant ${req.params.id} active=${active}`, TAG);
        res.json({ success: true, data: tenant });
      } catch (err: any) {
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
      }
    }
  );

  // ─────────────────────────────────────────────
  // ADMIN — USERS  (SuperAdmin only)
  // ─────────────────────────────────────────────

  const USER_SAFE_FIELDS = "name phone email role tenantId active lastLoginAt isLocked";

  /** GET /api/v1/admin/users?tenantId=&role=&page=&limit= */
  app.get("/api/v1/admin/users", requireJwt, requireJwtRole("superadmin"), async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const { TenantModel } = await import("../models/tenant.model");
      const filter: any = {};
      if (req.query.tenantId) filter.tenantId = req.query.tenantId;
      if (req.query.role) filter.role = req.query.role;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const [users, total] = await Promise.all([
        UserModel.find(filter).select(USER_SAFE_FIELDS).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        UserModel.countDocuments(filter),
      ]);
      const tenantIds = [...new Set(users.map((u: any) => u.tenantId ? String(u.tenantId) : null).filter((id): id is string => !!id && id !== "undefined" && /^[a-f\d]{24}$/i.test(id)))];
      const tenants = await TenantModel.find({ _id: { $in: tenantIds } }).select("nameEn nameHe slug").lean();
      const tenantMap = Object.fromEntries(tenants.map((t: any) => [String(t._id), t]));
      const enriched = users.map((u: any) => ({ ...u, tenant: tenantMap[String(u.tenantId)] || null }));
      res.json({ success: true, data: enriched, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /** POST /api/v1/admin/users */
  app.post("/api/v1/admin/users", requireJwt, requireJwtRole("superadmin"), async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const { name, phone, email, role, tenantId, active } = req.body;
      if (!name || !phone || !email || !role || !tenantId) {
        return res.status(400).json({ success: false, error: "name, phone, email, role, tenantId are required" });
      }
      const user = new UserModel({ name, phone, email, role, tenantId, active: active ?? true });
      await user.save();
      log(`[${TAG}] User created: ${email} (${role}) for tenant ${tenantId}`, TAG);
      res.status(201).json({ success: true, data: user });
    } catch (err: any) {
      if (err.code === 11000) return res.status(409).json({ success: false, error: "DUPLICATE_USER" });
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /** PATCH /api/v1/admin/users/:id */
  app.patch("/api/v1/admin/users/:id", requireJwt, requireJwtRole("superadmin"), async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const { name, phone, email, role, tenantId, active } = req.body;
      const update: any = {};
      if (name !== undefined) update.name = name;
      if (phone !== undefined) update.phone = phone;
      if (email !== undefined) update.email = email;
      if (role !== undefined) update.role = role;
      if (tenantId !== undefined) update.tenantId = tenantId;
      if (active !== undefined) update.active = active;
      const user = await UserModel.findByIdAndUpdate(req.params.id, update, { new: true }).select(USER_SAFE_FIELDS).lean();
      if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
      log(`[${TAG}] User updated: ${req.params.id}`, TAG);
      res.json({ success: true, data: user });
    } catch (err: any) {
      if (err.code === 11000) return res.status(409).json({ success: false, error: "DUPLICATE_USER" });
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /** PATCH /api/v1/admin/users/:id/active  — Body: { active: boolean } */
  app.patch("/api/v1/admin/users/:id/active", requireJwt, requireJwtRole("superadmin"), async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const { active } = req.body;
      if (typeof active !== "boolean") return res.status(400).json({ success: false, error: "active (boolean) required" });
      const user = await UserModel.findByIdAndUpdate(req.params.id, { active }, { new: true }).select(USER_SAFE_FIELDS).lean();
      if (!user) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
      res.json({ success: true, data: user });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // IMPERSONATION  (SuperAdmin only)
  // ─────────────────────────────────────────────

  /**
   * POST /api/v1/admin/impersonate/:userId
   * Issues an impersonation token and returns a one-time code (OTC).
   * The OTC is valid for 30 seconds and can only be used once.
   */
  app.post("/api/v1/admin/impersonate/:userId", requireJwt, requireJwtRole("superadmin"), async (req, res) => {
    try {
      const { UserModel } = await import("../models/user.model");
      const { OTCModel } = await import("../models/otc.model");

      const target = await UserModel.findById(req.params.userId)
        .select("name email role tenantId active").lean();
      if (!target) return res.status(404).json({ success: false, error: "USER_NOT_FOUND" });
      if ((target as any).role === "superadmin") return res.status(403).json({ success: false, error: "CANNOT_IMPERSONATE_SUPERADMIN" });
      if (!(target as any).active) return res.status(400).json({ success: false, error: "USER_INACTIVE" });

      const impersonatorId = req.jwtPayload!.sub;

      const token = jwtService.issueImpersonation({
        targetUserId: String(target._id),
        tenantId: String(target.tenantId),
        role: (target as any).role,
        name: (target as any).name,
        impersonatorId,
      });

      const code = randomUUID();
      await OTCModel.create({ code, token });

      // Log impersonation START through the standard pipeline
      logAdapter.emit({
        correlationId: req.correlationId,
        tenantId: String(target.tenantId),
        service: "impersonation",
        action: "impersonation-start",
        status: "success",
        data: {
          impersonatorId,
          targetUserId: String(target._id),
          targetEmail: (target as any).email,
          targetRole: (target as any).role,
          ip: req.ip,
        },
      }).catch(() => {});

      log(`[${TAG}] Impersonation started: ${impersonatorId} → ${String(target._id)}`, TAG);
      res.json({ success: true, code });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  /**
   * POST /api/v1/auth/exchange-otc
   * Exchanges a one-time code for the impersonation JWT.
   * The code is deleted immediately after use.
   * Body: { code: string }
   */
  app.post("/api/v1/auth/exchange-otc", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ success: false, error: "code required" });
      const { OTCModel } = await import("../models/otc.model");
      const otc = await OTCModel.findOneAndDelete({ code });
      if (!otc) return res.status(401).json({ success: false, error: "INVALID_OR_EXPIRED_CODE" });
      // Application-level expiry check (MongoDB TTL runs every ~60s, not every second)
      if (Date.now() - otc.createdAt.getTime() > 30_000) {
        return res.status(401).json({ success: false, error: "INVALID_OR_EXPIRED_CODE" });
      }
      const payload = jwtService.decode(otc.token);
      res.json({ success: true, token: otc.token, user: payload });
    } catch (err: any) {
      res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ─────────────────────────────────────────────
  // SSO — stubs for future implementation
  // Wire real OAuth 2.0 / OIDC here (passport.js or custom)
  // ─────────────────────────────────────────────

  /**
   * Initiate SSO login — redirect to provider's authorization URL
   * GET /api/v1/auth/sso/:provider   (provider: "microsoft" | "google")
   * TODO: build OAuth2 redirect using provider credentials stored in system_settings
   */
  app.get("/api/v1/auth/sso/:provider", (req, res) => {
    const { provider } = req.params;
    if (!["microsoft", "google"].includes(provider)) {
      return res.status(400).json({ success: false, error: "UNKNOWN_PROVIDER" });
    }
    res.status(501).json({ success: false, error: "SSO_NOT_IMPLEMENTED", provider });
  });

  /**
   * SSO callback — provider redirects here after auth
   * GET /api/v1/auth/sso/:provider/callback
   * TODO: exchange code for tokens, find/create user, issue Engine JWT
   */
  app.get("/api/v1/auth/sso/:provider/callback", (req, res) => {
    const { provider } = req.params;
    res.status(501).json({ success: false, error: "SSO_NOT_IMPLEMENTED", provider });
  });

  log("API Gateway routes registered at /api/v1/*", TAG);
}
