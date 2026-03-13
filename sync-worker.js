const { exec } = require("child_process");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "sync.log");
const WEBHOOK_URL = process.env.MY_WEBHOOK_URL;
const COMMAND = process.env.SYNC_COMMAND || "npm run sync-assets";

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

async function sendWebhook(payload) {
  if (!WEBHOOK_URL) {
    log("WARNING: MY_WEBHOOK_URL not set — skipping webhook notification");
    return;
  }
  try {
    log(`Sending webhook to ${WEBHOOK_URL}`);
    await axios.post(WEBHOOK_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    log("Webhook sent successfully");
  } catch (err) {
    log(`Webhook failed: ${err.message}`);
  }
}

async function run() {
  log(`=== Sync Worker Started ===`);
  log(`Command: ${COMMAND}`);

  return new Promise((resolve) => {
    const child = exec(COMMAND, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
      const status = error ? "failed" : "success";
      const exitCode = error ? error.code || 1 : 0;

      log(`Command finished — status: ${status}, exit code: ${exitCode}`);
      if (stdout) log(`STDOUT:\n${stdout}`);
      if (stderr) log(`STDERR:\n${stderr}`);

      const payload = {
        status,
        timestamp: new Date().toISOString(),
        exitCode,
        stdout: stdout ? stdout.slice(-5000) : "",
        stderr: stderr ? stderr.slice(-5000) : "",
        command: COMMAND,
        error: error ? error.message : null,
      };

      await sendWebhook(payload);
      log("=== Sync Worker Finished ===\n");
      resolve();
    });

    child.stdout?.on("data", (data) => {
      fs.appendFileSync(LOG_FILE, data);
    });
    child.stderr?.on("data", (data) => {
      fs.appendFileSync(LOG_FILE, `[ERR] ${data}`);
    });
  });
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
  });
