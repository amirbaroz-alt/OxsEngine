import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";

export default function BackofficeLogsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">{t("backoffice.logs.title")}</h1>
      </div>
      <p className="text-muted-foreground">{t("backoffice.logs.comingSoon")}</p>
    </div>
  );
}
