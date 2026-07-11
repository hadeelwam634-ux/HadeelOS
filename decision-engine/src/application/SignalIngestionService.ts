import { SignalStore, SignalStoreEntry } from "../types";
import { SignalStoreRepository } from "../persistence/SignalStoreRepository";
import { SignalPersistenceError } from "./errors";

/**
 * Thin orchestration boundary over SignalStoreRepository for the
 * standalone "just record signals" case (PR #9's POST /api/signals and
 * GET /api/signals/current) — separate from
 * DecisionApplicationService/TodayDecisionApplicationService, whose
 * signalStoreDelta handling exists only as a step inside a larger
 * recalculation, not as a callable operation on its own. Keeping this
 * a dedicated one-method-per-need service (rather than the API layer
 * calling SignalStoreRepository directly) preserves the repo-wide rule
 * that nothing outside a service may call a repository directly.
 */
export class SignalIngestionService {
  constructor(private readonly repository: SignalStoreRepository) {}

  /** Upserts any incoming entries, then returns the full resulting signal store. */
  async ingest(entries: SignalStoreEntry[]): Promise<SignalStore> {
    if (entries.length > 0) {
      try {
        await this.repository.upsertMany(entries);
      } catch (cause) {
        throw new SignalPersistenceError(cause);
      }
    }
    return this.getCurrent();
  }

  async getCurrent(): Promise<SignalStore> {
    try {
      return await this.repository.getAll();
    } catch (cause) {
      throw new SignalPersistenceError(cause);
    }
  }
}
