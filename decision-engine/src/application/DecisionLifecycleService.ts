import { EventLogEntry, Outcome, UUID, UserAction } from "../types";
import { EventLogRepository } from "../persistence/EventLogRepository";
import { Clock, IdGenerator } from "./types";
import { DecisionNotYetRespondedError, EventLogPersistenceError, UnknownDecisionError } from "./errors";

export type RespondAction = Exclude<UserAction, "proposed">;
export type RecordableOutcome = Exclude<Outcome, "pending">;

/**
 * Orchestrates the post-proposal lifecycle of a Decision's Event Log
 * history for the API layer (PR #9): responding to a proposed
 * recommendation, and later recording its outcome. Both operations
 * only ever *append* a new EventLogEntry — matching the append-only
 * guarantee documented on EventLogRepository — never mutate an
 * earlier one, so the full history (proposed -> responded -> outcome)
 * is always reconstructable via getHistory().
 */
export class DecisionLifecycleService {
  constructor(
    private readonly eventLogRepository: EventLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  /**
   * Appends a new entry recording the user's response to a previously
   * proposed decision. Carries forward the original recommendation's
   * signalsSnapshot/recommendation/experimentId so the response entry
   * stays self-contained without re-deriving them.
   */
  async respond(decisionId: UUID, action: RespondAction): Promise<EventLogEntry> {
    const history = await this.getHistory(decisionId);
    if (history.length === 0) throw new UnknownDecisionError(decisionId);

    const proposed = [...history].reverse().find((e) => e.userAction === "proposed") ?? history[history.length - 1];

    const entry: EventLogEntry = {
      id: this.idGenerator.next(),
      decisionId,
      timestamp: this.clock.now(),
      signalsSnapshot: proposed.signalsSnapshot,
      recommendation: proposed.recommendation,
      userAction: action,
      outcome: "pending",
      outcomeTimestamp: null,
      experimentId: proposed.experimentId,
    };

    try {
      await this.eventLogRepository.append(entry);
    } catch (cause) {
      throw new EventLogPersistenceError(cause);
    }
    return entry;
  }

  /**
   * Appends a new entry recording the decision's real-world outcome.
   * Requires at least one prior response entry (not just "proposed") —
   * an outcome can't be recorded for a decision the user never
   * actually accepted, rejected, or ignored.
   */
  async recordOutcome(decisionId: UUID, outcome: RecordableOutcome): Promise<EventLogEntry> {
    const history = await this.getHistory(decisionId);
    if (history.length === 0) throw new UnknownDecisionError(decisionId);

    const latest = history[history.length - 1];
    if (latest.userAction === "proposed") {
      throw new DecisionNotYetRespondedError(decisionId);
    }

    const entry: EventLogEntry = {
      id: this.idGenerator.next(),
      decisionId,
      timestamp: this.clock.now(),
      signalsSnapshot: latest.signalsSnapshot,
      recommendation: latest.recommendation,
      userAction: latest.userAction,
      outcome,
      outcomeTimestamp: this.clock.now(),
      experimentId: latest.experimentId,
    };

    try {
      await this.eventLogRepository.append(entry);
    } catch (cause) {
      throw new EventLogPersistenceError(cause);
    }
    return entry;
  }

  async getHistory(decisionId: UUID): Promise<EventLogEntry[]> {
    return this.eventLogRepository.findByDecisionId(decisionId);
  }
}
