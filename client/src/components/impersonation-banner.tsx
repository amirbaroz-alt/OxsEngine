import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useImpersonation } from "@/lib/impersonation-context";
import { useAuth } from "@/lib/auth-context";

export function ImpersonationBanner() {
  const { isImpersonated } = useImpersonation();
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!isImpersonated) return null;

  return (
    <div className="w-full bg-amber-400 text-amber-950 px-4 py-2 flex items-center gap-2 text-sm font-semibold z-[9999] shrink-0">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        {t("impersonation.bannerText", {
          name: user?.name ?? "—",
          role: user?.role ?? "—",
        })}
      </span>
    </div>
  );
}
