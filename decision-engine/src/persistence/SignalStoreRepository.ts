import { SignalStore, SignalStoreEntry, SignalType } from "../types";

/**
 * Storage-agnostic contract for the Signal Store.
 *
 * The Signal Store only ever holds the *latest* known value per signal
 * type (a projection of "what we currently know", not a history — that's
 * what the Event Log is for), so writes are always upserts.
 *
 * Every method returns a Promise so that swapping the in-memory
 * implementation for a database-backed one (Postgres, etc.) later
 * requires only a new class implementing this interface — no call site
 * anywhere else in the codebase should need to change.
 */
export interface SignalStoreRepository {
  /** Insert or overwrite the latest value for a single signal. */
  upsert(entry: SignalStoreEntry): Promise<void>;

  /** Insert or overwrite the latest value for multiple signals at once. */
  upsertMany(entries: SignalStoreEntry[]): Promise<void>;

  /** Look up the latest value for a single signal, if known. */
  get(signalType: SignalType): Promise<SignalStoreEntry | undefined>;

  /** The full current signal store (a partial map — see SignalStore). */
  getAll(): Promise<SignalStore>;

  /**
   * Remove a signal entirely. Exists for Memory Governance's
   * intentional-forgetting control (Learning Engine Part 2.1) — not
   * for routine use. Deleting an unknown signal is a no-op, not an
   * error.
   */
  delete(signalType: SignalType): Promise<void>;
}
