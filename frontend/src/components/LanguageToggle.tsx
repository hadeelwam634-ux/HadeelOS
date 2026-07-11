import { useI18n } from "../i18n";

export function LanguageToggle() {
  const { t, toggleLanguage, language } = useI18n();
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={toggleLanguage}
      aria-label={t.language.toggle}
      lang={language === "ar" ? "en" : "ar"}
    >
      {t.language.toggle}
    </button>
  );
}
