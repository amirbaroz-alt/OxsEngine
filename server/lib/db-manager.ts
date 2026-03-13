import mongoose from "mongoose";
import { log } from "../index";

const TENANT_POOL_MAX = 10;
const TENANT_POOL_MIN = 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;

interface CachedConnection {
  connection: mongoose.Connection;
  lastUsed: number;
  tenantId: string;
  dbUri: string;
}

class TenantDbManager {
  private connectionCache = new Map<string, CachedConnection>();
  private pendingConnections = new Map<string, Promise<mongoose.Connection>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  async getTenantConnection(tenantId: string, dbUri: string): Promise<mongoose.Connection> {
    const cached = this.connectionCache.get(tenantId);

    if (cached && cached.connection.readyState === 1) {
      if (cached.dbUri !== dbUri) {
        log(`URI change detected for tenant ${tenantId} — rotating connection`, "db-manager");
        this.connectionCache.delete(tenantId);
        cached.connection.close().catch(() => {});
      } else {
        cached.lastUsed = Date.now();
        return cached.connection;
      }
    }

    const pending = this.pendingConnections.get(tenantId);
    if (pending) {
      return pending;
    }

    if (cached && cached.connection.readyState !== 1) {
      this.connectionCache.delete(tenantId);
      cached.connection.close().catch(() => {});
      log(`Removed stale connection for tenant ${tenantId}`, "db-manager");
    }

    const connectionPromise = this.establishConnection(tenantId, dbUri);
    this.pendingConnections.set(tenantId, connectionPromise);

    try {
      const connection = await connectionPromise;
      return connection;
    } catch (err) {
      this.connectionCache.delete(tenantId);
      throw err;
    } finally {
      this.pendingConnections.delete(tenantId);
    }
  }

  private async establishConnection(tenantId: string, dbUri: string): Promise<mongoose.Connection> {
    await this.evictLRU();

    const connection = mongoose.createConnection(dbUri, {
      maxPoolSize: TENANT_POOL_MAX,
      minPoolSize: TENANT_POOL_MIN,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      retryWrites: true,
      w: "majority",
    });

    connection.on("connected", () => {
      log(`Tenant DB connected: ${tenantId}`, "db-manager");
    });
    connection.on("disconnected", () => {
      log(`Tenant DB disconnected: ${tenantId}`, "db-manager");
    });
    connection.on("error", (err) => {
      log(`Tenant DB error (${tenantId}): ${err.message}`, "db-manager");
    });

    await connection.asPromise();

    this.connectionCache.set(tenantId, {
      connection,
      lastUsed: Date.now(),
      tenantId,
      dbUri,
    });

    log(`Tenant DB connection established: ${tenantId} (total cached: ${this.connectionCache.size})`, "db-manager");
    return connection;
  }

  private async evictLRU(): Promise<void> {
    while (this.connectionCache.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, cached] of this.connectionCache) {
        if (cached.lastUsed < oldestTime) {
          oldestTime = cached.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        const evicted = this.connectionCache.get(oldestKey);
        this.connectionCache.delete(oldestKey);
        if (evicted) {
          evicted.connection.close().catch(() => {});
          log(`LRU evicted tenant DB connection: ${oldestKey} (cache was at ${MAX_CACHE_SIZE})`, "db-manager");
        }
      } else {
        break;
      }
    }
  }

  getMaxCacheSize(): number {
    return MAX_CACHE_SIZE;
  }

  private startCleanupInterval(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, CLEANUP_INTERVAL_MS);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [tenantId, cached] of this.connectionCache) {
      if (now - cached.lastUsed > IDLE_TIMEOUT_MS) {
        toRemove.push(tenantId);
      }
    }

    for (const tenantId of toRemove) {
      const cached = this.connectionCache.get(tenantId);
      if (cached) {
        try {
          await cached.connection.close();
          log(`Closed idle tenant DB connection: ${tenantId}`, "db-manager");
        } catch (err: any) {
          log(`Error closing idle connection for ${tenantId}: ${err.message}`, "db-manager");
        }
        this.connectionCache.delete(tenantId);
      }
    }

    if (toRemove.length > 0) {
      log(`Cleaned up ${toRemove.length} idle tenant DB connection(s) (remaining: ${this.connectionCache.size})`, "db-manager");
    }
  }

  hasConnection(tenantId: string): boolean {
    const cached = this.connectionCache.get(tenantId);
    return !!cached && cached.connection.readyState === 1;
  }

  getActiveConnectionCount(): number {
    return this.connectionCache.size;
  }

  /** @internal Exposed for testing — triggers idle connection cleanup immediately */
  async _runCleanup(): Promise<void> {
    await this.cleanupIdleConnections();
  }

  /** @internal Exposed for testing — directly access cached entry for assertions */
  _getCachedEntry(tenantId: string): CachedConnection | undefined {
    return this.connectionCache.get(tenantId);
  }

  async checkHealth(tenantId: string): Promise<{ healthy: boolean; latencyMs: number; readyState: number; error?: string }> {
    const cached = this.connectionCache.get(tenantId);
    if (!cached) {
      return { healthy: false, latencyMs: -1, readyState: -1, error: "No cached connection for tenant" };
    }

    if (cached.connection.readyState !== 1) {
      return { healthy: false, latencyMs: -1, readyState: cached.connection.readyState, error: `Connection readyState: ${cached.connection.readyState}` };
    }

    if (!cached.connection.db) {
      return { healthy: false, latencyMs: -1, readyState: cached.connection.readyState, error: "Connection db handle not available" };
    }

    const start = Date.now();
    try {
      const pingPromise = cached.connection.db.admin().ping();
      const timeoutPromise = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error("Ping timed out after 5000ms")), 5000);
        if (t.unref) t.unref();
      });
      await Promise.race([pingPromise, timeoutPromise]);
      const latencyMs = Date.now() - start;
      return { healthy: true, latencyMs, readyState: 1 };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, readyState: cached.connection.readyState, error: err.message };
    }
  }

  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [tenantId, cached] of this.connectionCache) {
      promises.push(
        cached.connection.close().then(() => {
          log(`Closed tenant DB connection: ${tenantId}`, "db-manager");
        }).catch((err: any) => {
          log(`Error closing connection for ${tenantId}: ${err.message}`, "db-manager");
        })
      );
    }
    await Promise.all(promises);
    this.connectionCache.clear();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    log("All tenant DB connections closed", "db-manager");
  }
}

export const tenantDbManager = new TenantDbManager();
