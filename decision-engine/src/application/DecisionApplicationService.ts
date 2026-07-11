import { EventLogEntry, SignalStore, SignalStoreEntry, SignalType, UUID } from "../types";
import { SignalStoreRepository } from "../persistence/SignalStoreRepository";
import { EventLogRepository } from "../persistence/EventLogRepository";
import { recalc } from "../recalc";
import {
  Clock,
  IdGenerator,
  RecalculateDayCommand,
  RecalculateDayResult,
} from "./types";
import {
  EventLogPersistenceError,
  RecalcExecutionError,
  SignalPersistenceError,
} from "./errors";

function nonEmptyEntries(store: SignalStore): SignalStoreEntry[] {
  return Object.values(store).filter((e): e is SignalStoreEntry => e !== undefined);
}

/**
 * Orchestrates SignalStoreRepository, EventLogRepository, and recalc()
 * behind a single application-level operation. This is the only way the
 * rest of the codebase (and, later, the API layer) is allowed to trigger
 * a recalculation — nothing outside this class should call the
 * repositories or recalc() directly (see repo-wide rule #10).
 *
 * recalculateDay() always runs in this order:
 *   1. Read the current signal store.
 *   2. Upsert the incoming signal delta.
 *   3. Read the resulting effective signal store back from the
 *      repository (not just merged locally — what recalc() and the
 *      Event Log see is what was actually persisted).
 *   4. Call recalc() against that persisted effective store.
 *   5. Append one EventLogEntry per accepted decision — only once
 *      recalc() has succeeded.
 *
 * Atomicity note: step 5 appends one EventLogEntry per decision in a
 * loop. This is NOT atomic in v1 — if append() succeeds for the first
 * N decisions and then throws on decision N+1, those N entries remain
 * persisted and are not rolled back; the caller only learns about the
 * failure via the thrown EventLogPersistenceError. True all-or-nothing
 * behavior needs a real transaction boundary, which only becomes
 * possible once there's a transactional backend (Postgres) — tracked
 * for a future PR. Callers must not assume this method is atomic.
 */
export class DecisionApplicationService {
  constructor(
    private readonly signalStoreRepository: SignalStoreRepository,
    private readonly eventLogRepository: EventLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async recalculateDay(command: RecalculateDayCommand): Promise<RecalculateDayResult> {
    // Read the current store first (step 1). Its value is intentionally
    // not used for recalc() below — only effectiveSignalStore (read
    // back after the delta is persisted) is. This read exists to fix
    // the required call order and leaves room for future use (e.g.
    // diffing what changed), not to feed recalc() directly.
    try {
      await this.signalStoreRepository.getAll();
    } catch (cause) {
      throw new SignalPersistenceError(cause);
    }

    const deltaEntries = nonEmptyEntries(command.signalStoreDelta);

    if (deltaEntries.length > 0) {
      try {
        await this.signalStoreRepository.upsertMany(deltaEntries);
      } catch (cause) {
        throw new SignalPersistenceError(cause);
      }
    }

    let effectiveSignalStore: SignalStore;
    try {
      effectiveSignalStore = await this.signalStoreRepository.getAll();
    } catch (cause) {
      throw new SignalPersistenceError(cause);
    }

    let recalculation;
    try {
      // recalc() must be computed from effectiveSignalStore — the value
      // actually read back from the repository after upsertMany() — not
      // from currentSignalStore + the raw command delta. A real
      // (e.g. Postgres-backed) repository may normalize, clamp, round,
      // or otherwise transform values on write; if recalc() used the
      // pre-persistence inputs instead, its output (and the Event Log
      // snapshot built from it) could silently diverge from the state
      // that was actually saved. Passing effectiveSignalStore as
      // currentSignalStore with an empty delta guarantees recalc() only
      // ever sees persisted state.
      recalculation = recalc({
        acceptedDecisions: command.acceptedDecisions,
        twin: command.twin,
        currentSignalStore: effectiveSignalStore,
        signalStoreDelta: {},
        accuracyByDecisionType: command.accuracyByDecisionType,
        causalMaturityByDecisionType: command.causalMaturityByDecisionType,
        baselineForecast: command.baselineForecast,
      });
    } catch (cause) {
      // Deliberately no EventLogRepository calls above this line: if
      // recalc() throws, nothing has been appended to the Event Log.
      throw new RecalcExecutionError(cause);
    }

    // Not atomic: see the "Atomicity note" on the class doc comment
    // above. A failure partway through this loop leaves the entries
    // appended so far persisted.
    const eventLogEntryIds: UUID[] = [];
    try {
      for (const decision of command.acceptedDecisions) {
        const id = this.idGenerator.next();
        const entry: EventLogEntry = {
          id,
          decisionId: decision.id,
          timestamp: this.clock.now(),
          signalsSnapshot: effectiveSignalStore,
          recommendation: {
            type: decision.type,
            proposedAction: decision.proposedAction,
            confidence: recalculation.updatedConfidence[decision.id],
          },
          userAction: "accepted",
          outcome: "pending",
          outcomeTimestamp: null,
          experimentId: null,
        };
        await this.eventLogRepository.append(entry);
        eventLogEntryIds.push(id);
      }
    } catch (cause) {
      throw new EventLogPersistenceError(cause);
    }

    const persistedSignalTypes: SignalType[] = deltaEntries.map((e) => e.signalType);

    return {
      recalculation,
      persistedSignalTypes,
      eventLogEntryIds,
    };
  }
}
