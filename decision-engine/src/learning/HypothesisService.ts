import { Hypothesis, UUID } from "../types";
import { IdGenerator } from "../application/types";
import { HypothesisRepository } from "./HypothesisRepository";
import { UnknownHypothesisError } from "./errors";

export interface FormHypothesisInput {
  statement: string;
  relatedEdgeId: UUID;
  competingHypothesisId?: UUID | null;
}

/**
 * Thin orchestration layer over HypothesisRepository: the only place
 * that constructs Hypothesis ids, mirroring KnowledgeGraphService /
 * DecisionApplicationService. Nothing outside this service should call
 * HypothesisRepository directly.
 */
export class HypothesisService {
  constructor(
    private readonly repository: HypothesisRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  /** Forms a new hypothesis. Every causal claim starts at status "forming" with zero evidence. */
  async formHypothesis(input: FormHypothesisInput): Promise<Hypothesis> {
    const hypothesis: Hypothesis = {
      id: this.idGenerator.next(),
      statement: input.statement,
      relatedEdgeId: input.relatedEdgeId,
      status: "forming",
      competingHypothesisId: input.competingHypothesisId ?? null,
      confidence: 0,
      evidenceCount: 0,
    };
    await this.repository.add(hypothesis);
    return hypothesis;
  }

  /** forming -> testing: an experiment is about to be run against this hypothesis. */
  async beginTesting(id: UUID): Promise<Hypothesis> {
    const existing = await this.getOrThrow(id);
    return this.repository.updateStatus(id, {
      status: "testing",
      confidence: existing.confidence,
      evidenceCount: existing.evidenceCount,
    });
  }

  /** forming -> unknown_competing: a competing hypothesis was found before testing began. */
  async markUnknownCompeting(id: UUID, competingHypothesisId: UUID): Promise<Hypothesis> {
    const existing = await this.getOrThrow(id);
    return this.repository.updateStatus(id, {
      status: "unknown_competing",
      confidence: existing.confidence,
      evidenceCount: existing.evidenceCount,
      competingHypothesisId,
    });
  }

  /** testing -> confirmed. */
  async confirm(id: UUID, confidence: number, evidenceCount: number): Promise<Hypothesis> {
    return this.repository.updateStatus(id, { status: "confirmed", confidence, evidenceCount });
  }

  /** testing -> rejected. */
  async reject(id: UUID, confidence: number, evidenceCount: number): Promise<Hypothesis> {
    return this.repository.updateStatus(id, { status: "rejected", confidence, evidenceCount });
  }

  async get(id: UUID): Promise<Hypothesis | undefined> {
    return this.repository.get(id);
  }

  async getByRelatedEdgeId(edgeId: UUID): Promise<Hypothesis[]> {
    return this.repository.getByRelatedEdgeId(edgeId);
  }

  private async getOrThrow(id: UUID): Promise<Hypothesis> {
    const hypothesis = await this.repository.get(id);
    if (hypothesis === undefined) {
      throw new UnknownHypothesisError(id);
    }
    return hypothesis;
  }
}
