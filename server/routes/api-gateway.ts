import type { Express } from "express";
import { authService } from "../services/auth.service";
import { smsService } from "../services/sms.service";
import { emailService } from "../services/email.service";
import { jwtService } from "../services/jwt.service";
import {
  requireJwt,
  requireJwtRole,
  requireJwtTenant,
} from "../middleware/api-gateway.middleware";
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
      if (!tenantId) {
        return res.status(400).json({ success: false, error: "tenantId is required" });
      }

      const ip = req.ip || "unknown";
      const key = mode === "phone" ? identifier.replace(/[-\s]/g, "") : identifier.toLowerCase();
      if (!rl(`gw-req:${key}`, 5, 10 * 60 * 1000)) {
        return res.status(429).json({ success: false, error: "TOO_MANY_REQUESTS" });
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
        return res.status(401).json({ success: false, error: result.error || "LOGIN_FAILED" });
      }

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

      const result = await authService.verifyLogin(
        identifier,
        mode,
        otp,
        req.headers["user-agent"],
        ip,
        tenantId
      );

      if (!result) {
        return res.status(401).json({ success: false, error: "INVALID_OTP" });
      }

      // Issue JWT — this is the token the external app will use for all future calls
      const jwt = jwtService.issue({
        userId: String(result.user._id),
        tenantId: String(result.user.tenantId),
        role: result.user.role,
        name: result.user.name,
      });

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

      const logEntry = await smsService.sendSms({ recipient, content, tenantId });

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

      const result = await emailService.send({ to, subject, html, tenantId, replyTo });

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
      const result = await whatsappSenderService.sendText({ to, message, tenantId });

      log(`[${TAG}] WhatsApp sent to ${to} for tenant ${tenantId}`, TAG);

      res.json({ success: true, data: result });
    } catch (err: any) {
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
      const result = await whatsappSenderService.sendTemplate({
        to,
        templateName,
        languageCode,
        components,
        tenantId,
      });

      log(`[${TAG}] WhatsApp template '${templateName}' sent to ${to} for tenant ${tenantId}`, TAG);

      res.json({ success: true, data: result });
    } catch (err: any) {
      log(`[${TAG}] whatsapp/send-template error: ${err.message}`, TAG);
      res.status(500).json({ success: false, error: err.message || "INTERNAL_ERROR" });
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

  log("API Gateway routes registered at /api/v1/*", TAG);
}
