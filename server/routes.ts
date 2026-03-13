import type { Express } from "express";
import type { Server } from "http";
import { requireAuth } from "./middleware/auth.middleware";
import { registerAuthRoutes } from "./routes/auth";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import { registerAdminRoutes } from "./routes/admin";
import { registerTenantRoutes } from "./routes/tenants";
import { registerInboxRoutes } from "./routes/inbox";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use("/api", (req, res, next) => {
    const fullPath = req.baseUrl + req.path;
    const publicPrefixes = [
      "/api/auth/",
      "/api/public/",
      "/api/webhooks/",
      "/api/whatsapp/webhook",
      "/api/translations/merged/",
      "/api/webhook/stats",
    ];
    if (publicPrefixes.some((p) => fullPath.startsWith(p))) {
      return next();
    }
    requireAuth(req, res, next);
  });

  registerAuthRoutes(app);
  registerWhatsappRoutes(app);
  registerAdminRoutes(app);
  registerTenantRoutes(app);
  registerInboxRoutes(app);

  return httpServer;
}
