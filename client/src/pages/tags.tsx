import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth-context";
import { useRole } from "@/lib/role-context";
import { useToast } from "@/hooks/use-toast";
import type { Tenant } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tag, Plus, Pencil, Trash2 } from "lucide-react";

interface TagItem {
  _id: string;
  tenantId: string;
  name: string;
  color: string;
  teamId?: string;
  scope: string;
}

interface Team {
  _id: string;
  tenantId: string;
  name: string;
  color: string;
}

export default function TagsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentRole, currentTenantId } = useRole();
  const isSuperAdmin = currentRole === "superadmin";

  const [filterTenantId, setFilterTenantId] = useState<string>(() =>
    currentTenantId ? currentTenantId : "__all__"
  );
  const [filterTeamId, setFilterTeamId] = useState<string>("__all__");
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagItem | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#6B7280");
  const [tagTeamId, setTagTeamId] = useState<string>("");
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperAdmin,
  });

  useEffect(() => {
    if (!isSuperAdmin && currentTenantId) {
      setFilterTenantId(currentTenantId);
    }
  }, [isSuperAdmin, currentTenantId]);

  const activeTenantId = useMemo(() => {
    if (filterTenantId && filterTenantId !== "__all__") return filterTenantId;
    if (!isSuperAdmin && currentTenantId) return currentTenantId;
    if (isSuperAdmin && tenants?.length === 1) return tenants[0]._id;
    return null;
  }, [filterTenantId, isSuperAdmin, currentTenantId, tenants]);

  const teamsUrl = activeTenantId ? `/api/teams?tenantId=${activeTenantId}` : undefined;
  const { data: teams } = useQuery<Team[]>({
    queryKey: [teamsUrl],
    enabled: !!teamsUrl,
  });

  const tagsUrl = activeTenantId ? `/api/tags?tenantId=${activeTenantId}&scope=conversation` : undefined;
  const { data: allTags, isLoading: tagsLoading } = useQuery<TagItem[]>({
    queryKey: [tagsUrl],
    enabled: !!tagsUrl,
  });

  const filteredTags = allTags?.filter(tag => filterTeamId === "__all__" || tag.teamId === filterTeamId) || [];

  const createTagMutation = useMutation({
    mutationFn: (data: { name: string; color: string; teamId?: string }) =>
      apiRequest("POST", `/api/tags?tenantId=${activeTenantId}`, { ...data, tenantId: activeTenantId, scope: "conversation" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tagsUrl] });
      toast({ title: t("tags.created", "Tag created") });
      setTagDialogOpen(false);
      setEditingTag(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const updateTagMutation = useMutation({
    mutationFn: (data: { id: string; name: string; color: string; teamId?: string }) =>
      apiRequest("PATCH", `/api/tags/${data.id}?tenantId=${activeTenantId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tagsUrl] });
      toast({ title: t("tags.updated", "Tag updated") });
      setTagDialogOpen(false);
      setEditingTag(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const deleteTagMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tags/${id}?tenantId=${activeTenantId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tagsUrl] });
      toast({ title: t("tags.deleted", "Tag deleted") });
      setDeleteTagId(null);
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {t("tags.title", "Tags")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("tags.description", "Tags can be assigned to conversations during resolution. Scope tags to teams so agents only see relevant tags.")}
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
          {teams && teams.length > 0 && (
            <Select value={filterTeamId} onValueChange={setFilterTeamId}>
              <SelectTrigger className="w-[160px]" data-testid="select-filter-tag-team">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("tags.allTeams", "All Departments")}</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team._id} value={team._id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activeTenantId && (
            <Button
              size="sm"
              onClick={() => {
                setEditingTag(null);
                setTagName("");
                setTagColor("#6B7280");
                setTagTeamId("");
                setTagDialogOpen(true);
              }}
              data-testid="button-add-tag"
            >
              <Plus className="h-4 w-4 me-1" />
              {t("tags.add", "Add Tag")}
            </Button>
          )}
        </div>
      </div>

      {!activeTenantId ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Tag}
              title={t("tags.selectTenantTitle", "Select a business")}
              description={t("tags.selectTenantDescription", "Choose a business from the filter above to manage its tags")}
            />
          </CardContent>
        </Card>
      ) : tagsLoading ? (
        <Card>
          <CardContent className="p-4">
            <DataTableSkeleton columns={4} />
          </CardContent>
        </Card>
      ) : !filteredTags.length ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Tag}
              title={t("tags.emptyTitle", "No tags yet")}
              description={t("tags.emptyDescription", "Create tags to categorize conversations")}
              actionLabel={t("tags.add", "Add Tag")}
              onAction={() => {
                setEditingTag(null);
                setTagName("");
                setTagColor("#6B7280");
                setTagTeamId("");
                setTagDialogOpen(true);
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
                    <TableHead>{t("tags.nameLabel", "Name")}</TableHead>
                    <TableHead>{t("tags.team", "Department")}</TableHead>
                    <TableHead>{t("tags.color", "Color")}</TableHead>
                    <TableHead className="w-[80px]">{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTags.map((tag) => {
                    const team = teams?.find(t => t._id === tag.teamId);
                    return (
                      <TableRow key={tag._id} data-testid={`row-tag-${tag._id}`}>
                        <TableCell>
                          <Badge variant="outline" style={{ borderColor: tag.color, color: tag.color }}>
                            {tag.name}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {team ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
                              {team.name}
                            </div>
                          ) : (
                            <span className="text-xs">{t("tags.allTeams", "All Departments")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="w-6 h-6 rounded-md" style={{ backgroundColor: tag.color }} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => {
                              setEditingTag(tag);
                              setTagName(tag.name);
                              setTagColor(tag.color);
                              setTagTeamId(tag.teamId || "");
                              setTagDialogOpen(true);
                            }} data-testid={`button-edit-tag-${tag._id}`}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setDeleteTagId(tag._id)} data-testid={`button-delete-tag-${tag._id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={tagDialogOpen} onOpenChange={(open) => { if (!open) { setTagDialogOpen(false); setEditingTag(null); } else setTagDialogOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTag ? t("tags.edit", "Edit Tag") : t("tags.add", "Add Tag")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("tags.nameLabel", "Name")}</label>
              <Input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={t("tags.namePlaceholder", "e.g. Billing, Urgent")}
                data-testid="input-tag-name"
              />
            </div>
            {teams && teams.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("tags.team", "Department")}</label>
                <Select value={tagTeamId} onValueChange={setTagTeamId}>
                  <SelectTrigger data-testid="select-tag-team">
                    <SelectValue placeholder={t("tags.allTeams", "All Departments")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("tags.allTeams", "All Departments")}</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team._id} value={team._id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("tags.color", "Color")}</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={tagColor}
                  onChange={(e) => setTagColor(e.target.value)}
                  className="w-10 h-10 rounded-md border cursor-pointer"
                  data-testid="input-tag-color"
                />
                <Input
                  value={tagColor}
                  onChange={(e) => setTagColor(e.target.value)}
                  className="flex-1"
                  data-testid="input-tag-color-hex"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setTagDialogOpen(false); setEditingTag(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!tagName.trim()) return;
                const teamIdVal = tagTeamId && tagTeamId !== "__none__" ? tagTeamId : undefined;
                if (editingTag) {
                  updateTagMutation.mutate({ id: editingTag._id, name: tagName.trim(), color: tagColor, teamId: teamIdVal });
                } else {
                  createTagMutation.mutate({ name: tagName.trim(), color: tagColor, teamId: teamIdVal });
                }
              }}
              disabled={!tagName.trim() || createTagMutation.isPending || updateTagMutation.isPending}
              data-testid="button-submit-tag"
            >
              {createTagMutation.isPending || updateTagMutation.isPending ? t("common.saving") : editingTag ? t("common.update") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTagId} onOpenChange={(open) => { if (!open) setDeleteTagId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tags.deleteConfirm", "Delete Tag?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tags.deleteDescription", "This action cannot be undone. The tag will be removed from all conversations.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTagId && deleteTagMutation.mutate(deleteTagId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-tag"
            >
              {deleteTagMutation.isPending ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
