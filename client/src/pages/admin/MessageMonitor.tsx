import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useRole } from "@/lib/role-context";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { queryClient } from "@/lib/queryClient";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  FileDigit,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FileType,
  Image,
  Info,
  Lightbulb,
  Link2,
  Loader2,
  Mail,
  MapPin,
  MemoryStick,
  MessageSquareText,
  Mic,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  BookOpen,
  Database,
  Gauge,
  KeyRound,
  Lock,
  MousePointerClick,
  ShieldAlert,
  Zap,
  Smile,
  Sticker,
  Users,
  Video,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

interface AuditStep {
  step: string;
  status: string;
  error?: string;
  duration?: number;
  timestamp: string;
}

interface AuditTrace {
  _id: string;
  traceId: string;
  parentTraceId?: string;
  whatsappMessageId?: string;
  tenantId?: string;
  direction: "INBOUND" | "OUTBOUND";
  pipelineStatus: string;
  encryptedContent?: string;
  retryCount: number;
  steps: AuditStep[];
  createdAt: string;
  assignedWorkerId?: string;
  messageType?: string;
  mimeType?: string;
  fileSize?: number;
  senderPhone?: string;
  senderName?: string;
  phoneNumberId?: string;
}

interface AuditLogsResponse {
  traces: AuditTrace[];
  total: number;
  page: number;
  pages: number;
}

interface BufferStatsResponse {
  buffer: {
    activeTraces: number;
    traces: Array<{ traceId: string; direction: string; status: string; age: number; steps: number }>;
  };
  failureRate: number;
  totalLast24h: number;
  failedLast24h: number;
  serverUptime: number;
}

interface DiagnosisResult {
  traceId: string;
  pipelineStatus: string;
  diagnosisCode: string;
  failedSteps: Array<{ step: string; error?: string }>;
  tenantId: string | null;
  direction: string;
  timestamp: string;
}

interface TenantInfo {
  _id: string;
  nameEn?: string;
  nameHe?: string;
  slug?: string;
}

const IL_TZ = "Asia/Jerusalem";

const CHANNEL_MAP: Record<string, { label: string; color: string }> = {
  "974917135711141": { label: "03-5020115", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
};
const DEFAULT_CHANNEL = { label: "03-5020940", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" };

const CONTENT_TYPE_CONFIG: Record<string, { icon: typeof MessageSquareText; labelKey: string }> = {
  text: { icon: MessageSquareText, labelKey: "monitor.contentText" },
  image: { icon: Image, labelKey: "monitor.contentImage" },
  audio: { icon: Mic, labelKey: "monitor.contentAudio" },
  video: { icon: Video, labelKey: "monitor.contentVideo" },
  document: { icon: FileText, labelKey: "monitor.contentDocument" },
  location: { icon: MapPin, labelKey: "monitor.contentLocation" },
  contacts: { icon: Users, labelKey: "monitor.contentContacts" },
  sticker: { icon: Sticker, labelKey: "monitor.contentSticker" },
  template: { icon: FileText, labelKey: "monitor.contentTemplate" },
  reaction: { icon: Smile, labelKey: "monitor.contentReaction" },
  interactive: { icon: MousePointerClick, labelKey: "monitor.contentInteractive" },
  button: { icon: MousePointerClick, labelKey: "monitor.contentButton" },
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; labelKey: string }> = {
  COMPLETED: { icon: CheckCircle2, color: "text-emerald-500", labelKey: "monitor.completed" },
  FAILED: { icon: XCircle, color: "text-red-500", labelKey: "monitor.failed" },
  STUCK: { icon: AlertTriangle, color: "text-orange-500", labelKey: "monitor.stuck" },
  PARTIAL: { icon: AlertTriangle, color: "text-orange-500", labelKey: "monitor.partial" },
  PARTIAL_BUFFER_EXCEEDED: { icon: AlertTriangle, color: "text-orange-500", labelKey: "monitor.bufferExceeded" },
  PENDING: { icon: Clock, color: "text-blue-500", labelKey: "monitor.pending" },
};

function formatTimestampIL(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IL", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTimeWithMs(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-IL", {
    timeZone: IL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${time}.${ms}`;
}

function formatPhone(raw?: string): string {
  if (!raw) return "—";
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned.startsWith("972") && cleaned.length >= 10) {
    const local = cleaned.slice(3);
    return `0${local.slice(0, 2)}-${local.slice(2)}`;
  }
  if (cleaned.startsWith("0") && cleaned.length >= 9 && cleaned.length <= 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }
  return raw;
}

function StatusBadge({ status, diagnosisCode, isFallbackOrphan }: { status: string; diagnosisCode?: string; isFallbackOrphan?: boolean }) {
  const { t } = useTranslation();
  if (status === "FAILED" && diagnosisCode === "AUTH_MISSING") {
    return (
      <Badge variant="outline" className="gap-1 text-red-800 dark:text-red-300 border-red-800/40 dark:border-red-400/40" data-testid={`badge-status-AUTH_MISSING`}>
        <ShieldAlert className="h-3 w-3" />
        {t("monitor.authMissing")}
      </Badge>
    );
  }
  if (status === "FAILED" && diagnosisCode === "DB_TIMEOUT") {
    return (
      <Badge variant="outline" className="gap-1 text-red-700 dark:text-red-400 border-red-700/40 dark:border-red-500/40" data-testid={`badge-status-DB_TIMEOUT`}>
        <Clock className="h-3 w-3" />
        {t("monitor.dbTimeout")}
      </Badge>
    );
  }
  if (diagnosisCode === "WEBHOOK_URL_MISMATCH") {
    return (
      <Badge variant="outline" className="gap-1 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-600/40 dark:border-fuchsia-400/40" data-testid={`badge-status-URL_MISMATCH`}>
        <Link2 className="h-3 w-3" />
        {t("monitor.urlMismatch")}
      </Badge>
    );
  }
  if (status === "FAILED" && diagnosisCode === "TENANT_NOT_FOUND") {
    return (
      <Badge variant="outline" className="gap-1 text-orange-500 border-current/30" data-testid={`badge-status-WARNING`}>
        <AlertTriangle className="h-3 w-3" />
        {t("monitor.unidentified")}
      </Badge>
    );
  }
  if (isFallbackOrphan) {
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400 border-current/30" data-testid={`badge-status-FALLBACK`}>
        <AlertTriangle className="h-3 w-3" />
        {t("monitor.unidentified")}
      </Badge>
    );
  }
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.color} border-current/30`} data-testid={`badge-status-${status}`}>
      <Icon className="h-3 w-3" />
      {t(cfg.labelKey)}
    </Badge>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  const { t } = useTranslation();
  const isInbound = direction === "INBOUND";
  return (
    <Badge variant="secondary" className="gap-1" data-testid={`badge-direction-${direction}`}>
      {isInbound ? <ArrowDownLeft className="h-3 w-3 text-blue-500" /> : <ArrowUpRight className="h-3 w-3 text-violet-500" />}
      {isInbound ? t("monitor.inbound") : t("monitor.outbound")}
    </Badge>
  );
}

function getDocumentIcon(mimeType?: string): { icon: typeof FileText; color: string; label: string } {
  if (!mimeType) return { icon: FileText, color: "text-muted-foreground", label: "" };
  const m = mimeType.toLowerCase();
  if (m.includes("pdf")) return { icon: FileText, color: "text-red-500", label: "PDF" };
  if (m.includes("word") || m.includes("msword") || m.includes("docx") || m.includes("doc"))
    return { icon: FileDigit, color: "text-blue-500", label: "Word" };
  if (m.includes("excel") || m.includes("spreadsheet") || m.includes("xlsx") || m.includes("xls") || m.includes("csv"))
    return { icon: FileSpreadsheet, color: "text-green-600", label: "Excel" };
  if (m.includes("powerpoint") || m.includes("presentation") || m.includes("pptx"))
    return { icon: FileText, color: "text-orange-500", label: "PPT" };
  return { icon: FileText, color: "text-muted-foreground", label: "" };
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  return mb.toFixed(1) + "M";
}

function ContentTypeBadge({ messageType, mimeType, fileSize }: { messageType?: string; mimeType?: string; fileSize?: number }) {
  const { t } = useTranslation();
  const type = messageType || "unknown";
  const cfg = CONTENT_TYPE_CONFIG[type];
  let Icon = cfg?.icon || MessageSquareText;
  let label = cfg ? t(cfg.labelKey) : t("monitor.contentUnknown");
  let iconColor = "text-muted-foreground";

  if (type === "document" && mimeType) {
    const docInfo = getDocumentIcon(mimeType);
    Icon = docInfo.icon;
    iconColor = docInfo.color;
    if (docInfo.label) label = docInfo.label;
  } else if (type === "audio") {
    iconColor = "text-violet-500";
  } else if (type === "image") {
    iconColor = "text-sky-500";
  } else if (type === "video") {
    iconColor = "text-pink-500";
  }

  const sizeStr = formatFileSize(fileSize);
  const tooltipText = [label, mimeType ? `(${mimeType})` : "", sizeStr].filter(Boolean).join(" ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5" data-testid={`badge-content-${type}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
          {sizeStr && <span className="text-[10px] text-muted-foreground/70 font-mono" data-testid={`text-filesize-${type}`}>{sizeStr}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

function ChannelBadge({ phoneNumberId }: { phoneNumberId?: string }) {
  const channel = phoneNumberId ? (CHANNEL_MAP[phoneNumberId] || DEFAULT_CHANNEL) : DEFAULT_CHANNEL;
  return (
    <Badge variant="outline" className={`text-[11px] font-mono ${channel.color}`} data-testid={`badge-channel-${phoneNumberId || "default"}`}>
      {channel.label}
    </Badge>
  );
}

function StepTimeline({ steps }: { steps: AuditStep[] }) {
  return (
    <div className="space-y-1 py-2" data-testid="step-timeline">
      {steps.map((step, i) => {
        const isOK = step.status === "OK";
        const isFail = step.status === "FAIL";
        let deltaMs: number | null = null;
        if (i > 0) {
          const prev = new Date(steps[i - 1].timestamp).getTime();
          const curr = new Date(step.timestamp).getTime();
          deltaMs = curr - prev;
        }
        return (
          <div key={i} className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full border-2 mt-1 ${isOK ? "border-emerald-500 bg-emerald-500/20" : isFail ? "border-red-500 bg-red-500/20" : "border-muted-foreground bg-muted"}`} />
              {i < steps.length - 1 && <div className="w-px h-6 bg-border" />}
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono font-medium" data-testid={`step-name-${i}`}>{step.step}</span>
                <Badge variant={isOK ? "default" : isFail ? "destructive" : "secondary"} className="text-[10px] h-4 px-1">{step.status}</Badge>
                {deltaMs != null && (
                  <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400" data-testid={`step-delta-${i}`}>+{deltaMs}ms</span>
                )}
                {step.duration != null && (
                  <span className="text-[11px] text-muted-foreground font-mono">({step.duration}ms)</span>
                )}
              </div>
              {step.error && <p className="text-xs text-red-500 mt-0.5 truncate" data-testid={`step-error-${i}`}>{step.error}</p>}
              <p className="text-[10px] text-muted-foreground font-mono">{formatTimeWithMs(step.timestamp)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvestigationLog({ diagnosis }: { diagnosis: DiagnosisResult }) {
  const { t } = useTranslation();
  const code = diagnosis.diagnosisCode;
  const rec = t(`diagnostics.${code}_REC`, { defaultValue: "" });
  const action = t(`diagnostics.${code}_ACTION`, { defaultValue: "" });
  const result = t(`diagnostics.${code}_RESULT`, { defaultValue: "" });

  if (code === "NO_FAILURE_DETECTED" && !rec) {
    return (
      <div className="text-xs text-muted-foreground italic" data-testid="text-diag-no-failure">
        {t("monitor.diagNoFailure")}
      </div>
    );
  }

  const isAuthMissing = code === "AUTH_MISSING" || code === "DB_TIMEOUT";
  const panelBorder = isAuthMissing ? "border-red-300 dark:border-red-800" : "border-amber-200 dark:border-amber-800";
  const panelBg = isAuthMissing ? "bg-red-50/50 dark:bg-red-950/20" : "bg-amber-50/50 dark:bg-amber-950/20";
  const panelIconColor = isAuthMissing ? "text-red-700 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  const panelLabelColor = isAuthMissing ? "text-red-800 dark:text-red-300" : "text-amber-700 dark:text-amber-300";

  return (
    <div className={`space-y-2 rounded-md border ${panelBorder} ${panelBg} p-3`} data-testid="panel-investigation-log">
      <div className="flex items-center gap-2 mb-1">
        {isAuthMissing ? <ShieldAlert className={`h-4 w-4 ${panelIconColor}`} /> : <FileSearch className={`h-4 w-4 ${panelIconColor}`} />}
        <span className={`text-sm font-semibold ${panelLabelColor}`}>{t("monitor.investigationLog")}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono">{code}</Badge>
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-amber-700 dark:text-amber-300">{t("monitor.diagRecommendation")}:</span>{" "}
            <span className="text-foreground">{rec || code}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Activity className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-blue-700 dark:text-blue-300">{t("monitor.diagAction")}:</span>{" "}
            <span className="text-foreground">{action || "—"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">{t("monitor.diagResults")}:</span>{" "}
            <span className="text-foreground">{result || "—"}</span>
          </div>
        </div>
      </div>
      {diagnosis.failedSteps.length > 0 && (
        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
          <span className="text-[11px] font-semibold text-muted-foreground">{t("monitor.diagFailedSteps")}:</span>
          <div className="space-y-0.5 mt-1">
            {diagnosis.failedSteps.map((fs, i) => (
              <div key={i} className="text-[11px] font-mono text-red-600 dark:text-red-400">
                • {fs.step}{fs.error ? `: ${fs.error}` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SystemStatsData {
  cache: {
    cacheHits: number;
    dbFallbacks: number;
    totalResolutions: number;
    cacheHitRate: number;
    channelsLoaded: number;
    channelsByPhone: number;
    lastRebuiltAt: string | null;
    initialized: boolean;
  };
  latency: {
    avgMs: number;
    samples: number[];
  };
  tokens: {
    active: number;
    expired: number;
    total: number;
  };
  serverUptime: number;
  timestamp: string;
}

function SystemHealthCard() {
  const { t } = useTranslation();

  const { data: stats, isLoading } = useQuery<SystemStatsData>({
    queryKey: ["/api/admin/system-stats"],
    refetchInterval: 30000,
  });

  const cacheRate = stats?.cache.cacheHitRate ?? 0;
  const cacheBarColor = cacheRate >= 95 ? "bg-emerald-500" : cacheRate >= 80 ? "bg-amber-500" : "bg-red-500";
  const cacheTextColor = cacheRate >= 95 ? "text-emerald-600 dark:text-emerald-400" : cacheRate >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  const avgLatency = stats?.latency.avgMs ?? 0;
  const latencyColor = avgLatency <= 50 ? "text-emerald-600 dark:text-emerald-400" : avgLatency <= 200 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  const tokensActive = stats?.tokens.active ?? 0;
  const tokensTotal = stats?.tokens.total ?? 0;
  const tokensExpired = stats?.tokens.expired ?? 0;
  const tokensColor = tokensExpired === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  return (
    <Card data-testid="card-system-perf">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-500" />
          {t("monitor.systemPerf")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {t("monitor.cacheHitRate")}
                </span>
                <span className={`text-xs font-bold ${cacheTextColor}`} data-testid="text-cache-hit-rate">
                  {cacheRate}%
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${cacheBarColor}`}
                  style={{ width: `${Math.min(cacheRate, 100)}%` }}
                  data-testid="bar-cache-hit-rate"
                />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-muted-foreground">
                  {stats?.cache.cacheHits ?? 0} cache / {stats?.cache.dbFallbacks ?? 0} DB
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t("monitor.target")}: ≥95%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className={`text-lg font-bold ${latencyColor}`} data-testid="text-avg-latency">
                  {avgLatency}<span className="text-[10px] font-normal">ms</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight">{t("monitor.avgLatency")}</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${tokensColor}`} data-testid="text-tokens-health">
                  {tokensActive}/{tokensTotal}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight flex items-center justify-center gap-0.5">
                  <KeyRound className="h-2.5 w-2.5" />
                  {t("monitor.tokensHealthy")}
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-cyan-600 dark:text-cyan-400" data-testid="text-channels-loaded">
                  {stats?.cache.channelsLoaded ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight flex items-center justify-center gap-0.5">
                  <Database className="h-2.5 w-2.5" />
                  {t("monitor.channelsInCache")}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ManagerInsightsCard({ activeDiagCode, onDiagCodeClick }: { activeDiagCode: string | null; onDiagCodeClick: (code: string | null) => void }) {
  const { t } = useTranslation();

  const { data: summaryData, isLoading } = useQuery<{ codeCounts: Record<string, number>; total: number; tracesScanned: number }>({
    queryKey: ["/api/admin/audit-logs/manager-summary"],
    refetchInterval: 60000,
  });

  const { totalIssues, codeCounts, summaryText } = useMemo(() => {
    if (!summaryData) {
      return { totalIssues: 0, codeCounts: {} as Record<string, number>, summaryText: "" };
    }

    const counts = summaryData.codeCounts;
    const total = summaryData.total;

    if (total === 0) {
      return { totalIssues: 0, codeCounts: counts, summaryText: t("monitor.managerNoIssues") };
    }

    const codeKeys = Object.keys(counts);
    if (codeKeys.length === 1) {
      const typeLabel = t(`monitor.diagCode${codeKeys[0]}`, { defaultValue: codeKeys[0] });
      const details = t("monitor.managerSingleType", { type: typeLabel });
      return {
        totalIssues: total,
        codeCounts: counts,
        summaryText: t("monitor.managerSummary", { total, details }),
      };
    }

    const details = codeKeys
      .sort((a, b) => counts[b] - counts[a])
      .map((code) => {
        const typeLabel = t(`monitor.diagCode${code}`, { defaultValue: code });
        return `${counts[code]} ${typeLabel}`;
      })
      .join(", ");

    return {
      totalIssues: total,
      codeCounts: counts,
      summaryText: t("monitor.managerSummary", { total, details }),
    };
  }, [summaryData, t]);

  const hasData = !isLoading && !!summaryData;

  return (
    <Card className={totalIssues > 0 ? "border-amber-200 dark:border-amber-800" : ""} data-testid="card-manager-insights">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Eye className="h-4 w-4 text-violet-500" />
          {t("monitor.managerTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <Skeleton className="h-5 w-full" />
        ) : (
          <div className="space-y-2">
            <p className={`text-sm leading-relaxed ${totalIssues > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-400"}`} data-testid="text-manager-summary">
              {summaryText}
            </p>
            {totalIssues > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(codeCounts).sort(([, a], [, b]) => b - a).map(([code, count]) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className={`text-[10px] gap-1 cursor-pointer transition-colors ${activeDiagCode === code ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-500" : "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"}`}
                    onClick={() => onDiagCodeClick(activeDiagCode === code ? null : code)}
                    data-testid={`badge-diag-filter-${code}`}
                  >
                    {count}× {t(`monitor.diagCode${code}`, { defaultValue: code })}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const LEARNING_CENTER_GROUPS = [
  {
    groupKey: "learningGroupIdentity",
    icon: Users,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
    codes: ["TENANT_NOT_FOUND", "DUPLICATE_MESSAGE", "PAYLOAD_VALIDATION", "WEBHOOK_URL_MISMATCH"],
  },
  {
    groupKey: "learningGroupMedia",
    icon: Image,
    color: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800",
    codes: ["MEDIA_FAILED"],
  },
  {
    groupKey: "learningGroupSecurity",
    icon: Lock,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
    codes: ["AUTH_MISSING", "AUTH_TOKEN_EXPIRED", "DECRYPTION_ERROR", "RATE_LIMITED", "TEMPLATE_ERROR"],
  },
  {
    groupKey: "learningGroupOps",
    icon: Wrench,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    codes: ["TIMEOUT", "DB_TIMEOUT", "NETWORK_ERROR", "WEBHOOK_DELIVERY_FAILED", "STUCK_NO_PROGRESS", "UNKNOWN", "NO_FAILURE_DETECTED"],
  },
];

function LearningCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto" data-testid="dialog-learning-center">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-violet-500" />
            {t("monitor.learningCenterTitle")}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{t("monitor.learningCenterSubtitle")}</p>
        </DialogHeader>
        <div className="mt-4 space-y-6">
          {LEARNING_CENTER_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.groupKey} data-testid={`panel-lc-group-${group.groupKey}`}>
                <div className="flex items-center gap-2 mb-3">
                  <GroupIcon className={`h-5 w-5 ${group.color}`} />
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${group.color}`}>
                    {t(`monitor.${group.groupKey}`)}
                  </h3>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {group.codes.map((code) => (
                    <div
                      key={code}
                      className={`rounded-lg border p-4 ${group.bgColor}`}
                      data-testid={`card-lc-code-${code}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-[11px] h-5 px-1.5">{code}</Badge>
                        <h4 className="text-sm font-semibold">{t(`monitor.lc_${code}_title`)}</h4>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {t(`monitor.lc_${code}_desc`)}
                      </p>
                      <div className="flex items-start gap-2 rounded-md bg-background/60 dark:bg-background/30 px-3 py-2 border">
                        <Wrench className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            {t("monitor.diagRecommendation")}:
                          </span>{" "}
                          <span className="text-xs">{t(`monitor.lc_${code}_fix`)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}


function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatJsonHighlighted(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const json = JSON.stringify(obj, null, 2);
    return json
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"([^"]+)":/g, '<span class="text-blue-600 dark:text-blue-400">"$1"</span>:')
      .replace(/: "(.*?)"/g, ': <span class="text-emerald-600 dark:text-emerald-400">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span class="text-amber-600 dark:text-amber-400">$1</span>')
      .replace(/: (true|false)/g, ': <span class="text-violet-600 dark:text-violet-400">$1</span>')
      .replace(/: (null)/g, ': <span class="text-red-500">$1</span>');
  } catch {
    return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

export default function MessageMonitor() {
  const { t } = useTranslation();
  const { currentRole } = useRole();
  const { user } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = currentRole === "superadmin";
  const canDecrypt = user?.role === "superadmin";

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [messageIdSearch, setMessageIdSearch] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [diagCodeFilter, setDiagCodeFilter] = useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
  const [decryptModalTrace, setDecryptModalTrace] = useState<string | null>(null);
  const [retryingTraceId, setRetryingTraceId] = useState<string | null>(null);
  const [diagCache, setDiagCache] = useState<Record<string, DiagnosisResult>>({});
  const [diagLoading, setDiagLoading] = useState<Set<string>>(new Set());
  const [learningCenterOpen, setLearningCenterOpen] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ processed: number; total: number; updated: number } | null>(null);
  const [recoveryFailures, setRecoveryFailures] = useState<{ phone: string; error: string; traceId: string }[]>([]);
  const [recoveryFailuresOpen, setRecoveryFailuresOpen] = useState(false);
  const diagFetchedRef = useRef<Set<string>>(new Set());

  const queryParams = new URLSearchParams();
  queryParams.set("page", String(page));
  queryParams.set("limit", "25");
  if (statusFilter !== "all") queryParams.set("pipelineStatus", statusFilter);
  if (directionFilter !== "all") queryParams.set("direction", directionFilter);
  if (tenantFilter !== "all") queryParams.set("tenantId", tenantFilter);
  if (messageIdSearch.trim()) queryParams.set("whatsappMessageId", messageIdSearch.trim());
  if (phoneSearch.trim()) queryParams.set("phoneSearch", phoneSearch.trim());

  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = useQuery<AuditLogsResponse>({
    queryKey: [`/api/admin/audit-logs?${queryParams.toString()}`],
    refetchInterval: 15000,
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<BufferStatsResponse>({
    queryKey: [`/api/admin/audit-logs/buffer-stats`],
    refetchInterval: 10000,
  });

  const { data: tenants } = useQuery<TenantInfo[]>({
    queryKey: ["/api/tenants"],
  });

  const tenantMap = new Map<string, string>();
  if (tenants) {
    for (const tn of tenants) {
      tenantMap.set(String(tn._id), tn.nameEn || tn.slug || String(tn._id));
    }
  }

  const fetchDiagnosis = useCallback(async (traceId: string) => {
    if (diagFetchedRef.current.has(traceId)) return;
    diagFetchedRef.current.add(traceId);
    setDiagLoading((prev) => new Set(prev).add(traceId));
    try {
      const res = await apiRequest("GET", `/api/admin/audit-logs/diagnose/${traceId}`);
      const data: DiagnosisResult = await res.json();
      setDiagCache((prev) => ({ ...prev, [traceId]: data }));
    } catch {
    } finally {
      setDiagLoading((prev) => {
        const next = new Set(prev);
        next.delete(traceId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!logsData?.traces) return;
    const failedTraces = logsData.traces.filter(
      (tr) => ["FAILED", "STUCK"].includes(tr.pipelineStatus)
    );
    for (const tr of failedTraces) {
      fetchDiagnosis(tr.traceId);
    }
  }, [logsData, fetchDiagnosis]);

  const decryptMutation = useMutation({
    mutationFn: async (traceId: string) => {
      const res = await apiRequest("POST", `/api/admin/audit-logs/decrypt/${traceId}`);
      return res.json();
    },
  });

  const [backfillRunning, setBackfillRunning] = useState(false);
  const startBackfill = async () => {
    setBackfillRunning(true);
    setBackfillProgress(null);
    try {
      const token = localStorage.getItem("token");
      const resp = await fetch("/api/admin/audit-logs/backfill-metadata", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "progress" || evt.type === "start") {
                setBackfillProgress({ processed: evt.processed || 0, total: evt.total || 0, updated: evt.updated || 0 });
              } else if (evt.type === "done") {
                setBackfillProgress(null);
                if (evt.updated === 0) {
                  toast({ title: t("monitor.backfillSuccess"), description: t("monitor.backfillNoData") });
                } else {
                  toast({ title: t("monitor.backfillSuccess"), description: t("monitor.backfillSuccessDesc", { updated: evt.updated }) });
                }
                refetchLogs();
              } else if (evt.type === "error") {
                toast({ title: t("monitor.backfillFailed"), description: t("monitor.backfillFailedDesc"), variant: "destructive" });
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      toast({ title: t("monitor.backfillFailed"), description: t("monitor.backfillFailedDesc"), variant: "destructive" });
    } finally {
      setBackfillRunning(false);
      setBackfillProgress(null);
    }
  };

  const syncEmailsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audit-logs/sync-emails");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: t("monitor.syncSuccess"), description: t("monitor.syncSuccessDesc", { synced: data.synced, totalEmails: data.totalEmails }) });
    },
    onError: (err: any) => {
      toast({ title: t("monitor.syncFailed"), description: err.message, variant: "destructive" });
    },
  });

  const [channelCheckResults, setChannelCheckResults] = useState<Array<{
    phoneNumberId: string;
    channelName: string;
    status: "connected" | "auth_error" | "unreachable";
    displayName?: string;
    error?: string;
  }> | null>(null);
  const [channelCheckLoading, setChannelCheckLoading] = useState(false);

  const handleCheckChannels = async () => {
    setChannelCheckLoading(true);
    try {
      const res = await apiRequest("GET", "/api/admin/audit-logs/check-channels");
      const data = await res.json();
      const results = data.channels || [];
      setChannelCheckResults(results);

      const statusIcon = (s: string) => s === "connected" ? "[OK]" : s === "auth_error" ? "[AUTH]" : "[ERR]";
      const lines = results.map((ch: any) => {
        const label = CHANNEL_MAP[ch.phoneNumberId]?.label || ch.channelName || ch.phoneNumberId;
        if (ch.status === "connected") return `${statusIcon(ch.status)} ${label}: ${t("monitor.channelStatusConnected")}`;
        if (ch.status === "auth_error") return `${statusIcon(ch.status)} ${label}: ${t("monitor.channelStatusAuthError")}${ch.error ? ` (${ch.error})` : ""}`;
        return `${statusIcon(ch.status)} ${label}: ${t("monitor.channelStatusUnreachable")}${ch.error ? ` (${ch.error})` : ""}`;
      });

      const cacheInfo = data.cacheRebuilt != null ? `\n${t("monitor.cacheRebuilt", { count: data.cacheRebuilt })}` : "";

      if (lines.length === 0) {
        toast({ title: t("monitor.checkChannelsTitle"), description: t("monitor.checkChannelsEmpty") + cacheInfo });
      } else {
        const hasError = results.some((ch: any) => ch.status !== "connected");
        toast({
          title: t("monitor.checkChannelsTitle"),
          description: lines.join("\n") + cacheInfo,
          duration: 12000,
          variant: hasError ? "destructive" : undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-stats"] });
    } catch (err: any) {
      toast({ title: t("monitor.checkChannelsTitle"), description: err.message, variant: "destructive" });
    } finally {
      setChannelCheckLoading(false);
    }
  };

  const [credCheckLoading, setCredCheckLoading] = useState(false);
  const handleCheckCredentials = async () => {
    setCredCheckLoading(true);
    try {
      const res = await apiRequest("GET", "/api/admin/audit-logs/check-credentials");
      const data = await res.json();
      const results = data.channels || [];

      const lines = results.map((ch: any) => {
        const label = CHANNEL_MAP[ch.phoneNumberId]?.label || ch.channelName || ch.phoneNumberId;
        if (ch.hasToken) return `[OK] ${label}: ${t("monitor.credentialFound")} (${ch.tokenLength} chars)`;
        return `[MISSING] ${label}: ${t("monitor.credentialMissing")}`;
      });

      if (lines.length === 0) {
        toast({ title: t("monitor.checkCredentialsTitle"), description: t("monitor.checkChannelsEmpty") });
      } else {
        const hasMissing = results.some((ch: any) => !ch.hasToken);
        toast({
          title: t("monitor.checkCredentialsTitle"),
          description: lines.join("\n"),
          duration: 12000,
          variant: hasMissing ? "destructive" : undefined,
        });
      }
    } catch (err: any) {
      toast({ title: t("monitor.checkCredentialsTitle"), description: err.message, variant: "destructive" });
    } finally {
      setCredCheckLoading(false);
    }
  };

  const retryMutation = useMutation({
    mutationFn: async (traceId: string) => {
      setRetryingTraceId(traceId);
      const res = await apiRequest("POST", `/api/admin/audit-logs/retry/${traceId}`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: t("monitor.retrySubmitted"), description: data.retryTraceId?.slice(0, 12) });
      queryClient.invalidateQueries({ queryKey: [`/api/admin/audit-logs`] });
      refetchLogs();
      setRetryingTraceId(null);
    },
    onError: (err: any) => {
      toast({ title: t("monitor.retryFailed"), description: err.message, variant: "destructive" });
      setRetryingTraceId(null);
    },
  });

  const { data: orphanData } = useQuery<{ orphans: any[]; count: number }>({
    queryKey: ["/api/admin/audit-logs/orphans"],
    refetchInterval: 30000,
  });

  const recoveryPushMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audit-logs/recovery-push");
      return res.json();
    },
    onSuccess: (data) => {
      const hasFailures = data.failed > 0 && data.failureDetails?.length > 0;
      setRecoveryFailures(hasFailures ? data.failureDetails : []);
      setRecoveryFailuresOpen(false);
      toast({
        title: t("monitor.recoveryPushSuccess"),
        description: t("monitor.recoveryPushSuccessDesc", { recovered: data.recovered, failed: data.failed }),
        action: hasFailures ? (
          <ToastAction altText={t("monitor.viewFailureDetails")} onClick={() => setRecoveryFailuresOpen(true)} data-testid="button-view-failures">
            {t("monitor.viewFailureDetails")}
          </ToastAction>
        ) : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs/orphans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs/manager-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-stats"] });
      refetchLogs();
    },
    onError: (err: any) => {
      toast({ title: t("monitor.recoveryPushFailed"), description: err.message, variant: "destructive" });
    },
  });

  const handleDecrypt = (traceId: string) => {
    setDecryptModalTrace(traceId);
    decryptMutation.mutate(traceId);
  };

  const totalDuration = (steps: AuditStep[]): number | null => {
    if (steps.length < 2) return null;
    const first = new Date(steps[0].timestamp).getTime();
    const last = new Date(steps[steps.length - 1].timestamp).getTime();
    return last - first;
  };

  const getSenderDisplay = (trace: AuditTrace): { text: string; isFallback: boolean } => {
    if (trace.senderPhone) {
      const phone = formatPhone(trace.senderPhone);
      if (trace.senderName && trace.senderName !== trace.senderPhone) {
        return { text: `${trace.senderName} (${phone})`, isFallback: false };
      }
      return { text: phone, isFallback: !trace.tenantId };
    }

    const diag = diagCache[trace.traceId];
    if (diag?.failedSteps?.length) {
      for (const fs of diag.failedSteps) {
        const phoneMatch = fs.error?.match(/from:\s*(\d{10,15})/);
        if (phoneMatch) {
          return { text: formatPhone(phoneMatch[1]), isFallback: true };
        }
        const phoneFallback = fs.error?.match(/(\d{10,15})/);
        if (phoneFallback) {
          return { text: formatPhone(phoneFallback[1]), isFallback: true };
        }
      }
    }

    if (trace.phoneNumberId) {
      const label = CHANNEL_MAP[trace.phoneNumberId]?.label;
      if (label) return { text: label, isFallback: true };
    }

    return { text: "—", isFallback: true };
  };

  const getContentLabel = (type?: string): string => {
    if (!type) return t("monitor.contentUnknown");
    const cfg = CONTENT_TYPE_CONFIG[type];
    return cfg ? t(cfg.labelKey) : t("monitor.contentUnknown");
  };

  const handleExportCsv = () => {
    if (!logsData?.traces.length) return;
    const headers = [
      t("monitor.colStatus"),
      t("monitor.colContent"),
      t("monitor.colLine"),
      t("monitor.colSender"),
      t("monitor.colTenant"),
      t("monitor.colDirection"),
      t("monitor.colDuration"),
      t("monitor.colRetries"),
      t("monitor.colTime"),
      t("monitor.colTraceId"),
      t("monitor.colMessageId"),
      t("monitor.colInvestigation"),
    ];

    const escCsv = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    const rows = logsData.traces.map((trace) => {
      const duration = totalDuration(trace.steps);
      const channel = trace.phoneNumberId ? (CHANNEL_MAP[trace.phoneNumberId] || DEFAULT_CHANNEL) : DEFAULT_CHANNEL;
      const diag = diagCache[trace.traceId];
      let investigation = "";
      if (diag) {
        const code = diag.diagnosisCode;
        const rec = t(`diagnostics.${code}_REC`, { defaultValue: "" });
        const action = t(`diagnostics.${code}_ACTION`, { defaultValue: "" });
        const result = t(`diagnostics.${code}_RESULT`, { defaultValue: "" });
        investigation = `${t("monitor.diagRecommendation")}: ${rec} | ${t("monitor.diagAction")}: ${action} | ${t("monitor.diagResults")}: ${result}`;
        if (diag.failedSteps.length > 0) {
          const stepsText = diag.failedSteps.map((fs) => `${fs.step}${fs.error ? `: ${fs.error}` : ""}`).join("; ");
          investigation += ` | ${t("monitor.diagFailedSteps")}: ${stepsText}`;
        }
      }
      return [
        trace.pipelineStatus,
        getContentLabel(trace.messageType),
        channel.label,
        getSenderDisplay(trace).text,
        trace.tenantId ? tenantMap.get(String(trace.tenantId)) || String(trace.tenantId) : "—",
        trace.direction,
        duration != null ? formatDuration(duration) : "—",
        String(trace.retryCount),
        formatTimestampIL(trace.createdAt),
        trace.traceId,
        trace.whatsappMessageId || "—",
        investigation,
      ].map(escCsv).join(",");
    });

    const bom = "\uFEFF";
    const csv = bom + headers.map(escCsv).join(",") + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-traces-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isSuperAdmin) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="text-access-denied">
        {t("monitor.accessDenied")}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto" data-testid="page-message-monitor">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("monitor.title")}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setLearningCenterOpen(true)} data-testid="button-learning-center">
            <BookOpen className="h-4 w-4 mr-1" />
            {t("monitor.learningCenterOpen")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!logsData?.traces.length} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-1" />
            {t("monitor.exportExcel")}
          </Button>
          <Button variant="outline" size="sm" onClick={startBackfill} disabled={backfillRunning} data-testid="button-backfill-metadata">
            {backfillRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
            {backfillProgress ? `${backfillProgress.processed}/${backfillProgress.total}` : t("monitor.backfillButton")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => syncEmailsMutation.mutate()} disabled={syncEmailsMutation.isPending} data-testid="button-sync-emails">
            {syncEmailsMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mail className="h-4 w-4 mr-1" />}
            {t("monitor.syncAlertEmails")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCheckChannels} disabled={channelCheckLoading} data-testid="button-check-channels">
            {channelCheckLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Activity className="h-4 w-4 mr-1" />}
            {t("monitor.checkChannels")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleCheckCredentials} disabled={credCheckLoading} data-testid="button-check-credentials">
            {credCheckLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-1" />}
            {t("monitor.checkCredentials")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => recoveryPushMutation.mutate()}
            disabled={recoveryPushMutation.isPending || !orphanData?.count}
            data-testid="button-recovery-push"
          >
            {recoveryPushMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            {t("monitor.recoveryPushButton")}
            {orphanData && orphanData.count > 0 && (
              <span className="relative ml-1.5 flex items-center">
                <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-red-400 opacity-50" />
                <Badge variant="destructive" className="relative h-4 min-w-4 px-1 text-[10px]" data-testid="badge-orphan-count">
                  {orphanData.count}
                </Badge>
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetchLogs()} data-testid="button-refresh">
            <RefreshCw className="h-4 w-4 mr-1" />
            {t("monitor.refresh")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card data-testid="card-live-buffer">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MemoryStick className="h-4 w-4 text-blue-500" />
              {t("monitor.liveBuffer")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : (
              <div>
                <div className="text-3xl font-bold" data-testid="text-buffer-count">{statsData?.buffer.activeTraces ?? 0}</div>
                <p className="text-xs text-muted-foreground">{t("monitor.tracesInRam")}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-failure-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              {t("monitor.failureRate24h")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold ${(statsData?.failureRate ?? 0) > 10 ? "text-red-500" : (statsData?.failureRate ?? 0) > 5 ? "text-orange-500" : "text-emerald-500"}`} data-testid="text-failure-rate">
                    {statsData?.failureRate ?? 0}%
                  </span>
                  <span className="text-xs text-muted-foreground">{statsData?.failedLast24h ?? 0}/{statsData?.totalLast24h ?? 0}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t("monitor.failedInLast24h")}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-system-health">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-500" />
              {t("monitor.systemHealth")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-full" /> : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs">{t("monitor.webhookService")}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs text-emerald-500 font-medium">{t("monitor.online")}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">{t("monitor.mediaService")}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs text-emerald-500 font-medium">{t("monitor.online")}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("monitor.uptime")}</span>
                  <span className="text-xs font-mono" data-testid="text-uptime">{statsData?.serverUptime ? formatUptime(statsData.serverUptime) : "—"}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <SystemHealthCard />

        <ManagerInsightsCard activeDiagCode={diagCodeFilter} onDiagCodeClick={(code) => {
          setStatusFilter("all");
          setDirectionFilter("all");
          setTenantFilter("all");
          setMessageIdSearch("");
          setPhoneSearch("");
          setDiagCodeFilter(code);
          setPage(1);
        }} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t("monitor.auditTraces")}
              {logsData && (
                <Badge variant="secondary" className="text-xs" data-testid="badge-total-count">{logsData.total}</Badge>
              )}
            </CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-[140px] text-xs" data-testid="select-status-filter">
                  <SelectValue placeholder={t("monitor.colStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("monitor.allStatuses")}</SelectItem>
                  <SelectItem value="COMPLETED">{t("monitor.completed")}</SelectItem>
                  <SelectItem value="FAILED">{t("monitor.failed")}</SelectItem>
                  <SelectItem value="STUCK">{t("monitor.stuck")}</SelectItem>
                  <SelectItem value="PARTIAL">{t("monitor.partial")}</SelectItem>
                  <SelectItem value="PENDING">{t("monitor.pending")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-[130px] text-xs" data-testid="select-direction-filter">
                  <SelectValue placeholder={t("monitor.colDirection")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("monitor.allDirections")}</SelectItem>
                  <SelectItem value="INBOUND">{t("monitor.inbound")}</SelectItem>
                  <SelectItem value="OUTBOUND">{t("monitor.outbound")}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={tenantFilter} onValueChange={(v) => { setTenantFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-tenant-filter">
                  <SelectValue placeholder={t("monitor.colTenant")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("monitor.allTenants")}</SelectItem>
                  {tenants?.map((tn) => (
                    <SelectItem key={String(tn._id)} value={String(tn._id)}>
                      {tn.nameEn || tn.slug || String(tn._id).slice(-6)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Input
                  placeholder={t("monitor.phoneSearchPlaceholder", "חפש טלפון...")}
                  className="h-8 w-[160px] text-xs pe-7"
                  value={phoneSearch}
                  onChange={(e) => setPhoneSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); refetchLogs(); } }}
                  title={t("monitor.searchMessages", "חפש הודעות")}
                  data-testid="input-phone-search"
                />
                {phoneSearch.trim() && logsLoading && (
                  <Loader2 className="absolute end-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <Input
                placeholder={t("monitor.messageIdPlaceholder")}
                className="h-8 w-[180px] text-xs"
                value={messageIdSearch}
                onChange={(e) => setMessageIdSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); refetchLogs(); } }}
                title={t("monitor.searchMessages", "חפש הודעות")}
                data-testid="input-message-id"
              />
              {diagCodeFilter && (
                <Badge
                  variant="outline"
                  className="text-[10px] gap-1 cursor-pointer bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-500"
                  onClick={() => setDiagCodeFilter(null)}
                  data-testid="badge-diag-filter-clear"
                >
                  {t(`monitor.diagCode${diagCodeFilter}`, { defaultValue: diagCodeFilter })} <X className="h-3 w-3" />
                </Badge>
              )}
              {(statusFilter !== "all" || directionFilter !== "all" || tenantFilter !== "all" || messageIdSearch.trim() || phoneSearch.trim() || diagCodeFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setDirectionFilter("all");
                    setTenantFilter("all");
                    setMessageIdSearch("");
                    setPhoneSearch("");
                    setDiagCodeFilter(null);
                    setPage(1);
                  }}
                  title={t("monitor.clearAllFilters", "נקה חיפוש")}
                  data-testid="button-clear-all-filters"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t("monitor.clearAllFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {logsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !logsData?.traces.length ? (
            <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="text-no-traces">
              <Activity className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{t("monitor.noTracesFound")}</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {statusFilter !== "all" || directionFilter !== "all" || tenantFilter !== "all" || messageIdSearch.trim()
                  ? t("monitor.adjustFilters")
                  : t("monitor.tracesWillAppear")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">{t("monitor.colStatus")}</TableHead>
                    <TableHead className="w-[80px]">{t("monitor.colContent")}</TableHead>
                    <TableHead className="w-[100px]">{t("monitor.colLine")}</TableHead>
                    <TableHead className="w-[180px] min-w-[180px]">{t("monitor.colSender")}</TableHead>
                    <TableHead className="w-[100px]">{t("monitor.colTenant")}</TableHead>
                    <TableHead className="w-[80px]">{t("monitor.colDirection")}</TableHead>
                    <TableHead className="w-[70px]">{t("monitor.colDuration")}</TableHead>
                    <TableHead className="w-[140px]">{t("monitor.colTime")}</TableHead>
                    <TableHead className="w-[40px]">{t("monitor.colInfo")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logsData.traces.filter((trace) => {
                    if (!diagCodeFilter) return true;
                    const diag = diagCache[trace.traceId];
                    return diag?.diagnosisCode === diagCodeFilter;
                  }).map((trace) => {
                    const isExpanded = expandedTrace === trace.traceId;
                    const duration = totalDuration(trace.steps);
                    const isFailed = ["FAILED", "STUCK"].includes(trace.pipelineStatus);
                    const isFallbackOrphan = trace.steps.some((s) => s.step === "TENANT_RESOLUTION" && s.status === "WARN");
                    const diag = diagCache[trace.traceId];
                    const isDiagLoading = diagLoading.has(trace.traceId);
                    return (
                      <Fragment key={trace.traceId}>
                      <TableRow
                        className={`group cursor-pointer ${(isFailed && diag && diag.diagnosisCode !== "NO_FAILURE_DETECTED") || isFallbackOrphan ? "border-b-0" : ""}`}
                        data-testid={`row-trace-${trace.traceId}`}
                        onClick={() => setExpandedTrace(isExpanded ? null : trace.traceId)}
                      >
                        <TableCell>
                          <StatusBadge status={trace.pipelineStatus} diagnosisCode={diag?.diagnosisCode} isFallbackOrphan={isFallbackOrphan} />
                        </TableCell>
                        <TableCell>
                          <ContentTypeBadge messageType={trace.messageType} mimeType={trace.mimeType} fileSize={trace.fileSize} />
                        </TableCell>
                        <TableCell>
                          <ChannelBadge phoneNumberId={trace.phoneNumberId} />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const sender = getSenderDisplay(trace);
                            return (
                              <span
                                className={`text-[11px] font-mono truncate block max-w-[180px] ${sender.isFallback ? "italic text-muted-foreground" : ""}`}
                                title={sender.text}
                                data-testid={`text-sender-${trace.traceId}`}
                              >
                                {sender.text}
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm truncate block max-w-[100px]" title={trace.tenantId ? tenantMap.get(String(trace.tenantId)) || String(trace.tenantId) : undefined} data-testid={`text-tenant-${trace.traceId}`}>
                            {trace.tenantId ? tenantMap.get(String(trace.tenantId)) || String(trace.tenantId).slice(-6) : "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <DirectionBadge direction={trace.direction} />
                        </TableCell>
                        <TableCell>
                          <span className="text-xs font-mono">{duration != null ? formatDuration(duration) : "—"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground font-mono">{formatTimestampIL(trace.createdAt)}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-info-${trace.traceId}`}>
                                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  <div><span className="font-semibold">Trace ID:</span> <span className="font-mono">{trace.traceId}</span></div>
                                  <div><span className="font-semibold">Message ID:</span> <span className="font-mono">{trace.whatsappMessageId || "—"}</span></div>
                                  {trace.retryCount > 0 && <div><span className="font-semibold">{t("monitor.retries")}:</span> {trace.retryCount}</div>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                            {isFailed && canDecrypt && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                    disabled={retryingTraceId === trace.traceId}
                                    onClick={(e) => { e.stopPropagation(); retryMutation.mutate(trace.traceId); }}
                                    data-testid={`button-retry-${trace.traceId}`}
                                  >
                                    {retryingTraceId === trace.traceId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("monitor.retry")}</TooltipContent>
                              </Tooltip>
                            )}
                            {trace.encryptedContent && canDecrypt && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); handleDecrypt(trace.traceId); }}
                                    data-testid={`button-decrypt-${trace.traceId}`}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("monitor.decryptContent")}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {!isFailed && isFallbackOrphan && (
                        <TableRow
                          key={`orphan-${trace.traceId}`}
                          className="cursor-pointer hover:bg-muted/30"
                          data-testid={`row-orphan-${trace.traceId}`}
                          onClick={() => setExpandedTrace(isExpanded ? null : trace.traceId)}
                        >
                          <TableCell colSpan={9} className="py-1.5 px-4">
                            <div className="flex items-center gap-3 rounded px-3 py-1.5 border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40" data-testid={`panel-orphan-${trace.traceId}`}>
                              <span className="relative flex items-center gap-1">
                                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-500 opacity-60" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                              </span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-mono border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
                                {t("monitor.orphanLabel")}
                              </Badge>
                              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                                {t("monitor.lc_TENANT_NOT_FOUND_desc", { defaultValue: "" })}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {isFailed && (isDiagLoading || (diag && diag.diagnosisCode !== "NO_FAILURE_DETECTED")) && (
                        <TableRow
                          key={`diag-${trace.traceId}`}
                          className="cursor-pointer hover:bg-muted/30"
                          data-testid={`row-diag-${trace.traceId}`}
                          onClick={() => setExpandedTrace(isExpanded ? null : trace.traceId)}
                        >
                          <TableCell colSpan={9} className="py-1.5 px-4">
                            {isDiagLoading ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                <span className="text-[11px] text-muted-foreground">{t("monitor.diagLoading")}</span>
                              </div>
                            ) : diag && diag.diagnosisCode !== "NO_FAILURE_DETECTED" ? (
                              <div className={`flex items-start gap-3 rounded px-3 py-1.5 border ${diag.diagnosisCode === "WEBHOOK_URL_MISMATCH" ? "bg-fuchsia-50/60 dark:bg-fuchsia-950/20 border-fuchsia-200 dark:border-fuchsia-900/40" : diag.diagnosisCode === "TENANT_NOT_FOUND" ? "bg-orange-50/60 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/40" : "bg-red-50/60 dark:bg-red-950/20 border-red-100 dark:border-red-900/40"}`} data-testid={`panel-inline-diag-${trace.traceId}`}>
                                <div className="flex items-center gap-2 shrink-0">
                                  {diag.diagnosisCode === "WEBHOOK_URL_MISMATCH" ? <Link2 className="h-3.5 w-3.5 text-fuchsia-500" /> : <AlertTriangle className={`h-3.5 w-3.5 ${diag.diagnosisCode === "TENANT_NOT_FOUND" ? "text-orange-500" : "text-red-500"}`} />}
                                  <Badge variant="outline" className={`text-[10px] h-4 px-1.5 font-mono ${diag.diagnosisCode === "WEBHOOK_URL_MISMATCH" ? "border-fuchsia-200 dark:border-fuchsia-800 text-fuchsia-700 dark:text-fuchsia-400" : diag.diagnosisCode === "TENANT_NOT_FOUND" ? "border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400" : "border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"}`}>
                                    {diag.diagnosisCode === "WEBHOOK_URL_MISMATCH" ? t("monitor.urlMismatch") : diag.diagnosisCode === "TENANT_NOT_FOUND" ? t("monitor.unidentified") : diag.diagnosisCode}
                                  </Badge>
                                  {diag.diagnosisCode === "TENANT_NOT_FOUND" && (
                                    <span className="relative flex items-center gap-1" data-testid={`badge-orphan-${trace.traceId}`}>
                                      <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-500 opacity-60" />
                                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                                      <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">{t("monitor.orphanLabel")}</span>
                                    </span>
                                  )}
                                  <span className={`text-[11px] font-semibold ${diag.diagnosisCode === "TENANT_NOT_FOUND" ? "text-orange-700 dark:text-orange-400" : "text-red-700 dark:text-red-400"}`}>
                                    {t(`monitor.lc_${diag.diagnosisCode}_title`, { defaultValue: diag.diagnosisCode })}
                                  </span>
                                </div>
                                <span className="text-[11px] text-muted-foreground mx-1">—</span>
                                <span className="text-[11px] text-foreground/80">
                                  {t(`monitor.lc_${diag.diagnosisCode}_desc`, { defaultValue: "" })}
                                </span>
                                <div className="flex items-start gap-1 ms-auto shrink-0">
                                  <Lightbulb className="h-3 w-3 text-amber-500 mt-0.5" />
                                  <span className="text-[11px] text-amber-700 dark:text-amber-400 max-w-[300px]">
                                    {t(`monitor.lc_${diag.diagnosisCode}_fix`, { defaultValue: "" })}
                                  </span>
                                </div>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>

              {expandedTrace && (() => {
                const trace = logsData.traces.find((tr) => tr.traceId === expandedTrace);
                if (!trace) return null;
                const diag = diagCache[trace.traceId];
                const isDiagLoading = diagLoading.has(trace.traceId);
                return (
                  <div className="border-t bg-muted/30 px-6 py-4" data-testid="panel-trace-details">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold">
                        {t("monitor.stepTimeline")} — <span className="font-mono text-xs">{trace.traceId}</span>
                      </h3>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedTrace(null)} data-testid="button-close-timeline">
                        {t("monitor.close")}
                      </Button>
                    </div>
                    {trace.parentTraceId && (
                      <div className="flex items-center gap-2 mb-3 p-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" data-testid="text-parent-trace-link">
                        <Link2 className="h-4 w-4 text-blue-500 shrink-0" />
                        <span className="text-xs text-blue-700 dark:text-blue-400">
                          {t("monitor.retryAttemptOf")}{" "}
                          <button
                            className="font-mono underline cursor-pointer hover:text-blue-900 dark:hover:text-blue-200"
                            onClick={() => setExpandedTrace(trace.parentTraceId!)}
                            data-testid={`button-goto-parent-${trace.parentTraceId}`}
                          >
                            {trace.parentTraceId.slice(0, 12)}...
                          </button>
                        </span>
                      </div>
                    )}

                    {(diag || isDiagLoading) && (
                      <div className="mb-4">
                        {isDiagLoading ? (
                          <div className="flex items-center gap-2 py-3">
                            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                            <span className="text-xs text-muted-foreground">{t("monitor.diagLoading")}</span>
                          </div>
                        ) : diag ? (
                          <InvestigationLog diagnosis={diag} />
                        ) : null}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <StepTimeline steps={trace.steps} />
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-1">
                          <span className="text-muted-foreground">{t("monitor.fullTraceId")}:</span>
                          <span className="font-mono text-xs break-all">{trace.traceId}</span>
                          <span className="text-muted-foreground">{t("monitor.status")}:</span>
                          <StatusBadge status={trace.pipelineStatus} isFallbackOrphan={trace.steps.some((s) => s.step === "TENANT_RESOLUTION" && s.status === "WARN")} />
                          <span className="text-muted-foreground">{t("monitor.direction")}:</span>
                          <DirectionBadge direction={trace.direction} />
                          <span className="text-muted-foreground">{t("monitor.retries")}:</span>
                          <span>{trace.retryCount}</span>
                          <span className="text-muted-foreground">{t("monitor.worker")}:</span>
                          <span className="font-mono text-xs">{trace.assignedWorkerId || t("monitor.unassigned")}</span>
                          <span className="text-muted-foreground">{t("monitor.whatsappId")}:</span>
                          <span className="font-mono text-xs break-all">{trace.whatsappMessageId || "—"}</span>
                          <span className="text-muted-foreground">{t("monitor.created")}:</span>
                          <span className="font-mono text-xs">{formatTimestampIL(trace.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {logsData && logsData.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground" data-testid="text-pagination-info">
                {t("monitor.pageOf", { page: logsData.page, pages: logsData.pages, total: logsData.total })}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} data-testid="button-prev-page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= logsData.pages} onClick={() => setPage(page + 1)} data-testid="button-next-page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={decryptModalTrace !== null} onOpenChange={(open) => { if (!open) { setDecryptModalTrace(null); decryptMutation.reset(); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto" data-testid="dialog-decrypt">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {t("monitor.decryptedContent")}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {decryptMutation.isPending && (
              <div className="flex items-center gap-2 justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm text-muted-foreground">{t("monitor.decrypting")}</span>
              </div>
            )}
            {decryptMutation.isError && (
              <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4" data-testid="text-decrypt-error">
                <div className="flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("monitor.decryptionFailed")}</p>
                    <p className="text-xs text-red-600 dark:text-red-500 mt-1">{decryptMutation.error?.message || t("monitor.decryptionFailedDesc")}</p>
                  </div>
                </div>
              </div>
            )}
            {decryptMutation.isSuccess && (
              <div className="space-y-3">
                <pre
                  className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-md p-4 text-xs font-mono overflow-auto max-h-[55vh] whitespace-pre-wrap break-words leading-relaxed"
                  data-testid="text-decrypted-content"
                  dangerouslySetInnerHTML={{ __html: formatJsonHighlighted(decryptMutation.data.decryptedContent) }}
                />
                <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2" data-testid="text-audit-disclaimer">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">{t("monitor.auditDisclaimer")}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LearningCenterModal open={learningCenterOpen} onClose={() => setLearningCenterOpen(false)} />

      <Dialog open={recoveryFailuresOpen} onOpenChange={setRecoveryFailuresOpen}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-auto" data-testid="dialog-recovery-failures">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {t("monitor.failureDetailsTitle")}
            </DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">{t("monitor.failurePhone")}</TableHead>
                <TableHead>{t("monitor.failureError")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recoveryFailures.map((f, i) => (
                <TableRow key={i} data-testid={`row-failure-${i}`}>
                  <TableCell className="font-mono text-xs" data-testid={`text-failure-phone-${i}`}>{f.phone}</TableCell>
                  <TableCell className="text-xs text-red-600 dark:text-red-400" data-testid={`text-failure-error-${i}`}>{f.error}</TableCell>
                </TableRow>
              ))}
              {recoveryFailures.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground py-6">{t("monitor.noFailures")}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
