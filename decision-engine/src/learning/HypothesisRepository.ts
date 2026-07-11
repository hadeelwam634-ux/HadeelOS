import { Hypothesis, HypothesisStatus, UUID } from "../types";

export interface UpdateHypothesisStatusInput {
  status: HypothesisStatus;
  confidence: number;
  evidenceCount: number;
  /** Pass to set/clear the competing hypothesis link; omit to leave it unchanged. */
  competingHypothesisId?: UUID | null;
}

/**
 * Storage-agnostic contract for Hypothesis records. Like every other
 * repository in this codebase, every method returns a Promise and
 * every implementation is expected to defensively clone at both write
 * and read boundaries. IDs are never generated inside a repository —
 * callers (HypothesisService) supply fully-formed Hypothesis values.
 */
export interface HypothesisRepository {
  /** Throws DuplicateHypothesisError if hypothesis.id already exists. */
  add(hypothesis: Hypothesis): Promise<void>;

  get(id: UUID): Promise<Hypothesis | undefined>;

  /** All hypotheses whose relatedEdgeId matches, in insertion order. */
  getByRelatedEdgeId(edgeId: UUID): Promise<Hypothesis[]>;

  /**
   * Updates an existing hypothesis's status/confidence/evidenceCount
   * (and optionally its competing-hypothesis link), returning the
   * updated hypothesis.
   *
   * Throws UnknownHypothesisError if id does not exist,
   * InvalidConfidenceError / InvalidEvidenceCountError for out-of-range
   * values, and InvalidHypothesisTransitionError if the status
   * transition is not one of the three allowed lifecycle paths — see
   * HypothesisStateMachine.ts.
   */
  updateStatus(id: UUID, input: UpdateHypothesisStatusInput): Promise<Hypothesis>;
}
