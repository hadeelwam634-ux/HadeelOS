import { CausalMaturity, KGEdge, KGNode, RecordType, UUID } from "../types";
import { Clock, IdGenerator } from "../application/types";
import {
  AddEdgeOptions,
  KnowledgeGraphRepository,
  MaturityTransitionRecord,
  UpdateEdgeMaturityOptions,
} from "./KnowledgeGraphRepository";

export interface RecordEdgeInput {
  fromNodeId: UUID;
  toNodeId: UUID;
  recordType: RecordType;
  directionBasis: "temporal_precedence" | "experiment";
  /** Defaults to "correlated" — every causal claim starts at the weakest maturity. */
  initialMaturity?: CausalMaturity;
  /** Defaults to 0. */
  initialConfidence?: number;
  /** Defaults to 0. */
  initialEvidenceCount?: number;
}

/**
 * Thin orchestration layer over KnowledgeGraphRepository: the only
 * place in the codebase that constructs KGNode/KGEdge ids and
 * timestamps, using the injected IdGenerator/Clock so behavior stays
 * deterministic in tests (mirrors DecisionApplicationService from
 * PR #3). Nothing outside this service (or a future caller that itself
 * holds these dependencies) should call KnowledgeGraphRepository
 * directly, per the repo-wide "application services are the only
 * orchestration boundary" rule.
 */
export class KnowledgeGraphService {
  constructor(
    private readonly repository: KnowledgeGraphRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async recordNode(domain: string): Promise<KGNode> {
    const node: KGNode = {
      id: this.idGenerator.next(),
      domain,
      createdAt: this.clock.now(),
    };
    await this.repository.addNode(node);
    return node;
  }

  async recordEdge(input: RecordEdgeInput, options?: AddEdgeOptions): Promise<KGEdge> {
    const edge: KGEdge = {
      id: this.idGenerator.next(),
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      recordType: input.recordType,
      causalMaturity: input.initialMaturity ?? "correlated",
      confidence: input.initialConfidence ?? 0,
      evidenceCount: input.initialEvidenceCount ?? 0,
      directionBasis: input.directionBasis,
      lastReinforcedAt: this.clock.now(),
    };
    await this.repository.addEdge(edge, options);
    return edge;
  }

  /**
   * Reinforces an existing edge's maturity/confidence/evidence. Stamps
   * the update with the current time and mints a fresh record ID for
   * the resulting MaturityTransitionRecord — this is the only place
   * that ID and timestamp are decided, so the repository stays
   * deterministic and testable on its own.
   */
  async reinforceEdge(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    options?: UpdateEdgeMaturityOptions
  ): Promise<KGEdge> {
    return this.repository.updateEdgeMaturity(edgeId, maturity, confidence, evidenceCount, {
      recordId: this.idGenerator.next(),
      timestamp: this.clock.now(),
      reason: options?.reason,
      overrideMaturityTransition: options?.overrideMaturityTransition,
    });
  }

  /** The append-only maturity-change audit trail for an edge, in insertion order. */
  async getMaturityHistory(edgeId: UUID): Promise<MaturityTransitionRecord[]> {
    return this.repository.getMaturityHistory(edgeId);
  }

  /**
   * Thin read passthrough — added in PR #5 so other application services
   * (e.g. ExperimentService, which needs an edge's current maturity and
   * confidence before reinforcing it) never have to reach past this
   * service into KnowledgeGraphRepository directly.
   */
  async getEdge(edgeId: UUID): Promise<KGEdge | undefined> {
    return this.repository.getEdge(edgeId);
  }

  /**
   * Thin read passthroughs — added in PR #8 so TodayDecisionApplicationService
   * can build a CounterfactualEngine KnowledgeGraphSnapshot (every edge
   * relevant to a candidate decision's domain) without reaching past
   * this service into KnowledgeGraphRepository directly, same
   * justification as getEdge() above.
   */
  async getNodesByDomain(domain: string): Promise<KGNode[]> {
    return this.repository.getNodesByDomain(domain);
  }

  async findEdgesFrom(nodeId: UUID): Promise<KGEdge[]> {
    return this.repository.findEdgesFrom(nodeId);
  }

  async findEdgesTo(nodeId: UUID): Promise<KGEdge[]> {
    return this.repository.findEdgesTo(nodeId);
  }
}
