import { useState, useEffect, useRef, MutableRefObject } from "react";
import { queryClient } from "@/lib/queryClient";
import { io, Socket } from "socket.io-client";
import type { Tenant } from "@shared/schema";
import type { Message, Conversation, MediaCache } from "@/components/inbox/types";

function extractMessages(raw: unknown): Message[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "messages" in raw) {
    const msgs = (raw as any).messages;
    if (Array.isArray(msgs)) return msgs;
  }
  return null;
}

function setCacheMessages(key: string[], updated: Message[]) {
  const raw = queryClient.getQueryData(key);
  if (raw && !Array.isArray(raw) && typeof raw === "object" && "messages" in raw) {
    queryClient.setQueryData(key, { ...(raw as any), messages: updated });
  } else {
    queryClient.setQueryData<Message[]>(key, updated);
  }
}

interface UseInboxSocketParams {
  currentRole: string;
  currentTenantId: string | undefined;
  filterTenantId: string;
  selectedConvId: string | null;
  invalidateConvList: () => void;
  mediaCachePerConvRef: MutableRefObject<Record<string, MediaCache>>;
  setMediaCache: React.Dispatch<React.SetStateAction<MediaCache>>;
  selectedConvIdRef: MutableRefObject<string | null>;
  filterTenantIdRef: MutableRefObject<string>;
  currentTenantIdRef: MutableRefObject<string | undefined>;
  tenantsRef: MutableRefObject<Tenant[]>;
  setSelectedConvId: (id: string | null) => void;
  setMobileView: (view: "list" | "chat") => void;
  unreadCounts: Record<string, number>;
  setUnreadCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  tenants: Tenant[] | undefined;
}

export function useInboxSocket({
  currentRole, currentTenantId, filterTenantId, selectedConvId,
  invalidateConvList,
  mediaCachePerConvRef, setMediaCache,
  selectedConvIdRef, filterTenantIdRef, currentTenantIdRef, tenantsRef,
  setSelectedConvId, setMobileView,
  unreadCounts, setUnreadCounts,
  tenants,
}: UseInboxSocketParams) {
  const socketRef = useRef<Socket | null>(null);
  const notifSoundRef = useRef<HTMLAudioElement | null>(null);
  const lastDisconnectRef = useRef<string | null>(null);
  const [typingConvId, setTypingConvId] = useState<string | null>(null);
  const [typingName, setTypingName] = useState<string>("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0;
      osc.start();
      notifSoundRef.current = null;

      const playPing = () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      };
      (notifSoundRef as any).current = { play: playPing };
      return () => { ctx.close().catch(() => {}); };
    } catch {
    }
  }, []);

  useEffect(() => {
    const socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = socket;
    const authToken = localStorage.getItem("auth_token");

    socket.on("connect", () => {
      console.log("[socket] connected, id:", socket.id);
      if (authToken) socket.emit("authenticate", { token: authToken });

      const disconnectedAt = lastDisconnectRef.current;
      if (disconnectedAt) {
        console.log("[socket] reconnected, fetching messages since", disconnectedAt);
        const activeConvId = selectedConvIdRef.current;
        if (activeConvId) {
          fetch(`/api/inbox/conversations/${activeConvId}/messages?since=${encodeURIComponent(disconnectedAt)}`, { credentials: "include" })
            .then(r => r.ok ? r.json() : [])
            .then((missed: Message[]) => {
              if (missed.length > 0) {
                const messagesKey = `/api/inbox/conversations/${activeConvId}/messages?limit=200`;
                const raw = queryClient.getQueryData([messagesKey]);
                const existing = extractMessages(raw);
                if (existing) {
                  const existingIds = new Set(existing.map(m => m._id));
                  const newMsgs = missed.filter(m => !existingIds.has(m._id));
                  if (newMsgs.length > 0) {
                    setCacheMessages([messagesKey], [...existing, ...newMsgs]);
                    console.log("[socket] gap recovery: injected", newMsgs.length, "missed messages");
                  }
                } else {
                  queryClient.invalidateQueries({ queryKey: [messagesKey] });
                }
              }
            })
            .catch(err => console.warn("[socket] gap recovery failed:", err));
        }
        invalidateConvList();
        lastDisconnectRef.current = null;
      }
    });

    socket.on("authenticated", () => {
      console.log("[socket] authenticated");
      const tid = currentTenantIdRef.current || filterTenantIdRef.current;
      if (tid && tid !== "__all__") {
        socket.emit("join-tenant", tid);
        console.log("[socket] join-tenant:", tid);
      } else {
        const tList = tenantsRef.current;
        console.log("[socket] superadmin, joining", tList.length, "tenant rooms");
        if (tList.length) {
          tList.forEach((tn) => {
            socket.emit("join-tenant", tn._id);
            console.log("[socket] join-tenant:", tn._id);
          });
        } else {
          console.log("[socket] no tenants loaded yet, will join on load");
        }
      }
      const convId = selectedConvIdRef.current;
      if (convId) {
        socket.emit("join-conversation", convId);
        console.log("[socket] join-conversation:", convId);
      }
    });

    socket.on("connect_error", (err: any) => {
      console.error("[SOCKET ERROR] connect_error:", err?.message || err);
    });

    socket.on("new-message", (msg: Message & { _ackId?: string }) => {
      const activeConvId = selectedConvIdRef.current;
      const msgConvId = String(msg.conversationId);

      const convCacheQueries = queryClient.getQueryCache().findAll({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages") && !k.includes("tab-counts");
        },
      });
      const cachedIds: string[] = [];
      for (const cq of convCacheQueries) {
        const data = queryClient.getQueryData<Conversation[]>(cq.queryKey);
        if (data) data.forEach((c) => cachedIds.push(String(c._id)));
      }
      const hasMatch = cachedIds.includes(msgConvId);

      console.log("[socket] === NEW MESSAGE DEBUG ===");
      console.log("[socket] msg._id:", msg._id);
      console.log("[socket] msg.conversationId:", msg.conversationId, "→ coerced:", msgConvId);
      console.log("[socket] msg.direction:", msg.direction, "| msg.content:", msg.content?.substring(0, 40));
      console.log("[socket] activeConvId (selectedConvIdRef):", activeConvId);
      console.log("[socket] cached conversation IDs:", cachedIds);
      console.log("[socket] Is there a match?", hasMatch);
      console.log("[socket] convCacheQueries count:", convCacheQueries.length, "| queryKeys:", convCacheQueries.map(q => q.queryKey[0]));
      console.log("[socket] === END DEBUG ===");

      if (msg._ackId) {
        socket.emit("message-ack", msg._ackId);
      }

      const cleanMsg = { ...msg };
      delete (cleanMsg as any)._ackId;
      const isInbound = msg.direction === "INBOUND";
      const now = msg.createdAt || new Date().toISOString();

      let serverUnread = 0;
      for (const cq of convCacheQueries) {
        const data = queryClient.getQueryData<Conversation[]>(cq.queryKey);
        if (data) {
          const found = data.find((c) => String(c._id) === msgConvId);
          if (found) { serverUnread = found.unreadCount || 0; break; }
        }
      }

      console.log("[socket] new-message: skipping unread/cache update (handled by conversation-updated)");

      if (activeConvId && activeConvId === msgConvId) {
        const messagesKey = `/api/inbox/conversations/${msgConvId}/messages?limit=200`;
        const raw = queryClient.getQueryData([messagesKey]);
        const existing = extractMessages(raw);
        if (existing) {
          const existingIdx = existing.findIndex((m) => m._id === msg._id);
          if (existingIdx === -1) {
            const withoutOptimistic = msg.direction === "OUTBOUND"
              ? existing.filter((m) => !(m._id.startsWith("optimistic-") && m.content === msg.content))
              : existing;
            setCacheMessages([messagesKey], [...withoutOptimistic, cleanMsg]);
            console.log("[socket] messages cache updated, total:", withoutOptimistic.length + 1);
          } else {
            const updated = [...existing];
            updated[existingIdx] = cleanMsg;
            setCacheMessages([messagesKey], updated);
            console.log("[socket] messages cache: replaced existing msg", msg._id);
          }
        } else {
          queryClient.refetchQueries({ queryKey: [messagesKey] });
          console.log("[socket] no messages cache, triggered refetch");
        }
      }

      const meta = (msg.metadata || {}) as any;
      if ((msg as any).hasMedia && (meta.base64 || meta.mediaKey)) {
        const convId = msgConvId;
        if (meta.base64) {
          const entry = { base64: meta.base64, mimeType: meta.mimeType || "image/png", fileName: meta.fileName };
          mediaCachePerConvRef.current[convId] = { ...(mediaCachePerConvRef.current[convId] || {}), [msg._id]: entry };
          if (convId === selectedConvIdRef.current) setMediaCache((prev) => ({ ...prev, [msg._id]: entry }));
          console.log("[socket] mediaCache updated from socket base64 for", msg._id);
        } else if (meta.mediaKey && msg.type !== "VIDEO") {
          const authToken = localStorage.getItem("auth_token") || "";
          fetch(`/api/inbox/messages/${msg._id}/media/stream`, {
            headers: { Authorization: `Bearer ${authToken}` },
          }).then(async (streamRes) => {
            if (!streamRes.ok) return;
            const blob = await streamRes.blob();
            const reader = new FileReader();
            const b64 = await new Promise<string>((resolve) => {
              reader.onloadend = () => resolve((reader.result as string).split(",")[1] || "");
              reader.readAsDataURL(blob);
            });
            const entry = { base64: b64, mimeType: blob.type || meta.mimeType || "image/png", fileName: meta.fileName };
            mediaCachePerConvRef.current[convId] = { ...(mediaCachePerConvRef.current[convId] || {}), [msg._id]: entry };
            if (convId === selectedConvIdRef.current) setMediaCache((prev) => ({ ...prev, [msg._id]: entry }));
            console.log("[socket] mediaCache updated from stream for", msg._id);
          }).catch(() => {});
        }
      }

      setTick((t) => t + 1);
      invalidateConvList();
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/customers"], exact: false });
      console.log("[socket] tick incremented + invalidateConvList called");
    });

    socket.on("conversation-updated", (data: { conversationId: string; lastMessage?: Message }) => {
      const convId = String(data.conversationId);
      const activeConvId = selectedConvIdRef.current;
      const isInbound = data.lastMessage?.direction === "INBOUND";
      const now = data.lastMessage?.createdAt || new Date().toISOString();

      console.log("[socket] === CONVERSATION-UPDATED DEBUG ===");
      console.log("[socket] convId:", convId, "| activeConvId:", activeConvId);
      console.log("[socket] lastMessage:", data.lastMessage?.content?.substring(0, 40), "| direction:", data.lastMessage?.direction);
      console.log("[socket] isInbound:", isInbound);

      if (isInbound) {
        const convCacheQueries = queryClient.getQueryCache().findAll({
          predicate: (q) => {
            const k = q.queryKey[0];
            return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages") && !k.includes("tab-counts");
          },
        });

        let serverUnread = 0;
        for (const cq of convCacheQueries) {
          const data2 = queryClient.getQueryData<Conversation[]>(cq.queryKey);
          if (data2) {
            const found = data2.find((c) => String(c._id) === convId);
            if (found) { serverUnread = found.unreadCount || 0; break; }
          }
        }

        setUnreadCounts((prev) => {
          const current = prev[convId] !== undefined ? prev[convId] : serverUnread;
          const next = current + 1;
          console.log("[socket] setUnreadCounts via conversation-updated:", convId, "→", next);
          return { ...prev, [convId]: next };
        });

        if (activeConvId !== convId) {
          try { (notifSoundRef as any).current?.play?.(); } catch {}
        }

        for (const cq of convCacheQueries) {
          const list = queryClient.getQueryData<Conversation[]>(cq.queryKey);
          if (list) {
            const idx = list.findIndex((c) => String(c._id) === convId);
            if (idx !== -1) {
              const conv = list[idx];
              const updatedConv = {
                ...conv,
                lastMessage: data.lastMessage!,
                lastMessageAt: now,
                lastInboundAt: now,
                unreadCount: (conv.unreadCount || 0) + 1,
              };
              const rest = list.filter((_, i) => i !== idx);
              queryClient.setQueryData<Conversation[]>(cq.queryKey, [updatedConv, ...rest]);
              console.log("[socket] conv-updated: cache updated, conv bubbled to top, unread:", updatedConv.unreadCount);
            }
          }
        }
      } else if (data.lastMessage) {
        const convCacheQueries = queryClient.getQueryCache().findAll({
          predicate: (q) => {
            const k = q.queryKey[0];
            return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages") && !k.includes("tab-counts");
          },
        });
        for (const cq of convCacheQueries) {
          const list = queryClient.getQueryData<Conversation[]>(cq.queryKey);
          if (list) {
            const idx = list.findIndex((c) => String(c._id) === convId);
            if (idx !== -1) {
              const updatedConv = {
                ...list[idx],
                lastMessage: data.lastMessage,
                lastMessageAt: now,
              };
              const rest = list.filter((_, i) => i !== idx);
              queryClient.setQueryData<Conversation[]>(cq.queryKey, [updatedConv, ...rest]);
            }
          }
        }
      }

      if (activeConvId === convId && data.lastMessage) {
        const messagesKey = `/api/inbox/conversations/${convId}/messages?limit=200`;
        const raw = queryClient.getQueryData([messagesKey]);
        const existing = extractMessages(raw);
        if (existing) {
          if (!existing.some((m) => m._id === data.lastMessage!._id)) {
            setCacheMessages([messagesKey], [...existing, data.lastMessage]);
            console.log("[socket] conv-updated: message appended to active chat");
          }
        } else {
          queryClient.refetchQueries({ queryKey: [messagesKey] });
        }
      }

      setTick((t) => t + 1);
      invalidateConvList();
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.includes("tab-counts");
        },
      });
      console.log("[socket] conv-updated: tick + invalidate + tab-counts done");
    });

    socket.on("new-conversation", (conv: any) => {
      console.log("[socket] new-conversation received:", conv?._id || conv);
      invalidateConvList();
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.includes("tab-counts");
        },
      });
      queryClient.refetchQueries({ queryKey: ["/api/inbox/customers"], type: "active" });
      try {
        (notifSoundRef as any).current?.play?.();
      } catch {}
    });

    socket.on("conversation-resolved", (data: { conversationId: string }) => {
      invalidateConvList();
      queryClient.invalidateQueries({ predicate: (q) => { const k = q.queryKey[0]; return typeof k === "string" && k.includes("tab-counts"); } });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/customers"], exact: false });
      if (selectedConvIdRef.current === data.conversationId) {
        setSelectedConvId(null);
        setMobileView("list");
      }
    });

    socket.on("conversation-assigned", () => {
      invalidateConvList();
      queryClient.invalidateQueries({ predicate: (q) => { const k = q.queryKey[0]; return typeof k === "string" && k.includes("tab-counts"); } });
    });

    socket.on("status-changed", () => {
      invalidateConvList();
    });

    socket.on("message-status", (data: {
      conversationId: string;
      messageId: string;
      waMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
    }) => {
      const messagesKey = `/api/inbox/conversations/${data.conversationId}/messages?limit=200`;
      const raw = queryClient.getQueryData([messagesKey]);
      const msgs = extractMessages(raw);
      if (!msgs) return;
      setCacheMessages([messagesKey], msgs.map((m) => {
        if (m._id === data.messageId || m.metadata?.waMessageId === data.waMessageId) {
          return { ...m, deliveryStatus: data.status };
        }
        return m;
      }));
    });

    socket.on("message-edited", (data: {
      conversationId: string;
      messageId: string;
      content?: string;
      deletedAt?: string;
      editedAt?: string;
      editedBy?: string;
    }) => {
      const messagesKey = `/api/inbox/conversations/${data.conversationId}/messages?limit=200`;
      const raw = queryClient.getQueryData([messagesKey]);
      const msgs = extractMessages(raw);
      if (!msgs) return;
      setCacheMessages([messagesKey], msgs.map((m) => {
        if (m._id === data.messageId) {
          const updated = { ...m };
          if (data.deletedAt) updated.deletedAt = data.deletedAt;
          if (data.content && data.editedAt) {
            updated.content = data.content;
            updated.editedAt = data.editedAt;
          }
          return updated;
        }
        return m;
      }));
    });

    socket.on("customer-typing", (data: {
      conversationId: string;
      customerName?: string;
      isTyping: boolean;
    }) => {
      if (data.isTyping) {
        setTypingConvId(data.conversationId);
        setTypingName(data.customerName || "");
      } else if (data.conversationId === selectedConvIdRef.current) {
        setTypingConvId(null);
        setTypingName("");
      }
    });

    socket.on("disconnect", () => {
      console.log("[socket] disconnected, recording timestamp for gap recovery");
      lastDisconnectRef.current = new Date().toISOString();
    });

    return () => { socket.disconnect(); };
  }, [currentRole, currentTenantId, filterTenantId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (selectedConvId) {
      socket.emit("join-conversation", selectedConvId);
      return () => { socket.emit("leave-conversation", selectedConvId); };
    }
  }, [selectedConvId]);

  useEffect(() => {
    if (tenants) {
      const prevLen = tenantsRef.current.length;
      tenantsRef.current = tenants;
      const socket = socketRef.current;
      const tid = currentTenantId || filterTenantId;
      if (socket?.connected && (!tid || tid === "__all__")) {
        console.log("[socket] tenants loaded/updated, joining", tenants.length, "tenant rooms (prev:", prevLen, ")");
        tenants.forEach((tn) => socket.emit("join-tenant", tn._id));
      }
    }
  }, [tenants, currentTenantId, filterTenantId]);

  return {
    socketRef,
    typingConvId, typingName,
    tick,
    setTypingConvId, setTypingName,
  };
}
