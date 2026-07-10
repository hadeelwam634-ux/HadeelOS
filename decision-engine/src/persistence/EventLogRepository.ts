import { EventLogEntry, UUID } from "../types";

/**
 * Storage-agnostic contract for the Event Log.
 *
 * The Event Log is append-only *by construction*: this interface
 * exposes no update or delete method, so no implementation — in-memory
 * today, Postgres later — can offer one either. If a decision's outcome
 * becomes known after the fact, the caller appends a *new*
 * EventLogEntry for that decisionId rather than mutating the original.
 * `findByDecisionId` returns every entry for a decision in insertion
 * order, so the full history (recommendation, then outcome, then any
 * later correction) is always reconstructable and never overwritten —
 * the same "history is never rewritten" guarantee the Decision state
 * machine already enforces for OutcomeRecorded.
 */
export interface EventLogRepository {
  /** Add a new entry. There is deliberately no update/delete method. */
  append(entry: EventLogEntry): Promise<void>;

  /** All entries recorded for a given decision, in insertion order. */
  findByDecisionId(decisionId: UUID): Promise<EventLogEntry[]>;

  /** Every entry in the log, in insertion order. */
  getAll(): Promise<EventLogEntry[]>;
}
