import type { UUID } from "../types";

/**
 * A stored connection between a HadeelOS user and their Google Calendar.
 *
 * v1 scope: the OAuth consent flow itself happens client-side (the client
 * completes Google's OAuth flow and hands us the resulting token pair via
 * `connect`). This service never initiates or brokers the OAuth exchange.
 * This is a deliberate, documented v1 limitation, not an unstated gap.
 *
 * SECURITY NOTE: `accessToken` / `refreshToken` are plaintext here because
 * v1 only ships an in-memory repository. Any future Postgres-backed
 * CalendarConnectionRepository implementation MUST encrypt these columns
 * at rest before it is used in production. See README "Google Calendar
 * Integration (PR #13)" section.
 */
export interface CalendarConnection {
  readonly userId: UUID;
  readonly calendarId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly connectedAt: string;
}

/**
 * The minimal event shape this bounded context needs. Deliberately does
 * NOT include attendees, description, location, or any other raw content
 * from the provider — only what is needed to derive a meeting-count
 * signal. This is a data-minimization decision: HadeelOS never persists
 * raw calendar content, only a derived count (see CalendarSignalService).
 */
export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly isAllDay: boolean;
}

/**
 * The client-facing view of a CalendarConnection — never includes
 * accessToken/refreshToken (mirrors the auth module's PublicUser /
 * toPublicUser pattern for passwordHash). API routes must always return
 * this, never the raw CalendarConnection, so an access token is never
 * echoed back over HTTP after the initial connect.
 */
export type PublicCalendarConnection = Omit<CalendarConnection, "accessToken" | "refreshToken">;

export function toPublicCalendarConnection(connection: CalendarConnection): PublicCalendarConnection {
  const { accessToken, refreshToken, ...rest } = connection;
  return rest;
}

export interface ConnectCalendarCommand {
  readonly userId: UUID;
  readonly calendarId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
}

export interface CalendarSyncResult {
  readonly eventCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}
