import { Request, Response, NextFunction } from "express";
import { jwtService, type JwtPayload } from "../services/jwt.service";
import { logAdapter, generateCorrelationId } from "../lib/log.adapter";

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
      correlationId: string;
    }
  }
}

export function attachCorrelationId(req: Request, _res: Response, next: NextFunction) {
  req.correlationId = (req.headers["x-correlation-id"] as string) || generateCorrelationId();
  next();
}

export function requireJwt(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer "))
    return res.status(401).json({ success: false, error: "MISSING_TOKEN" });
  try {
    req.jwtPayload = jwtService.verify(h.substring(7));
    next();
  } catch (e: any) {
    return res.status(401).json({ success: false, error: e.message || "JWT_ERROR" });
  }
}

export function requireJwtRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.jwtPayload)
      return res.status(401).json({ success: false, error: "MISSING_TOKEN" });
    if (!roles.includes(req.jwtPayload.role))
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    next();
  };
}

/**
 * Global impersonation audit middleware.
 * Runs on every write request (POST, PUT, PATCH, DELETE) on /api/v1/*.
 * - Blocks DELETE entirely during impersonation.
 * - Emits an audit log entry for every other write via the standard log pipeline.
 */
export function impersonationAudit(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return next();

  const payload = jwtService.decode(h.substring(7));
  if (!payload?.isImpersonated || !payload?.impersonatorId) return next();

  if (req.method === "DELETE") {
    return res.status(403).json({ success: false, error: "IMPERSONATION_CANNOT_DELETE" });
  }

  logAdapter.emit({
    correlationId: req.correlationId,
    tenantId: payload.tenantId,
    service: "impersonation",
    action: `${req.method} ${req.path}`,
    status: "success",
    data: {
      impersonatorId: payload.impersonatorId,
      targetUserId: payload.sub,
      entityId: (req.params as Record<string, string>)?.id ?? null,
      method: req.method,
      path: req.path,
    },
  }).catch(() => {});

  next();
}

export function requireJwtTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.jwtPayload)
    return res.status(401).json({ success: false, error: "MISSING_TOKEN" });
  if (req.jwtPayload.role === "superadmin") return next();
  const requested = req.body?.tenantId || req.query?.tenantId || req.params?.tenantId;
  if (!requested) {
    req.body = req.body || {};
    req.body.tenantId = req.jwtPayload.tenantId;
    return next();
  }
  if (requested !== req.jwtPayload.tenantId)
    return res.status(403).json({ success: false, error: "TENANT_MISMATCH" });
  next();
}
