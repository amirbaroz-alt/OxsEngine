import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useRole } from "@/lib/role-context";
import { Activity, Server, Link2, Zap, Clock, BarChart3, ShieldCheck, Timer } from "lucide-react";

interface AnalyticsDashboardData {
  volumeByTenant: Array<{ tenantId: string; slug: string; name: string; count: number }>;
  gatekeeper: { matches: number; mismatches: number; total: number; accuracy: number };
  processingSpeed: { avgMs: number; minMs: number; maxMs: number; samplesCount: number };
  period: string;
  timestamp: string;
}

const TENANT_COLORS = [
  "bg-blue-500 dark:bg-blue-400",
  "bg-emerald-500 dark:bg-emerald-400",
  "bg-violet-500 dark:bg-violet-400",
  "bg-amber-500 dark:bg-amber-400",
  "bg-rose-500 dark:bg-rose-400",
  "bg-cyan-500 dark:bg-cyan-400",
  "bg-fuchsia-500 dark:bg-fuchsia-400",
  "bg-lime-500 dark:bg-lime-400",
];

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { currentRole } = useRole();
  const [period, setPeriod] = useState<string>("24h");

  const isSuperAdmin = currentRole === "superadmin";

  const { data, isLoading } = useQuery<AnalyticsDashboardData>({
    queryKey: [`/api/admin/analytics/dashboard?period=${period}`],
    refetchInterval: 60000,
    enabled: isSuperAdmin,
  });

  const maxVolume = data?.volumeByTenant?.length ? Math.max(...data.volumeByTenant.map((v) => v.count)) : 0;
  const totalVolume = data?.volumeByTenant?.reduce((sum, v) => sum + v.count, 0) || 0;

  const gkAccuracy = data?.gatekeeper.accuracy ?? 100;
  const gkColor = gkAccuracy >= 95 ? "text-emerald-500" : gkAccuracy >= 80 ? "text-amber-500" : "text-red-500";
  const gkStrokeColor = gkAccuracy >= 95 ? "#10b981" : gkAccuracy >= 80 ? "#f59e0b" : "#ef4444";
  const gkBgColor = gkAccuracy >= 95 ? "bg-emerald-50 dark:bg-emerald-950/30" : gkAccuracy >= 80 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-red-50 dark:bg-red-950/30";

  const avgSpeed = data?.processingSpeed.avgMs ?? 0;
  const speedColor = avgSpeed <= 100 ? "text-emerald-600 dark:text-emerald-400" : avgSpeed <= 500 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const speedLabel = avgSpeed <= 100 ? t("analytics.speedExcellent") : avgSpeed <= 500 ? t("analytics.speedGood") : t("analytics.speedSlow");

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("analytics.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("analytics.subtitle")}</p>
        <Card className="mt-6">
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("analytics.superadminOnly")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <BarChart3 className="h-6 w-6 text-indigo-500" />
            {t("analytics.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("analytics.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1" data-testid="toggle-period">
          <Button
            variant={period === "24h" ? "default" : "ghost"}
            size="sm"
            onClick={() => setPeriod("24h")}
            data-testid="toggle-period-24h"
            className="text-xs h-7 px-3"
          >
            <Clock className="h-3.5 w-3.5 me-1" />
            {t("analytics.today")}
          </Button>
          <Button
            variant={period === "7d" ? "default" : "ghost"}
            size="sm"
            onClick={() => setPeriod("7d")}
            data-testid="toggle-period-7d"
            className="text-xs h-7 px-3"
          >
            <Clock className="h-3.5 w-3.5 me-1" />
            {t("analytics.last7Days")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>{t("analytics.noDataYet")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <Card data-testid="stat-total-messages">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Server className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">{t("analytics.totalMessages")}</span>
                </div>
                <div className="text-2xl font-bold">{totalVolume}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {data.volumeByTenant.length} {t("analytics.activeTenants")}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="stat-gatekeeper">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-fuchsia-500" />
                  <span className="text-xs text-muted-foreground">{t("monitor.gatekeeperAccuracy")}</span>
                </div>
                <div className={`text-2xl font-bold ${gkColor}`}>{gkAccuracy}%</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {data.gatekeeper.total} {t("analytics.validations")}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="stat-avg-speed">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">{t("monitor.avgProcessing")}</span>
                </div>
                <div className={`text-2xl font-bold ${speedColor}`}>{avgSpeed}<span className="text-sm font-normal text-muted-foreground">ms</span></div>
                <div className="text-xs text-muted-foreground mt-1">{speedLabel}</div>
              </CardContent>
            </Card>
            <Card data-testid="stat-samples">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-violet-500" />
                  <span className="text-xs text-muted-foreground">{t("monitor.samples")}</span>
                </div>
                <div className="text-2xl font-bold">{data.processingSpeed.samplesCount}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {period === "24h" ? t("analytics.today") : t("analytics.last7Days")}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Card className="md:col-span-1" data-testid="card-volume-by-tenant">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4 text-blue-500" />
                  {t("monitor.volumeByTenant")}
                  <Badge variant="secondary" className="text-[10px] font-normal ms-auto">
                    {period === "24h" ? t("analytics.today") : t("analytics.last7Days")}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.volumeByTenant.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{t("analytics.noDataYet")}</p>
                ) : (
                  <div className="space-y-3">
                    {data.volumeByTenant.map((tenant, i) => (
                      <div key={tenant.tenantId} data-testid={`bar-tenant-${tenant.slug}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate max-w-[160px]" data-testid={`text-tenant-name-${tenant.slug}`}>
                            {tenant.name}
                          </span>
                          <span className="text-sm text-muted-foreground font-mono" data-testid={`text-tenant-count-${tenant.slug}`}>
                            {tenant.count}
                            <span className="text-xs ms-1">({totalVolume > 0 ? Math.round((tenant.count / totalVolume) * 100) : 0}%)</span>
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-3">
                          <div
                            className={`h-3 rounded-full transition-all duration-700 ${TENANT_COLORS[i % TENANT_COLORS.length]}`}
                            style={{ width: `${maxVolume > 0 ? (tenant.count / maxVolume) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="text-xs text-muted-foreground text-end pt-2 border-t" data-testid="text-total-volume">
                      {totalVolume} {t("monitor.messages")}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-1" data-testid="card-gatekeeper-accuracy">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-fuchsia-500" />
                  {t("monitor.gatekeeperAccuracy")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-40 h-40">
                    <svg viewBox="0 0 36 36" className="w-40 h-40 -rotate-90">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        className="stroke-muted"
                        strokeWidth="2.5"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke={gkStrokeColor}
                        strokeWidth="2.5"
                        strokeDasharray={`${gkAccuracy}, 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-3xl font-bold ${gkColor}`} data-testid="text-gatekeeper-accuracy">
                        {gkAccuracy}%
                      </span>
                      <span className="text-[10px] text-muted-foreground">{t("analytics.accuracy")}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div className="text-center rounded-lg bg-emerald-50 dark:bg-emerald-950/30 py-3 px-2">
                      <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-gatekeeper-matches">
                        {data.gatekeeper.matches}
                      </div>
                      <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70">{t("monitor.gatekeeperMatches")}</div>
                    </div>
                    <div className="text-center rounded-lg bg-fuchsia-50 dark:bg-fuchsia-950/30 py-3 px-2">
                      <div className="text-lg font-bold text-fuchsia-600 dark:text-fuchsia-400" data-testid="text-gatekeeper-mismatches">
                        {data.gatekeeper.mismatches}
                      </div>
                      <div className="text-xs text-fuchsia-600/70 dark:text-fuchsia-400/70">{t("monitor.gatekeeperMismatches")}</div>
                    </div>
                  </div>

                  <div className={`w-full text-center rounded-lg ${gkBgColor} py-2`}>
                    <span className="text-xs text-muted-foreground">{t("analytics.totalValidated")}: </span>
                    <span className="text-xs font-bold">{data.gatekeeper.total}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-1" data-testid="card-processing-speed">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  {t("monitor.processingSpeed")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center gap-4">
                  <div className="text-center py-4">
                    <div className={`text-5xl font-bold ${speedColor}`} data-testid="text-avg-processing">
                      {avgSpeed}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">ms {t("monitor.avgProcessing")}</div>
                    <Badge variant="secondary" className="mt-2 text-[10px]">{speedLabel}</Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3 w-full">
                    <div className="text-center rounded-lg bg-muted/50 py-3">
                      <div className="text-base font-bold" data-testid="text-min-processing">
                        {data.processingSpeed.minMs}
                      </div>
                      <div className="text-[10px] text-muted-foreground">ms</div>
                      <div className="text-xs text-muted-foreground mt-1">{t("monitor.minProcessing")}</div>
                    </div>
                    <div className="text-center rounded-lg bg-muted/50 py-3">
                      <div className="text-base font-bold" data-testid="text-max-processing">
                        {data.processingSpeed.maxMs}
                      </div>
                      <div className="text-[10px] text-muted-foreground">ms</div>
                      <div className="text-xs text-muted-foreground mt-1">{t("monitor.maxProcessing")}</div>
                    </div>
                    <div className="text-center rounded-lg bg-muted/50 py-3">
                      <div className="text-base font-bold" data-testid="text-samples-count">
                        {data.processingSpeed.samplesCount}
                      </div>
                      <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                      <div className="text-xs text-muted-foreground mt-1">{t("monitor.samples")}</div>
                    </div>
                  </div>

                  <div className="w-full rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("analytics.speedRange")}</span>
                      <span className="font-mono font-medium">{data.processingSpeed.minMs}ms — {data.processingSpeed.maxMs}ms</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
