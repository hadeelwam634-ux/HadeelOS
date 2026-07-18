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
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * Postgres-backed implementation of EventLogRepository, scoped to a
 * single userId bound at construction time — same tenant-isolation
 * approach as PostgresSignalStoreRepository. Duplicate ids are rejected
 * globally by the `id UUID NOT NULL UNIQUE` constraint (event ids are
 * UUIDs, so a cross-user collision is not a realistic concern; the
 * user_id filter below exists purely for read isolation).
 */
export class PostgresEventLogRepository implements EventLogRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async append(entry: EventLogEntry): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO event_log
           (id, decision_id, "timestamp", signals_snapshot, recommendation,
            user_action, outcome, outcome_timestamp, experiment_id, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
          this.userId,
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
      `SELECT * FROM event_log WHERE user_id = $1 AND decision_id = $2 ORDER BY seq ASC`,
      [this.userId, decisionId],
    );
    return res.rows.map(fromRow);
  }

  async getAll(): Promise<EventLogEntry[]> {
    const res = await this.db.query<EventLogRow>(
      `SELECT * FROM event_log WHERE user_id = $1 ORDER BY seq ASC`,
      [this.userId],
    );
    return res.rows.map(fromRow);
  }
}
