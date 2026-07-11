import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import ar from "./ar";
import en from "./en";
import type { TranslationShape } from "./ar";

export type Language = "ar" | "en";

const DICTIONARIES: Record<Language, TranslationShape> = { ar, en };
const DIRECTIONS: Record<Language, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };
const STORAGE_KEY = "hadeelos.language";

interface I18nContextValue {
  language: Language;
  dir: "rtl" | "ltr";
  t: TranslationShape;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readPersistedLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back silently.
  }
  return "ar";
}

/**
 * PR #10 rule: "persist language choice" and "one coherent language per
 * screen" — every string a component renders comes from `t`, resolved
 * for exactly one language at a time, never mixed ar/en on one screen.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readPersistedLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "ar" ? "en" : "ar");
  }, [language, setLanguage]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      dir: DIRECTIONS[language],
      t: DICTIONARIES[language],
      setLanguage,
      toggleLanguage,
    }),
    [language, setLanguage, toggleLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error("useI18n() must be used within an I18nProvider.");
  }
  return ctx;
}
