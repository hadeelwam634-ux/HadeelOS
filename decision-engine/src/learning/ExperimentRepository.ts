import { Experiment, ExperimentStatus, UUID } from "../types";

export interface UpdateExperimentStatusInput {
  status: ExperimentStatus;
  /** Caller-supplied timestamp, used for startedAt (entering "baseline") / endedAt (entering a final status). */
  timestamp: string;
  /**
   * Required true to leave "awaiting_consent" for "baseline" — see
   * ExperimentPolicy.assertConsentGuardrails(). Ignored for every other
   * transition.
   */
  consentGiven?: boolean;
  /** Required when moving into "aborted"; recorded verbatim, not otherwise validated. */
  reason?: string;
}

/**
 * Storage-agnostic contract for Experiment records, mirroring
 * HypothesisRepository/KnowledgeGraphRepository. IDs and timestamps are
 * never generated inside a repository — callers (ExperimentService)
 * supply fully-formed values.
 */
export interface ExperimentRepository {
  /**
   * Throws DuplicateExperimentError if experiment.id already exists, or
   * MissingExperimentGuardrailError if a required guardrail field is
   * missing/invalid — see ExperimentPolicy.assertExperimentGuardrails().
   */
  add(experiment: Experiment): Promise<void>;

  get(id: UUID): Promise<Experiment | undefined>;

  /** All experiments for a hypothesis, in insertion order. */
  findByHypothesisId(hypothesisId: UUID): Promise<Experiment[]>;

  /**
   * Updates an existing experiment's status (and startedAt/endedAt/
   * consentGiven bookkeeping), returning the updated experiment.
   *
   * Throws UnknownExperimentError if id does not exist,
   * ExperimentImmutableError if the experiment has already reached a
   * final status, InvalidExperimentTransitionError if the transition
   * is not structurally valid (ExperimentStateMachine.ts), and
   * ConsentRequiredError if the consent guardrail is not satisfied
   * (ExperimentPolicy.ts).
   */
  updateStatus(id: UUID, input: UpdateExperimentStatusInput): Promise<Experiment>;
}
