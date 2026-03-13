import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AlertTriangle, MessageSquare, Plus, RefreshCw, Send, Trash2, Eye, Search, Pencil, Tags, X, Lock, Copy } from "lucide-react";
import type { WhatsAppTemplate, TemplateVariable } from "@shared/schema";
import { normalizeVariableMapping } from "@shared/schema";
import { useTemplateManager } from "@/hooks/useTemplateManager";
import { TemplateEditor, WhatsAppBubblePreview } from "@/components/whatsapp/TemplateEditor";
import { getStatusBorderColor, getStatusBadgeStyle } from "@/lib/constants/theme";

function extractNamedFields(text: string): string[] {
  const regex = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
  const seen = new Set<string>();
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      result.push(match[1]);
    }
  }
  return result;
}

function renderPreviewText(template: WhatsAppTemplate): string {
  if (template.variables && template.variables.length > 0) {
    let text = template.rawBodyContent || template.bodyText || "";
    for (const v of template.variables) {
      const placeholder = v.hasDefault && v.defaultValue
        ? `[${v.friendlyLabel}: ${v.defaultValue}]`
        : `[${v.friendlyLabel}]`;
      text = text.replace(new RegExp(`\\{\\{${v.fieldName}\\}\\}`, "g"), placeholder);
      text = text.replace(`{{${v.index}}}`, placeholder);
    }
    return text;
  }
  let result = template.bodyText || "";
  const normalized = normalizeVariableMapping(template.variableMapping || {});
  for (const [num, def] of Object.entries(normalized)) {
    result = result.replace(`{{${num}}}`, `[${def.label}]`);
  }
  return result;
}

function renderCreatePreview(rawBody: string, variables: TemplateVariable[]): string {
  let text = rawBody;
  for (const v of variables) {
    const placeholder = v.hasDefault && v.defaultValue
      ? `[${v.friendlyLabel}: ${v.defaultValue}]`
      : `[${v.friendlyLabel}]`;
    text = text.replace(new RegExp(`\\{\\{${v.fieldName}\\}\\}`, "g"), placeholder);
  }
  return text;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "APPROVED") return "default";
  if (status === "REJECTED") return "destructive";
  if (status === "PAUSED") return "outline";
  return "secondary";
}


function ConfigRequiredWarning({ missing }: { missing: string[] }) {
  const { t } = useTranslation();
  return (
    <Card className="border-amber-200 dark:border-amber-800" data-testid="config-required-warning">
      <CardContent className="flex flex-col items-center gap-4 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-lg font-semibold">{t("waTemplates.configRequired")}</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("waTemplates.configRequiredDesc")}
          </p>
          <div className="flex flex-wrap gap-1 justify-center mt-2">
            {missing.map((m) => (
              <Badge key={m} variant="outline">{m}</Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const TAG_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#64748b",
];

export default function WhatsAppTemplatesPage() {
  const mgr = useTemplateManager();
  const { t } = mgr;

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("waTemplates.title")}</h1>
              {mgr.templates && mgr.templates.length > 0 && (
                <Badge variant="secondary" className="text-sm" data-testid="badge-template-count">
                  {mgr.filteredTemplates.length}/{mgr.templates.length}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{t("waTemplates.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {mgr.isSuperAdmin && mgr.tenants && (
              <Select value={mgr.selectedTenantId} onValueChange={mgr.setSelectedTenantId} data-testid="select-tenant">
                <SelectTrigger className="w-52" data-testid="select-tenant-trigger">
                  <SelectValue placeholder={t("waTemplates.selectTenant")} />
                </SelectTrigger>
                <SelectContent>
                  {mgr.tenants.filter((te) => te.active).map((te) => (
                    <SelectItem key={te._id} value={te._id} data-testid={`select-tenant-${te._id}`}>
                      {te.nameEn || te.nameHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {mgr.isConfigured && (
              <>
                <Button
                  variant="outline"
                  onClick={() => mgr.setTagManagerOpen(true)}
                  disabled={!mgr.effectiveTenantId}
                  data-testid="button-manage-tags"
                >
                  <Tags className="h-4 w-4 me-2" />
                  {t("waTemplates.manageTags")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => mgr.syncMutation.mutate()}
                  disabled={mgr.syncMutation.isPending || !mgr.effectiveTenantId}
                  data-testid="button-sync-templates"
                >
                  <RefreshCw className={`h-4 w-4 me-2 ${mgr.syncMutation.isPending ? "animate-spin" : ""}`} />
                  {t("waTemplates.sync")}
                </Button>
                <Button onClick={() => mgr.setCreateDialogOpen(true)} disabled={!mgr.effectiveTenantId} data-testid="button-create-template">
                  <Plus className="h-4 w-4 me-2" />
                  {t("waTemplates.create")}
                </Button>
              </>
            )}
          </div>
        </div>

        {mgr.isConfigured && mgr.templates && mgr.templates.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={mgr.searchQuery}
                onChange={(e) => mgr.setSearchQuery(e.target.value)}
                placeholder={t("waTemplates.searchPlaceholder")}
                className="ps-9"
                dir="auto"
                data-testid="input-search-templates"
              />
            </div>
            {mgr.activeTeams.length > 0 && (
              <Select value={mgr.filterTeamId} onValueChange={mgr.setFilterTeamId}>
                <SelectTrigger className="w-44" data-testid="select-filter-department">
                  <SelectValue placeholder={t("waTemplates.allDepartments")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t("waTemplates.allDepartments")}</SelectItem>
                  {mgr.activeTeams.map((team) => (
                    <SelectItem key={team._id} value={team._id} data-testid={`select-department-${team._id}`}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={mgr.filterCategory} onValueChange={mgr.setFilterCategory}>
              <SelectTrigger className="w-40" data-testid="select-filter-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("waTemplates.allCategories")}</SelectItem>
                <SelectItem value="UTILITY">UTILITY</SelectItem>
                <SelectItem value="MARKETING">MARKETING</SelectItem>
                <SelectItem value="AUTHENTICATION">AUTHENTICATION</SelectItem>
              </SelectContent>
            </Select>
            <Select value={mgr.filterActiveStatus} onValueChange={mgr.setFilterActiveStatus}>
              <SelectTrigger className="w-40" data-testid="select-filter-active">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("waTemplates.allStatuses")}</SelectItem>
                <SelectItem value="ACTIVE">{t("waTemplates.activeOnly")}</SelectItem>
                <SelectItem value="INACTIVE">{t("waTemplates.inactiveOnly")}</SelectItem>
              </SelectContent>
            </Select>
            {mgr.templateTags && mgr.templateTags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {mgr.templateTags.map((tag) => (
                  <Badge
                    key={tag._id}
                    variant={mgr.filterTagIds.includes(tag._id) ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    style={mgr.filterTagIds.includes(tag._id) ? { backgroundColor: tag.color, borderColor: tag.color } : { borderColor: tag.color, color: tag.color }}
                    onClick={() => {
                      mgr.setFilterTagIds((prev) =>
                        prev.includes(tag._id) ? prev.filter((id) => id !== tag._id) : [...prev, tag._id]
                      );
                    }}
                    data-testid={`badge-filter-tag-${tag._id}`}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
            {mgr.activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { mgr.setSearchQuery(""); mgr.setFilterCategory("ALL"); mgr.setFilterTeamId("ALL"); mgr.setFilterActiveStatus("ALL"); mgr.setFilterTagIds([]); }}
                data-testid="button-clear-filters"
              >
                <X className="h-3.5 w-3.5 me-1" />
                {t("waTemplates.clearFilters")}
              </Button>
            )}
          </div>
        )}

        {!mgr.effectiveTenantId ? (
          <EmptyState
            icon={MessageSquare}
            title={t("waTemplates.selectTenantFirst")}
            description={t("waTemplates.selectTenantDesc")}
          />
        ) : mgr.showLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6"><div className="h-32 animate-pulse bg-muted rounded" /></CardContent>
              </Card>
            ))}
          </div>
        ) : !mgr.isConfigured ? (
          <ConfigRequiredWarning missing={mgr.configCheck?.missing || ["wabaId", "accessToken"]} />
        ) : !mgr.templates || mgr.templates.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t("waTemplates.emptyTitle")}
            description={t("waTemplates.emptyDesc")}
            actionLabel={t("waTemplates.create")}
            onAction={() => mgr.setCreateDialogOpen(true)}
          />
        ) : mgr.filteredTemplates.length === 0 ? (
          <EmptyState
            icon={Search}
            title={t("waTemplates.noResults")}
            description={t("waTemplates.noResultsDesc")}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mgr.filteredTemplates.map((tpl) => (
              <Card key={tpl._id} data-testid={`card-template-${tpl._id}`} style={{ borderColor: getStatusBorderColor(tpl.status) }}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base truncate" dir="auto">
                      {tpl.friendlyName || tpl.name}
                    </CardTitle>
                    {tpl.friendlyName && (
                      <p className="text-xs text-muted-foreground font-mono truncate">{tpl.name}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={tpl.status === "APPROVED" || tpl.status === "REJECTED" || tpl.status === "PENDING" ? "outline" : "default"} data-testid={`badge-status-${tpl._id}`} style={getStatusBadgeStyle(tpl.status)}>
                        {t(`waTemplates.status_${tpl.status}`, tpl.status)}
                      </Badge>
                      {tpl.isActive === false && (
                        <Badge variant="destructive" className="text-[10px]" data-testid={`badge-inactive-${tpl._id}`}>
                          {t("waTemplates.inactive")}
                        </Badge>
                      )}
                      <Badge variant="outline">{tpl.category}</Badge>
                      <Badge variant="outline">{tpl.language}</Badge>
                    </div>
                    {tpl.createdAt && (
                      <p className="text-[11px] text-muted-foreground" data-testid={`text-created-${tpl._id}`}>
                        {new Date(tpl.createdAt).toLocaleDateString("he-IL")}
                      </p>
                    )}
                    {tpl.status === "REJECTED" && tpl.rejectedReason && (
                      <p className="text-xs text-destructive mt-1" data-testid={`text-rejected-reason-${tpl._id}`}>
                        <AlertTriangle className="h-3 w-3 inline me-1" />
                        {tpl.rejectedReason}
                      </p>
                    )}
                    {tpl.tags && tpl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tpl.tags.map((tag) => (
                          <Badge
                            key={tag._id}
                            variant="secondary"
                            className="text-xs"
                            style={{ backgroundColor: tag.color + "20", color: tag.color, borderColor: tag.color }}
                            data-testid={`badge-tag-${tag._id}`}
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {tpl.teamId && mgr.teamLookup.has(tpl.teamId) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{ backgroundColor: mgr.teamLookup.get(tpl.teamId)!.color + "20", color: mgr.teamLookup.get(tpl.teamId)!.color, borderColor: mgr.teamLookup.get(tpl.teamId)!.color }}
                          data-testid={`badge-department-${tpl._id}`}
                        >
                          {mgr.teamLookup.get(tpl.teamId)!.name}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => tpl.metaTemplateId ? mgr.openMetadataDialog(tpl) : mgr.editTemplate(tpl)}
                          data-testid={`button-edit-meta-${tpl._id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{tpl.metaTemplateId ? t("waTemplates.editMetadata") : t("waTemplates.editTemplate")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => mgr.setPreviewTemplate(tpl)}
                          data-testid={`button-preview-${tpl._id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("waTemplates.preview")}</TooltipContent>
                    </Tooltip>
                    {tpl.status !== "APPROVED" && !tpl.metaTemplateId && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => mgr.submitMutation.mutate(tpl._id)}
                            disabled={mgr.submitMutation.isPending}
                            data-testid={`button-submit-${tpl._id}`}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("waTemplates.submitToMeta")}</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => mgr.duplicateTemplate(tpl)}
                          data-testid={`button-duplicate-${tpl._id}`}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("waTemplates.duplicate")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => mgr.deleteMutation.mutate(tpl._id)}
                          disabled={mgr.deleteMutation.isPending}
                          data-testid={`button-delete-${tpl._id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("common.delete")}</TooltipContent>
                    </Tooltip>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4" dir="auto">
                    {tpl.bodyText || tpl.components?.[0]?.text || "\u2014"}
                  </p>
                  {tpl.metaTemplateId && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Lock className="h-3 w-3 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">Meta ID: {tpl.metaTemplateId}</p>
                    </div>
                  )}
                  {tpl.lastSynced && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("waTemplates.lastSynced")}: {new Date(tpl.lastSynced).toLocaleString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <TemplateEditor
          open={mgr.createDialogOpen}
          editingTemplateId={mgr.editingTemplateId}
          createStep={mgr.createStep}
          setCreateStep={mgr.setCreateStep}
          form={mgr.form}
          setForm={mgr.setForm}
          bodyTextareaRef={mgr.bodyTextareaRef}
          previewText={mgr.previewText}
          activeTeams={mgr.activeTeams}
          step1Valid={mgr.step1Valid}
          qrCount={mgr.qrCount}
          ctaCount={mgr.ctaCount}
          hasMixedButtons={mgr.hasMixedButtons}
          canAddQR={mgr.canAddQR}
          canAddCTA={mgr.canAddCTA}
          fieldNamesValid={mgr.fieldNamesValid}
          fieldNamesUnique={mgr.fieldNamesUnique}
          createMutationPending={mgr.createMutation.isPending}
          updateMutationPending={mgr.updateMutation.isPending}
          onClose={mgr.closeCreateDialog}
          onSubmit={mgr.onSubmitCreate}
          addVariable={mgr.addVariable}
          removeVariable={mgr.removeVariable}
          updateVariable={mgr.updateVariable}
          addButton={mgr.addButton}
          removeButton={mgr.removeButton}
          updateButton={mgr.updateButton}
          insertFieldAtCursor={mgr.insertFieldAtCursor}
        />

        {/* Preview Dialog */}
        <Dialog open={!!mgr.previewTemplate} onOpenChange={(open) => { if (!open) mgr.setPreviewTemplate(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle dir="auto">{mgr.previewTemplate?.friendlyName || mgr.previewTemplate?.name}</DialogTitle>
              <DialogDescription>
                {mgr.previewTemplate?.friendlyName && (
                  <span className="font-mono text-xs me-2">{mgr.previewTemplate?.name}</span>
                )}
                {mgr.previewTemplate?.category} / {mgr.previewTemplate?.language}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Badge variant={statusBadgeVariant(mgr.previewTemplate?.status || "PENDING")}>
                  {mgr.previewTemplate?.status}
                </Badge>
                {mgr.previewTemplate?.metaTemplateId && (
                  <Badge variant="outline">Meta: {mgr.previewTemplate.metaTemplateId}</Badge>
                )}
              </div>
              {mgr.previewTemplate?.metaTemplateId && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <Lock className="h-3.5 w-3.5" />
                  {t("waTemplates.immutableWarning")}
                </div>
              )}
              <div className="rounded-lg p-4 wa-preview-bg">
                <WhatsAppBubblePreview
                  text={mgr.previewTemplate ? renderPreviewText(mgr.previewTemplate) : ""}
                />
              </div>
              {mgr.previewTemplate?.variables && mgr.previewTemplate.variables.length > 0 ? (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("waTemplates.fieldConfiguration")}</Label>
                  {mgr.previewTemplate.variables.map((v: TemplateVariable) => (
                    <div key={v.index} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="shrink-0 font-mono">{`{{${v.fieldName}}}`}</Badge>
                      <span className="font-medium">{v.friendlyLabel}</span>
                      <Badge variant="secondary" className="text-xs">{v.fieldType}</Badge>
                      {v.hasDefault && v.defaultValue && (
                        <span className="text-muted-foreground text-xs">= {v.defaultValue}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : mgr.previewTemplate?.variableMapping && Object.keys(mgr.previewTemplate.variableMapping).length > 0 && (() => {
                const normalized = normalizeVariableMapping(mgr.previewTemplate.variableMapping);
                return (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("waTemplates.variableMapping")}</Label>
                    {Object.entries(normalized).map(([key, def]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="shrink-0">{`{{${key}}}`}</Badge>
                        <span className="font-medium">{def.label}</span>
                        <span className="text-muted-foreground text-xs">
                          ({def.source === "manual" ? t("waTemplates.sourceManual") : def.source})
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Metadata Dialog */}
        <Dialog open={!!mgr.metaDialogTemplate} onOpenChange={(open) => { if (!open) mgr.setMetaDialogTemplate(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("waTemplates.editMetadata")}</DialogTitle>
              <DialogDescription>
                {t("waTemplates.editMetadataDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{t("waTemplates.friendlyName")}</Label>
                <Input
                  value={mgr.metaFriendlyName}
                  onChange={(e) => mgr.setMetaFriendlyName(e.target.value)}
                  placeholder={t("waTemplates.friendlyNamePlaceholder")}
                  dir="auto"
                  data-testid="input-meta-friendly-name"
                />
              </div>
              {mgr.templateTags && mgr.templateTags.length > 0 && (
                <div>
                  <Label>{t("waTemplates.tags")}</Label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {mgr.templateTags.map((tag) => (
                      <Badge
                        key={tag._id}
                        variant={mgr.metaTagIds.includes(tag._id) ? "default" : "outline"}
                        className="cursor-pointer select-none"
                        style={mgr.metaTagIds.includes(tag._id)
                          ? { backgroundColor: tag.color, borderColor: tag.color }
                          : { borderColor: tag.color, color: tag.color }}
                        onClick={() => {
                          mgr.setMetaTagIds((prev) =>
                            prev.includes(tag._id) ? prev.filter((id) => id !== tag._id) : [...prev, tag._id]
                          );
                        }}
                        data-testid={`badge-meta-tag-${tag._id}`}
                      >
                        {tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => mgr.setMetaDialogTemplate(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (!mgr.metaDialogTemplate) return;
                  mgr.metadataMutation.mutate({
                    id: mgr.metaDialogTemplate._id,
                    friendlyName: mgr.metaFriendlyName,
                    tagIds: mgr.metaTagIds,
                  });
                }}
                disabled={mgr.metadataMutation.isPending}
                data-testid="button-save-metadata"
              >
                {mgr.metadataMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Tag Manager Dialog */}
        <Dialog open={mgr.tagManagerOpen} onOpenChange={mgr.setTagManagerOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("waTemplates.manageTags")}</DialogTitle>
              <DialogDescription>{t("waTemplates.manageTagsDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={mgr.newTagName}
                  onChange={(e) => mgr.setNewTagName(e.target.value)}
                  placeholder={t("waTemplates.newTagName")}
                  className="flex-1"
                  dir="auto"
                  data-testid="input-new-tag-name"
                />
                <div className="flex items-center gap-1">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`w-5 h-5 rounded-full border-2 transition-transform ${mgr.newTagColor === c ? "scale-125 border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                      onClick={() => mgr.setNewTagColor(c)}
                      data-testid={`button-color-${c.replace("#", "")}`}
                    />
                  ))}
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!mgr.newTagName.trim()) return;
                    mgr.createTagMutation.mutate({ name: mgr.newTagName.trim(), color: mgr.newTagColor });
                  }}
                  disabled={mgr.createTagMutation.isPending || !mgr.newTagName.trim()}
                  data-testid="button-add-tag"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {mgr.templateTags && mgr.templateTags.length > 0 ? (
                <div className="space-y-2">
                  {mgr.templateTags.map((tag) => (
                    <div key={tag._id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                        <span className="text-sm" dir="auto">{tag.name}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => mgr.deleteTagMutation.mutate(tag._id)}
                        disabled={mgr.deleteTagMutation.isPending}
                        data-testid={`button-delete-tag-${tag._id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t("waTemplates.noTags")}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
