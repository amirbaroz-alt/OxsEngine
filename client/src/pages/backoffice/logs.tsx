import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBackofficeAuth } from "@/lib/backoffice-auth";
import { FileText, RefreshCw, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LogEntry {
  _id: string;
  correlationId: string;
  tenantId?: string;
  service: string;
  action: string;
  status: string;
  level: string;
  durationMs?: number;
  error?: string;
  data?: Record<string, unknown>;
  searchable?: string;
  timestamp: string;
}

const STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800 border-green-200",
  error:   "bg-red-100 text-red-800 border-red-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

const LEVEL_COLORS: Record<string, string> = {
  info:  "bg-blue-100 text-blue-700",
  warn:  "bg-orange-100 text-orange-700",
  error: "bg-red-100 text-red-700",
  debug: "bg-gray-100 text-gray-600",
};

const PAGE_SIZE = 50;

function fmt(ts: string) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function BackofficeLogsPage() {
  const { token } = useBackofficeAuth();
  const { t } = useTranslation();

  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [total, setTotal]         = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch]       = useState("");
  const [service, setService]     = useState("all");
  const [status, setStatus]       = useState("all");
  const [level, setLevel]         = useState("all");
  const [from, setFrom]           = useState("");
  const [to, setTo]               = useState("");

  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (p = 1) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (search)              params.set("search",  search);
      if (service !== "all")   params.set("service", service);
      if (status  !== "all")   params.set("status",  status);
      if (level   !== "all")   params.set("level",   level);
      if (from)                params.set("from",    from);
      if (to)                  params.set("to",      to);

      const res = await fetch(`/api/v1/admin/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "error");
      setLogs(json.data);
      setTotal(json.total);
      setTotalPages(json.totalPages);
      setPage(p);
      setExpanded(new Set());
    } catch {
      setError(t("backoffice.logs.loadError"));
    } finally {
      setLoading(false);
    }
  }, [token, search, service, status, level, from, to, t]);

  // Initial load
  useEffect(() => { load(1); }, [load]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => load(page), 10_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load, page]);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("backoffice.logs.title")}</h1>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">({total})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-spin" : ""}`} />
            {t("backoffice.logs.autoRefresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => load(page)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            {t("backoffice.logs.refresh")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("backoffice.logs.search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && load(1)}
          />
        </div>

        {/* Service */}
        <Select value={service} onValueChange={v => setService(v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("backoffice.logs.filterService")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("backoffice.logs.allServices")}</SelectItem>
            <SelectItem value="auth">auth</SelectItem>
            <SelectItem value="sms">sms</SelectItem>
            <SelectItem value="email">email</SelectItem>
            <SelectItem value="whatsapp">whatsapp</SelectItem>
            <SelectItem value="impersonation">impersonation</SelectItem>
          </SelectContent>
        </Select>

        {/* Status */}
        <Select value={status} onValueChange={v => setStatus(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t("backoffice.logs.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("backoffice.logs.allStatuses")}</SelectItem>
            <SelectItem value="success">success</SelectItem>
            <SelectItem value="error">error</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
          </SelectContent>
        </Select>

        {/* Level */}
        <Select value={level} onValueChange={v => setLevel(v)}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder={t("backoffice.logs.filterLevel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("backoffice.logs.allLevels")}</SelectItem>
            <SelectItem value="info">info</SelectItem>
            <SelectItem value="warn">warn</SelectItem>
            <SelectItem value="error">error</SelectItem>
            <SelectItem value="debug">debug</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range */}
        <Input type="datetime-local" className="w-44" value={from} onChange={e => setFrom(e.target.value)}
          title={t("backoffice.logs.from")} />
        <Input type="datetime-local" className="w-44" value={to} onChange={e => setTo(e.target.value)}
          title={t("backoffice.logs.to")} />

        <Button size="sm" onClick={() => load(1)} disabled={loading}>
          {t("backoffice.logs.refresh")}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
              <th className="p-2 w-6" />
              <th className="p-2 text-left">{t("backoffice.logs.colTime")}</th>
              <th className="p-2 text-left">{t("backoffice.logs.colService")}</th>
              <th className="p-2 text-left">{t("backoffice.logs.colAction")}</th>
              <th className="p-2 text-left">{t("backoffice.logs.colStatus")}</th>
              <th className="p-2 text-left">{t("backoffice.logs.colSearchable")}</th>
              <th className="p-2 text-right">{t("backoffice.logs.colDuration")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin mx-auto" />
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  {t("backoffice.logs.noLogs")}
                </td>
              </tr>
            ) : logs.map(log => {
              const isOpen = expanded.has(log._id);
              const hasExtra = !!(log.error || log.data);
              return [
                <tr
                  key={log._id}
                  className={`border-b hover:bg-muted/30 transition-colors ${log.status === "error" ? "bg-red-50/50" : ""}`}
                >
                  {/* Expand toggle */}
                  <td className="p-2 text-center">
                    {hasExtra ? (
                      <button
                        onClick={() => toggleExpanded(log._id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    ) : null}
                  </td>

                  {/* Timestamp */}
                  <td className="p-2 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {fmt(log.timestamp)}
                  </td>

                  {/* Service */}
                  <td className="p-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      {log.service}
                    </Badge>
                  </td>

                  {/* Action */}
                  <td className="p-2 font-mono text-xs">{log.action}</td>

                  {/* Status + level */}
                  <td className="p-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[log.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {log.status}
                    </span>
                    {log.level && log.level !== "info" && (
                      <span className={`ml-1 inline-flex px-1.5 py-0.5 rounded text-xs ${LEVEL_COLORS[log.level] ?? ""}`}>
                        {log.level}
                      </span>
                    )}
                  </td>

                  {/* Searchable (customer identifier) */}
                  <td className="p-2 text-xs text-muted-foreground truncate max-w-[180px]">
                    {log.searchable || "—"}
                  </td>

                  {/* Duration */}
                  <td className="p-2 text-right font-mono text-xs text-muted-foreground">
                    {log.durationMs != null ? log.durationMs : "—"}
                  </td>
                </tr>,

                // Expandable detail row
                isOpen && hasExtra ? (
                  <tr key={`${log._id}-detail`} className="bg-muted/20 border-b">
                    <td colSpan={7} className="px-6 py-3 space-y-2">
                      {log.error && (
                        <div>
                          <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">
                            {t("backoffice.logs.errorDetails")}:
                          </span>
                          <pre className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap break-all">
                            {log.error}
                          </pre>
                        </div>
                      )}
                      {log.data && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {t("backoffice.logs.details")}:
                          </span>
                          <pre className="mt-1 text-xs bg-muted border rounded p-2 whitespace-pre-wrap break-all">
                            {(() => { try { return JSON.stringify(log.data, null, 2); } catch { return "[unserializable]"; } })()}
                          </pre>
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground font-mono">
                        correlationId: {log.correlationId}
                        {log.tenantId && ` · tenantId: ${log.tenantId}`}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t("backoffice.logs.page", { page, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading}
              onClick={() => load(page - 1)}>
              ‹
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages || loading}
              onClick={() => load(page + 1)}>
              ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
