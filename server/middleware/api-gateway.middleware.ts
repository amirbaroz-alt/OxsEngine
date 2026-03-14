import { Request, Response, NextFunction } from "express";
import { jwtService, type JwtPayload } from "../services/jwt.service";

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
    }
  }
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
