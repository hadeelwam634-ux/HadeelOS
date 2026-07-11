import { CausalMaturity, KGEdge, KGNode, RecordType, UUID } from "../types";
import { Clock, IdGenerator } from "../application/types";
import { AddEdgeOptions, KnowledgeGraphRepository, UpdateEdgeMaturityOptions } from "./KnowledgeGraphRepository";

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

  /** Reinforces an existing edge's maturity/confidence/evidence, stamped with the current time. */
  async reinforceEdge(
    edgeId: UUID,
    maturity: CausalMaturity,
    confidence: number,
    evidenceCount: number,
    options?: UpdateEdgeMaturityOptions
  ): Promise<KGEdge> {
    return this.repository.updateEdgeMaturity(
      edgeId,
      maturity,
      confidence,
      evidenceCount,
      this.clock.now(),
      options
    );
  }
}
