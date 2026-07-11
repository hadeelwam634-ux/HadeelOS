import { Hypothesis, UUID } from "../types";
import { clone } from "../persistence/clone";
import { assertValidHypothesisTransition } from "./HypothesisStateMachine";
import { DuplicateHypothesisError, LearningInvalidConfidenceError, LearningInvalidEvidenceCountError, UnknownHypothesisError } from "./errors";
import { HypothesisRepository, UpdateHypothesisStatusInput } from "./HypothesisRepository";

function assertValidConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new LearningInvalidConfidenceError(value);
  }
}

function assertValidEvidenceCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LearningInvalidEvidenceCountError(value);
  }
}

/**
 * In-memory implementation of HypothesisRepository. Every entry is
 * deep-cloned (structuredClone, via ../persistence/clone) on the way in
 * and on the way out, exactly like every other repository in this
 * codebase.
 */
export class InMemoryHypothesisRepository implements HypothesisRepository {
  private hypotheses = new Map<UUID, Hypothesis>();
  private insertionOrder: UUID[] = [];

  async add(hypothesis: Hypothesis): Promise<void> {
    if (this.hypotheses.has(hypothesis.id)) {
      throw new DuplicateHypothesisError(hypothesis.id);
    }
    assertValidConfidence(hypothesis.confidence);
    assertValidEvidenceCount(hypothesis.evidenceCount);
    this.hypotheses.set(hypothesis.id, clone(hypothesis));
    this.insertionOrder.push(hypothesis.id);
  }

  async get(id: UUID): Promise<Hypothesis | undefined> {
    const hypothesis = this.hypotheses.get(id);
    return hypothesis === undefined ? undefined : clone(hypothesis);
  }

  async getByRelatedEdgeId(edgeId: UUID): Promise<Hypothesis[]> {
    const result: Hypothesis[] = [];
    for (const id of this.insertionOrder) {
      const hypothesis = this.hypotheses.get(id)!;
      if (hypothesis.relatedEdgeId === edgeId) result.push(clone(hypothesis));
    }
    return result;
  }

  async updateStatus(id: UUID, input: UpdateHypothesisStatusInput): Promise<Hypothesis> {
    const existing = this.hypotheses.get(id);
    if (existing === undefined) {
      throw new UnknownHypothesisError(id);
    }

    assertValidConfidence(input.confidence);
    assertValidEvidenceCount(input.evidenceCount);
    assertValidHypothesisTransition(existing.status, input.status);

    const updated: Hypothesis = {
      ...existing,
      status: input.status,
      confidence: input.confidence,
      evidenceCount: input.evidenceCount,
      competingHypothesisId:
        input.competingHypothesisId !== undefined
          ? input.competingHypothesisId
          : existing.competingHypothesisId,
    };
    this.hypotheses.set(id, clone(updated));
    return clone(updated);
  }
}
