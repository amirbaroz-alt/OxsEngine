import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Plus, Pencil, Power, ExternalLink, Phone, Mail, Bot, Globe, Eye, EyeOff, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTableSkeleton } from "@/components/data-table-skeleton";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { insertTenantSchema, supportedLanguages, type Tenant, type InsertTenant } from "@shared/schema";
import { z } from "zod";

export default function TenantsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, Record<string, string>>>({});
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsVisible, setSecretsVisible] = useState<Record<string, boolean>>({});
  const [busyReasonsList, setBusyReasonsList] = useState<string[]>([]);
  const [newBusyReason, setNewBusyReason] = useState("");

  const formSchema = insertTenantSchema.extend({
    nameHe: z.string().min(1, t("tenants.validation.nameHeRequired")),
    nameEn: z.string().min(1, t("tenants.validation.nameEnRequired")),
    slug: z.string().min(1, t("tenants.validation.slugRequired")).regex(/^[a-z0-9-]+$/, t("tenants.validation.slugFormat")),
  });

  const { data: tenants, isLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  const form = useForm<InsertTenant>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nameHe: "",
      nameEn: "",
      slug: "",
      logo: "",
      defaultLanguage: "he",
      active: true,
      smsConfig: { userName: null, accessToken: null, source: null },
      mailConfig: { sendGridKey: null, fromEmail: null, fromName: null },
      aiSettings: { systemPrompt: null, provider: null, modelName: null },
      quotaGuardConfig: { proxyUrl: null, enabled: false },
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertTenant) => apiRequest("POST", "/api/tenants", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      toast({ title: t("tenants.createdSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: InsertTenant & { _id: string }) =>
      apiRequest("PATCH", `/api/tenants/${data._id}`, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", variables._id, "busy-reasons"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/busy-reasons"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
      toast({ title: t("tenants.updatedSuccess") });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiRequest("PATCH", `/api/tenants/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/dashboard/stats") });
    },
  });

  async function loadRevealedSecrets(tenantId: string) {
    setSecretsLoading(true);
    try {
      const res = await apiRequest("GET", `/api/tenants/${tenantId}/reveal-secrets`);
      const data = await res.json();
      setRevealedSecrets(data);
    } catch {
      toast({ title: t("common.error"), description: "Failed to load secrets", variant: "destructive" });
    } finally {
      setSecretsLoading(false);
    }
  }

  function toggleSecretVisibility(fieldKey: string) {
    if (!editingTenant) return;
    if (!revealedSecrets || Object.keys(revealedSecrets).length === 0) {
      loadRevealedSecrets(editingTenant._id).then(() => {
        setSecretsVisible((prev) => ({ ...prev, [fieldKey]: true }));
      });
    } else {
      setSecretsVisible((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
    }
  }

  function getRevealedValue(configKey: string, field: string): string | undefined {
    return revealedSecrets?.[configKey]?.[field];
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingTenant(null);
    setRevealedSecrets({});
    setSecretsVisible({});
    setBusyReasonsList([]);
    setNewBusyReason("");
    form.reset({
      nameHe: "",
      nameEn: "",
      slug: "",
      logo: "",
      defaultLanguage: "he",
      active: true,
      smsConfig: { userName: null, accessToken: null, source: null },
      mailConfig: { sendGridKey: null, fromEmail: null, fromName: null },
      aiSettings: { systemPrompt: null, provider: null, modelName: null },
      quotaGuardConfig: { proxyUrl: null, enabled: false },
    });
  }

  function openEdit(tenant: Tenant) {
    setEditingTenant(tenant);
    setBusyReasonsList(tenant.busyReasons?.length ? tenant.busyReasons : []);
    form.reset({
      nameHe: tenant.nameHe,
      nameEn: tenant.nameEn,
      slug: tenant.slug,
      logo: tenant.logo || "",
      defaultLanguage: tenant.defaultLanguage || "he",
      active: tenant.active,
      smsConfig: {
        userName: tenant.smsConfig?.userName || null,
        accessToken: tenant.smsConfig?.accessToken || null,
        source: tenant.smsConfig?.source || null,
      },
      mailConfig: {
        sendGridKey: tenant.mailConfig?.sendGridKey || null,
        fromEmail: tenant.mailConfig?.fromEmail || null,
        fromName: tenant.mailConfig?.fromName || null,
      },
      aiSettings: {
        systemPrompt: tenant.aiSettings?.systemPrompt || null,
        provider: tenant.aiSettings?.provider || null,
        modelName: tenant.aiSettings?.modelName || null,
      },
      quotaGuardConfig: {
        proxyUrl: (tenant as any).quotaGuardConfig?.proxyUrl || null,
        enabled: (tenant as any).quotaGuardConfig?.enabled ?? false,
      },
    });
    setDialogOpen(true);
  }

  function onSubmit(values: InsertTenant) {
    const payload = { ...values, busyReasons: busyReasonsList };
    if (editingTenant) {
      updateMutation.mutate({ ...payload, _id: editingTenant._id });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("tenants.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("tenants.subtitle")}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-add-tenant">
          <Plus className="h-4 w-4 me-2" />
          {t("tenants.addNew")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <DataTableSkeleton columns={7} />
            </div>
          ) : !tenants || tenants.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={t("tenants.emptyTitle")}
              description={t("tenants.emptyDescription")}
              actionLabel={t("tenants.emptyAction")}
              onAction={() => setDialogOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenants.nameHe")}</TableHead>
                  <TableHead>{t("tenants.nameEn")}</TableHead>
                  <TableHead>{t("common.slug")}</TableHead>
                  <TableHead>{t("tenants.loginUrl")}</TableHead>
                  <TableHead>{t("common.defaultLanguage")}</TableHead>
                  <TableHead>{t("tenants.channels")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((tenant) => (
                  <TableRow key={tenant._id} data-testid={`row-tenant-${tenant._id}`}>
                    <TableCell className="font-medium">{tenant.nameHe}</TableCell>
                    <TableCell dir="ltr">{tenant.nameEn}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded-md" dir="ltr">{tenant.slug}</code>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`${window.location.origin}/login/${tenant.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        dir="ltr"
                        data-testid={`link-login-url-${tenant._id}`}
                      >
                        /login/{tenant.slug}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>{t(`languages.${tenant.defaultLanguage || "he"}`)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {tenant.smsConfig?.userName && <Badge variant="secondary"><Phone className="h-3 w-3 me-1" />SMS</Badge>}
                        {tenant.mailConfig?.sendGridKey && <Badge variant="secondary"><Mail className="h-3 w-3 me-1" />Email</Badge>}
                        {!tenant.smsConfig?.userName && !tenant.mailConfig?.sendGridKey && (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          tenant.active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        }
                      >
                        {tenant.active ? t("common.active") : t("common.inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(tenant)} data-testid={`button-edit-tenant-${tenant._id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => toggleMutation.mutate({ id: tenant._id, active: !tenant.active })}
                          data-testid={`button-toggle-tenant-${tenant._id}`}
                        >
                          <Power className="h-4 w-4" />
                        </Button>
                      </div>
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTenant ? t("tenants.editTitle") : t("tenants.newTitle")}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <Tabs defaultValue="general" className="w-full">
                <TabsList className="w-full justify-start flex-wrap">
                  <TabsTrigger value="general" data-testid="tab-general">
                    <Building2 className="h-4 w-4 me-1" />
                    {t("tenants.generalInfo")}
                  </TabsTrigger>
                  <TabsTrigger value="sms" data-testid="tab-sms">
                    <Phone className="h-4 w-4 me-1" />
                    SMS
                  </TabsTrigger>
                  <TabsTrigger value="mail" data-testid="tab-mail">
                    <Mail className="h-4 w-4 me-1" />
                    Email
                  </TabsTrigger>
                  <TabsTrigger value="ai" data-testid="tab-ai">
                    <Bot className="h-4 w-4 me-1" />
                    AI
                  </TabsTrigger>
                  <TabsTrigger value="quotaguard" data-testid="tab-quotaguard">
                    <Globe className="h-4 w-4 me-1" />
                    QuotaGuard
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="nameHe" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.labelNameHe")}</FormLabel>
                        <FormControl><Input {...field} placeholder={t("tenants.placeholderNameHe")} data-testid="input-name-he" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="nameEn" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.labelNameEn")}</FormLabel>
                        <FormControl><Input {...field} placeholder={t("tenants.placeholderNameEn")} dir="ltr" data-testid="input-name-en" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="slug" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.slug")}</FormLabel>
                        <FormControl><Input {...field} placeholder={t("tenants.placeholderSlug")} dir="ltr" className="font-mono" data-testid="input-slug" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="defaultLanguage" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.defaultLanguage")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-default-language"><SelectValue /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {supportedLanguages.map((lang) => (
                              <SelectItem key={lang} value={lang}>{t(`languages.${lang}`)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="logo" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.logo")}</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} placeholder="https://..." dir="ltr" data-testid="input-logo" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="active" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="invisible">.</FormLabel>
                        <div className="flex items-center gap-2 rounded-md border px-3 min-h-9">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} data-testid="checkbox-active" />
                          </FormControl>
                          <FormLabel className="cursor-pointer mb-0 text-start">{t("common.active")}</FormLabel>
                        </div>
                      </FormItem>
                    )} />
                  </div>
                  <div className="space-y-2 pt-2 border-t">
                    <label className="text-sm font-medium">{t("tenants.busyReasons.label", "Busy Reasons")}</label>
                    <p className="text-xs text-muted-foreground">{t("tenants.busyReasons.helperText", "Manage the list of busy reasons available for employees in this company.")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {busyReasonsList.map((reason, idx) => (
                        <Badge
                          key={idx}
                          variant="default"
                          className="cursor-pointer select-none gap-1"
                          onClick={() => setBusyReasonsList(prev => prev.filter((_, i) => i !== idx))}
                          data-testid={`badge-tenant-busy-reason-${idx}`}
                        >
                          {reason}
                          <X className="h-3 w-3" />
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newBusyReason}
                        onChange={(e) => setNewBusyReason(e.target.value)}
                        placeholder={t("tenants.busyReasons.addPlaceholder", "Add reason key (e.g. meeting)")}
                        className="flex-1"
                        dir="ltr"
                        data-testid="input-new-busy-reason"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const v = newBusyReason.trim().toLowerCase();
                            if (v && !busyReasonsList.includes(v)) {
                              setBusyReasonsList(prev => [...prev, v]);
                              setNewBusyReason("");
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const v = newBusyReason.trim().toLowerCase();
                          if (v && !busyReasonsList.includes(v)) {
                            setBusyReasonsList(prev => [...prev, v]);
                            setNewBusyReason("");
                          }
                        }}
                        data-testid="button-add-busy-reason"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="sms" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">{t("tenants.smsConfigNote")}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="smsConfig.userName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.smsUserName")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder="019SMS username" dir="ltr" data-testid="input-sms-username" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="smsConfig.accessToken" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.smsAccessToken")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} value={secretsVisible["sms.accessToken"] ? (getRevealedValue("smsConfig", "accessToken") ?? field.value ?? "") : (field.value ?? "")} onChange={(e) => field.onChange(e.target.value || null)} placeholder="Token" dir="ltr" type={secretsVisible["sms.accessToken"] ? "text" : "password"} autoComplete="off" data-testid="input-sms-token" className="pe-9" />
                            {editingTenant && (
                              <Button type="button" variant="ghost" size="icon" className="absolute end-0 top-0 h-9 w-9" onClick={() => toggleSecretVisibility("sms.accessToken")} disabled={secretsLoading} data-testid="button-reveal-sms-token">
                                {secretsVisible["sms.accessToken"] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="smsConfig.source" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.smsSource")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder="Source number" dir="ltr" data-testid="input-sms-source" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </TabsContent>

                <TabsContent value="mail" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">{t("tenants.mailConfigNote")}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="mailConfig.sendGridKey" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t("tenants.sendGridKey")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} value={secretsVisible["mail.sendGridKey"] ? (getRevealedValue("mailConfig", "sendGridKey") ?? field.value ?? "") : (field.value ?? "")} onChange={(e) => field.onChange(e.target.value || null)} placeholder={t("tenants.sendGridKeyPlaceholder")} dir="ltr" type={secretsVisible["mail.sendGridKey"] ? "text" : "password"} autoComplete="off" data-testid="input-sendgrid-key" className="pe-9" />
                            {editingTenant && (
                              <Button type="button" variant="ghost" size="icon" className="absolute end-0 top-0 h-9 w-9" onClick={() => toggleSecretVisibility("mail.sendGridKey")} disabled={secretsLoading} data-testid="button-reveal-sendgrid-key">
                                {secretsVisible["mail.sendGridKey"] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="mailConfig.fromEmail" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.fromEmail")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder={t("tenants.fromEmailPlaceholder")} dir="ltr" type="email" data-testid="input-from-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="mailConfig.fromName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.fromName")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder={t("tenants.fromNamePlaceholder")} data-testid="input-from-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </TabsContent>


                <TabsContent value="ai" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">{t("tenants.aiSettingsNote")}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="aiSettings.provider" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.aiProvider")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder="openai" dir="ltr" data-testid="input-ai-provider" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="aiSettings.modelName" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("tenants.aiModel")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder="gpt-4o" dir="ltr" data-testid="input-ai-model" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="aiSettings.systemPrompt" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>{t("tenants.aiSystemPrompt")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} placeholder={t("tenants.aiSystemPromptPlaceholder")} className="min-h-[100px]" data-testid="input-ai-prompt" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </TabsContent>

                <TabsContent value="quotaguard" className="space-y-4 mt-4">
                  <p className="text-xs text-muted-foreground">QuotaGuard Static proxy for SendGrid email sending (quotaguard.com)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="quotaGuardConfig.proxyUrl" render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Proxy URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} value={secretsVisible["quotaguard.proxyUrl"] ? (getRevealedValue("quotaGuardConfig", "proxyUrl") ?? field.value ?? "") : (field.value ?? "")} onChange={(e) => field.onChange(e.target.value || null)} placeholder="http://user:pass@static.quotaguard.com:9293" dir="ltr" type={secretsVisible["quotaguard.proxyUrl"] ? "text" : "password"} autoComplete="off" data-testid="input-quotaguard-url" className="pe-9" />
                            {editingTenant && (
                              <Button type="button" variant="ghost" size="icon" className="absolute end-0 top-0 h-9 w-9" onClick={() => toggleSecretVisibility("quotaguard.proxyUrl")} disabled={secretsLoading} data-testid="button-reveal-quotaguard-url">
                                {secretsVisible["quotaguard.proxyUrl"] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="quotaGuardConfig.enabled" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="invisible">.</FormLabel>
                        <div className="flex items-center gap-2 rounded-md border px-3 min-h-9">
                          <FormControl>
                            <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} data-testid="checkbox-quotaguard-enabled" />
                          </FormControl>
                          <FormLabel className="cursor-pointer mb-0 text-start">Enabled</FormLabel>
                        </div>
                      </FormItem>
                    )} />
                  </div>
                </TabsContent>
              </Tabs>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-tenant">
                  {createMutation.isPending || updateMutation.isPending ? t("common.saving") : editingTenant ? t("common.update") : t("common.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
