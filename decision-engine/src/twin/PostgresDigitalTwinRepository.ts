import { DigitalTwinSnapshot, UUID } from "../types";
import { DigitalTwinRepository } from "./DigitalTwinRepository";
import { DuplicateDigitalTwinSnapshotError } from "./errors";
import { Queryable } from "../persistence/postgres/Queryable";

interface Row {
  id: string;
  user_id: string;
  derived_at: string | Date;
  stress: string;
  energy_curve: unknown;
  decision_style: string | null;
  behavior_patterns: unknown;
  known_preferences: unknown;
  active_constraints: unknown;
  source_versions: unknown;
}

function fromRow(row: Row): DigitalTwinSnapshot {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    derivedAt: new Date(row.derived_at).toISOString(),
    stress: row.stress as DigitalTwinSnapshot["stress"],
    energyCurve: row.energy_curve as DigitalTwinSnapshot["energyCurve"],
    decisionStyle: row.decision_style,
    behaviorPatterns: row.behavior_patterns as string[],
    knownPreferences: row.known_preferences as string[],
    activeConstraints: row.active_constraints as string[],
    sourceVersions: row.source_versions as DigitalTwinSnapshot["sourceVersions"],
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Postgres-backed DigitalTwinRepository, scoped to a single userId bound
 * at construction time (same isolation pattern as
 * PostgresSignalStoreRepository). getById() additionally filters by the
 * bound user_id even though the interface only takes an id — since
 * ids are UUIDs this is defense-in-depth rather than the primary
 * isolation mechanism, but it keeps the "structurally cannot see another
 * user's row" guarantee container.ts documents.
 */
export class PostgresDigitalTwinRepository implements DigitalTwinRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async save(snapshot: DigitalTwinSnapshot): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO digital_twin_snapshots
           (id, user_id, derived_at, stress, energy_curve, decision_style,
            behavior_patterns, known_preferences, active_constraints, source_versions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          snapshot.id,
          snapshot.userId,
          snapshot.derivedAt,
          snapshot.stress,
          JSON.stringify(snapshot.energyCurve),
          snapshot.decisionStyle,
          JSON.stringify(snapshot.behaviorPatterns),
          JSON.stringify(snapshot.knownPreferences),
          JSON.stringify(snapshot.activeConstraints),
          JSON.stringify(snapshot.sourceVersions),
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateDigitalTwinSnapshotError(snapshot.id);
      throw err;
    }
  }

  async getById(id: UUID): Promise<DigitalTwinSnapshot | undefined> {
    const res = await this.db.query<Row>(
      `SELECT * FROM digital_twin_snapshots WHERE user_id = $1 AND id = $2`,
      [this.userId, id],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getLatest(userId: UUID): Promise<DigitalTwinSnapshot | undefined> {
    const res = await this.db.query<Row>(
      `SELECT * FROM digital_twin_snapshots WHERE user_id = $1 ORDER BY derived_at DESC, id DESC LIMIT 1`,
      [userId],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getHistory(userId: UUID): Promise<DigitalTwinSnapshot[]> {
    const res = await this.db.query<Row>(
      `SELECT * FROM digital_twin_snapshots WHERE user_id = $1 ORDER BY derived_at ASC, id ASC`,
      [userId],
    );
    return res.rows.map(fromRow);
  }
}
