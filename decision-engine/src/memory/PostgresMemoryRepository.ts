import { MemoryGovernanceRecord, MemoryRecord, UUID } from "../types";
import { assertValidMemoryTransition } from "./MemoryStateMachine";
import { MemoryRepository, UpdateMemoryStateInput } from "./MemoryRepository";
import {
  DuplicateMemoryGovernanceRecordError,
  DuplicateMemoryRecordError,
  MemoryInvalidConfidenceError,
  MemoryInvalidEvidenceCountError,
  UnknownMemoryRecordError,
} from "./errors";
import { Queryable } from "../persistence/postgres/Queryable";

interface MemoryRow {
  id: string;
  user_id: string;
  key: string;
  state: string;
  value: unknown;
  confidence: string | number;
  evidence_count: string | number;
  last_reinforced_at: string | Date;
  blocked: boolean;
}

interface GovernanceRow {
  id: string;
  memory_id: string;
  actor: string;
  action: string;
  previous_state: string | null;
  next_state: string | null;
  reason: string;
  timestamp: string | Date;
}

function fromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id as UUID,
    userId: row.user_id as UUID,
    key: row.key,
    state: row.state as MemoryRecord["state"],
    value: row.value,
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
    lastReinforcedAt: new Date(row.last_reinforced_at).toISOString(),
    blocked: row.blocked,
  };
}

function fromGovernanceRow(row: GovernanceRow): MemoryGovernanceRecord {
  return {
    id: row.id as UUID,
    memoryId: row.memory_id as UUID,
    actor: row.actor as MemoryGovernanceRecord["actor"],
    action: row.action as MemoryGovernanceRecord["action"],
    previousState: row.previous_state,
    nextState: row.next_state,
    reason: row.reason,
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

function assertValidConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new MemoryInvalidConfidenceError(confidence);
  }
}

function assertValidEvidenceCount(evidenceCount: number): void {
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 0) {
    throw new MemoryInvalidEvidenceCountError(evidenceCount);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Postgres-backed MemoryRepository, scoped to a single userId bound at
 * construction time. Business-rule validation (confidence/evidence-count
 * range checks, state-machine transition legality, governance-record id
 * uniqueness) is re-implemented here identically to
 * InMemoryMemoryRepository, since MemoryRepository's contract requires
 * every implementation to enforce the same rules — the interface alone
 * does not (and, per Queryable's narrow surface, cannot) push this down
 * into the database.
 *
 * No BEGIN/COMMIT transaction wraps updateState()'s two writes (the
 * UPDATE to memory_records and the INSERT into
 * memory_governance_records), matching the same documented,
 * accepted non-atomicity as PostgresSignalStoreRepository.upsertMany()
 * and the in-memory implementations throughout this codebase.
 */
export class PostgresMemoryRepository implements MemoryRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async add(memory: MemoryRecord): Promise<void> {
    assertValidConfidence(memory.confidence);
    assertValidEvidenceCount(memory.evidenceCount);
    try {
      await this.db.query(
        `INSERT INTO memory_records
           (id, user_id, key, state, value, confidence, evidence_count, last_reinforced_at, blocked)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          memory.id,
          memory.userId,
          memory.key,
          memory.state,
          memory.value === undefined ? null : JSON.stringify(memory.value),
          memory.confidence,
          memory.evidenceCount,
          memory.lastReinforcedAt,
          memory.blocked,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateMemoryRecordError(memory.id);
      throw err;
    }
  }

  async get(id: UUID): Promise<MemoryRecord | undefined> {
    const res = await this.db.query<MemoryRow>(
      `SELECT * FROM memory_records WHERE user_id = $1 AND id = $2`,
      [this.userId, id],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getByKey(userId: UUID, key: string): Promise<MemoryRecord | undefined> {
    const res = await this.db.query<MemoryRow>(
      `SELECT * FROM memory_records WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getAllForUser(userId: UUID): Promise<MemoryRecord[]> {
    const res = await this.db.query<MemoryRow>(
      `SELECT * FROM memory_records WHERE user_id = $1 ORDER BY last_reinforced_at ASC`,
      [userId],
    );
    return res.rows.map(fromRow);
  }

  async updateState(id: UUID, input: UpdateMemoryStateInput): Promise<MemoryRecord> {
    const existing = await this.get(id);
    if (existing === undefined) throw new UnknownMemoryRecordError(id);

    assertValidConfidence(input.confidence);
    assertValidEvidenceCount(input.evidenceCount);
    assertValidMemoryTransition(existing.state, input.state, {
      forceCollapse: input.forceCollapse,
      userCorrection: input.userCorrection,
    });
    await this.assertUniqueGovernanceRecordId(input.governanceRecordId);

    const value = input.value !== undefined ? input.value : existing.value;

    await this.db.query(
      `UPDATE memory_records
         SET state = $1, value = $2, confidence = $3, evidence_count = $4,
             last_reinforced_at = $5, blocked = $6
       WHERE user_id = $7 AND id = $8`,
      [
        input.state,
        value === undefined ? null : JSON.stringify(value),
        input.confidence,
        input.evidenceCount,
        input.timestamp,
        input.blocked !== undefined ? input.blocked : existing.blocked,
        this.userId,
        id,
      ],
    );

    await this.db.query(
      `INSERT INTO memory_governance_records
         (id, memory_id, actor, action, previous_state, next_state, reason, "timestamp")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.governanceRecordId,
        id,
        input.actor,
        input.action,
        existing.state,
        input.state,
        input.reason,
        input.timestamp,
      ],
    );

    return (await this.get(id))!;
  }

  async getGovernanceLog(memoryId: UUID): Promise<MemoryGovernanceRecord[]> {
    const res = await this.db.query<GovernanceRow>(
      `SELECT * FROM memory_governance_records WHERE memory_id = $1 ORDER BY seq ASC`,
      [memoryId],
    );
    return res.rows.map(fromGovernanceRow);
  }

  private async assertUniqueGovernanceRecordId(id: UUID): Promise<void> {
    const res = await this.db.query(`SELECT 1 FROM memory_governance_records WHERE id = $1`, [id]);
    if (res.rows.length > 0) throw new DuplicateMemoryGovernanceRecordError(id);
  }
}
