import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleBadge } from "@/components/ui/toggle-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, ArrowLeft, ArrowRight, Phone, Link, Reply, ChevronDown } from "lucide-react";
import type { TemplateVariable, TemplateFieldType, TemplateButton, TemplateButtonType } from "@shared/schema";
import { templateFieldTypes, DEFAULT_VALUE_KEYWORDS } from "@shared/schema";
import type { TemplateFormState } from "@/hooks/useTemplateManager";

export function WhatsAppBubblePreview({ text }: { text: string }) {
  return (
    <div className="flex justify-start p-4" data-testid="whatsapp-bubble-preview">
      <div className="relative max-w-xs rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 shadow-sm border border-emerald-100 dark:border-emerald-900/50">
        <div className="absolute -top-1 start-3 w-3 h-3 bg-emerald-50 dark:bg-emerald-950/40 border-t border-s border-emerald-100 dark:border-emerald-900/50 rotate-45" />
        <p className="text-sm text-foreground whitespace-pre-wrap relative z-10" dir="auto">
          {text || "..."}
        </p>
        <div className="flex justify-end mt-1">
          <span className="text-[10px] text-muted-foreground">12:00</span>
        </div>
      </div>
    </div>
  );
}

export interface TemplateEditorProps {
  open: boolean;
  editingTemplateId: string | null;
  createStep: number;
  setCreateStep: (fn: ((s: number) => number) | number) => void;
  form: TemplateFormState;
  setForm: (fn: ((prev: TemplateFormState) => TemplateFormState) | TemplateFormState) => void;
  bodyTextareaRef: React.RefObject<HTMLTextAreaElement>;
  previewText: string;
  activeTeams: { _id: string; name: string; color: string; active: boolean }[];
  step1Valid: boolean;
  qrCount: number;
  ctaCount: number;
  hasMixedButtons: boolean;
  canAddQR: boolean;
  canAddCTA: boolean;
  fieldNamesValid: boolean;
  fieldNamesUnique: boolean;
  createMutationPending: boolean;
  updateMutationPending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  addVariable: () => void;
  removeVariable: (idx: number) => void;
  updateVariable: (idx: number, patch: Partial<TemplateVariable>) => void;
  addButton: (type: TemplateButtonType) => void;
  removeButton: (idx: number) => void;
  updateButton: (idx: number, patch: Partial<TemplateButton>) => void;
  insertFieldAtCursor: (fieldName: string) => void;
}

export function TemplateEditor({
  open,
  editingTemplateId,
  createStep,
  setCreateStep,
  form,
  setForm,
  bodyTextareaRef,
  previewText,
  activeTeams,
  step1Valid,
  qrCount,
  ctaCount,
  hasMixedButtons,
  canAddQR,
  canAddCTA,
  fieldNamesValid,
  fieldNamesUnique,
  createMutationPending,
  updateMutationPending,
  onClose,
  onSubmit,
  addVariable,
  removeVariable,
  updateVariable,
  addButton,
  removeButton,
  updateButton,
  insertFieldAtCursor,
}: TemplateEditorProps) {
  const { t } = useTranslation();
  const fieldNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{editingTemplateId ? t("waTemplates.editTitle") : t("waTemplates.createTitle")}</DialogTitle>
          <DialogDescription>{editingTemplateId ? t("waTemplates.editDesc") : t("waTemplates.createDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2 py-2" data-testid="step-indicator">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors ${createStep === s ? "border-primary bg-primary text-primary-foreground" : createStep > s ? "border-primary bg-primary/20 text-primary" : "border-muted-foreground/30 text-muted-foreground"}`}>
                {s}
              </div>
              <span className={`text-xs hidden sm:inline ${createStep === s ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {s === 1 ? t("waTemplates.step1Title", "Fields & Buttons") : s === 2 ? t("waTemplates.step2Title", "Message Body") : t("waTemplates.step3Title", "Review")}
              </span>
              {s < 3 && <div className="w-8 h-px bg-muted-foreground/30" />}
            </div>
          ))}
        </div>

        <div className="overflow-y-auto flex-1">
          {createStep === 1 && (
            <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("waTemplates.templateName")}</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") }))}
                      placeholder="order_confirmation"
                      dir="ltr"
                      data-testid="input-template-name"
                    />
                  </div>
                  <div>
                    <Label>{t("waTemplates.friendlyName")}</Label>
                    <Input
                      value={form.friendlyName}
                      onChange={(e) => setForm((prev) => ({ ...prev, friendlyName: e.target.value }))}
                      placeholder={t("waTemplates.friendlyNamePlaceholder")}
                      dir="auto"
                      data-testid="input-friendly-name"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t("waTemplates.category")}</Label>
                    <Select value={form.category} onValueChange={(v) => setForm((prev) => ({ ...prev, category: v }))}>
                      <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTILITY">UTILITY</SelectItem>
                        <SelectItem value="MARKETING">MARKETING</SelectItem>
                        <SelectItem value="AUTHENTICATION">AUTHENTICATION</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("waTemplates.language")}</Label>
                    <Select value={form.language} onValueChange={(v) => setForm((prev) => ({ ...prev, language: v }))}>
                      <SelectTrigger data-testid="select-language"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="he">Hebrew</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">Arabic</SelectItem>
                        <SelectItem value="en_US">English (US)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-3">
                  {activeTeams.length > 0 && (
                    <div className="flex-1">
                      <Label>{t("waTemplates.department")}</Label>
                      <Select value={form.teamId || "none"} onValueChange={(v) => setForm((prev) => ({ ...prev, teamId: v === "none" ? "" : v }))}>
                        <SelectTrigger data-testid="select-template-department">
                          <SelectValue placeholder={t("waTemplates.selectDepartment")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("waTemplates.selectDepartment")}</SelectItem>
                          {activeTeams.map((team) => (
                            <SelectItem key={team._id} value={team._id} data-testid={`select-template-dept-${team._id}`}>
                              {team.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex items-end gap-2 pb-1">
                    <ToggleBadge
                      checked={form.isActive}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isActive: checked }))}
                      labels={{ on: t("waTemplates.active"), off: t("waTemplates.inactive") }}
                      data-testid="switch-template-active"
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">{t("waTemplates.fieldConfiguration")}</Label>
                    <Button size="sm" variant="outline" onClick={addVariable} data-testid="button-add-field">
                      <Plus className="h-3.5 w-3.5 me-1" />
                      {t("waTemplates.addField", "Add Field")}
                    </Button>
                  </div>
                  {form.variables.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">{t("waTemplates.noFieldsDefined", "No dynamic fields defined yet. Add fields that will be inserted into the message body.")}</p>
                  )}
                  {form.variables.map((v, idx) => {
                    const nameValid = fieldNameRegex.test(v.fieldName);
                    const nameDup = form.variables.filter((vv) => vv.fieldName === v.fieldName).length > 1;
                    return (
                      <div key={idx} className="border rounded-lg p-3 space-y-2" data-testid={`field-row-${idx}`}>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 text-xs">{v.index}</Badge>
                          <div className="flex-1">
                            <Input
                              value={v.fieldName}
                              onChange={(e) => updateVariable(idx, { fieldName: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })}
                              placeholder="CustomerName"
                              dir="ltr"
                              className={`h-8 text-sm font-mono ${!nameValid || nameDup ? "border-destructive" : ""}`}
                              data-testid={`input-field-name-${idx}`}
                            />
                          </div>
                          <div className="flex-1">
                            <Input
                              value={v.friendlyLabel}
                              onChange={(e) => updateVariable(idx, { friendlyLabel: e.target.value })}
                              placeholder={t("waTemplates.friendlyLabel")}
                              dir="auto"
                              className="h-8 text-sm"
                              data-testid={`input-friendly-label-${idx}`}
                            />
                          </div>
                          <Select value={v.fieldType} onValueChange={(val) => updateVariable(idx, { fieldType: val as TemplateFieldType })}>
                            <SelectTrigger className="w-28 h-8 text-xs" data-testid={`select-field-type-${idx}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {templateFieldTypes.map((ft) => (
                                <SelectItem key={ft} value={ft}>{t(`waTemplates.fieldType_${ft}`, ft)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeVariable(idx)} data-testid={`button-remove-field-${idx}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {v.fieldType === "SELECT" && (
                          <div>
                            <Input
                              value={(v.options || []).join(", ")}
                              onChange={(e) => updateVariable(idx, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                              placeholder={t("waTemplates.optionsPlaceholder", "Option1, Option2, Option3")}
                              dir="auto"
                              className="h-7 text-xs"
                              data-testid={`input-options-${idx}`}
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <ToggleBadge
                              checked={v.hasDefault}
                              onCheckedChange={(checked) => updateVariable(idx, { hasDefault: checked, defaultValue: checked ? "" : undefined })}
                              labels={{ on: t("waTemplates.hasDefault"), off: t("waTemplates.hasDefault") }}
                              data-testid={`switch-has-default-${idx}`}
                            />
                          </div>
                          {v.hasDefault && (
                            <div className="flex-1">
                              {v.fieldType === "DATE" ? (
                                <Select value={v.defaultValue || ""} onValueChange={(val) => updateVariable(idx, { defaultValue: val })}>
                                  <SelectTrigger className="h-7 text-xs" data-testid={`select-default-${idx}`}><SelectValue placeholder={t("waTemplates.selectDefault")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="CURRENT_DATE">{t("waTemplates.keyword_CURRENT_DATE", "Current Date")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : v.fieldType === "CHECKBOX" ? (
                                <Select value={v.defaultValue || ""} onValueChange={(val) => updateVariable(idx, { defaultValue: val })}>
                                  <SelectTrigger className="h-7 text-xs" data-testid={`select-default-${idx}`}><SelectValue placeholder={t("waTemplates.selectDefault")} /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="true">{t("common.yes", "Yes")}</SelectItem>
                                    <SelectItem value="false">{t("common.no", "No")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Select value={v.defaultValue || "___custom___"} onValueChange={(val) => updateVariable(idx, { defaultValue: val === "___custom___" ? "" : val })}>
                                  <SelectTrigger className="h-7 text-xs" data-testid={`select-default-${idx}`}><SelectValue placeholder={t("waTemplates.selectDefault")} /></SelectTrigger>
                                  <SelectContent>
                                    {DEFAULT_VALUE_KEYWORDS.map((kw) => (
                                      <SelectItem key={kw} value={kw}>{t(`waTemplates.keyword_${kw}`, kw)}</SelectItem>
                                    ))}
                                    <SelectItem value="___custom___">{t("waTemplates.customValue", "Custom Value")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          )}
                          {v.hasDefault && v.defaultValue === "" && v.fieldType !== "DATE" && v.fieldType !== "CHECKBOX" && (
                            <Input
                              value=""
                              onChange={(e) => updateVariable(idx, { defaultValue: e.target.value })}
                              placeholder={t("waTemplates.enterDefault")}
                              className="h-7 text-xs flex-1"
                              dir="auto"
                              data-testid={`input-default-custom-${idx}`}
                            />
                          )}
                        </div>
                        {(!nameValid || nameDup) && (
                          <p className="text-xs text-destructive">
                            {!nameValid ? t("waTemplates.fieldNameInvalid", "Field name must start with a letter (English only, letters/digits/underscores)") : t("waTemplates.fieldNameDuplicate", "Duplicate field name")}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">{t("waTemplates.buttonBuilder", "Buttons")}</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" disabled={!canAddQR && !canAddCTA} data-testid="button-add-button">
                          <Plus className="h-3.5 w-3.5 me-1" />
                          {t("waTemplates.addButton", "Add Button")}
                          <ChevronDown className="h-3 w-3 ms-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={!canAddQR} onClick={() => addButton("QUICK_REPLY")} data-testid="menu-add-quick-reply">
                          <Reply className="h-4 w-4 me-2" />
                          {t("waTemplates.btnQuickReply", "Quick Reply")} ({qrCount}/3)
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canAddCTA} onClick={() => addButton("URL")} data-testid="menu-add-url">
                          <Link className="h-4 w-4 me-2" />
                          {t("waTemplates.btnUrl", "URL")} ({ctaCount}/2 CTA)
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!canAddCTA} onClick={() => addButton("PHONE_NUMBER")} data-testid="menu-add-phone">
                          <Phone className="h-4 w-4 me-2" />
                          {t("waTemplates.btnPhone", "Phone Number")} ({ctaCount}/2 CTA)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {form.buttons.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2">{t("waTemplates.noButtonsDefined", "No buttons defined. Buttons appear at the bottom of the WhatsApp message.")}</p>
                  )}
                  {form.buttons.map((btn, idx) => (
                    <div key={idx} className="border rounded-lg p-3 space-y-2" data-testid={`button-row-${idx}`}>
                      <div className="flex items-center gap-2">
                        <Badge variant={btn.type === "QUICK_REPLY" ? "secondary" : "default"} className="shrink-0 text-xs">
                          {btn.type === "QUICK_REPLY" ? t("waTemplates.btnQuickReply", "Quick Reply") : btn.type === "URL" ? t("waTemplates.btnUrl", "URL") : t("waTemplates.btnPhone", "Phone")}
                        </Badge>
                        <Input
                          value={btn.text}
                          onChange={(e) => updateButton(idx, { text: e.target.value })}
                          placeholder={t("waTemplates.buttonLabel", "Button label")}
                          dir="auto"
                          className={`h-8 text-sm flex-1 ${!btn.text.trim() ? "border-destructive" : ""}`}
                          data-testid={`input-button-text-${idx}`}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeButton(idx)} data-testid={`button-remove-btn-${idx}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {btn.type === "URL" && (
                        <div className="flex items-center gap-2">
                          <Input
                            value={btn.url || ""}
                            onChange={(e) => updateButton(idx, { url: e.target.value })}
                            placeholder="https://example.com/page"
                            dir="ltr"
                            className={`h-7 text-xs flex-1 ${!(btn.url || "").trim() ? "border-destructive" : ""}`}
                            data-testid={`input-button-url-${idx}`}
                          />
                          <ToggleBadge
                            checked={btn.urlDynamic || false}
                            onCheckedChange={(checked) => updateButton(idx, { urlDynamic: checked })}
                            labels={{ on: t("waTemplates.dynamicUrl", "Dynamic"), off: t("waTemplates.dynamicUrl", "Dynamic") }}
                            data-testid={`switch-url-dynamic-${idx}`}
                          />
                        </div>
                      )}
                      {btn.type === "PHONE_NUMBER" && (
                        <Input
                          value={btn.phoneNumber || ""}
                          onChange={(e) => updateButton(idx, { phoneNumber: e.target.value })}
                          placeholder="+972501234567"
                          dir="ltr"
                          className={`h-7 text-xs ${!(btn.phoneNumber || "").trim() ? "border-destructive" : ""}`}
                          data-testid={`input-button-phone-${idx}`}
                        />
                      )}
                      {btn.type === "QUICK_REPLY" && (
                        <Input
                          value={btn.payload || ""}
                          onChange={(e) => updateButton(idx, { payload: e.target.value })}
                          placeholder={t("waTemplates.payloadPlaceholder", "Payload identifier (for webhook)")}
                          dir="ltr"
                          className="h-7 text-xs"
                          data-testid={`input-button-payload-${idx}`}
                        />
                      )}
                    </div>
                  ))}
                  {hasMixedButtons && (
                    <p className="text-xs text-destructive pt-1">{t("waTemplates.mixedButtonsError", "Cannot mix Quick Reply and Call-to-Action buttons (URL/Phone) in the same template.")}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("waTemplates.livePreview")}</Label>
                <div className="rounded-lg wa-preview-bg p-4 min-h-[200px]">
                  <WhatsAppBubblePreview text={previewText} />
                  {form.buttons.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {form.buttons.map((btn, i) => (
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
                {form.variables.length > 0 && (
                  <div className="space-y-1 pt-2">
                    <Label className="text-xs text-muted-foreground">{t("waTemplates.fieldMapping")}</Label>
                    {form.variables.map((v) => (
                      <div key={v.fieldName} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="shrink-0 font-mono">{`{{${v.fieldName}}}`}</Badge>
                        <span className="text-muted-foreground">&rarr;</span>
                        <span className="font-medium">{v.friendlyLabel || v.fieldName}</span>
                        <Badge variant="secondary" className="text-[10px]">{v.fieldType}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {createStep === 2 && (
            <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
              <div className="space-y-3">
                {form.variables.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{t("waTemplates.clickToInsert", "Click a field to insert it into the message:")}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {form.variables.map((v) => (
                        <Badge
                          key={v.fieldName}
                          variant="outline"
                          className="cursor-pointer select-none hover:bg-primary/10 transition-colors px-3 py-1"
                          onClick={() => insertFieldAtCursor(v.fieldName)}
                          data-testid={`chip-field-${v.fieldName}`}
                        >
                          <Plus className="h-3 w-3 me-1" />
                          {v.friendlyLabel || v.fieldName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <Label>{t("waTemplates.rawBodyContent")}</Label>
                  <Textarea
                    ref={bodyTextareaRef}
                    value={form.rawBodyContent}
                    onChange={(e) => setForm((prev) => ({ ...prev, rawBodyContent: e.target.value }))}
                    placeholder={t("waTemplates.rawBodyPlaceholder")}
                    rows={10}
                    dir={["he", "ar"].includes(form.language) ? "rtl" : "ltr"}
                    data-testid="input-raw-body"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{t("waTemplates.insertFieldHint", "Click the field chips above to insert dynamic placeholders into your message.")}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("waTemplates.livePreview")}</Label>
                <div className="rounded-lg wa-preview-bg p-4 min-h-[200px]">
                  <WhatsAppBubblePreview text={previewText} />
                  {form.buttons.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {form.buttons.map((btn, i) => (
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
            </div>
          )}

          {createStep === 3 && (
            <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">{t("waTemplates.templateName")}</Label>
                  <p className="text-sm font-mono" data-testid="review-name">{form.name}</p>
                </div>
                {form.friendlyName && (
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold">{t("waTemplates.friendlyName")}</Label>
                    <p className="text-sm" dir="auto" data-testid="review-friendly-name">{form.friendlyName}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Badge variant="outline">{form.category}</Badge>
                  <Badge variant="outline">{form.language}</Badge>
                </div>
                {form.variables.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">{t("waTemplates.fieldConfiguration")}</Label>
                    {form.variables.map((v) => (
                      <div key={v.fieldName} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="font-mono">{`{{${v.fieldName}}}`}</Badge>
                        <span className="font-medium">{v.friendlyLabel || v.fieldName}</span>
                        <Badge variant="secondary" className="text-xs">{v.fieldType}</Badge>
                        {v.hasDefault && v.defaultValue && <span className="text-muted-foreground text-xs">= {v.defaultValue}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {form.buttons.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">{t("waTemplates.buttonBuilder", "Buttons")}</Label>
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant={btn.type === "QUICK_REPLY" ? "secondary" : "default"} className="text-xs">{btn.type}</Badge>
                        <span className="font-medium">{btn.text}</span>
                        {btn.type === "URL" && btn.url && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{btn.url}</span>}
                        {btn.type === "PHONE_NUMBER" && btn.phoneNumber && <span className="text-xs text-muted-foreground">{btn.phoneNumber}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-sm font-semibold">{t("waTemplates.rawBodyContent")}</Label>
                  <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3 border" dir="auto" data-testid="review-body">
                    {form.rawBodyContent || "\u2014"}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("waTemplates.livePreview")}</Label>
                <div className="rounded-lg wa-preview-bg p-4 min-h-[200px]">
                  <WhatsAppBubblePreview text={previewText} />
                  {form.buttons.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {form.buttons.map((btn, i) => (
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
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-3 border-t">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <div className="flex-1" />
          {createStep > 1 && (
            <Button variant="outline" onClick={() => setCreateStep((s) => s - 1)} data-testid="button-prev-step">
              <ArrowRight className="h-4 w-4 me-1 rtl:rotate-180" />
              {t("waTemplates.prevStep", "Back")}
            </Button>
          )}
          {createStep < 3 && (
            <Button
              onClick={() => setCreateStep((s) => s + 1)}
              disabled={createStep === 1 && !step1Valid}
              data-testid="button-next-step"
            >
              {t("waTemplates.nextStep", "Next")}
              <ArrowLeft className="h-4 w-4 ms-1 rtl:rotate-180" />
            </Button>
          )}
          {createStep === 3 && (
            <Button
              onClick={onSubmit}
              disabled={(createMutationPending || updateMutationPending) || !form.name || !form.rawBodyContent}
              data-testid="button-submit-create"
            >
              {(createMutationPending || updateMutationPending)
                ? t("common.saving")
                : editingTemplateId ? t("common.save") : t("common.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
