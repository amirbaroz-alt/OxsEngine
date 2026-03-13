import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, Pencil, Trash2 } from "lucide-react";
import { useRole } from "@/lib/role-context";
import type { SmsTemplate, Tenant } from "@shared/schema";

export default function SmsTemplatesPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { currentRole, currentTenantId } = useRole();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [form, setForm] = useState({ templateType: "", name: "", content: "", tenantId: "" });
  const [selectedTenantId, setSelectedTenantId] = useState<string>("all");

  const isHebrew = i18n.language === "he";

  const effectiveTenantId = currentRole !== "superadmin" && currentTenantId
    ? currentTenantId
    : selectedTenantId !== "all" ? selectedTenantId : undefined;

  const tenantParam = effectiveTenantId ? `?tenantId=${effectiveTenantId}` : "";

  const smsTemplatesUrl = `/api/sms-templates${tenantParam}`;
  const { data: templates, isLoading } = useQuery<SmsTemplate[]>({
    queryKey: [smsTemplatesUrl],
  });

  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });

  const getTenantName = (tenant: Tenant) => {
    return isHebrew ? tenant.nameHe : (tenant.nameEn || tenant.nameHe);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/sms-templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/sms-templates") });
      toast({ title: t("smsTemplates.createdSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/sms-templates/${data._id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/sms-templates") });
      toast({ title: t("smsTemplates.updatedSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/sms-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/sms-templates") });
      toast({ title: t("smsTemplates.deletedSuccess") });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setForm({ templateType: "", name: "", content: "", tenantId: "" });
  }

  function openEdit(template: SmsTemplate) {
    setEditing(template);
    setForm({
      templateType: template.templateType,
      name: template.name,
      content: template.content,
      tenantId: template.tenantId || "",
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setForm({
      templateType: "",
      name: "",
      content: "",
      tenantId: effectiveTenantId || "",
    });
    setDialogOpen(true);
  }

  function onSubmit() {
    const payload = { ...form, tenantId: form.tenantId || undefined };
    if (editing) {
      updateMutation.mutate({ ...payload, _id: editing._id });
    } else {
      createMutation.mutate(payload);
    }
  }

  const placeholders = ["[customerName]", "[amount]", "[currency]", "[bankName]", "[branchNumber]", "[accountNumber]", "[accountHolderName]"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("smsTemplates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("smsTemplates.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {currentRole === "superadmin" && (
            <Select
              value={selectedTenantId}
              onValueChange={setSelectedTenantId}
            >
              <SelectTrigger className="w-[250px]" data-testid="select-trigger-tenant-filter">
                <SelectValue placeholder={t("dashboard.filterByTenant")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-item-all-tenants">
                  {t("dashboard.allTenants")}
                </SelectItem>
                {tenants?.map((tenant) => (
                  <SelectItem
                    key={tenant._id}
                    value={tenant._id}
                    data-testid={`select-item-tenant-${tenant._id}`}
                  >
                    {getTenantName(tenant)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {currentRole !== "superadmin" && currentTenantId && (
            <Badge variant="outline" data-testid="badge-locked-tenant">
              {tenants?.find(t => t._id === currentTenantId)
                ? getTenantName(tenants.find(t => t._id === currentTenantId)!)
                : currentTenantId}
            </Badge>
          )}
          <Button onClick={openCreate} data-testid="button-add-template">
            <Plus className="h-4 w-4 me-2" />
            {t("smsTemplates.addNew")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-24 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !templates || templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("smsTemplates.emptyTitle")}
          description={t("smsTemplates.emptyDescription")}
          actionLabel={t("smsTemplates.addNew")}
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template._id} data-testid={`card-template-${template._id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="secondary">{template.templateType}</Badge>
                  {template.tenantId && <Badge variant="outline" className="ms-1">{t("smsTemplates.tenantOverride")}</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(template)} data-testid={`button-edit-template-${template._id}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(template._id)} data-testid={`button-delete-template-${template._id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{template.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("smsTemplates.editTitle") : t("smsTemplates.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("smsTemplates.templateType")}</Label>
              <Input
                value={form.templateType}
                onChange={(e) => setForm({ ...form, templateType: e.target.value })}
                placeholder="welcome_message"
                data-testid="input-template-type"
              />
            </div>
            <div>
              <Label>{t("smsTemplates.templateName")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("smsTemplates.namePlaceholder")}
                data-testid="input-template-name"
              />
            </div>
            <div>
              <Label>{t("smsTemplates.content")}</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={t("smsTemplates.contentPlaceholder")}
                rows={4}
                data-testid="input-template-content"
              />
              <div className="flex flex-wrap gap-1 mt-2">
                {placeholders.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className="cursor-pointer text-xs"
                    onClick={() => setForm({ ...form, content: form.content + " " + p })}
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            {currentRole === "superadmin" && (
              <div>
                <Label>{t("tenants.selectBusiness")}</Label>
                <Select
                  value={form.tenantId || "global"}
                  onValueChange={(val) => setForm({ ...form, tenantId: val === "global" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-template-tenant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">{t("smsTemplates.globalTemplate")}</SelectItem>
                    {tenants?.map((tenant) => (
                      <SelectItem key={tenant._id} value={tenant._id}>
                        {getTenantName(tenant)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog}>{t("common.cancel")}</Button>
            <Button onClick={onSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-template">
              {createMutation.isPending || updateMutation.isPending ? t("common.saving") : editing ? t("common.update") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
