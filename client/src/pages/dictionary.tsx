import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { supportedLanguages, languageNames, loadTranslationOverrides } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/i18n";
import { Search, Pencil, RotateCcw, Check, X, BookOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { DataTableSkeleton } from "@/components/data-table-skeleton";

import heDefaults from "@/lib/locales/he.json";
import enDefaults from "@/lib/locales/en.json";
import arDefaults from "@/lib/locales/ar.json";

const defaultsByLang: Record<string, Record<string, any>> = {
  he: heDefaults,
  en: enDefaults,
  ar: arDefaults,
};

function flattenObject(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }
  return result;
}

interface TranslationEntry {
  key: string;
  section: string;
  defaultValue: string;
  overrideValue?: string;
}

export default function DictionaryPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [selectedLang, setSelectedLang] = useState<SupportedLanguage>(
    (i18n.language as SupportedLanguage) || "he"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [showOverridesOnly, setShowOverridesOnly] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TranslationEntry | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: overrides = {}, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/translations/merged", selectedLang],
  });

  const saveMutation = useMutation({
    mutationFn: async ({ language, key, value }: { language: string; key: string; value: string }) => {
      await apiRequest("PUT", "/api/translations", { language, key, value });
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations/merged", selectedLang] });
      await loadTranslationOverrides(selectedLang);
      toast({ title: t("dictionary.saveSuccess") });
      setEditingEntry(null);
    },
    onError: () => {
      toast({ title: t("dictionary.saveError"), variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async ({ language, key }: { language: string; key: string }) => {
      await apiRequest("DELETE", `/api/translations?language=${encodeURIComponent(language)}&key=${encodeURIComponent(key)}`);
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations/merged", selectedLang] });
      await loadTranslationOverrides(selectedLang);
      toast({ title: t("dictionary.resetSuccess") });
    },
    onError: () => {
      toast({ title: t("dictionary.resetError"), variant: "destructive" });
    },
  });

  const flatDefaults = useMemo(() => {
    return flattenObject(defaultsByLang[selectedLang] || {});
  }, [selectedLang]);

  const sections = useMemo(() => {
    const secs = new Set<string>();
    for (const key of Object.keys(flatDefaults)) {
      const section = key.split(".")[0];
      secs.add(section);
    }
    return Array.from(secs).sort();
  }, [flatDefaults]);

  const entries: TranslationEntry[] = useMemo(() => {
    return Object.entries(flatDefaults).map(([key, defaultValue]) => ({
      key,
      section: key.split(".")[0],
      defaultValue,
      overrideValue: overrides[key],
    }));
  }, [flatDefaults, overrides]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (sectionFilter !== "all" && entry.section !== sectionFilter) return false;
      if (showOverridesOnly && !entry.overrideValue) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          entry.key.toLowerCase().includes(q) ||
          entry.defaultValue.toLowerCase().includes(q) ||
          (entry.overrideValue && entry.overrideValue.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [entries, sectionFilter, showOverridesOnly, searchQuery]);

  const overrideCount = useMemo(() => {
    return entries.filter((e) => e.overrideValue !== undefined).length;
  }, [entries]);

  function handleEdit(entry: TranslationEntry) {
    setEditingEntry(entry);
    setEditValue(entry.overrideValue || entry.defaultValue);
  }

  function handleSave() {
    if (!editingEntry) return;
    saveMutation.mutate({
      language: selectedLang,
      key: editingEntry.key,
      value: editValue,
    });
  }

  function handleReset(entry: TranslationEntry) {
    resetMutation.mutate({ language: selectedLang, key: entry.key });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">
          {t("dictionary.title")}
        </h1>
        <p className="text-muted-foreground">{t("dictionary.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={selectedLang}
          onValueChange={(v) => setSelectedLang(v as SupportedLanguage)}
        >
          <TabsList>
            {supportedLanguages.map((lang) => (
              <TabsTrigger
                key={lang}
                value={lang}
                data-testid={`tab-lang-${lang}`}
              >
                {languageNames[lang]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" data-testid="badge-total-keys">
            {t("dictionary.totalKeys")}: {entries.length}
          </Badge>
          <Badge
            variant={overrideCount > 0 ? "default" : "secondary"}
            data-testid="badge-override-count"
          >
            {t("dictionary.overrideCount")}: {overrideCount}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("dictionary.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-9"
            data-testid="input-search-dictionary"
          />
        </div>

        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-section-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("dictionary.allSections")}</SelectItem>
            {sections.map((section) => (
              <SelectItem key={section} value={section}>
                {section}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={showOverridesOnly ? "default" : "outline"}
          onClick={() => setShowOverridesOnly(!showOverridesOnly)}
          data-testid="button-toggle-overrides"
        >
          {t("dictionary.overridesOnly")}
        </Button>
      </div>

      {isLoading ? (
        <DataTableSkeleton columns={4} />
      ) : filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">{t("dictionary.noResults")}</h3>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[280px]">{t("dictionary.key")}</TableHead>
                  <TableHead>{t("dictionary.defaultValue")}</TableHead>
                  <TableHead>{t("dictionary.currentValue")}</TableHead>
                  <TableHead className="w-[100px]">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.key} data-testid={`row-translation-${entry.key}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-2 py-1 rounded-md" dir="ltr">
                          {entry.key}
                        </code>
                        {entry.overrideValue !== undefined && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">
                            {t("dictionary.modified")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {entry.defaultValue}
                    </TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate font-medium">
                      {entry.overrideValue !== undefined ? entry.overrideValue : entry.defaultValue}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleEdit(entry)}
                          data-testid={`button-edit-${entry.key}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {entry.overrideValue !== undefined && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleReset(entry)}
                            data-testid={`button-reset-${entry.key}`}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dictionary.editTranslation")}</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("dictionary.translationKey")}
                </label>
                <code className="block mt-1 text-sm bg-muted px-3 py-2 rounded-md" dir="ltr">
                  {editingEntry.key}
                </code>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t("dictionary.defaultText")}
                </label>
                <p className="mt-1 text-sm bg-muted px-3 py-2 rounded-md">
                  {editingEntry.defaultValue}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  {t("dictionary.translatedText")}
                </label>
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder={t("dictionary.translationPlaceholder")}
                  className="mt-1"
                  rows={3}
                  data-testid="input-translation-value"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingEntry(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-translation"
            >
              {saveMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
