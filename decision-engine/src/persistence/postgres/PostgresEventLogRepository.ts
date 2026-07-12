import { EventLogEntry, Outcome, UserAction, UUID } from "../../types";
import {
  DuplicateEventLogEntryError,
  EventLogRepository,
} from "../EventLogRepository";
import { Queryable } from "./Queryable";

interface EventLogRow {
  id: string;
  decision_id: string;
  timestamp: string | Date;
  signals_snapshot: unknown;
  recommendation: unknown;
  user_action: string;
  outcome: string;
  outcome_timestamp: string | Date | null;
  experiment_id: string | null;
}

function fromRow(row: EventLogRow): EventLogEntry {
  return {
    id: row.id as UUID,
    decisionId: row.decision_id as UUID,
    timestamp: new Date(row.timestamp).toISOString(),
    // pg returns JSONB columns already parsed; pg-mem does the same, so
    // no JSON.parse is needed here. We still return a fresh value on
    // every read (the object literal below), so callers can never
    // mutate what a later read would return.
    signalsSnapshot: (row.signals_snapshot ?? {}) as EventLogEntry["signalsSnapshot"],
    recommendation: row.recommendation,
    userAction: row.user_action as UserAction,
    outcome: row.outcome as Outcome,
    outcomeTimestamp: row.outcome_timestamp
      ? new Date(row.outcome_timestamp).toISOString()
      : null,
    experimentId: row.experiment_id as UUID | null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres error code 23505 = unique_violation. pg-mem reproduces the
  // same code for constraint violations, so this check works identically
  // against both the real driver and the in-test fake.
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * Postgres-backed implementation of EventLogRepository. Duplicate ids are
 * rejected by the `id UUID NOT NULL UNIQUE` constraint in
 * migrations/001_init.sql — this class catches that constraint violation
 * (Postgres error code 23505) and re-throws it as
 * DuplicateEventLogEntryError, so callers see the exact same error type
 * regardless of which backend is wired up. This is the "contract test"
 * guarantee referenced in EventLogRepository's own doc comment.
 */
export class PostgresEventLogRepository implements EventLogRepository {
  constructor(private readonly db: Queryable) {}

  async append(entry: EventLogEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO event_log
           (id, decision_id, "timestamp", signals_snapshot, recommendation,
            user_action, outcome, outcome_timestamp, experiment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.id,
          entry.decisionId,
          entry.timestamp,
          JSON.stringify(entry.signalsSnapshot),
          entry.recommendation === undefined
            ? null
            : JSON.stringify(entry.recommendation),
          entry.userAction,
          entry.outcome,
          entry.outcomeTimestamp,
          entry.experimentId,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateEventLogEntryError(entry.id);
      }
      throw err;
    }
  }

  async findByDecisionId(decisionId: UUID): Promise<EventLogEntry[]> {
    const res = await this.db.query<EventLogRow>(
      `SELECT * FROM event_log WHERE decision_id = $1 ORDER BY seq ASC`,
      [decisionId],
    );
    return res.rows.map(fromRow);
  }

  async getAll(): Promise<EventLogEntry[]> {
    const res = await this.db.query<EventLogRow>(
      `SELECT * FROM event_log ORDER BY seq ASC`,
      [],
    );
    return res.rows.map(fromRow);
  }
}
