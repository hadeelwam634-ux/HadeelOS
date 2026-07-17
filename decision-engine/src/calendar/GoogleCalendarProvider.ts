import { CalendarProviderError } from "./errors";
import type { CalendarProvider } from "./CalendarProvider";
import type { CalendarConnection, CalendarEvent } from "./types";

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
 */
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listUpcomingEvents(
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

  async refreshAccessToken(
    connection: CalendarConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    if (connection.refreshToken === null) {
      return null;
    }

    let response: Response;
    try {
      response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: connection.refreshToken,
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
