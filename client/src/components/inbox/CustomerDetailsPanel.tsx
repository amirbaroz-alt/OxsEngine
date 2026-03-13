import { useTranslation } from "react-i18next";
import {
  MessageCircle, User, Clock, Lock,
  ChevronDown, ChevronLeft, ChevronRight, ArrowDownRight,
  Send, StickyNote, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { channelIcons } from "./types";
import { getInitials, formatPhoneDisplay } from "./helpers";
import type { MailboxData } from "@/hooks/use-mailbox-data";
import { ROLE_COLORS } from "@/lib/constants/theme";

interface Props {
  d: MailboxData;
}

export function CustomerDetailsPanel({ d }: Props) {
  const { t } = useTranslation();
  const selectedConv = d.selectedConv;
  if (!selectedConv) return null;

  return (
    <div
      className="hidden lg:flex flex-col shrink-0 border-s bg-background"
      style={{ width: d.crmPanelWidth }}
      data-testid="inbox-crm-panel"
    >
      <div className="overflow-y-auto scrollbar-thin shrink-0" style={{ height: d.crmTopHeight }}>
        {/* Compact Contact Header */}
        <div className="p-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="text-sm">{getInitials(selectedConv.customer)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate" data-testid="text-crm-name">
                {selectedConv.customer
                ? `${selectedConv.customer.firstName || ""} ${selectedConv.customer.lastName || ""}`.trim() || "Unknown"
                : "Unknown"}
              </h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {selectedConv.customer?.phone && (
                  <span className="text-xs text-muted-foreground" dir="ltr" data-testid="text-crm-phone">
                    {formatPhoneDisplay(selectedConv.customer.phone)}
                  </span>
                )}
                {selectedConv.customer?.email && (
                  <span className="text-xs text-muted-foreground truncate" data-testid="text-crm-email">
                    {selectedConv.customer.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 ${
                selectedConv.status === "ACTIVE" || selectedConv.status === "OPEN"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : selectedConv.status === "SNOOZED" || selectedConv.status === "PENDING"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    : selectedConv.status === "UNASSIGNED"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                      : ""
              }`}
              data-testid="badge-crm-status"
            >
              {t(`inbox.statuses.${selectedConv.status}`, selectedConv.status)}
            </Badge>
            {selectedConv.assignedName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="badge-crm-assigned">
                <User className="h-2.5 w-2.5 me-0.5" />
                {d.displayName(selectedConv.assignedName)}
              </Badge>
            )}
            {d.tenantMap[selectedConv.tenantId] && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0" data-testid="text-crm-tenant">
                {d.tenantMap[selectedConv.tenantId]}
              </Badge>
            )}
            {selectedConv.lastInboundAt && (
              d.windowExpired ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" data-testid="badge-crm-window">
                  <Lock className="h-3 w-3 me-1" />
                  {t("inbox.expired", "Expired")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="badge-crm-window">
                  <Clock className="h-3 w-3 me-1" />
                  {t("inbox.windowActive", "Active")}
                </Badge>
              )
            )}
          </div>
          {(d.currentRole === "superadmin" || d.currentRole === "businessadmin" || d.currentRole === "teamleader") && (
            <Button variant={d.showAuditPanel ? "default" : "outline"} size="sm" onClick={() => d.setShowAuditPanel(!d.showAuditPanel)} className="text-xs mt-1.5" data-testid="button-toggle-audit">
              <ShieldAlert className="h-3.5 w-3.5 me-1" />
              Audit
            </Button>
          )}
        </div>

        {/* Tags */}
        {selectedConv.tags && selectedConv.tags.length > 0 && (
          <div className="px-3 py-2 border-b">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              {t("inbox.tags", "Tags")}
            </h4>
            <div className="flex flex-wrap gap-1">
              {selectedConv.tags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Handling History */}
        {d.handlers.length > 0 && (
          <div className="px-3 py-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              {t("inbox.handlingHistory", "Handling History")}
            </h4>
            <div className="space-y-1.5">
              {d.handlers.slice(0, 5).map((h) => (
                <div key={h.conversationId} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{(h.agents.length ? h.agents.map(n => d.displayName(n)).join(", ") : d.displayName(h.assignedName)) || t("inbox.unassigned", "Unassigned")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 ms-[18px]">
                    <span className="text-muted-foreground">{new Date(h.resolvedAt).toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                    {h.resolutionTag && <Badge variant="outline" className="text-[10px] px-1 py-0">{h.resolutionTag}</Badge>}
                  </div>
                  {h.resolutionSummary && (
                    <p className="text-muted-foreground ms-[18px] line-clamp-2 mt-0.5">{h.resolutionSummary}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Draggable horizontal divider between top CRM section and journey */}
      <div
        className="shrink-0 h-1 flex items-center justify-center cursor-row-resize group hover-elevate"
        onMouseDown={d.handleCrmDividerResizeStart}
        data-testid="crm-horizontal-divider"
      >
        <div className="w-8 h-0.5 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
      </div>

      {/* Customer Journey Timeline or Audit Panel */}
      {d.showAuditPanel ? (
        <div className="flex-1 overflow-auto p-3 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Agent Participation</h4>
            {d.auditQuery.data?.participants.map(p => {
              const maxCount = Math.max(...(d.auditQuery.data?.participants.map(x => x.messageCount) || [1]));
              return (
                <div key={p.userId || p.name} className="flex items-center gap-2 mb-1.5 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5" onClick={() => d.scrollToAgentMessage(p.name)} data-testid={"audit-participant-" + (p.userId || p.name)}>
                  <span className="text-xs font-medium w-20 truncate">{p.name}</span>
                  <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm" style={{ width: (p.messageCount / maxCount * 100) + "%", backgroundColor: p.role === "businessadmin" || p.role === "superadmin" ? ROLE_COLORS.manager : p.role === "teamleader" ? ROLE_COLORS.teamleader : ROLE_COLORS.employee }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-6 text-right">{p.messageCount}</span>
                </div>
              );
            })}
          </div>

          {d.auditQuery.data?.auditTrail && d.auditQuery.data.auditTrail.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Audit Trail</h4>
              <div className="space-y-3">
                {d.auditQuery.data.auditTrail.map(a => (
                  <div key={a.messageId} className="border border-border rounded-lg overflow-hidden text-xs">
                    <div className="bg-red-50 dark:bg-red-950/30 border-b border-border px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-red-400 shrink-0" />
                        <span className="font-medium text-red-700 dark:text-red-400 uppercase text-[10px] tracking-wide">Original</span>
                      </div>
                      <p className="text-red-800 dark:text-red-300 line-through break-words">{a.originalContent}</p>
                    </div>
                    {a.editedAt && !a.deletedAt ? (
                      <div className="bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="font-medium text-emerald-700 dark:text-emerald-400 uppercase text-[10px] tracking-wide">Current</span>
                        </div>
                        <p className="text-emerald-800 dark:text-emerald-300 break-words">{a.currentContent}</p>
                      </div>
                    ) : a.deletedAt ? (
                      <div className="bg-gray-50 dark:bg-gray-900/30 px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                          <span className="font-medium text-gray-500 dark:text-gray-400 uppercase text-[10px] tracking-wide italic">Deleted</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="bg-muted/30 px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border">
                      {a.deletedAt ? (
                        <span className="text-red-500 font-medium">Deleted by {a.deletedBy}</span>
                      ) : (
                        <span>Edited by {a.editedBy}</span>
                      )}
                      <span>{new Date(a.archivedAt).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Handover Timeline</h4>
            <div className="space-y-1.5">
              {d.auditQuery.data?.timeline.map(tl => (
                <div key={tl.messageId} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="text-foreground">{tl.content}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(tl.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {(!d.auditQuery.data?.timeline || d.auditQuery.data.timeline.length === 0) && <p className="text-xs text-muted-foreground italic">No handover events</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin min-h-0">
          <div className="p-3 border-b">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("inbox.customerJourney", "Customer Journey")}
            </h4>
          </div>

          {d.journeyLoading ? (
            <div className="flex justify-center p-6">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : d.journey.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {t("inbox.noJourney", "No communication history")}
            </div>
          ) : (
            <div className="px-3 py-2" data-testid="journey-timeline">
              {d.journey.map((jConv, idx) => {
                const ChannelIcon = channelIcons[jConv.channel] || MessageCircle;
                const isExpanded = d.expandedJourneyConvs.has(jConv._id);
                const isCurrentConv = jConv._id === d.selectedConvId;
                const convDate = new Date(jConv.createdAt || jConv.lastMessageAt);
                const msgCount = jConv.messages?.length || 0;
                const isLast = idx === d.journey.length - 1;

                return (
                  <div key={jConv._id} className="relative" data-testid={`journey-conv-${jConv._id}`}>
                    {/* Timeline vertical line */}
                    {!isLast && (
                      <div className="absolute start-[15px] top-[28px] bottom-0 w-px bg-border" />
                    )}

                    {/* Conversation node */}
                    <div className="flex items-start gap-2 mb-1">
                      {/* Timeline dot with channel icon */}
                      <div
                        className={`relative z-10 flex items-center justify-center h-[30px] w-[30px] shrink-0 rounded-full border-2 ${
                          isCurrentConv
                            ? "border-primary bg-primary/10"
                            : jConv.status === "ACTIVE" || jConv.status === "OPEN"
                              ? "border-green-500 bg-green-50 dark:bg-green-950"
                              : jConv.status === "SNOOZED" || jConv.status === "PENDING"
                                ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                                : jConv.status === "UNASSIGNED"
                                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                                  : "border-muted-foreground/30 bg-muted"
                        }`}
                      >
                        <ChannelIcon className={`h-3.5 w-3.5 ${
                          isCurrentConv ? "text-primary" : "text-muted-foreground"
                        }`} />
                      </div>

                      {/* Conversation summary - clickable */}
                      <button
                        onClick={() => d.toggleJourneyConv(jConv._id)}
                        className={`flex-1 min-w-0 text-start p-1.5 rounded-md transition-colors ${
                          isCurrentConv ? "bg-primary/5" : "hover-elevate"
                        }`}
                        data-testid={`button-journey-toggle-${jConv._id}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">
                            {jConv.channel}
                          </span>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] px-1.5 py-0 ${
                              jConv.status === "ACTIVE" || jConv.status === "OPEN"
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : jConv.status === "SNOOZED" || jConv.status === "PENDING"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                  : jConv.status === "UNASSIGNED"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                    : ""
                            }`}
                          >
                            {t(`inbox.statuses.${jConv.status}`, jConv.status)}
                          </Badge>
                          {isCurrentConv && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0">
                              {t("inbox.current", "Current")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-muted-foreground">
                            {convDate.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" })}
                            {" "}
                            {convDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            ({msgCount} {t("inbox.msgs", "msgs")})
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground ms-auto shrink-0" />
                          ) : (
                            d.rtl ? <ChevronLeft className="h-3 w-3 text-muted-foreground ms-auto shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground ms-auto shrink-0" />
                          )}
                        </div>
                      </button>
                    </div>

                    {/* Expanded messages under this conversation */}
                    {isExpanded && jConv.messages && (
                      <div className="ms-[15px] ps-[22px] border-s border-border mb-2">
                        {/* Jump to conversation button */}
                        {!isCurrentConv && (
                          <button
                            onClick={() => d.jumpToConversation(jConv._id)}
                            className="flex items-center gap-1.5 w-full text-start p-1.5 mb-1 rounded-md text-xs text-primary font-medium hover-elevate"
                            data-testid={`button-journey-jump-${jConv._id}`}
                          >
                            <ArrowDownRight className="h-3 w-3" />
                            {t("inbox.jumpToConv", "Jump to conversation")}
                          </button>
                        )}
                        {jConv.messages.slice(-10).map((msg) => {
                          const isInbound = msg.direction === "INBOUND";
                          return (
                            <div
                              key={msg._id}
                              className="py-1 px-1.5 text-[11px] leading-tight"
                              data-testid={`journey-msg-${msg._id}`}
                            >
                              <div className="flex items-center gap-1 mb-0.5">
                                {isInbound ? (
                                  <ArrowDownRight className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                                ) : (
                                  <Send className="h-2.5 w-2.5 text-green-500 shrink-0" />
                                )}
                                <span className="text-muted-foreground">
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                {msg.isInternal && (
                                  <StickyNote className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                                )}
                              </div>
                              <p className="text-foreground/80 line-clamp-2 break-words">
                                {msg.content || `[${msg.type}]`}
                              </p>
                            </div>
                          );
                        })}
                        {jConv.messages.length > 10 && (
                          <p className="text-[10px] text-muted-foreground px-1.5 py-1">
                            +{jConv.messages.length - 10} {t("inbox.moreMessages", "more messages")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
