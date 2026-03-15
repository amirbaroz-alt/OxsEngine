import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useBackofficeAuth } from "@/lib/backoffice-auth";
import { Building2, Plus, Pencil, Check, X, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ToggleBadge } from "@/components/ui/toggle-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Tenant {
  _id: string;
  nameHe: string;
  nameEn: string;
  slug: string;
  defaultLanguage: string;
  active: boolean;
  monthlyMessageQuota: number;
  messagesUsedThisMonth: number;
  smsConfig?: { userName?: string; accessToken?: string; source?: string };
  mailConfig?: { sendGridKey?: string; fromEmail?: string; fromName?: string };
  whatsappConfig?: { phoneNumberId?: string; accessToken?: string; verifyToken?: string; wabaId?: string };
  quotaGuardConfig?: { proxyUrl?: string; enabled?: boolean };
}

type Section = "general" | "sms" | "email" | "whatsapp" | "proxy";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "general", label: "General" },
  { key: "sms", label: "SMS (019)" },
  { key: "email", label: "Email (SendGrid)" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "proxy", label: "Proxy" },
];

const EMPTY_FORM: Partial<Tenant> = {
  nameHe: "",
  nameEn: "",
  slug: "",
  defaultLanguage: "he",
  active: true,
  monthlyMessageQuota: 10000,
  smsConfig: { userName: "", accessToken: "", source: "" },
  mailConfig: { sendGridKey: "", fromEmail: "", fromName: "" },
  whatsappConfig: { phoneNumberId: "", accessToken: "", verifyToken: "", wabaId: "" },
  quotaGuardConfig: { proxyUrl: "", enabled: false },
};

function SectionBlock({
  sectionKey,
  label,
  open,
  onToggle,
  children,
}: {
  sectionKey: Section;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/70 text-sm font-medium transition-colors"
      >
        {label}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default function BackofficeTenantsPage() {
  const { token } = useBackofficeAuth();
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Tenant>>(EMPTY_FORM);
  const [openSections, setOpenSections] = useState<Set<Section>>(new Set(["general"]));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/tenants", { headers });
      const data = await res.json();
      if (data.success) setTenants(data.data);
      else setError(t("backoffice.tenants.errorLoadFailed"));
    } catch {
      setError(t("backoffice.tenants.errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpenSections(new Set(["general"]));
    setFormError("");
    setSheetOpen(true);
  }

  function openEdit(tenant: Tenant) {
    setEditingId(tenant._id);
    setForm({
      nameHe: tenant.nameHe,
      nameEn: tenant.nameEn,
      slug: tenant.slug,
      defaultLanguage: tenant.defaultLanguage,
      active: tenant.active,
      monthlyMessageQuota: tenant.monthlyMessageQuota,
      smsConfig: { ...EMPTY_FORM.smsConfig, ...tenant.smsConfig },
      mailConfig: { ...EMPTY_FORM.mailConfig, ...tenant.mailConfig },
      whatsappConfig: { ...EMPTY_FORM.whatsappConfig, ...tenant.whatsappConfig },
      quotaGuardConfig: { ...EMPTY_FORM.quotaGuardConfig, ...tenant.quotaGuardConfig },
    });
    setOpenSections(new Set(["general"]));
    setFormError("");
    setSheetOpen(true);
  }

  function set(path: string, value: any) {
    setForm((prev) => {
      const parts = path.split(".");
      if (parts.length === 1) return { ...prev, [path]: value };
      const [top, sub] = parts;
      return { ...prev, [top]: { ...(prev as any)[top], [sub]: value } };
    });
  }

  async function handleSave() {
    setFormError("");
    if (!form.nameHe || !form.nameEn || !form.slug) {
      setFormError(t("backoffice.tenants.validationRequired"));
      return;
    }
    setSaving(true);
    try {
      const url = editingId
        ? `/api/v1/admin/tenants/${editingId}`
        : "/api/v1/admin/tenants";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      const data = await res.json();
      if (!data.success) {
        setFormError(data.error === "SLUG_EXISTS" ? t("backoffice.tenants.errorSlugTaken") : data.error || t("backoffice.tenants.errorSaveFailed"));
        return;
      }
      setSheetOpen(false);
      loadTenants();
    } catch {
      setFormError(t("backoffice.tenants.errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(tenant: Tenant) {
    try {
      await fetch(`/api/v1/admin/tenants/${tenant._id}/active`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ active: !tenant.active }),
      });
      loadTenants();
    } catch {}
  }

  function toggleSection(s: Section) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  const v = form as any;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("backoffice.tenants.title")}</h1>
          <Badge variant="secondary">{tenants.length}</Badge>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t("backoffice.tenants.newTenant")}
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.tenants.colName")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.tenants.colSlug")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.tenants.colLang")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.tenants.colQuota")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.tenants.colActive")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t("backoffice.tenants.noTenants")}
                  </td>
                </tr>
              )}
              {tenants.map((tenant, i) => (
                <tr key={tenant._id} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{tenant.nameEn}</div>
                    <div className="text-xs text-muted-foreground">{tenant.nameHe}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{tenant.slug}</td>
                  <td className="px-4 py-2.5 uppercase text-xs">{tenant.defaultLanguage}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {(tenant.messagesUsedThisMonth ?? 0).toLocaleString()} / {(tenant.monthlyMessageQuota ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <ToggleBadge checked={tenant.active} onCheckedChange={() => toggleActive(tenant)} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={() => openEdit(tenant)}>
                      <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? t("backoffice.tenants.editTenant") : t("backoffice.tenants.newTenant")}</SheetTitle>
          </SheetHeader>

          <div className="space-y-3 py-4">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {/* GENERAL */}
            <SectionBlock sectionKey="general" label={t("backoffice.tenants.sectionGeneral")} open={openSections.has("general")} onToggle={() => toggleSection("general")}>
              <Field label={t("backoffice.tenants.fieldNameHe")}>
                <Input value={v.nameHe} onChange={(e) => set("nameHe", e.target.value)} dir="rtl" />
              </Field>
              <Field label={t("backoffice.tenants.fieldNameEn")}>
                <Input value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
              </Field>
              <Field label={t("backoffice.tenants.fieldSlug")}>
                <Input value={v.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="acme" disabled={!!editingId} />
              </Field>
              <Field label={t("backoffice.tenants.fieldDefaultLang")}>
                <Select value={v.defaultLanguage} onValueChange={(val) => set("defaultLanguage", val)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["he", "en", "ar", "ru", "tr"].map((l) => (
                      <SelectItem key={l} value={l}>{l.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("backoffice.tenants.fieldMonthlyQuota")}>
                <Input type="number" value={v.monthlyMessageQuota} onChange={(e) => set("monthlyMessageQuota", Number(e.target.value))} />
              </Field>
              <ToggleBadge
                checked={v.active}
                onCheckedChange={(val) => set("active", val)}
                labels={{ on: t("backoffice.tenants.active"), off: t("backoffice.tenants.inactive") }}
              />
            </SectionBlock>

            {/* SMS */}
            <SectionBlock sectionKey="sms" label={t("backoffice.tenants.sectionSms")} open={openSections.has("sms")} onToggle={() => toggleSection("sms")}>
              <Field label={t("backoffice.tenants.fieldSmsUsername")}>
                <Input value={v.smsConfig?.userName || ""} onChange={(e) => set("smsConfig.userName", e.target.value)} />
              </Field>
              <Field label={t("backoffice.tenants.fieldSmsPassword")}>
                <Input value={v.smsConfig?.accessToken || ""} onChange={(e) => set("smsConfig.accessToken", e.target.value)} type="password" placeholder={v.smsConfig?.accessToken?.startsWith("****") ? "leave blank to keep" : ""} />
              </Field>
              <Field label={t("backoffice.tenants.fieldSmsSender")}>
                <Input value={v.smsConfig?.source || ""} onChange={(e) => set("smsConfig.source", e.target.value)} placeholder="0559379120" />
              </Field>
            </SectionBlock>

            {/* EMAIL */}
            <SectionBlock sectionKey="email" label={t("backoffice.tenants.sectionEmail")} open={openSections.has("email")} onToggle={() => toggleSection("email")}>
              <Field label={t("backoffice.tenants.fieldSendGridKey")}>
                <Input value={v.mailConfig?.sendGridKey || ""} onChange={(e) => set("mailConfig.sendGridKey", e.target.value)} type="password" placeholder={v.mailConfig?.sendGridKey?.startsWith("****") ? "leave blank to keep" : ""} />
              </Field>
              <Field label={t("backoffice.tenants.fieldFromEmail")}>
                <Input value={v.mailConfig?.fromEmail || ""} onChange={(e) => set("mailConfig.fromEmail", e.target.value)} type="email" />
              </Field>
              <Field label={t("backoffice.tenants.fieldFromName")}>
                <Input value={v.mailConfig?.fromName || ""} onChange={(e) => set("mailConfig.fromName", e.target.value)} />
              </Field>
            </SectionBlock>

            {/* WHATSAPP */}
            <SectionBlock sectionKey="whatsapp" label={t("backoffice.tenants.sectionWhatsapp")} open={openSections.has("whatsapp")} onToggle={() => toggleSection("whatsapp")}>
              <Field label={t("backoffice.tenants.fieldPhoneNumberId")}>
                <Input value={v.whatsappConfig?.phoneNumberId || ""} onChange={(e) => set("whatsappConfig.phoneNumberId", e.target.value)} />
              </Field>
              <Field label={t("backoffice.tenants.fieldAccessToken")}>
                <Input value={v.whatsappConfig?.accessToken || ""} onChange={(e) => set("whatsappConfig.accessToken", e.target.value)} type="password" placeholder={v.whatsappConfig?.accessToken?.startsWith("****") ? "leave blank to keep" : ""} />
              </Field>
              <Field label={t("backoffice.tenants.fieldVerifyToken")}>
                <Input value={v.whatsappConfig?.verifyToken || ""} onChange={(e) => set("whatsappConfig.verifyToken", e.target.value)} type="password" placeholder={v.whatsappConfig?.verifyToken?.startsWith("****") ? "leave blank to keep" : ""} />
              </Field>
              <Field label={t("backoffice.tenants.fieldWabaId")}>
                <Input value={v.whatsappConfig?.wabaId || ""} onChange={(e) => set("whatsappConfig.wabaId", e.target.value)} />
              </Field>
            </SectionBlock>

            {/* PROXY */}
            <SectionBlock sectionKey="proxy" label={t("backoffice.tenants.sectionProxy")} open={openSections.has("proxy")} onToggle={() => toggleSection("proxy")}>
              <Field label={t("backoffice.tenants.fieldProxyUrl")}>
                <Input value={v.quotaGuardConfig?.proxyUrl || ""} onChange={(e) => set("quotaGuardConfig.proxyUrl", e.target.value)} type="password" placeholder={v.quotaGuardConfig?.proxyUrl?.startsWith("****") ? "leave blank to keep" : "socks5://user:pass@host:port"} />
              </Field>
              <ToggleBadge
                checked={v.quotaGuardConfig?.enabled || false}
                onCheckedChange={(val) => set("quotaGuardConfig.enabled", val)}
                labels={{ on: t("backoffice.tenants.proxyEnabled"), off: t("backoffice.tenants.proxyDisabled") }}
              />
            </SectionBlock>
          </div>

          <SheetFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
              <X className="h-4 w-4 mr-1" /> {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editingId ? t("backoffice.tenants.saveChanges") : t("backoffice.tenants.createTenant")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
