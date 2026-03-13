import axios from "axios";
import mongoose from "mongoose";
import crypto from "crypto";

const MONGO_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || "";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const RECIPIENT = "972585020130";

function log(label: string, data: any) {
  console.log(`[TEST] ${label}:`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText;
  if (!encryptedText.startsWith("enc:")) return encryptedText;
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  const raw = encryptedText.slice(4);
  const combined = Buffer.from(raw, "base64");
  const iv = combined.subarray(0, 16);
  const tag = combined.subarray(16, 32);
  const encrypted = combined.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: "cpaas-platform" });

  const tenant = await mongoose.connection.db!.collection("tenants").findOne({ slug: /impact/i });
  if (!tenant) throw new Error("Tenant not found");
  const channel = await mongoose.connection.db!.collection("channels").findOne({ tenantId: tenant._id, type: "WHATSAPP", status: "active" });
  if (!channel) throw new Error("No active WhatsApp channel");

  const accessToken = decrypt(channel.accessToken);
  const phoneNumberId = channel.phoneNumberId;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

  console.log("\n====== Testing All Edit Variants ======\n");
  console.log("Phone:", phoneNumberId);
  console.log("Recipient:", RECIPIENT);

  async function sendOriginal(label: string): Promise<string> {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: RECIPIENT,
      type: "text",
      text: { body: `בדיקה ${label} - מקור` },
    };
    const res = await axios.post(url, payload, { timeout: 15000, headers });
    const wamid = res.data.messages[0].id;
    console.log(`  Sent "${payload.text.body}" → ${wamid}`);
    return wamid;
  }

  async function tryEdit(variantName: string, version: string, method: string, buildPayload: (wamid: string) => any): Promise<void> {
    console.log(`\n--- Variant: ${variantName} ---`);
    console.log(`  API: ${version}, Method: ${method}`);

    const wamid = await sendOriginal(variantName);
    console.log("  Waiting 5 seconds...");
    await new Promise(r => setTimeout(r, 5000));

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const payload = buildPayload(wamid);
    log("  EDIT_PAYLOAD", payload);

    try {
      let res;
      if (method === "POST") {
        res = await axios.post(url, payload, { timeout: 15000, headers });
      } else if (method === "PUT") {
        res = await axios.put(url, payload, { timeout: 15000, headers });
      }
      log("  RESPONSE", res!.status);
      log("  RESPONSE_DATA", res!.data);
      console.log(`  ✅ ${variantName} → API returned success`);
    } catch (err: any) {
      log("  ERROR", err?.response?.status);
      log("  ERROR_DATA", err?.response?.data?.error?.message || err.message);
      console.log(`  ❌ ${variantName} → API returned error`);
    }
  }

  // Variant 1: v21.0 + POST + context.message_id (original earliest code)
  await tryEdit("V1-context-v21", "v21.0", "POST", (wamid) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    context: { message_id: wamid },
    type: "text",
    text: { body: "בדיקה V1-context-v21 - שינוי" },
  }));

  // Variant 2: v24.0 + POST + root message_id (no context)
  await tryEdit("V2-root-v24", "v24.0", "POST", (wamid) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    type: "text",
    text: { body: "בדיקה V2-root-v24 - שינוי" },
    message_id: wamid,
  }));

  // Variant 3: v21.0 + POST + root message_id (no context)
  await tryEdit("V3-root-v21", "v21.0", "POST", (wamid) => ({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    type: "text",
    text: { body: "בדיקה V3-root-v21 - שינוי" },
    message_id: wamid,
  }));

  console.log("\n====== Done — Check phone for results ======");
  console.log("V1 = context.message_id (reply/quote?) or in-place edit?");
  console.log("V2 = root message_id with v24 (expected error)");
  console.log("V3 = root message_id with v21 (expected error)");
  console.log("================================================\n");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  mongoose.disconnect();
  process.exit(1);
});
