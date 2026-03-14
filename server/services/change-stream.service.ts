import mongoose from "mongoose";
import { log } from "../lib/logger";

const recentLocalEmits = new Set<string>();
const LOCAL_EMIT_TTL = 10_000;

export function markLocalEmit(messageId: string) {
  recentLocalEmits.add(messageId);
  setTimeout(() => recentLocalEmits.delete(messageId), LOCAL_EMIT_TTL);
}

export async function startChangeStreamWatcher() {
  const db = mongoose.connection.db;
  if (!db) {
    log("Change stream: DB not ready, skipping", "changestream");
    return;
  }

  try {
    const messagesCollection = db.collection("messages");
    const messageStream = messagesCollection.watch(
      [{ $match: { operationType: "insert" } }],
      { fullDocument: "updateLookup" }
    );

    messageStream.on("change", async (change: any) => {
      if (change.operationType !== "insert") return;
      const doc = change.fullDocument;
      if (!doc) return;

      const msgId = String(doc._id);
      if (recentLocalEmits.has(msgId)) return;

      try {
        const { emitNewMessage, emitNewConversation } = await import("./socket.service");
        const tenantId = String(doc.tenantId);
        const conversationId = String(doc.conversationId);

        log(`Change stream: new message ${msgId} for conv=${conversationId} dir=${doc.direction}`, "changestream");
        emitNewMessage(tenantId, conversationId, doc);
      } catch (err: any) {
        log(`Change stream emit error: ${err.message}`, "changestream");
      }
    });

    messageStream.on("error", (err: any) => {
      log(`Change stream error: ${err.message}`, "changestream");
    });

    const conversationsCollection = db.collection("conversations");
    const convStream = conversationsCollection.watch(
      [{ $match: { operationType: "insert" } }],
      { fullDocument: "updateLookup" }
    );

    convStream.on("change", async (change: any) => {
      if (change.operationType !== "insert") return;
      const doc = change.fullDocument;
      if (!doc) return;

      try {
        const { emitNewConversation } = await import("./socket.service");
        const tenantId = String(doc.tenantId);
        log(`Change stream: new conversation ${doc._id} for tenant=${tenantId}`, "changestream");
        emitNewConversation(tenantId, doc);
      } catch (err: any) {
        log(`Change stream new-conv emit error: ${err.message}`, "changestream");
      }
    });

    convStream.on("error", (err: any) => {
      log(`Change stream (conversations) error: ${err.message}`, "changestream");
    });

    log("MongoDB Change Streams started (messages + conversations)", "changestream");
  } catch (err: any) {
    log(`Change stream init failed: ${err.message}`, "changestream");
  }
}
