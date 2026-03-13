import axios, { type AxiosInstance } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { TenantModel } from "../models/tenant.model";
import { decryptTenantSensitiveFields } from "./encryption.service";

function createAgentFromUrl(url: string): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(url);
}

export function createProxyAxios(agent?: HttpsProxyAgent<string> | null): AxiosInstance {
  const instance = axios.create(
    agent
      ? {
          httpAgent: agent,
          httpsAgent: agent,
          proxy: false,
        }
      : {}
  );
  return instance;
}

let globalQuotaGuardAgent: HttpsProxyAgent<string> | null = null;

function getGlobalQuotaGuardAgent(): HttpsProxyAgent<string> | null {
  if (globalQuotaGuardAgent) return globalQuotaGuardAgent;
  const qgUrl = process.env.QUOTAGUARDSTATIC_URL;
  if (!qgUrl) return null;
  globalQuotaGuardAgent = new HttpsProxyAgent(qgUrl);
  return globalQuotaGuardAgent;
}

export async function getTenantQuotaGuardAgent(tenantId?: string): Promise<HttpsProxyAgent<string> | null> {
  if (tenantId) {
    try {
      const tenant = await TenantModel.findById(tenantId).lean();
      if (tenant) {
        const decrypted = decryptTenantSensitiveFields(tenant);
        const hasEnabled = !!decrypted.quotaGuardConfig?.enabled;
        const hasUrl = !!decrypted.quotaGuardConfig?.proxyUrl;
        console.log(`[proxy:quotaguard] tenant=${tenantId} config: enabled=${hasEnabled}, hasUrl=${hasUrl}`);
        if (hasEnabled && hasUrl) {
          return createAgentFromUrl(decrypted.quotaGuardConfig.proxyUrl);
        }
      }
    } catch (err: any) {
      console.error(`[proxy:quotaguard] Error fetching tenant ${tenantId}:`, err.message);
    }
  }
  const globalAgent = getGlobalQuotaGuardAgent();
  console.log(`[proxy:quotaguard] Falling back to global: ${globalAgent ? "YES" : "NO (QUOTAGUARDSTATIC_URL not set)"}`);
  return globalAgent;
}

export async function createTenantQuotaGuardAxios(tenantId?: string): Promise<AxiosInstance> {
  const agent = await getTenantQuotaGuardAgent(tenantId);
  return createProxyAxios(agent);
}

export function isQuotaGuardConfigured(): boolean {
  return !!process.env.QUOTAGUARDSTATIC_URL;
}
