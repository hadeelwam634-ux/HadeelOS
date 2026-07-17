import type { CalendarProvider } from "./CalendarProvider";
import type { CalendarConnection, CalendarEvent } from "./types";

/**
 * Deterministic test/default substitute for GoogleCalendarProvider —
 * a real substitute for the external dependency, never a mock of the
 * code under test (same precedent as PR #11's pg-mem harness).
 */
export class FakeCalendarProvider implements CalendarProvider {
  constructor(
    private readonly events: CalendarEvent[] = [],
    private readonly refreshResult: { accessToken: string; expiresAt: string } | null = null,
  ) {}

  async listUpcomingEvents(
    _connection: CalendarConnection,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<CalendarEvent[]> {
    return this.events.filter((event) => {
      const start = new Date(event.start).getTime();
      return start >= windowStart.getTime() && start <= windowEnd.getTime();
    });
  }

  async refreshAccessToken(
    _connection: CalendarConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    return this.refreshResult;
  }
}
