import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./locales/he.json";
import en from "./locales/en.json";
import ar from "./locales/ar.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";

export const supportedLanguages = ["he", "en", "ar", "ru", "tr"] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const languageNames: Record<SupportedLanguage, string> = {
  he: "עברית",
  en: "English",
  ar: "العربية",
  ru: "Русский",
  tr: "Türkçe",
};

export const rtlLanguages: SupportedLanguage[] = ["he", "ar"];

export function isRtl(lang: string): boolean {
  return rtlLanguages.includes(lang as SupportedLanguage);
}

const storedLang = localStorage.getItem("i18nextLng");
const initialLang: SupportedLanguage =
  storedLang && (supportedLanguages as readonly string[]).includes(storedLang)
    ? (storedLang as SupportedLanguage)
    : "he";

i18n
  .use(initReactI18next)
  .init({
    lng: initialLang,
    resources: {
      he: { translation: he },
      en: { translation: en },
      ar: { translation: ar },
      ru: { translation: ru },
      tr: { translation: tr },
    },
    fallbackLng: "he",
    interpolation: {
      escapeValue: false,
    },
  });

function unflattenObject(flat: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let current = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }
  return result;
}

export async function loadTranslationOverrides(lang?: string): Promise<void> {
  const languages = lang ? [lang] : [...supportedLanguages];
  for (const lng of languages) {
    try {
      const res = await fetch(`/api/translations/merged/${lng}`);
      if (res.ok) {
        const flat: Record<string, string> = await res.json();
        if (Object.keys(flat).length > 0) {
          const nested = unflattenObject(flat);
          i18n.addResourceBundle(lng, "translation", nested, true, true);
        }
      }
    } catch {
    }
  }
}

export default i18n;
