import { useTranslation } from "react-i18next";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supportedLanguages, languageNames, isRtl, type SupportedLanguage } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  function changeLanguage(lang: SupportedLanguage) {
    i18n.changeLanguage(lang);
    const html = document.documentElement;
    html.setAttribute("dir", isRtl(lang) ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 md:h-9 md:w-9 p-2" title={t("common.language", "שפה")} data-testid="button-language-switcher">
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {supportedLanguages.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => changeLanguage(lang)}
            className={i18n.language === lang ? "bg-accent" : ""}
            data-testid={`button-lang-${lang}`}
          >
            {languageNames[lang]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
