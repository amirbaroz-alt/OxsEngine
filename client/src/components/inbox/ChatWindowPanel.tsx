import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Send, StickyNote, CheckCircle2, MessageCircle,
  Clock, Lock, User, CalendarDays,
  ChevronDown, ArrowRight,
  Paperclip, X, AlertTriangle, RotateCcw, Smile, Pin,
  UserCheck, Unlock, AlarmClock, Zap,
  ArrowRightLeft, ShieldAlert, GitMerge,
  Reply, Forward, Flag, Trash2, Pencil, MoreVertical,
  Lightbulb, Mic, MicOff,
  FileStack, Info, Loader2, Check, Tag, Type,
  UserPlus, ImageIcon, PlayCircle, FileText,
} from "lucide-react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import RichTextEditor from "@/components/rich-text-editor";
import { channelBadgeBg, CHANNEL_LINE_MAP, DEFAULT_CHANNEL_LINE } from "./types";
import { getInitials, formatPhoneDisplay, formatSnoozeUntil } from "./helpers";
import { MessageMediaBlock } from "./messages";
import type { Message } from "./types";
import type { MailboxData } from "@/hooks/use-mailbox-data";

const SAFE_STYLE_PROPS = new Set(["color", "background-color", "background", "font-size", "font-family", "text-align", "text-decoration"]);

const mediaTranslationMap: Record<string, string> = {
  "[image]": "inbox.mediaImage",
  "[video]": "inbox.mediaVideo",
  "[audio]": "inbox.mediaAudio",
  "[voice]": "inbox.mediaVoice",
  "[document]": "inbox.mediaDocument",
  "[sticker]": "inbox.mediaSticker",
  "[location]": "inbox.mediaLocation",
  "[contacts]": "inbox.mediaContacts",
  "[reaction]": "inbox.mediaReaction",
};

interface Props {
  d: MailboxData;
}

export function renderContentFn(content: string, t: (key: string, fallback?: string | Record<string, any>) => string): string {
  const mediaKey = mediaTranslationMap[content.toLowerCase()];
  if (mediaKey) return t(mediaKey);

  const interactiveMatch = content.match(/^\[interactive:(.+)\]$/);
  if (interactiveMatch) {
    return t("inbox.interactiveGeneric", { type: interactiveMatch[1] });
  }
  if (content === "[button]") return t("inbox.buttonReply", "Button reply");
  if (content === "[list]") return t("inbox.listReply", "List selection");
  if (content === "[flow]") return t("inbox.flowReply", "Flow response");

  const match = content.match(/^\[unsupported:(.+)\]$/);
  if (match) {
    const subType = match[1];
    if (subType === "video_note") return t("inbox.video", "Video");
    if (subType === "button") return t("inbox.buttonReply", "Button reply");
    if (subType === "interactive") return t("inbox.interactiveMessage", "Interactive message");
    return t("inbox.unsupportedGeneric", { type: subType });
  }
  if (content === "[unsupported]") return t("inbox.unsupportedMessage");
  return content;
}

function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "u", "s", "del", "strike", "ul", "ol", "li", "a", "span", "blockquote", "h1", "h2", "h3", "sub", "sup", "mark"],
    ALLOWED_ATTR: ["href", "target", "rel", "style", "data-color"],
  });
  const div = document.createElement("div");
  div.innerHTML = clean;
  div.querySelectorAll("[style]").forEach((el) => {
    const htmlEl = el as HTMLElement;
    const safeStyles: string[] = [];
    for (let i = 0; i < htmlEl.style.length; i++) {
      const prop = htmlEl.style[i];
      if (SAFE_STYLE_PROPS.has(prop)) {
        safeStyles.push(`${prop}: ${htmlEl.style.getPropertyValue(prop)}`);
      }
    }
    if (safeStyles.length) {
      htmlEl.setAttribute("style", safeStyles.join("; "));
    } else {
      htmlEl.removeAttribute("style");
    }
  });
  return div.innerHTML;
}

function isPlainHtml(html: string): boolean {
  const stripped = html.replace(/<p>/g, "").replace(/<\/p>/g, "");
  return stripped === DOMPurify.sanitize(stripped, { ALLOWED_TAGS: [] });
}

function MessageContent({ msg, className = "", renderContent }: { msg: Message; className?: string; renderContent: (c: string) => string }) {
  const content = msg.content;
  const htmlContent = msg.htmlContent;
  const unsupportedMatch = content.match(/^\[unsupported:(.+)\]$/);
  if (unsupportedMatch || content === "[unsupported]") {
    return <p className={`whitespace-pre-wrap break-words ${className}`}>{renderContent(content)}</p>;
  }
  if (htmlContent && !isPlainHtml(htmlContent)) {
    const sanitized = sanitizeHtml(htmlContent);
    return <div className={`msg-html-content break-words ${className}`} dangerouslySetInnerHTML={{ __html: sanitized }} />;
  }
  return <p className={`whitespace-pre-wrap break-words ${className}`}>{renderContent(content)}</p>;
}

export function ChatWindowPanel({ d }: Props) {
  const { t, i18n } = useTranslation();
  const renderContent = (content: string) => renderContentFn(content, t as any);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignTenantId, setAssignTenantId] = useState("");
  const [assignFirstName, setAssignFirstName] = useState("");
  const [assignLastName, setAssignLastName] = useState("");
  const [mobileToolbarOpen, setMobileToolbarOpen] = useState(false);
  const [mobileTagsOpen, setMobileTagsOpen] = useState(false);

  const canAssignCustomer = d.currentRole === "superadmin" || d.currentRole === "businessadmin" || d.currentRole === "teamleader";

  const isUnrecognized = !!(d.selectedConv?.isOrphan);

  const [ahtSeconds, setAhtSeconds] = useState(0);
  const ahtIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActiveConv = d.selectedConv && (d.selectedConv.status === "ACTIVE" || d.selectedConv.status === "OPEN");
  const isClosedConv = d.selectedConv && (d.selectedConv.status === "RESOLVED" || d.selectedConv.status === "CLOSED" || d.selectedConv.status === "SPAM");
  const isPoolConv = d.selectedConv && d.selectedConv.status === "UNASSIGNED";
  const ahtStartTime = d.selectedConv?.assignedAt || d.selectedConv?.createdAt;
  const poolStartTime = d.selectedConv?.createdAt;

  const closedAhtSeconds = (() => {
    if (!isClosedConv || !ahtStartTime) return 0;
    const start = new Date(ahtStartTime).getTime();
    const end = new Date(d.selectedConv!.updatedAt || d.selectedConv!.createdAt).getTime();
    return Math.max(0, Math.floor((end - start) / 1000));
  })();

  const [poolSeconds, setPoolSeconds] = useState(0);
  const poolIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (ahtIntervalRef.current) { clearInterval(ahtIntervalRef.current); ahtIntervalRef.current = null; }
    if (!isActiveConv || !ahtStartTime) { setAhtSeconds(0); return; }
    const start = new Date(ahtStartTime).getTime();
    const tick = () => setAhtSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    ahtIntervalRef.current = setInterval(tick, 1000);
    return () => { if (ahtIntervalRef.current) clearInterval(ahtIntervalRef.current); };
  }, [d.selectedConvId, isActiveConv, ahtStartTime]);

  useEffect(() => {
    if (poolIntervalRef.current) { clearInterval(poolIntervalRef.current); poolIntervalRef.current = null; }
    if (!isPoolConv || !poolStartTime) { setPoolSeconds(0); return; }
    const start = new Date(poolStartTime).getTime();
    const tick = () => setPoolSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    poolIntervalRef.current = setInterval(tick, 1000);
    return () => { if (poolIntervalRef.current) clearInterval(poolIntervalRef.current); };
  }, [d.selectedConvId, isPoolConv, poolStartTime]);

  const displayAhtSeconds = isPoolConv ? poolSeconds : isActiveConv ? ahtSeconds : closedAhtSeconds;
  const ahtMinutes = Math.floor(displayAhtSeconds / 60);
  const showAhtBadge = (isActiveConv && ahtSeconds > 0) || (isClosedConv && closedAhtSeconds > 0) || (isPoolConv && poolSeconds > 0);

  const formatSmartTime = (totalSeconds: number) => {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const daysText = t("time.days", "days");
    const hoursText = t("time.hours", "hours");
    const minsText = t("time.minutes", "mins");
    if (days > 0) return `${days} ${daysText}, ${hours} ${hoursText}, ${minutes} ${minsText}`;
    if (hours > 0) return `${hours} ${hoursText}, ${minutes} ${minsText}`;
    return `${minutes} ${minsText}`;
  };

  const ahtHours = Math.floor(ahtMinutes / 60);
  const redAht = "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
  const amberAht = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
  const greenAht = "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
  const blueAht = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
  const ahtBadgeClass = isPoolConv
    ? ahtMinutes >= 10
      ? `${redAht} animate-pulse`
      : ahtMinutes >= 5
        ? amberAht
        : blueAht
    : isClosedConv
      ? ahtHours >= 24 ? redAht : ahtHours >= 5 ? amberAht : greenAht
      : ahtMinutes >= 10
        ? `${redAht} animate-pulse`
        : ahtMinutes >= 5
          ? amberAht
          : greenAht;
  const ahtLabel = isPoolConv ? t("inbox.waitingTime", "Waiting Time:") : t("inbox.handlingTime", "Handling Time:");

  const assignCustomerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/inbox/conversations/${d.selectedConvId}/assign-customer`, {
        targetTenantId: assignTenantId,
        firstName: assignFirstName,
        lastName: assignLastName,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      d.toast({
        title: t("inbox.assignSuccess", { name: data.customerName, tenant: data.tenantName }),
      });
      setShowAssignDialog(false);
      setAssignTenantId("");
      setAssignFirstName("");
      setAssignLastName("");
      if (data.crossTenant) {
        d.setSelectedConvId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/conversations/tab-counts"] });
    },
    onError: () => {
      d.toast({ title: t("inbox.assignFailed"), variant: "destructive" });
    },
  });

  if (!d.selectedConv) {
    return (
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          d.mobileView === "list" ? "hidden md:flex" : "flex"
        }`}
        data-testid="inbox-chat-area"
      >
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageCircle className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">{t("inbox.selectConversation", "Select a conversation")}</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedConv = d.selectedConv;

  return (
    <div
      className={`flex-1 flex flex-col min-w-0 ${
        d.mobileView === "list" ? "hidden md:flex" : "flex"
      }`}
      data-testid="inbox-chat-area"
    >
      {/* Mobile Unified Chat Header — sticky wrapper */}
      <div className="md:hidden sticky top-0 z-40" data-testid="mobile-chat-header-wrapper">
        {/* Row 2: [Back][Avatar][Name] ... [Actions][Resolve][3-dot] */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-slate-50 dark:bg-muted/40" data-testid="mobile-chat-header">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 p-2"
            onClick={() => { d.setMobileView("list"); d.setSelectedConvId(null); }}
            title={t("common.back", "חזור")}
            data-testid="button-back-to-list"
          >
            <d.BackIcon className="h-4 w-4" />
          </Button>
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="text-[10px]">{getInitials(selectedConv.customer)}</AvatarFallback>
          </Avatar>
          <p className="font-medium text-sm truncate min-w-0 flex-shrink flex-1" data-testid="text-chat-customer-name">
            {selectedConv.customer
              ? `${selectedConv.customer.firstName || ""} ${selectedConv.customer.lastName || ""}`.trim() || "Unknown"
              : "Unknown"}
          </p>
          {showAhtBadge && (
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium border shadow-sm transition-colors shrink-0 ${ahtBadgeClass}`} data-testid="badge-aht-mobile">
              <Clock className="w-3 h-3 shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="opacity-70">{ahtLabel}</span>
                <span className="font-semibold">{formatSmartTime(displayAhtSeconds)}</span>
              </div>
            </div>
          )}
          <div className="flex flex-row items-center flex-nowrap gap-1 shrink-0">
            {d.isUnassigned ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => d.claimMutation.mutate(d.selectedConvId!)}
                disabled={d.claimMutation.isPending}
                title={t("inbox.claim", "קח")}
                data-testid="mobile-tb-claim"
              >
                <UserCheck className="h-4 w-4" />
              </Button>
            ) : (d.isMyConv || d.isAdmin) ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => d.releaseMutation.mutate(d.selectedConvId!)}
                disabled={d.releaseMutation.isPending}
                title={t("inbox.release", "שחרר")}
                data-testid="mobile-tb-release"
              >
                <Unlock className="h-4 w-4" />
              </Button>
            ) : null}
            {(d.isMyConv || d.isAdmin) && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => d.setShowTransfer(!d.showTransfer)}
                title={t("inbox.transfer", "העבר")}
                data-testid="mobile-tb-transfer"
              >
                <ArrowRightLeft className="h-4 w-4" />
              </Button>
            )}
            {selectedConv.status === "SNOOZED" ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => d.wakeMutation.mutate()}
                disabled={d.wakeMutation.isPending}
                title={t("inbox.wake", "העיר")}
                data-testid="mobile-tb-wake"
              >
                <AlarmClock className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-1"
                onClick={() => d.setShowSnooze(true)}
                title={t("inbox.snooze", "השהה")}
                data-testid="mobile-tb-snooze"
              >
                <Clock className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 p-1"
              onClick={() => {
                d.setResolveTags(selectedConv.tags?.length ? [...selectedConv.tags] : []);
                d.setShowResolveDialog(true);
              }}
              disabled={d.resolveMutation.isPending}
              title={t("inbox.resolve", "סגירה")}
              data-testid="mobile-tb-resolve"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-1 shrink-0"
                  title={t("common.more", "עוד")}
                  data-testid="mobile-tb-overflow"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {selectedConv?.status === "SPAM" ? (
                  <DropdownMenuItem
                    onClick={() => d.unspamMutation.mutate(d.selectedConvId!)}
                    disabled={d.unspamMutation.isPending}
                    data-testid="mobile-overflow-unspam"
                  >
                    <RotateCcw className="h-4 w-4 me-2" />
                    {t("inbox.restoreFromSpam", "Restore")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => d.spamMutation.mutate(d.selectedConvId!)}
                    disabled={d.spamMutation.isPending}
                    data-testid="mobile-overflow-spam"
                  >
                    <ShieldAlert className="h-4 w-4 me-2" />
                    {t("inbox.spam", "ספאם")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => d.setShowMergeDialog(true)}
                  data-testid="mobile-overflow-merge"
                >
                  <GitMerge className="h-4 w-4 me-2" />
                  {t("inbox.merge", "מיזוג")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      </div>

      {/* Mobile Tag Selection Dialog */}
      <Dialog open={mobileTagsOpen} onOpenChange={setMobileTagsOpen}>
        <DialogContent className="sm:max-w-sm md:hidden" data-testid="mobile-tags-dialog">
          <DialogHeader>
            <DialogTitle>{t("inbox.tags", "תגיות")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 py-2" data-testid="mobile-tags-list">
            {d.sortedTags.map((tag) => {
              const isSelected = selectedConv.tags?.includes(tag.name);
              return (
                <button
                  key={tag._id}
                  type="button"
                  className={`text-sm px-3 py-2 rounded-full border-2 transition-all duration-200 font-medium active:scale-95 cursor-pointer ${
                    isSelected
                      ? "shadow-sm"
                      : "bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-600 text-slate-700 dark:text-slate-200 shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md"
                  }`}
                  style={isSelected ? {
                    borderColor: tag.color,
                    color: "white",
                    backgroundColor: tag.color,
                  } : {}}
                  onClick={() => {
                    const current = selectedConv.tags || [];
                    const newTags = isSelected ? current.filter(tn => tn !== tag.name) : [...current, tag.name];
                    d.updateTagsMutation.mutate({ convId: selectedConv._id, tags: newTags });
                  }}
                  data-testid={`mobile-tag-chip-${tag._id}`}
                >
                  {isSelected && <Check className="h-3 w-3 inline-block me-1" />}
                  {tag.name}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Chat Header — Desktop: full action bar */}
      <div className="hidden md:flex items-center justify-between gap-3 p-3 border-b wa-chat-header sticky top-0 z-10">
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {d.windowExpired && (
              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                <Lock className="h-3 w-3 me-1" />
                {t("inbox.windowLocked", "24h")}
              </Badge>
            )}
            {d.isUnassigned && (
              <Button
                variant="default"
                size="sm"
                onClick={() => d.claimMutation.mutate(d.selectedConvId!)}
                disabled={d.claimMutation.isPending}
                title={t("inbox.claim", "Claim")}
                data-testid="button-claim"
              >
                <UserCheck className="h-4 w-4 me-1" />
                <span className="hidden sm:inline">{t("inbox.claim", "Claim")}</span>
              </Button>
            )}
            {(d.isMyConv || d.isAdmin) && !d.isUnassigned && (
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
                onClick={() => d.releaseMutation.mutate(d.selectedConvId!)}
                disabled={d.releaseMutation.isPending}
                title={t("inbox.release", "Release")}
                data-testid="button-release"
              >
                <Unlock className="h-4 w-4 me-1" />
                <span className="hidden sm:inline">{t("inbox.release", "Release")}</span>
              </Button>
            )}
            {(d.isMyConv || d.isAdmin) && (
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
                onClick={() => d.setShowTransfer(!d.showTransfer)}
                title={t("inbox.transfer", "Transfer")}
                data-testid="button-transfer-toggle"
              >
                <ArrowRightLeft className="h-4 w-4 me-1" />
                <span className="hidden sm:inline">{t("inbox.transfer", "Transfer")}</span>
              </Button>
            )}
            {selectedConv.status === "SNOOZED" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
                  onClick={() => d.wakeMutation.mutate()}
                  disabled={d.wakeMutation.isPending}
                  title={t("inbox.wake", "Wake")}
                  data-testid="button-wake"
                >
                  <AlarmClock className="h-4 w-4 me-1" />
                  <span className="hidden sm:inline">{t("inbox.wake", "Wake")}</span>
                </Button>
                {selectedConv.snoozedUntil && (
                  <Popover open={d.showSnoozeEdit} onOpenChange={(open) => {
                    d.setShowSnoozeEdit(open);
                    if (open && selectedConv.snoozedUntil) {
                      const dd = new Date(selectedConv.snoozedUntil);
                      d.setSnoozeDate(dd);
                      d.setSnoozeHour(String(dd.getHours()).padStart(2, "0"));
                      d.setSnoozeMinute(String(Math.floor(dd.getMinutes() / 5) * 5).padStart(2, "0"));
                      d.setSnoozeTargetAgent((selectedConv as any).snoozeWakeAgentId && (selectedConv as any).snoozeWakeAgentId !== d.authUser?._id ? (selectedConv as any).snoozeWakeAgentId : "");
                    }
                    if (!open) { d.setSnoozeDate(undefined); d.setSnoozeTargetAgent(""); }
                  }}>
                    <PopoverTrigger asChild>
                      <button
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-sm font-bold bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors cursor-pointer border-0"
                        data-testid="button-snooze-edit"
                      >
                        <AlarmClock className="h-3 w-3 text-blue-900 dark:text-blue-200" />
                        {formatSnoozeUntil(selectedConv.snoozedUntil)}
                        {(selectedConv as any).snoozeWakeAgentName && (selectedConv as any).snoozeWakeAgentId !== d.authUser?._id && (
                          <span className="text-xs font-normal opacity-80">→ {d.displayName((selectedConv as any).snoozeWakeAgentName)}</span>
                        )}
                        <Pencil className="h-2.5 w-2.5 opacity-60" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2 border border-blue-400 dark:border-blue-500" align="end">
                      <div className="flex flex-col gap-2">
                        <CalendarPicker
                          mode="single"
                          selected={d.snoozeDate}
                          onSelect={d.setSnoozeDate}
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                          data-testid="snooze-edit-calendar"
                        />
                        <div className="flex items-center gap-2 px-3 pb-1">
                          <span className="text-sm text-muted-foreground">{t("inbox.snoozeTime", "Time")}:</span>
                          <select value={d.snoozeHour} onChange={(e) => d.setSnoozeHour(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background" data-testid="select-snooze-edit-hour">
                            {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                          <span>:</span>
                          <select value={d.snoozeMinute} onChange={(e) => d.setSnoozeMinute(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background" data-testid="select-snooze-edit-minute">
                            {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2 px-3 pb-1">
                          <span className="text-sm text-muted-foreground">{t("inbox.snoozeWakeAgent", "Assign to")}:</span>
                          <select value={d.snoozeTargetAgent} onChange={(e) => d.setSnoozeTargetAgent(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background flex-1 min-w-0" data-testid="select-snooze-edit-agent">
                            <option value="">{t("inbox.snoozeAgentMe", "Me (default)")}</option>
                            {d.agents.filter((a) => a._id !== d.authUser?._id).map((a) => (
                              <option key={a._id} value={a._id}>{d.displayName(a.name)}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2 px-3 pb-2">
                          <Button
                            size="sm"
                            disabled={!d.snoozeDate || d.snoozeMutation.isPending}
                            onClick={() => {
                              if (!d.snoozeDate) return;
                              const dd = new Date(d.snoozeDate);
                              dd.setHours(parseInt(d.snoozeHour), parseInt(d.snoozeMinute), 0, 0);
                              if (dd <= new Date()) {
                                d.toast({ title: t("inbox.snoozeInvalid", "Please select a future time"), variant: "destructive" });
                                return;
                              }
                              d.snoozeMutation.mutate({ snoozedUntil: dd.toISOString(), snoozeWakeAgentId: d.snoozeTargetAgent || undefined });
                            }}
                            data-testid="button-snooze-edit-confirm"
                          >
                            <Check className="h-3 w-3 me-1" />
                            {t("inbox.snoozeUpdate", "Update snooze")}
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </>
            ) : (
              <Popover open={d.showSnooze} onOpenChange={(open) => { d.setShowSnooze(open); if (!open) { d.setSnoozeCustomMode(false); d.setSnoozeDate(undefined); d.setSnoozeTargetAgent(""); } }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95" title={t("inbox.snooze", "Snooze")} data-testid="button-snooze">
                    <Clock className="h-4 w-4 me-1" />
                    <span className="hidden sm:inline">{t("inbox.snooze", "Snooze")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className={`border border-blue-400 dark:border-blue-500 ${d.snoozeCustomMode ? "w-auto p-2" : "w-56 p-1"}`} align="end">
                  {d.snoozeCustomMode ? (
                    <div className="flex flex-col gap-2">
                      <CalendarPicker
                        mode="single"
                        selected={d.snoozeDate}
                        onSelect={d.setSnoozeDate}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        data-testid="snooze-calendar"
                      />
                      <div className="flex items-center gap-2 px-3 pb-1">
                        <span className="text-sm text-muted-foreground">{t("inbox.snoozeTime", "Time")}:</span>
                        <select value={d.snoozeHour} onChange={(e) => d.setSnoozeHour(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background" data-testid="select-snooze-hour">
                          {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <span>:</span>
                        <select value={d.snoozeMinute} onChange={(e) => d.setSnoozeMinute(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background" data-testid="select-snooze-minute">
                          {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 px-3 pb-1">
                        <span className="text-sm text-muted-foreground">{t("inbox.snoozeWakeAgent", "Assign to")}:</span>
                        <select value={d.snoozeTargetAgent} onChange={(e) => d.setSnoozeTargetAgent(e.target.value)} className="border rounded px-1 py-0.5 text-sm bg-background flex-1 min-w-0" data-testid="select-snooze-agent">
                          <option value="">{t("inbox.snoozeAgentMe", "Me (default)")}</option>
                          {d.agents.filter((a) => a._id !== d.authUser?._id).map((a) => (
                            <option key={a._id} value={a._id}>{d.displayName(a.name)}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 px-3 pb-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { d.setSnoozeCustomMode(false); d.setSnoozeDate(undefined); d.setSnoozeTargetAgent(""); }}
                          data-testid="button-snooze-back"
                        >
                          <ArrowRight className="h-3 w-3 me-1 rtl:rotate-180" />
                          {t("common.back", "Back")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!d.snoozeDate || d.snoozeMutation.isPending}
                          onClick={() => {
                            if (!d.snoozeDate) return;
                            const dd = new Date(d.snoozeDate);
                            dd.setHours(parseInt(d.snoozeHour), parseInt(d.snoozeMinute), 0, 0);
                            if (dd <= new Date()) {
                              d.toast({ title: t("inbox.snoozeInvalid", "Please select a future time"), variant: "destructive" });
                              return;
                            }
                            d.snoozeMutation.mutate({ snoozedUntil: dd.toISOString(), snoozeWakeAgentId: d.snoozeTargetAgent || undefined });
                          }}
                          data-testid="button-snooze-confirm"
                        >
                          <Check className="h-3 w-3 me-1" />
                          {t("inbox.snoozeConfirm", "Set snooze")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 px-3 py-1.5">
                        <span className="text-xs text-muted-foreground">{t("inbox.snoozeWakeAgent", "Assign to")}:</span>
                        <select value={d.snoozeTargetAgent} onChange={(e) => d.setSnoozeTargetAgent(e.target.value)} className="border rounded px-1 py-0.5 text-xs bg-background flex-1 min-w-0" data-testid="select-snooze-agent-preset">
                          <option value="">{t("inbox.snoozeAgentMe", "Me (default)")}</option>
                          {d.agents.filter((a) => a._id !== d.authUser?._id).map((a) => (
                            <option key={a._id} value={a._id}>{d.displayName(a.name)}</option>
                          ))}
                        </select>
                      </div>
                      <hr className="my-1 border-border" />
                      {[
                        { label: t("inbox.snooze30min", "30 min"), getDate: () => new Date(Date.now() + 30 * 60 * 1000) },
                        { label: t("inbox.snooze1hour", "1 hour"), getDate: () => new Date(Date.now() + 60 * 60 * 1000) },
                        { label: t("inbox.snooze3hours", "3 hours"), getDate: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
                        { label: t("inbox.snoozeTomorrow", "Tomorrow 9AM"), getDate: () => { const dd = new Date(); dd.setDate(dd.getDate() + 1); dd.setHours(9, 0, 0, 0); return dd; } },
                        { label: t("inbox.snoozeNextWeek", "Next week"), getDate: () => { const dd = new Date(); dd.setDate(dd.getDate() + 7); dd.setHours(9, 0, 0, 0); return dd; } },
                      ].map((preset) => (
                        <button
                          type="button"
                          key={preset.label}
                          className="w-full text-start px-3 py-1.5 text-sm rounded-md hover-elevate"
                          onClick={() => d.snoozeMutation.mutate({ snoozedUntil: preset.getDate().toISOString(), snoozeWakeAgentId: d.snoozeTargetAgent || undefined })}
                          data-testid={`button-snooze-${preset.label.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          {preset.label}
                        </button>
                      ))}
                      <hr className="my-1 border-border" />
                      <button
                        type="button"
                        className="w-full text-start px-3 py-1.5 text-sm rounded-md hover-elevate flex items-center gap-1"
                        onClick={() => d.setSnoozeCustomMode(true)}
                        data-testid="button-snooze-custom"
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                        {t("inbox.snoozeCustom", "Custom date & time")}
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Button
              size="sm"
              className="bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500 shadow-sm"
              onClick={() => {
                d.setResolveTags(selectedConv.tags?.length ? [...selectedConv.tags] : []);
                d.setShowResolveDialog(true);
              }}
              disabled={d.resolveMutation.isPending}
              title={t("inbox.resolve", "Resolve")}
              data-testid="button-resolve"
            >
              <CheckCircle2 className="h-4 w-4 me-1" />
              <span className="hidden sm:inline">{t("inbox.resolve", "Resolve")}</span>
            </Button>
            {selectedConv?.status === "SPAM" ? (
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
                onClick={() => d.unspamMutation.mutate(d.selectedConvId!)}
                disabled={d.unspamMutation.isPending}
                title={t("inbox.restoreFromSpam", "Restore")}
                data-testid="button-unspam"
              >
                <RotateCcw className="h-4 w-4 me-1" />
                <span className="hidden sm:inline">{t("inbox.restoreFromSpam", "Restore")}</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
                onClick={() => d.spamMutation.mutate(d.selectedConvId!)}
                disabled={d.spamMutation.isPending}
                title={t("inbox.spam", "Spam")}
                data-testid="button-spam"
              >
                <ShieldAlert className="h-4 w-4 me-1" />
                <span className="hidden sm:inline">{t("inbox.spam", "Spam")}</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 active:scale-95"
              onClick={() => d.setShowMergeDialog(true)}
              title={t("inbox.merge", "Merge")}
              data-testid="button-merge"
            >
              <GitMerge className="h-4 w-4 me-1" />
              <span className="hidden sm:inline">{t("inbox.merge", "Merge")}</span>
            </Button>
          </div>

          <div className="w-px self-stretch bg-border mx-1 shrink-0" />

          {showAhtBadge && (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border shadow-sm transition-colors shrink-0 ${ahtBadgeClass}`} data-testid="badge-aht-desktop">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] opacity-70">{ahtLabel}</span>
                <span className="font-semibold">{formatSmartTime(displayAhtSeconds)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate" data-testid="text-chat-customer-name">
                {selectedConv.customer
                  ? `${selectedConv.customer.firstName || ""} ${selectedConv.customer.lastName || ""}`.trim() || "Unknown"
                  : "Unknown"}
              </p>
              {d.typingConvId === d.selectedConvId ? (
                <div className="flex items-center gap-1" data-testid="typing-indicator">
                  <span className="text-xs text-green-600 dark:text-green-400 italic">
                    {t("inbox.typing", "typing")}
                  </span>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              ) : selectedConv.customer?.phone ? (
                <span className="text-xs text-muted-foreground" dir="ltr" data-testid="text-customer-phone">{formatPhoneDisplay(selectedConv.customer.phone)}</span>
              ) : null}
            </div>
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs">{getInitials(selectedConv.customer)}</AvatarFallback>
            </Avatar>
          </div>
        </div>

      {d.sortedTags.length > 0 && (
        <div className="hidden md:flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30" data-testid="tag-row">
          <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
          {d.sortedTags.map((tag) => {
            const isSelected = selectedConv.tags?.includes(tag.name);
            const isVip = /vip/i.test(tag.name);
            return (
              <button
                key={tag._id}
                type="button"
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-all duration-200 font-medium cursor-pointer active:scale-95 ${
                  isVip && isSelected
                    ? "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700 shadow-sm ring-1 ring-yellow-300 dark:ring-yellow-700"
                    : isSelected
                      ? "shadow-sm"
                      : "bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-600 text-slate-700 dark:text-slate-200 shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md"
                }`}
                style={isVip && isSelected ? {} : isSelected ? {
                  borderColor: tag.color,
                  color: "white",
                  backgroundColor: tag.color,
                } : {}}
                onClick={() => {
                  const current = selectedConv.tags || [];
                  const newTags = isSelected ? current.filter(t => t !== tag.name) : [...current, tag.name];
                  d.updateTagsMutation.mutate({ convId: selectedConv._id, tags: newTags });
                }}
                data-testid={`button-conv-tag-${tag._id}`}
              >
                {isSelected && <Check className="h-2.5 w-2.5 inline-block me-0.5" />}
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {d.whatsappTokenExpired && selectedConv.channel === "WHATSAPP" && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm"
          data-testid="banner-whatsapp-token-expired"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {t("inbox.tokenExpired", "WhatsApp access token has expired. Outbound messages will fail until a new token is configured.")}
          </span>
        </div>
      )}

      {!d.isMyConv && !d.isUnassigned && !d.isAdmin && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-sm"
          data-testid="banner-conv-locked"
        >
          <Lock className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200 flex-1">
            {t("inbox.assignedTo", "Assigned to")}: <strong>{d.displayName(selectedConv.assignedName)}</strong>
          </span>
        </div>
      )}

      {isUnrecognized && canAssignCustomer && (
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2.5 w-full bg-orange-50 dark:bg-orange-950/40 border-b border-orange-200 dark:border-orange-800 text-sm cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-950/60 transition-colors"
          onClick={() => {
            const phone = selectedConv.customer?.phone || "";
            setAssignFirstName("");
            setAssignLastName("");
            setAssignTenantId(selectedConv.tenantId || "");
            setShowAssignDialog(true);
          }}
          data-testid="banner-unrecognized-customer"
        >
          <UserPlus className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
          <span className="text-orange-800 dark:text-orange-200 flex-1 text-start font-medium">
            {t("inbox.unrecognizedBanner")}
          </span>
        </button>
      )}

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-[400px]" data-testid="dialog-assign-customer">
          <DialogHeader>
            <DialogTitle>{t("inbox.assignCustomerTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("inbox.assignPhone")}</Label>
              <Input
                value={formatPhoneDisplay(selectedConv.customer?.phone || "")}
                disabled
                dir="ltr"
                className="bg-muted"
                data-testid="input-assign-phone"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("inbox.assignSelectTenant")}</Label>
              <Select value={assignTenantId} onValueChange={setAssignTenantId}>
                <SelectTrigger data-testid="select-assign-tenant">
                  <SelectValue placeholder={t("inbox.assignSelectTenant")} />
                </SelectTrigger>
                <SelectContent>
                  {d.tenants?.map((tn: any) => (
                    <SelectItem key={tn._id} value={tn._id} data-testid={`option-tenant-${tn._id}`}>
                      {tn.nameHe || tn.nameEn || tn.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("inbox.assignContactFirst")}</Label>
                <Input
                  value={assignFirstName}
                  onChange={(e) => setAssignFirstName(e.target.value)}
                  placeholder={t("inbox.assignContactFirst")}
                  data-testid="input-assign-first-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{t("inbox.assignContactLast")}</Label>
                <Input
                  value={assignLastName}
                  onChange={(e) => setAssignLastName(e.target.value)}
                  placeholder={t("inbox.assignContactLast")}
                  data-testid="input-assign-last-name"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => assignCustomerMutation.mutate()}
              disabled={!assignTenantId || !assignFirstName.trim() || assignCustomerMutation.isPending}
              data-testid="button-assign-save"
            >
              {assignCustomerMutation.isPending && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              <UserPlus className="h-4 w-4 me-1" />
              {t("inbox.assignSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {d.showTransfer && (
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-4 py-2" data-testid="transfer-bar">
          <Button size="icon" variant="ghost" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => d.setShowTransfer(false)} data-testid="button-cancel-transfer">
            <X className="h-4 w-4" />
          </Button>
          <span className="text-sm text-slate-700 dark:text-slate-300 shrink-0">
            {t("inbox.transferTo", "Transfer to")}:
          </span>
          <Select
            onValueChange={(val) => {
              const agent = d.agents.find((a) => a._id === val);
              if (agent) {
                d.transferMutation.mutate({ convId: d.selectedConvId!, targetUserId: agent._id, targetUserName: agent.name });
              }
            }}
          >
            <SelectTrigger className="w-52 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/40" data-testid="select-transfer-agent">
              <SelectValue placeholder={t("inbox.selectAgent", "Select agent")} />
            </SelectTrigger>
            <SelectContent>
              {d.agents
                .filter((a) => a._id !== d.currentUserId)
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map((a) => (
                <SelectItem key={a._id} value={a._id} data-testid={`option-agent-${a._id}`}>
                  {d.displayName(a.name)} ({a.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto wa-wallpaper px-4 md:px-[62px] py-4 space-y-1 scrollbar-chat"
        data-testid="inbox-messages"
      >
        {d.msgsLoading ? (
          <div className="flex justify-center p-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : d.messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p>{t("inbox.noMessages", "No messages yet")}</p>
          </div>
        ) : (
          d.messages.map((msg) => {
            if (msg.deletedAt) {
              return (
                <div key={msg._id} className={`flex ${msg.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`} data-testid={`msg-deleted-${msg._id}`}>
                  <div className="wa-bubble text-sm opacity-50 italic px-3 py-2 bg-muted/30 rounded-lg">
                    <p className="text-muted-foreground text-xs">{t("inbox.messageDeletedLabel", "This message was deleted")}</p>
                  </div>
                </div>
              );
            }

            const replyQuote = msg.replyToMessageId ? (
              <div className="border-s-2 border-primary/50 ps-2 mb-1 py-0.5 bg-foreground/5 rounded-sm text-xs">
                {msg.replyToSender && <span className="font-semibold text-primary/80 block">{msg.replyToSender}</span>}
                <span className="text-muted-foreground line-clamp-2">{msg.replyToContent || "..."}</span>
              </div>
            ) : null;

            const forwardedFromInfo = msg.metadata?.forwardedFromName || msg.metadata?.forwardedFromPhone;
            const forwardedLabel = msg.forwardedFromMessageId ? (
              forwardedFromInfo ? (
                <div className="border-s-[3px] border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 rounded-sm ps-2 pe-1 py-1 mb-1.5">
                  <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium mb-0.5">
                    <Forward className="h-3 w-3 shrink-0" />
                    <span>{t("inbox.forwardedFrom", "הועבר מ:")} {msg.metadata.forwardedFromName || msg.metadata.forwardedFromPhone}</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-muted-foreground italic mb-0.5">
                  <Forward className="h-3 w-3" />
                  {t("inbox.forwarded", "Forwarded")}
                </div>
              )
            ) : null;

            const flagIndicator = msg.flagged ? (
              <Flag className="h-3 w-3 text-red-500 shrink-0 inline ms-1" />
            ) : null;

            const editedLabel = msg.editedAt ? (
              <span className="text-[10px] text-muted-foreground italic ms-1">{t("inbox.edited", "edited")}</span>
            ) : null;

            const msgActions = (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 rounded hover-elevate"
                    data-testid={`button-msg-actions-${msg._id}`}
                  >
                    <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => d.setReplyToMessage(msg)}
                    data-testid={`button-reply-${msg._id}`}
                  >
                    <Reply className="h-3.5 w-3.5 me-2" />
                    {t("inbox.reply", "Reply")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { d.setForwardMessageId(msg._id); requestAnimationFrame(() => d.setShowForwardDialog(true)); }}
                    data-testid={`button-forward-${msg._id}`}
                  >
                    <Forward className="h-3.5 w-3.5 me-2" />
                    {t("inbox.forward", "Forward")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => d.flagMutation.mutate(msg._id)}
                    data-testid={`button-flag-${msg._id}`}
                  >
                    <Flag className={`h-3.5 w-3.5 me-2 ${msg.flagged ? "text-red-500" : ""}`} />
                    {msg.flagged ? t("inbox.unflag", "Unflag") : t("inbox.flag", "Flag")}
                  </DropdownMenuItem>
                  {msg.direction === "OUTBOUND" && msg.channel !== "WHATSAPP" && (
                    <DropdownMenuItem
                      onClick={() => { d.setEditingMessage(msg); d.setEditContent(msg.content); }}
                      data-testid={`button-edit-msg-${msg._id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 me-2" />
                      {t("inbox.edit", "Edit")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      d.setSuggestMessageId(msg._id);
                      d.setSuggestAnswer(msg.content);
                      d.setShowSuggestDialog(true);
                    }}
                    data-testid={`button-suggest-knowledge-${msg._id}`}
                  >
                    <Lightbulb className="h-3.5 w-3.5 me-2" />
                    {t("inbox.suggestToAI", "Suggest to AI")}
                  </DropdownMenuItem>
                  {msg.channel !== "WHATSAPP" && (
                  <DropdownMenuItem
                    onClick={() => d.deleteMessageMutation.mutate(msg._id)}
                    className="text-destructive focus:text-destructive"
                    disabled={d.deleteMessageMutation.isPending}
                    data-testid={`button-delete-msg-${msg._id}`}
                  >
                    {d.deleteMessageMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 me-2" />
                    )}
                    {t("inbox.delete", "Delete")}
                  </DropdownMenuItem>
                  )}
                  {msg.channel === "WHATSAPP" && msg.direction === "OUTBOUND" && (
                    <DropdownMenuItem disabled className="text-xs text-muted-foreground opacity-70 cursor-default" data-testid={`info-wa-unsupported-${msg._id}`}>
                      {t("inbox.whatsappEditDeleteUnsupported", "Meta does not allow editing or deleting WhatsApp messages")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            );

            if (msg.type === "SYSTEM") {
              const isForwardLog = msg.metadata?.isForwardLog;
              if (isForwardLog) {
                const fwdMeta = msg.metadata || {};
                const mediaType = (fwdMeta.originalMediaType || "text").toString().toLowerCase();
                const preview = fwdMeta.originalContentPreview;
                const fileName = fwdMeta.originalFileName;
                const origMsgId = fwdMeta.originalMessageId;
                const isMedia = /^(image|video|audio|document|file|application|sticker)/.test(mediaType) || ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "FILE", "STICKER"].includes((fwdMeta.originalMediaType || "").toString().toUpperCase());
                const mediaLabel = /image|sticker/.test(mediaType) ? t("inbox.image", "תמונה") : /video/.test(mediaType) ? t("inbox.video", "סרטון") : /audio/.test(mediaType) ? t("inbox.audio", "הקלטה") : t("inbox.document", "מסמך");
                const MediaIcon = /image|sticker/.test(mediaType) ? ImageIcon : /video/.test(mediaType) ? PlayCircle : /audio/.test(mediaType) ? Mic : FileText;
                const streamUrl = origMsgId ? `/api/inbox/messages/${origMsgId}/media/stream` : null;
                return (
                  <div key={msg._id} className="flex justify-center my-3" data-testid={`msg-system-${msg._id}`}>
                    <div className="inline-flex flex-col items-center gap-1 px-4 py-2 rounded-xl text-xs border bg-blue-50/60 dark:bg-blue-950/30 border-blue-200/40 dark:border-blue-800/40 max-w-[75%]">
                      <div className="flex items-center gap-1.5 w-full">
                        <Forward className="h-3 w-3 shrink-0 text-blue-500" />
                        <span className="font-medium text-blue-700 dark:text-blue-300">{msg.content}</span>
                        <span className="opacity-60 ms-1 shrink-0">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {(isMedia && streamUrl && (/image|sticker/.test(mediaType) || /video/.test(mediaType))) ? (
                        <div className="flex items-center gap-3 mt-1.5 p-1.5 bg-background/50 rounded-md border w-full" data-testid={`forward-log-media-${msg._id}`}>
                          {/image|sticker/.test(mediaType) ? (
                            <img src={streamUrl} alt="preview" className="w-10 h-10 rounded object-cover shrink-0 border border-border/50" />
                          ) : (
                            <video src={streamUrl} className="w-10 h-10 rounded object-cover shrink-0 border border-border/50" muted playsInline />
                          )}
                          <div className="flex flex-col min-w-0">
                            <a href={streamUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline italic text-xs">
                              <MediaIcon className="h-3 w-3 shrink-0" />
                              <span>{fileName || mediaLabel}</span>
                            </a>
                            {preview && <span className="text-xs text-muted-foreground line-clamp-1">{preview}</span>}
                          </div>
                        </div>
                      ) : (isMedia && streamUrl) ? (
                        <div className="flex items-center gap-3 mt-1.5 p-1.5 bg-background/50 rounded-md border w-full" data-testid={`forward-log-media-${msg._id}`}>
                          <div className="flex flex-col min-w-0">
                            <a href={streamUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline italic text-xs">
                              <MediaIcon className="h-3 w-3 shrink-0" />
                              <span>{fileName || mediaLabel}</span>
                            </a>
                            {preview && <span className="text-xs text-muted-foreground line-clamp-1">{preview}</span>}
                          </div>
                        </div>
                      ) : isMedia ? (
                        <div className="flex items-center gap-1.5 mt-1 p-1.5 bg-background/50 rounded-md border w-full" data-testid={`forward-log-media-${msg._id}`}>
                          <MediaIcon className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                          <span className="text-xs text-slate-600 dark:text-slate-400">{mediaLabel}</span>
                          {fileName && <span className="text-xs text-muted-foreground truncate">({fileName})</span>}
                          {preview && <span className="text-xs text-muted-foreground truncate ms-0.5">• {preview}</span>}
                        </div>
                      ) : preview ? (
                        <span className="text-muted-foreground italic text-xs line-clamp-2 w-full text-start">"{preview}"</span>
                      ) : null}
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg._id} className="flex justify-center my-3" data-testid={`msg-system-${msg._id}`}>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground border bg-muted/60 dark:bg-muted/30 border-border/40">
                    <Info className="h-3 w-3 shrink-0" />
                    <span>{msg.content}</span>
                    <span className="opacity-60 ms-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            }

            if (msg.isInternal) {
              return (
                <div key={msg._id} className="flex justify-end my-2 group/msg" data-testid={`msg-note-${msg._id}`}>
                  <div className="wa-bubble wa-bubble-internal text-sm max-w-[65%]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Pin className="h-3 w-3 shrink-0 note-text-color" />
                      <span className="text-xs font-semibold flex-1 note-text-color">
                        {t("inbox.internalNote", "Internal Note")}
                        {msg.senderName && ` — ${msg.senderName}`}
                      </span>
                      {flagIndicator}
                      {msgActions}
                    </div>
                    {replyQuote}
                    {msg.htmlContent && !isPlainHtml(msg.htmlContent) ? (
                      <div className="msg-html-content note-body-color" dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.htmlContent) }} />
                    ) : (
                      <p className="whitespace-pre-wrap note-body-color">{msg.content}</p>
                    )}
                    <div className="flex items-center justify-end mt-1">
                      <span className="text-[11px] note-time-color">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {editedLabel}
                    </div>
                  </div>
                </div>
              );
            }

            const isInbound = msg.direction === "INBOUND";
            const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

            const mediaBlock = (
              <MessageMediaBlock
                msg={msg}
                mediaData={d.getMediaData(msg)}
                playingAudioId={d.playingAudioId}
                toggleAudio={d.toggleAudio}
                openMediaPreview={d.openMediaPreview}
                mediaCache={d.mediaCache}
                mediaBatchLoaded={d.mediaBatchLoaded}
                setPreviewMedia={d.setPreviewMedia}
              />
            );

            const textBlock = msg.type === "TEXT" || !msg.type ? (
              <MessageContent msg={msg} renderContent={renderContent} />
            ) : msg.content && msg.type !== "AUDIO" ? (
              <MessageContent msg={msg} className="mt-1" renderContent={renderContent} />
            ) : null;

            if (isInbound) {
              return (
                <div key={msg._id} className="flex justify-start group/msg" data-testid={`msg-inbound-${msg._id}`}>
                  <div className="wa-bubble wa-bubble-inbound text-sm">
                    <span className="wa-tail-inbound">
                      <svg viewBox="0 0 8 13" width="8" height="13"><path d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" /></svg>
                    </span>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="flex-1" />
                      {flagIndicator}
                      {msgActions}
                    </div>
                    {forwardedLabel}
                    {replyQuote}
                    {mediaBlock}
                    {textBlock}
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <span className="text-[11px] wa-msg-grey">{time}</span>
                      {editedLabel}
                    </div>
                  </div>
                </div>
              );
            }

            const ds = msg.deliveryStatus;
            const checkColor = ds === "read" ? "wa-read-receipt" : "wa-msg-grey";

            return (
              <div key={msg._id} className="flex justify-end group/msg" data-testid={`msg-outbound-${msg._id}`}>
                <div
                  className={`wa-bubble wa-bubble-outbound text-sm${msg.senderRole === "businessadmin" || msg.senderRole === "superadmin" ? " wa-manager-bubble border border-purple-300 dark:border-purple-700" : ""}`}
                  title={[msg.senderName, msg.senderRole, new Date(msg.createdAt).toLocaleString()].filter(Boolean).join(" | ")}
                >
                  <span className="wa-tail-outbound">
                    <svg viewBox="0 0 8 13" width="8" height="13"><path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" /></svg>
                  </span>
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    {msg.senderName && (
                      <p className={`text-xs font-medium ${
                        msg.senderRole === "businessadmin" || msg.senderRole === "superadmin"
                          ? "text-purple-600 dark:text-purple-400"
                          : msg.senderRole === "teamleader"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "wa-sender-blue"
                      }`}>
                        {msg.senderName}
                        {(msg.senderRole === "businessadmin" || msg.senderRole === "superadmin") && " ★"}
                        {msg.senderRole === "teamleader" && " ◆"}
                      </p>
                    )}
                    <span className="flex-1" />
                    {flagIndicator}
                    {msgActions}
                  </div>
                  {forwardedLabel}
                  {replyQuote}
                  {mediaBlock}
                  {textBlock}
                  <div className="flex items-center gap-1 justify-end mt-0.5">
                    <span className="text-[11px] wa-msg-grey">{time}</span>
                    {editedLabel}
                    {(ds as string) === "sending" ? (
                      <Clock className="h-3 w-3 wa-msg-grey animate-pulse" />
                    ) : ds === "failed" ? (
                      <button
                        onClick={() => d.retryMutation.mutate(msg._id)}
                        disabled={d.retryMutation.isPending}
                        className="inline-flex items-center gap-0.5 text-red-500 hover:text-red-600 cursor-pointer"
                        title={t("inbox.retry", "Retry")}
                        data-testid={`button-retry-${msg._id}`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        <RotateCcw className={`h-3 w-3 ${d.retryMutation.isPending ? "animate-spin" : ""}`} />
                      </button>
                    ) : ds === "delivered" || ds === "read" ? (
                      <svg viewBox="0 0 16 11" width="16" height="11" className={checkColor} data-testid={`status-${ds}-${msg._id}`}>
                        <path d="M11.07.66L5.4 7.47 3.28 5.06a.5.5 0 0 0-.77.64l2.5 3a.5.5 0 0 0 .75.02L11.68 1.3a.5.5 0 0 0-.6-.64z" fill="currentColor"/>
                        <path d="M15.07.66L9.4 7.47 8.14 6a.5.5 0 0 0-.77.64l1.64 2a.5.5 0 0 0 .75.02L15.68 1.3a.5.5 0 0 0-.6-.64z" fill="currentColor"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 12 11" width="12" height="11" className="wa-msg-grey" data-testid={`status-sent-${msg._id}`}>
                        <path d="M11.07.66L5.4 7.47 3.28 5.06a.5.5 0 0 0-.77.64l2.5 3a.5.5 0 0 0 .75.02L11.68 1.3a.5.5 0 0 0-.6-.64z" fill="currentColor"/>
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={d.messagesEndRef} />
      </div>

      {/* Input Area */}
      <div
        className="wa-input-bar"
        onDragOver={d.handleDragOver}
        onDragLeave={d.handleDragLeave}
        onDrop={d.handleDrop}
      >
        {d.windowExpired && d.inputMode === "message" && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950 rounded-md border border-amber-200 dark:border-amber-800 text-sm mb-1">
            <Clock className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-amber-800 dark:text-amber-200 flex-1">
              {t("inbox.windowExpiredMsg", "24h customer service window expired. Send a template to re-engage.")}
            </span>
            <Button
              size="sm"
              variant="default"
              onClick={() => d.setSendTemplateDialogOpen(true)}
              className="shrink-0"
              data-testid="button-send-template-expired"
            >
              <FileStack className="h-3.5 w-3.5 me-1" />
              {t("waTemplates.sendTemplate")}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 mb-1">
          <div className="flex gap-1.5 rounded-lg p-1 flex-wrap">
            <Button
              type="button"
              variant={d.inputMode === "message" ? "default" : "outline"}
              size="sm"
              className={d.inputMode !== "message" ? "bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95" : "shadow-sm"}
              onClick={() => d.setInputMode("message")}
              data-testid="button-mode-message"
            >
              <Send className="h-3 w-3 md:me-1" />
              <span className="hidden md:inline">{t("inbox.message", "Message")}</span>
            </Button>
            <Button
              type="button"
              variant={d.inputMode === "note" ? "secondary" : "outline"}
              size="sm"
              onClick={() => d.setInputMode("note")}
              className={d.inputMode === "note" ? "note-bg note-text-color shadow-sm" : "bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95"}
              data-testid="button-mode-note"
            >
              <StickyNote className="h-3 w-3 md:me-1" />
              <span className="hidden md:inline">{t("inbox.note", "Note")}</span>
            </Button>
            <Popover open={d.showQuickReplies} onOpenChange={d.setShowQuickReplies}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95" title={t("inbox.quickReplies", "תשובות מהירות")} data-testid="button-quick-replies">
                  <Zap className="h-3 w-3 md:me-1" />
                  <span className="hidden md:inline">{t("inbox.quickReplies", "Quick Replies")}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start">
                <Input placeholder={t("common.search", "Search...")} value={d.quickReplySearch} onChange={(e) => d.setQuickReplySearch(e.target.value)} className="mb-2 text-sm" data-testid="input-quick-reply-search" />
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {d.quickReplies.filter(qr => !d.quickReplySearch || qr.title.toLowerCase().includes(d.quickReplySearch.toLowerCase()) || qr.content.toLowerCase().includes(d.quickReplySearch.toLowerCase())).map(qr => (
                    <button type="button" key={qr._id} className="w-full text-start p-2 rounded-md text-sm bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95" onClick={() => { if (d.richEditorRef.current) { d.richEditorRef.current.commands.clearContent(); d.richEditorRef.current.commands.insertContent({ type: 'text', text: qr.content }); d.richEditorRef.current.commands.focus(); } else { d.setInputText(qr.content); d.textareaRef.current?.focus(); } d.setShowQuickReplies(false); d.setQuickReplySearch(""); }} data-testid={`button-qr-${qr._id}`}>
                      <p className="font-medium text-xs">{qr.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{qr.content}</p>
                    </button>
                  ))}
                  {d.quickReplies.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">{t("inbox.noQuickReplies", "No quick replies configured")}</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {selectedConv?.channel === "WHATSAPP" && (
              <Button
                variant="outline"
                size="sm"
                className="bg-white dark:bg-slate-900 !border !border-blue-400 dark:!border-blue-500 text-slate-700 dark:text-slate-200 font-medium shadow-sm hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:shadow-md transition-all duration-200 cursor-pointer active:scale-95"
                onClick={() => d.setSendTemplateDialogOpen(true)}
                title={t("waTemplates.sendTemplate", "תבניות")}
                data-testid="button-send-template-toolbar"
              >
                <FileStack className="h-3 w-3 md:me-1" />
                <span className="hidden md:inline">{t("waTemplates.sendTemplate")}</span>
              </Button>
            )}
          </div>
        </div>

        {selectedConv?.channel === "EMAIL" && d.inputMode === "message" && (
          <Input
            value={d.emailSubject}
            onChange={(e) => d.setEmailSubject(e.target.value)}
            placeholder={t("inbox.emailSubject", "Subject")}
            className="text-sm mb-1"
            data-testid="input-email-subject"
          />
        )}

        {d.attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1">
            {d.attachedFiles.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs"
                data-testid={`attached-file-${idx}`}
              >
                <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button onClick={() => d.removeFile(idx)} className="shrink-0" data-testid={`button-remove-file-${idx}`}>
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {d.isSending && d.uploadProgress > 0 && (
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden" data-testid="upload-progress-bar">
            <div
              className="h-full bg-blue-500 transition-all duration-200 ease-out rounded-full"
              style={{ width: `${d.uploadProgress}%` }}
            />
          </div>
        )}

        <div className={`${d.replyToMessage ? "border-2 border-[#1e3a5f] rounded-xl overflow-hidden" : "border-2 border-blue-400 dark:border-blue-600 focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600 rounded-xl bg-white dark:bg-slate-950 shadow-sm overflow-hidden"}`}>
        {d.replyToMessage && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[#1e3a5f] text-white" data-testid="reply-preview-bar">
            <div className="w-0.5 h-8 bg-white/70 rounded-full shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold text-white block truncate">
                {t("inbox.replyingTo", "Replying to ")}
                {d.replyToMessage.senderName || (d.replyToMessage.direction === "INBOUND" ? d.selectedConv?.customer?.firstName : t("inbox.you", "You"))}
              </span>
              <span className="text-xs text-white/70 line-clamp-1">
                {d.replyToMessage.content?.substring(0, 120) || `[${d.replyToMessage.type}]`}
              </span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/10"
              onClick={() => d.setReplyToMessage(null)}
              data-testid="button-cancel-reply"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <div className={`flex flex-col overflow-visible relative ${
          d.inputMode === "note"
            ? "note-bg note-border"
            : "wa-input-bg"
        }`}>
          <input
            ref={d.fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={d.handleFileSelect}
            data-testid="input-file-hidden"
          />
          <RichTextEditor
            onSend={d.handleRichSend}
            placeholder={
              d.inputMode === "note"
                ? t("inbox.typeNote", "Write an internal note...")
                : d.windowExpired
                  ? t("inbox.windowExpiredPlaceholder", "Send a template to continue...")
                  : t("inbox.typeMessage", "Type a message...")
            }
            disabled={d.inputMode === "message" && d.windowExpired}
            isNote={d.inputMode === "note"}
            editorRef={d.richEditorRef}
            showToolbar={mobileToolbarOpen ? true : undefined}
            className={
              d.inputMode === "note"
                ? "note-bg note-body-color"
                : "wa-input-bg"
            }
            leftActions={
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden h-8 w-8 p-2"
                  onClick={() => setMobileToolbarOpen((prev) => !prev)}
                  title={t("inbox.formatting", "עיצוב")}
                  data-testid="button-toggle-toolbar"
                >
                  <Type className={`h-4 w-4 ${mobileToolbarOpen ? "text-primary" : ""}`} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 p-2"
                  onClick={() => d.fileInputRef.current?.click()}
                  title={t("inbox.attachFiles", "קבצים")}
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                {d.sortedTags.length > 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`md:hidden h-8 w-8 p-2 ${
                      (selectedConv.tags?.length ?? 0) > 0 ? "text-primary" : ""
                    }`}
                    onClick={() => setMobileTagsOpen(true)}
                    title={t("inbox.tags", "תגיות")}
                    data-testid="button-tags-mobile"
                  >
                    <Tag className="h-4 w-4" />
                  </Button>
                )}
                <div className="relative" ref={d.emojiPickerRef}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 p-2"
                    onClick={() => d.setShowEmojiPicker((prev) => !prev)}
                    title={t("inbox.emoji", "אמוג׳י")}
                    data-testid="button-emoji-picker"
                  >
                    <Smile className="h-4 w-4" />
                  </Button>
                  {d.showEmojiPicker && (
                    <div className="absolute bottom-full mb-2 start-0 z-50" data-testid="emoji-picker-popup">
                      <Picker
                        data={data}
                        onEmojiSelect={d.handleEmojiSelect}
                        theme="auto"
                        locale={i18n.language === "he" ? "he" : i18n.language === "ar" ? "ar" : "en"}
                        previewPosition="none"
                        skinTonePosition="search"
                      />
                    </div>
                  )}
                </div>
              </>
            }
            rightActions={
              d.isRecording ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive font-medium animate-pulse">{Math.floor(d.recordingTime / 60)}:{String(d.recordingTime % 60).padStart(2, "0")}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={d.cancelRecording}
                    title={t("inbox.cancelRecording", "ביטול")}
                    data-testid="button-cancel-recording"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    onClick={d.stopRecording}
                    title={t("inbox.stopRecording", "עצור")}
                    data-testid="button-stop-recording"
                  >
                    <MicOff className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={d.startRecording}
                    title={t("inbox.voiceRecord", "הקלטה")}
                    data-testid="button-start-recording"
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    onClick={d.handleSend}
                    disabled={d.sendMutation.isPending || d.isSending || !d.canSend}
                    title={t("inbox.send", "שלח")}
                    className={`active:scale-95 transition-all duration-200 ${
                      (d.sendMutation.isPending || d.isSending)
                        ? "bg-blue-900 hover:bg-blue-900 text-white"
                        : d.inputMode === "note" ? "note-send-btn" : ""
                    }`}
                    data-testid="button-send"
                  >
                    {(d.sendMutation.isPending || d.isSending) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : d.inputMode === "note" ? (
                      <StickyNote className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </>
              )
            }
          />
        </div>
        </div>
      </div>
    </div>
  );
}
