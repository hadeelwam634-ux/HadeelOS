import { CausalMaturity, KGEdge, KGNode, UUID } from "../types";
import { MaturityTransitionKind, MaturityTransitionOptions } from "./CausalMaturityPolicy";

export interface AddEdgeOptions {
  /**
   * By default an edge whose fromNodeId equals its toNodeId is
   * rejected. Set this to true to explicitly allow a self-edge (e.g. a
   * node reinforcing its own prior state).
   */
  allowSelfEdge?: boolean;
}

export type UpdateEdgeMaturityOptions = MaturityTransitionOptions;

/**
 * Everything needed to apply one updateEdgeMaturity() call and record it
 * in the audit trail. `recordId` and `timestamp` are caller-supplied
 * (typically by KnowledgeGraphService, via the injected IdGenerator /
 * Clock) so the repository never generates IDs or reads the system
 * clock itself — see the class doc below.
 */
export interface UpdateEdgeMaturityTransition {
  recordId: UUID;
  timestamp: string;
  reason?: string;
  overrideMaturityTransition?: boolean;
}

/**
 * One append-only audit-trail entry for a causal-maturity change on an
 * edge. Written by updateEdgeMaturity() every time it succeeds —
 * including a same-state reinforcement (kind: "no_change") — and never
 * written when validation fails. Mirrors the EventLogRepository
 * append-only pattern from PR #2: there is no update or delete method
 * for these records anywhere in this interface.
 */
export interface MaturityTransitionRecord {
  id: UUID;
  edgeId: UUID;
  from: CausalMaturity;
  to: CausalMaturity;
  kind: MaturityTransitionKind;
  previousConfidence: number;
  nextConfidence: number;
  previousEvidenceCount: number;
  nextEvidenceCount: number;
  reason: string | null;
  overrideUsed: boolean;
  timestamp: string;
}

/**
 * Storage-agnostic contract for the Knowledge Graph: nodes (Observation
 * / Hypothesis / Belief / Decision records, per KGNode) and the causal
 * edges between them (KGEdge).
 *
 * Like SignalStoreRepository / EventLogRepository (PR #2), every method
 * returns a Promise and every implementation is expected to defensively
 * clone at both write and read boundaries, so a future Postgres-backed
 * implementation is a drop-in replacement with no call-site changes.
 *
 * IDs and timestamps are never generated inside a repository
 * implementation — callers (typically KnowledgeGraphService, which
 * holds the injected IdGenerator/Clock) supply fully-formed KGNode /
 * KGEdge values and, for updateEdgeMaturity, a fully-formed
 * `transition` (recordId + timestamp + optional reason/override). This
 * keeps repository behavior deterministic and testable without faking
 * the system clock or ID generation.
 */
export interface KnowledgeGraphRepository {
  /** Throws DuplicateNodeError if node.id already exists. */
  addNode(node: KGNode): Promise<void>;

  getNode(id: UUID): Promise<KGNode | undefined>;

  /** All nodes in the given domain, in insertion order. */
  getNodesByDomain(domain: string): Promise<KGNode[]>;

  /**
   * Throws DuplicateEdgeError if edge.id already exists,
   * UnknownNodeReferenceError if fromNodeId or toNodeId was never added
   * via addNode(), SelfEdgeNotAllowedError if fromNodeId === toNodeId
   * and options.allowSelfEdge is not true, InvalidConfidenceError if
   * edge.confidence is outside [0, 1], or InvalidEvidenceCountError if
   * edge.evidenceCount is negative.
   */
  addEdge(edge: KGEdge, options?: AddEdgeOptions): Promise<void>;

  getEdge(id: UUID): Promise<KGEdge | undefined>;

  /** All edges starting at nodeId, in insertion order. */
  findEdgesFrom(nodeId: UUID): Promise<KGEdge[]>;

  /** All edges ending at nodeId, in insertion order. */
  findEdgesTo(nodeId: UUID): Promise<KGEdge[]>;

  /** All edges from fromNodeId directly to toNodeId, in insertion order. */
  findEdgesBetween(fromNodeId: UUID, toNodeId: UUID): Promise<KGEdge[]>;

  /**
   * Updates an existing edge's causal maturity, confidence, and
   * evidence count, returning the updated edge. `transition.timestamp`
   * is used both as the edge's new lastReinforcedAt and as the
   * resulting MaturityTransitionRecord's timestamp (see class doc above
   * for why repositories never call the clock or an ID generator
   * themselves).
   *
   * Throws UnknownEdgeError if edgeId does not exist,
   * InvalidConfidenceError / InvalidEvidenceCountError for out-of-range
   * values, and InvalidMaturityTransitionError if the maturity
   * transition is not allowed — see CausalMaturityPolicy.ts for the
   * exact rules (single-step advances are always allowed; skips need
   * transition.overrideMaturityTransition + transition.reason; any
   * downgrade needs transition.reason). On any of these failures,
   * nothing is written: the edge is unchanged and no
   * MaturityTransitionRecord is appended.
   *
   * On success, exactly one MaturityTransitionRecord is appended to the
   * edge's history — including for a same-state ("no_change")
   * reinforcement — retrievable via getMaturityHistory().
   */
  updateEdgeMaturity(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    transition: UpdateEdgeMaturityTransition
  ): Promise<KGEdge>;

  /**
   * The append-only audit trail of every successful updateEdgeMaturity()
   * call for this edge, in insertion order. Returns an empty array for
   * an edge with no history yet (including an edge that does not
   * exist — this method never throws UnknownEdgeError).
   */
  getMaturityHistory(edgeId: UUID): Promise<MaturityTransitionRecord[]>;
}
