import { CausalMaturity, KGEdge, KGNode, UUID } from "../types";
import { MaturityTransitionOptions } from "./CausalMaturityPolicy";

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
 * KGEdge values and, for updateEdgeMaturity, an explicit
 * reinforcedAt timestamp. This keeps repository behavior deterministic
 * and testable without faking the system clock.
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
   * evidence count, returning the updated edge. `reinforcedAt` is the
   * caller-supplied timestamp for this update (see class doc above for
   * why repositories never call the clock themselves).
   *
   * Throws UnknownEdgeError if edgeId does not exist,
   * InvalidConfidenceError / InvalidEvidenceCountError for out-of-range
   * values, and InvalidMaturityTransitionError if the maturity
   * transition is not allowed — see CausalMaturityPolicy.ts for the
   * exact rules (single-step advances are always allowed; skips need
   * options.overrideMaturityTransition + options.reason; any downgrade
   * needs options.reason).
   */
  updateEdgeMaturity(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    reinforcedAt: string,
    options?: UpdateEdgeMaturityOptions
  ): Promise<KGEdge>;
}
