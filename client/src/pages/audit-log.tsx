import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ClipboardList, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { useRole } from "@/lib/role-context";
import type { AuditLog, Tenant } from "@shared/schema";

const ACTION_TYPES = [
  "CREATE", "UPDATE", "DELETE",
  "CLAIM_CONVERSATION", "RELEASE_CONVERSATION", "TRANSFER_CONVERSATION",
  "RESOLVE_CONVERSATION", "SNOOZE_CONVERSATION", "WAKE_CONVERSATION",
  "UPDATE_SLA", "ENCRYPTION_VERIFY",
];

const ENTITY_TYPES = ["Tenant", "User", "Channel", "Conversation", "SmsTemplate", "WhatsAppTemplate", "System"];

export default function AuditLogPage() {
  const { t } = useTranslation();
  const { currentTenantId, currentRole } = useRole();

  const [actionFilter, setActionFilter] = useState("__all__");
  const [entityTypeFilter, setEntityTypeFilter] = useState("__all__");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const isSuperAdmin = currentRole === "superadmin";

  const params = new URLSearchParams();
  if (!isSuperAdmin && currentTenantId) params.set("tenantId", currentTenantId);
  if (actionFilter !== "__all__") params.set("action", actionFilter);
  if (entityTypeFilter !== "__all__") params.set("entityType", entityTypeFilter);
  if (fromDate) params.set("from", new Date(fromDate).toISOString());
  if (toDate) params.set("to", new Date(toDate + "T23:59:59").toISOString());
  params.set("page", String(page));
  params.set("limit", "50");

  const url = `/api/audit-logs?${params.toString()}`;

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number; page: number; pages: number }>({
    queryKey: [url],
  });

  const logs = data?.logs || [];
  const totalPages = data?.pages || 1;

  function actionColor(action: string): "default" | "secondary" | "destructive" | "outline" {
    if (action === "CREATE") return "default";
    if (action === "UPDATE" || action === "UPDATE_SLA") return "secondary";
    if (action === "DELETE") return "destructive";
    if (action.includes("CONVERSATION")) return "outline";
    return "outline";
  }

  function resetFilters() {
    setActionFilter("__all__");
    setEntityTypeFilter("__all__");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("auditLog.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("auditLog.subtitle")}</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-action-filter">
                <SelectValue placeholder={t("auditLog.filterAction")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("auditLog.allActions")}</SelectItem>
                {ACTION_TYPES.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityTypeFilter} onValueChange={(v) => { setEntityTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-entity-filter">
                <SelectValue placeholder={t("auditLog.filterEntity")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("auditLog.allEntities")}</SelectItem>
                {ENTITY_TYPES.map((e) => (
                  <SelectItem key={e} value={e}>{e}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              className="w-[150px]"
              data-testid="input-date-from"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              className="w-[150px]"
              data-testid="input-date-to"
            />
            <Button variant="outline" size="sm" onClick={resetFilters} data-testid="button-reset-filters">
              {t("auditLog.resetFilters")}
            </Button>
            {data && (
              <span className="text-xs text-muted-foreground ms-auto">
                {t("auditLog.totalEntries", { count: data.total })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton columns={6} />
            </div>
          ) : !logs.length ? (
            <EmptyState
              icon={ClipboardList}
              title={t("auditLog.emptyTitle")}
              description={t("auditLog.emptyDescription")}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("auditLog.timestamp")}</TableHead>
                      <TableHead>{t("auditLog.action")}</TableHead>
                      <TableHead>{t("auditLog.entityType")}</TableHead>
                      <TableHead>{t("auditLog.actor")}</TableHead>
                      <TableHead>{t("auditLog.role")}</TableHead>
                      <TableHead>{t("auditLog.details")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log._id} data-testid={`row-audit-${log._id}`}>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString() : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={actionColor(log.action)}>{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.entityType}</TableCell>
                        <TableCell className="text-sm">{log.actorName || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.role || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {log.details || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 p-4 border-t">
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
