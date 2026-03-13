import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Users, Plus, Pencil, ToggleLeft, ToggleRight, X, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { insertUserSchema, userRoles, type User, type InsertUser, type Tenant } from "@shared/schema";
import { useRole } from "@/lib/role-context";
import { z } from "zod";

interface Team {
  _id: string;
  tenantId: string;
  name: string;
  color: string;
}

export default function UsersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { currentRole, currentTenantId } = useRole();
  const isSuperAdmin = currentRole === "superadmin";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [filterTenantId, setFilterTenantId] = useState<string>(() =>
    currentTenantId ? currentTenantId : "__all__"
  );
  const [filterStatus, setFilterStatus] = useState<string>("active");

  useEffect(() => {
    if (currentTenantId) {
      setFilterTenantId(currentTenantId);
    } else {
      setFilterTenantId("__all__");
    }
  }, [currentRole, currentTenantId]);

  const formSchema = insertUserSchema.extend({
    name: z.string().min(1, t("users.validation.nameRequired")),
    phone: z.string().min(9, t("users.validation.phoneInvalid")),
    email: z.string().email(t("users.validation.emailInvalid")),
    tenantId: z.string().optional().default(""),
  }).refine((data) => {
    if (data.role !== "superadmin" && (!data.tenantId || data.tenantId.length === 0)) return false;
    return true;
  }, { message: t("users.validation.selectBusiness"), path: ["tenantId"] });

  const { data: allUsers, isLoading } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });
  const teamsUrl = filterTenantId && filterTenantId !== "__all__" ? `/api/teams?tenantId=${filterTenantId}` : "/api/teams";
  const { data: allTeams } = useQuery<Team[]>({
    queryKey: [teamsUrl],
  });
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedBusyReasons, setSelectedBusyReasons] = useState<string[]>([]);

  const users = useMemo(() => {
    if (!allUsers) return undefined;
    let filtered = allUsers;
    if (filterTenantId !== "__all__") {
      filtered = filtered.filter(u => u.tenantId === filterTenantId);
    }
    if (filterStatus === "active") {
      filtered = filtered.filter(u => u.active !== false);
    } else if (filterStatus === "inactive") {
      filtered = filtered.filter(u => u.active === false);
    }
    return filtered;
  }, [allUsers, filterTenantId, filterStatus]);

  const form = useForm<InsertUser>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", phone: "", email: "", role: "employee", tenantId: "", active: true, acwTimeLimit: 3 },
  });

  const watchedRole = form.watch("role");
  const watchedFormTenantId = form.watch("tenantId");

  const { data: tenantBusyReasons } = useQuery<string[]>({
    queryKey: ["/api/tenants", watchedFormTenantId, "busy-reasons"],
    queryFn: async () => {
      const tid = watchedFormTenantId;
      if (!tid) return [];
      const res = await apiRequest("GET", `/api/tenants/${tid}/busy-reasons`);
      return res.json();
    },
    enabled: !!watchedFormTenantId,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertUser) => apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      toast({ title: t("users.createdSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertUser & { _id: string }) =>
      apiRequest("PATCH", `/api/users/${data._id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/busy-reasons"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      toast({ title: t("users.updatedSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user: User) => apiRequest("PATCH", `/api/users/${user._id}`, { active: !user.active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingUser(null);
    setSelectedTeamIds([]);
    setSelectedBusyReasons([]);
    form.reset({ name: "", phone: "", email: "", role: "employee", tenantId: "", active: true, teamIds: [], acwTimeLimit: 3, allowedBusyReasons: [] });
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setSelectedTeamIds(user.teamIds || []);
    setSelectedBusyReasons(user.allowedBusyReasons || []);
    form.reset({
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      active: user.active,
      teamIds: user.teamIds || [],
      acwTimeLimit: user.acwTimeLimit ?? 3,
      allowedBusyReasons: user.allowedBusyReasons || [],
    });
    setDialogOpen(true);
  }

  function onSubmit(values: InsertUser) {
    const payload = { ...values, teamIds: selectedTeamIds, allowedBusyReasons: selectedBusyReasons };
    if (editingUser) {
      updateMutation.mutate({ ...payload, _id: editingUser._id });
    } else {
      createMutation.mutate(payload);
    }
  }

  const watchedTenantId = form.watch("tenantId");
  const teamsForTenant = useMemo(() => {
    if (!allTeams || !watchedTenantId) return [];
    return allTeams.filter(t => t.tenantId === watchedTenantId);
  }, [allTeams, watchedTenantId]);

  function getTenantName(tenantId: string) {
    const tenant = tenants?.find((t) => t._id === tenantId);
    return tenant?.nameHe || tenantId;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("users.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("users.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterTenantId} onValueChange={setFilterTenantId} disabled={!isSuperAdmin}>
            <SelectTrigger className="w-[200px] border-primary border-2" data-testid="select-filter-tenant">
              <SelectValue placeholder={t("dashboard.filterByTenant")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("dashboard.allTenants")}</SelectItem>
              {tenants?.map((tenant) => (
                <SelectItem key={tenant._id} value={tenant._id}>{tenant.nameHe}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[120px]" data-testid="select-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("users.allStatuses")}</SelectItem>
              <SelectItem value="active">{t("common.active")}</SelectItem>
              <SelectItem value="inactive">{t("common.inactive")}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => { const defaultTenant = filterTenantId !== "__all__" ? filterTenantId : (currentTenantId || ""); form.reset({ name: "", phone: "", email: "", role: "employee", tenantId: defaultTenant, active: true, acwTimeLimit: 3, allowedBusyReasons: [] }); setSelectedTeamIds([]); setSelectedBusyReasons([]); setDialogOpen(true); }} data-testid="button-add-user">
            <Plus className="h-4 w-4 me-2" />
            {t("users.addNew")}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton columns={8} />
            </div>
          ) : !users || users.length === 0 ? (
            <EmptyState
              icon={Users}
              title={t("users.emptyTitle")}
              description={t("users.emptyDescription")}
              actionLabel={t("users.emptyAction")}
              onAction={() => setDialogOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("users.name")}</TableHead>
                  <TableHead>{t("users.phone")}</TableHead>
                  <TableHead>{t("users.email")}</TableHead>
                  <TableHead>{t("users.role")}</TableHead>
                  <TableHead>{t("users.business")}</TableHead>
                  <TableHead>{t("teams.title", "Departments")}</TableHead>
                  <TableHead>ACW</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user._id} data-testid={`row-user-${user._id}`}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell dir="ltr" className="font-mono">{user.phone}</TableCell>
                    <TableCell dir="ltr">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(`users.roles.${user.role}`)}</Badge>
                    </TableCell>
                    <TableCell>{getTenantName(user.tenantId)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(user.teamIds || []).map((tid) => {
                          const team = allTeams?.find(t => t._id === tid);
                          return team ? (
                            <Badge key={tid} variant="outline" className="text-[10px] px-1 py-0" style={{ borderColor: team.color, color: team.color }}>
                              {team.name}
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-acw-${user._id}`}>
                      {user.acwTimeLimit ?? 3}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => toggleActiveMutation.mutate(user)}
                        data-testid={`button-toggle-active-${user._id}`}
                      >
                        {user.active !== false ? (
                          <ToggleRight className="h-5 w-5 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => openEdit(user)} data-testid={`button-edit-user-${user._id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingUser ? t("users.editTitle") : t("users.newTitle")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 overflow-y-auto flex-1 px-1">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.role")}</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); if (val === "superadmin") { form.setValue("tenantId", ""); } }} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-user-role">
                          <SelectValue placeholder={t("users.selectRole")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(isSuperAdmin ? userRoles : userRoles.filter(r => r !== "superadmin")).map((role) => (
                          <SelectItem key={role} value={role}>
                            {t(`users.roles.${role}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={watchedRole === "superadmin"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-user-tenant">
                          <SelectValue placeholder={watchedRole === "superadmin" ? t("users.allCompanies") : t("tenants.selectPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {tenants?.map((tenant) => (
                          <SelectItem key={tenant._id} value={tenant._id}>
                            {tenant.nameHe}
                          </SelectItem>
                        ))}
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
                    <FormLabel>{t("users.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("users.placeholderName")} data-testid="input-user-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.phone")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("users.placeholderPhone")} dir="ltr" data-testid="input-user-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.email")}</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder={t("users.placeholderEmail")} dir="ltr" data-testid="input-user-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="acwTimeLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("users.acwTimeLimit.label", "ACW Time Limit (minutes)")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        {...field}
                        value={field.value ?? 3}
                        onChange={(e) => field.onChange(e.target.value === "" ? 3 : Number(e.target.value))}
                        disabled={currentRole === "employee"}
                        data-testid="input-user-acw-time-limit"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">{t("users.acwTimeLimit.helperText", "Determines the maximum allowed wrap-up time for this agent. Default is 3.")}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {watchedRole !== "superadmin" && teamsForTenant.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("teams.title", "Departments")}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {teamsForTenant.map((team) => {
                      const isSelected = selectedTeamIds.includes(team._id);
                      return (
                        <Badge
                          key={team._id}
                          variant={isSelected ? "default" : "outline"}
                          className="cursor-pointer select-none toggle-elevate"
                          style={isSelected ? { backgroundColor: team.color, borderColor: team.color } : { borderColor: team.color, color: team.color }}
                          onClick={() => {
                            setSelectedTeamIds(prev =>
                              isSelected ? prev.filter(id => id !== team._id) : [...prev, team._id]
                            );
                          }}
                          data-testid={`badge-team-${team._id}`}
                        >
                          {team.name}
                          {isSelected && <Check className="h-3 w-3 ms-1" />}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
              {watchedRole !== "superadmin" && (tenantBusyReasons || []).length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("users.busyReasons.label", "Busy Reasons")}</label>
                  <p className="text-xs text-muted-foreground">{t("users.busyReasons.helperText", "Select which busy reasons this employee can use. If none selected, all reasons will be available.")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(tenantBusyReasons || []).map((reason) => {
                      const isSelected = selectedBusyReasons.includes(reason);
                      return (
                        <Badge
                          key={reason}
                          variant={isSelected ? "default" : "outline"}
                          className={`cursor-pointer select-none toggle-elevate border-2 ${isSelected ? "border-green-400 bg-green-600 text-white" : "border-gray-300 dark:border-gray-600"}`}
                          onClick={() => {
                            setSelectedBusyReasons(prev =>
                              isSelected ? prev.filter(r => r !== reason) : [...prev, reason]
                            );
                          }}
                          data-testid={`badge-busy-reason-${reason}`}
                        >
                          {reason}
                          {isSelected && <Check className="h-3 w-3 ms-1" />}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-user">
                  {createMutation.isPending || updateMutation.isPending ? t("common.saving") : editingUser ? t("common.update") : t("common.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
