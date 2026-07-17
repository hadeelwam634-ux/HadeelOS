import type { UUID } from "../types";
import type { CalendarConnection } from "./types";

/**
 * Storage-agnostic interface for calendar connections. See the SECURITY
 * NOTE on CalendarConnection: any concrete implementation backed by a
 * durable store MUST encrypt accessToken/refreshToken at rest before it
 * is used in production. InMemoryCalendarConnectionRepository (v1's only
 * implementation) does not, since it never persists beyond process memory.
 */
export interface CalendarConnectionRepository {
  upsert(connection: CalendarConnection): Promise<void>;
  findByUserId(userId: UUID): Promise<CalendarConnection | null>;
  delete(userId: UUID): Promise<void>;
}
