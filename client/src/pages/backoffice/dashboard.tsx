import { useTranslation } from "react-i18next";
import { Building2, Users, MessageSquare, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBackofficeAuth } from "@/lib/backoffice-auth";

export default function BackofficeDashboard() {
  const { user } = useBackofficeAuth();
  const { t } = useTranslation();

  const STAT_CARDS = [
    { labelKey: "backoffice.dashboard.tenants", value: "—", icon: Building2, color: "text-blue-500" },
    { labelKey: "backoffice.dashboard.users", value: "—", icon: Users, color: "text-green-500" },
    { labelKey: "backoffice.dashboard.messagesToday", value: "—", icon: MessageSquare, color: "text-purple-500" },
    { labelKey: "backoffice.dashboard.activeNow", value: "—", icon: Activity, color: "text-orange-500" },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("backoffice.dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("backoffice.dashboard.welcome", { name: user?.name })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((card) => (
          <Card key={card.labelKey}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(card.labelKey)}
              </CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
