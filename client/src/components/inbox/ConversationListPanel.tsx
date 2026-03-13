import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, MessageCircle, User, ChevronDown,
  Filter, Tag, Check, Star, AlarmClock, Clock, AlertTriangle, X,
  UserCheck, Archive, Inbox as InboxIcon, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { channelIcons, channelColors, channelBadgeBg, CHANNEL_LINE_MAP, DEFAULT_CHANNEL_LINE } from "./types";
import type { Conversation } from "./types";
import { getInitials, formatTime, formatSnoozeUntil, getSlaStatus } from "./helpers";
import { formatConversationDate } from "@/lib/format-utils";
import type { MailboxData } from "@/hooks/use-mailbox-data";

function formatSmartDuration(totalSeconds: number, t: (key: string, fallback?: string) => string) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const daysText = t("time.days", "days");
  const hoursText = t("time.hours", "hours");
  const minsText = t("time.minutes", "mins");
  if (days > 0) return `${days} ${daysText} ${hours} ${hoursText} ${minutes} ${minsText}`;
  if (hours > 0) return `${hours} ${hoursText} ${minutes} ${minsText}`;
  return `${minutes} ${minsText}`;
}

function ConvTimer({ conv }: { conv: Conversation }) {
  const { t } = useTranslation();
  const isActive = conv.status === "ACTIVE" || conv.status === "OPEN";
  const isClosed = conv.status === "RESOLVED" || conv.status === "CLOSED" || conv.status === "SPAM";
  const isPool = conv.status === "UNASSIGNED";

  const startTime = isPool
    ? (conv.createdAt || conv.lastMessageAt)
    : (conv.assignedAt || conv.createdAt);
  const endTime = isClosed ? (conv.updatedAt || conv.lastMessageAt) : undefined;

  const calcSeconds = () => {
    if (!startTime) return 0;
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  };

  const [seconds, setSeconds] = useState(calcSeconds);

  useEffect(() => {
    setSeconds(calcSeconds());
    if (!isActive && !isPool) return;
    const iv = setInterval(() => setSeconds(calcSeconds()), 60000);
    return () => clearInterval(iv);
  }, [conv._id, conv.status, startTime]);

  if (!startTime || seconds <= 0) return null;

  const minutes = Math.floor(seconds / 60);
  const label = isPool
    ? t("inbox.waitingTime", "Waiting:")
    : isClosed
      ? t("inbox.totalTime", "Duration:")
      : t("inbox.handlingTime", "Handling Time:");

  const hours = Math.floor(minutes / 60);
  const redBadge = "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
  const amberBadge = "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
  const greenBadge = "bg-green-50 text-green-600 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800";
  const blueBadge = "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";

  const badgeClass = isClosed
    ? hours >= 24 ? redBadge : hours >= 5 ? amberBadge : greenBadge
    : isPool
      ? minutes >= 10 ? redBadge : minutes >= 5 ? amberBadge : blueBadge
      : minutes >= 10 ? redBadge : minutes >= 5 ? amberBadge : greenBadge;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${badgeClass}`} data-testid={`badge-conv-timer-${conv._id}`}>
      <Timer className="w-3 h-3 shrink-0" />
      <span>{label} {formatSmartDuration(seconds, t)}</span>
    </span>
  );
}

interface Props {
  d: MailboxData;
  renderContent: (content: string) => string;
}

export function ConversationListPanel({ d, renderContent }: Props) {
  const { t } = useTranslation();

  return (
    <div
      className={`border-e bg-background flex flex-col ${
        d.mobileView === "chat" ? "hidden md:flex" : "flex"
      } shrink-0 w-full md:w-[var(--lw)]`}
      style={{ "--lw": `${d.listPanelWidth}px`, maxWidth: "100%" } as React.CSSProperties}
      data-testid="inbox-conversations-list"
    >
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold text-base" data-testid="text-inbox-title">
            {t("inbox.title", "Inbox")}
          </h2>
          {(() => {
            const totalUnread = d.conversations.reduce((sum, c) => {
              const eu = d.unreadCounts[c._id] !== undefined ? d.unreadCounts[c._id] : (c.unreadCount || 0);
              return sum + eu;
            }, 0);
            return totalUnread > 0 ? (
              <Badge variant="default" className="bg-primary text-primary-foreground" data-testid="badge-unread-total">{totalUnread}</Badge>
            ) : (
              <Badge variant="secondary" data-testid="badge-conv-count">{d.conversations.length}</Badge>
            );
          })()}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("inbox.searchPlaceholder", "Name, phone, ID, agent, CRM...")}
              value={d.search}
              onChange={(e) => d.setSearch(e.target.value)}
              className="ps-9 h-8 !border !border-blue-400 dark:!border-blue-500"
              title={t("inbox.searchTooltip", "חפש לקוח לפי שם, טלפון, מזהה...")}
              data-testid="input-inbox-search"
            />
          </div>
          <Select
            value={d.filterAgentId || "__me__"}
            onValueChange={(v) => d.setFilterAgentId(v === "__me__" ? "" : v === "__all__" ? "__all__" : v)}
            disabled={d.currentRole === "employee"}
          >
            <SelectTrigger className="h-8 text-xs w-full !border !border-blue-400 dark:!border-blue-500" data-testid="select-inbox-agent">
              <User className="h-3 w-3 shrink-0 me-1 opacity-60" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__me__">{d.displayName(d.authUser?.name) || t("inbox.snoozeAgentMe", "Me")}</SelectItem>
              {(d.currentRole === "superadmin" || d.currentRole === "businessadmin") && (
                <SelectItem value="__all__">{t("inbox.allEmployees", "All employees")}</SelectItem>
              )}
              {d.currentRole !== "employee" && d.agents.filter((a) => a._id !== d.authUser?._id).map((a) => (
                <SelectItem key={a._id} value={a._id}>{d.displayName(a.name)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {d.isSuperAdmin && d.tenants && d.tenants.length > 0 && (
          <Select value={d.filterTenantId} onValueChange={d.setFilterTenantId}>
            <SelectTrigger className="h-8 text-xs max-w-[120px] md:max-w-none truncate !border !border-blue-400 dark:!border-blue-500" data-testid="select-inbox-tenant">
              <SelectValue placeholder={t("common.allBusinesses", "All")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("common.allBusinesses", "All businesses")}</SelectItem>
              {d.tenants.map((tn: any) => (
                <SelectItem key={tn._id} value={tn._id}>{tn.nameHe || tn.nameEn}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="grid grid-cols-4 gap-1" data-testid="inbox-ownership-tabs">
          {([
            { value: "mine" as const, label: d.filterAgentId === "__all__" ? t("inbox.tabAll", "All") : t("inbox.tabMine", "Mine"), icon: UserCheck, count: d.tabCounts?.mine },
            { value: "pool" as const, label: t("inbox.tabPool", "Pool"), icon: InboxIcon, count: d.tabCounts?.pool },
            { value: "closed" as const, label: t("inbox.tabClosed", "Closed"), icon: Archive, count: d.tabCounts?.closed },
            { value: "snoozed" as const, label: t("inbox.tabSnoozed", "Snoozed"), icon: AlarmClock, count: d.tabCounts?.snoozed },
          ]).map((tab) => {
            const isPoolAlert = tab.value === "pool" && (tab.count ?? 0) > 0 && d.filterTab !== "pool";
            return (
              <Button
                key={tab.value}
                variant={d.filterTab === tab.value ? "default" : "outline"}
                size="sm"
                onClick={() => d.setFilterTab(tab.value)}
                data-testid={`tab-ownership-${tab.value}`}
                className={`w-full px-1 gap-0.5 ${d.filterTab === tab.value ? "" : "!border !border-blue-400 dark:!border-blue-500 font-medium"} ${isPoolAlert ? "animate-gentle-pulse bg-blue-50 !border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:!border-blue-800 dark:text-blue-300" : ""}`}
              >
                <tab.icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{tab.label}</span>
                {tab.count != null && (
                  <span className={`text-[10px] font-bold shrink-0 ${d.filterTab === tab.value ? "opacity-80" : isPoolAlert ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}>
                    {tab.count}
                  </span>
                )}
              </Button>
            );
          })}
          <div className="col-span-4 grid grid-cols-2 gap-1">
            <Select value={d.filterTab} onValueChange={(v) => d.setFilterTab(v as typeof d.filterTab)}>
              <SelectTrigger className="h-8 text-xs w-full !border !border-blue-400 dark:!border-blue-500" data-testid="select-inbox-filter-tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {([
                  { value: "mine", label: t("inbox.tabMine", "Mine"), count: d.tabCounts?.mine },
                  { value: "pool", label: t("inbox.tabPool", "Pool"), count: d.tabCounts?.pool },
                  { value: "closed", label: t("inbox.tabClosed", "Closed"), count: d.tabCounts?.closed },
                  { value: "snoozed", label: t("inbox.tabSnoozed", "Snoozed"), count: d.tabCounts?.snoozed },
                  { value: "spam", label: t("inbox.tabSpam", "Spam"), count: d.tabCounts?.spam },
                ]).map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}{opt.count != null ? ` (${opt.count})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {d.activeTenantId && (
              <Button
                variant={d.showFilters ? "secondary" : "ghost"}
                size="sm"
                onClick={() => d.setShowFilters(!d.showFilters)}
                className="h-8 w-full justify-start gap-1 text-xs !border !border-blue-400 dark:!border-blue-500"
                data-testid="button-toggle-filters"
              >
                <Filter className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 text-start truncate">{t("inbox.filters", "Filters")}</span>
                {(d.filterStatuses.size > 0 || d.filterTags.size > 0 || d.filterStarred || (d.filterChannels.size > 0 && d.filterChannels.size < d.tenantChannelTypes.length)) && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{
                    (d.filterStatuses.size > 0 ? 1 : 0) + (d.filterTags.size > 0 ? 1 : 0) + (d.filterStarred ? 1 : 0) + (d.filterChannels.size > 0 && d.filterChannels.size < d.tenantChannelTypes.length ? 1 : 0)
                  }</Badge>
                )}
                <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${d.showFilters ? "rotate-180" : ""}`} />
              </Button>
            )}
          </div>
        </div>
        {d.showFilters && d.activeTenantId && (
          <div className="space-y-2" data-testid="inbox-filter-panel">
            {d.tenantChannelTypes.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1 font-medium">{t("inbox.filterChannels", "Channels")}</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["WHATSAPP", "SMS", "EMAIL"] as const).filter(ch => d.tenantChannelTypes.includes(ch)).map(ch => {
                    const active = d.filterChannels.has(ch);
                    const Icon = channelIcons[ch] || MessageCircle;
                    return (
                      <Button
                        key={ch}
                        variant={active ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          d.setFilterChannels(prev => {
                            const next = new Set(prev);
                            if (next.has(ch)) next.delete(ch);
                            else next.add(ch);
                            return next;
                          });
                        }}
                        className="gap-1 text-xs"
                        data-testid={`button-filter-channel-${ch.toLowerCase()}`}
                      >
                        <Icon className="h-3 w-3" />
                        {ch === "WHATSAPP" ? "WhatsApp" : ch === "SMS" ? "SMS" : "Email"}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            <div>
              <p className="text-[11px] text-muted-foreground mb-1 font-medium">{t("inbox.filterStatuses", "Status")}</p>
              <div className="flex items-center gap-1 flex-wrap">
                {([
                  { value: "UNASSIGNED", label: t("inbox.statusUnassigned", "Unassigned") },
                  { value: "ACTIVE", label: t("inbox.statusActive", "Active") },
                  { value: "SNOOZED", label: t("inbox.statusSnoozed", "Snoozed") },
                  { value: "RESOLVED", label: t("inbox.statusResolved", "Resolved") },
                  { value: "SPAM", label: t("inbox.spam", "Spam") },
                ]).map(s => {
                  const active = d.filterStatuses.has(s.value);
                  return (
                    <Button
                      key={s.value}
                      variant={active ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        d.setFilterStatuses(prev => {
                          const next = new Set(prev);
                          if (next.has(s.value)) next.delete(s.value);
                          else next.add(s.value);
                          return next;
                        });
                      }}
                      className="text-xs"
                      data-testid={`button-filter-status-${s.value.toLowerCase()}`}
                    >
                      {s.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground mb-1 font-medium">{t("inbox.filterStarred", "Starred")}</p>
              <Button
                variant={d.filterStarred ? "default" : "outline"}
                size="sm"
                onClick={() => d.setFilterStarred(prev => !prev)}
                className="gap-1 text-xs"
                data-testid="button-filter-starred"
              >
                <Star className={`h-3 w-3 ${d.filterStarred ? "fill-current" : ""}`} />
                {t("inbox.starredOnly", "Starred only")}
              </Button>
            </div>
            {d.tenantTags.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1 font-medium">{t("inbox.filterTags", "Tags")}</p>
                <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto scrollbar-thin">
                  {d.tenantTags.map(tag => {
                    const active = d.filterTags.has(tag.name);
                    return (
                      <button
                        key={tag._id}
                        onClick={() => {
                          d.setFilterTags(prev => {
                            const next = new Set(prev);
                            if (next.has(tag.name)) next.delete(tag.name);
                            else next.add(tag.name);
                            return next;
                          });
                        }}
                        className="flex items-center gap-2 px-2 py-1 rounded-md text-xs hover-elevate text-start"
                        data-testid={`button-filter-tag-${tag._id}`}
                      >
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {active && <Check className="h-3 w-3 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {(d.filterStatuses.size > 0 || d.filterTags.size > 0 || d.filterStarred || (d.filterChannels.size > 0 && d.filterChannels.size < d.tenantChannelTypes.length)) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  d.setFilterChannels(new Set(d.tenantChannelTypes));
                  d.setFilterStatuses(new Set());
                  d.setFilterTags(new Set());
                  d.setFilterStarred(false);
                }}
                className="w-full text-xs"
                data-testid="button-clear-filters"
              >
                <X className="h-3 w-3 me-1" />
                {t("inbox.clearFilters", "Clear filters")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {d.convsLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-24 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-40 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : d.conversations.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground" data-testid="text-inbox-empty">
            <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>{t("inbox.noConversations", "No active conversations")}</p>
          </div>
        ) : (
          d.conversations.map((conv) => {
            const ChannelIcon = channelIcons[conv.channel] || MessageCircle;
            const isSelected = conv._id === d.selectedConvId;
            const sla = getSlaStatus(conv, d.getSlaConfigForConv(conv));
            const effectiveUnread = d.unreadCounts[conv._id] !== undefined ? d.unreadCounts[conv._id] : (conv.unreadCount || 0);
            const hasUnread = effectiveUnread > 0;
            return (
              <button
                key={conv._id}
                onClick={() => d.selectConversation(conv._id)}
                className={`group/conv w-full text-start py-3 md:py-2 px-3 flex items-center gap-3 md:gap-2.5 hover-elevate border-b transition-colors relative ${
                  isSelected && hasUnread ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : isSelected ? "bg-accent" : hasUnread ? "bg-primary/5" : ""
                } ${sla.breached ? "bg-destructive/5" : sla.warning ? "bg-amber-500/5" : ""}`}
                data-testid={`button-conv-${conv._id}`}
              >
                {hasUnread && (
                  <div className="absolute inset-y-0 start-0 w-1 bg-primary rounded-e-sm" />
                )}
                <Avatar className={`h-11 w-11 md:h-10 md:w-10 shrink-0 ${hasUnread ? "ring-2 ring-primary ring-offset-1" : ""}`}>
                  <AvatarFallback className="text-xs">
                    {getInitials(conv.customer)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 justify-between">
                    <span className={`text-sm truncate flex items-center gap-1 ${hasUnread ? "font-bold" : "font-medium"}`}>
                      <span className="hidden md:inline">
                        {(conv.customerConversationCount ?? 0) > 1 && (
                          <Badge variant="secondary" className="shrink-0" data-testid={`badge-conv-count-${conv._id}`}>
                            {conv.customerConversationCount}
                          </Badge>
                        )}
                      </span>
                      {conv.customer
                      ? (`${conv.customer.firstName || ""} ${conv.customer.lastName || ""}`.trim() || conv.customer.phone || "Unknown")
                      : "Unknown"}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="hidden md:inline-flex">
                        {sla.breached && (
                          <span
                            className="text-[10px] text-destructive font-semibold flex items-center gap-0.5"
                            title={t("sla.breached", { minutes: sla.waitingMinutes })}
                            data-testid={`badge-sla-breached-${conv._id}`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {sla.waitingMinutes}m
                          </span>
                        )}
                        {sla.warning && !sla.breached && (
                          <span
                            className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-0.5"
                            title={t("sla.warning", { minutes: sla.waitingMinutes })}
                            data-testid={`badge-sla-warning-${conv._id}`}
                          >
                            <Clock className="h-3 w-3" />
                            {sla.waitingMinutes}m
                          </span>
                        )}
                      </span>
                      <span className={`text-[10px] ${hasUnread ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                        {formatConversationDate(conv.lastMessageAt || conv.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <ChannelIcon className={`h-3 w-3 shrink-0 ${channelColors[conv.channel] || ""}`} />
                    <span className="hidden md:inline">
                      {conv.channel === "WHATSAPP" && (() => {
                        const li = conv.channelPhoneNumberId ? (CHANNEL_LINE_MAP[conv.channelPhoneNumberId] || DEFAULT_CHANNEL_LINE) : DEFAULT_CHANNEL_LINE;
                        return <span className={`text-[9px] font-mono px-1 rounded border shrink-0 ${li.color}`} dir="ltr" data-testid={`badge-line-${conv._id}`}>{li.label}</span>;
                      })()}
                    </span>
                    <span className={`text-xs truncate flex-1 ${hasUnread ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                      {conv.lastMessage?.content ? renderContent(conv.lastMessage.content) : "..."}
                    </span>
                    <span className="hidden md:inline-flex items-center gap-0.5">
                      {conv.status === "SNOOZED" && conv.snoozedUntil && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] text-blue-900 dark:text-blue-200 font-bold shrink-0" data-testid={`badge-snooze-until-${conv._id}`}>
                          <AlarmClock className="h-2.5 w-2.5 text-blue-900 dark:text-blue-200" />
                          {formatSnoozeUntil(conv.snoozedUntil)}
                          {(conv as any).snoozeWakeAgentName && (conv as any).snoozeWakeAgentId !== d.authUser?._id && (
                            <span className="font-normal opacity-80 ms-0.5">→ {(conv as any).snoozeWakeAgentName}</span>
                          )}
                        </span>
                      )}
                      {conv.assignedName && d.filterTab !== "mine" && (
                        <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                          <User className="h-2.5 w-2.5" />
                          {d.displayName(conv.assignedName)}
                        </span>
                      )}
                    </span>
                    {hasUnread && (
                      <span
                        className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1 shrink-0"
                        data-testid={`badge-unread-${conv._id}`}
                      >
                        {effectiveUnread}
                      </span>
                    )}
                  </div>
                  <div className="hidden md:flex items-center gap-1 mt-0.5">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); d.starMutation.mutate(conv._id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); d.starMutation.mutate(conv._id); } }}
                      className={`shrink-0 cursor-pointer transition-opacity ${conv.starred ? "opacity-100" : "opacity-0 group-hover/conv:opacity-40"}`}
                      data-testid={`button-star-${conv._id}`}
                      title={t("inbox.toggleStar", "Toggle priority")}
                    >
                      <Star className={`h-3.5 w-3.5 ${conv.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                    </span>
                    <ConvTimer conv={conv} />
                    <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${channelBadgeBg[conv.channel] || ""}`} data-testid={`badge-channel-${conv._id}`}>
                      {conv.channel}
                    </Badge>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
