import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface ChannelLogsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  channelName: string;
}

interface LogEntry {
  _id: string;
  timestamp: string;
  direction: string;
  sender: string;
  senderName?: string;
  recipient: string;
  content: string;
  status: string;
  channel: string;
  messageType?: string;
  tenantId: string;
  tenantName: string;
  messageId?: string;
  errorMessage?: string;
}

interface LogsResponse {
  logs: LogEntry[];
  totalCount: number;
  page: number;
  limit: number;
}

function formatPhone(raw: string | undefined | null): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972") && digits.length >= 12) {
    const local = "0" + digits.slice(3);
    return local.slice(0, 3) + "-" + local.slice(3);
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return digits.slice(0, 3) + "-" + digits.slice(3);
  }
  if (digits.length >= 7) {
    return digits.slice(0, 3) + "-" + digits.slice(3);
  }
  return raw;
}

export function ChannelLogsDialog({ open, onOpenChange, channelId, channelName }: ChannelLogsDialogProps) {
  const { t } = useTranslation();
  const [directionFilter, setDirectionFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [page, setPage] = useState(1);
  const limit = 30;

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", String(limit));
  if (directionFilter !== "all") queryParams.set("direction", directionFilter);

  const { data, isLoading } = useQuery<LogsResponse>({
    queryKey: ["/api/channels", channelId, "logs", directionFilter, page],
    queryFn: () => apiRequest("GET", `/api/channels/${channelId}/logs?${queryParams.toString()}`).then(r => r.json()),
    enabled: open && !!channelId,
    refetchInterval: 10000,
  });

  const totalPages = data ? Math.ceil(data.totalCount / limit) : 0;

  const handleFilterChange = (dir: "all" | "inbound" | "outbound") => {
    setDirectionFilter(dir);
    setPage(1);
  };

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("channels.logsTitle", "Channel Logs")} — {channelName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-2">
          {(["all", "inbound", "outbound"] as const).map((dir) => (
            <Button
              key={dir}
              size="sm"
              variant={directionFilter === dir ? "default" : "outline"}
              onClick={() => handleFilterChange(dir)}
              data-testid={`button-log-filter-${dir}`}
            >
              {dir === "all" && t("channels.logsAll", "All")}
              {dir === "inbound" && (
                <><ArrowDownLeft className="h-3 w-3 me-1" />{t("channels.logsInbound", "Inbound")}</>
              )}
              {dir === "outbound" && (
                <><ArrowUpRight className="h-3 w-3 me-1" />{t("channels.logsOutbound", "Outbound")}</>
              )}
            </Button>
          ))}
          {data && (
            <Badge variant="secondary" className="ms-auto" data-testid="badge-log-count">
              {data.totalCount} {t("channels.logsMessages", "messages")}
            </Badge>
          )}
        </div>

        <div className="flex-1 overflow-auto border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.logs.length ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
              {t("channels.logsEmpty", "No logs found")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">{t("channels.logsTime", "Time")}</TableHead>
                  <TableHead className="w-[70px]">{t("channels.logsDirection", "Direction")}</TableHead>
                  <TableHead className="w-[120px]">{t("channels.logsSender", "Sender")}</TableHead>
                  <TableHead className="w-[120px]">{t("channels.logsRecipient", "Recipient")}</TableHead>
                  <TableHead>{t("channels.logsContent", "Content")}</TableHead>
                  <TableHead className="w-[70px]">{t("channels.logsStatus", "Status")}</TableHead>
                  <TableHead className="w-[100px]">{t("channels.logsTenant", "Tenant")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((log) => (
                  <TableRow key={log._id} data-testid={`row-log-${log._id}`}>
                    <TableCell className="text-xs font-mono whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      {log.direction === "inbound" ? (
                        <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 gap-0.5">
                          <ArrowDownLeft className="h-2.5 w-2.5" />IN
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 gap-0.5">
                          <ArrowUpRight className="h-2.5 w-2.5" />OUT
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs" dir="ltr">
                      {log.senderName && log.senderName !== log.sender
                        ? log.senderName
                        : formatPhone(log.sender)}
                    </TableCell>
                    <TableCell className="text-xs font-mono" dir="ltr">
                      {formatPhone(log.recipient)}
                    </TableCell>
                    <TableCell className="text-xs max-w-[250px] truncate" title={log.content}>
                      {log.content}
                      {log.errorMessage && (
                        <span className="text-red-500 text-[10px] block">{log.errorMessage}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={log.status === "Success" ? "default" : log.status === "Failed" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{log.tenantName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              {t("channels.logsPage", "Page")} {page} / {totalPages}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} data-testid="button-log-prev">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} data-testid="button-log-next">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
