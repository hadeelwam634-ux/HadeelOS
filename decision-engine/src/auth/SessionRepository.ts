import { Session } from "./types";

/** Storage-agnostic contract for live login sessions. */
export interface SessionRepository {
  create(session: Session): Promise<void>;
  findByToken(token: string): Promise<Session | undefined>;
  /** Removing an unknown token is a no-op, not an error (mirrors SignalStoreRepository.delete). */
  revoke(token: string): Promise<void>;
}
