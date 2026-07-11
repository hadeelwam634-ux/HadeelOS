import { useEffect, useMemo } from "react";
import { I18nProvider, useI18n } from "./i18n";
import { ApiClient } from "./api/client";
import { TodayCockpit } from "./components/TodayCockpit";
import { MemoryPanel } from "./components/MemoryPanel";
import { LanguageToggle } from "./components/LanguageToggle";

const DEMO_USER_STORAGE_KEY = "hadeelos.userId";

/**
 * v1 placeholder identity: until PR #12 (Security baseline) lands there
 * is no real session, so the frontend uses a stable random id persisted
 * in localStorage per browser profile, sent as x-user-id — the same
 * mock-auth mechanism the API's MockHeaderAuthResolver expects (see
 * decision-engine/src/api/auth.ts). This keeps every request bound to
 * a consistent (if not yet verified) identity rather than a shared
 * default user.
 */
function getOrCreateDemoUserId(): string {
  try {
    const existing = window.localStorage.getItem(DEMO_USER_STORAGE_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    window.localStorage.setItem(DEMO_USER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "demo-user";
  }
}

function Shell() {
  const { t, dir } = useI18n();

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = dir === "rtl" ? "ar" : "en";
  }, [dir]);

  const client = useMemo(() => new ApiClient({ userId: getOrCreateDemoUserId() }), []);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t.today.title}
      </a>
      <header className="top-bar">
        <span className="app-name">{t.appName}</span>
        <LanguageToggle />
      </header>
      <main id="main-content">
        <h1>{t.today.title}</h1>
        <TodayCockpit client={client} />
        <MemoryPanel client={client} />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
