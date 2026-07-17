import type { UUID } from "../types";

/**
 * A stored connection between a HadeelOS user and their Gmail account.
 *
 * v1 scope: same OAuth handoff model as the Calendar integration (PR
 * #13) — the client completes Google's OAuth consent flow itself and
 * hands the resulting token pair to `connect`. This service never
 * brokers or initiates the OAuth exchange.
 *
 * SECURITY NOTE: `accessToken` / `refreshToken` are plaintext here
 * because v1 only ships an in-memory repository. Any future
 * Postgres-backed GmailConnectionRepository implementation MUST
 * encrypt these columns at rest before it is used in production —
 * identical requirement to CalendarConnectionRepository (PR #13).
 */
export interface GmailConnection {
  readonly userId: UUID;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly connectedAt: string;
}

export interface ConnectGmailCommand {
  readonly userId: UUID;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
}

export interface GmailSyncResult {
  readonly unreadCount: number;
  readonly syncedAt: string;
}

/**
 * The client-facing view of a GmailConnection — never includes
 * accessToken/refreshToken (same PublicUser / PublicCalendarConnection
 * pattern used since PR #12/#13). API routes must always return this,
 * never the raw GmailConnection.
 */
export type PublicGmailConnection = Omit<GmailConnection, "accessToken" | "refreshToken">;

export function toPublicGmailConnection(connection: GmailConnection): PublicGmailConnection {
  const { accessToken, refreshToken, ...rest } = connection;
  return rest;
}
