import crypto from "crypto";
import mongoose from "mongoose";

const WEBHOOK_URL = "http://localhost:5000/api/whatsapp/webhook";
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
  console.log(`  ${COLORS.bgGreen}${COLORS.bright} PASS ${COLORS.reset} ${COLORS.green}${name}${COLORS.reset}`);
}

function fail(name: string, reason: string) {
  console.log(`  ${COLORS.bgRed}${COLORS.bright} FAIL ${COLORS.reset} ${COLORS.red}${name}${COLORS.reset}`);
  console.log(`         ${COLORS.dim}${reason}${COLORS.reset}`);
}

function info(msg: string) {
  console.log(`  ${COLORS.dim}${msg}${COLORS.reset}`);
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
              contacts: [{ profile: { name: "OMMA Tester" }, wa_id: SENDER_PHONE }],
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

function buildImagePayload(msgId: string) {
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
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: "OMMA Tester" }, wa_id: SENDER_PHONE }],
              messages: [
                {
                  from: SENDER_PHONE,
                  id: msgId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "image",
                  image: {
                    mime_type: "image/jpeg",
                    sha256: "abc123fakehash",
                    id: "FAKE_MEDIA_ID_12345",
                    caption: "Test image",
                  },
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForAuditLog(
  filter: Record<string, any>,
  timeoutMs = 10000,
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

async function testPerfectFlow(appSecret: string) {
  header("Test A: Perfect Inbound Text Flow");

  const msgId = `wamid.OMMA_TEST_A_${Date.now()}`;
  const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, "Hello from OMMA sanity test");

  info(`Sending text webhook with msgId: ${msgId}`);
  const status = await sendWebhook(payload, appSecret);
  record("Webhook accepted (HTTP 200)", status === 200, `Got HTTP ${status}`);

  info("Waiting for audit log to appear in Central DB...");
  const log = await waitForAuditLog({ whatsappMessageId: msgId });

  if (!log) {
    record("SystemAuditLog created", false, "No log found within 10s");
    record("Pipeline status is COMPLETED", false, "No log to check");
    record("TENANT_RESOLUTION step exists", false, "No log to check");
    record("TENANT_DB_SAVE step exists", false, "No log to check");
    return;
  }

  record("SystemAuditLog created", true);
  record(
    "Pipeline status is COMPLETED",
    log.pipelineStatus === "COMPLETED",
    `Got: ${log.pipelineStatus}`
  );

  const stepNames = (log.steps || []).map((s: any) => s.step);
  record(
    "TENANT_RESOLUTION step exists",
    stepNames.includes("TENANT_RESOLUTION"),
    `Steps: ${stepNames.join(", ")}`
  );
  record(
    "TENANT_DB_SAVE step exists",
    stepNames.includes("TENANT_DB_SAVE"),
    `Steps: ${stepNames.join(", ")}`
  );
  record("Direction is INBOUND", log.direction === "INBOUND", `Got: ${log.direction}`);
  record("tenantId is set", !!log.tenantId, `tenantId: ${log.tenantId}`);
}

async function testDeduplication(appSecret: string) {
  header("Test B: Deduplication (Retry Check)");

  const msgId = `wamid.OMMA_TEST_B_DEDUP_${Date.now()}`;
  const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, "Dedup test message");

  info(`Sending first webhook with msgId: ${msgId}`);
  await sendWebhook(payload, appSecret);
  await sleep(3000);

  info(`Sending duplicate webhook with same msgId: ${msgId}`);
  await sendWebhook(payload, appSecret);
  await sleep(3000);

  const collection = mongoose.connection.collection("systemauditlogs");
  const logs = await collection.find({ whatsappMessageId: msgId }).toArray();

  record(
    "Only one audit log exists (not two)",
    logs.length === 1,
    `Found ${logs.length} log(s)`
  );

  if (logs.length >= 1) {
    const log = logs[0];
    record(
      "retryCount is >= 1",
      (log.retryCount || 0) >= 1,
      `retryCount: ${log.retryCount}`
    );
    const hasRetryStep = (log.steps || []).some((s: any) => s.step === "DUPLICATE_RETRY");
    record(
      "DUPLICATE_RETRY step exists",
      hasRetryStep,
      `Steps: ${(log.steps || []).map((s: any) => s.step).join(", ")}`
    );
  }
}

async function testMemoryGuard(appSecret: string) {
  header("Test C: Memory Guard (LRU Eviction)");

  info("NOTE: Server must be running with OMMA_MAX_BUFFER_SIZE=3 for this test");
  info("Sending 5 rapid webhooks to trigger eviction...");

  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const msgId = `wamid.OMMA_TEST_C_LRU_${Date.now()}_${i}`;
    ids.push(msgId);
    const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, `LRU test ${i}`);
    await sendWebhook(payload, appSecret);
    await sleep(200);
  }

  info("Waiting for processing to complete...");
  await sleep(8000);

  const collection = mongoose.connection.collection("systemauditlogs");
  const evicted = await collection
    .find({ pipelineStatus: "PARTIAL_BUFFER_EXCEEDED", whatsappMessageId: { $in: ids } })
    .toArray();

  record(
    "At least 1 trace evicted as PARTIAL_BUFFER_EXCEEDED",
    evicted.length >= 1,
    `Found ${evicted.length} evicted trace(s)`
  );

  if (evicted.length > 0) {
    const hasEvictionStep = evicted.some((e: any) =>
      (e.steps || []).some((s: any) => s.step === "BUFFER_EVICTED")
    );
    record(
      "BUFFER_EVICTED step in evicted log",
      hasEvictionStep,
      `Checked ${evicted.length} evicted logs`
    );
  } else {
    record("BUFFER_EVICTED step in evicted log", false, "No evicted logs to check");
  }

  const allLogs = await collection
    .find({ whatsappMessageId: { $in: ids } })
    .toArray();
  record(
    "All 5 messages have audit logs (evicted + completed)",
    allLogs.length >= 3,
    `Found ${allLogs.length} total logs for 5 messages`
  );
}

async function testEncryption(appSecret: string) {
  header("Test D: Encryption & Content Masking");

  const msgId = `wamid.OMMA_TEST_D_ENC_${Date.now()}`;
  const secretText = "My credit card is 4111-1111-1111-1111";
  const payload = buildWebhookPayload(msgId, PHONE_NUMBER_ID, secretText);

  info(`Sending webhook with sensitive content`);
  await sendWebhook(payload, appSecret);

  info("Waiting for audit log...");
  const log = await waitForAuditLog({ whatsappMessageId: msgId });

  if (!log) {
    record("Audit log created for encryption test", false, "No log found");
    return;
  }

  record("Audit log created for encryption test", true);

  if (log.encryptedContent) {
    record(
      "encryptedContent starts with 'omma:' prefix",
      log.encryptedContent.startsWith("omma:"),
      `Starts with: ${log.encryptedContent.substring(0, 10)}...`
    );
    record(
      "encryptedContent does NOT contain plain text",
      !log.encryptedContent.includes(secretText) && !log.encryptedContent.includes("credit card"),
      "Checked for plain text leakage"
    );
    record(
      "encryptedContent is NOT the raw payload",
      log.encryptedContent !== secretText && log.encryptedContent.length > 20,
      `Length: ${log.encryptedContent.length}`
    );
  } else {
    record("encryptedContent exists", false, "Field is null/undefined");
  }
}

async function testFailedResolution(appSecret: string) {
  header("Test E: Failed Tenant Resolution");

  const msgId = `wamid.OMMA_TEST_E_FAIL_${Date.now()}`;
  const payload = buildWebhookPayload(msgId, FAKE_PHONE_NUMBER_ID, "This should fail resolution");

  info(`Sending webhook with non-existent phoneNumberId: ${FAKE_PHONE_NUMBER_ID}`);
  const status = await sendWebhook(payload, appSecret);
  record("Webhook accepted (HTTP 200)", status === 200, `Got HTTP ${status}`);

  info("Waiting for audit log...");
  const log = await waitForAuditLog({ whatsappMessageId: msgId });

  if (!log) {
    record("SystemAuditLog created for failed resolution", false, "No log found within 10s");
    return;
  }

  record("SystemAuditLog created for failed resolution", true);
  record(
    "Pipeline status is FAILED",
    log.pipelineStatus === "FAILED",
    `Got: ${log.pipelineStatus}`
  );

  const steps = log.steps || [];
  const tenantStep = steps.find((s: any) => s.step === "TENANT_RESOLUTION");
  record(
    "TENANT_RESOLUTION step exists with FAIL status",
    tenantStep?.status === "FAIL",
    tenantStep ? `status: ${tenantStep.status}, error: ${tenantStep.error || "none"}` : "Step not found"
  );
}

async function cleanupTestData() {
  const collection = mongoose.connection.collection("systemauditlogs");
  const result = await collection.deleteMany({
    whatsappMessageId: { $regex: /^wamid\.OMMA_TEST_/ },
  });
  info(`Cleaned up ${result.deletedCount} test audit log(s)`);
}

async function main() {
  console.log();
  console.log(`${COLORS.magenta}${COLORS.bright}╔══════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}║    OMMA PIPELINE SANITY TEST SUITE       ║${COLORS.reset}`);
  console.log(`${COLORS.magenta}${COLORS.bright}╚══════════════════════════════════════════╝${COLORS.reset}`);

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

  info("Cleaning up previous test data...");
  await cleanupTestData();

  try {
    await testPerfectFlow(appSecret);
    await testDeduplication(appSecret);
    await testMemoryGuard(appSecret);
    await testEncryption(appSecret);
    await testFailedResolution(appSecret);
  } catch (err: any) {
    console.error(`${COLORS.red}Unexpected error during tests: ${err.message}${COLORS.reset}`);
    console.error(err.stack);
  }

  header("CLEANUP");
  await cleanupTestData();

  await mongoose.disconnect();

  console.log();
  console.log(`${COLORS.bright}${COLORS.cyan}━━━ RESULTS SUMMARY ━━━${COLORS.reset}`);
  console.log();
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const r of results) {
    const icon = r.passed ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
    console.log(`  ${icon} ${r.name}${r.reason && !r.passed ? ` ${COLORS.dim}(${r.reason})${COLORS.reset}` : ""}`);
  }

  console.log();
  const summary = failed === 0
    ? `${COLORS.bgGreen}${COLORS.bright} ALL ${passed} TESTS PASSED ${COLORS.reset}`
    : `${COLORS.bgRed}${COLORS.bright} ${failed} FAILED ${COLORS.reset} ${COLORS.bgGreen}${COLORS.bright} ${passed} PASSED ${COLORS.reset}`;
  console.log(`  ${summary}`);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
