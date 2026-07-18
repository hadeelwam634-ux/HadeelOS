import { SignalStore, SignalStoreEntry, SignalType, UUID } from "../../types";
import { SignalStoreRepository } from "../SignalStoreRepository";
import { Queryable } from "./Queryable";

interface SignalStoreRow {
  signal_type: string;
  latest_value_number: string | number | null;
  latest_value_text: string | null;
  latest_value_kind: "number" | "string";
  latest_timestamp: string | Date;
  reliability_score: string | number;
  sync_consistency_days: string | number;
}

function toParams(userId: UUID, entry: SignalStoreEntry) {
  const isNumber = typeof entry.latestValue === "number";
  return [
    userId,
    entry.signalType,
    isNumber ? (entry.latestValue as number) : null,
    isNumber ? null : (entry.latestValue as string),
    isNumber ? "number" : "string",
    entry.latestTimestamp,
    entry.reliabilityScore,
    entry.syncConsistencyDays,
  ];
}

function fromRow(row: SignalStoreRow): SignalStoreEntry {
  return {
    signalType: row.signal_type as SignalType,
    latestValue:
      row.latest_value_kind === "number"
        ? Number(row.latest_value_number)
        : String(row.latest_value_text),
    latestTimestamp: new Date(row.latest_timestamp).toISOString(),
    reliabilityScore: Number(row.reliability_score),
    syncConsistencyDays: Number(row.sync_consistency_days),
  };
}

/**
 * Postgres-backed implementation of SignalStoreRepository, scoped to a
 * single userId bound at construction time (mirroring how the in-memory
 * implementation achieves isolation via a fresh Map per AppContainer
 * user — see container.ts's class doc comment). Every query filters by
 * this bound user_id, so a single shared `signal_store` table can never
 * leak one user's signals into another user's reads.
 *
 * Every row read from the database is turned into a brand-new object by
 * fromRow(), so (unlike the in-memory implementation) there is no
 * shared-reference risk to defend against.
 */
export class PostgresSignalStoreRepository implements SignalStoreRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async upsert(entry: SignalStoreEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO signal_store
         (user_id, signal_type, latest_value_number, latest_value_text, latest_value_kind,
          latest_timestamp, reliability_score, sync_consistency_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, signal_type) DO UPDATE SET
         latest_value_number = EXCLUDED.latest_value_number,
         latest_value_text = EXCLUDED.latest_value_text,
         latest_value_kind = EXCLUDED.latest_value_kind,
         latest_timestamp = EXCLUDED.latest_timestamp,
         reliability_score = EXCLUDED.reliability_score,
         sync_consistency_days = EXCLUDED.sync_consistency_days`,
      toParams(this.userId, entry),
    );
  }

  async upsertMany(entries: SignalStoreEntry[]): Promise<void> {
    // No transaction wrapper here deliberately: Queryable is intentionally
    // narrower than PoolClient (no BEGIN/COMMIT), matching the in-memory
    // implementation's own non-atomic upsertMany. See README for the
    // documented non-atomicity this mirrors from PR #3.
    for (const entry of entries) {
      await this.upsert(entry);
    }
  }

  async get(signalType: SignalType): Promise<SignalStoreEntry | undefined> {
    const res = await this.db.query<SignalStoreRow>(
      `SELECT * FROM signal_store WHERE user_id = $1 AND signal_type = $2`,
      [this.userId, signalType],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getAll(): Promise<SignalStore> {
    const res = await this.db.query<SignalStoreRow>(
      `SELECT * FROM signal_store WHERE user_id = $1`,
      [this.userId],
    );
    const result: SignalStore = {};
    for (const row of res.rows) {
      const entry = fromRow(row);
      result[entry.signalType] = entry;
    }
    return result;
  }

  async delete(signalType: SignalType): Promise<void> {
    await this.db.query(`DELETE FROM signal_store WHERE user_id = $1 AND signal_type = $2`, [
      this.userId,
      signalType,
    ]);
  }
}
