import crypto from "crypto";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  name?: string;
  iat: number;
  exp: number;
  iss: string;
}

const ISSUER = "oxs-engine";
const DEFAULT_TTL = 86400;

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET missing or too short");
  return s;
}

function b64url(str: string) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64dec(str: string) {
  const p = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function sign(h: string, p: string, s: string) {
  return crypto.createHmac("sha256", s).update(h + "." + p).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

class JwtService {
  issue(params: { userId: string; tenantId: string; role: string; name?: string; ttlSeconds?: number }) {
    const sec = getSecret();
    const now = Math.floor(Date.now() / 1000);
    const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const pl = b64url(JSON.stringify({
      sub: params.userId, tenantId: params.tenantId, role: params.role,
      name: params.name, iat: now, exp: now + (params.ttlSeconds ?? DEFAULT_TTL), iss: ISSUER,
    }));
    return h + "." + pl + "." + sign(h, pl, sec);
  }

  verify(token: string): JwtPayload {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("JWT_MALFORMED");
    const [h, pl, sig] = parts;
    const sec = getSecret();
    const expected = sign(h, pl, sec);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      throw new Error("JWT_INVALID_SIGNATURE");
    let d: JwtPayload;
    try { d = JSON.parse(b64dec(pl)) as JwtPayload; } catch { throw new Error("JWT_DECODE_ERROR"); }
    if (d.iss !== ISSUER) throw new Error("JWT_WRONG_ISSUER");
    if (Math.floor(Date.now() / 1000) > d.exp) throw new Error("JWT_EXPIRED");
    return d;
  }

  decode(token: string): JwtPayload | null {
    try {
      const p = token.split(".");
      return p.length === 3 ? JSON.parse(b64dec(p[1])) as JwtPayload : null;
    } catch { return null; }
  }
}

export const jwtService = new JwtService();
