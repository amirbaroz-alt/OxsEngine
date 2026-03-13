import { Building2, Users, UsersRound, UserCircle, MessageSquare, LayoutDashboard, BookOpen, BarChart3, FileText, Settings, ClipboardList, MessageCircle, Inbox, Circle, ChevronUp, Loader2, Lightbulb, Tag, Activity } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { isRtl } from "@/lib/i18n";
import { useRole } from "@/lib/role-context";
import { useAuth, type PresenceStatus } from "@/lib/auth-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@shared/schema";

interface MenuItem {
  titleKey: string;
  url: string;
  icon: LucideIcon;
  testId: string;
  roles: UserRole[];
}

const menuItems: MenuItem[] = [
  { titleKey: "nav.dashboard", url: "/", icon: LayoutDashboard, testId: "link-nav-dashboard", roles: ["superadmin", "businessadmin", "teamleader", "employee"] },
  { titleKey: "nav.inbox", url: "/inbox", icon: Inbox, testId: "link-nav-inbox", roles: ["superadmin", "businessadmin", "teamleader", "employee"] },
  { titleKey: "nav.businesses", url: "/tenants", icon: Building2, testId: "link-nav-businesses", roles: ["superadmin"] },
  { titleKey: "nav.departments", url: "/departments", icon: UsersRound, testId: "link-nav-departments", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.tags", url: "/tags", icon: Tag, testId: "link-nav-tags", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.users", url: "/users", icon: Users, testId: "link-nav-users", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.customers", url: "/customers", icon: UserCircle, testId: "link-nav-customers", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.communicationLog", url: "/communication-log", icon: MessageSquare, testId: "link-nav-communication-log", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.messageMonitor", url: "/message-monitor", icon: Activity, testId: "link-nav-message-monitor", roles: ["superadmin"] },
  { titleKey: "nav.analytics", url: "/analytics", icon: BarChart3, testId: "link-nav-analytics", roles: ["superadmin"] },
  { titleKey: "nav.smsTemplates", url: "/sms-templates", icon: FileText, testId: "link-nav-sms-templates", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.waTemplates", url: "/whatsapp-templates", icon: MessageCircle, testId: "link-nav-wa-templates", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.auditLog", url: "/audit-log", icon: ClipboardList, testId: "link-nav-audit-log", roles: ["superadmin"] },
  { titleKey: "nav.knowledge", url: "/knowledge", icon: Lightbulb, testId: "link-nav-knowledge", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.channels", url: "/settings", icon: Settings, testId: "link-nav-settings", roles: ["superadmin", "businessadmin", "teamleader"] },
  { titleKey: "nav.dictionary", url: "/dictionary", icon: BookOpen, testId: "link-nav-dictionary", roles: ["superadmin"] },
];

const presenceConfig: Record<PresenceStatus, { colorClass: string; dotColor: string }> = {
  active: { colorClass: "text-green-500", dotColor: "bg-green-500" },
  break: { colorClass: "text-yellow-500", dotColor: "bg-yellow-500" },
  busy: { colorClass: "text-red-500", dotColor: "bg-red-500" },
  offline: { colorClass: "text-gray-400", dotColor: "bg-gray-400" },
};

export function AppSidebar() {
  const [location] = useLocation();
  const { t, i18n } = useTranslation();
  const rtl = isRtl(i18n.language);
  const { canAccess } = useRole();
  const { user, token, updatePresence, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  const visibleItems = menuItems.filter((item) => canAccess(item.roles));

  const currentPresence: PresenceStatus = (user?.presenceStatus as PresenceStatus) || "active";

  const { toast } = useToast();
  const presenceMutation = useMutation({
    mutationFn: async (status: PresenceStatus) => {
      await apiRequest("PATCH", "/api/auth/presence", { presenceStatus: status });
      return status;
    },
    onSuccess: (status) => {
      updatePresence(status);
    },
    onError: () => {
      toast({ title: t("common.error", "Error"), variant: "destructive" });
    },
  });

  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <Sidebar side={rtl ? "right" : "left"} collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            CP
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold" data-testid="text-app-name">{t("app.name")}</span>
            <span className="text-xs text-muted-foreground">{t("app.subtitle")}</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.management")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.titleKey)}>
                      <Link
                        href={item.url}
                        data-testid={item.testId}
                        onClick={() => { if (isMobile) setOpenMobile(false); }}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{t(item.titleKey)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        {user && (
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className="w-full"
                    data-testid="button-presence-menu"
                  >
                    <div className="relative">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                      </Avatar>
                      <span
                        className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar ${presenceConfig[currentPresence].dotColor}`}
                        data-testid="indicator-presence-dot"
                      />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                      <span className="text-sm font-medium truncate">{user.role === "superadmin" ? t("users.roles.superadmin") : user.name}</span>
                      <span className={`text-[11px] ${presenceConfig[currentPresence].colorClass}`}>
                        {t(`presence.${currentPresence}`)}
                      </span>
                    </div>
                    <ChevronUp className="h-4 w-4 ms-auto group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side={rtl ? "left" : "right"}
                  align="end"
                  className="w-48"
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("presence.setStatus", "Set Status")}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(["active", "break", "busy", "offline"] as PresenceStatus[]).map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => !presenceMutation.isPending && presenceMutation.mutate(status)}
                      className="gap-2"
                      disabled={presenceMutation.isPending}
                      data-testid={`menuitem-presence-${status}`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${presenceConfig[status].dotColor}`} />
                      <span className="flex-1">{t(`presence.${status}`)}</span>
                      {presenceMutation.isPending && presenceMutation.variables === status ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : currentPresence === status ? (
                        <Circle className="h-2 w-2 fill-current" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logout()}
                    className="gap-2 text-destructive focus:text-destructive"
                    data-testid="menuitem-logout"
                  >
                    {t("auth.logout", "Log Out")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
