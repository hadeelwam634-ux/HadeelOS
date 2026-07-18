import { useState } from "react";
import { useI18n } from "../i18n";
import { ApiClient, ApiClientError } from "../api/client";

interface AuthScreenProps {
  client: ApiClient;
  onAuthenticated: (token: string) => void;
}

/**
 * MVP Hardening: the frontend had no login/registration UI at all
 * before this — PR #10 predates PR #12's real session-based auth, and
 * was never updated. Without this screen the deployed app cannot
 * authenticate against the real backend (SessionTokenAuthResolver is
 * the default AuthResolver — see decision-engine/src/api/auth.ts — and
 * ignores the old x-user-id header entirely). Intentionally minimal:
 * one email + password form, toggling between register and login.
 */
export function AuthScreen({ client, onAuthenticated }: AuthScreenProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = mode === "register" ? await client.register(email, password) : await client.login(email, password);
      onAuthenticated(result.token);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t.errors.generic);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="card auth-form" onSubmit={handleSubmit} aria-labelledby="auth-heading">
        <h1 id="auth-heading">{t.auth.title}</h1>
        <p>{t.auth.subtitle}</p>

        <label htmlFor="auth-email">{t.auth.emailLabel}</label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="auth-password">{t.auth.passwordLabel}</label>
        <input
          id="auth-password"
          type="password"
          required
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error ? (
          <p role="alert" className="auth-error">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={submitting}>
          {submitting ? t.auth.submitting : mode === "register" ? t.auth.registerButton : t.auth.loginButton}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
        >
          {mode === "register" ? t.auth.switchToLogin : t.auth.switchToRegister}
        </button>
      </form>
    </div>
  );
}
