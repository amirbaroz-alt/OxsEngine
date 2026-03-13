import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { MAX_TEMPLATE_MESSAGE_LENGTH } from "@/lib/constants/limits";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Send, X, Loader2, Link, Phone, Reply, Building2, Tag, ChevronLeft, FileText, Eye,
  MessageSquare,
} from "lucide-react";
import type { WhatsAppTemplate, TemplateTag, ResolvedVariable, TemplateButton } from "@shared/schema";

interface SendTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  customerId: string;
  tenantId: string;
}

export function SendTemplateDialog({
  open,
  onOpenChange,
  conversationId,
  customerId,
  tenantId,
}: SendTemplateDialogProps) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === "he" || i18n.language === "ar";
  const { toast } = useToast();
  const [confirmedTemplateId, setConfirmedTemplateId] = useState<string>("");
  const [previewedTemplateId, setPreviewedTemplateId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTeamId, setFilterTeamId] = useState<string>("ALL");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [dynamicUrlValues, setDynamicUrlValues] = useState<Record<number, string>>({});

  const { data: templates } = useQuery<WhatsAppTemplate[]>({
    queryKey: [`/api/whatsapp-templates?tenantId=${tenantId}`],
    enabled: open && !!tenantId,
  });

  const { data: teams } = useQuery<{ _id: string; name: string; color: string; active: boolean }[]>({
    queryKey: [`/api/teams?tenantId=${tenantId}`],
    enabled: open && !!tenantId,
  });

  const { data: templateTags } = useQuery<TemplateTag[]>({
    queryKey: [`/api/template-tags?tenantId=${tenantId}`],
    enabled: open && !!tenantId,
  });

  const allTags = useMemo(() => templateTags || [], [templateTags]);

  const activeTeams = useMemo(() => (teams || []).filter((t) => t.active), [teams]);
  const teamLookup = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const t of (teams || [])) map.set(t._id, { name: t.name, color: t.color });
    return map;
  }, [teams]);

  const tagLookup = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const tag of allTags) map.set(tag._id, { name: tag.name, color: tag.color });
    return map;
  }, [allTags]);

  const approvedTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter((t) => t.status === "APPROVED" && t.isActive !== false);
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    let result = approvedTemplates;
    if (filterTeamId !== "ALL") {
      result = result.filter((tpl) => tpl.teamId === filterTeamId);
    }
    if (selectedTagIds.length > 0) {
      result = result.filter((tpl) => {
        const tplTagIds = tpl.tagIds || [];
        return selectedTagIds.some((tagId) => tplTagIds.includes(tagId));
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (tpl) =>
          tpl.name.toLowerCase().includes(q) ||
          (tpl.friendlyName || "").toLowerCase().includes(q) ||
          (tpl.rawBodyContent || "").toLowerCase().includes(q) ||
          (tpl.bodyText || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [approvedTemplates, searchQuery, filterTeamId, selectedTagIds]);

  const selectedTemplate = useMemo(
    () => templates?.find((t) => t._id === confirmedTemplateId) || null,
    [templates, confirmedTemplateId]
  );

  const previewTemplateId = confirmedTemplateId || previewedTemplateId;
  const previewTemplate = useMemo(
    () => templates?.find((t) => t._id === previewTemplateId) || null,
    [templates, previewTemplateId]
  );

  const { data: resolvedFields, isLoading: resolving } = useQuery<{
    fields: ResolvedVariable[];
    params: string[];
    buttons?: TemplateButton[];
  }>({
    queryKey: ["/api/whatsapp-templates", confirmedTemplateId, "resolve", customerId],
    queryFn: () =>
      apiRequest("POST", `/api/whatsapp-templates/${confirmedTemplateId}/resolve?tenantId=${tenantId}`, {
        customerId,
      }).then((r) => r.json()),
    enabled: !!confirmedTemplateId && !!tenantId,
  });

  useEffect(() => {
    if (resolvedFields?.fields) {
      const initial: Record<string, string> = {};
      for (const f of resolvedFields.fields) {
        initial[f.position] = f.value || "";
      }
      setFieldValues(initial);
    }
  }, [resolvedFields]);

  useEffect(() => {
    if (!open) {
      setConfirmedTemplateId("");
      setPreviewedTemplateId("");
      setSearchQuery("");
      setFilterTeamId("ALL");
      setSelectedTagIds([]);
      setFieldValues({});
      setDynamicUrlValues({});
    }
  }, [open]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  const previewText = useMemo(() => {
    if (!selectedTemplate) return "";
    const rawBody = (selectedTemplate.rawBodyContent || "").trim();
    let text = rawBody || selectedTemplate.bodyText || "";

    if (selectedTemplate.variables && selectedTemplate.variables.length > 0) {
      for (const v of selectedTemplate.variables) {
        const val = fieldValues[String(v.index)];
        const placeholder = val || `[${v.friendlyLabel}]`;
        text = text.replace(new RegExp(`\\{\\{${v.fieldName}\\}\\}`, "g"), placeholder);
        text = text.replace(`{{${v.index}}}`, placeholder);
      }
    } else if (resolvedFields?.fields) {
      for (const f of resolvedFields.fields) {
        const val = fieldValues[f.position];
        text = text.replace(`{{${f.position}}}`, val || `[${f.label}]`);
      }
    }
    return text;
  }, [selectedTemplate, fieldValues, resolvedFields]);

  const rawPreviewText = useMemo(() => {
    if (!previewTemplate || confirmedTemplateId) return "";
    return (previewTemplate.rawBodyContent || "").trim() || previewTemplate.bodyText || "";
  }, [previewTemplate, confirmedTemplateId]);

  const messageLength = previewText.length;

  const templateButtons = resolvedFields?.buttons || selectedTemplate?.buttons || [];
  const previewButtons = previewTemplate?.buttons || [];
  const dynamicUrlButtons = templateButtons
    .map((btn, idx) => ({ btn, idx }))
    .filter(({ btn }) => btn.type === "URL" && btn.urlDynamic);

  const bodyFieldsFilled = resolvedFields?.fields
    ? resolvedFields.fields.every((f) => (fieldValues[f.position] || "").trim())
    : false;
  const dynamicUrlsFilled = dynamicUrlButtons.every(({ idx }) => (dynamicUrlValues[idx] || "").trim());
  const allFieldsFilled = bodyFieldsFilled && dynamicUrlsFilled;

  const sendMutation = useMutation({
    mutationFn: () => {
      const fields = resolvedFields?.fields || [];
      const params = fields
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((f) => fieldValues[f.position] || "");

      const templateButtonParams: { type: string; sub_type: string; index: number; parameters: any[] }[] = [];
      for (const { btn, idx } of dynamicUrlButtons) {
        const suffix = dynamicUrlValues[idx] || "";
        if (suffix) {
          templateButtonParams.push({
            type: "button",
            sub_type: "url",
            index: idx,
            parameters: [{ type: "text", text: suffix }],
          });
        }
      }

      return apiRequest("POST", `/api/inbox/conversations/${conversationId}/send-template?tenantId=${tenantId}`, {
        templateName: selectedTemplate!.name,
        templateLanguage: selectedTemplate!.language,
        templateParams: params,
        ...(templateButtonParams.length > 0 ? { templateButtonParams } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          (q.queryKey[0] as string)?.includes?.("/api/inbox/conversations"),
      });
      toast({ title: t("waTemplates.templateSent") });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  function renderFieldInput(field: ResolvedVariable) {
    const val = fieldValues[field.position] || "";
    const onChange = (newVal: string) =>
      setFieldValues((prev) => ({ ...prev, [field.position]: newVal }));

    if (field.fieldType === "CHECKBOX") {
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={val === "true"}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
            data-testid={`input-field-${field.position}`}
          />
          <span className="text-xs text-muted-foreground">{val === "true" ? t("common.yes") : t("common.no")}</span>
        </div>
      );
    }

    if (field.fieldType === "SELECT" && field.options && field.options.length > 0) {
      return (
        <Select value={val} onValueChange={onChange}>
          <SelectTrigger className="h-8" data-testid={`input-field-${field.position}`}>
            <SelectValue placeholder={t("waTemplates.selectValue")} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        value={val}
        onChange={(e) => onChange(e.target.value)}
        type={field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : "text"}
        className="h-8"
        data-testid={`input-field-${field.position}`}
      />
    );
  }

  function renderWhatsAppBubble(text: string, buttons: TemplateButton[]) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[320px] w-full">
          <div className="relative rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 shadow-sm border border-emerald-100 dark:border-emerald-900/50">
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed" dir="auto">
              {text || "..."}
            </p>
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-muted-foreground">12:00</span>
            </div>
          </div>
          {buttons.length > 0 && (
            <div className="mt-1 space-y-1">
              {buttons.map((btn, i) => (
                <div key={i} className="text-center text-sm text-blue-600 dark:text-blue-400 py-1.5 bg-white/80 dark:bg-white/10 rounded border border-emerald-100 dark:border-emerald-900/50">
                  {btn.type === "URL" && <Link className="h-3 w-3 inline me-1" />}
                  {btn.type === "PHONE_NUMBER" && <Phone className="h-3 w-3 inline me-1" />}
                  {btn.type === "QUICK_REPLY" && <Reply className="h-3 w-3 inline me-1" />}
                  {btn.text || "..."}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const showFieldsPanel = !!confirmedTemplateId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col p-0"
        dir={rtl ? "rtl" : "ltr"}
      >
        <DialogHeader className="px-5 md:px-6 pt-5 md:pt-5 pb-2 md:pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base md:text-lg">
            <MessageSquare className="h-5 w-5 text-green-600" />
            {t("waTemplates.sendTemplateTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs md:text-sm mt-0.5">
            {t("waTemplates.sendTemplateDesc")}
          </DialogDescription>
        </DialogHeader>

        {!showFieldsPanel ? (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="px-5 md:px-6 py-2.5 md:py-3 space-y-2 md:space-y-3 border-b bg-muted/30 shrink-0">
              <div className="flex gap-2 items-center">
                <div className="relative flex-1 md:w-3/12 md:flex-none min-w-0 md:min-w-[160px]">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("waTemplates.searchPlaceholder")}
                    className="ps-9 h-10 md:h-9 bg-slate-50 dark:bg-slate-900/50 md:bg-background md:dark:bg-background rounded-full md:rounded-md"
                    data-testid="input-search-send-template"
                  />
                </div>
                {activeTeams.length > 0 && (
                  <Select value={filterTeamId} onValueChange={setFilterTeamId}>
                    <SelectTrigger className="w-auto md:w-[180px] shrink-0 h-10 md:h-9 bg-slate-50 dark:bg-slate-900/50 md:bg-background md:dark:bg-background rounded-full md:rounded-md" data-testid="select-send-department-filter">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="hidden md:inline ms-1"><SelectValue placeholder={t("waTemplates.allDepartments")} /></span>
                      <span className="md:hidden"><SelectValue placeholder="" /></span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{t("waTemplates.allDepartments")}</SelectItem>
                      {activeTeams.map((team) => (
                        <SelectItem key={team._id} value={team._id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {allTags.length > 0 && (
                <div className="relative">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar md:flex-wrap md:overflow-x-visible">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {allTags.map((tag) => {
                      const isActive = selectedTagIds.includes(tag._id);
                      return (
                        <button
                          key={tag._id}
                          onClick={() => toggleTag(tag._id)}
                          className={`
                            text-[11px] px-2.5 py-1 rounded-full border transition-all whitespace-nowrap md:whitespace-normal shrink-0 md:shrink
                            ${isActive
                              ? "ring-1 ring-offset-1 shadow-sm font-medium"
                              : "opacity-70 hover:opacity-100"
                            }
                          `}
                          style={{
                            borderColor: tag.color,
                            color: isActive ? "#fff" : tag.color,
                            backgroundColor: isActive ? tag.color : tag.color + "10",
                          }}
                          data-testid={`button-filter-tag-${tag._id}`}
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                    {selectedTagIds.length > 0 && (
                      <button
                        onClick={() => setSelectedTagIds([])}
                        className="text-[11px] text-muted-foreground hover:text-foreground underline ms-1 shrink-0 md:shrink"
                        data-testid="button-clear-tags"
                      >
                        {t("common.clearFilter", "נקה סינון")}
                      </button>
                    )}
                  </div>
                  <div className="absolute ltr:right-0 rtl:left-0 top-0 bottom-0 w-6 pointer-events-none md:hidden ltr:bg-gradient-to-r rtl:bg-gradient-to-l from-transparent to-background/80" />
                </div>
              )}
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
              <div className="flex-1 overflow-hidden flex flex-col md:border-e min-w-0 min-h-0">
                <div className="px-4 md:px-4 py-1.5 md:py-2 text-xs text-muted-foreground border-b bg-muted/20 flex items-center justify-between shrink-0">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    {t("waTemplates.templates", "תבניות")}
                  </span>
                  <span>{filteredTemplates.length} {t("waTemplates.results", "תוצאות")}</span>
                </div>
                <ScrollArea className="flex-1 min-h-0 md:max-h-none">
                  {filteredTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 md:py-12 text-muted-foreground">
                      <Search className="h-6 w-6 md:h-8 md:w-8 mb-2 opacity-40" />
                      <p className="text-sm">{t("waTemplates.noResults")}</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {filteredTemplates.map((tpl) => {
                        const isActive = previewedTemplateId === tpl._id;
                        return (
                          <button
                            key={tpl._id}
                            onClick={() => setPreviewedTemplateId(tpl._id)}
                            onMouseEnter={() => setPreviewedTemplateId(tpl._id)}
                            className={`
                              w-full text-start px-5 md:px-4 py-3.5 md:py-3 min-h-[60px] transition-colors cursor-pointer
                              active:bg-accent/80 md:active:bg-transparent
                              ${isActive ? "bg-accent/60" : "hover:bg-accent/30"}
                            `}
                            data-testid={`button-pick-template-${tpl._id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm truncate" dir="auto">
                                  {tpl.friendlyName || tpl.name}
                                </p>
                                {tpl.friendlyName && (
                                  <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                                    {tpl.name}
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0 flex-wrap justify-end items-start">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{tpl.language}</Badge>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{tpl.category}</Badge>
                              </div>
                            </div>
                            <div className="flex gap-1 mt-1.5 flex-wrap">
                              {tpl.teamId && teamLookup.has(tpl.teamId) && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0"
                                  style={{
                                    backgroundColor: teamLookup.get(tpl.teamId)!.color + "15",
                                    color: teamLookup.get(tpl.teamId)!.color,
                                    borderColor: teamLookup.get(tpl.teamId)!.color + "40",
                                  }}
                                  data-testid={`badge-dept-send-${tpl._id}`}
                                >
                                  <Building2 className="h-2.5 w-2.5 me-0.5" />
                                  {teamLookup.get(tpl.teamId)!.name}
                                </Badge>
                              )}
                              {(tpl.tagIds || []).map((tagId) => {
                                const tagInfo = tagLookup.get(tagId);
                                if (!tagInfo) return null;
                                return (
                                  <Badge
                                    key={tagId}
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0"
                                    style={{
                                      backgroundColor: tagInfo.color + "15",
                                      color: tagInfo.color,
                                      borderColor: tagInfo.color + "40",
                                    }}
                                  >
                                    {tagInfo.name}
                                  </Badge>
                                );
                              })}
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2" dir="auto">
                              {(tpl.rawBodyContent || "").trim() || tpl.bodyText}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>

              <div className="hidden md:flex w-[340px] shrink-0 flex-col bg-muted/20">
                <div className="px-4 py-2 text-xs text-muted-foreground border-b bg-muted/20 flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  {t("waTemplates.preview", "תצוגה מקדימה")}
                </div>
                <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                  {previewTemplate ? (
                    <div className="w-full flex-1 flex flex-col">
                      <Button
                        className="w-full mb-3"
                        onClick={() => {
                          setConfirmedTemplateId(previewTemplate._id);
                          setFieldValues({});
                          setDynamicUrlValues({});
                        }}
                        data-testid="button-select-template"
                      >
                        <Send className="h-4 w-4 me-2" />
                        {t("waTemplates.selectTemplate", "בחר תבנית")}
                      </Button>
                      <div className="mb-3 space-y-1">
                        <p className="font-semibold text-sm" dir="auto">
                          {previewTemplate.friendlyName || previewTemplate.name}
                        </p>
                        {previewTemplate.friendlyName && (
                          <p className="text-[11px] text-muted-foreground font-mono">{previewTemplate.name}</p>
                        )}
                        <div className="flex gap-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{previewTemplate.language}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{previewTemplate.category}</Badge>
                          {previewTemplate.variables && previewTemplate.variables.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">
                              {previewTemplate.variables.length} {t("waTemplates.variables", "משתנים")}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl wa-preview-bg p-4 flex-1">
                        {renderWhatsAppBubble(
                          rawPreviewText || (previewTemplate.rawBodyContent || "").trim() || previewTemplate.bodyText || "",
                          previewButtons
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground py-12 flex-1">
                      <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
                      <p className="text-sm">{t("waTemplates.hoverToPreview", "בחר תבנית לתצוגה מקדימה")}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {previewTemplate && (
              <div className="md:hidden border-t px-5 py-3 bg-muted/20 shrink-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
                <Button
                  className="w-full h-12 text-base"
                  onClick={() => {
                    setConfirmedTemplateId(previewTemplate._id);
                    setFieldValues({});
                    setDynamicUrlValues({});
                  }}
                  data-testid="button-select-template-mobile"
                >
                  <Send className="h-5 w-5 me-2" />
                  {t("waTemplates.selectTemplate", "בחר תבנית")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 md:gap-4 overflow-hidden flex-1 px-5 md:px-6 pb-0 md:pb-5 min-h-0">
            <div className="flex items-center gap-2 pt-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirmedTemplateId("");
                  setFieldValues({});
                  setDynamicUrlValues({});
                }}
                data-testid="button-back-template-list"
              >
                <ChevronLeft className="h-4 w-4 me-1 rtl:rotate-180" />
                {t("waTemplates.selectTemplate")}
              </Button>
              <Badge variant="outline" className="text-xs truncate max-w-[200px]">{selectedTemplate?.friendlyName || selectedTemplate?.name}</Badge>
            </div>

            <div className="grid md:grid-cols-2 gap-2 md:gap-4 overflow-y-auto flex-1 min-h-0">
              <div className="space-y-2 overflow-y-auto order-1 md:order-none">
                {resolving ? (
                  <div className="flex items-center justify-center gap-2 py-8">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">{t("waTemplates.loadingFields")}</span>
                  </div>
                ) : resolvedFields?.fields && resolvedFields.fields.length > 0 ? (
                  <table className="w-full text-sm" data-testid="table-template-fields">
                    <thead>
                      <tr className="border-b">
                        <th className="text-start p-1.5 md:p-2 w-8">#</th>
                        <th className="text-start p-1.5 md:p-2">{t("waTemplates.fieldDescription")}</th>
                        <th className="text-start p-1.5 md:p-2">{t("waTemplates.fieldValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resolvedFields.fields.map((field, idx) => (
                        <tr key={field.position} className="border-b">
                          <td className="p-1.5 md:p-2 text-muted-foreground">{idx + 1}</td>
                          <td className="p-1.5 md:p-2">
                            <span className="font-medium text-xs md:text-sm" dir="auto">{field.label}</span>
                            {!field.isManual && (
                              <Badge variant="secondary" className="text-[10px] ms-1 hidden md:inline-flex">{t("waTemplates.autoFilled")}</Badge>
                            )}
                          </td>
                          <td className="p-1.5 md:p-2">
                            {renderFieldInput(field)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t("waTemplates.noFields")}
                  </p>
                )}

                {dynamicUrlButtons.length > 0 && (
                  <div className="border-t pt-3 mt-3 space-y-2">
                    <Label className="text-xs font-semibold">{t("waTemplates.dynamicUrl", "פרמטרי URL דינמיים")}</Label>
                    {dynamicUrlButtons.map(({ btn, idx }) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Badge variant="outline" className="shrink-0 text-xs">
                          <Link className="h-3 w-3 me-1" />
                          {btn.text}
                        </Badge>
                        <Input
                          value={dynamicUrlValues[idx] || ""}
                          onChange={(e) => setDynamicUrlValues((prev) => ({ ...prev, [idx]: e.target.value }))}
                          placeholder={t("waTemplates.dynamicUrlHint", "סיומת URL (לדוגמה: order123)")}
                          dir="ltr"
                          lang="en"
                          spellCheck={false}
                          autoCapitalize="none"
                          className="h-8 text-xs"
                          data-testid={`input-dynamic-url-${idx}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {templateButtons.length > 0 && dynamicUrlButtons.length === 0 && (
                  <div className="border-t pt-3 mt-3 space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("waTemplates.buttonBuilder", "כפתורים")}</Label>
                    {templateButtons.map((btn, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant={btn.type === "QUICK_REPLY" ? "secondary" : "default"} className="text-[10px]">{btn.type}</Badge>
                        <span>{btn.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl wa-preview-bg p-3 md:p-4 overflow-y-auto order-0 md:order-none">
                {renderWhatsAppBubble(previewText, templateButtons)}
              </div>
            </div>

            {/* Desktop footer */}
            <div className="hidden md:flex items-center justify-between border-t pt-3 gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {t("waTemplates.messageLength")} — {messageLength}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-cancel-send-template"
                >
                  <X className="h-4 w-4 me-2" />
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending || !allFieldsFilled || messageLength > MAX_TEMPLATE_MESSAGE_LENGTH}
                  data-testid="button-confirm-send-template"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 me-2" />
                  )}
                  {t("waTemplates.sendTemplate")}
                </Button>
              </div>
            </div>

            {/* Mobile footer — sticky full-width send */}
            <div className="md:hidden border-t pt-3 pb-1 shrink-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-muted-foreground">
                  {t("waTemplates.messageLength")} — {messageLength}
                </span>
                <button
                  onClick={() => onOpenChange(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  data-testid="button-cancel-send-template-mobile"
                >
                  {t("common.cancel")}
                </button>
              </div>
              <Button
                className="w-full h-12 text-base"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !allFieldsFilled || messageLength > MAX_TEMPLATE_MESSAGE_LENGTH}
                data-testid="button-confirm-send-template-mobile"
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-5 w-5 me-2 animate-spin" />
                ) : (
                  <Send className="h-5 w-5 me-2" />
                )}
                {t("waTemplates.sendTemplate")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
