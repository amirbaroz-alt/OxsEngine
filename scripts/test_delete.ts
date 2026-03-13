import axios from "axios";
import mongoose from "mongoose";
import crypto from "crypto";

const MONGO_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || "";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const RECIPIENT = "972585020130";

function decrypt(encryptedText: string): string {
  if (!encryptedText || !encryptedText.startsWith("enc:")) return encryptedText;
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
  const url = `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`;

  console.log("\n====== WhatsApp Delete Test ======\n");

  console.log("--- Step 1: Send message ---");
  const sendRes = await axios.post(url, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: RECIPIENT,
    type: "text",
    text: { body: "בדיקת מחיקה - הודעה זו תימחק" },
  }, { headers, timeout: 15000 });

  const wamid = sendRes.data.messages[0].id;
  console.log("Message sent. wamid:", wamid);
  console.log("Full send response:", JSON.stringify(sendRes.data, null, 2));

  console.log("\n--- Step 2: Send DELETE status ---");
  const deletePayload = {
    messaging_product: "whatsapp",
    status: "deleted",
    message_id: wamid,
  };
  console.log("URL:", url);
  console.log("PAYLOAD:", JSON.stringify(deletePayload, null, 2));

  try {
    const delRes = await axios.post(url, deletePayload, { headers, timeout: 15000 });
    console.log("\n✅ SUCCESS — Status:", delRes.status);
    console.log("RESPONSE:", JSON.stringify(delRes.data, null, 2));
  } catch (err: any) {
    console.log("\n❌ FAILED — Status:", err.response?.status);
    console.log("ERROR:", JSON.stringify(err.response?.data, null, 2));
  }

  await mongoose.disconnect();
  console.log("\n====== Done ======\n");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  mongoose.disconnect();
  process.exit(1);
});
