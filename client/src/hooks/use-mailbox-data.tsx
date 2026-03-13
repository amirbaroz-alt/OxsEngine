import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/lib/role-context";
import { useAuth } from "@/lib/auth-context";
import { isRtl } from "@/lib/i18n";
import { compressImageFile } from "@/lib/compress-image";
import { useSidebar } from "@/components/ui/sidebar";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { Tenant } from "@shared/schema";
import { fetchMediaBatchProgressive } from "@/components/inbox/helpers";
import type { Message, Conversation, JourneyConversation, MediaCache } from "@/components/inbox/types";
import { useInboxFilters } from "./use-inbox-filters";
import { useInboxSocket } from "./use-inbox-socket";
import { useInboxMutations } from "./use-inbox-mutations";

export function useMailboxData() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { currentRole, currentTenantId } = useRole();
  const { user: authUser, updatePresence } = useAuth();
  const { setOpen: setSidebarOpen } = useSidebar();
  const rtl = isRtl(i18n.language);
  const isSuperAdmin = currentRole === "superadmin";
  const displayName = useCallback((name?: string | null) => {
    if (!name) return name;
    if (name === "Super Admin") return t("users.roles.superadmin");
    return name;
  }, [t]);

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [inputMode, setInputMode] = useState<"message" | "note">("message");
  const [inputText, setInputText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [emailSubject, setEmailSubject] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [pastePreviewFile, setPastePreviewFile] = useState<File | null>(null);
  const [pasteCaption, setPasteCaption] = useState("");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [crmPanelWidth, setCrmPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("inbox_crm_width");
      const parsed = saved ? parseInt(saved, 10) : 320;
      return Number.isFinite(parsed) && parsed >= 200 && parsed <= 600 ? parsed : 320;
    } catch { return 320; }
  });
  const [listPanelWidth, setListPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("inbox_list_width");
      const parsed = saved ? parseInt(saved, 10) : 320;
      return Number.isFinite(parsed) && parsed >= 200 && parsed <= 500 ? parsed : 320;
    } catch { return 320; }
  });
  const [crmTopHeight, setCrmTopHeight] = useState(() => {
    try {
      const saved = localStorage.getItem("inbox_crm_top_height");
      const parsed = saved ? parseInt(saved, 10) : 250;
      return Number.isFinite(parsed) && parsed >= 100 && parsed <= 600 ? parsed : 250;
    } catch { return 250; }
  });
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const isDraggingRef = useRef(false);
  const isDraggingListRef = useRef(false);
  const isDraggingCrmDividerRef = useRef(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [resolveTags, setResolveTags] = useState<string[]>([]);
  const [resolveSummary, setResolveSummary] = useState("");
  const [showSnooze, setShowSnooze] = useState(false);
  const [showSnoozeEdit, setShowSnoozeEdit] = useState(false);
  const [sendTemplateDialogOpen, setSendTemplateDialogOpen] = useState(false);
  const [snoozeCustomMode, setSnoozeCustomMode] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState<Date | undefined>(undefined);
  const [snoozeHour, setSnoozeHour] = useState("09");
  const [snoozeMinute, setSnoozeMinute] = useState("00");
  const [snoozeTargetAgent, setSnoozeTargetAgent] = useState<string>("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [forwardTargetConvId, setForwardTargetConvId] = useState("");
  const [showSuggestDialog, setShowSuggestDialog] = useState(false);
  const [suggestMessageId, setSuggestMessageId] = useState<string | null>(null);
  const [suggestQuestion, setSuggestQuestion] = useState("");
  const [suggestAnswer, setSuggestAnswer] = useState("");
  const [suggestTeamId, setSuggestTeamId] = useState("");
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: string; name: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const richEditorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedConvIdRef = useRef<string | null>(null);
  const tenantsRef = useRef<Tenant[]>([]);
  const filterTenantIdRef = useRef<string>("__all__");
  const currentTenantIdRef = useRef<string | undefined>(currentTenantId);

  useEffect(() => {
    setSidebarOpen(false);
    return () => { setSidebarOpen(true); };
  }, [setSidebarOpen]);

  const filters = useInboxFilters({ currentRole, currentTenantId, authUser });

  useEffect(() => {
    filterTenantIdRef.current = filters.filterTenantId;
  }, [filters.filterTenantId]);

  useEffect(() => {
    currentTenantIdRef.current = currentTenantId;
  }, [currentTenantId]);

  const invalidateConvList = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages");
      },
      refetchType: "active",
    });
  }, []);

  const { data: conversations = [], isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: [`/api/inbox/conversations?${filters.convQueryParams}`],
    refetchInterval: 15000,
  });

  const { data: tabCounts } = useQuery<{ mine: number; pool: number; closed: number; spam: number; snoozed: number }>({
    queryKey: [`/api/inbox/conversations/tab-counts${filters.tabCountsTenantParam}`],
    refetchInterval: 15000,
  });

  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });

  const getSlaConfigForConv = (conv: { tenantId?: string }) => {
    const tid = conv.tenantId;
    if (!tid) return undefined;
    const tenant = tenants?.find((t) => t._id === tid);
    return tenant?.slaConfig;
  };

  const channelStatusTenantId = filters.filterTenantId !== "__all__" ? filters.filterTenantId : currentTenantId || "";
  const channelStatusUrl = channelStatusTenantId ? `/api/inbox/channel-status?tenantId=${channelStatusTenantId}` : undefined;
  const { data: channelStatus } = useQuery<{ whatsapp: { tokenExpired: boolean; tokenExpiredAt?: string; hasCredentials?: boolean } }>({
    queryKey: [channelStatusUrl],
    enabled: !!channelStatusUrl,
    refetchInterval: 60000,
  });
  const whatsappTokenExpired = channelStatus?.whatsapp?.tokenExpired ?? false;

  const selectedConv = conversations.find((c) => c._id === selectedConvId);

  const mediaCachePerConvRef = useRef<Record<string, MediaCache>>({});
  const mediaBatchLoadedPerConvRef = useRef<Record<string, boolean>>({});
  const mediaBatchFetchedRef = useRef<Set<string>>(new Set());
  const [mediaCache, setMediaCache] = useState<MediaCache>({});
  const [mediaBatchLoaded, setMediaBatchLoaded] = useState(false);

  const socketHook = useInboxSocket({
    currentRole, currentTenantId,
    filterTenantId: filters.filterTenantId,
    selectedConvId,
    invalidateConvList,
    mediaCachePerConvRef, setMediaCache,
    selectedConvIdRef, filterTenantIdRef, currentTenantIdRef, tenantsRef,
    setSelectedConvId, setMobileView,
    unreadCounts, setUnreadCounts,
    tenants,
  });

  const mutationsHook = useInboxMutations({
    t, i18n, toast, currentRole, currentTenantId, authUser,
    selectedConvId, selectedConvIdRef, selectedConv, invalidateConvList,
    activeTenantId: filters.activeTenantId,
    filterTenantId: filters.filterTenantId,
    inputMode, setInputText, setReplyToMessage, replyToMessage, richEditorRef,
    resolveTags, resolveSummary,
    setSelectedConvId, setMobileView,
    setShowResolveDialog, setResolveTags, setResolveSummary,
    setShowTransfer,
    setShowSnooze, setShowSnoozeEdit, setSnoozeTargetAgent,
    setShowMergeDialog, setMergeTargetId,
    updatePresence,
    setEditingMessage, setEditContent,
    setShowForwardDialog, setForwardMessageId, setForwardTargetConvId,
    setShowSuggestDialog, setSuggestMessageId, setSuggestQuestion, setSuggestAnswer, setSuggestTeamId,
    setAttachedFiles, attachedFiles,
    setUnreadCounts,
    setPreviewMedia,
    inputText,
  });

  const tagUsageUrl = filters.activeTenantId ? `/api/inbox/tag-usage?tenantId=${filters.activeTenantId}` : undefined;
  const { data: tagUsageRaw } = useQuery<{tag: string; count: number}[]>({
    queryKey: [tagUsageUrl],
    enabled: !!tagUsageUrl,
  });
  const tagUsage = Array.isArray(tagUsageRaw) ? tagUsageRaw : [];

  useEffect(() => {
    if (!selectedConvId || conversations.length === 0) return;
    if (!selectedConv) {
      const sameCustomerConv = conversations[0];
      if (sameCustomerConv) {
        setSelectedConvId(sameCustomerConv._id);
        selectedConvIdRef.current = sameCustomerConv._id;
        const socket = socketHook.socketRef.current;
        if (socket?.connected) {
          socket.emit("leave-conversation", selectedConvId);
          socket.emit("join-conversation", sameCustomerConv._id);
        }
      } else {
        setSelectedConvId(null);
        selectedConvIdRef.current = null;
      }
    }
  }, [conversations, selectedConvId, selectedConv]);

  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`],
    enabled: !!selectedConvId,
    refetchInterval: 10000,
    select: (data: any) => Array.isArray(data) ? data : (data?.messages ?? []),
  });

  useEffect(() => {
    if (!selectedConvId) return;
    const cached = mediaCachePerConvRef.current[selectedConvId];
    if (cached && Object.keys(cached).length > 0) {
      setMediaCache(cached);
      setMediaBatchLoaded(mediaBatchLoadedPerConvRef.current[selectedConvId] ?? false);
    } else {
      setMediaCache({});
      setMediaBatchLoaded(false);
    }
  }, [selectedConvId]);

  useEffect(() => {
    if (!selectedConvId || messages.length === 0) return;
    if (mediaBatchFetchedRef.current.has(selectedConvId)) return;
    const mediaMessages = messages.filter((m: any) => m.hasMedia && !m.metadata?.base64 && !(m.metadata as any)?.mediaInfo?.base64);
    if (mediaMessages.length === 0) { setMediaBatchLoaded(true); mediaBatchLoadedPerConvRef.current[selectedConvId] = true; return; }
    mediaBatchFetchedRef.current.add(selectedConvId);
    const convId = selectedConvId;

    const videoMsgs = mediaMessages.filter((m) => m.type === "VIDEO");
    const nonVideoMsgs = mediaMessages.filter((m) => m.type !== "VIDEO");

    const videoStreamEntries: MediaCache = {};
    for (const vm of videoMsgs) {
      videoStreamEntries[vm._id] = {
        base64: "",
        mimeType: (vm.metadata as any)?.mimeType || "video/mp4",
        fileName: (vm.metadata as any)?.fileName || "video.mp4",
        streamUrl: undefined,
      };
    }
    if (Object.keys(videoStreamEntries).length > 0) {
      mediaCachePerConvRef.current[convId] = { ...(mediaCachePerConvRef.current[convId] || {}), ...videoStreamEntries };
      if (convId === selectedConvId) setMediaCache((prev) => ({ ...prev, ...videoStreamEntries }));
    }

    const nonVideoIds = nonVideoMsgs.map((m) => m._id);
    if (nonVideoIds.length > 0) {
      fetchMediaBatchProgressive(
        nonVideoIds,
        (chunk) => {
          mediaCachePerConvRef.current[convId] = { ...(mediaCachePerConvRef.current[convId] || {}), ...chunk };
          setMediaCache((prev) => ({ ...prev, ...chunk }));
        },
      ).then(() => {
        mediaBatchLoadedPerConvRef.current[convId] = true;
        setMediaBatchLoaded(true);
      });
    } else {
      mediaBatchLoadedPerConvRef.current[convId] = true;
      setMediaBatchLoaded(true);
    }
  }, [selectedConvId, messages]);

  const customerId = selectedConv?.customerId;
  const { data: journeyRaw = [], isLoading: journeyLoading } = useQuery<JourneyConversation[]>({
    queryKey: ["/api/inbox/customers", customerId, "journey"],
    queryFn: () => apiRequest("GET", `/api/inbox/customers/${customerId}/journey`).then(r => r.json()),
    enabled: !!customerId,
  });

  const { data: handlers = [] } = useQuery<{conversationId: string; assignedName?: string; resolutionTag?: string; resolutionSummary?: string; channel: string; resolvedAt: string; agents: string[]}[]>({
    queryKey: ["/api/inbox/customers", customerId, "handlers"],
    queryFn: () => apiRequest("GET", `/api/inbox/customers/${customerId}/handlers`).then(r => r.json()),
    enabled: !!customerId,
  });

  const journey = useMemo(() =>
    [...journeyRaw].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [journeyRaw]
  );

  const auditQuery = useQuery<{ participants: { userId: string; name: string; role: string; messageCount: number }[]; auditTrail: { messageId: string; originalContent: string; originalType?: string; archivedAt: string; archivedBy: string; currentContent: string; editedAt?: string; deletedAt?: string; editedBy?: string; deletedBy?: string }[]; timeline: { messageId: string; content: string; createdAt: string; metadata: any; senderName: string }[] }>({
    queryKey: ['/api/inbox/conversations/' + selectedConvId + '/audit?tenantId=' + currentTenantId],
    enabled: !!selectedConvId && showAuditPanel,
  });

  const [expandedJourneyConvs, setExpandedJourneyConvs] = useState<Set<string>>(new Set());

  const toggleJourneyConv = (convId: string) => {
    setExpandedJourneyConvs(prev => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId);
      else next.add(convId);
      return next;
    });
  };

  const jumpToConversation = (convId: string) => {
    setSelectedConvId(convId);
    setMobileView("chat");
  };

  useEffect(() => {
    selectedConvIdRef.current = selectedConvId;
    socketHook.setTypingConvId(null);
    socketHook.setTypingName("");
    if (selectedConvId) {
      setUnreadCounts((prev) => ({
        ...prev,
        [selectedConvId]: 0,
      }));
    }
  }, [selectedConvId]);

  const prevConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!messagesEndRef.current) return;
    const isNewConv = prevConvIdRef.current !== selectedConvId;
    prevConvIdRef.current = selectedConvId;
    const behavior = isNewConv ? "instant" as ScrollBehavior : "smooth";
    const doScroll = () => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    };
    doScroll();
    const t1 = setTimeout(doScroll, 100);
    const t2 = setTimeout(doScroll, 400);
    const t3 = setTimeout(doScroll, 800);
    const t4 = setTimeout(doScroll, 1500);

    const container = messagesEndRef.current?.parentElement;
    let mutObserver: MutationObserver | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    if (isNewConv && container) {
      let mutScrollCount = 0;
      mutObserver = new MutationObserver(() => {
        if (mutScrollCount < 15) {
          mutScrollCount++;
          messagesEndRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
        }
      });
      mutObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style", "class"] });
      disconnectTimer = setTimeout(() => mutObserver?.disconnect(), 4000);
    }

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      mutObserver?.disconnect();
    };
  }, [messages, selectedConvId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      mutationsHook.handleSend();
    }
  }

  function handleEmojiSelect(emoji: any) {
    const native = emoji.native as string;
    if (richEditorRef.current) {
      richEditorRef.current.commands.insertContent(native);
      richEditorRef.current.commands.focus();
    } else {
      setInputText((prev) => prev + native);
      textareaRef.current?.focus();
    }
    setShowEmojiPicker(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  const autoResizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = 8 * 24;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [inputText, autoResizeTextarea]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files]);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeFile = useCallback((idx: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!selectedConvId) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          setPastePreviewFile(blob);
          setPasteCaption("");
        }
        break;
      }
    }
  }, [selectedConvId]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  async function sendPastedImage() {
    if (!selectedConvId || !pastePreviewFile) return;
    let file: File = pastePreviewFile;
    const caption = pasteCaption.trim();
    setPastePreviewFile(null);
    setPasteCaption("");

    try { file = await compressImageFile(file); } catch { /* use original */ }
    const mimeType = file.type || "image/png";
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ext = (file.type === "image/jpeg") ? "jpg" : "png";
      const fileName = file.name || `screenshot-${Date.now()}.${ext}`;
      const url = `/api/inbox/conversations/${selectedConvId}/media?type=IMAGE&fileName=${encodeURIComponent(fileName)}${caption ? `&caption=${encodeURIComponent(caption)}` : ""}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": mimeType, "Authorization": `Bearer ${localStorage.getItem("auth_token") || ""}` },
        credentials: "include",
        body: arrayBuffer,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: "Upload failed" }));
        toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
    invalidateConvList();
  }

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const startX = e.clientX;
    const startWidth = crmPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - startX;
      const newWidth = rtl
        ? Math.min(600, Math.max(200, startWidth + delta))
        : Math.min(600, Math.max(200, startWidth - delta));
      setCrmPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setCrmPanelWidth(w => { try { localStorage.setItem("inbox_crm_width", String(w)); } catch {} return w; });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [crmPanelWidth, rtl]);

  const handleListResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingListRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const startX = e.clientX;
    const startWidth = listPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingListRef.current) return;
      const delta = ev.clientX - startX;
      const newWidth = rtl
        ? Math.min(500, Math.max(200, startWidth - delta))
        : Math.min(500, Math.max(200, startWidth + delta));
      setListPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      isDraggingListRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setListPanelWidth(w => { try { localStorage.setItem("inbox_list_width", String(w)); } catch {} return w; });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [listPanelWidth, rtl]);

  const scrollToAgentMessage = useCallback((agentName: string) => {
    const msgElements = Array.from(document.querySelectorAll('[data-testid^="msg-outbound-"]'));
    for (const el of msgElements) {
      const nameEl = el.querySelector("p.text-xs.font-medium");
      if (nameEl && nameEl.textContent?.includes(agentName)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary");
        setTimeout(() => el.classList.remove("ring-2", "ring-primary"), 2000);
        setShowAuditPanel(false);
        break;
      }
    }
  }, []);

  const handleCrmDividerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingCrmDividerRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const startY = e.clientY;
    const startHeight = crmTopHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingCrmDividerRef.current) return;
      const delta = ev.clientY - startY;
      setCrmTopHeight(Math.min(600, Math.max(100, startHeight + delta)));
    };

    const onMouseUp = () => {
      isDraggingCrmDividerRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      setCrmTopHeight(h => { try { localStorage.setItem("inbox_crm_top_height", String(h)); } catch {} return h; });
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [crmTopHeight]);

  useEffect(() => {
    return () => {
      if (isDraggingCrmDividerRef.current) {
        isDraggingCrmDividerRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  function selectConversation(convId: string) {
    setSelectedConvId(convId);
    setMobileView("chat");
    setInputText("");
    setInputMode("message");
    setEmailSubject("");
    setAttachedFiles([]);
    setShowEmojiPicker(false);
    const conv = conversations.find(c => c._id === convId);
    const eu = unreadCounts[convId] !== undefined ? unreadCounts[convId] : (conv?.unreadCount || 0);
    if (eu > 0) {
      setUnreadCounts((prev) => ({ ...prev, [convId]: 0 }));
      const convCacheQueries = queryClient.getQueryCache().findAll({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages") && !k.includes("tab-counts");
        },
      });
      for (const cq of convCacheQueries) {
        const data = queryClient.getQueryData<Conversation[]>(cq.queryKey);
        if (data) {
          const idx = data.findIndex((c) => String(c._id) === convId);
          if (idx !== -1) {
            const updated = [...data];
            updated[idx] = { ...updated[idx], unreadCount: 0 };
            queryClient.setQueryData<Conversation[]>(cq.queryKey, updated);
          }
        }
      }
      apiRequest("PATCH", `/api/inbox/conversations/${convId}/read`).then(() => {
        invalidateConvList();
      }).catch(() => {});
    }
  }

  const windowExpired = selectedConv?.channel === "WHATSAPP" && is24hExpired(selectedConv);
  const currentUserId = authUser?._id || "";
  const isMyConv = selectedConv?.assignedTo === currentUserId;
  const isUnassigned = !selectedConv?.assignedTo || selectedConv?.status === "UNASSIGNED" || selectedConv?.status === "OPEN";
  const isAdmin = currentRole === "superadmin" || currentRole === "businessadmin";
  const canSendMessage = !windowExpired && inputMode === "message" && (isMyConv || isAdmin || isUnassigned);
  const canSend = inputMode === "note" || canSendMessage || attachedFiles.length > 0;
  const BackIcon = rtl ? ArrowRight : ArrowLeft;

  const tenantMap = useMemo(() => {
    const map: Record<string, string> = {};
    tenants?.forEach((tn: any) => { map[tn._id] = tn.nameHe || tn.nameEn; });
    return map;
  }, [tenants]);

  const sortedTags = useMemo(() => {
    const usageMap: Record<string, number> = {};
    for (const u of tagUsage) usageMap[u.tag] = u.count;
    return [...(mutationsHook.tags || [])].sort((a, b) => (usageMap[b.name] || 0) - (usageMap[a.name] || 0));
  }, [mutationsHook.tags, tagUsage]);

  return {
    t, i18n, toast, currentRole, currentTenantId, authUser, rtl, isSuperAdmin, displayName,
    selectedConvId, setSelectedConvId, search: filters.search, setSearch: filters.setSearch,
    filterTenantId: filters.filterTenantId, setFilterTenantId: filters.setFilterTenantId,
    filterTab: filters.filterTab, setFilterTab: filters.setFilterTab,
    filterAgentId: filters.filterAgentId, setFilterAgentId: filters.setFilterAgentId,
    filterChannels: filters.filterChannels, setFilterChannels: filters.setFilterChannels,
    filterStatuses: filters.filterStatuses, setFilterStatuses: filters.setFilterStatuses,
    filterTags: filters.filterTags, setFilterTags: filters.setFilterTags,
    filterStarred: filters.filterStarred, setFilterStarred: filters.setFilterStarred,
    channelsInitialized: filters.channelsInitialized, showFilters: filters.showFilters, setShowFilters: filters.setShowFilters,
    showTransfer, setShowTransfer,
    inputMode, setInputMode, inputText, setInputText,
    showEmojiPicker, setShowEmojiPicker, emojiPickerRef,
    mobileView, setMobileView,
    emailSubject, setEmailSubject,
    dragOver, attachedFiles, setAttachedFiles,
    pastePreviewFile, setPastePreviewFile, pasteCaption, setPasteCaption,
    unreadCounts, setUnreadCounts, tick: socketHook.tick,
    typingConvId: socketHook.typingConvId, typingName: socketHook.typingName,
    crmPanelWidth, listPanelWidth, crmTopHeight,
    showAuditPanel, setShowAuditPanel,
    showResolveDialog, setShowResolveDialog, resolveTags, setResolveTags, resolveSummary, setResolveSummary,
    showSnooze, setShowSnooze, showSnoozeEdit, setShowSnoozeEdit,
    sendTemplateDialogOpen, setSendTemplateDialogOpen,
    snoozeCustomMode, setSnoozeCustomMode, snoozeDate, setSnoozeDate,
    snoozeHour, setSnoozeHour, snoozeMinute, setSnoozeMinute,
    snoozeTargetAgent, setSnoozeTargetAgent,
    showQuickReplies, setShowQuickReplies, quickReplySearch, setQuickReplySearch,
    showMergeDialog, setShowMergeDialog, mergeTargetId, setMergeTargetId,
    replyToMessage, setReplyToMessage,
    editingMessage, setEditingMessage, editContent, setEditContent,
    showForwardDialog, setShowForwardDialog, forwardMessageId, setForwardMessageId,
    forwardTargetConvId, setForwardTargetConvId,
    showSuggestDialog, setShowSuggestDialog, suggestMessageId, setSuggestMessageId,
    suggestQuestion, setSuggestQuestion, suggestAnswer, setSuggestAnswer, suggestTeamId, setSuggestTeamId,
    previewMedia, setPreviewMedia,
    isSending: mutationsHook.isSending, uploadProgress: mutationsHook.uploadProgress,
    isRecording: mutationsHook.isRecording, recordingTime: mutationsHook.recordingTime, playingAudioId: mutationsHook.playingAudioId,
    acwActive: mutationsHook.acwActive, acwSecondsLeft: mutationsHook.acwSecondsLeft, dismissAcw: mutationsHook.dismissAcw,
    messagesEndRef, richEditorRef, fileInputRef, textareaRef,
    activeTenantId: filters.activeTenantId, tenantChannelTypes: filters.tenantChannelTypes, tenantTags: filters.tenantTags,
    conversations, convsLoading, messages, msgsLoading,
    tabCounts, tenants, agents: mutationsHook.agents, tags: mutationsHook.tags, sortedTags, tagUsage, quickReplies: mutationsHook.quickReplies,
    channelStatus, whatsappTokenExpired,
    selectedConv, journey, journeyLoading, handlers,
    auditQuery, expandedJourneyConvs, toggleJourneyConv, jumpToConversation,
    mediaCache, mediaBatchLoaded,
    inboxTeams: mutationsHook.inboxTeams, pendingKnowledgeCount: mutationsHook.pendingKnowledgeCount, isManagerOrAdmin: mutationsHook.isManagerOrAdmin,
    sendMutation: mutationsHook.sendMutation, resolveMutation: mutationsHook.resolveMutation, updateTagsMutation: mutationsHook.updateTagsMutation, retryMutation: mutationsHook.retryMutation,
    snoozeMutation: mutationsHook.snoozeMutation, wakeMutation: mutationsHook.wakeMutation, claimMutation: mutationsHook.claimMutation, releaseMutation: mutationsHook.releaseMutation,
    transferMutation: mutationsHook.transferMutation, starMutation: mutationsHook.starMutation, spamMutation: mutationsHook.spamMutation, unspamMutation: mutationsHook.unspamMutation,
    mergeMutation: mutationsHook.mergeMutation, flagMutation: mutationsHook.flagMutation, deleteMessageMutation: mutationsHook.deleteMessageMutation, editMessageMutation: mutationsHook.editMessageMutation,
    forwardMutation: mutationsHook.forwardMutation, suggestKnowledgeMutation: mutationsHook.suggestKnowledgeMutation,
    getSlaConfigForConv,
    startRecording: mutationsHook.startRecording, stopRecording: mutationsHook.stopRecording, cancelRecording: mutationsHook.cancelRecording, toggleAudio: mutationsHook.toggleAudio,
    getMediaData: mutationsHook.getMediaData, openMediaPreview: mutationsHook.openMediaPreview,
    sendAttachedFiles: mutationsHook.sendAttachedFiles, handleSend: mutationsHook.handleSend, handleRichSend: mutationsHook.handleRichSend, handleKeyDown, handleEmojiSelect,
    handleDragOver, handleDragLeave, handleDrop, handleFileSelect, removeFile,
    sendPastedImage, handleResizeStart, handleListResizeStart, handleCrmDividerResizeStart,
    scrollToAgentMessage, selectConversation,
    windowExpired, currentUserId, isMyConv, isUnassigned, isAdmin, canSendMessage, canSend,
    BackIcon, tenantMap,
  };
}

import { WHATSAPP_SESSION_WINDOW_MS } from "@/lib/constants/limits";

function is24hExpired(conv?: { lastInboundAt?: string; lastMessageAt?: string; createdAt?: string } | null): boolean {
  if (!conv) return true;
  const ref = conv.lastInboundAt || conv.lastMessageAt || conv.createdAt;
  if (!ref) return true;
  return (Date.now() - new Date(ref).getTime()) > WHATSAPP_SESSION_WINDOW_MS;
}

export type MailboxData = ReturnType<typeof useMailboxData>;
