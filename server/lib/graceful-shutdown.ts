import type { Server } from "http";
import type mongoose from "mongoose";
import { log } from "../index";

export interface ShutdownDeps {
  httpServer: Server;
  tenantDbManager: { closeAll(): Promise<void> };
  mongooseInstance: typeof mongoose;
}

let isShuttingDown = false;

export function resetShutdownState() {
  isShuttingDown = false;
}

export async function gracefulShutdown(signal: string, deps: ShutdownDeps): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`${signal} received — starting graceful shutdown`, "shutdown");

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    try {
      deps.httpServer.close(() => {
        log("HTTP server closed — no new connections accepted", "shutdown");
        done();
      });
    } catch {
      done();
    }

    const timer = setTimeout(() => {
      log("Shutdown timeout reached — forcing close", "shutdown");
      done();
    }, 5000);
    if (timer.unref) timer.unref();
  });

  try {
    await deps.tenantDbManager.closeAll();
    log("All tenant DB connections closed", "shutdown");
  } catch (err: any) {
    log(`Error closing tenant connections: ${err.message}`, "shutdown");
  }

  try {
    await deps.mongooseInstance.disconnect();
    log("Central MongoDB disconnected", "shutdown");
  } catch (err: any) {
    log(`Error disconnecting central DB: ${err.message}`, "shutdown");
  }

  log("Graceful shutdown complete", "shutdown");
}
