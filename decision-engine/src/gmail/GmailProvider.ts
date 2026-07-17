import type { GmailConnection } from "./types";

/**
 * Deliberately minimal by construction: this interface exposes only a
 * count, never a method to list or read individual messages. Unlike
 * CalendarProvider (PR #13), which returns event objects that the
 * service then reduces to a count, GmailProvider never gives any
 * implementation a way to hand back message content or metadata in
 * the first place — data minimization enforced at the interface level,
 * one step stricter than the Calendar precedent.
 */
export interface GmailProvider {
  countUnread(connection: GmailConnection): Promise<number>;

  /**
   * Returns a refreshed access token if the provider was able to
   * refresh it, or null if refresh is not applicable/possible (e.g. no
   * refresh token on the connection). Throws GmailProviderError on
   * failure. Identical contract to CalendarProvider.refreshAccessToken.
   */
  refreshAccessToken(
    connection: GmailConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null>;
}
