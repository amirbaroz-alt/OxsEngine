import { Switch, Route, Link, useLocation } from "wouter";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useBackofficeAuth } from "@/lib/backoffice-auth";
import BackofficeLoginPage from "./login";
import BackofficeDashboard from "./dashboard";
import BackofficeTenantsPage from "./tenants";
import BackofficeUsersPage from "./users";
import BackofficeLogsPage from "./logs";
import BackofficeSettingsPage from "./settings";
import { Shield, LayoutDashboard, Building2, Users, FileText, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { isRtl } from "@/lib/i18n";

const NAV_ITEMS = [
  { path: "/backoffice", key: "dashboard", icon: LayoutDashboard, exact: true },
  { path: "/backoffice/tenants", key: "tenants", icon: Building2, exact: false },
  { path: "/backoffice/users", key: "users", icon: Users, exact: false },
  { path: "/backoffice/logs", key: "logs", icon: FileText, exact: false },
  { path: "/backoffice/settings", key: "settings", icon: Settings, exact: false },
];

function BackofficeLayout() {
  const { user, logout } = useBackofficeAuth();
  const [location] = useLocation();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const lang = i18n.language || "he";
    const html = document.documentElement;
    html.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
  }, [i18n.language]);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r bg-muted/30 flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-4 py-4 border-b">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">OxsEngine</span>
          <span className="text-xs text-muted-foreground ml-auto">BO</span>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.exact
              ? location === item.path
              : location.startsWith(item.path);
            return (
              <Link key={item.path} href={item.path}>
                <a
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {t(`backoffice.nav.${item.key}`)}
                </a>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t space-y-1">
          <p className="text-xs text-muted-foreground px-1 truncate">{user?.name}</p>
          <p className="text-[11px] text-muted-foreground/70 px-1 truncate">{user?.role}</p>
          <div className="flex items-center gap-1 mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start gap-2 text-xs"
              onClick={logout}
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("backoffice.nav.logout")}
            </Button>
            <LanguageSwitcher />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        <Switch>
          <Route path="/backoffice" component={BackofficeDashboard} />
          <Route path="/backoffice/tenants" component={BackofficeTenantsPage} />
          <Route path="/backoffice/users" component={BackofficeUsersPage} />
          <Route path="/backoffice/logs" component={BackofficeLogsPage} />
          <Route path="/backoffice/settings" component={BackofficeSettingsPage} />
        </Switch>
      </div>
    </div>
  );
}

export default function BackofficeApp() {
  const { isAuthenticated, isLoading } = useBackofficeAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <BackofficeLoginPage />;
  }

  return <BackofficeLayout />;
}
