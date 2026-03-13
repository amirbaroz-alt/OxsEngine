import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Loader2, Forward, Phone, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getQueryFn } from "@/lib/queryClient";

interface ActiveSession {
  _id: string;
  tenantId: string;
  customerPhone: string;
  customerName: string;
  lastCustomerMessageAt: string;
}

interface ForwardMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTenantId: string;
  onSelect: (phone: string) => void;
  isPending?: boolean;
  pendingPhone?: string | null;
  excludePhone?: string | null;
}

function formatRelativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return "עכשיו";
  if (diffMin < 60) return `לפני ${diffMin} דק׳`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `לפני ${diffHr} שע׳`;
  const diffDays = Math.floor(diffHr / 24);
  return `לפני ${diffDays} ימים`;
}

function formatPhone(phone: string): string {
  if (phone.startsWith("972") && phone.length >= 12) {
    const local = "0" + phone.slice(3);
    return local.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
  }
  return phone;
}

const sessionsQueryFn = getQueryFn<ActiveSession[]>({ on401: "returnNull" });

export function ForwardMessageDialog({ open, onOpenChange, activeTenantId, onSelect, isPending, pendingPhone, excludePhone }: ForwardMessageDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const searchParam = search.trim();
  const baseUrl = `/api/active-sessions?tenantId=${encodeURIComponent(activeTenantId)}`;
  const apiUrl = searchParam
    ? `${baseUrl}&searchQuery=${encodeURIComponent(searchParam)}`
    : baseUrl;

  const { data: sessionsRaw, isLoading, isError } = useQuery<ActiveSession[] | null>({
    queryKey: [apiUrl],
    queryFn: sessionsQueryFn,
    enabled: open && !!activeTenantId,
    staleTime: 10000,
    retry: false,
  });

  const sessions = (Array.isArray(sessionsRaw) ? sessionsRaw : []).filter(
    (s) => !excludePhone || s.customerPhone !== excludePhone
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 border-2 border-blue-500 overflow-hidden [&>button]:text-white [&>button]:hover:text-white/80" data-testid="dialog-forward-message">
        <DialogHeader className="p-4 pb-2 bg-blue-500 text-white">
          <DialogTitle className="flex items-center gap-2 text-base text-white">
            <Forward className="h-4 w-4" />
            {t("inbox.forwardMessage", "העבר הודעה")}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-2 sticky top-0 z-10">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("inbox.searchActiveSession", "חפש שם או מספר טלפון...")}
              className="ps-9 h-9 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-muted-foreground/40"
              dir="auto"
              data-testid="input-forward-search"
            />
          </div>
        </div>

        <ScrollArea className="max-h-[60vh] min-h-[200px]">
          {isPending && (
            <div className="flex items-center gap-2 px-4 py-2 mx-2 mb-1 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800" data-testid="text-forwarding-progress">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
              <span className="text-sm text-blue-700 dark:text-blue-300">{t("inbox.forwardingInProgress", "מעביר הודעה...")}</span>
            </div>
          )}
          {isError ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-muted-foreground" data-testid="text-forward-error">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <span>{t("common.loadError", "Failed to load data")}</span>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground" data-testid="text-no-active-sessions">
              {search ? t("inbox.noMatchingSessions", "לא נמצאו תוצאות") : t("inbox.noActiveSessions", "אין שיחות פעילות ב-24 שעות האחרונות")}
            </div>
          ) : (
            <div className="px-2 pb-2">
              {sessions.map((s) => {
                const isThisPending = isPending && pendingPhone === s.customerPhone;
                return (
                  <button
                    key={s._id}
                    onClick={() => s.customerPhone && onSelect(s.customerPhone)}
                    disabled={isPending || !s.customerPhone}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-start disabled:opacity-50 ${
                      isThisPending ? "bg-blue-50 dark:bg-blue-950 ring-1 ring-blue-300 dark:ring-blue-700" : "hover:bg-accent"
                    }`}
                    data-testid={`button-forward-to-${s.customerPhone || s._id}`}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs">
                        {s.customerName?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.customerName || s.customerPhone || t("inbox.unknownNumber", "Unknown")}</p>
                      {s.customerPhone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground" dir="ltr">{formatPhone(s.customerPhone)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("inbox.noPhoneAvailable", "No phone number")}</span>
                      )}
                    </div>
                    {isThisPending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                    ) : (
                      <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {formatRelativeTime(s.lastCustomerMessageAt)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
