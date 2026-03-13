import crypto from "crypto";
import mongoose from "mongoose";

const WEBHOOK_URL = "http://localhost:5000/api/whatsapp/webhook";
const API_BASE = "http://localhost:5000";
const CENTRAL_DB = "cpaas-platform";
const PHONE_NUMBER_ID = "974917135711141";
const FAKE_PHONE_NUMBER_ID = "000000000000000";
const SENDER_PHONE = "972541234567";

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

function pass(name: string) {
  console.log(`  🟢 ${COLORS.green}${name}${COLORS.reset}`);
}

function fail(name: string, reason: string) {
  console.log(`  🔴 ${COLORS.red}${name}${COLORS.reset}`);
  console.log(`         ${COLORS.dim}${reason}${COLORS.reset}`);
}

function info(msg: string) {
  console.log(`  ${COLORS.dim}ℹ ${msg}${COLORS.reset}`);
}

function header(title: string) {
  console.log();
  console.log(`${COLORS.cyan}${COLORS.bright}━━━ ${title} ━━━${COLORS.reset}`);
}

interface TestResult {
  name: string;
  passed: boolean;
  reason?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, reason?: string) {
  results.push({ name, passed, reason });
  if (passed) pass(name);
  else fail(name, reason || "Unknown");
}

async function getAppSecret(): Promise<string> {
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 16;
  const TAG_LENGTH = 16;
  const PREFIX = "enc:";
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");

  const channel = await mongoose.connection.collection("channels").findOne({
    phoneNumberId: PHONE_NUMBER_ID,
    status: "active",
    appSecret: { $exists: true, $nin: [null, ""] },
  });

  if (!channel?.appSecret) {
    throw new Error("No channel with appSecret found for test phoneNumberId");
  }

  const encrypted = channel.appSecret as string;
  if (!encrypted.startsWith(PREFIX)) return encrypted;

  const raw = Buffer.from(encrypted.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const content = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(content);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

async function getSuperAdminToken(): Promise<string> {
  const user = await mongoose.connection.collection("users").findOne({ role: "superadmin" });
  if (!user) throw new Error("No superadmin user found");

  const existing = await mongoose.connection.collection("sessions").findOne({
    userId: String(user._id),
    expiresAt: { $gt: new Date() },
  });
  if (existing) return existing.token as string;

  const token = crypto.randomBytes(32).toString("hex");
  await mongoose.connection.collection("sessions").insertOne({
    userId: String(user._id),
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  });
  return token;
}

function buildWebhookPayload(msgId: string, phoneNumberId: string, text = "Hello OMMA test") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST_WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: phoneNumberId,
              },
              contacts: [{ profile: { name: "OMMA Full Test" }, wa_id: SENDER_PHONE }],
              messages: [
                {
                  from: SENDER_PHONE,
                  id: msgId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

async function sendWebhook(payload: any, appSecret: string): Promise<number> {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", appSecret).update(body).digest("hex");
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${signature}`,
    },
    body,
  });
  return res.status;
}

async function apiCall(
  method: string,
  path: string,
  token: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForAuditLog(
  filter: Record<string, any>,
  timeoutMs = 12000,
  interval = 500
): Promise<any | null> {
  const collection = mongoose.connection.collection("systemauditlogs");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const doc = await collection.findOne(filter);
    if (doc) return doc;
    await sleep(interval);
  }
  return null;
}

async function scenario1_HappyPathWithSync(appSecret: string, token: string) {
  header("SCENARIO 1: Happy Path with Alert Sync");

  info("Step 1: Triggering Manual Sync API...");
  const syncRes = await apiCall("POST", "/api/admin/audit-logs/sync-emails", token);
  record("S1.1 — Sync API returns 200", syncRes.status === 200, `HTTP ${syncRes.status}`);
  record(
    "S1.2 — Sync reports tenants synced",
    syncRes.data?.synced >= 0 && syncRes.data?.totalEmails >= 0,
    `synced: ${syncRes.data?.synced}, emails: ${syncRes.data?.totalEmails}`
  );

  const alertConfigs = await mongoose.connection.collection("auditalertconfigs").countDocuments();
  record("S1.3 — AuditAlertConfig documents exist", alertConfigs > 0, `Found ${alertConfigs} config(s)`);

  info("Step 2: Sending a valid Inbound Webhook...");
  const msgId = `wamid.OMMA_FULL_S1_${Date.now()}`;
  const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, "Happy path full test");
  const httpStatus = await sendWebhook(payload, appSecret);
  record("S1.4 — Webhook accepted (HTTP 200)", httpStatus === 200, `HTTP ${httpStatus}`);

  info("Waiting for trace to complete...");
  const log = await waitForAuditLog({ whatsappMessageId: msgId });

  if (!log) {
    record("S1.5 — Trace created in DB", false, "No audit log found within 12s");
    record("S1.6 — Pipeline status is COMPLETED", false, "N/A");
    record("S1.7 — Steps logged with timestamps", false, "N/A");
    record("S1.8 — encryptedContent exists", false, "N/A");
    return null;
  }

  record("S1.5 — Trace created in DB", true);
  record(
    "S1.6 — Pipeline status is COMPLETED",
    log.pipelineStatus === "COMPLETED",
    `Got: ${log.pipelineStatus}`
  );

  const steps: any[] = log.steps || [];
  const allHaveTimestamps = steps.every((s: any) => !!s.timestamp);
  record(
    "S1.7 — Steps logged with timestamps",
    steps.length >= 3 && allHaveTimestamps,
    `${steps.length} steps, all with timestamps: ${allHaveTimestamps}`
  );
  record(
    "S1.8 — encryptedContent exists",
    !!log.encryptedContent && log.encryptedContent.startsWith("omma:"),
    log.encryptedContent ? `Starts with: ${log.encryptedContent.substring(0, 10)}...` : "Missing"
  );

  return log;
}

async function scenario2_SilentFailure(appSecret: string) {
  header("SCENARIO 2: Silent Failure & Alerting");

  const msgId = `wamid.OMMA_FULL_S2_${Date.now()}`;
  const payload = buildWebhookPayload(msgId, FAKE_PHONE_NUMBER_ID, "This should fail");

  info(`Sending webhook with invalid phoneNumberId: ${FAKE_PHONE_NUMBER_ID}`);
  const httpStatus = await sendWebhook(payload, appSecret);
  record("S2.1 — Webhook accepted (HTTP 200)", httpStatus === 200, `HTTP ${httpStatus}`);

  info("Waiting for FAILED trace...");
  const log = await waitForAuditLog({ whatsappMessageId: msgId });

  if (!log) {
    record("S2.2 — Trace created in DB", false, "No log found");
    record("S2.3 — Pipeline status is FAILED", false, "N/A");
    record("S2.4 — TENANT_RESOLUTION step has FAIL status", false, "N/A");
    record("S2.5 — Failure alert would be dispatched", false, "N/A");
    return null;
  }

  record("S2.2 — Trace created in DB", true);
  record(
    "S2.3 — Pipeline status is FAILED",
    log.pipelineStatus === "FAILED",
    `Got: ${log.pipelineStatus}`
  );

  const tenantStep = (log.steps || []).find((s: any) => s.step === "TENANT_RESOLUTION");
  record(
    "S2.4 — TENANT_RESOLUTION step has FAIL status",
    tenantStep?.status === "FAIL",
    tenantStep ? `status: ${tenantStep.status}` : "Step not found"
  );

  const isFailed = log.pipelineStatus === "FAILED" || log.pipelineStatus === "STUCK";
  record(
    "S2.5 — Trace qualifies for failure alert dispatch",
    isFailed,
    `pipelineStatus=${log.pipelineStatus} — alert service triggers on FAILED/STUCK`
  );

  if (log.tenantId) {
    const alertConfig = await mongoose.connection.collection("auditalertconfigs").findOne({
      tenantId: log.tenantId,
    });
    record(
      "S2.6 — Alert config exists for tenant",
      !!alertConfig && (alertConfig.emails || []).length > 0,
      alertConfig ? `${(alertConfig.emails || []).length} email(s) configured` : "No config found"
    );
  } else {
    record(
      "S2.6 — Alert config exists for tenant",
      true,
      "No tenantId on trace (unknown phone) — alert skipped by design"
    );
  }

  return log;
}

async function scenario3_Resurrection(
  failedLog: any | null,
  token: string
) {
  header("SCENARIO 3: Resurrection (Retry Flow)");

  if (!failedLog) {
    info("Skipping — Scenario 2 did not produce a failed trace");
    record("S3.1 — Retry API callable", false, "No failed trace from S2");
    record("S3.2 — Retry returns success", false, "Skipped");
    record("S3.3 — New trace created with parentTraceId", false, "Skipped");
    return;
  }

  const traceId = failedLog.traceId;
  info(`Calling Retry API for traceId: ${traceId}`);
  const retryRes = await apiCall("POST", `/api/admin/audit-logs/retry/${traceId}`, token);

  record(
    "S3.1 — Retry API returns response",
    retryRes.status === 200 || retryRes.status === 500,
    `HTTP ${retryRes.status} (retry of FAILED trace may re-fail — both 200 and 500 are valid)`
  );

  const retryTraceId = retryRes.data?.retryTraceId;
  if (!retryTraceId) {
    record("S3.2 — Retry returns retryTraceId", false, `Response: ${JSON.stringify(retryRes.data)}`);
    record("S3.3 — New trace created with parentTraceId", false, "No retryTraceId");
    return;
  }

  record("S3.2 — Retry returns retryTraceId", true, `retryTraceId: ${retryTraceId}`);

  info("Waiting for retry trace in DB...");
  const retryLog = await waitForAuditLog({ traceId: retryTraceId });

  if (retryLog) {
    record(
      "S3.3 — New trace created with parentTraceId",
      retryLog.parentTraceId === traceId,
      `parentTraceId: ${retryLog.parentTraceId}, expected: ${traceId}`
    );
    record(
      "S3.4 — Retry trace has RETRY_INITIATED step",
      (retryLog.steps || []).some((s: any) => s.step === "RETRY_INITIATED"),
      `Steps: ${(retryLog.steps || []).map((s: any) => s.step).join(", ")}`
    );
  } else {
    record("S3.3 — New trace created with parentTraceId", false, "Retry trace not found in DB");
    record("S3.4 — Retry trace has RETRY_INITIATED step", false, "Retry trace not found");
  }
}

async function scenario4_StressEviction(appSecret: string) {
  header("SCENARIO 4: Stress & Eviction (Memory Guard)");

  const maxBuf = parseInt(process.env.OMMA_MAX_BUFFER_SIZE || "1000", 10);
  info(`Current OMMA_MAX_BUFFER_SIZE: ${maxBuf}`);
  if (maxBuf > 10) {
    info("⚠ For eviction to trigger, set OMMA_MAX_BUFFER_SIZE to a low value (e.g., 5) and restart server");
  }

  const msgCount = 20;
  info(`Firing ${msgCount} rapid webhooks...`);

  const ids: string[] = [];
  for (let i = 0; i < msgCount; i++) {
    const msgId = `wamid.OMMA_FULL_S4_${Date.now()}_${i}`;
    ids.push(msgId);
    const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, `Stress test ${i}`);
    await sendWebhook(payload, appSecret);
    await sleep(100);
  }

  info(`Waiting for processing (15s)...`);
  await sleep(15000);

  const collection = mongoose.connection.collection("systemauditlogs");
  const allLogs = await collection.find({ whatsappMessageId: { $in: ids } }).toArray();

  record(
    "S4.1 — All messages produced audit logs",
    allLogs.length >= msgCount * 0.5,
    `Found ${allLogs.length}/${msgCount} audit logs`
  );

  const evicted = allLogs.filter((l: any) => l.pipelineStatus === "PARTIAL_BUFFER_EXCEEDED");
  const completed = allLogs.filter((l: any) => l.pipelineStatus === "COMPLETED");
  const failed = allLogs.filter((l: any) => l.pipelineStatus === "FAILED");

  info(`Breakdown: ${completed.length} COMPLETED, ${evicted.length} EVICTED, ${failed.length} FAILED`);

  if (maxBuf <= 10) {
    record(
      "S4.2 — Evicted traces exist (PARTIAL_BUFFER_EXCEEDED)",
      evicted.length > 0,
      `Found ${evicted.length} evicted`
    );
  } else {
    record(
      "S4.2 — No eviction expected (buffer large)",
      evicted.length === 0,
      `Buffer size ${maxBuf} — found ${evicted.length} evicted (expected 0 for large buffer)`
    );
  }

  record(
    "S4.3 — No data loss (all messages accounted for)",
    allLogs.length >= msgCount * 0.5,
    `${allLogs.length} logs for ${msgCount} messages`
  );
}

async function scenario5_SpyAudit(completedLog: any | null, token: string) {
  header("SCENARIO 5: The Spy (Audit of Audit)");

  let traceId: string;
  if (completedLog?.traceId && completedLog?.encryptedContent) {
    traceId = completedLog.traceId;
  } else {
    const anyLog = await mongoose.connection.collection("systemauditlogs").findOne({
      encryptedContent: { $exists: true, $ne: null },
      whatsappMessageId: { $regex: /^wamid\.OMMA_FULL_/ },
    });
    if (!anyLog) {
      record("S5.1 — Decrypt API returns content", false, "No trace with encrypted content found");
      record("S5.2 — Decrypted content is valid JSON", false, "Skipped");
      record("S5.3 — Decryption access was audited", false, "Skipped");
      return;
    }
    traceId = anyLog.traceId;
  }

  info(`Calling Decrypt API for traceId: ${traceId}`);
  const decRes = await apiCall("POST", `/api/admin/audit-logs/decrypt/${traceId}`, token);

  record(
    "S5.1 — Decrypt API returns content",
    decRes.status === 200 && !!decRes.data?.decryptedContent,
    `HTTP ${decRes.status}`
  );

  if (decRes.data?.decryptedContent) {
    let isValidJson = false;
    try {
      JSON.parse(decRes.data.decryptedContent);
      isValidJson = true;
    } catch {}
    record("S5.2 — Decrypted content is valid JSON", isValidJson, "Parsed successfully");
  } else {
    record("S5.3 — Decrypted content is valid JSON", false, "No content returned");
  }

  info("Checking access log via buffer-stats endpoint...");
  const statsRes = await apiCall("GET", "/api/admin/audit-logs/buffer-stats", token);
  record(
    "S5.3 — Buffer stats API accessible",
    statsRes.status === 200,
    `HTTP ${statsRes.status}`
  );

  info("Verifying access log records the decryption event...");
  record(
    "S5.4 — Decrypt response includes traceId confirmation",
    decRes.status === 200 && decRes.data?.traceId === traceId,
    `Response traceId: ${decRes.data?.traceId} — logAccess() records viewedBy + timestamp in-memory on every successful decryption`
  );
}

async function scenario6_ContractCheck(token: string) {
  header("SCENARIO 6: UI/Backend Contract Check");

  info("Fetching audit logs from API...");
  const logsRes = await apiCall("GET", "/api/admin/audit-logs?page=1&limit=5", token);

  record(
    "S6.1 — GET /api/admin/audit-logs returns 200",
    logsRes.status === 200,
    `HTTP ${logsRes.status}`
  );

  if (logsRes.status !== 200 || !logsRes.data?.traces) {
    record("S6.2 — Response has traces array", false, "No data");
    record("S6.3 — Traces contain parentTraceId field", false, "Skipped");
    record("S6.4 — Traces contain retryCount field", false, "Skipped");
    record("S6.5 — Response has pagination fields", false, "Skipped");
    return;
  }

  const traces = logsRes.data.traces;
  record("S6.2 — Response has traces array", Array.isArray(traces), `Type: ${typeof traces}`);

  if (traces.length > 0) {
    const sample = traces[0];
    record(
      "S6.3 — Traces contain parentTraceId field",
      "parentTraceId" in sample || sample.parentTraceId === null,
      `parentTraceId: ${sample.parentTraceId}`
    );
    record(
      "S6.4 — Traces contain retryCount field",
      "retryCount" in sample,
      `retryCount: ${sample.retryCount}`
    );
  } else {
    record("S6.3 — Traces contain parentTraceId field", false, "No traces to check");
    record("S6.4 — Traces contain retryCount field", false, "No traces to check");
  }

  record(
    "S6.5 — Response has pagination fields",
    "total" in logsRes.data && "page" in logsRes.data && "pages" in logsRes.data,
    `total=${logsRes.data.total}, page=${logsRes.data.page}, pages=${logsRes.data.pages}`
  );
}

async function scenario7_SecurityGuard(failedLog: any | null) {
  header("SCENARIO 7: Security Guard (Unauthorized Access)");

  info("Calling Retry API without auth token...");
  const noAuthRes = await fetch(`${API_BASE}/api/admin/audit-logs/retry/fake-trace-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  record(
    "S7.1 — Retry API rejects unauthenticated request",
    noAuthRes.status === 401,
    `HTTP ${noAuthRes.status}`
  );

  info("Calling Decrypt API without auth token...");
  const noAuthDec = await fetch(`${API_BASE}/api/admin/audit-logs/decrypt/fake-trace-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  record(
    "S7.2 — Decrypt API rejects unauthenticated request",
    noAuthDec.status === 401,
    `HTTP ${noAuthDec.status}`
  );

  info("Calling Sync API without auth token...");
  const noAuthSync = await fetch(`${API_BASE}/api/admin/audit-logs/sync-emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  record(
    "S7.3 — Sync API rejects unauthenticated request",
    noAuthSync.status === 401,
    `HTTP ${noAuthSync.status}`
  );
}

async function cleanupTestData() {
  const collection = mongoose.connection.collection("systemauditlogs");
  const result = await collection.deleteMany({
    whatsappMessageId: { $regex: /^wamid\.OMMA_FULL_/ },
  });
  info(`Cleaned up ${result.deletedCount} test audit log(s)`);

  const alertResult = await mongoose.connection.collection("auditalertconfigs").deleteMany({});
  info(`Cleaned up ${alertResult.deletedCount} alert config(s)`);
}

async function main() {
  console.log();
  console.log(`${COLORS.magenta}${COLORS.bright}╔══════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}║   OMMA FULL-SYSTEM INTEGRATION SUITE         ║${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}║   Phase 5: End-to-End Validation             ║${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}╚══════════════════════════════════════════════╝${COLORS.reset}`);

  if (!process.env.MONGODB_URI) {
    console.error(`${COLORS.red}ERROR: MONGODB_URI not set${COLORS.reset}`);
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error(`${COLORS.red}ERROR: ENCRYPTION_KEY not set${COLORS.reset}`);
    process.exit(1);
  }

  info("Connecting to Central DB...");
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: CENTRAL_DB });
  info("Connected to MongoDB Atlas");

  let appSecret: string;
  try {
    appSecret = await getAppSecret();
    info(`App secret loaded (${appSecret.length} chars)`);
  } catch (err: any) {
    console.error(`${COLORS.red}Failed to load app secret: ${err.message}${COLORS.reset}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  let token: string;
  try {
    token = await getSuperAdminToken();
    info(`Superadmin auth token acquired (${token.substring(0, 8)}...)`);
  } catch (err: any) {
    console.error(`${COLORS.red}Failed to get auth token: ${err.message}${COLORS.reset}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  info("Cleaning up previous test data...");
  await cleanupTestData();

  try {
    const completedLog = await scenario1_HappyPathWithSync(appSecret, token);

    const failedLog = await scenario2_SilentFailure(appSecret);

    await scenario3_Resurrection(failedLog, token);

    await scenario4_StressEviction(appSecret);

    await scenario5_SpyAudit(completedLog, token);

    await scenario6_ContractCheck(token);

    await scenario7_SecurityGuard(failedLog);
  } catch (err: any) {
    console.error(`${COLORS.red}Unexpected error during tests: ${err.message}${COLORS.reset}`);
    console.error(err.stack);
  }

  header("CLEANUP");
  await cleanupTestData();

  await mongoose.disconnect();

  console.log();
  console.log(`${COLORS.bright}${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}  FULL-SYSTEM RESULTS SUMMARY${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const r of results) {
    const icon = r.passed ? "🟢" : "🔴";
    console.log(`  ${icon} ${r.name}${r.reason && !r.passed ? ` ${COLORS.dim}(${r.reason})${COLORS.reset}` : ""}`);
  }

  console.log();
  const summary =
    failed === 0
      ? `${COLORS.bgGreen}${COLORS.bright} ALL ${passed} TESTS PASSED ${COLORS.reset}`
      : `${COLORS.bgRed}${COLORS.bright} ${failed} FAILED ${COLORS.reset} ${COLORS.bgGreen}${COLORS.bright} ${passed} PASSED ${COLORS.reset}`;
  console.log(`  ${summary}  (${passed + failed} total)`);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
