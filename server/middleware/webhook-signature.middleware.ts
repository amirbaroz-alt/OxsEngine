import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { ChannelModel } from "../models/channel.model";
import { decryptChannelFields } from "../services/channel.service";
import { log } from "../index";

const HEX_64_REGEX = /^[0-9a-f]{64}$/i;

let cachedSecrets: string[] = [];
let secretsCacheExpiry = 0;
const SECRETS_CACHE_TTL = 60_000;

async function getAppSecrets(): Promise<string[]> {
  const now = Date.now();
  if (cachedSecrets.length > 0 && now < secretsCacheExpiry) {
    return cachedSecrets;
  }

  const channels = await ChannelModel.find({
    type: "WHATSAPP",
    status: "active",
    appSecret: { $exists: true, $nin: [null, ""] },
  }).lean();

  const secrets: string[] = [];
  for (const channel of channels) {
    const decrypted = decryptChannelFields(channel);
    if (decrypted.appSecret) {
      secrets.push(decrypted.appSecret);
    }
  }

  cachedSecrets = secrets;
  secretsCacheExpiry = now + SECRETS_CACHE_TTL;
  return secrets;
}

export async function verifyWhatsAppSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!signature) {
    log("Webhook rejected: missing X-Hub-Signature-256 header", "whatsapp");
    return res.status(401).send("Missing signature");
  }

  const elements = signature.split("=");
  if (elements.length !== 2 || elements[0] !== "sha256") {
    log("Webhook rejected: malformed X-Hub-Signature-256 header", "whatsapp");
    return res.status(401).send("Invalid signature format");
  }

  const signatureHash = elements[1];

  if (!HEX_64_REGEX.test(signatureHash)) {
    log("Webhook rejected: signature hash is not valid hex-64", "whatsapp");
    return res.status(401).send("Invalid signature format");
  }

  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) {
    log("Webhook rejected: rawBody not available for signature verification", "whatsapp");
    return res.status(500).send("Internal error: raw body not captured");
  }

  const secrets = await getAppSecrets();

  if (secrets.length === 0) {
    log("WARNING: Webhook signature check skipped — no channels have appSecret configured.", "whatsapp");
    return next();
  }

  const receivedBuf = Buffer.from(signatureHash, "hex");

  for (const appSecret of secrets) {
    const expectedHash = crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

    const expectedBuf = Buffer.from(expectedHash, "hex");

    if (receivedBuf.length === expectedBuf.length && crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
      return next();
    }
  }

  log("Webhook rejected: signature does not match any configured appSecret", "whatsapp");
  return res.status(401).send("Invalid signature");
}
