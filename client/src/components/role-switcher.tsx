import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Shield, Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/lib/role-context";
import { userRoles, type Tenant } from "@shared/schema";

export function RoleSwitcher() {
  const { t } = useTranslation();
  const { currentRole, setCurrentRole, currentTenantId, setCurrentTenantId } = useRole();
  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-1">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <Select value={currentRole} onValueChange={(v) => setCurrentRole(v as any)}>
          <SelectTrigger className="w-[80px] md:w-[130px] h-8 text-xs truncate" data-testid="select-role-switcher">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {userRoles.map((role) => (
              <SelectItem key={role} value={role} data-testid={`option-role-${role}`}>
                {t(`users.roles.${role}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {currentRole !== "superadmin" && (
        <div className="flex items-center gap-1">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <Select value={currentTenantId || ""} onValueChange={(v) => setCurrentTenantId(v || null)}>
            <SelectTrigger className="w-[80px] md:w-[140px] h-8 text-xs truncate" data-testid="select-tenant-switcher">
              <SelectValue placeholder={t("tenants.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {tenants?.map((tenant) => (
                <SelectItem key={tenant._id} value={tenant._id}>
                  {tenant.nameHe}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
