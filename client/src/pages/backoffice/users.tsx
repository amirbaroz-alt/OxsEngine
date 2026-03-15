import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useBackofficeAuth } from "@/lib/backoffice-auth";
import { Users, Plus, Pencil, Check, X, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ToggleBadge } from "@/components/ui/toggle-badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Tenant { _id: string; nameEn: string; nameHe: string; slug: string }
interface User {
  _id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  tenantId: string;
  tenant: Tenant | null;
  active: boolean;
  lastLoginAt?: string;
  isLocked?: boolean;
}

const ROLES = ["superadmin", "businessadmin", "teamleader", "employee"] as const;

const EMPTY_FORM = { name: "", phone: "", email: "", role: "employee", tenantId: "", active: true };

export default function BackofficeUsersPage() {
  const { token } = useBackofficeAuth();
  const { t } = useTranslation();

  const [users, setUsers] = useState<User[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterTenant, setFilterTenant] = useState("all");
  const [filterRole, setFilterRole] = useState("all");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [impersonating, setImpersonating] = useState<string | null>(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const loadTenants = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/tenants", { headers });
      const data = await res.json();
      if (data.success) setTenants(data.data);
    } catch {}
  }, [token]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterTenant !== "all") params.set("tenantId", filterTenant);
      if (filterRole !== "all") params.set("role", filterRole);
      const res = await fetch(`/api/v1/admin/users?${params}`, { headers });
      const data = await res.json();
      if (data.success) setUsers(data.data);
      else setError(t("backoffice.users.errorLoadFailed"));
    } catch {
      setError(t("backoffice.users.errorNetwork"));
    } finally {
      setLoading(false);
    }
  }, [token, filterTenant, filterRole]);

  useEffect(() => { loadTenants(); }, [loadTenants]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setSheetOpen(true);
  }

  function openEdit(user: User) {
    setEditingId(user._id);
    setForm({ name: user.name, phone: user.phone, email: user.email, role: user.role, tenantId: user.tenantId, active: user.active });
    setFormError("");
    setSheetOpen(true);
  }

  async function handleSave() {
    setFormError("");
    if (!form.name || !form.phone || !form.email || !form.role || !form.tenantId) {
      setFormError(t("backoffice.users.validationRequired"));
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/v1/admin/users/${editingId}` : "/api/v1/admin/users";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      const data = await res.json();
      if (!data.success) {
        setFormError(data.error === "DUPLICATE_USER" ? t("backoffice.users.errorDuplicate") : data.error || t("backoffice.users.errorSaveFailed"));
        return;
      }
      setSheetOpen(false);
      loadUsers();
    } catch {
      setFormError(t("backoffice.users.errorNetwork"));
    } finally {
      setSaving(false);
    }
  }

  async function handleImpersonate(user: User) {
    setImpersonating(user._id);
    try {
      const res = await fetch(`/api/v1/admin/impersonate/${user._id}`, { method: "POST", headers });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || t("backoffice.users.impersonateFailed"));
        return;
      }
      window.open(`/?otc=${data.code}`, "_blank");
    } catch {
      alert(t("backoffice.users.errorNetwork"));
    } finally {
      setImpersonating(null);
    }
  }

  async function toggleActive(user: User) {
    try {
      await fetch(`/api/v1/admin/users/${user._id}/active`, {
        method: "PATCH", headers, body: JSON.stringify({ active: !user.active }),
      });
      loadUsers();
    } catch {}
  }

  const ROLE_COLORS: Record<string, string> = {
    superadmin: "bg-purple-100 text-purple-700",
    businessadmin: "bg-blue-100 text-blue-700",
    teamleader: "bg-cyan-100 text-cyan-700",
    employee: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">{t("backoffice.users.title")}</h1>
          <Badge variant="secondary">{users.length}</Badge>
        </div>
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t("backoffice.users.newUser")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterTenant} onValueChange={setFilterTenant}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder={t("backoffice.users.filterTenant")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("backoffice.users.allTenants")}</SelectItem>
            {tenants.map((tn) => (
              <SelectItem key={tn._id} value={tn._id}>{tn.nameEn}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder={t("backoffice.users.filterRole")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("backoffice.users.allRoles")}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>{t(`users.roles.${r}`, r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.users.colName")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.users.colTenant")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.users.colRole")}</th>
                <th className="text-left px-4 py-2.5 font-medium">{t("backoffice.users.colActive")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t("backoffice.users.noUsers")}
                  </td>
                </tr>
              )}
              {users.map((user, i) => (
                <tr key={user._id} className={i % 2 === 0 ? "" : "bg-muted/20"}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground">{user.email}</div>
                    <div className="text-xs text-muted-foreground">{user.phone}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {user.tenant ? (
                      <span>{user.tenant.nameEn}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || "bg-gray-100 text-gray-600"}`}>
                      {t(`users.roles.${user.role}`, user.role)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <ToggleBadge checked={user.active} onCheckedChange={() => toggleActive(user)} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="gap-1.5 h-7" onClick={() => openEdit(user)}>
                        <Pencil className="h-3.5 w-3.5" /> {t("common.edit")}
                      </Button>
                      {user.role !== "superadmin" && (
                        <Button
                          variant="ghost" size="sm"
                          className="gap-1.5 h-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          onClick={() => handleImpersonate(user)}
                          disabled={impersonating === user._id}
                          title={t("backoffice.users.impersonate")}
                        >
                          {impersonating === user._id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <UserCheck className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingId ? t("backoffice.users.editUser") : t("backoffice.users.newUser")}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
            <div className="space-y-1">
              <Label className="text-xs">{t("backoffice.users.fieldName")}</Label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("backoffice.users.fieldPhone")}</Label>
              <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("backoffice.users.fieldEmail")}</Label>
              <Input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} type="email" dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("backoffice.users.fieldRole")}</Label>
              <Select value={form.role} onValueChange={(v) => setForm((p) => ({ ...p, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{t(`users.roles.${r}`, r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("backoffice.users.fieldTenant")}</Label>
              <Select value={form.tenantId} onValueChange={(v) => setForm((p) => ({ ...p, tenantId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("backoffice.users.selectTenant")} /></SelectTrigger>
                <SelectContent>
                  {tenants.map((tn) => (
                    <SelectItem key={tn._id} value={tn._id}>{tn.nameEn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ToggleBadge
              checked={form.active}
              onCheckedChange={(v) => setForm((p) => ({ ...p, active: v }))}
              labels={{ on: t("backoffice.tenants.active"), off: t("backoffice.tenants.inactive") }}
            />
          </div>
          <SheetFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>
              <X className="h-4 w-4 mr-1" /> {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editingId ? t("backoffice.users.saveChanges") : t("backoffice.users.createUser")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
