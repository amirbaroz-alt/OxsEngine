import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical, Loader2, Save } from "lucide-react";
import type { CustomFieldDefinition, Tenant } from "@shared/schema";

const FIELD_TYPES = ["text", "number", "date", "select", "combobox", "textarea", "boolean"] as const;
const UI_WIDTHS = [3, 4, 6, 9, 12] as const;

interface CustomerFieldsEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenant: Tenant;
}

export function CustomerFieldsEditor({ open, onOpenChange, tenant }: CustomerFieldsEditorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const fieldsQuery = useQuery<CustomFieldDefinition[]>({
    queryKey: ["/api/tenants", tenant._id, "customer-fields"],
    queryFn: () =>
      apiRequest("GET", `/api/tenants/${tenant._id}/customer-fields`).then((r) => r.json()),
    enabled: open,
  });

  useEffect(() => {
    if (fieldsQuery.data && !initialized) {
      setFields(fieldsQuery.data.sort((a, b) => a.order - b.order));
      setInitialized(true);
    }
  }, [fieldsQuery.data, initialized]);

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      setFields([]);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/tenants/${tenant._id}/customer-fields`, fields).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants", tenant._id, "customer-fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      toast({ title: t("tenants.orderSaved") });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: t("common.error"), description: err.message, variant: "destructive" });
    },
  });

  const isValid = useMemo(() => {
    return fields.every((f) => f.key.trim() && f.label.trim());
  }, [fields]);

  const addField = useCallback(() => {
    const nextOrder = fields.length > 0 ? Math.max(...fields.map((f) => f.order)) + 1 : 1;
    const newField: CustomFieldDefinition = {
      key: `field_${nextOrder}`,
      label: "",
      fieldType: "text",
      uiWidth: 6,
      isFilterable: true,
      forceNewRow: false,
      order: nextOrder,
    };
    setFields((prev) => [...prev, newField]);
  }, [fields]);

  const updateField = useCallback((index: number, patch: Partial<CustomFieldDefinition>) => {
    setFields((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }, []);

  const removeField = useCallback((index: number) => {
    setFields((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((f, i) => ({ ...f, order: i + 1 }));
    });
  }, []);

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setFields((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, moved);
      return updated.map((f, i) => ({ ...f, order: i + 1 }));
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const tenantName = tenant.nameHe || tenant.nameEn;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("tenants.fieldLayout")} {tenantName}</DialogTitle>
          <DialogDescription>{t("tenants.customFieldsDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          <div className="text-sm font-medium text-primary">{t("tenants.customFields")}</div>

          {fieldsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-fields">
              {t("tenants.noFields")}
            </p>
          ) : (
            fields.map((field, idx) => (
              <div
                key={`${field.key}-${idx}`}
                className="border rounded-lg p-3 bg-card space-y-2"
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                data-testid={`card-field-${idx}`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="cursor-grab text-muted-foreground hover:text-foreground"
                    data-testid={`drag-handle-${idx}`}
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>

                  <div className="flex-1 grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("tenants.fieldKey")}</Label>
                      <Input
                        value={field.key}
                        onChange={(e) =>
                          updateField(idx, { key: e.target.value.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") })
                        }
                        dir="ltr"
                        className="h-8 text-sm"
                        data-testid={`input-field-key-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("tenants.fieldLabel")}</Label>
                      <Input
                        value={field.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        dir="auto"
                        className="h-8 text-sm"
                        data-testid={`input-field-label-${idx}`}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("tenants.fieldType")}</Label>
                      <Select
                        value={field.fieldType}
                        onValueChange={(v) => updateField(idx, { fieldType: v as any })}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`select-field-type-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((ft) => (
                            <SelectItem key={ft} value={ft}>{ft}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{t("tenants.fieldWidth")}</Label>
                      <Select
                        value={String(field.uiWidth)}
                        onValueChange={(v) => updateField(idx, { uiWidth: Number(v) as any })}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid={`select-field-width-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UI_WIDTHS.map((w) => (
                            <SelectItem key={w} value={String(w)}>{w}/12</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeField(idx)}
                    data-testid={`button-remove-field-${idx}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-4 ps-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={field.isFilterable}
                      onCheckedChange={(c) => updateField(idx, { isFilterable: !!c })}
                      data-testid={`checkbox-filterable-${idx}`}
                    />
                    <Label className="text-xs cursor-pointer">{t("tenants.fieldFilterable")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={field.forceNewRow}
                      onCheckedChange={(c) => updateField(idx, { forceNewRow: !!c })}
                      data-testid={`checkbox-new-row-${idx}`}
                    />
                    <Label className="text-xs cursor-pointer">{t("tenants.fieldForceNewRow")}</Label>
                  </div>
                </div>

                {(field.fieldType === "select" || field.fieldType === "combobox") && (
                  <div className="ps-6">
                    <Label className="text-xs text-muted-foreground">{t("tenants.fieldOptions")}</Label>
                    <Input
                      value={(field.options || []).join(", ")}
                      onChange={(e) =>
                        updateField(idx, {
                          options: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={t("tenants.optionsPlaceholder")}
                      dir="auto"
                      className="h-8 text-sm"
                      data-testid={`input-field-options-${idx}`}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3 gap-2">
          <Button variant="outline" onClick={addField} data-testid="button-add-field">
            <Plus className="h-4 w-4 me-1" />
            {t("tenants.addField")}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !isValid}
              data-testid="button-save-fields"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 me-1" />
              )}
              {t("common.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
