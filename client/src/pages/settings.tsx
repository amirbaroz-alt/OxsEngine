import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Tenant } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ToggleBadge } from "@/components/ui/toggle-badge";
import {
  Settings,
  MessageSquare,
  Mail,
  Phone,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  CircleCheck,
  CircleX,
  AlertTriangle,
  Plug,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Shield,
  Clock,
  UsersRound,
  Users,
  X,
  UserCheck,
  UserX,
  FileText,
} from "lucide-react";
import { ChannelLogsDialog } from "@/components/channel-logs-dialog";
import { Checkbox } from "@/components/ui/checkbox";

const channelTypeIcons: Record<string, typeof MessageSquare> = {
  WHATSAPP: MessageSquare,
  SMS: Phone,
  EMAIL: Mail,
};

const channelFormSchema = z.object({
  tenantId: z.string().min(1, "Tenant is required"),
  type: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  name: z.string().min(1, "Name is required"),
  phoneNumberId: z.string().optional(),
  wabaId: z.string().optional(),
  accessToken: z.string().optional(),
  verifyToken: z.string().optional(),
  appSecret: z.string().optional(),
  smsUserName: z.string().optional(),
  smsSource: z.string().optional(),
  sendGridKey: z.string().optional(),
  fromEmail: z.string().optional(),
  fromName: z.string().optional(),
  teamIds: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
  if (data.type === "WHATSAPP") {
    if (!data.phoneNumberId?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Phone Number ID is required for WhatsApp", path: ["phoneNumberId"] });
    }
    if (!data.accessToken?.trim() && !data.accessToken?.startsWith("****")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Access Token is required for WhatsApp", path: ["accessToken"] });
    }
  }
  if (data.type === "EMAIL") {
    if (!data.fromEmail?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "From Email is required for Email channels", path: ["fromEmail"] });
    }
  }
});

type ChannelFormData = z.infer<typeof channelFormSchema>;

interface Channel {
  _id: string;
  tenantId: string;
  type: "WHATSAPP" | "SMS" | "EMAIL";
  name: string;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  accessToken?: string | null;
  verifyToken?: string | null;
  appSecret?: string | null;
  status: "active" | "disconnected";
  isActive?: boolean;
  tokenExpiredAt?: string | null;
  smsUserName?: string | null;
  smsSource?: string | null;
  sendGridKey?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  teamIds?: string[];
  createdAt: string;
  updatedAt: string;
}

function ChannelTeamCheckboxes({ teams, form }: { teams: any[]; form: any }) {
  const watchedTeamIds: string[] = form.watch("teamIds") || [];
  return (
    <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
      {teams.map((team: any) => {
        const isChecked = watchedTeamIds.includes(team._id);
        return (
          <label key={team._id} className="flex items-center gap-2 cursor-pointer" data-testid={`checkbox-channel-team-${team._id}`}>
            <Checkbox
              checked={isChecked}
              onCheckedChange={(checked) => {
                const prev = form.getValues("teamIds") || [];
                const deduped = [...new Set(prev)] as string[];
                if (checked) {
                  if (!deduped.includes(team._id)) {
                    form.setValue("teamIds", [...deduped, team._id], { shouldDirty: true });
                  }
                } else {
                  form.setValue("teamIds", deduped.filter((id: string) => id !== team._id), { shouldDirty: true });
                }
              }}
            />
            <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
            <span className="text-sm">{team.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  const [filterTenantId, setFilterTenantId] = useState<string>("__all__");
  const [logsChannel, setLogsChannel] = useState<{ id: string; name: string } | null>(null);


  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [empRole, setEmpRole] = useState("employee");
  const [empTeamIds, setEmpTeamIds] = useState<string[]>([]);

  const { currentRole, currentTenantId } = useRole();
  const userTenantId = user?.tenantId;
  const effectiveRole = currentRole;
  const isSuperAdmin = effectiveRole === "superadmin";
  const isBusinessAdmin = effectiveRole === "businessadmin";

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperAdmin,
  });

  const effectiveTenantId = isSuperAdmin ? null : (currentTenantId || userTenantId);

  const channelsQueryTenantId = isSuperAdmin
    ? (filterTenantId !== "__all__" ? filterTenantId : undefined)
    : effectiveTenantId;

  const channelsUrl = channelsQueryTenantId
    ? `/api/channels?tenantId=${channelsQueryTenantId}`
    : "/api/channels";

  const { data: channels, isLoading } = useQuery<Channel[]>({
    queryKey: [channelsUrl],
    enabled: !!effectiveTenantId || isSuperAdmin,
  });

  const form = useForm<ChannelFormData>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: {
      tenantId: userTenantId || "",
      type: "WHATSAPP",
      name: "",
      phoneNumberId: "",
      wabaId: "",
      accessToken: "",
      verifyToken: "",
      appSecret: "",
      smsUserName: "",
      smsSource: "",
      sendGridKey: "",
      fromEmail: "",
      fromName: "",
    },
  });

  const selectedType = form.watch("type");
  const selectedFormTenantId = form.watch("tenantId");
  const [showFormTokens, setShowFormTokens] = useState<Record<string, boolean>>({});
  const [revealedFormValues, setRevealedFormValues] = useState<Record<string, string>>({});

  const revealFormField = async (fieldName: string) => {
    if (showFormTokens[fieldName]) {
      setShowFormTokens(p => ({ ...p, [fieldName]: false }));
      return;
    }
    if (!editingChannel?._id) {
      setShowFormTokens(p => ({ ...p, [fieldName]: true }));
      return;
    }
    if (revealedFormValues[fieldName]) {
      form.setValue(fieldName as any, revealedFormValues[fieldName]);
      setShowFormTokens(p => ({ ...p, [fieldName]: true }));
      return;
    }
    try {
      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`/api/channels/${editingChannel._id}/reveal/${fieldName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { value } = await res.json();
        setRevealedFormValues(p => ({ ...p, [fieldName]: value }));
        form.setValue(fieldName as any, value);
        setShowFormTokens(p => ({ ...p, [fieldName]: true }));
      }
    } catch {}
  };

  const activeTenantId = isSuperAdmin
    ? (filterTenantId !== "__all__" ? filterTenantId : undefined)
    : effectiveTenantId;

  const teamsQueryTenantId = activeTenantId;
  const teamsUrl = teamsQueryTenantId ? `/api/teams?tenantId=${teamsQueryTenantId}` : undefined;
  const { data: teams } = useQuery<{ _id: string; tenantId: string; name: string; description?: string; color: string; managerId?: string }[]>({
    queryKey: [teamsUrl],
    enabled: !!teamsUrl,
  });

  const channelFormTeams = (teams || []).filter((t) => String(t.tenantId) === selectedFormTenantId);

  const createMutation = useMutation({
    mutationFn: (data: ChannelFormData) => {
      const { tenantId: formTenantId, ...rest } = data;
      return apiRequest("POST", `/api/channels?tenantId=${formTenantId}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      toast({ title: t("channels.createdSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ChannelFormData & { _id: string }) => {
      const { tenantId: _tid, ...rest } = data;
      return apiRequest("PATCH", `/api/channels/${data._id}`, rest);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      toast({ title: t("channels.updatedSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      toast({ title: t("channels.deletedSuccess") });
      setDeleteDialogOpen(false);
      setChannelToDelete(null);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const activateChannelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/channels/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      toast({ title: t("channels.activatedSuccess", "Channel activated") });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const deactivateChannelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/channels/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      toast({ title: t("channels.deactivatedSuccess", "Channel deactivated") });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingChannelId(id);
      const resp = await apiRequest("POST", `/api/channels/${id}/test`);
      return resp.json();
    },
    onSuccess: (data: { success: boolean; message: string; details?: Record<string, any> }) => {
      setTestingChannelId(null);
      if (data.success) {
        const detailStr = data.details
          ? Object.entries(data.details).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ")
          : "";
        toast({ title: t("channels.testSuccess"), description: detailStr || data.message });
        queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      } else {
        toast({ title: t("channels.testFailed"), description: data.message, variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: [channelsUrl] });
      }
    },
    onError: (err: Error) => {
      setTestingChannelId(null);
      toast({ title: t("channels.testFailed"), description: err.message, variant: "destructive" });
    },
  });

  function openCreateDialog() {
    setEditingChannel(null);
    form.reset({
      tenantId: isSuperAdmin ? (filterTenantId !== "__all__" ? filterTenantId : "") : (effectiveTenantId || ""),
      type: "WHATSAPP",
      name: "",
      phoneNumberId: "",
      wabaId: "",
      accessToken: "",
      verifyToken: "",
      appSecret: "",
      smsUserName: "",
      smsSource: "",
      sendGridKey: "",
      fromEmail: "",
      fromName: "",
      teamIds: [],
    });
    setDialogOpen(true);
  }

  function openEditDialog(channel: Channel) {
    setEditingChannel(channel);
    form.reset({
      tenantId: channel.tenantId,
      type: channel.type,
      name: channel.name,
      phoneNumberId: channel.phoneNumberId || "",
      wabaId: channel.wabaId || "",
      accessToken: channel.accessToken || "",
      verifyToken: channel.verifyToken || "",
      appSecret: channel.appSecret || "",
      smsUserName: channel.smsUserName || "",
      smsSource: channel.smsSource || "",
      sendGridKey: channel.sendGridKey || "",
      fromEmail: channel.fromEmail || "",
      fromName: channel.fromName || "",
      teamIds: [...new Set(channel.teamIds || [])],
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingChannel(null);
    form.reset();
    setShowFormTokens({});
    setRevealedFormValues({});
  }

  function onSubmit(data: ChannelFormData) {
    if (editingChannel) {
      updateMutation.mutate({ ...data, _id: editingChannel._id });
    } else {
      createMutation.mutate(data);
    }
  }

  function openDeleteDialog(channel: Channel) {
    setChannelToDelete(channel);
    setDeleteDialogOpen(true);
  }

  function confirmDelete() {
    if (channelToDelete) {
      deleteMutation.mutate(channelToDelete._id);
    }
  }

  function toggleSecret(channelId: string, field: string) {
    const key = `${channelId}-${field}`;
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isSecretVisible(channelId: string, field: string) {
    return showSecrets[`${channelId}-${field}`] || false;
  }

  function renderSecretValue(channelId: string, field: string, value?: string | null) {
    if (!value) return <span className="text-muted-foreground">--</span>;
    const visible = isSecretVisible(channelId, field);
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-mono text-xs">{visible ? value : value.replace(/./g, "\u2022")}</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => toggleSecret(channelId, field)}
          data-testid={`button-toggle-secret-${field}-${channelId}`}
        >
          {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </Button>
      </span>
    );
  }


  function getChannelTypeBadge(type: string) {
    const Icon = channelTypeIcons[type] || MessageSquare;
    const colorMap: Record<string, string> = {
      WHATSAPP: "bg-green-600 text-white dark:bg-green-700",
      SMS: "bg-blue-600 text-white dark:bg-blue-700",
      EMAIL: "bg-amber-600 text-white dark:bg-amber-700",
    };
    return (
      <Badge className={colorMap[type] || ""}>
        <Icon className="h-3 w-3 me-1" />
        {type}
      </Badge>
    );
  }

  function getTenantName(tid: string): string {
    if (!tenants) return tid;
    const found = tenants.find((ten) => ten._id === tid);
    return found?.nameHe || found?.nameEn || tid;
  }

  const [slaResponseTime, setSlaResponseTime] = useState(15);
  const [slaWarningTime, setSlaWarningTime] = useState(10);
  const [slaEnabled, setSlaEnabled] = useState(false);
  const [slaLoaded, setSlaLoaded] = useState(false);

  const { data: activeTenant } = useQuery<Tenant>({
    queryKey: ["/api/tenants", activeTenantId],
    enabled: !!activeTenantId,
  });

  if (activeTenant?.slaConfig && !slaLoaded) {
    setSlaResponseTime(activeTenant.slaConfig.responseTimeMinutes ?? 15);
    setSlaWarningTime(activeTenant.slaConfig.warningTimeMinutes ?? 10);
    setSlaEnabled(activeTenant.slaConfig.enabled ?? false);
    setSlaLoaded(true);
  }

  const slaMutation = useMutation({
    mutationFn: async () => {
      if (!activeTenantId) throw new Error("No tenant selected");
      return apiRequest("PATCH", `/api/tenants/${activeTenantId}/sla`, {
        responseTimeMinutes: slaResponseTime,
        warningTimeMinutes: slaWarningTime,
        enabled: slaEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", activeTenantId] });
      toast({ title: t("sla.saved") });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const { data: encryptionStatus, isLoading: encStatusLoading } = useQuery<{
    ok: boolean;
    totalFields: number;
    encryptedFields: number;
    plaintextFields: number;
    issues: string[];
  }>({
    queryKey: ["/api/encryption/status"],
    enabled: isSuperAdmin,
  });

  const encryptVerifyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/encryption/verify").then((r) => r.json()),
    onSuccess: (data: { fixed: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/encryption/status"] });
      toast({ title: t("encryption.verified"), description: t("encryption.fixedFields", { count: data.fixed }) });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const usersUrl = activeTenantId ? `/api/users?tenantId=${activeTenantId}` : undefined;
  const { data: tenantUsers, isLoading: usersLoading } = useQuery<any[]>({
    queryKey: [usersUrl],
    enabled: !!usersUrl,
  });


  const updateEmployeeMutation = useMutation({
    mutationFn: (data: { id: string; role: string; teamIds: string[] }) =>
      apiRequest("PATCH", `/api/users/${data.id}`, { role: data.role, teamIds: data.teamIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [usersUrl] });
      toast({ title: t("employees.updated", "Employee updated") });
      setEmployeeDialogOpen(false);
      setEditingEmployee(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const deactivateEmployeeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/users/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [usersUrl] });
      toast({ title: t("employees.deactivated", "Employee deactivated") });
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const activateEmployeeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/users/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [usersUrl] });
      toast({ title: t("employees.activated", "Employee activated") });
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (!isSuperAdmin && !isBusinessAdmin) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Settings}
          title={t("common.accessDenied")}
          description={t("common.noPermission")}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-settings-title">
            {t("channels.title")}
          </h1>
          <p className="text-muted-foreground">{t("channels.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && tenants && (
            <Select value={filterTenantId} onValueChange={setFilterTenantId}>
              <SelectTrigger className="w-[200px]" data-testid="select-filter-tenant">
                <SelectValue placeholder={t("channels.allTenants")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("channels.allTenants")}</SelectItem>
                {tenants.map((ten) => (
                  <SelectItem key={ten._id} value={ten._id}>{ten.nameHe || ten.nameEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={openCreateDialog} data-testid="button-add-channel">
            <Plus className="h-4 w-4 me-2" />
            {t("channels.addChannel")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <DataTableSkeleton columns={6} />
      ) : !channels?.length ? (
        <EmptyState
          icon={Settings}
          title={t("channels.emptyTitle")}
          description={t("channels.emptyDescription")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("channels.columnTenant")}</TableHead>
                  <TableHead>{t("channels.columnName")}</TableHead>
                  <TableHead>{t("channels.columnType")}</TableHead>
                  <TableHead>{t("channels.active", "Active")}</TableHead>
                  <TableHead>{t("channels.columnDetails")}</TableHead>
                  <TableHead>{t("channels.teams", "Departments")}</TableHead>
                  <TableHead className="w-[100px]">{t("channels.columnActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel._id} data-testid={`row-channel-${channel._id}`}>
                    <TableCell data-testid={`text-channel-tenant-${channel._id}`}>
                      {isSuperAdmin ? getTenantName(channel.tenantId) : getTenantName(channel.tenantId)}
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-channel-name-${channel._id}`}>
                      {channel.name}
                    </TableCell>
                    <TableCell>{getChannelTypeBadge(channel.type)}</TableCell>
                    <TableCell data-testid={`badge-channel-active-${channel._id}`}>
                      {channel.isActive !== false ? (
                        <Badge className="bg-green-600 text-white dark:bg-green-700">
                          <CircleCheck className="h-3 w-3 me-1" />
                          {t("channels.activeLabel", "Active")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <CircleX className="h-3 w-3 me-1" />
                          {t("channels.inactiveLabel", "Inactive")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {channel.type === "WHATSAPP" && (
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          {channel.phoneNumberId && (
                            <div>Phone ID: {renderSecretValue(channel._id, "phoneNumberId", channel.phoneNumberId)}</div>
                          )}
                          {channel.accessToken && (
                            <div>Token: {renderSecretValue(channel._id, "accessToken", channel.accessToken)}</div>
                          )}
                        </div>
                      )}
                      {channel.type === "SMS" && (
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          {channel.smsUserName && <div>User: {channel.smsUserName}</div>}
                          {channel.smsSource && <div>Source: {channel.smsSource}</div>}
                        </div>
                      )}
                      {channel.type === "EMAIL" && (
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          {channel.fromEmail && <div>From: {channel.fromEmail}</div>}
                          {channel.fromName && <div>Name: {channel.fromName}</div>}
                          {channel.sendGridKey && (
                            <div>API Key: {renderSecretValue(channel._id, "sendGridKey", channel.sendGridKey)}</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-channel-teams-${channel._id}`}>
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(channel.teamIds || [])].map((tid) => {
                          const team = (teams || []).find((t) => t._id === tid);
                          return team ? (
                            <Badge key={tid} variant="secondary" className="text-xs">
                              <span className="inline-block w-2 h-2 rounded-full me-1 shrink-0" style={{ backgroundColor: team.color }} />
                              {team.name}
                            </Badge>
                          ) : null;
                        })}
                        {(!channel.teamIds || channel.teamIds.length === 0) && (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {(isSuperAdmin || isBusinessAdmin) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t("channels.viewLogs", "View Logs")}
                            onClick={() => setLogsChannel({ id: channel._id, name: channel.name })}
                            data-testid={`button-logs-channel-${channel._id}`}
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title={t("channels.testConnection", "Test Connection")}
                          onClick={() => testMutation.mutate(channel._id)}
                          disabled={testingChannelId === channel._id}
                          data-testid={`button-test-channel-${channel._id}`}
                        >
                          {testingChannelId === channel._id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plug className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={t("channels.editChannel", "Edit Channel")}
                          onClick={() => openEditDialog(channel)}
                          data-testid={`button-edit-channel-${channel._id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {channel.isActive !== false ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t("channels.deactivateChannel", "Deactivate Channel")}
                            onClick={() => deactivateChannelMutation.mutate(channel._id)}
                            disabled={deactivateChannelMutation.isPending}
                            data-testid={`button-deactivate-channel-${channel._id}`}
                          >
                            <ToggleRight className="h-4 w-4 text-green-600" />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            title={t("channels.activateChannel", "Activate Channel")}
                            onClick={() => activateChannelMutation.mutate(channel._id)}
                            disabled={activateChannelMutation.isPending}
                            data-testid={`button-activate-channel-${channel._id}`}
                          >
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title={t("channels.deleteChannel", "Delete Channel")}
                          onClick={() => openDeleteDialog(channel)}
                          data-testid={`button-delete-channel-${channel._id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {activeTenantId && (isSuperAdmin || isBusinessAdmin) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              {t("employees.title", "Employees")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <DataTableSkeleton columns={7} />
            ) : !tenantUsers?.length ? (
              <EmptyState
                icon={Users}
                title={t("employees.emptyTitle", "No employees yet")}
                description={t("employees.emptyDescription", "No users found for this tenant")}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("employees.name", "Name")}</TableHead>
                    <TableHead>{t("employees.email", "Email")}</TableHead>
                    <TableHead>{t("employees.phone", "Phone")}</TableHead>
                    <TableHead>{t("employees.role", "Role")}</TableHead>
                    <TableHead>{t("employees.teams", "Departments")}</TableHead>
                    <TableHead>{t("employees.status", "Status")}</TableHead>
                    <TableHead className="w-[100px]">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantUsers.map((emp: any) => {
                    const empTeams = (emp.teamIds || []).map((tid: string) => teams?.find((t: any) => t._id === tid)).filter(Boolean);
                    return (
                      <TableRow key={emp._id} data-testid={`row-employee-${emp._id}`}>
                        <TableCell className="font-medium" data-testid={`text-employee-name-${emp._id}`}>
                          {emp.name || emp.fullName || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-employee-email-${emp._id}`}>
                          {emp.email || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-employee-phone-${emp._id}`}>
                          {emp.phone || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" data-testid={`badge-employee-role-${emp._id}`}>
                            {t(`users.roles.${emp.role}`, emp.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {empTeams.length > 0 ? empTeams.map((team: any) => (
                              <Badge key={team._id} variant="secondary" data-testid={`badge-employee-team-${emp._id}-${team._id}`}>
                                <div className="w-2 h-2 rounded-full shrink-0 me-1" style={{ backgroundColor: team.color }} />
                                {team.name}
                              </Badge>
                            )) : <span className="text-muted-foreground text-sm">-</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {emp.isActive !== false ? (
                            <Badge className="bg-green-600 text-white dark:bg-green-700" data-testid={`badge-employee-status-${emp._id}`}>
                              <CircleCheck className="h-3 w-3 me-1" />
                              {t("employees.active", "Active")}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" data-testid={`badge-employee-status-${emp._id}`}>
                              <CircleX className="h-3 w-3 me-1" />
                              {t("employees.inactive", "Inactive")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingEmployee(emp);
                                setEmpRole(emp.role || "employee");
                                setEmpTeamIds(emp.teamIds || []);
                                setEmployeeDialogOpen(true);
                              }}
                              data-testid={`button-edit-employee-${emp._id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {emp.isActive !== false ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deactivateEmployeeMutation.mutate(emp._id)}
                                disabled={deactivateEmployeeMutation.isPending}
                                data-testid={`button-deactivate-employee-${emp._id}`}
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => activateEmployeeMutation.mutate(emp._id)}
                                disabled={activateEmployeeMutation.isPending}
                                data-testid={`button-activate-employee-${emp._id}`}
                              >
                                <UserCheck className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}


      {activeTenantId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5" />
              {t("sla.title")}
            </CardTitle>
            <ToggleBadge
              checked={slaEnabled}
              onCheckedChange={setSlaEnabled}
              labels={{ on: t("sla.enabled"), off: t("sla.enabled") }}
              data-testid="switch-sla-enabled"
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("sla.description")}</p>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("sla.responseTime")}</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={slaResponseTime}
                    onChange={(e) => setSlaResponseTime(Number(e.target.value))}
                    className="w-[100px]"
                    disabled={!slaEnabled}
                    data-testid="input-sla-response-time"
                  />
                  <span className="text-sm text-muted-foreground">{t("sla.minutes")}</span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("sla.warningTime")}</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={slaWarningTime}
                    onChange={(e) => setSlaWarningTime(Number(e.target.value))}
                    className="w-[100px]"
                    disabled={!slaEnabled}
                    data-testid="input-sla-warning-time"
                  />
                  <span className="text-sm text-muted-foreground">{t("sla.minutes")}</span>
                </div>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => slaMutation.mutate()}
                  disabled={slaMutation.isPending}
                  data-testid="button-save-sla"
                >
                  {slaMutation.isPending ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              {t("encryption.title")}
            </CardTitle>
            {encryptionStatus && (
              <Badge variant={encryptionStatus.ok ? "default" : "destructive"} data-testid="badge-encryption-status">
                {encryptionStatus.ok ? (
                  <><CircleCheck className="h-3 w-3 me-1" />{t("encryption.allSecure")}</>
                ) : (
                  <><AlertTriangle className="h-3 w-3 me-1" />{t("encryption.issuesFound")}</>
                )}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("encryption.description")}</p>
            {encStatusLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : encryptionStatus && (
              <div className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap text-sm">
                  <span>{t("encryption.totalFields")}: <strong>{encryptionStatus.totalFields}</strong></span>
                  <span>{t("encryption.encrypted")}: <strong>{encryptionStatus.encryptedFields}</strong></span>
                  {encryptionStatus.plaintextFields > 0 && (
                    <span className="text-destructive">{t("encryption.plaintext")}: <strong>{encryptionStatus.plaintextFields}</strong></span>
                  )}
                </div>
                {encryptionStatus.issues.length > 0 && (
                  <div className="bg-destructive/10 p-3 rounded-md text-sm space-y-1">
                    {encryptionStatus.issues.map((issue, i) => (
                      <div key={i} className="text-destructive">{issue}</div>
                    ))}
                  </div>
                )}
                <Button
                  variant={encryptionStatus.ok ? "outline" : "default"}
                  onClick={() => encryptVerifyMutation.mutate()}
                  disabled={encryptVerifyMutation.isPending}
                  data-testid="button-verify-encryption"
                >
                  {encryptVerifyMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin me-2" />{t("encryption.verifying")}</>
                  ) : (
                    <><Shield className="h-4 w-4 me-2" />{t("encryption.verifyNow")}</>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-channel-dialog-title">
              {editingChannel ? t("channels.editChannel") : t("channels.addChannel")}
            </DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("channels.tenant")}</FormLabel>
                    {isSuperAdmin && filterTenantId === "__all__" && !editingChannel ? (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-channel-tenant">
                            <SelectValue placeholder={t("channels.selectTenant")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {tenants?.map((ten) => (
                            <SelectItem key={ten._id} value={ten._id}>{ten.nameHe || ten.nameEn}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FormControl>
                        <Input
                          value={getTenantName(field.value)}
                          disabled
                          data-testid="input-channel-tenant-readonly"
                        />
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("channels.type")}</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={!!editingChannel}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-channel-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                        <SelectItem value="SMS">SMS</SelectItem>
                        <SelectItem value="EMAIL">Email</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("channels.channelName")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("channels.channelNamePlaceholder")} data-testid="input-channel-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedType === "WHATSAPP" && (
                <>
                  <FormField
                    control={form.control}
                    name="phoneNumberId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number ID</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. 123456789012345" data-testid="input-phone-number-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="wabaId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>WABA ID</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. 123456789012345" data-testid="input-waba-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accessToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Access Token</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} type={showFormTokens.accessToken ? "text" : "password"} placeholder={t("channels.accessTokenPlaceholder")} data-testid="input-access-token" className="pe-10" />
                            <Button type="button" size="icon" variant="ghost" className="absolute end-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => revealFormField("accessToken")} data-testid="button-toggle-access-token">
                              {showFormTokens.accessToken ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="verifyToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verify Token</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} type={showFormTokens.verifyToken ? "text" : "password"} placeholder={t("channels.verifyTokenPlaceholder")} data-testid="input-verify-token" className="pe-10" />
                            <Button type="button" size="icon" variant="ghost" className="absolute end-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => revealFormField("verifyToken")} data-testid="button-toggle-verify-token">
                              {showFormTokens.verifyToken ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="appSecret"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.appSecret")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} type={showFormTokens.appSecret ? "text" : "password"} placeholder={t("channels.appSecretPlaceholder")} data-testid="input-app-secret" className="pe-10" />
                            <Button type="button" size="icon" variant="ghost" className="absolute end-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => revealFormField("appSecret")} data-testid="button-toggle-app-secret">
                              {showFormTokens.appSecret ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                            </Button>
                          </div>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">{t("channels.appSecretHelp")}</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {selectedType === "SMS" && (
                <>
                  <FormField
                    control={form.control}
                    name="smsUserName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.smsUserName")}</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-sms-username" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="smsSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.smsSource")}</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-sms-source" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accessToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.smsAccessToken")}</FormLabel>
                        <FormControl>
                          <Input {...field} type="password" data-testid="input-sms-access-token" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {selectedType === "EMAIL" && (
                <>
                  <FormField
                    control={form.control}
                    name="sendGridKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SendGrid API Key</FormLabel>
                        <FormControl>
                          <Input {...field} type="password" data-testid="input-sendgrid-key" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.fromEmail")}</FormLabel>
                        <FormControl>
                          <Input {...field} type="email" placeholder="noreply@example.com" data-testid="input-from-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("channels.fromName")}</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder={t("channels.fromNamePlaceholder")} data-testid="input-from-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {channelFormTeams.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("channels.teams", "Departments")}</label>
                  <p className="text-xs text-muted-foreground">{t("channels.teamsHelp", "Select departments that will see unassigned conversations on this channel and receive auto-routing.")}</p>
                  <ChannelTeamCheckboxes teams={channelFormTeams} form={form} />
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel-channel">
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isPending} data-testid="button-save-channel">
                  {isPending ? t("common.saving") : editingChannel ? t("common.save") : t("common.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("channels.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("channels.deleteConfirmDescription", { name: channelToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <Dialog open={employeeDialogOpen} onOpenChange={(open) => { if (!open) { setEmployeeDialogOpen(false); setEditingEmployee(null); } else setEmployeeDialogOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("employees.editTitle", "Edit Employee")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("employees.role", "Role")}</label>
              <Select value={empRole} onValueChange={setEmpRole}>
                <SelectTrigger data-testid="select-employee-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">{t("employees.roleEmployee", "Employee")}</SelectItem>
                  <SelectItem value="teamleader">{t("employees.roleTeamLeader", "Team Leader")}</SelectItem>
                  <SelectItem value="businessadmin">{t("employees.roleBusinessAdmin", "Business Admin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {teams && teams.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("employees.teams", "Departments")}</label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded-md p-3">
                  {teams.map((team) => (
                    <div key={team._id} className="flex items-center gap-2">
                      <Checkbox
                        id={`emp-team-${team._id}`}
                        checked={empTeamIds.includes(team._id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setEmpTeamIds((prev) => [...prev, team._id]);
                          } else {
                            setEmpTeamIds((prev) => prev.filter((id) => id !== team._id));
                          }
                        }}
                        data-testid={`checkbox-employee-team-${team._id}`}
                      />
                      <label htmlFor={`emp-team-${team._id}`} className="text-sm flex items-center gap-1.5 cursor-pointer">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                        {team.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEmployeeDialogOpen(false); setEditingEmployee(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!editingEmployee) return;
                updateEmployeeMutation.mutate({ id: editingEmployee._id, role: empRole, teamIds: empTeamIds });
              }}
              disabled={updateEmployeeMutation.isPending}
              data-testid="button-submit-employee"
            >
              {updateEmployeeMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {logsChannel && (
        <ChannelLogsDialog
          open={!!logsChannel}
          onOpenChange={(open) => { if (!open) setLogsChannel(null); }}
          channelId={logsChannel.id}
          channelName={logsChannel.name}
        />
      )}
    </div>
  );
}
