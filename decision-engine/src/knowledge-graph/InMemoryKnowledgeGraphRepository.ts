import { CausalMaturity, KGEdge, KGNode, UUID } from "../types";
import { clone } from "../persistence/clone";
import { assertValidMaturityTransition } from "./CausalMaturityPolicy";
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
  UpdateEdgeMaturityOptions,
} from "./KnowledgeGraphRepository";

function assertValidConfidence(confidence: number): void {
  if (confidence < 0 || confidence > 1) {
    throw new InvalidConfidenceError(confidence);
  }
}

function assertValidEvidenceCount(evidenceCount: number): void {
  if (evidenceCount < 0) {
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
    reinforcedAt: string,
    options: UpdateEdgeMaturityOptions = {}
  ): Promise<KGEdge> {
    const existing = this.edges.get(edgeId);
    if (existing === undefined) {
      throw new UnknownEdgeError(edgeId);
    }

    assertValidConfidence(confidence);
    assertValidEvidenceCount(evidenceCount);
    assertValidMaturityTransition(existing.causalMaturity, maturity, options);

    const updated: KGEdge = {
      ...existing,
      causalMaturity: maturity,
      confidence,
      evidenceCount,
      lastReinforcedAt: reinforcedAt,
    };
    this.edges.set(edgeId, clone(updated));
    return clone(updated);
  }

  /** Returns cloned copies of every stored edge, in insertion order. */
  private edgesInOrder(): KGEdge[] {
    return this.edgeInsertionOrder.map((id) => clone(this.edges.get(id)!));
  }
}
