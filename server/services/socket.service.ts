import { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { log } from "../lib/logger";
import { markLocalEmit } from "./change-stream.service";
import { authService } from "./auth.service";
import { userService } from "./user.service";
import { conversationService } from "./conversation.service";

let io: SocketServer | null = null;

interface PendingAck {
  tenantId: string;
  conversationId: string;
  message: any;
  retries: number;
  timer: ReturnType<typeof setTimeout>;
}

const pendingAcks = new Map<string, PendingAck>();
const ACK_TIMEOUT_MS = 5000;
const MAX_ACK_RETRIES = 2;

function scheduleAckRetry(ackId: string) {
  const pending = pendingAcks.get(ackId);
  if (!pending || !io) return;

  pending.timer = setTimeout(() => {
    const entry = pendingAcks.get(ackId);
    if (!entry || !io) { pendingAcks.delete(ackId); return; }

    if (entry.retries >= MAX_ACK_RETRIES) {
      log(`Ack timeout for msg ${entry.message._id} after ${MAX_ACK_RETRIES} retries, giving up`, "socket");
      clearTimeout(entry.timer);
      pendingAcks.delete(ackId);
      return;
    }

    entry.retries++;
    const convRoom = `conversation:${entry.conversationId}`;
    const convSockets = io.sockets.adapter.rooms.get(convRoom);
    if (convSockets && convSockets.size > 0) {
      log(`Ack retry #${entry.retries} for msg ${entry.message._id} to ${convSockets.size} sockets`, "socket");
      io.to(convRoom).emit("new-message", { ...entry.message, _ackId: ackId });
      scheduleAckRetry(ackId);
    } else {
      log(`Ack retry skipped: no sockets in ${convRoom}`, "socket");
      clearTimeout(entry.timer);
      pendingAcks.delete(ackId);
    }
  }, ACK_TIMEOUT_MS);
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/socket.io",
  });

  const userSocketMap = new Map<string, Set<string>>();

  io.on("connection", async (socket) => {
    let authenticatedTenantIds: string[] = [];
    let userRole: string | null = null;
    let authenticatedUserId: string | null = null;
    log(`Socket connected: ${socket.id}`, "socket");

    socket.on("authenticate", async (data: { token?: string; tenantId?: string }) => {
      try {
        const token = data.token;
        if (!token) { log(`Socket auth: no token provided`, "socket"); return; }

        const result = await authService.validateSocketSession(token);
        if (!result) { log(`Socket auth: invalid/expired session`, "socket"); return; }

        userRole = result.role;
        authenticatedUserId = result.userId;

        if (result.role === "superadmin") {
          authenticatedTenantIds = ["__all__"];
        } else if (result.tenantId) {
          authenticatedTenantIds = [result.tenantId];
        }

        if (!userSocketMap.has(authenticatedUserId)) {
          userSocketMap.set(authenticatedUserId, new Set());
        }
        userSocketMap.get(authenticatedUserId)!.add(socket.id);

        const onlineResult = await userService.setOnline(authenticatedUserId);

        if (onlineResult?.tenantId) {
          io!.to(`tenant:${onlineResult.tenantId}`).emit("agent-status", {
            userId: authenticatedUserId,
            userName: onlineResult.name,
            isOnline: true,
            presenceStatus: onlineResult.presenceStatus || "active",
          });
        }

        log(`Socket authenticated: ${socket.id} role=${result.role} user=${authenticatedUserId} tenants=${JSON.stringify(authenticatedTenantIds)}`, "socket");
        socket.emit("authenticated", { role: result.role });
      } catch (err: any) {
        log(`Socket auth error: ${err.message}`, "socket");
      }
    });

    socket.on("join-tenant", (tenantId: string) => {
      if (authenticatedTenantIds.includes("__all__") || authenticatedTenantIds.includes(tenantId)) {
        socket.join(`tenant:${tenantId}`);
        log(`Socket ${socket.id} joined tenant:${tenantId}`, "socket");
      } else {
        log(`Socket ${socket.id} denied join tenant:${tenantId}`, "socket");
      }
    });

    socket.on("join-conversation", async (conversationId: string) => {
      try {
        if (authenticatedTenantIds.length === 0) {
          log(`Socket ${socket.id} denied join conv:${conversationId} (not authenticated)`, "socket");
          return;
        }
        if (authenticatedTenantIds.includes("__all__")) {
          socket.join(`conversation:${conversationId}`);
          log(`Socket ${socket.id} joined conversation:${conversationId}`, "socket");
          return;
        }
        const hasAccess = await conversationService.verifyTenantAccess(conversationId, authenticatedTenantIds);
        if (hasAccess) {
          socket.join(`conversation:${conversationId}`);
          log(`Socket ${socket.id} joined conversation:${conversationId}`, "socket");
        }
      } catch (err: any) {
        log(`Socket join-conversation error: ${err.message}`, "socket");
      }
    });

    socket.on("leave-conversation", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("message-ack", (ackId: string) => {
      if (pendingAcks.has(ackId)) {
        const pending = pendingAcks.get(ackId)!;
        clearTimeout(pending.timer);
        pendingAcks.delete(ackId);
      }
    });

    socket.on("disconnect", async () => {
      log(`Socket disconnected: ${socket.id}`, "socket");

      if (authenticatedUserId) {
        const sockets = userSocketMap.get(authenticatedUserId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSocketMap.delete(authenticatedUserId);
            try {
              const offlineResult = await userService.setOffline(authenticatedUserId);

              if (offlineResult?.tenantId) {
                io!.to(`tenant:${offlineResult.tenantId}`).emit("agent-status", {
                  userId: authenticatedUserId,
                  userName: offlineResult.name,
                  isOnline: false,
                  presenceStatus: offlineResult.presenceStatus || "active",
                });
              }
              log(`User ${authenticatedUserId} went offline (no remaining sockets)`, "socket");
            } catch (err: any) {
              log(`Offline update error: ${err.message}`, "socket");
            }
          }
        }
      }
    });
  });

  log("Socket.io server initialized", "socket");
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export function emitNewMessage(tenantId: string, conversationId: string, message: any) {
  if (!io) { log(`emitNewMessage: io is null!`, "socket"); return; }
  const convRoom = `conversation:${conversationId}`;
  const tenantRoom = `tenant:${tenantId}`;
  const convSockets = io.sockets.adapter.rooms.get(convRoom);
  const tenantSockets = io.sockets.adapter.rooms.get(tenantRoom);
  log(`emitNewMessage: conv=${convRoom} (${convSockets?.size || 0} sockets), tenant=${tenantRoom} (${tenantSockets?.size || 0} sockets), msg=${message._id}`, "socket");

  markLocalEmit(String(message._id));

  const ackId = `ack_${message._id}_${Date.now()}`;
  io.to(convRoom).emit("new-message", { ...message, _ackId: ackId });
  io.to(tenantRoom).emit("conversation-updated", {
    conversationId,
    lastMessage: message,
  });

  if (convSockets && convSockets.size > 0) {
    pendingAcks.set(ackId, {
      tenantId,
      conversationId,
      message,
      retries: 0,
      timer: null as any,
    });
    scheduleAckRetry(ackId);
  }
}

export function emitConversationResolved(tenantId: string, conversationId: string) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit("conversation-resolved", { conversationId });
  io.to(`conversation:${conversationId}`).emit("conversation-resolved", { conversationId });
}

export function emitNewConversation(tenantId: string, conversation: any) {
  if (!io) { log(`emitNewConversation: io is null!`, "socket"); return; }
  const tenantRoom = `tenant:${tenantId}`;
  const tenantSockets = io.sockets.adapter.rooms.get(tenantRoom);
  log(`emitNewConversation: tenant=${tenantRoom} (${tenantSockets?.size || 0} sockets), conv=${conversation._id}`, "socket");
  io.to(tenantRoom).emit("new-conversation", conversation);
}

export function emitMessageStatus(
  tenantId: string,
  conversationId: string,
  data: {
    waMessageId: string;
    messageId?: string;
    status: "sent" | "delivered" | "read" | "failed";
    timestamp?: string;
  }
) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("message-status", {
    conversationId,
    ...data,
  });
}

export function emitConversationAssigned(
  tenantId: string,
  conversationId: string,
  data: { assignedTo: string | null; assignedName: string | null; status: string }
) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit("conversation-assigned", { conversationId, ...data });
  io.to(`conversation:${conversationId}`).emit("conversation-assigned", { conversationId, ...data });
}

export function emitStatusChanged(
  tenantId: string,
  conversationId: string,
  data: { status: string; previousStatus?: string }
) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit("status-changed", { conversationId, ...data });
  io.to(`conversation:${conversationId}`).emit("status-changed", { conversationId, ...data });
}

export function emitMessageEdited(
  tenantId: string,
  conversationId: string,
  data: { messageId: string; content?: string; deletedAt?: string; editedAt?: string; editedBy?: string }
) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("message-edited", { conversationId, ...data });
  io.to(`tenant:${tenantId}`).emit("message-edited", { conversationId, ...data });
}

export function emitTypingIndicator(
  tenantId: string,
  conversationId: string,
  data: { customerName?: string; isTyping: boolean }
) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("customer-typing", {
    conversationId,
    ...data,
  });
}

export function emitTemplateUpdate(tenantId: string, data: { templateId: string; status: string; templateName: string }) {
  if (!io) { log(`emitTemplateUpdate: io is null!`, "socket"); return; }
  const tenantRoom = `tenant:${tenantId}`;
  const tenantSockets = io.sockets.adapter.rooms.get(tenantRoom);
  log(`emitTemplateUpdate: tenant=${tenantRoom} (${tenantSockets?.size || 0} sockets), template=${data.templateName}, status=${data.status}`, "socket");
  io.to(tenantRoom).emit("template_update", data);
}

export function getSocketDiagnostics() {
  if (!io) return { status: "io not initialized" };
  const rooms: Record<string, number> = {};
  for (const [roomName, socketIds] of io.sockets.adapter.rooms) {
    if (roomName.startsWith("tenant:") || roomName.startsWith("conversation:")) {
      rooms[roomName] = socketIds.size;
    }
  }
  const connectedSockets = io.sockets.sockets.size;
  return { connectedSockets, rooms };
}
