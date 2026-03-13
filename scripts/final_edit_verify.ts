import axios from "axios";
import mongoose from "mongoose";
import crypto from "crypto";

const MONGO_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || "";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const RECIPIENT = "972585020130";

function log(label: string, data: any) {
  console.log(`[TEST LOG] ${label}:`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
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
  console.log("\n====== RESEARCH FINDINGS ======\n");
  console.log("Official Meta WhatsApp Cloud API Documentation:");
  console.log("  https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages");
  console.log("  https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages\n");
  console.log("FINDING: The Meta WhatsApp Cloud API (v21–v25) does NOT support:");
  console.log("  1. Editing sent messages (no edit/overwrite endpoint exists)");
  console.log("  2. Deleting sent messages from recipient's phone (no DELETE for messages)\n");
  console.log("PROOF:");
  console.log("  - POST with root-level message_id → 400 'status is required' (interpreted as mark-as-read)");
  console.log("  - PUT to /messages → 400 'Unsupported put request' (method not allowed)\n");
  console.log("CORRECT APPROACH: Send a new correction/cancellation message that QUOTES the original");
  console.log("  using context.message_id (official reply/quote feature).\n");
  console.log("Required JSON structure for correction:");
  console.log(JSON.stringify({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "<recipient>",
    type: "text",
    text: { body: "✏️ <corrected content>" },
    context: { message_id: "<original_wamid>" },
  }, null, 2));
  console.log("\n==============================\n");

  await mongoose.connect(MONGO_URI, { dbName: "cpaas-platform" });

  const tenantDoc = await mongoose.connection.db!.collection("tenants").findOne({
    slug: { $regex: /impact/i },
  });
  if (!tenantDoc) throw new Error("Tenant not found");
  log("TENANT", { id: tenantDoc._id.toString(), name: tenantDoc.nameEn });

  const channel = await mongoose.connection.db!.collection("channels").findOne({
    tenantId: tenantDoc._id,
    type: "WHATSAPP",
    status: "active",
  });
  if (!channel) throw new Error("No active WhatsApp channel");

  const accessToken = decrypt(channel.accessToken);
  const phoneNumberId = channel.phoneNumberId;
  log("CHANNEL", { phoneNumberId });

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };

  console.log("\n--- STEP 1: Send Original Message ---\n");
  const sendPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    type: "text",
    text: { body: "Phase 3 - Original Message (will be corrected)" },
  };
  log("REQUEST_URL", url);
  log("REQUEST_BODY", sendPayload);

  let waMessageId: string;
  try {
    const sendRes = await axios.post(url, sendPayload, { timeout: 15000, headers });
    log("RESPONSE_CODE", sendRes.status);
    log("RESPONSE_DATA", sendRes.data);
    waMessageId = sendRes.data?.messages?.[0]?.id;
    if (!waMessageId) throw new Error("No message ID");
    log("MESSAGE_ID", waMessageId);
  } catch (err: any) {
    log("SEND_FAILED", err?.response?.data || err.message);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("\n--- STEP 2: Wait 3 seconds ---\n");
  await new Promise((r) => setTimeout(r, 3000));
  log("WAIT", "Complete");

  console.log("\n--- STEP 3: Send Correction (quoting original via context.message_id) ---\n");
  const correctionPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    type: "text",
    text: { body: "✏️ Phase 3 - CORRECTED MESSAGE (Success!)" },
    context: { message_id: waMessageId },
  };

  const payloadStr = JSON.stringify(correctionPayload);
  log("PREFLIGHT", {
    has_root_message_id: payloadStr.includes('"message_id"') && !payloadStr.includes('"context"'),
    has_context_message_id: payloadStr.includes('"context"'),
    has_status: payloadStr.includes('"status"'),
  });

  log("REQUEST_URL", url);
  log("REQUEST_BODY", correctionPayload);

  try {
    const editRes = await axios.post(url, correctionPayload, { timeout: 15000, headers });
    log("RESPONSE_CODE", editRes.status);
    log("RESPONSE_DATA", editRes.data);
    const correctionId = editRes.data?.messages?.[0]?.id;
    console.log(`\n✅ CORRECTION SENT SUCCESSFULLY!`);
    console.log(`   Original: ${waMessageId}`);
    console.log(`   Correction: ${correctionId}`);
    console.log(`   The customer sees a quoted reply with the corrected text.\n`);
  } catch (err: any) {
    log("RESPONSE_CODE", err?.response?.status || "N/A");
    log("RESPONSE_DATA", err?.response?.data || err.message);
    console.log("\n❌ CORRECTION FAILED.\n");
  }

  await mongoose.disconnect();
  console.log("====== Test Complete ======\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  mongoose.disconnect();
  process.exit(1);
});
