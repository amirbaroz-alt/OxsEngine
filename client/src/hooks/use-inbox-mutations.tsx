import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ToastAction } from "@/components/ui/toast";
import { compressImageFile } from "@/lib/compress-image";
import type { Editor } from "@tiptap/react";
import type { Message, Conversation, Agent } from "@/components/inbox/types";
import type { PresenceStatus } from "@/lib/auth-context";

function extractMessages(raw: unknown): Message[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "messages" in raw) {
    const msgs = (raw as any).messages;
    if (Array.isArray(msgs)) return msgs;
  }
  return [];
}

function setCacheMessages(key: string[], updated: Message[]) {
  const raw = queryClient.getQueryData(key);
  if (raw && !Array.isArray(raw) && typeof raw === "object" && "messages" in raw) {
    queryClient.setQueryData(key, { ...(raw as any), messages: updated });
  } else {
    queryClient.setQueryData<Message[]>(key, updated);
  }
}

interface UseInboxMutationsParams {
  t: (key: string, fallback?: string) => string;
  i18n: { language: string };
  toast: (opts: any) => void;
  currentRole: string;
  currentTenantId: string | undefined;
  authUser: any;
  selectedConvId: string | null;
  selectedConvIdRef: React.MutableRefObject<string | null>;
  selectedConv: Conversation | undefined;
  invalidateConvList: () => void;
  activeTenantId: string;
  filterTenantId: string;
  inputMode: "message" | "note";
  setInputText: (text: string) => void;
  setReplyToMessage: (msg: Message | null) => void;
  replyToMessage: Message | null;
  richEditorRef: React.MutableRefObject<Editor | null>;
  resolveTags: string[];
  resolveSummary: string;
  setSelectedConvId: (id: string | null) => void;
  setMobileView: (view: "list" | "chat") => void;
  setShowResolveDialog: (show: boolean) => void;
  setResolveTags: (tags: string[]) => void;
  setResolveSummary: (summary: string) => void;
  setShowTransfer: (show: boolean) => void;
  setShowSnooze: (show: boolean) => void;
  setShowSnoozeEdit: (show: boolean) => void;
  setSnoozeTargetAgent: (agent: string) => void;
  setShowMergeDialog: (show: boolean) => void;
  setMergeTargetId: (id: string) => void;
  updatePresence?: (status: PresenceStatus) => void;
  setEditingMessage: (msg: Message | null) => void;
  setEditContent: (content: string) => void;
  setShowForwardDialog: (show: boolean) => void;
  setForwardMessageId: (id: string | null) => void;
  setForwardTargetConvId: (id: string) => void;
  setShowSuggestDialog: (show: boolean) => void;
  setSuggestMessageId: (id: string | null) => void;
  setSuggestQuestion: (q: string) => void;
  setSuggestAnswer: (a: string) => void;
  setSuggestTeamId: (id: string) => void;
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  attachedFiles: File[];
  setUnreadCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setPreviewMedia: (media: { url: string; type: string; name: string } | null) => void;
  inputText: string;
}

export function useInboxMutations(params: UseInboxMutationsParams) {
  const {
    t, i18n, toast, currentRole, currentTenantId, authUser,
    selectedConvId, selectedConvIdRef, selectedConv, invalidateConvList,
    activeTenantId, filterTenantId,
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
    inputText,
  } = params;

  const [isSending, setIsSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [acwActive, setAcwActive] = useState(false);
  const [acwSecondsLeft, setAcwSecondsLeft] = useState(0);
  const acwTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preAcwPresenceRef = useRef<PresenceStatus>("active");

  function setPresenceApi(status: PresenceStatus) {
    apiRequest("PATCH", "/api/auth/presence", { presenceStatus: status }).catch(() => {});
    if (updatePresence) updatePresence(status);
  }

  function startAcw() {
    const limitMinutes = authUser?.acwTimeLimit ?? 3;
    if (limitMinutes <= 0) return;
    if (acwTimerRef.current) { clearInterval(acwTimerRef.current); acwTimerRef.current = null; }
    preAcwPresenceRef.current = (authUser?.presenceStatus as PresenceStatus) || "active";
    setPresenceApi("busy");
    const totalSeconds = limitMinutes * 60;
    setAcwSecondsLeft(totalSeconds);
    setAcwActive(true);
    acwTimerRef.current = setInterval(() => {
      setAcwSecondsLeft(prev => {
        if (prev <= 1) {
          if (acwTimerRef.current) { clearInterval(acwTimerRef.current); acwTimerRef.current = null; }
          setAcwActive(false);
          setPresenceApi(preAcwPresenceRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function dismissAcw() {
    if (acwTimerRef.current) { clearInterval(acwTimerRef.current); acwTimerRef.current = null; }
    setAcwActive(false);
    setAcwSecondsLeft(0);
    setPresenceApi(preAcwPresenceRef.current);
  }
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  const sendMutation = useMutation({
    mutationFn: async ({ content, htmlContent, isInternal, replyToMessageId, replyToContent, replyToSender }: { content: string; htmlContent?: string; isInternal: boolean; replyToMessageId?: string; replyToContent?: string; replyToSender?: string }) => {
      return apiRequest("POST", `/api/inbox/conversations/${selectedConvId}/messages`, { content, htmlContent, isInternal, replyToMessageId, replyToContent, replyToSender });
    },
    onMutate: async ({ content, htmlContent, isInternal, replyToMessageId, replyToContent, replyToSender }) => {
      const convId = selectedConvId;
      if (!convId) return;

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
      apiRequest("PATCH", `/api/inbox/conversations/${convId}/read`).catch(() => {});

      const messagesKey = [`/api/inbox/conversations/${convId}/messages?limit=200`];
      await queryClient.cancelQueries({ queryKey: messagesKey });
      const previous = queryClient.getQueryData<Message[]>(messagesKey);
      const optimisticMsg: Message = {
        _id: `optimistic-${Date.now()}`,
        conversationId: convId,
        tenantId: "",
        direction: "OUTBOUND",
        content: content.trim(),
        ...(htmlContent ? { htmlContent } : {}),
        type: "TEXT",
        channel: "WHATSAPP",
        isInternal: !!isInternal,
        senderName: authUser?.name || "You",
        senderId: authUser?._id,
        senderRole: currentRole,
        deliveryStatus: "sending",
        createdAt: new Date().toISOString(),
        ...(replyToMessageId ? { replyToMessageId, replyToContent, replyToSender } : {}),
      } as any;
      setCacheMessages(messagesKey, [...extractMessages(queryClient.getQueryData(messagesKey)), optimisticMsg]);
      setInputText("");
      setReplyToMessage(null);
      if (richEditorRef.current) {
        richEditorRef.current.commands.clearContent();
      }
      return { previous, convId };
    },
    onSuccess: (_data, _vars, context: any) => {
      if (!context?.convId) return;
      queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${context.convId}/messages?limit=200`] });
      invalidateConvList();
    },
    onError: (err: any, _vars: any, context: any) => {
      if (context?.previous && context?.convId) {
        queryClient.setQueryData<Message[]>([`/api/inbox/conversations/${context.convId}/messages?limit=200`], context.previous);
      }
      const msg = err.message || "";
      if (msg.includes("CONV_LOCKED")) {
        toast({ title: t("inbox.convLocked", "Conversation is assigned to another agent"), variant: "destructive" });
        return;
      } else if (msg.includes("24H_WINDOW_EXPIRED")) {
        toast({ title: t("inbox.windowExpired", "24h window expired"), description: t("inbox.useTemplate", "Use a template to re-engage"), variant: "destructive" });
      } else if (msg.includes("WHATSAPP_TOKEN_EXPIRED") || /access token|session is invalid/i.test(msg)) {
        toast({
          title: t("inbox.tokenExpired", "WhatsApp token expired"),
          description: t("inbox.tokenExpiredDesc", "The WhatsApp access token for this tenant needs to be refreshed in Settings"),
          variant: "destructive",
          action: (
            <ToastAction
              altText={t("inbox.goToSettings", "Go to Settings")}
              onClick={() => { window.location.href = "/settings"; }}
              data-testid="button-toast-go-settings"
            >
              {t("inbox.goToSettings", "Go to Settings")}
            </ToastAction>
          ),
        });
        queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/inbox/channel-status" });
      } else {
        toast({ title: t("common.error", "Error"), description: msg, variant: "destructive" });
      }
    },
  });

  const updateTagsMutation = useMutation({
    mutationFn: async ({ convId, tags }: { convId: string; tags: string[] }) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/tags?tenantId=${activeTenantId}`, { tags });
    },
    onMutate: async ({ convId, tags }) => {
      queryClient.setQueriesData<Conversation[]>(
        { predicate: (q) => { const k = q.queryKey[0]; return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages"); } },
        (old) => old?.map(c => c._id === convId ? { ...c, tags } : c)
      );
    },
    onSuccess: () => {
      invalidateConvList();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inbox/conversations/${selectedConvId}/resolve`, { tags: resolveTags, resolutionTag: resolveTags[0] || "", resolutionSummary: resolveSummary });
    },
    onSuccess: () => {
      toast({ title: t("inbox.resolved", "Conversation resolved") });
      const resolvedId = selectedConvId;
      setSelectedConvId(null);
      setMobileView("list");
      setShowResolveDialog(false);
      setResolveTags([]);
      setResolveSummary("");
      startAcw();
      if (resolvedId) {
        queryClient.setQueriesData<Conversation[]>(
          { predicate: (q) => { const k = q.queryKey[0]; return typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages"); } },
          (old) => old ? old.filter(c => c._id !== resolvedId) : old
        );
      }
      invalidateConvList();
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (messageId: string) => {
      return apiRequest("POST", `/api/inbox/messages/${messageId}/retry`);
    },
    onSuccess: (_data, messageId) => {
      const activeConvId = selectedConvIdRef.current;
      if (activeConvId) {
        const messagesKey = `/api/inbox/conversations/${activeConvId}/messages?limit=200`;
        queryClient.invalidateQueries({ queryKey: [messagesKey] });
      }
      toast({ title: t("inbox.retrySuccess", "Message resent successfully") });
    },
    onError: (err: any) => {
      toast({ title: t("inbox.retryFailed", "Retry failed"), description: err.message, variant: "destructive" });
    },
  });

  const agentsTenantId = filterTenantId !== "__all__" ? filterTenantId : currentTenantId || "";
  const inboxAgentsUrl = agentsTenantId ? `/api/inbox/agents?tenantId=${agentsTenantId}` : undefined;
  const { data: agentsRaw } = useQuery<Agent[]>({
    queryKey: [inboxAgentsUrl],
    enabled: !!inboxAgentsUrl,
  });
  const agents = Array.isArray(agentsRaw) ? agentsRaw : [];

  const agentTeamIds = (authUser as any)?.teamIds as string[] | undefined;
  const tagsTeamParam = agentTeamIds?.length ? `&teamIds=${agentTeamIds.join(",")}` : "";
  const inboxTagsUrl = agentsTenantId ? `/api/tags?tenantId=${agentsTenantId}&scope=conversation${tagsTeamParam}` : undefined;
  const { data: tagsRaw } = useQuery<{_id: string; name: string; color: string; teamId?: string}[]>({
    queryKey: [inboxTagsUrl],
    enabled: !!inboxTagsUrl,
  });
  const tags = Array.isArray(tagsRaw) ? tagsRaw : [];

  const quickRepliesUrl = agentsTenantId ? `/api/quick-replies?tenantId=${agentsTenantId}` : undefined;
  const { data: quickRepliesRaw } = useQuery<{_id: string; title: string; content: string; category: string}[]>({
    queryKey: [quickRepliesUrl],
    enabled: !!quickRepliesUrl,
  });
  const quickReplies = Array.isArray(quickRepliesRaw) ? quickRepliesRaw : [];

  const snoozeMutation = useMutation({
    mutationFn: async ({ snoozedUntil, snoozeWakeAgentId }: { snoozedUntil: string; snoozeWakeAgentId?: string }) => {
      const res = await apiRequest("PATCH", `/api/inbox/conversations/${selectedConvId}/snooze`, { snoozedUntil, snoozeWakeAgentId });
      try { return await res.json(); } catch { return null; }
    },
    onSuccess: (updatedConv: any) => {
      toast({ title: t("inbox.snoozed", "Conversation snoozed") });
      setShowSnooze(false);
      setShowSnoozeEdit(false);
      setSnoozeTargetAgent("");
      if (updatedConv?._id) {
        for (const q of queryClient.getQueryCache().findAll()) {
          const k = q.queryKey[0];
          if (typeof k === "string" && k.startsWith("/api/inbox/conversations") && !k.includes("/messages") && !k.includes("tab-counts")) {
            queryClient.setQueryData<any[]>(q.queryKey, (old) =>
              old?.map((c: any) => c._id === updatedConv._id ? { ...c, ...updatedConv } : c)
            );
          }
        }
      }
      invalidateConvList();
    },
  });

  const wakeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/inbox/conversations/${selectedConvId}/wake`);
    },
    onSuccess: () => {
      toast({ title: t("inbox.woken", "Conversation active again") });
      invalidateConvList();
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (convId: string) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/claim`);
    },
    onSuccess: () => {
      toast({ title: t("inbox.claimed", "Conversation claimed") });
      setSelectedConvId(null);
      setMobileView("list");
      invalidateConvList();
    },
    onError: (err: any) => {
      if (err.message?.includes("ALREADY_CLAIMED")) {
        toast({ title: t("inbox.alreadyClaimed", "Already claimed by another agent"), variant: "destructive" });
      } else {
        toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
      }
      invalidateConvList();
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (convId: string) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/release`);
    },
    onSuccess: () => {
      toast({ title: t("inbox.released", "Conversation released to pool") });
      setSelectedConvId(null);
      setMobileView("list");
      invalidateConvList();
    },
  });

  const transferMutation = useMutation({
    mutationFn: async ({ convId, targetUserId, targetUserName }: { convId: string; targetUserId: string; targetUserName: string }) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/transfer`, { targetUserId, targetUserName });
    },
    onSuccess: () => {
      toast({ title: t("inbox.transferred", "Conversation transferred") });
      setShowTransfer(false);
      invalidateConvList();
    },
  });

  const starMutation = useMutation({
    mutationFn: async (convId: string) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/star`);
    },
    onSuccess: () => {
      invalidateConvList();
    },
  });

  const spamMutation = useMutation({
    mutationFn: async (convId: string) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/spam`);
    },
    onSuccess: () => {
      toast({ title: t("inbox.markedSpam", "Marked as spam") });
      setSelectedConvId(null);
      setMobileView("list");
      invalidateConvList();
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const unspamMutation = useMutation({
    mutationFn: async (convId: string) => {
      return apiRequest("PATCH", `/api/inbox/conversations/${convId}/unspam`);
    },
    onSuccess: () => {
      toast({ title: t("inbox.restoredFromSpam", "Conversation restored from spam") });
      setSelectedConvId(null);
      setMobileView("list");
      invalidateConvList();
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ targetConvId, sourceConvId }: { targetConvId: string; sourceConvId: string }) => {
      return apiRequest("POST", `/api/inbox/conversations/merge`, { targetConvId, sourceConvId });
    },
    onSuccess: () => {
      toast({ title: t("inbox.merged", "Conversations merged") });
      setShowMergeDialog(false);
      setMergeTargetId("");
      invalidateConvList();
      if (selectedConvId) {
        queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      }
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const flagMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("PATCH", `/api/inbox/messages/${messageId}/flag`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data?.flagged ? t("inbox.messageFlagged", "Message flagged") : t("inbox.messageUnflagged", "Flag removed") });
      if (selectedConvId) {
        queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      }
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("PATCH", `/api/inbox/messages/${messageId}/delete`, { language: i18n.language });
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: () => {
      toast({ title: t("inbox.messageDeleted", "Message deleted") });
      if (selectedConvId) {
        queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      }
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err?.detail || err?.message || "Unknown error", variant: "destructive" });
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      const res = await apiRequest("PATCH", `/api/inbox/messages/${messageId}/edit`, { content });
      let data: any;
      try {
        data = await res.json();
      } catch {
        data = { message: "UNKNOWN_ERROR", detail: `Status ${res.status}` };
      }
      if (!res.ok) throw data;
      return data;
    },
    onSuccess: () => {
      toast({ title: t("inbox.messageEdited", "Message edited") });
      setEditingMessage(null);
      setEditContent("");
      if (selectedConvId) {
        queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      }
    },
    onError: (err: any) => {
      const code = err?.message || "";
      if (code === "EDIT_MEDIA_NOT_SUPPORTED") {
        toast({ title: t("inbox.editMediaNotSupported", "Media messages cannot be edited. Please delete and re-send."), variant: "destructive" });
      } else if (code === "EDIT_EXPIRED") {
        const expiredMessages: Record<string, string> = {
          he: "לא ניתן לעדכן הודעה שנשלחה לפני יותר מ-15 דקות.",
          en: "Cannot edit messages sent more than 15 minutes ago.",
          ar: "لا يمكن تعديل الرسائل المرسلة منذ أكثر من 15 دقيقة.",
          ru: "Невозможно редактировать сообщения, отправленные более 15 минут назад.",
        };
        const lang = i18n.language in expiredMessages ? i18n.language : "he";
        toast({ title: expiredMessages[lang], variant: "destructive" });
      } else {
        toast({ title: t("common.error", "Error"), description: err?.detail || code, variant: "destructive" });
      }
      setEditingMessage(null);
      setEditContent("");
    },
  });

  const forwardMutation = useMutation({
    mutationFn: async ({ messageId, targetConversationId, targetPhone }: { messageId: string; targetConversationId?: string; targetPhone?: string }) => {
      const res = await apiRequest("POST", `/api/inbox/messages/${messageId}/forward?tenantId=${activeTenantId}`, { targetConversationId, targetPhone });
      const data = await res.json();
      return data;
    },
    onSuccess: (data: any) => {
      const waStatus = data?.metadata?.waStatus;
      if (waStatus === "failed") {
        toast({ title: t("inbox.forwardSentNotDelivered", "ההודעה נשמרה אך לא נשלחה בוואטסאפ"), variant: "destructive" });
      } else {
        toast({ title: t("inbox.messageForwarded", "הודעה הועברה בהצלחה") });
      }
      setShowForwardDialog(false);
      setForwardMessageId(null);
      setForwardTargetConvId("");
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const suggestKnowledgeMutation = useMutation({
    mutationFn: async (data: { messageId: string; teamId: string; question: string; answer: string }) => {
      return apiRequest("POST", `/api/suggested-knowledge?tenantId=${activeTenantId}`, data);
    },
    onSuccess: () => {
      toast({ title: t("inbox.knowledgeSuggested", "Knowledge suggestion submitted") });
      setShowSuggestDialog(false);
      setSuggestMessageId(null);
      setSuggestQuestion("");
      setSuggestAnswer("");
      setSuggestTeamId("");
      if (selectedConvId) {
        queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      }
    },
    onError: (err: any) => {
      toast({ title: t("common.error", "Error"), description: err.message, variant: "destructive" });
    },
  });

  const inboxTeamsUrl = activeTenantId ? `/api/teams?tenantId=${activeTenantId}` : undefined;
  const { data: inboxTeams = [] } = useQuery<{ _id: string; name: string; managerId?: string }[]>({
    queryKey: [inboxTeamsUrl],
    enabled: !!inboxTeamsUrl,
  });

  const isManagerOrAdmin = authUser?.role === "superadmin" || authUser?.role === "businessadmin" || authUser?.role === "teamleader";
  const knowledgeCountUrl = activeTenantId ? `/api/suggested-knowledge/count?tenantId=${activeTenantId}` : undefined;
  const { data: knowledgeCountData } = useQuery<{ count: number }>({
    queryKey: [knowledgeCountUrl],
    enabled: !!knowledgeCountUrl && isManagerOrAdmin,
    refetchInterval: 30000,
  });
  const pendingKnowledgeCount = knowledgeCountData?.count || 0;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/ogg; codecs=opus") ? "audio/ogg; codecs=opus" : MediaRecorder.isTypeSupported("audio/webm; codecs=opus") ? "audio/webm; codecs=opus" : "audio/webm";
      const fileExt = mimeType.startsWith("audio/ogg") ? "ogg" : "webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const rawBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (rawBlob.size > 0 && selectedConvId) {
          setIsSending(true);
          startProgressSimulation();
          const fileName = `voice_${Date.now()}.${fileExt}`;
          try {
            const resp = await fetch(`/api/inbox/conversations/${selectedConvId}/media?type=AUDIO&fileName=${encodeURIComponent(fileName)}`, {
              method: "POST",
              headers: { "Content-Type": mimeType, "Authorization": `Bearer ${localStorage.getItem("auth_token") || ""}` },
              credentials: "include",
              body: rawBlob,
            });
            if (resp.ok) {
              queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
              invalidateConvList();
            } else {
              const errData = await resp.json().catch(() => null);
              const errDetail = errData?.message === "24H_WINDOW_EXPIRED" ? t("inbox.windowExpiredMsg", "24h window expired") : errData?.message || "";
              toast({ title: t("inbox.voiceFailed", "Failed to send voice message"), description: errDetail, variant: "destructive" });
            }
          } finally {
            stopProgressSimulation();
            setIsSending(false);
          }
        }
        setRecordingTime(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch {
      toast({ title: t("inbox.micDenied", "Microphone access denied"), variant: "destructive" });
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && isRecording) {
      audioChunksRef.current = [];
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    }
  }

  function toggleAudio(msgId: string, base64: string, mimeType: string) {
    if (playingAudioId === msgId) {
      const el = audioElementsRef.current[msgId];
      if (el) { el.pause(); el.currentTime = 0; }
      setPlayingAudioId(null);
      return;
    }
    if (playingAudioId) {
      const prev = audioElementsRef.current[playingAudioId];
      if (prev) { prev.pause(); prev.currentTime = 0; }
    }
    let el = audioElementsRef.current[msgId];
    if (!el) {
      el = new Audio(`data:${mimeType};base64,${base64}`);
      el.onended = () => setPlayingAudioId(null);
      audioElementsRef.current[msgId] = el;
    }
    el.play();
    setPlayingAudioId(msgId);
  }

  function getMediaData(msg: Message): { base64: string; mimeType: string; fileName?: string } | null {
    if (msg.metadata?.base64) {
      return { base64: msg.metadata.base64, mimeType: msg.metadata.mimeType || "application/octet-stream", fileName: msg.metadata.fileName };
    }
    const mi = (msg.metadata as any)?.mediaInfo;
    if (mi?.base64) {
      return { base64: mi.base64, mimeType: mi.mimeType || "application/octet-stream", fileName: mi.fileName };
    }
    return null;
  }

  function openMediaPreview(msg: Message) {
    const media = getMediaData(msg);
    if (!media) return;
    const url = isTiffMime(media.mimeType)
      ? (tiffBase64ToPngDataUrl(media.base64) || `data:${media.mimeType};base64,${media.base64}`)
      : `data:${media.mimeType};base64,${media.base64}`;
    params.setPreviewMedia!({ url, type: msg.type, name: media.fileName || msg.content });
  }

  function startProgressSimulation() {
    setUploadProgress(10);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    const start = Date.now();
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const target = Math.min(10 + (elapsed / 3000) * 80, 90);
      setUploadProgress(Math.round(target));
      if (target >= 90 && progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    }, 100);
  }

  function stopProgressSimulation() {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    setUploadProgress(100);
    setTimeout(() => setUploadProgress(0), 400);
  }

  async function sendAttachedFiles() {
    if (!selectedConvId || attachedFiles.length === 0) return;
    setIsSending(true);
    startProgressSimulation();
    try {
      for (const rawFile of attachedFiles) {
        let file = rawFile;
        const origMime = file.type || "application/octet-stream";
        let mediaType = "DOCUMENT";
        if (origMime.startsWith("image/")) {
          mediaType = "IMAGE";
          try { file = await compressImageFile(file); } catch { /* use original */ }
        } else if (origMime.startsWith("video/")) {
          mediaType = "VIDEO";
        } else if (origMime.startsWith("audio/")) {
          mediaType = "AUDIO";
        }

        try {
          const arrayBuffer = await file.arrayBuffer();
          const finalMime = file.type || origMime;
          console.log(`[upload] Sending: name=${file.name}, mime=${finalMime}, size=${arrayBuffer.byteLength}, type=${mediaType}`);
          const resp = await fetch(`/api/inbox/conversations/${selectedConvId}/media?type=${mediaType}&fileName=${encodeURIComponent(file.name)}`, {
            method: "POST",
            headers: { "Content-Type": finalMime, "Authorization": `Bearer ${localStorage.getItem("auth_token") || ""}` },
            credentials: "include",
            body: arrayBuffer,
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ message: "Upload failed" }));
            toast({ title: t("common.error", "Error"), description: err.message || file.name, variant: "destructive" });
          }
        } catch (err: any) {
          toast({ title: t("common.error", "Error"), description: err.message || file.name, variant: "destructive" });
        }
      }
      setAttachedFiles([]);
      queryClient.invalidateQueries({ queryKey: [`/api/inbox/conversations/${selectedConvId}/messages?limit=200`] });
      invalidateConvList();
    } finally {
      stopProgressSimulation();
      setIsSending(false);
    }
  }

  function handleSend() {
    if (!selectedConvId || isSending || sendMutation.isPending) return;

    const hasFiles = attachedFiles.length > 0;
    if (hasFiles) {
      sendAttachedFiles();
    }

    const replyData = replyToMessage ? {
      replyToMessageId: replyToMessage._id,
      replyToContent: replyToMessage.content?.substring(0, 200),
      replyToSender: replyToMessage.senderName || (replyToMessage.direction === "INBOUND" ? selectedConv?.customer?.firstName : undefined),
    } : {};
    const editor = richEditorRef.current;
    if (editor) {
      const plainText = editor.getText().trim();
      if (!plainText) return;
      const html = editor.getHTML();
      sendMutation.mutate({ content: plainText, htmlContent: html, isInternal: inputMode === "note", ...replyData });
    } else {
      if (!inputText.trim()) return;
      sendMutation.mutate({ content: inputText.trim(), isInternal: inputMode === "note", ...replyData });
    }
  }

  function handleRichSend(html: string, plainText: string) {
    if (!plainText.trim() || !selectedConvId || isSending || sendMutation.isPending) return;
    const replyData = replyToMessage ? {
      replyToMessageId: replyToMessage._id,
      replyToContent: replyToMessage.content?.substring(0, 200),
      replyToSender: replyToMessage.senderName || (replyToMessage.direction === "INBOUND" ? selectedConv?.customer?.firstName : undefined),
    } : {};
    sendMutation.mutate({ content: plainText.trim(), htmlContent: html, isInternal: inputMode === "note", ...replyData });
  }

  return {
    agents, tags, quickReplies,
    inboxTeams, pendingKnowledgeCount, isManagerOrAdmin,
    sendMutation, resolveMutation, updateTagsMutation, retryMutation,
    snoozeMutation, wakeMutation, claimMutation, releaseMutation,
    transferMutation, starMutation, spamMutation, unspamMutation,
    mergeMutation, flagMutation, deleteMessageMutation, editMessageMutation,
    forwardMutation, suggestKnowledgeMutation,
    isSending, uploadProgress,
    isRecording, recordingTime, playingAudioId,
    acwActive, acwSecondsLeft, dismissAcw,
    startRecording, stopRecording, cancelRecording, toggleAudio,
    getMediaData, openMediaPreview,
    sendAttachedFiles, handleSend, handleRichSend,
  };
}

function isTiffMime(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType === "image/tiff" || mimeType === "image/tif";
}

function tiffBase64ToPngDataUrl(base64: string): string | null {
  try {
    const UTIF = require("utif");
    const binary = atob(base64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    const ifds = UTIF.decode(buf.buffer);
    if (!ifds.length) return null;
    UTIF.decodeImage(buf.buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const w = ifds[0].width;
    const h = ifds[0].height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(new Uint8ClampedArray(rgba.buffer));
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
