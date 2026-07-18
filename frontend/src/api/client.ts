import type {
  ApiErrorBody,
  EventLogEntry,
  LoginResult,
  MemoryRecord,
  PublicCalendarConnection,
  PublicGmailConnection,
  RegisterResult,
  TodayDecisionResult,
} from "./types";

/**
 * ApiClientError carries the parsed structured error body (PR #9's
 * `{ error: { name, message, requestId, issues? } }`) plus an
 * `offline` flag for network-level failures (no response at all,
 * e.g. the browser is offline) — the two are distinguished so the UI
 * can show "offline" vs "application error" as different states
 * (both required by PR #10's state list).
 */
export class ApiClientError extends Error {
  readonly status: number | null;
  readonly body: ApiErrorBody | null;
  readonly offline: boolean;

  constructor(message: string, options: { status: number | null; body: ApiErrorBody | null; offline: boolean }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.body = options.body;
    this.offline = options.offline;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /**
   * MVP Hardening: the frontend now authenticates with a real session
   * token (`Authorization: Bearer <token>`, resolved by
   * SessionTokenAuthResolver — see decision-engine/src/api/auth.ts)
   * instead of the pre-PR-12 `x-user-id` mock-auth header, which the
   * real backend no longer accepts by default. token may be null before
   * login/registration completes; every request made without one will
   * 401, which callers surface as ApiClientError.
   */
  token: string | null;
}

/**
 * Thin fetch wrapper around the PR #9 API, updated for real sessions
 * (MVP Hardening): every call attaches `Authorization: Bearer <token>`
 * when a token is set, and normalizes both network failures and
 * structured API error responses into ApiClientError, so calling code
 * never has to branch on fetch's own error shapes directly.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private token: string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl ?? "/api";
    this.token = options.token;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ApiClientError("Network request failed.", { status: null, body: null, offline: true });
    }

    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new ApiClientError((parsed as ApiErrorBody | undefined)?.error?.message ?? "Request failed.", {
        status: response.status,
        body: (parsed as ApiErrorBody) ?? null,
        offline: false,
      });
    }

    return parsed as T;
  }

  getToday(): Promise<TodayDecisionResult> {
    return this.request<TodayDecisionResult>("/today");
  }

  recalculateToday(command: {
    signalStoreDelta: unknown[];
    candidateDecisions: unknown[];
    previouslyAcceptedDecisions: unknown[];
    accuracyByDecisionType: Record<string, { successes: number; totalShown: number }>;
    baselineForecast: { completion: number; capacity: number };
    sourceVersions: { signalsUpdatedAt: string | null; eventLogCursor: string | null; graphVersion: string | null };
  }): Promise<TodayDecisionResult> {
    return this.request<TodayDecisionResult>("/today/recalculate", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  respondToDecision(decisionId: string, action: "accepted" | "rejected" | "ignored"): Promise<{ entry: EventLogEntry }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/respond`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  }

  recordOutcome(decisionId: string, outcome: "completed" | "skipped" | "partial"): Promise<{ entry: EventLogEntry }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/outcome`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    });
  }

  getDecisionHistory(decisionId: string): Promise<{ history: EventLogEntry[] }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/history`);
  }

  getMemory(): Promise<{ memories: MemoryRecord[] }> {
    return this.request("/memory");
  }

  correctMemory(memoryId: string, value: unknown): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/correct`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  forgetMemory(memoryId: string): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/forget`, { method: "POST" });
  }

  blockMemory(memoryId: string, reason: string): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/block`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  health(): Promise<{ status: string }> {
    return this.request("/system/health");
  }

  // ---------- Auth ----------

  register(email: string, password: string): Promise<RegisterResult> {
    return this.request("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
  }

  login(email: string, password: string): Promise<LoginResult> {
    return this.request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  }

  logout(token: string): Promise<{ loggedOut: boolean }> {
    return this.request("/auth/logout", { method: "POST", body: JSON.stringify({ token }) });
  }

  // ---------- Calendar / Gmail connections (mock provider in this build) ----------

  getCalendarConnection(): Promise<{ connection: PublicCalendarConnection | null }> {
    return this.request("/calendar/connection");
  }

  /**
   * v1/MVP Hardening scope: connects using a self-issued fake token
   * pair rather than a real Google OAuth flow — the backend's
   * FakeCalendarProvider (default in AppContainer when no real
   * GoogleCalendarProvider is wired) never actually calls Google, so a
   * fake token pair is sufficient and matches Hadeel's own "connect via
   * a mock provider" E2E requirement. A real Google connect flow would
   * instead redirect to Google and call POST /api/calendar/oauth/exchange
   * with the resulting authorization code (see security/googleOAuth.ts)
   * — deliberately out of scope for this button.
   */
  connectCalendarMock(): Promise<{ connection: PublicCalendarConnection | null }> {
    return this.request("/calendar/connect", {
      method: "POST",
      body: JSON.stringify({
        calendarId: "primary",
        accessToken: `mock-access-${crypto.randomUUID()}`,
        refreshToken: `mock-refresh-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
  }

  disconnectCalendar(): Promise<{ disconnected: boolean }> {
    return this.request("/calendar/connection", { method: "DELETE" });
  }

  getGmailConnection(): Promise<{ connection: PublicGmailConnection | null }> {
    return this.request("/gmail/connection");
  }

  /** Same mock-provider rationale as connectCalendarMock() above. */
  connectGmailMock(): Promise<{ connection: PublicGmailConnection | null }> {
    return this.request("/gmail/connect", {
      method: "POST",
      body: JSON.stringify({
        accessToken: `mock-access-${crypto.randomUUID()}`,
        refreshToken: `mock-refresh-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
  }

  disconnectGmail(): Promise<{ disconnected: boolean }> {
    return this.request("/gmail/connection", { method: "DELETE" });
  }
}
