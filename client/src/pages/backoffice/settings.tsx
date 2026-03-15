import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";

export default function BackofficeSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{t("backoffice.settings.title")}</h1>
      </div>
      <p className="text-muted-foreground">{t("backoffice.settings.comingSoon")}</p>
    </div>
  );
}
