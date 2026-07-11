import { ExperimentStatus, HypothesisStatus, UUID } from "../types";

/** Base class for every error this module throws. */
export class LearningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningError";
  }
}

// ---------- Hypothesis errors ----------

export class DuplicateHypothesisError extends LearningError {
  constructor(id: UUID) {
    super(`Hypothesis with id "${id}" already exists.`);
    this.name = "DuplicateHypothesisError";
  }
}

export class UnknownHypothesisError extends LearningError {
  constructor(id: UUID) {
    super(`Hypothesis with id "${id}" does not exist.`);
    this.name = "UnknownHypothesisError";
  }
}

export class InvalidHypothesisTransitionError extends LearningError {
  constructor(from: HypothesisStatus, to: HypothesisStatus) {
    super(`Hypothesis transition from "${from}" to "${to}" is not allowed.`);
    this.name = "InvalidHypothesisTransitionError";
  }
}

// ---------- Experiment errors ----------

export class DuplicateExperimentError extends LearningError {
  constructor(id: UUID) {
    super(`Experiment with id "${id}" already exists.`);
    this.name = "DuplicateExperimentError";
  }
}

export class UnknownExperimentError extends LearningError {
  constructor(id: UUID) {
    super(`Experiment with id "${id}" does not exist.`);
    this.name = "UnknownExperimentError";
  }
}

export class InvalidExperimentTransitionError extends LearningError {
  constructor(from: ExperimentStatus, to: ExperimentStatus) {
    super(`Experiment transition from "${from}" to "${to}" is not allowed.`);
    this.name = "InvalidExperimentTransitionError";
  }
}

/** Thrown by any attempt to update an experiment that has already reached a final status. */
export class ExperimentImmutableError extends LearningError {
  constructor(id: UUID, status: ExperimentStatus) {
    super(`Experiment "${id}" has already reached final status "${status}" and is immutable.`);
    this.name = "ExperimentImmutableError";
  }
}

/**
 * Thrown when an experiment (or the input to propose one) is missing a
 * required guardrail field — see ExperimentPolicy.ts for the full list
 * ("every Experiment needs a hypothesisId, intervention, ... category").
 */
export class MissingExperimentGuardrailError extends LearningError {
  constructor(field: string) {
    super(`Experiment is missing required guardrail field "${field}".`);
    this.name = "MissingExperimentGuardrailError";
  }
}

/**
 * Thrown when an experiment tries to leave "awaiting_consent" for
 * "baseline" without consentGiven: true, or when a health/financial
 * experiment tries to skip "awaiting_consent" entirely.
 */
export class ConsentRequiredError extends LearningError {
  constructor(id: UUID) {
    super(`Experiment "${id}" requires explicit consent before it can start.`);
    this.name = "ConsentRequiredError";
  }
}

// ---------- Shared numeric validation errors ----------
// Named distinctly from knowledge-graph/errors.ts's InvalidConfidenceError /
// InvalidEvidenceCountError so the root barrel (src/index.ts) can
// re-export both modules without an ambiguous-export collision.

export class LearningInvalidConfidenceError extends LearningError {
  constructor(confidence: number) {
    super(`confidence must be a finite number between 0 and 1 inclusive, got ${confidence}.`);
    this.name = "LearningInvalidConfidenceError";
  }
}

export class LearningInvalidEvidenceCountError extends LearningError {
  constructor(evidenceCount: number) {
    super(`evidenceCount must be a non-negative safe integer, got ${evidenceCount}.`);
    this.name = "LearningInvalidEvidenceCountError";
  }
}
