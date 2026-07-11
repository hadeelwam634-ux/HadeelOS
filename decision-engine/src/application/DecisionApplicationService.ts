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
 *   4. Call recalc().
 *   5. Append one EventLogEntry per accepted decision — only once
 *      recalc() has succeeded.
 */
export class DecisionApplicationService {
  constructor(
    private readonly signalStoreRepository: SignalStoreRepository,
    private readonly eventLogRepository: EventLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async recalculateDay(command: RecalculateDayCommand): Promise<RecalculateDayResult> {
    let currentSignalStore: SignalStore;
    try {
      currentSignalStore = await this.signalStoreRepository.getAll();
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
      recalculation = recalc({
        acceptedDecisions: command.acceptedDecisions,
        twin: command.twin,
        currentSignalStore,
        signalStoreDelta: command.signalStoreDelta,
        accuracyByDecisionType: command.accuracyByDecisionType,
        causalMaturityByDecisionType: command.causalMaturityByDecisionType,
        baselineForecast: command.baselineForecast,
      });
    } catch (cause) {
      // Deliberately no EventLogRepository calls above this line: if
      // recalc() throws, nothing has been appended to the Event Log.
      throw new RecalcExecutionError(cause);
    }

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
