import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PresenceStatus } from "@/lib/auth-context";

interface PresenceLogEntry {
  _id: string;
  status: PresenceStatus;
  reason: string;
  startedAt: string;
  endedAt: string | null;
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  break: "bg-yellow-500",
  busy: "bg-red-500",
  offline: "bg-gray-400",
};

const LANG_TO_LOCALE: Record<string, string> = {
  he: "he-IL",
  en: "en-US",
  ar: "ar-SA",
  ru: "ru-RU",
  tr: "tr-TR",
};

function formatHM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDuration(seconds: number, t: (key: string) => string): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const hLabel = t("presence.durationHours");
  const mLabel = t("presence.durationMinutes");
  const sLabel = t("presence.durationSeconds");
  if (h > 0) return `${h}${hLabel} ${m > 0 ? `${m}${mLabel}` : ""}`.trim();
  if (m > 0) return `${m}${mLabel}`;
  return `${s}${sLabel}`;
}

export function PresenceDailyReport({ currentStatus, currentReason }: { currentStatus: PresenceStatus; currentReason: string }) {
  const { t, i18n } = useTranslation();
  const dateLocale = LANG_TO_LOCALE[i18n.language] || LANG_TO_LOCALE.he;

  const { data: logs } = useQuery<PresenceLogEntry[]>({
    queryKey: ["/api/auth/presence-log"],
    refetchInterval: 30000,
  });

  const now = new Date();
  const entries = (logs || []).map((log) => {
    const start = new Date(log.startedAt);
    const end = log.endedAt ? new Date(log.endedAt) : now;
    const durationSec = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    return { ...log, start, end, durationSec };
  });

  const totals: Record<string, number> = {};
  let grandTotal = 0;
  for (const e of entries) {
    const key = e.status;
    totals[key] = (totals[key] || 0) + e.durationSec;
    grandTotal += e.durationSec;
  }

  const statusOrder: PresenceStatus[] = ["active", "busy", "break", "offline"];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center justify-center h-6 w-6 rounded-md hover:bg-muted transition-colors cursor-pointer shrink-0"
          data-testid="button-presence-daily-report"
          title={t("presence.dailyReport")}
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0 max-h-[70vh] overflow-auto"
        align="start"
        sideOffset={8}
      >
        <div className="px-3 py-2 border-b bg-muted/50">
          <h4 className="text-sm font-semibold" data-testid="text-daily-report-title">
            {t("presence.dailyReportTitle")} — {now.toLocaleDateString(dateLocale)}
          </h4>
        </div>

        {entries.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center" data-testid="text-no-presence-data">
            {t("presence.noData")}
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="table-presence-log">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-2 py-1.5 text-start font-medium">{t("presence.timeRange")}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t("presence.statusLabel")}</th>
                <th className="px-2 py-1.5 text-start font-medium">{t("presence.duration")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e._id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-2 py-1.5 font-mono tabular-nums" dir="ltr">
                    {formatHM(e.start)} – {e.endedAt ? formatHM(e.end) : t("presence.now")}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[e.status] || "bg-gray-400"}`} />
                      <span>{t(`presence.${e.status}`)}</span>
                      {e.reason && (
                        <span className="text-muted-foreground">— {e.reason}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                    {formatDuration(e.durationSec, t)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40">
              {statusOrder.filter((s) => totals[s]).map((s) => (
                <tr key={s} className="border-t">
                  <td className="px-2 py-1 text-start font-medium" colSpan={2}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[s]}`} />
                      {t(`presence.${s}`)}
                    </span>
                  </td>
                  <td className="px-2 py-1 font-mono tabular-nums font-medium">
                    {formatDuration(totals[s], t)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-foreground/20">
                <td className="px-2 py-1.5 font-semibold" colSpan={2}>
                  {t("presence.totalTime")}
                </td>
                <td className="px-2 py-1.5 font-mono tabular-nums font-semibold">
                  {formatDuration(grandTotal, t)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </PopoverContent>
    </Popover>
  );
}
