import { Hypothesis, UUID } from "../types";
import { assertValidHypothesisTransition } from "./HypothesisStateMachine";
import {
  DuplicateHypothesisError,
  LearningInvalidConfidenceError,
  LearningInvalidEvidenceCountError,
  UnknownHypothesisError,
} from "./errors";
import { HypothesisRepository, UpdateHypothesisStatusInput } from "./HypothesisRepository";
import { Queryable } from "../persistence/postgres/Queryable";

interface Row {
  id: string;
  statement: string;
  related_edge_id: string;
  status: string;
  competing_hypothesis_id: string | null;
  confidence: string | number;
  evidence_count: string | number;
}

function fromRow(row: Row): Hypothesis {
  return {
    id: row.id as UUID,
    statement: row.statement,
    relatedEdgeId: row.related_edge_id as UUID,
    status: row.status as Hypothesis["status"],
    competingHypothesisId: row.competing_hypothesis_id as UUID | null,
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
  };
}

function assertValidConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new LearningInvalidConfidenceError(value);
}
function assertValidEvidenceCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new LearningInvalidEvidenceCountError(value);
}
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Postgres-backed HypothesisRepository, scoped to a single userId bound at construction time. */
export class PostgresHypothesisRepository implements HypothesisRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async add(hypothesis: Hypothesis): Promise<void> {
    assertValidConfidence(hypothesis.confidence);
    assertValidEvidenceCount(hypothesis.evidenceCount);
    try {
      await this.db.query(
        `INSERT INTO hypotheses
           (id, user_id, statement, related_edge_id, status, competing_hypothesis_id, confidence, evidence_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          hypothesis.id,
          this.userId,
          hypothesis.statement,
          hypothesis.relatedEdgeId,
          hypothesis.status,
          hypothesis.competingHypothesisId,
          hypothesis.confidence,
          hypothesis.evidenceCount,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateHypothesisError(hypothesis.id);
      throw err;
    }
  }

  async get(id: UUID): Promise<Hypothesis | undefined> {
    const res = await this.db.query<Row>(`SELECT * FROM hypotheses WHERE user_id = $1 AND id = $2`, [
      this.userId,
      id,
    ]);
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async getByRelatedEdgeId(edgeId: UUID): Promise<Hypothesis[]> {
    const res = await this.db.query<Row>(
      `SELECT * FROM hypotheses WHERE user_id = $1 AND related_edge_id = $2`,
      [this.userId, edgeId],
    );
    return res.rows.map(fromRow);
  }

  async updateStatus(id: UUID, input: UpdateHypothesisStatusInput): Promise<Hypothesis> {
    const existing = await this.get(id);
    if (existing === undefined) throw new UnknownHypothesisError(id);

    assertValidConfidence(input.confidence);
    assertValidEvidenceCount(input.evidenceCount);
    assertValidHypothesisTransition(existing.status, input.status);

    const competingHypothesisId =
      input.competingHypothesisId !== undefined ? input.competingHypothesisId : existing.competingHypothesisId;

    await this.db.query(
      `UPDATE hypotheses SET status = $1, confidence = $2, evidence_count = $3, competing_hypothesis_id = $4
       WHERE user_id = $5 AND id = $6`,
      [input.status, input.confidence, input.evidenceCount, competingHypothesisId, this.userId, id],
    );

    return (await this.get(id))!;
  }
}
