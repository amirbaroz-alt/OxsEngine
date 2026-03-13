import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { useToast } from "@/hooks/use-toast";
import type { Tenant } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { UsersRound, Plus, Pencil, Trash2, Shield } from "lucide-react";

interface Team {
  _id: string;
  tenantId: string;
  name: string;
  description?: string;
  color: string;
  managerId?: string;
  managerIds?: string[];
}

export default function DepartmentsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentRole, currentTenantId } = useRole();
  const isSuperAdmin = currentRole === "superadmin";

  const [filterTenantId, setFilterTenantId] = useState<string>(() =>
    currentTenantId ? currentTenantId : "__all__"
  );

  useEffect(() => {
    if (currentTenantId) {
      setFilterTenantId(currentTenantId);
    } else {
      setFilterTenantId("__all__");
    }
  }, [currentRole, currentTenantId]);

  const activeTenantId = isSuperAdmin
    ? (filterTenantId !== "__all__" ? filterTenantId : undefined)
    : (currentTenantId || user?.tenantId);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamColor, setTeamColor] = useState("#6B7280");
  const [teamManagerIds, setTeamManagerIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [deleteTeamId, setDeleteTeamId] = useState<string | null>(null);

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperAdmin,
  });

  const teamsUrl = activeTenantId ? `/api/teams?tenantId=${activeTenantId}` : undefined;
  const { data: teams, isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: [teamsUrl],
    enabled: !!teamsUrl,
  });

  const usersUrl = activeTenantId ? `/api/users?tenantId=${activeTenantId}` : undefined;
  const { data: tenantUsers } = useQuery<any[]>({
    queryKey: [usersUrl],
    enabled: !!usersUrl,
  });

  async function syncMemberships(teamId: string, newMemberIds: string[]) {
    if (!tenantUsers) return;
    const currentMembers = tenantUsers.filter((u: any) => (u.teamIds || []).includes(teamId));
    const currentMemberIds = currentMembers.map((u: any) => u._id);
    const toAdd = newMemberIds.filter(id => !currentMemberIds.includes(id));
    const toRemove = currentMemberIds.filter((id: string) => !newMemberIds.includes(id));
    const updates = [
      ...toAdd.map((uid) => {
        const user = tenantUsers.find((u: any) => u._id === uid);
        const existingTeamIds = user?.teamIds || [];
        return apiRequest("PATCH", `/api/users/${uid}`, { teamIds: [...existingTeamIds, teamId] });
      }),
      ...toRemove.map((uid: string) => {
        const user = tenantUsers.find((u: any) => u._id === uid);
        const existingTeamIds = user?.teamIds || [];
        return apiRequest("PATCH", `/api/users/${uid}`, { teamIds: existingTeamIds.filter((t: string) => t !== teamId) });
      }),
    ];
    await Promise.all(updates);
  }

  const createTeamMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; color: string; managerIds?: string[]; memberIds: string[] }) => {
      const { memberIds, ...teamData } = data;
      const res = await apiRequest("POST", `/api/teams?tenantId=${activeTenantId}`, { ...teamData, tenantId: activeTenantId });
      const created = await res.json();
      if (created._id && memberIds.length > 0) {
        await syncMemberships(created._id, memberIds);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [teamsUrl] });
      queryClient.invalidateQueries({ queryKey: [usersUrl] });
      toast({ title: t("teams.created", "Department created") });
      setTeamDialogOpen(false);
      setEditingTeam(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const updateTeamMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description?: string; color: string; managerIds?: string[]; memberIds: string[] }) => {
      const { memberIds, ...teamData } = data;
      await apiRequest("PATCH", `/api/teams/${data.id}?tenantId=${activeTenantId}`, teamData);
      await syncMemberships(data.id, memberIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [teamsUrl] });
      queryClient.invalidateQueries({ queryKey: [usersUrl] });
      toast({ title: t("teams.updated", "Department updated") });
      setTeamDialogOpen(false);
      setEditingTeam(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const deleteTeamMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/teams/${id}?tenantId=${activeTenantId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [teamsUrl] });
      toast({ title: t("teams.deleted", "Department deleted") });
      setDeleteTeamId(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {t("teams.title", "Departments")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("teams.pageSubtitle", "Organize agents into departments and assign department leaders")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && (
            <Select value={filterTenantId} onValueChange={setFilterTenantId}>
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
          )}
          {activeTenantId && (
            <Button
              size="sm"
              onClick={() => {
                setEditingTeam(null);
                setTeamName("");
                setTeamDescription("");
                setTeamColor("#6B7280");
                setTeamManagerIds([]);
                setSelectedMemberIds([]);
                setTeamDialogOpen(true);
              }}
              data-testid="button-add-team"
            >
              <Plus className="h-4 w-4 me-1" />
              {t("teams.add", "Add Department")}
            </Button>
          )}
        </div>
      </div>

      {!activeTenantId ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={UsersRound}
              title={t("teams.selectTenantTitle", "Select a business")}
              description={t("teams.selectTenantDescription", "Choose a business from the filter above to manage its departments")}
            />
          </CardContent>
        </Card>
      ) : teamsLoading ? (
        <Card>
          <CardContent className="p-4">
            <DataTableSkeleton columns={6} />
          </CardContent>
        </Card>
      ) : !teams?.length ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={UsersRound}
              title={t("teams.emptyTitle", "No departments yet")}
              description={t("teams.emptyDescription", "Create departments to organize agents, assign department leaders, and scope channels")}
              actionLabel={t("teams.add", "Add Department")}
              onAction={() => {
                setEditingTeam(null);
                setTeamName("");
                setTeamDescription("");
                setTeamColor("#6B7280");
                setTeamManagerIds([]);
                setSelectedMemberIds([]);
                setTeamDialogOpen(true);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("teams.name", "Name")}</TableHead>
                    <TableHead>{t("teams.descriptionLabel", "Description")}</TableHead>
                    <TableHead>{t("teams.teamLeaders", "Department Leaders")}</TableHead>
                    <TableHead>{t("teams.members", "Members")}</TableHead>
                    <TableHead>{t("teams.color", "Color")}</TableHead>
                    <TableHead className="w-[80px]">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams.map((team) => (
                    <TableRow key={team._id} data-testid={`row-team-${team._id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                          {team.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{team.description || "-"}</TableCell>
                      <TableCell data-testid={`text-team-leaders-${team._id}`}>
                        <div className="flex flex-wrap gap-1">
                          {(team.managerIds || []).length > 0 ? (team.managerIds || []).map((mid: string) => {
                            const mgr = tenantUsers?.find((u: any) => u._id === mid);
                            return mgr ? (
                              <Badge key={mid} variant="secondary" className="text-xs">
                                <Shield className="h-3 w-3 me-1" />
                                {mgr.name || mgr.email}
                              </Badge>
                            ) : null;
                          }) : <span className="text-xs text-muted-foreground">--</span>}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-team-members-${team._id}`}>
                        {(() => {
                          const memberCount = (tenantUsers || []).filter((u: any) => (u.teamIds || []).includes(team._id)).length;
                          return <span className="text-sm">{memberCount}</span>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="w-6 h-6 rounded-md" style={{ backgroundColor: team.color }} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" onClick={() => {
                            setEditingTeam(team);
                            setTeamName(team.name);
                            setTeamDescription(team.description || "");
                            setTeamColor(team.color);
                            setTeamManagerIds(team.managerIds || []);
                            const members = (tenantUsers || []).filter((u: any) => (u.teamIds || []).includes(team._id)).map((u: any) => u._id);
                            setSelectedMemberIds(members);
                            setTeamDialogOpen(true);
                          }} data-testid={`button-edit-team-${team._id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteTeamId(team._id)} data-testid={`button-delete-team-${team._id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={teamDialogOpen} onOpenChange={(open) => { if (!open) { setTeamDialogOpen(false); setEditingTeam(null); } else setTeamDialogOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTeam ? t("teams.edit", "Edit Department") : t("teams.add", "Add Department")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("teams.name", "Name")}</label>
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={t("teams.namePlaceholder", "e.g. Sales, Support")}
                data-testid="input-team-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("teams.descriptionLabel", "Description")}</label>
              <Input
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
                placeholder={t("teams.descriptionPlaceholder", "Optional description")}
                data-testid="input-team-description"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("teams.color", "Color")}</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={teamColor}
                  onChange={(e) => setTeamColor(e.target.value)}
                  className="w-10 h-10 rounded-md border cursor-pointer"
                  data-testid="input-team-color"
                />
                <Input
                  value={teamColor}
                  onChange={(e) => setTeamColor(e.target.value)}
                  className="flex-1"
                  data-testid="input-team-color-hex"
                />
              </div>
            </div>
            {tenantUsers && tenantUsers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("teams.teamLeaders", "Department Leaders")}</label>
                <p className="text-xs text-muted-foreground">{t("teams.teamLeadersHelp", "Department leaders can see all conversations of the department's channels, including those assigned to other agents.")}</p>
                <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-[150px] overflow-y-auto">
                  {tenantUsers.map((u: any) => {
                    const isSelected = teamManagerIds.includes(u._id);
                    return (
                      <Badge
                        key={u._id}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        onClick={() => {
                          setTeamManagerIds(prev => isSelected ? prev.filter(id => id !== u._id) : [...prev, u._id]);
                        }}
                        data-testid={`badge-team-leader-${u._id}`}
                      >
                        <Shield className="h-3 w-3 me-1" />
                        {u.name || u.fullName || u.email}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
            {tenantUsers && tenantUsers.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("teams.assignMembers", "Assign Members")}</label>
                <p className="text-xs text-muted-foreground">{t("teams.assignMembersHelp", "Select employees that belong to this department")}</p>
                <div className="flex flex-wrap gap-2 p-2 border rounded-md max-h-[150px] overflow-y-auto">
                  {tenantUsers.map((u: any) => {
                    const isSelected = selectedMemberIds.includes(u._id);
                    return (
                      <Badge
                        key={u._id}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        onClick={() => {
                          setSelectedMemberIds(prev => isSelected ? prev.filter(id => id !== u._id) : [...prev, u._id]);
                        }}
                        data-testid={`badge-member-${u._id}`}
                      >
                        {u.name || u.fullName || u.email}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setTeamDialogOpen(false); setEditingTeam(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!teamName.trim()) return;
                if (editingTeam) {
                  updateTeamMutation.mutate({ id: editingTeam._id, name: teamName.trim(), description: teamDescription.trim() || undefined, color: teamColor, managerIds: teamManagerIds, memberIds: selectedMemberIds });
                } else {
                  createTeamMutation.mutate({ name: teamName.trim(), description: teamDescription.trim() || undefined, color: teamColor, managerIds: teamManagerIds, memberIds: selectedMemberIds });
                }
              }}
              disabled={!teamName.trim() || createTeamMutation.isPending || updateTeamMutation.isPending}
              data-testid="button-submit-team"
            >
              {createTeamMutation.isPending || updateTeamMutation.isPending ? t("common.saving") : editingTeam ? t("common.update") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTeamId} onOpenChange={(open) => { if (!open) setDeleteTeamId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("teams.deleteConfirm", "Delete Department?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("teams.deleteDescription", "This action cannot be undone. Users assigned to this department will be unassigned.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTeamId && deleteTeamMutation.mutate(deleteTeamId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-team"
            >
              {deleteTeamMutation.isPending ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
