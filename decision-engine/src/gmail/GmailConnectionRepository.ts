import type { UUID } from "../types";
import type { GmailConnection } from "./types";

/**
 * Storage-agnostic interface for Gmail connections. See the SECURITY
 * NOTE on GmailConnection: any concrete implementation backed by a
 * durable store MUST encrypt accessToken/refreshToken at rest before
 * it is used in production.
 */
export interface GmailConnectionRepository {
  upsert(connection: GmailConnection): Promise<void>;
  findByUserId(userId: UUID): Promise<GmailConnection | null>;
  delete(userId: UUID): Promise<void>;
}
