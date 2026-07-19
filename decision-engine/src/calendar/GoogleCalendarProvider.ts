import { SystemClock } from "../application/types";
import { CircuitBreaker, withRetry, RetryOptions } from "../observability";
import { CalendarProviderError } from "./errors";
import type { CalendarProvider } from "./CalendarProvider";
import type { CalendarConnection, CalendarEvent } from "./types";
import { FakeCalendarProvider } from "./FakeCalendarProvider";

interface GoogleEventsResponse {
  items?: Array<{
    id: string;
    summary?: string;
    status?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  }>;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = { maxAttempts: 3, baseDelayMs: 100 };

/**
 * Real production implementation, calling Google's Calendar API v3
 * directly via the platform `fetch` (no new HTTP-client dependency,
 * matching the GoogleCalendarProvider precedent set by PR #11's
 * PostgresSignalStoreRepository: a real implementation behind a narrow
 * interface, with a deterministic fake substituted in tests).
 *
 * v1 scope: this class only ever performs GET requests against the
 * events endpoint and a token-refresh POST — no write scope is ever
 * requested or used.
 *
 * Reliability (PR #15): every call to Google is wrapped in withRetry
 * (exponential backoff, transient-failure tolerant) inside a
 * CircuitBreaker (fails fast once Google is sustained-down, instead of
 * every request from every user separately retrying and timing out).
 */
export class GoogleCalendarProvider implements CalendarProvider {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryOptions: RetryOptions;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    circuitBreaker?: CircuitBreaker,
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
  ) {
    this.circuitBreaker =
      circuitBreaker ??
      new CircuitBreaker({
        name: "google-calendar",
        failureThreshold: 5,
        cooldownMs: 30_000,
        clock: new SystemClock(),
      });
    this.retryOptions = retryOptions;
  }

  async listUpcomingEvents(
    connection: CalendarConnection,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<CalendarEvent[]> {
    return this.circuitBreaker.execute(() =>
      withRetry(() => this.fetchUpcomingEvents(connection, windowStart, windowEnd), this.retryOptions),
    );
  }

  async refreshAccessToken(
    connection: CalendarConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    if (connection.refreshToken === null) {
      return null;
    }
    return this.circuitBreaker.execute(() =>
      withRetry(() => this.fetchRefreshedToken(connection), this.retryOptions),
    );
  }

  private async fetchUpcomingEvents(
    connection: CalendarConnection,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<CalendarEvent[]> {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events`,
    );
    url.searchParams.set("timeMin", windowStart.toISOString());
    url.searchParams.set("timeMax", windowEnd.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
    } catch (cause) {
      throw new CalendarProviderError("Failed to reach Google Calendar API.", cause);
    }

    if (!response.ok) {
      throw new CalendarProviderError(
        `Google Calendar API returned status ${response.status}.`,
      );
    }

    let payload: GoogleEventsResponse;
    try {
      payload = (await response.json()) as GoogleEventsResponse;
    } catch (cause) {
      throw new CalendarProviderError("Failed to parse Google Calendar API response.", cause);
    }

    return (payload.items ?? [])
      .filter((item) => item.status !== "cancelled")
      .map((item) => this.toCalendarEvent(item));
  }

  private async fetchRefreshedToken(
    connection: CalendarConnection,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: connection.refreshToken ?? "",
          grant_type: "refresh_token",
        }).toString(),
      });
    } catch (cause) {
      throw new CalendarProviderError("Failed to reach Google's token endpoint.", cause);
    }

    if (!response.ok) {
      throw new CalendarProviderError(
        `Google token refresh returned status ${response.status}.`,
      );
    }

    let payload: GoogleTokenResponse;
    try {
      payload = (await response.json()) as GoogleTokenResponse;
    } catch (cause) {
      throw new CalendarProviderError("Failed to parse Google token refresh response.", cause);
    }

    const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
    return { accessToken: payload.access_token, expiresAt };
  }

  private toCalendarEvent(item: NonNullable<GoogleEventsResponse["items"]>[number]): CalendarEvent {
    const isAllDay = item.start?.date !== undefined;
    return {
      id: item.id,
      title: item.summary ?? "(untitled event)",
      start: item.start?.dateTime ?? item.start?.date ?? "",
      end: item.end?.dateTime ?? item.end?.date ?? "",
      isAllDay,
    };
  }
}

/**
 * PostgreSQL-style default-selection (same pattern as
 * defaultGoogleOAuthExchanger() in security/googleOAuth.ts and
 * defaultStorageBackend() in persistence/postgres/StorageBackend.ts):
 * if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are both set, real
 * Google Calendar access is used; otherwise this falls back to
 * FakeCalendarProvider (always zero events) and logs a loud warning.
 *
 * Real-account wiring gap this closes: GoogleCalendarProvider above
 * has existed since PR #13 and is fully implemented, but main.ts
 * previously constructed `new AppContainer()` with no calendarProvider
 * argument at all, so AppContainer's own FakeCalendarProvider default
 * was always used in production regardless of GOOGLE_CLIENT_ID/SECRET
 * — real Google Calendar sync was unreachable even when the OAuth
 * token exchange itself (security/googleOAuth.ts) was fully wired.
 * See main.ts for where this is actually plugged in.
 */
export function defaultCalendarProvider(): CalendarProvider {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HadeelOS] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set — " +
        "falling back to FakeCalendarProvider. Calendar sync will always " +
        "report zero events. Set both environment variables to enable real " +
        "Google Calendar sync.",
    );
    return new FakeCalendarProvider();
  }
  return new GoogleCalendarProvider(clientId, clientSecret);
}
