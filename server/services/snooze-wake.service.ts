import { ConversationModel } from "../models/conversation.model";
import { UserModel } from "../models/user.model";
import { emitConversationAssigned, emitStatusChanged } from "./socket.service";

const WAKE_INTERVAL_MS = 60_000;
const WAKE_HOUR_START = 5;
const WAKE_HOUR_END = 19;

async function wakeExpiredSnoozes() {
  try {
    const now = new Date();
    const israelHour = parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Jerusalem" }).format(now), 10);
    if (israelHour < WAKE_HOUR_START || israelHour >= WAKE_HOUR_END) {
      return;
    }
    const expired = await ConversationModel.find({
      status: "SNOOZED",
      snoozedUntil: { $lte: now },
    });

    for (const conv of expired) {
      const wakeAgentId = (conv as any).snoozeWakeAgentId;
      const wakeAgentName = (conv as any).snoozeWakeAgentName;

      if (wakeAgentId) {
        const agent = await UserModel.findById(wakeAgentId).select("active name").lean();
        if (agent && (agent as any).active) {
          (conv as any).assignedTo = wakeAgentId;
          (conv as any).assignedName = (agent as any).name || wakeAgentName || "";
        }
      }

      const newStatus = conv.assignedTo ? "ACTIVE" : "UNASSIGNED";
      (conv as any).status = newStatus;
      (conv as any).snoozedUntil = undefined;
      (conv as any).snoozedBy = undefined;
      (conv as any).snoozeWakeAgentId = undefined;
      (conv as any).snoozeWakeAgentName = undefined;
      await conv.save();

      emitConversationAssigned(String(conv.tenantId), String(conv._id), {
        assignedTo: conv.assignedTo ? String(conv.assignedTo) : null,
        assignedName: conv.assignedName || null,
        status: newStatus,
      });
      emitStatusChanged(String(conv.tenantId), String(conv._id), {
        status: newStatus,
        previousStatus: "SNOOZED",
      });
    }

    if (expired.length > 0) {
      console.log(`${new Date().toLocaleTimeString("en-US")} [snooze-wake] Woke ${expired.length} snoozed conversation(s)`);
    }
  } catch (err) {
    console.error("[snooze-wake] Error waking snoozed conversations:", err);
  }
}

export function startSnoozeWakeJob() {
  setInterval(wakeExpiredSnoozes, WAKE_INTERVAL_MS);
  console.log(`${new Date().toLocaleTimeString("en-US")} [snooze-wake] Background job started (interval: ${WAKE_INTERVAL_MS / 1000}s)`);
}
