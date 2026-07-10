import { EventLogEntry, UUID } from "../types";

/**
 * Thrown by `append()` when an entry with the same `id` already exists.
 * Any real database-backed implementation will enforce this as a
 * primary-key constraint; the in-memory implementation enforces it
 * explicitly so the two behave identically and the contract tests can
 * verify a future Postgres implementation is a true drop-in
 * replacement rather than silently accepting duplicates the database
 * would reject.
 */
export class DuplicateEventLogEntryError extends Error {
  constructor(id: UUID) {
    super(`EventLogEntry with id "${id}" already exists.`);
    this.name = "DuplicateEventLogEntryError";
  }
}

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
 *
 * That guarantee only holds if implementations also defensively copy
 * data at read/write boundaries (never store or return the exact
 * object reference a caller passed in or gets back) — see
 * InMemoryEventLogRepository for how that's enforced here.
 */
export interface EventLogRepository {
  /**
   * Add a new entry. There is deliberately no update/delete method.
   * Throws DuplicateEventLogEntryError if an entry with this id was
   * already appended.
   */
  append(entry: EventLogEntry): Promise<void>;

  /** All entries recorded for a given decision, in insertion order. */
  findByDecisionId(decisionId: UUID): Promise<EventLogEntry[]>;

  /** Every entry in the log, in insertion order. */
  getAll(): Promise<EventLogEntry[]>;
}
