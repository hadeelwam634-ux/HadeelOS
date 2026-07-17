import type { GmailProvider } from "./GmailProvider";
import type { GmailConnection } from "./types";

/**
 * Deterministic test/default substitute for GoogleGmailProvider — a
 * real substitute for the external dependency, never a mock of the
 * code under test (same precedent as FakeCalendarProvider, PR #13).
 */
export class FakeGmailProvider implements GmailProvider {
  constructor(
    private readonly unreadCount: number = 0,
    private readonly refreshResult: { accessToken: string; expiresAt: string } | null = null,
  ) {}

  async countUnread(_connection: GmailConnection): Promise<number> {
    return this.unreadCount;
  }

  async refreshAccessToken(
    _connection: GmailConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    return this.refreshResult;
  }
}
