#!/bin/bash
set -e

echo "🚀 Setting up API Gateway files..."

# ── 1. logger.ts ──────────────────────────────────────────────────────────────
mkdir -p server/lib
node -e "
const fs = require('fs');
fs.writeFileSync('server/lib/logger.ts', \`export function log(message: string, source = \"server\") {
  const t = new Date().toLocaleTimeString(\"en-US\", { hour: \"numeric\", minute: \"2-digit\", second: \"2-digit\", hour12: true });
  console.log(\\\`\\\${t} [\\\${source}] \\\${message}\\\`);
}
\`);
console.log('✓ server/lib/logger.ts');
"

# ── 2. jwt.service.ts ─────────────────────────────────────────────────────────
node -e "
const fs = require('fs');
fs.writeFileSync('server/services/jwt.service.ts', \`import crypto from \"crypto\";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  name?: string;
  iat: number;
  exp: number;
  iss: string;
}

const ISSUER = \"oxs-engine\";
const DEFAULT_TTL = 86400;

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error(\"JWT_SECRET missing or too short\");
  return s;
}

function b64url(str: string) {
  return Buffer.from(str).toString(\"base64\").replace(/\\\\+/g, \"-\").replace(/\\\\//g, \"_\").replace(/=/g, \"\");
}

function b64dec(str: string) {
  const p = str + \"=\".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(p.replace(/-/g, \"+\").replace(/_/g, \"/\"), \"base64\").toString(\"utf8\");
}

function sign(h: string, p: string, s: string) {
  return crypto.createHmac(\"sha256\", s).update(h + \".\" + p).digest(\"base64\")
    .replace(/\\\\+/g, \"-\").replace(/\\\\//g, \"_\").replace(/=/g, \"\");
}

class JwtService {
  issue(params: { userId: string; tenantId: string; role: string; name?: string; ttlSeconds?: number }) {
    const sec = getSecret();
    const now = Math.floor(Date.now() / 1000);
    const h = b64url(JSON.stringify({ alg: \"HS256\", typ: \"JWT\" }));
    const pl = b64url(JSON.stringify({
      sub: params.userId, tenantId: params.tenantId, role: params.role,
      name: params.name, iat: now, exp: now + (params.ttlSeconds ?? DEFAULT_TTL), iss: ISSUER,
    }));
    return h + \".\" + pl + \".\" + sign(h, pl, sec);
  }

  verify(token: string): JwtPayload {
    const parts = token.split(\".\");
    if (parts.length !== 3) throw new Error(\"JWT_MALFORMED\");
    const [h, pl, sig] = parts;
    const sec = getSecret();
    const expected = sign(h, pl, sec);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      throw new Error(\"JWT_INVALID_SIGNATURE\");
    let d: JwtPayload;
    try { d = JSON.parse(b64dec(pl)) as JwtPayload; } catch { throw new Error(\"JWT_DECODE_ERROR\"); }
    if (d.iss !== ISSUER) throw new Error(\"JWT_WRONG_ISSUER\");
    if (Math.floor(Date.now() / 1000) > d.exp) throw new Error(\"JWT_EXPIRED\");
    return d;
  }

  decode(token: string): JwtPayload | null {
    try {
      const p = token.split(\".\");
      return p.length === 3 ? JSON.parse(b64dec(p[1])) as JwtPayload : null;
    } catch { return null; }
  }
}

export const jwtService = new JwtService();
\`);
console.log('✓ server/services/jwt.service.ts');
"

# ── 3. api-gateway.middleware.ts ──────────────────────────────────────────────
node -e "
const fs = require('fs');
fs.writeFileSync('server/middleware/api-gateway.middleware.ts', \`import { Request, Response, NextFunction } from \"express\";
import { jwtService, type JwtPayload } from \"../services/jwt.service\";

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
    }
  }
}

export function requireJwt(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith(\"Bearer \"))
    return res.status(401).json({ success: false, error: \"MISSING_TOKEN\" });
  try {
    req.jwtPayload = jwtService.verify(h.substring(7));
    next();
  } catch (e: any) {
    return res.status(401).json({ success: false, error: e.message || \"JWT_ERROR\" });
  }
}

export function requireJwtRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.jwtPayload)
      return res.status(401).json({ success: false, error: \"MISSING_TOKEN\" });
    if (!roles.includes(req.jwtPayload.role))
      return res.status(403).json({ success: false, error: \"FORBIDDEN\" });
    next();
  };
}

export function requireJwtTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.jwtPayload)
    return res.status(401).json({ success: false, error: \"MISSING_TOKEN\" });
  if (req.jwtPayload.role === \"superadmin\") return next();
  const requested = req.body?.tenantId || req.query?.tenantId || req.params?.tenantId;
  if (!requested) {
    req.body = req.body || {};
    req.body.tenantId = req.jwtPayload.tenantId;
    return next();
  }
  if (requested !== req.jwtPayload.tenantId)
    return res.status(403).json({ success: false, error: \"TENANT_MISMATCH\" });
  next();
}
\`);
console.log('✓ server/middleware/api-gateway.middleware.ts');
"

# ── 4. api-gateway.ts (routes) ────────────────────────────────────────────────
mkdir -p server/routes
node write-api-gateway.js

# ── 5. Fix logger imports in all services ─────────────────────────────────────
node -e "
const fs = require('fs');
const dir = 'server/services';
let n = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
  const p = dir + '/' + f;
  const c = fs.readFileSync(p, 'utf8');
  const c2 = c.replace(/import \{ log \} from \"\.\.\/index\"/g, 'import { log } from \"../lib/logger\"');
  if (c !== c2) { fs.writeFileSync(p, c2); console.log('  fixed import: ' + f); n++; }
}
console.log('✓ Fixed logger imports in ' + n + ' services');
"

# ── 6. Fix routes.ts ──────────────────────────────────────────────────────────
node -e "
const fs = require('fs');
let c = fs.readFileSync('server/routes.ts', 'utf8');
if (!c.includes('api-gateway')) {
  c = c.replace(
    'import { registerInboxRoutes } from \"./routes/inbox\";',
    'import { registerInboxRoutes } from \"./routes/inbox\";\nimport { registerApiGatewayRoutes } from \"./routes/api-gateway\";'
  );
  c = c.replace(
    '\"/api/webhook/stats\",',
    '\"/api/webhook/stats\",\n      \"/api/v1/\",         // API Gateway'
  );
  c = c.replace(
    'registerInboxRoutes(app);',
    'registerInboxRoutes(app);\n  registerApiGatewayRoutes(app);'
  );
  fs.writeFileSync('server/routes.ts', c);
  console.log('✓ server/routes.ts updated');
} else {
  console.log('✓ server/routes.ts already has api-gateway');
}
"

echo ""
echo "✅ Done! Now run: npm run dev"
echo "   Expected: [api-gateway] API Gateway routes registered at /api/v1/*"
