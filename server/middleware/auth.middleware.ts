import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { authService } from "../services/auth.service";
import { tenantDbManager } from "../lib/db-manager";
import type { IUser } from "../models/user.model";

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      tenantDbConnection?: mongoose.Connection;
    }
  }
}

interface CachedUri {
  uri: string;
  expiresAt: number;
}

const TENANT_URI_CACHE_TTL_MS = 5 * 60 * 1000;
const tenantUriCache = new Map<string, CachedUri>();
const pendingLookups = new Map<string, Promise<string>>();

export function _getTenantUriCache() {
  return tenantUriCache;
}

async function resolveTenantDbUri(tenantId: string): Promise<string> {
  const now = Date.now();
  const cached = tenantUriCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.uri;
  }

  const pending = pendingLookups.get(tenantId);
  if (pending) {
    return pending;
  }

  const lookup = (async () => {
    const { TenantModel } = await import("../models/tenant.model");
    const tenant = await TenantModel.findById(tenantId).select("+tenantDbUri");
    const envDbUrl = process.env.DATABASE_URL;
    const mongoEnvUrl = envDbUrl && envDbUrl.startsWith("mongodb") ? envDbUrl : undefined;
    const uri = tenant?.tenantDbUri || mongoEnvUrl || process.env.MONGODB_URI || "mongodb://localhost:27017/cpaas-platform";

    tenantUriCache.set(tenantId, { uri, expiresAt: Date.now() + TENANT_URI_CACHE_TTL_MS });
    return uri;
  })();

  pendingLookups.set(tenantId, lookup);
  try {
    return await lookup;
  } finally {
    pendingLookups.delete(tenantId);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.substring(7);
  const user = await authService.validateSession(token);

  if (!user) {
    return res.status(401).json({ message: "Invalid or expired session" });
  }

  req.user = user;

  if (user.tenantId) {
    try {
      const dbUri = await resolveTenantDbUri(user.tenantId.toString());
      req.tenantDbConnection = await tenantDbManager.getTenantConnection(user.tenantId.toString(), dbUri);
    } catch (err: any) {
      console.error(`[auth] Failed to get tenant DB connection for ${user.tenantId}: ${err.message}`);
    }
  }

  next();
}

export function requireTenantDb(req: Request, res: Response, next: NextFunction) {
  if (!req.tenantDbConnection) {
    return res.status(503).json({ message: "Tenant database unavailable" });
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (req.user?.tenantId) {
    const userTenantStr = String(req.user.tenantId);
    if (typeof req.user.tenantId !== "string" && typeof req.user.tenantId !== "object") {
      return res.status(401).json({ message: "Invalid session tenantId" });
    }
    if (!mongoose.Types.ObjectId.isValid(userTenantStr)) {
      return res.status(401).json({ message: "Invalid session tenantId" });
    }
  }

  if (req.user?.role === "superadmin") {
    return next();
  }

  const requestedTenantId = req.query.tenantId || req.body?.tenantId;
  if (requestedTenantId && typeof requestedTenantId !== "string") {
    return res.status(400).json({ message: "Invalid tenantId" });
  }
  if (requestedTenantId && !mongoose.Types.ObjectId.isValid(requestedTenantId)) {
    return res.status(400).json({ message: "Invalid tenantId" });
  }

  if (requestedTenantId && requestedTenantId !== req.user?.tenantId?.toString()) {
    return res.status(403).json({ message: "Access denied to this tenant" });
  }

  if (req.user?.tenantId) {
    req.query.tenantId = req.user.tenantId.toString();
  }
  next();
}
