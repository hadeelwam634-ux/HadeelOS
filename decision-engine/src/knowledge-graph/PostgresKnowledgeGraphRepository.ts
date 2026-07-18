import { CausalMaturity, KGEdge, KGNode, UUID } from "../types";
import { assertValidMaturityTransition, classifyMaturityTransition } from "./CausalMaturityPolicy";
import {
  DuplicateEdgeError,
  DuplicateMaturityTransitionRecordError,
  DuplicateNodeError,
  InvalidConfidenceError,
  InvalidEvidenceCountError,
  SelfEdgeNotAllowedError,
  UnknownEdgeError,
  UnknownNodeReferenceError,
} from "./errors";
import {
  AddEdgeOptions,
  KnowledgeGraphRepository,
  MaturityTransitionRecord,
  UpdateEdgeMaturityTransition,
} from "./KnowledgeGraphRepository";
import { Queryable } from "../persistence/postgres/Queryable";

interface NodeRow {
  id: string;
  domain: string;
  created_at: string | Date;
}
interface EdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  record_type: string;
  causal_maturity: string;
  confidence: string | number;
  evidence_count: string | number;
  direction_basis: string;
  last_reinforced_at: string | Date;
}
interface MaturityRow {
  id: string;
  edge_id: string;
  from_maturity: string;
  to_maturity: string;
  kind: string;
  previous_confidence: string | number;
  next_confidence: string | number;
  previous_evidence_count: string | number;
  next_evidence_count: string | number;
  reason: string | null;
  override_used: boolean;
  timestamp: string | Date;
}

function nodeFromRow(row: NodeRow): KGNode {
  return { id: row.id as UUID, domain: row.domain, createdAt: new Date(row.created_at).toISOString() };
}
function edgeFromRow(row: EdgeRow): KGEdge {
  return {
    id: row.id as UUID,
    fromNodeId: row.from_node_id as UUID,
    toNodeId: row.to_node_id as UUID,
    recordType: row.record_type as KGEdge["recordType"],
    causalMaturity: row.causal_maturity as CausalMaturity,
    confidence: Number(row.confidence),
    evidenceCount: Number(row.evidence_count),
    directionBasis: row.direction_basis as KGEdge["directionBasis"],
    lastReinforcedAt: new Date(row.last_reinforced_at).toISOString(),
  };
}
function maturityFromRow(row: MaturityRow): MaturityTransitionRecord {
  return {
    id: row.id as UUID,
    edgeId: row.edge_id as UUID,
    from: row.from_maturity as CausalMaturity,
    to: row.to_maturity as CausalMaturity,
    kind: row.kind as MaturityTransitionRecord["kind"],
    previousConfidence: Number(row.previous_confidence),
    nextConfidence: Number(row.next_confidence),
    previousEvidenceCount: Number(row.previous_evidence_count),
    nextEvidenceCount: Number(row.next_evidence_count),
    reason: row.reason,
    overrideUsed: row.override_used,
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

function assertValidConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new InvalidConfidenceError(confidence);
  }
}
function assertValidEvidenceCount(evidenceCount: number): void {
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 0) {
    throw new InvalidEvidenceCountError(evidenceCount);
  }
}
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Postgres-backed KnowledgeGraphRepository, scoped to a single userId
 * bound at construction time. Reuses the exact same
 * assertValidMaturityTransition/classifyMaturityTransition pure
 * functions the in-memory implementation uses (CausalMaturityPolicy.ts
 * is storage-agnostic by design — see its own doc comment: "this is
 * intentionally the *only* place transition legality is decided"), so
 * both backends enforce identical rules by construction rather than by
 * duplicated logic staying in sync manually.
 */
export class PostgresKnowledgeGraphRepository implements KnowledgeGraphRepository {
  constructor(
    private readonly db: Queryable,
    private readonly userId: UUID,
  ) {}

  async addNode(node: KGNode): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO kg_nodes (id, user_id, domain, created_at) VALUES ($1, $2, $3, $4)`,
        [node.id, this.userId, node.domain, node.createdAt],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateNodeError(node.id);
      throw err;
    }
  }

  async getNode(id: UUID): Promise<KGNode | undefined> {
    const res = await this.db.query<NodeRow>(`SELECT * FROM kg_nodes WHERE user_id = $1 AND id = $2`, [
      this.userId,
      id,
    ]);
    return res.rows[0] ? nodeFromRow(res.rows[0]) : undefined;
  }

  async getNodesByDomain(domain: string): Promise<KGNode[]> {
    const res = await this.db.query<NodeRow>(
      `SELECT * FROM kg_nodes WHERE user_id = $1 AND domain = $2 ORDER BY created_at ASC`,
      [this.userId, domain],
    );
    return res.rows.map(nodeFromRow);
  }

  async addEdge(edge: KGEdge, options: AddEdgeOptions = {}): Promise<void> {
    if ((await this.getNode(edge.fromNodeId)) === undefined) {
      throw new UnknownNodeReferenceError(edge.fromNodeId);
    }
    if ((await this.getNode(edge.toNodeId)) === undefined) {
      throw new UnknownNodeReferenceError(edge.toNodeId);
    }
    if (edge.fromNodeId === edge.toNodeId && !options.allowSelfEdge) {
      throw new SelfEdgeNotAllowedError(edge.fromNodeId);
    }
    assertValidConfidence(edge.confidence);
    assertValidEvidenceCount(edge.evidenceCount);

    try {
      await this.db.query(
        `INSERT INTO kg_edges
           (id, user_id, from_node_id, to_node_id, record_type, causal_maturity,
            confidence, evidence_count, direction_basis, last_reinforced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          edge.id,
          this.userId,
          edge.fromNodeId,
          edge.toNodeId,
          edge.recordType,
          edge.causalMaturity,
          edge.confidence,
          edge.evidenceCount,
          edge.directionBasis,
          edge.lastReinforcedAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateEdgeError(edge.id);
      throw err;
    }
  }

  async getEdge(id: UUID): Promise<KGEdge | undefined> {
    const res = await this.db.query<EdgeRow>(`SELECT * FROM kg_edges WHERE user_id = $1 AND id = $2`, [
      this.userId,
      id,
    ]);
    return res.rows[0] ? edgeFromRow(res.rows[0]) : undefined;
  }

  async findEdgesFrom(nodeId: UUID): Promise<KGEdge[]> {
    const res = await this.db.query<EdgeRow>(
      `SELECT * FROM kg_edges WHERE user_id = $1 AND from_node_id = $2 ORDER BY last_reinforced_at ASC`,
      [this.userId, nodeId],
    );
    return res.rows.map(edgeFromRow);
  }

  async findEdgesTo(nodeId: UUID): Promise<KGEdge[]> {
    const res = await this.db.query<EdgeRow>(
      `SELECT * FROM kg_edges WHERE user_id = $1 AND to_node_id = $2 ORDER BY last_reinforced_at ASC`,
      [this.userId, nodeId],
    );
    return res.rows.map(edgeFromRow);
  }

  async findEdgesBetween(fromNodeId: UUID, toNodeId: UUID): Promise<KGEdge[]> {
    const res = await this.db.query<EdgeRow>(
      `SELECT * FROM kg_edges WHERE user_id = $1 AND from_node_id = $2 AND to_node_id = $3 ORDER BY last_reinforced_at ASC`,
      [this.userId, fromNodeId, toNodeId],
    );
    return res.rows.map(edgeFromRow);
  }

  async updateEdgeMaturity(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    transition: UpdateEdgeMaturityTransition,
  ): Promise<KGEdge> {
    const existing = await this.getEdge(edgeId);
    if (existing === undefined) throw new UnknownEdgeError(edgeId);

    assertValidConfidence(confidence);
    assertValidEvidenceCount(evidenceCount);
    assertValidMaturityTransition(existing.causalMaturity, maturity, {
      reason: transition.reason,
      overrideMaturityTransition: transition.overrideMaturityTransition,
    });
    await this.assertUniqueMaturityRecordId(transition.recordId);

    const kind = classifyMaturityTransition(existing.causalMaturity, maturity);

    await this.db.query(
      `UPDATE kg_edges SET causal_maturity = $1, confidence = $2, evidence_count = $3, last_reinforced_at = $4
       WHERE user_id = $5 AND id = $6`,
      [maturity, confidence, evidenceCount, transition.timestamp, this.userId, edgeId],
    );

    await this.db.query(
      `INSERT INTO kg_maturity_transitions
         (id, edge_id, from_maturity, to_maturity, kind, previous_confidence, next_confidence,
          previous_evidence_count, next_evidence_count, reason, override_used, "timestamp")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        transition.recordId,
        edgeId,
        existing.causalMaturity,
        maturity,
        kind,
        existing.confidence,
        confidence,
        existing.evidenceCount,
        evidenceCount,
        transition.reason ?? null,
        kind === "override_skip",
        transition.timestamp,
      ],
    );

    return (await this.getEdge(edgeId))!;
  }

  async getMaturityHistory(edgeId: UUID): Promise<MaturityTransitionRecord[]> {
    const res = await this.db.query<MaturityRow>(
      `SELECT * FROM kg_maturity_transitions WHERE edge_id = $1 ORDER BY seq ASC`,
      [edgeId],
    );
    return res.rows.map(maturityFromRow);
  }

  private async assertUniqueMaturityRecordId(id: UUID): Promise<void> {
    const res = await this.db.query(`SELECT 1 FROM kg_maturity_transitions WHERE id = $1`, [id]);
    if (res.rows.length > 0) throw new DuplicateMaturityTransitionRecordError(id);
  }
}
