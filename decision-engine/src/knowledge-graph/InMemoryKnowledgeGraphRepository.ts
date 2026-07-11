import { CausalMaturity, KGEdge, KGNode, UUID } from "../types";
import { clone } from "../persistence/clone";
import { assertValidMaturityTransition, classifyMaturityTransition } from "./CausalMaturityPolicy";
import {
  DuplicateEdgeError,
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

/**
 * `confidence < 0 || confidence > 1` alone silently admits NaN, because
 * every comparison against NaN is false. Number.isFinite() rejects NaN
 * and +/-Infinity outright, so the range check below only ever sees
 * real finite numbers.
 */
function assertValidConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new InvalidConfidenceError(confidence);
  }
}

/**
 * Same NaN/Infinity trap as confidence, plus evidenceCount must be a
 * whole number — Number.isSafeInteger() rejects NaN, +/-Infinity, and
 * fractional values (e.g. 2.5 "pieces of evidence" is not meaningful).
 */
function assertValidEvidenceCount(evidenceCount: number): void {
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 0) {
    throw new InvalidEvidenceCountError(evidenceCount);
  }
}

/**
 * In-memory implementation of KnowledgeGraphRepository. Every entry is
 * deep-cloned (structuredClone, via ../persistence/clone) on the way in
 * and on the way out, mirroring InMemorySignalStoreRepository /
 * InMemoryEventLogRepository from PR #2 — so neither the caller's
 * original object nor a previously-returned result can be mutated to
 * silently rewrite stored graph state.
 */
export class InMemoryKnowledgeGraphRepository implements KnowledgeGraphRepository {
  private nodes = new Map<UUID, KGNode>();
  private nodeInsertionOrder: UUID[] = [];

  private edges = new Map<UUID, KGEdge>();
  private edgeInsertionOrder: UUID[] = [];

  /** Append-only, per-edge, in insertion order — never mutated or spliced. */
  private maturityHistory = new Map<UUID, MaturityTransitionRecord[]>();

  async addNode(node: KGNode): Promise<void> {
    if (this.nodes.has(node.id)) {
      throw new DuplicateNodeError(node.id);
    }
    this.nodes.set(node.id, clone(node));
    this.nodeInsertionOrder.push(node.id);
  }

  async getNode(id: UUID): Promise<KGNode | undefined> {
    const node = this.nodes.get(id);
    return node === undefined ? undefined : clone(node);
  }

  async getNodesByDomain(domain: string): Promise<KGNode[]> {
    const result: KGNode[] = [];
    for (const id of this.nodeInsertionOrder) {
      const node = this.nodes.get(id)!;
      if (node.domain === domain) result.push(clone(node));
    }
    return result;
  }

  async addEdge(edge: KGEdge, options: AddEdgeOptions = {}): Promise<void> {
    if (this.edges.has(edge.id)) {
      throw new DuplicateEdgeError(edge.id);
    }
    if (!this.nodes.has(edge.fromNodeId)) {
      throw new UnknownNodeReferenceError(edge.fromNodeId);
    }
    if (!this.nodes.has(edge.toNodeId)) {
      throw new UnknownNodeReferenceError(edge.toNodeId);
    }
    if (edge.fromNodeId === edge.toNodeId && !options.allowSelfEdge) {
      throw new SelfEdgeNotAllowedError(edge.fromNodeId);
    }
    assertValidConfidence(edge.confidence);
    assertValidEvidenceCount(edge.evidenceCount);

    this.edges.set(edge.id, clone(edge));
    this.edgeInsertionOrder.push(edge.id);
  }

  async getEdge(id: UUID): Promise<KGEdge | undefined> {
    const edge = this.edges.get(id);
    return edge === undefined ? undefined : clone(edge);
  }

  async findEdgesFrom(nodeId: UUID): Promise<KGEdge[]> {
    return this.edgesInOrder().filter((e) => e.fromNodeId === nodeId);
  }

  async findEdgesTo(nodeId: UUID): Promise<KGEdge[]> {
    return this.edgesInOrder().filter((e) => e.toNodeId === nodeId);
  }

  async findEdgesBetween(fromNodeId: UUID, toNodeId: UUID): Promise<KGEdge[]> {
    return this.edgesInOrder().filter(
      (e) => e.fromNodeId === fromNodeId && e.toNodeId === toNodeId
    );
  }

  async updateEdgeMaturity(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    transition: UpdateEdgeMaturityTransition
  ): Promise<KGEdge> {
    const existing = this.edges.get(edgeId);
    if (existing === undefined) {
      throw new UnknownEdgeError(edgeId);
    }

    // Every check below throws before anything is written: a failed
    // validation must leave both the edge and its history untouched.
    assertValidConfidence(confidence);
    assertValidEvidenceCount(evidenceCount);
    assertValidMaturityTransition(existing.causalMaturity, maturity, {
      reason: transition.reason,
      overrideMaturityTransition: transition.overrideMaturityTransition,
    });

    const kind = classifyMaturityTransition(existing.causalMaturity, maturity);

    const updated: KGEdge = {
      ...existing,
      causalMaturity: maturity,
      confidence,
      evidenceCount,
      lastReinforcedAt: transition.timestamp,
    };
    this.edges.set(edgeId, clone(updated));

    const record: MaturityTransitionRecord = {
      id: transition.recordId,
      edgeId,
      from: existing.causalMaturity,
      to: maturity,
      kind,
      previousConfidence: existing.confidence,
      nextConfidence: confidence,
      previousEvidenceCount: existing.evidenceCount,
      nextEvidenceCount: evidenceCount,
      reason: transition.reason ?? null,
      overrideUsed: kind === "override_skip",
      timestamp: transition.timestamp,
    };
    const history = this.maturityHistory.get(edgeId) ?? [];
    history.push(clone(record));
    this.maturityHistory.set(edgeId, history);

    return clone(updated);
  }

  async getMaturityHistory(edgeId: UUID): Promise<MaturityTransitionRecord[]> {
    const history = this.maturityHistory.get(edgeId) ?? [];
    return history.map((record) => clone(record));
  }

  /** Returns cloned copies of every stored edge, in insertion order. */
  private edgesInOrder(): KGEdge[] {
    return this.edgeInsertionOrder.map((id) => clone(this.edges.get(id)!));
  }
}
