import type { TemplateVariable, TemplateButton, TemplateFieldType, TemplateButtonType } from "@shared/schema";

export interface TemplateFormState {
  name: string;
  friendlyName: string;
  category: string;
  language: string;
  rawBodyContent: string;
  variables: TemplateVariable[];
  buttons: TemplateButton[];
  isActive: boolean;
  teamId: string;
}

export const INITIAL_FORM: TemplateFormState = {
  name: "",
  friendlyName: "",
  category: "UTILITY",
  language: "he",
  rawBodyContent: "",
  variables: [],
  buttons: [],
  isActive: true,
  teamId: "",
};

export interface FilterOptions {
  searchQuery: string;
  filterCategory: string;
  filterTeamId: string;
  filterActiveStatus: string;
  filterTagIds: string[];
}

export function applyTemplateFilter<T extends {
  name: string;
  friendlyName?: string;
  bodyText?: string;
  category?: string;
  teamId?: string;
  isActive?: boolean;
  tagIds?: string[];
  createdAt?: string | Date;
}>(templates: T[], opts: FilterOptions): T[] {
  const { searchQuery, filterCategory, filterTeamId, filterActiveStatus, filterTagIds } = opts;

  const filtered = templates.filter((tpl) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = tpl.name.toLowerCase().includes(q);
      const matchFriendly = tpl.friendlyName?.toLowerCase().includes(q);
      const matchBody = tpl.bodyText?.toLowerCase().includes(q);
      if (!matchName && !matchFriendly && !matchBody) return false;
    }
    if (filterCategory !== "ALL" && tpl.category !== filterCategory) return false;
    if (filterTeamId !== "ALL" && tpl.teamId !== filterTeamId) return false;
    if (filterActiveStatus === "ACTIVE" && tpl.isActive === false) return false;
    if (filterActiveStatus === "INACTIVE" && tpl.isActive !== false) return false;
    if (filterTagIds.length > 0) {
      const tplTagIds = tpl.tagIds || [];
      if (!filterTagIds.some((fId) => tplTagIds.includes(fId))) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
    return db - da;
  });

  return filtered;
}

export function addVariableToForm(form: TemplateFormState): TemplateFormState {
  const nextOrder = form.variables.length + 1;
  const newVar: TemplateVariable = {
    index: nextOrder,
    fieldName: `Field${nextOrder}`,
    fieldType: "TEXT",
    friendlyLabel: "",
    order: nextOrder,
    hasDefault: false,
  };
  return { ...form, variables: [...form.variables, newVar] };
}

export function removeVariableFromForm(form: TemplateFormState, idx: number): TemplateFormState {
  const updated = form.variables.filter((_, i) => i !== idx);
  updated.forEach((v, i) => { v.index = i + 1; v.order = i + 1; });
  return { ...form, variables: updated };
}

export function updateVariableInForm(form: TemplateFormState, idx: number, patch: Partial<TemplateVariable>): TemplateFormState | null {
  const updated = [...form.variables];
  const oldVar = updated[idx];
  if (patch.fieldName !== undefined) {
    const sanitized = patch.fieldName.replace(/[^A-Za-z0-9_]/g, "");
    if (sanitized && sanitized !== oldVar.fieldName) {
      const collision = updated.some((v, i) => i !== idx && v.fieldName === sanitized);
      if (collision) return null;
    }
    patch = { ...patch, fieldName: sanitized };
  }
  updated[idx] = { ...oldVar, ...patch };
  let newRawBody = form.rawBodyContent;
  if (patch.fieldName && patch.fieldName !== oldVar.fieldName && oldVar.fieldName) {
    const escaped = oldVar.fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    newRawBody = newRawBody.replace(
      new RegExp(`\\{\\{${escaped}\\}\\}`, "g"),
      `{{${patch.fieldName}}}`
    );
  }
  return { ...form, variables: updated, rawBodyContent: newRawBody };
}

export function validateStep1(form: TemplateFormState): { step1Valid: boolean; fieldNamesValid: boolean; fieldNamesUnique: boolean; buttonsValid: boolean; hasMixedButtons: boolean } {
  const fieldNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
  const fieldNamesValid = form.variables.every((v) => fieldNameRegex.test(v.fieldName));
  const fieldNamesUnique = new Set(form.variables.map((v) => v.fieldName)).size === form.variables.length;
  const qrCount = form.buttons.filter((b) => b.type === "QUICK_REPLY").length;
  const ctaCount = form.buttons.filter((b) => b.type === "URL" || b.type === "PHONE_NUMBER").length;
  const hasMixedButtons = qrCount > 0 && ctaCount > 0;
  const buttonsValid = form.buttons.every((b) => {
    if (!b.text.trim()) return false;
    if (b.type === "URL" && !(b.url || "").trim()) return false;
    if (b.type === "PHONE_NUMBER" && !(b.phoneNumber || "").trim()) return false;
    return true;
  }) && !hasMixedButtons;
  const step1Valid = form.name.trim().length > 0 && fieldNamesValid && fieldNamesUnique && buttonsValid;
  return { step1Valid, fieldNamesValid, fieldNamesUnique, buttonsValid, hasMixedButtons };
}

export function buildSubmitPayload(form: TemplateFormState, tenantId: string) {
  return {
    tenantId,
    name: form.name.toLowerCase().replace(/\s+/g, "_"),
    friendlyName: form.friendlyName,
    category: form.category,
    language: form.language,
    rawBodyContent: form.rawBodyContent,
    variables: form.variables,
    buttons: form.buttons,
    isActive: form.isActive,
    teamId: form.teamId || null,
  };
}

export function buildDuplicateForm(tpl: {
  name: string;
  friendlyName?: string;
  category?: string;
  language?: string;
  rawBodyContent?: string;
  bodyText?: string;
  variables?: TemplateVariable[];
  variableMapping?: Record<string, any>;
  buttons?: TemplateButton[];
  isActive?: boolean;
  teamId?: string;
}): TemplateFormState {
  let variables = (tpl.variables || []).map((v) => ({ ...v }));
  let bodyContent = tpl.rawBodyContent || tpl.bodyText || "";

  if (variables.length === 0 && bodyContent) {
    const namedMatches = bodyContent.match(/\{\{([A-Za-z_]\w*)\}\}/g) || [];
    const seen = new Set<string>();
    namedMatches.forEach((m, idx) => {
      const fieldName = m.replace(/[{}]/g, "");
      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        variables.push({
          index: idx + 1,
          fieldName,
          fieldType: "TEXT" as TemplateFieldType,
          friendlyLabel: fieldName,
          order: idx + 1,
          hasDefault: false,
        });
      }
    });
    if (variables.length === 0) {
      const numberedMatches = bodyContent.match(/\{\{(\d+)\}\}/g) || [];
      const mapping = tpl.variableMapping || {};
      numberedMatches.forEach((m) => {
        const idx = parseInt(m.replace(/[{}]/g, ""), 10);
        if (!variables.find((v) => v.index === idx)) {
          const mapEntry = mapping[String(idx)];
          const label = typeof mapEntry === "string" ? mapEntry : (mapEntry?.label || `field_${idx}`);
          const fieldName = label.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") || `field_${idx}`;
          variables.push({
            index: idx,
            fieldName,
            fieldType: "TEXT" as TemplateFieldType,
            friendlyLabel: label,
            order: idx,
            hasDefault: false,
          });
          bodyContent = bodyContent.replace(`{{${idx}}}`, `{{${fieldName}}}`);
        }
      });
    }
  }

  return {
    name: tpl.name + "_copy",
    friendlyName: tpl.friendlyName || "",
    category: tpl.category || "UTILITY",
    language: tpl.language || "he",
    rawBodyContent: bodyContent,
    variables,
    buttons: (tpl.buttons || []).map((b) => ({ ...b })),
    isActive: tpl.isActive !== false,
    teamId: tpl.teamId || "",
  };
}
