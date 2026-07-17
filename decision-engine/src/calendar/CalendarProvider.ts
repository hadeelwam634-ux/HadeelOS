import type { CalendarConnection, CalendarEvent } from "./types";

/**
 * Read-only by construction: no create/update/delete method exists on
 * this interface anywhere, so no implementation can ever be used to
 * write to a user's calendar. This mirrors the EventLogRepository
 * append-only pattern (structural enforcement, not just convention).
 */
export interface CalendarProvider {
  listUpcomingEvents(
    connection: CalendarConnection,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<CalendarEvent[]>;

  /**
   * Returns a refreshed access token if the provider was able to refresh
   * it, or null if refresh is not applicable/possible (e.g. no refresh
   * token on the connection). Throws CalendarProviderError on failure.
   */
  refreshAccessToken(
    connection: CalendarConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null>;
}
