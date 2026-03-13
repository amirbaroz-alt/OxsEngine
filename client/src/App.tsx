import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RoleSwitcher } from "@/components/role-switcher";
import { RoleProvider } from "@/lib/role-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { isRtl, loadTranslationOverrides } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { LogOut, Circle } from "lucide-react";
import { PresenceDailyReport } from "@/components/presence-daily-report";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import type { PresenceStatus } from "@/lib/auth-context";
import Dashboard from "@/pages/dashboard";
import TenantsPage from "@/pages/tenants";
import UsersPage from "@/pages/users-page";
import CommunicationLogPage from "@/pages/communication-log";
import DictionaryPage from "@/pages/dictionary";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";

const AnalyticsPage = lazy(() => import("@/pages/analytics"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const SmsTemplatesPage = lazy(() => import("@/pages/sms-templates"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const WhatsAppTemplatesPage = lazy(() => import("@/pages/whatsapp-templates"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const KnowledgePage = lazy(() => import("@/pages/knowledge"));
const DepartmentsPage = lazy(() => import("@/pages/departments"));
const TagsPage = lazy(() => import("@/pages/tags"));
const MessageMonitorPage = lazy(() => import("@/pages/admin/MessageMonitor"));

function Router() {
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading...</div>}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/tenants" component={TenantsPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/inbox" component={InboxPage} />
        <Route path="/customers" component={CustomersPage} />
        <Route path="/communication-log" component={CommunicationLogPage} />
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/audit-log" component={AuditLogPage} />
        <Route path="/sms-templates" component={SmsTemplatesPage} />
        <Route path="/whatsapp-templates" component={WhatsAppTemplatesPage} />
        <Route path="/departments" component={DepartmentsPage} />
        <Route path="/tags" component={TagsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/knowledge" component={KnowledgePage} />
        <Route path="/message-monitor" component={MessageMonitorPage} />
        <Route path="/dictionary" component={DictionaryPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  active: "bg-green-500",
  break: "bg-yellow-500",
  busy: "bg-red-500",
  offline: "bg-gray-400",
};

function AuthenticatedApp() {
  const { user, logout, updatePresence } = useAuth();
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const rtl = isRtl(i18n.language);

  const currentPresence: PresenceStatus = (user?.presenceStatus as PresenceStatus) || "active";
  const currentReason: string = user?.presenceReason || "";

  const BREAK_REASONS = ["lunch", "coffee", "restroom"] as const;

  const { data: freshBusyReasons } = useQuery<string[]>({
    queryKey: ["/api/auth/busy-reasons"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/me");
      const data = await res.json();
      return data.busyReasons || [];
    },
    staleTime: 0,
  });
  const BUSY_REASONS = freshBusyReasons ?? user?.busyReasons ?? [];

  const presenceMutation = useMutation({
    mutationFn: async ({ status, reason }: { status: PresenceStatus; reason?: string }) => {
      await apiRequest("PATCH", "/api/auth/presence", { presenceStatus: status, presenceReason: reason || "" });
      return { status, reason: reason || "" };
    },
    onSuccess: ({ status, reason }) => {
      updatePresence(status, reason);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/presence-log"] });
    },
    onError: () => { toast({ title: t("common.error", "Error"), variant: "destructive" }); },
  });

  const presenceStartRef = useRef<number>(Date.now());
  const prevPresenceRef = useRef<PresenceStatus>(currentPresence);
  const [presenceElapsed, setPresenceElapsed] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setPresenceElapsed(Math.floor((Date.now() - presenceStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const formatPresenceTimer = useCallback((totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }, []);

  const setPresence = (status: PresenceStatus, reason?: string) => {
    if (presenceMutation.isPending) return;
    const elapsed = Math.floor((Date.now() - presenceStartRef.current) / 1000);
    const prevStatus = prevPresenceRef.current;
    const prevReason = currentReason;
    presenceMutation.mutate({ status, reason }, {
      onSuccess: () => {
        const prevLabel = t(`presence.${prevStatus}`);
        const reasonLabel = prevReason ? ` — ${prevReason}` : "";
        const timeLabel = formatPresenceTimer(elapsed);
        toast({
          title: t("presence.statusChanged", "Status Changed"),
          description: `${prevLabel}${reasonLabel}: ${timeLabel}`,
        });
        presenceStartRef.current = Date.now();
        prevPresenceRef.current = status;
        setPresenceElapsed(0);
      },
    });
  };

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <RoleProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header dir={rtl ? "rtl" : "ltr"} className="flex items-center justify-between gap-1 md:gap-2 px-1.5 py-1 md:p-3 border-b bg-background sticky top-0 z-50">
              <div className="flex items-center gap-1 md:gap-2 min-w-0 max-w-[200px] md:max-w-none">
                {user && (
                  <div className="flex items-center gap-1 border-2 border-blue-500 rounded-lg px-1.5 py-0.5">
                  <DropdownMenu dir={rtl ? "rtl" : "ltr"}>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors cursor-pointer"
                        data-testid="button-header-presence"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT[currentPresence]}`} />
                        <span className="text-xs md:text-sm font-medium truncate" data-testid="text-user-name">
                          {user.role === "superadmin" ? t("users.roles.superadmin") : user.name}
                        </span>
                        <span className="text-xs md:text-sm font-bold hidden md:inline" data-testid="text-presence-label">
                          · {t(`presence.${currentPresence}`)}{currentReason ? ` — ${currentReason}` : ""}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground hidden md:inline tabular-nums" data-testid="text-presence-timer">
                          ({formatPresenceTimer(presenceElapsed)})
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent dir={rtl ? "rtl" : "ltr"} align={rtl ? "end" : "start"} className="w-48 border-2 border-blue-800 bg-white [&_[role=menuitem]:focus]:bg-blue-100 [&_[role=menuitem]:focus]:text-foreground [&_[data-radix-collection-item]:focus]:bg-blue-100">
                      <DropdownMenuItem onClick={() => setPresence("active")} className="gap-2 cursor-pointer" data-testid="header-presence-active">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT.active}`} />
                        <span className="flex-1">{t("presence.active")}</span>
                        {currentPresence === "active" && <Circle className="h-2 w-2 fill-current" />}
                      </DropdownMenuItem>

                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2 cursor-pointer focus:bg-blue-100 data-[state=open]:bg-blue-100" data-testid="header-presence-break">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT.break}`} />
                          <span className="flex-1">{t("presence.break")}</span>
                          {currentPresence === "break" && <Circle className="h-2 w-2 fill-current" />}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent dir={rtl ? "rtl" : "ltr"} className="border-2 border-blue-800 bg-white [&_[role=menuitem]:focus]:bg-blue-100 [&_[role=menuitem]:focus]:text-foreground">
                            {BREAK_REASONS.map((reason) => (
                              <DropdownMenuItem key={reason} onClick={() => setPresence("break", reason)} className="gap-2 cursor-pointer" data-testid={`header-presence-break-${reason}`}>
                                <span className="flex-1">{t(`presence.reasons.${reason}`)}</span>
                                {currentPresence === "break" && currentReason === reason && <Circle className="h-2 w-2 fill-current" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>

                      {BUSY_REASONS.length > 0 ? (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2 cursor-pointer focus:bg-blue-100 data-[state=open]:bg-blue-100" data-testid="header-presence-busy">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT.busy}`} />
                            <span className="flex-1">{t("presence.busy")}</span>
                            {currentPresence === "busy" && <Circle className="h-2 w-2 fill-current" />}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuPortal>
                            <DropdownMenuSubContent dir={rtl ? "rtl" : "ltr"} className="border-2 border-blue-800 bg-white [&_[role=menuitem]:focus]:bg-blue-100 [&_[role=menuitem]:focus]:text-foreground">
                              {BUSY_REASONS.map((reason) => (
                                <DropdownMenuItem key={reason} onClick={() => setPresence("busy", reason)} className="gap-2 cursor-pointer" data-testid={`header-presence-busy-${reason}`}>
                                  <span className="flex-1">{reason}</span>
                                  {currentPresence === "busy" && currentReason === reason && <Circle className="h-2 w-2 fill-current" />}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuPortal>
                        </DropdownMenuSub>
                      ) : (
                        <DropdownMenuItem onClick={() => setPresence("busy")} className="gap-2 cursor-pointer" data-testid="header-presence-busy">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT.busy}`} />
                          <span className="flex-1">{t("presence.busy")}</span>
                          {currentPresence === "busy" && <Circle className="h-2 w-2 fill-current" />}
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuItem onClick={() => setPresence("offline")} className="gap-2 cursor-pointer" data-testid="header-presence-offline">
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${PRESENCE_DOT.offline}`} />
                        <span className="flex-1">{t("presence.offline")}</span>
                        {currentPresence === "offline" && <Circle className="h-2 w-2 fill-current" />}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <PresenceDailyReport currentStatus={currentPresence} currentReason={currentReason} />
                  </div>
                )}
                <RoleSwitcher />
              </div>
              <div className="flex items-center shrink-0">
                <LanguageSwitcher />
                <ThemeToggle />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 md:h-9 md:w-9 p-2"
                  onClick={logout}
                  title={t("auth.logout")}
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
                <SidebarTrigger className="h-8 w-8 md:h-9 md:w-9 p-2" title={t("common.menu", "תפריט")} data-testid="button-sidebar-toggle" />
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              <Router />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </RoleProvider>
  );
}

function AppContent() {
  const { i18n } = useTranslation();
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    const lang = i18n.language || "he";
    const html = document.documentElement;
    html.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
  }, [i18n.language]);

  useEffect(() => {
    loadTranslationOverrides();
  }, []);

  if (location === "/admin" || location === "/login/admin") {
    return <LoginPage />;
  }

  if (location === "/login" || location.startsWith("/login/")) {
    const slugMatch = location.match(/^\/login\/([^/]+)/);
    const slug = slugMatch ? slugMatch[1] : undefined;
    return <LoginPage slug={slug} noSlugError={!slug} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage slug={undefined} noSlugError />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
