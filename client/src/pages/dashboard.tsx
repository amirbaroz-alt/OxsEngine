import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, Users, MessageSquare, CheckCircle, XCircle, Mail, Phone } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/lib/role-context";
import type { Tenant, CommunicationLog } from "@shared/schema";
import { formatPhoneDisplay } from "@/lib/format-utils";

function resolveContactPhone(log: { recipient: string; sender?: string; direction?: string }): string {
  const r = log.recipient || "";
  const rDigits = r.replace(/\D/g, "");
  if (rDigits.length >= 15 && log.sender) {
    return log.sender;
  }
  return r;
}

interface DashboardStats {
  tenants: number;
  users: number;
  communications: { total: number; success: number; failed: number; pending: number };
  recentLogs: CommunicationLog[];
}

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { currentRole, currentTenantId } = useRole();
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  const effectiveTenantId = currentRole !== "superadmin" && currentTenantId
    ? currentTenantId
    : selectedTenantId !== "all" ? selectedTenantId : undefined;

  const tenantParam = effectiveTenantId ? `?tenantId=${effectiveTenantId}` : "";

  const dashboardUrl = `/api/dashboard/stats${tenantParam}`;
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: [dashboardUrl],
    refetchOnMount: "always",
  });

  const isHebrew = i18n.language === "he";

  const getTenantName = (tenant: Tenant) => {
    return isHebrew ? tenant.nameHe : (tenant.nameEn || tenant.nameHe);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-1" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        {currentRole === "superadmin" && (
          <Select
            value={selectedTenantId}
            onValueChange={setSelectedTenantId}
            data-testid="select-tenant-filter"
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t("dashboard.businesses")}
          value={stats?.tenants ?? 0}
          icon={Building2}
          description={t("dashboard.activeBusinesses")}
        />
        <StatCard
          title={t("dashboard.users")}
          value={stats?.users ?? 0}
          icon={Users}
          description={t("dashboard.totalUsers")}
        />
        <StatCard
          title={t("dashboard.messages")}
          value={stats?.communications?.total ?? 0}
          icon={MessageSquare}
          description={t("dashboard.messagesSuccess", { count: stats?.communications?.success ?? 0 })}
        />
        <StatCard
          title={t("dashboard.failedMessages")}
          value={stats?.communications?.failed ?? 0}
          icon={Mail}
          description={`${stats?.communications?.pending ?? 0} ${t("dashboard.pending")}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">{t("dashboard.channelOverview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">SMS</span>
                </div>
                <Badge variant="secondary">
                  {stats?.communications?.total ?? 0}
                </Badge>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Email</span>
                </div>
                <Badge variant="secondary">-</Badge>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">WhatsApp</span>
                </div>
                <Badge variant="secondary">-</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">{t("dashboard.recentMessages")}</CardTitle>
          </CardHeader>
          <CardContent>
            {(!stats?.recentLogs || stats.recentLogs.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-6">{t("dashboard.noRecentMessages")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {stats.recentLogs.slice(0, 5).map((log) => (
                  <div key={log._id} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-2">
                      {log.status === "Success" ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm font-mono" dir="ltr">{formatPhoneDisplay(resolveContactPhone(log))}</span>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        log.status === "Success"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : log.status === "Failed"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }
                    >
                      {t(`communicationLog.statuses.${log.status}`)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
