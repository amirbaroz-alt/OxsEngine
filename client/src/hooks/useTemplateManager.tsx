import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/lib/role-context";
import type { Tenant, WhatsAppTemplate, TemplateTag, TemplateVariable, TemplateFieldType, TemplateButton, TemplateButtonType } from "@shared/schema";
import {
  type TemplateFormState,
  INITIAL_FORM,
  applyTemplateFilter,
  addVariableToForm,
  removeVariableFromForm,
  updateVariableInForm,
  validateStep1,
  buildSubmitPayload,
  buildDuplicateForm,
} from "./template-manager-utils";

export type { TemplateFormState } from "./template-manager-utils";

export function useTemplateManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { currentRole, currentTenantId } = useRole();
  const [selectedTenantId, setSelectedTenantId] = useState<string>(currentTenantId || "");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<WhatsAppTemplate | null>(null);
  const [metaDialogTemplate, setMetaDialogTemplate] = useState<WhatsAppTemplate | null>(null);
  const [metaFriendlyName, setMetaFriendlyName] = useState("");
  const [metaTagIds, setMetaTagIds] = useState<string[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");

  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [filterTeamId, setFilterTeamId] = useState<string>("ALL");
  const [filterActiveStatus, setFilterActiveStatus] = useState<string>("ALL");
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);

  const [createStep, setCreateStep] = useState(1);
  const [form, setForm] = useState<TemplateFormState>(INITIAL_FORM);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isSuperAdmin = currentRole === "superadmin";
  const effectiveTenantId = isSuperAdmin ? selectedTenantId : (currentTenantId || "");

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isSuperAdmin,
  });

  const { data: configCheck, isLoading: configLoading } = useQuery<{ configured: boolean; missing: string[] }>({
    queryKey: [`/api/whatsapp-templates/config-check?tenantId=${effectiveTenantId}`],
    enabled: !!effectiveTenantId,
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<WhatsAppTemplate[]>({
    queryKey: [`/api/whatsapp-templates?tenantId=${effectiveTenantId}`],
    enabled: !!effectiveTenantId && configCheck?.configured === true,
  });

  const { data: templateTags } = useQuery<TemplateTag[]>({
    queryKey: [`/api/template-tags?tenantId=${effectiveTenantId}`],
    enabled: !!effectiveTenantId && configCheck?.configured === true,
  });

  const { data: teams } = useQuery<{ _id: string; name: string; color: string; active: boolean }[]>({
    queryKey: ['/api/teams', effectiveTenantId],
    queryFn: async () => {
      const res = await fetch(`/api/teams?tenantId=${effectiveTenantId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch teams");
      return res.json();
    },
    enabled: !!effectiveTenantId && configCheck?.configured === true,
  });

  const invalidateTemplates = useCallback(() => {
    queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/whatsapp-templates") });
  }, []);

  useEffect(() => {
    if (!effectiveTenantId) return;
    const authToken = localStorage.getItem("auth_token");
    if (!authToken) return;

    const socket: Socket = io({ path: "/socket.io", transports: ["websocket", "polling"] });

    socket.on("connect", () => {
      socket.emit("authenticate", { token: authToken });
    });

    socket.on("authenticated", () => {
      socket.emit("join-tenant", effectiveTenantId);
    });

    socket.on("template_update", (data: { templateId: string; status: string; templateName: string }) => {
      invalidateTemplates();

      const msgKey = data.status === "APPROVED"
        ? "waTemplates.templateApproved"
        : data.status === "REJECTED"
        ? "waTemplates.templateRejected"
        : "waTemplates.templateStatusUpdated";

      toast({
        title: t(msgKey, { name: data.templateName }),
        variant: data.status === "REJECTED" ? "destructive" : "default",
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [effectiveTenantId, invalidateTemplates, toast, t]);

  useEffect(() => {
    if (!effectiveTenantId || configCheck?.configured !== true) return;
    const sync = async () => {
      try {
        const res = await apiRequest("POST", "/api/whatsapp-templates/sync", { tenantId: effectiveTenantId });
        const data = await res.json();
        if (data.synced > 0) invalidateTemplates();
      } catch {}
    };
    sync();
    const interval = setInterval(sync, 120_000);
    return () => clearInterval(interval);
  }, [effectiveTenantId, configCheck?.configured, invalidateTemplates]);

  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    return applyTemplateFilter(templates, { searchQuery, filterCategory, filterTeamId, filterActiveStatus, filterTagIds });
  }, [templates, searchQuery, filterCategory, filterTeamId, filterActiveStatus, filterTagIds]);

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/whatsapp-templates/sync", { tenantId: effectiveTenantId }),
    onSuccess: async (res) => {
      const data = await res.json();
      invalidateTemplates();
      toast({ title: t("waTemplates.syncSuccess", { count: data.synced }) });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/whatsapp-templates", data),
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: t("waTemplates.createSuccess") });
      closeCreateDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: (templateId: string) =>
      apiRequest("POST", `/api/whatsapp-templates/${templateId}/submit`, { tenantId: effectiveTenantId }),
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: t("waTemplates.submitSuccess") });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try {
        const jsonStart = msg.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(msg.slice(jsonStart));
          msg = parsed.message || msg;
        }
      } catch {}
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/whatsapp-templates/${id}?tenantId=${effectiveTenantId}`),
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: t("waTemplates.deleteSuccess") });
    },
    onError: async (err: any) => {
      let msg = err?.message || "Unknown error";
      try {
        if (err?.response) {
          const data = await err.response.json();
          msg = data?.message || msg;
        }
      } catch {}
      toast({ title: t("common.error"), description: msg, variant: "destructive" });
    },
  });

  const metadataMutation = useMutation({
    mutationFn: (data: { id: string; friendlyName: string; tagIds: string[] }) =>
      apiRequest("PATCH", `/api/whatsapp-templates/${data.id}/metadata`, {
        tenantId: effectiveTenantId,
        friendlyName: data.friendlyName,
        tagIds: data.tagIds,
      }),
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: t("waTemplates.metadataSaved") });
      setMetaDialogTemplate(null);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const createTagMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      apiRequest("POST", "/api/template-tags", { tenantId: effectiveTenantId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/template-tags") });
      toast({ title: t("waTemplates.tagCreated") });
      setNewTagName("");
      setNewTagColor("#6366f1");
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/template-tags/${id}?tenantId=${effectiveTenantId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith?.("/api/template-tags") });
      invalidateTemplates();
      toast({ title: t("waTemplates.tagDeleted") });
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("PATCH", `/api/whatsapp-templates/${editingTemplateId}`, data),
    onSuccess: () => {
      invalidateTemplates();
      toast({ title: t("waTemplates.updateSuccess") });
      closeCreateDialog();
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  function closeCreateDialog() {
    setCreateDialogOpen(false);
    setEditingTemplateId(null);
    setCreateStep(1);
    setForm(INITIAL_FORM);
  }

  function duplicateTemplate(tpl: WhatsAppTemplate) {
    setForm(buildDuplicateForm(tpl));
    setCreateStep(1);
    setCreateDialogOpen(true);
  }

  function editTemplate(tpl: WhatsAppTemplate) {
    const dupForm = buildDuplicateForm(tpl);
    setEditingTemplateId(tpl._id);
    setForm({ ...dupForm, name: tpl.name });
    setCreateStep(1);
    setCreateDialogOpen(true);
  }

  function onSubmitCreate() {
    const payload = buildSubmitPayload(form, effectiveTenantId);
    if (editingTemplateId) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  function openMetadataDialog(tpl: WhatsAppTemplate) {
    setMetaDialogTemplate(tpl);
    setMetaFriendlyName(tpl.friendlyName || "");
    setMetaTagIds(tpl.tagIds || []);
  }

  const addVariable = useCallback(() => {
    setForm((prev) => addVariableToForm(prev));
  }, []);

  const removeVariable = useCallback((idx: number) => {
    setForm((prev) => removeVariableFromForm(prev, idx));
  }, []);

  const updateVariable = useCallback((idx: number, patch: Partial<TemplateVariable>) => {
    setForm((prev) => {
      const result = updateVariableInForm(prev, idx, patch);
      return result ?? prev;
    });
  }, []);

  const addButton = useCallback((type: TemplateButtonType) => {
    const newBtn: TemplateButton = {
      type,
      text: "",
      ...(type === "URL" ? { url: "", urlDynamic: false } : {}),
      ...(type === "PHONE_NUMBER" ? { phoneNumber: "" } : {}),
      ...(type === "QUICK_REPLY" ? { payload: "" } : {}),
    };
    setForm((prev) => ({ ...prev, buttons: [...prev.buttons, newBtn] }));
  }, []);

  const removeButton = useCallback((idx: number) => {
    setForm((prev) => ({ ...prev, buttons: prev.buttons.filter((_, i) => i !== idx) }));
  }, []);

  const updateButton = useCallback((idx: number, patch: Partial<TemplateButton>) => {
    setForm((prev) => {
      const updated = [...prev.buttons];
      updated[idx] = { ...updated[idx], ...patch };
      return { ...prev, buttons: updated };
    });
  }, []);

  const insertFieldAtCursor = useCallback((fieldName: string) => {
    const textarea = bodyTextareaRef.current;
    const insertion = `{{${fieldName}}}`;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = form.rawBodyContent;
      const newText = text.substring(0, start) + insertion + text.substring(end);
      setForm((prev) => ({ ...prev, rawBodyContent: newText }));
      requestAnimationFrame(() => {
        textarea.focus();
        const newPos = start + insertion.length;
        textarea.setSelectionRange(newPos, newPos);
      });
    } else {
      setForm((prev) => ({ ...prev, rawBodyContent: prev.rawBodyContent + insertion }));
    }
  }, [form.rawBodyContent]);

  const qrCount = form.buttons.filter((b) => b.type === "QUICK_REPLY").length;
  const ctaCount = form.buttons.filter((b) => b.type === "URL" || b.type === "PHONE_NUMBER").length;
  const canAddQR = qrCount < 3 && ctaCount === 0;
  const canAddCTA = ctaCount < 2 && qrCount === 0;

  const { step1Valid, hasMixedButtons, fieldNamesValid, fieldNamesUnique, buttonsValid } = validateStep1(form);

  const previewText = useMemo(
    () => {
      let text = form.rawBodyContent;
      for (const v of form.variables) {
        const placeholder = v.hasDefault && v.defaultValue
          ? `[${v.friendlyLabel}: ${v.defaultValue}]`
          : `[${v.friendlyLabel}]`;
        text = text.replace(new RegExp(`\\{\\{${v.fieldName}\\}\\}`, "g"), placeholder);
      }
      return text;
    },
    [form.rawBodyContent, form.variables]
  );

  const activeTeams = useMemo(() => (teams || []).filter((t) => t.active), [teams]);
  const teamLookup = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const t of (teams || [])) map.set(t._id, { name: t.name, color: t.color });
    return map;
  }, [teams]);

  const isConfigured = configCheck?.configured === true;
  const showLoading = configLoading || (isConfigured && templatesLoading);
  const activeFilterCount = (filterCategory !== "ALL" ? 1 : 0) + (filterTeamId !== "ALL" ? 1 : 0) + (filterActiveStatus !== "ALL" ? 1 : 0) + filterTagIds.length + (searchQuery ? 1 : 0);

  return {
    t,
    isSuperAdmin,
    effectiveTenantId,
    selectedTenantId,
    setSelectedTenantId,
    tenants,
    configCheck,
    isConfigured,
    showLoading,
    templates,
    templateTags,
    teams,
    activeTeams,
    teamLookup,
    filteredTemplates,
    activeFilterCount,

    searchQuery,
    setSearchQuery,
    filterCategory,
    setFilterCategory,
    filterTeamId,
    setFilterTeamId,
    filterActiveStatus,
    setFilterActiveStatus,
    filterTagIds,
    setFilterTagIds,

    createDialogOpen,
    setCreateDialogOpen,
    editingTemplateId,
    previewTemplate,
    setPreviewTemplate,
    metaDialogTemplate,
    setMetaDialogTemplate,
    metaFriendlyName,
    setMetaFriendlyName,
    metaTagIds,
    setMetaTagIds,
    tagManagerOpen,
    setTagManagerOpen,
    newTagName,
    setNewTagName,
    newTagColor,
    setNewTagColor,

    createStep,
    setCreateStep,
    form,
    setForm,
    bodyTextareaRef,
    previewText,

    syncMutation,
    createMutation,
    submitMutation,
    deleteMutation,
    updateMutation,
    metadataMutation,
    createTagMutation,
    deleteTagMutation,

    closeCreateDialog,
    duplicateTemplate,
    editTemplate,
    onSubmitCreate,
    openMetadataDialog,

    addVariable,
    removeVariable,
    updateVariable,
    addButton,
    removeButton,
    updateButton,
    insertFieldAtCursor,

    qrCount,
    ctaCount,
    hasMixedButtons,
    canAddQR,
    canAddCTA,
    fieldNamesValid,
    fieldNamesUnique,
    buttonsValid,
    step1Valid,
  };
}
