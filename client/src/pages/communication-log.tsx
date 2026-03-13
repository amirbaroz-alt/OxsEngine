import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { MessageSquare, Send, CheckCircle, XCircle, Clock, RefreshCw, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/lib/role-context";
import type { CommunicationLog, Tenant } from "@shared/schema";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatPhoneDisplay, formatDate } from "@/lib/format-utils";

function resolveContactPhone(log: { recipient: string; sender?: string; direction?: string }): string {
  const r = log.recipient || "";
  const rDigits = r.replace(/\D/g, "");
  if (rDigits.length >= 15 && log.sender) {
    return log.sender;
  }
  return r;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "Success") return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === "Failed") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

function statusBadgeClass(status: string) {
  if (status === "Success") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (status === "Failed") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
}

export default function CommunicationLogPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { currentRole, currentTenantId } = useRole();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");

  const isHebrew = i18n.language === "he";

  const effectiveTenantId = currentRole !== "superadmin" && currentTenantId
    ? currentTenantId
    : selectedTenantId !== "all" ? selectedTenantId : undefined;

  const tenantParam = effectiveTenantId ? `?tenantId=${effectiveTenantId}` : "";

  const sendSmsSchema = z.object({
    recipient: z.string().min(9, t("communicationLog.validation.phoneInvalid")),
    content: z.string().min(1, t("communicationLog.validation.contentRequired")),
    tenantId: z.string().min(1, t("communicationLog.validation.selectBusiness")),
  });

  type SendSmsForm = z.infer<typeof sendSmsSchema>;

  const commLogsUrl = `/api/communication-logs${tenantParam}`;
  const { data: logs, isLoading } = useQuery<CommunicationLog[]>({
    queryKey: [commLogsUrl],
  });

  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });

  const getTenantName = (tenant: Tenant) => {
    return isHebrew ? tenant.nameHe : (tenant.nameEn || tenant.nameHe);
  };

  const form = useForm<SendSmsForm>({
    resolver: zodResolver(sendSmsSchema),
    defaultValues: { recipient: "", content: "", tenantId: effectiveTenantId || "" },
  });

  const sendMutation = useMutation({
    mutationFn: (data: SendSmsForm) => apiRequest("POST", "/api/sms/send", data),
    onSuccess: async (res) => {
      const result = await res.json();
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/communication-logs") });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      if (result.status === "Failed") {
        toast({ title: t("communicationLog.sendError"), description: result.errorMessage, variant: "destructive" });
      } else {
        toast({ title: t("communicationLog.sentSuccess") });
      }
      setSendDialogOpen(false);
      form.reset({ recipient: "", content: "", tenantId: effectiveTenantId || "" });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (logId: string) => apiRequest("POST", `/api/sms/retry/${logId}`),
    onSuccess: async (res) => {
      const result = await res.json();
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/communication-logs") });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      if (result.status === "Failed") {
        toast({ title: t("communicationLog.retryFailed"), description: result.errorMessage, variant: "destructive" });
      } else {
        toast({ title: t("communicationLog.retrySuccess") });
      }
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  function onSubmit(values: SendSmsForm) {
    sendMutation.mutate(values);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("communicationLog.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("communicationLog.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentRole === "superadmin" && (
            <Select
              value={selectedTenantId}
              onValueChange={setSelectedTenantId}
            >
              <SelectTrigger className="w-[250px]" data-testid="select-trigger-tenant-filter">
                <SelectValue placeholder={t("dashboard.filterByTenant")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-item-all-tenants">
                  {t("dashboard.allTenants")}
                </SelectItem>
                {tenants?.map((tenant) => (
                  <SelectItem
                    key={tenant._id}
                    value={tenant._id}
                    data-testid={`select-item-tenant-${tenant._id}`}
                  >
                    {getTenantName(tenant)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {currentRole !== "superadmin" && currentTenantId && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" data-testid="badge-locked-tenant">
                {tenants?.find(t => t._id === currentTenantId)
                  ? getTenantName(tenants.find(t => t._id === currentTenantId)!)
                  : currentTenantId}
              </Badge>
            </div>
          )}
          <Button variant="outline" onClick={() => { window.open(`/api/export/communication-logs${tenantParam}`, "_blank"); }} data-testid="button-export-comms">
            <Download className="h-4 w-4 me-2" />
            {t("export.exportCsv")}
          </Button>
          <Button onClick={() => { form.reset({ recipient: "", content: "", tenantId: effectiveTenantId || "" }); setSendDialogOpen(true); }} data-testid="button-send-sms">
            <Send className="h-4 w-4 me-2" />
            {t("communicationLog.sendMessage")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton columns={6} />
            </div>
          ) : !logs || logs.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={t("communicationLog.emptyTitle")}
              description={t("communicationLog.emptyDescription")}
              actionLabel={t("communicationLog.emptyAction")}
              onAction={() => { form.reset({ recipient: "", content: "", tenantId: effectiveTenantId || "" }); setSendDialogOpen(true); }}
            />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("communicationLog.date")}</TableHead>
                  <TableHead>{t("communicationLog.recipient")}</TableHead>
                  <TableHead>{t("communicationLog.content")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("communicationLog.retries")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log._id} data-testid={`row-log-${log._id}`}>
                    <TableCell className="text-sm whitespace-nowrap">{formatDate(log.timestamp, i18n.language)}</TableCell>
                    <TableCell dir="ltr" className="font-mono text-sm">{formatPhoneDisplay(resolveContactPhone(log))}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{log.content}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusIcon status={log.status} />
                        <Badge variant="secondary" className={statusBadgeClass(log.status)}>
                          {t(`communicationLog.statuses.${log.status}`)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{log.retryCount}</TableCell>
                    <TableCell>
                      {log.status === "Failed" && log.retryCount < 3 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => retryMutation.mutate(log._id)}
                              disabled={retryMutation.isPending}
                              data-testid={`button-retry-${log._id}`}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("common.retry")}</TooltipContent>
                        </Tooltip>
                      )}
                      {log.errorMessage && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-red-500 cursor-help">{t("common.errorLabel")}</span>
                          </TooltipTrigger>
                          <TooltipContent dir="ltr" className="max-w-xs">
                            {log.errorMessage}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={sendDialogOpen} onOpenChange={(open) => { if (!open) { setSendDialogOpen(false); form.reset(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("communicationLog.sendSmsTitle")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="recipient"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("communicationLog.phoneNumber")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="0501234567" dir="ltr" data-testid="input-sms-recipient" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("communicationLog.messageContent")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder={t("communicationLog.messagePlaceholder")} className="resize-none" rows={3} data-testid="input-sms-content" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tenants.selectBusiness")}</FormLabel>
                    {currentRole !== "superadmin" && currentTenantId ? (
                      <>
                        <Input
                          value={tenants?.find(t => t._id === currentTenantId)
                            ? getTenantName(tenants.find(t => t._id === currentTenantId)!)
                            : currentTenantId}
                          disabled
                          data-testid="input-sms-tenant-locked"
                        />
                        <input type="hidden" {...field} value={currentTenantId} />
                      </>
                    ) : (
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-sms-tenant">
                            <SelectValue placeholder={t("tenants.selectPlaceholder")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants?.map((tenant) => (
                            <SelectItem key={tenant._id} value={tenant._id}>
                              {getTenantName(tenant)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => { setSendDialogOpen(false); form.reset(); }}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={sendMutation.isPending} data-testid="button-submit-sms">
                  {sendMutation.isPending ? t("communicationLog.sending") : t("communicationLog.send")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
