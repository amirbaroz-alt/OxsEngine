import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { spawn } from "child_process";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const jsonStr = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${jsonStr.length > 500 ? jsonStr.substring(0, 500) + '...[truncated]' : jsonStr}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const { connectDB } = await import("./db");
    const { seedDatabase } = await import("./seed");
    await connectDB();

    const { initSocketServer } = await import("./services/socket.service");
    initSocketServer(httpServer);

    const { startChangeStreamWatcher } = await import("./services/change-stream.service");
    startChangeStreamWatcher().catch((err) => log(`Change stream startup error: ${err.message}`, "changestream"));

    await registerRoutes(httpServer, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("Internal Server Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "127.0.0.1",
      },
      () => {
        log(`serving on port ${port}`);

        const envToken = process.env.WHATSAPP_ACCESS_TOKEN;
        if (envToken && envToken.length > 10) {
          const masked = envToken.slice(0, 5) + "..." + envToken.slice(-5);
          log(`[token-check] WHATSAPP_ACCESS_TOKEN loaded (${envToken.length} chars): ${masked}`, "auth");
        } else if (envToken) {
          log(`[token-check] WHATSAPP_ACCESS_TOKEN present but suspiciously short (${envToken.length} chars)`, "auth");
        } else {
          log("[token-check] WHATSAPP_ACCESS_TOKEN not set — using per-channel DB tokens only", "auth");
        }

        if (process.env.QUOTAGUARDSTATIC_URL) {
          log("Global QuotaGuard proxy configured — outbound requests routed through static IP");
        } else {
          log("No global QuotaGuard proxy — tenants use their own proxy config if set", "info");
        }
      },
    );

    seedDatabase().then(() => {
      log("Seed completed", "seed");
    }).catch((err) => {
      log(`Seed error (non-fatal): ${err}`, "seed");
    });

    (async () => {
      try {
        const { getCustomerModel } = await import("./models/customer.model");
        const { TenantModel } = await import("./models/tenant.model");
        const mongoose = (await import("mongoose")).default;

        const unknownFilter = {
          $or: [
            { firstName: { $regex: /unknown/i } },
            { lastName: { $regex: /unknown/i } },
          ],
          phone: { $exists: true, $nin: [null, ""] },
        };

        async function cleanDb(conn: any, label: string) {
          const CustModel = getCustomerModel(conn);
          const count = await CustModel.countDocuments(unknownFilter);
          if (count === 0) return;
          log(`[DeepClean] Found ${count} customers with UNKNOWN variants in ${label} — fixing...`, "seed");
          const unknowns = await CustModel.find(unknownFilter, { _id: 1, phone: 1, firstName: 1, lastName: 1 }).lean();
          const bulkOps = unknowns.map((c: any) => ({
            updateOne: { filter: { _id: c._id }, update: { $set: { firstName: c.phone, lastName: "" } } },
          }));
          const result = await CustModel.bulkWrite(bulkOps);
          for (const c of unknowns) {
            log(`[DeepClean] Sanitized Customer ID: ${c._id} - Name set to ${c.phone}`, "seed");
          }
          log(`[DeepClean] Fixed ${result.modifiedCount} customers in ${label}.`, "seed");
        }

        await cleanDb(mongoose.connection, "default DB");

        const tenants = await TenantModel.find({}).select("+tenantDbUri").lean();
        for (const t of tenants) {
          const dbUri = (t as any).tenantDbUri || process.env.DATABASE_URL || process.env.MONGODB_URI;
          if (!dbUri) continue;
          try {
            const conn = mongoose.createConnection(dbUri);
            await conn.asPromise();
            await cleanDb(conn, `tenant ${t._id}`);
            await conn.close();
          } catch (_) {}
        }
      } catch (err: any) {
        log(`[DeepClean] Unknown-customer rename failed (non-fatal): ${err.message}`, "seed");
      }
    })();

    const { channelCache } = await import("./services/channel-cache.service");
    channelCache.rebuild().catch((err) => log(`Channel cache init failed (non-fatal): ${err.message}`, "channel"));

    const { startSnoozeWakeJob } = await import("./services/snooze-wake.service");
    startSnoozeWakeJob();

    const { startLogProcessor } = await import("./jobs/log.processor");
    startLogProcessor();

    const { startAlertSyncCron } = await import("./services/audit-alert.service");
    startAlertSyncCron();

    const { tenantDbManager } = await import("./lib/db-manager");
    const mongoose = await import("mongoose");
    const { gracefulShutdown } = await import("./lib/graceful-shutdown");

    const shutdownDeps = { httpServer, tenantDbManager, mongooseInstance: mongoose.default };

    process.on("SIGTERM", () => {
      gracefulShutdown("SIGTERM", shutdownDeps).then(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      gracefulShutdown("SIGINT", shutdownDeps).then(() => process.exit(0));
    });

    try {
      const minioProc = spawn("bash", ["scripts/start-minio.sh"], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      minioProc.stdout?.on("data", (d: Buffer) => { const s = d.toString().trim(); if (s) log(s, "minio"); });
      minioProc.stderr?.on("data", (d: Buffer) => { const s = d.toString().trim(); if (s && !s.includes("WARNING")) log(s, "minio"); });
      minioProc.unref();
      setTimeout(async () => {
        try {
          const { initBucket } = await import("./services/storage.service");
          await initBucket();
        } catch (err: any) {
          log(`MinIO bucket init failed (non-fatal): ${err.message}`, "minio");
        }
      }, 5000);
    } catch (err: any) {
      log(`MinIO startup failed (non-fatal): ${err.message}`, "minio");
    }

  } catch (error) {
    console.error("Fatal startup error:", error);
    process.exit(1);
  }
})();
