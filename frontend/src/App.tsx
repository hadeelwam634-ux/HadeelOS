import { useCallback, useEffect, useMemo, useState } from "react";
import { I18nProvider, useI18n } from "./i18n";
import { ApiClient } from "./api/client";
import { AuthScreen } from "./components/AuthScreen";
import { ConnectorsPanel } from "./components/ConnectorsPanel";
import { TodayCockpit } from "./components/TodayCockpit";
import { MemoryPanel } from "./components/MemoryPanel";
import { LanguageToggle } from "./components/LanguageToggle";

const SESSION_TOKEN_STORAGE_KEY = "hadeelos.sessionToken";

function readPersistedToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    if (token === null) {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Best-effort persistence only — an unpersisted token still works
    // for the current tab, it just won't survive a page reload.
  }
}

function Shell() {
  const { t, dir } = useI18n();
  const [token, setToken] = useState<string | null>(readPersistedToken);

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = dir === "rtl" ? "ar" : "en";
  }, [dir]);

  // One ApiClient instance for the whole app lifetime; its token is
  // mutated in place (setToken()) rather than recreating the client,
  // so in-flight requests and any component holding a reference to
  // `client` always see the current token.
  const client = useMemo(() => new ApiClient({ token }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAuthenticated = useCallback(
    (newToken: string) => {
      client.setToken(newToken);
      persistToken(newToken);
      setToken(newToken);
    },
    [client],
  );

  const handleLogout = useCallback(async () => {
    if (token) {
      try {
        await client.logout(token);
      } catch {
        // Logout is best-effort client-side regardless of whether the
        // server-side revoke call itself succeeds — the token is
        // discarded locally either way so the user is never stuck
        // "logged in" in the UI after clicking logout.
      }
    }
    client.setToken(null);
    persistToken(null);
    setToken(null);
  }, [client, token]);

  if (token === null) {
    return (
      <I18nGate>
        <AuthScreen client={client} onAuthenticated={handleAuthenticated} />
      </I18nGate>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t.today.title}
      </a>
      <header className="top-bar">
        <span className="app-name">{t.appName}</span>
        <span>
          <LanguageToggle />
          <button type="button" className="logout-button" onClick={handleLogout} style={{ marginInlineStart: "0.5rem" }}>
            {t.auth.logout}
          </button>
        </span>
      </header>
      <main id="main-content">
        <h1>{t.today.title}</h1>
        <TodayCockpit client={client} />
        <ConnectorsPanel client={client} />
        <MemoryPanel client={client} />
      </main>
    </div>
  );
}

/** Keeps the language toggle available even on the pre-login AuthScreen. */
function I18nGate({ children }: { children: React.ReactNode }) {
  const { dir } = useI18n();
  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = dir === "rtl" ? "ar" : "en";
  }, [dir]);
  return (
    <div className="app-shell">
      <header className="top-bar">
        <span className="app-name">HadeelOS</span>
        <LanguageToggle />
      </header>
      {/* Explicit <main> landmark: axe-core's E2E accessibility scan
          (see e2e/tests/full-journey.spec.ts) flagged the pre-login
          screen for missing one — the authenticated Shell already had
          <main id="main-content"> below, but this wrapper (used only
          for AuthScreen) rendered children directly into the shell div. */}
      <main id="main-content">{children}</main>
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
