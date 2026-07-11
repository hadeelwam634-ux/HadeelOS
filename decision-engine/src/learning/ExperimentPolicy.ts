import { CausalMaturity, Experiment, ExperimentCategory, ExperimentStatus } from "../types";
import { ConsentRequiredError, MissingExperimentGuardrailError } from "./errors";

/** Categories where an experiment must never start without explicit, recorded consent. */
export const CONSENT_REQUIRED_CATEGORIES: readonly ExperimentCategory[] = ["health", "financial"];

export function categoryRequiresExplicitConsent(category: ExperimentCategory): boolean {
  return CONSENT_REQUIRED_CATEGORIES.includes(category);
}

/**
 * Input shape checked by assertExperimentGuardrails — every field an
 * Experiment needs before it can be proposed at all: hypothesisId,
 * intervention, single-variable-as-much-as-possible, duration, baseline
 * period, success metric, stop rule, washout period, and category.
 */
export interface ExperimentGuardrailInput {
  hypothesisId: string;
  intervention: string;
  singleVariable: boolean;
  durationDays: number;
  baselinePeriodDays: number;
  successMetric: string;
  stopRule: string;
  washoutPeriodDays: number;
  category: ExperimentCategory;
}

/**
 * Throws MissingExperimentGuardrailError for the first missing/invalid
 * required field. Checked once, at proposal time — this is the "every
 * Experiment needs..." guardrail list, not the lifecycle/consent rules
 * below (those live in ExperimentStateMachine.ts and the consent
 * guardrail in this file).
 */
export function assertExperimentGuardrails(input: ExperimentGuardrailInput): void {
  if (!input.hypothesisId) {
    throw new MissingExperimentGuardrailError("hypothesisId");
  }
  if (!input.intervention) {
    throw new MissingExperimentGuardrailError("intervention");
  }
  if (typeof input.singleVariable !== "boolean") {
    throw new MissingExperimentGuardrailError("singleVariable");
  }
  if (!Number.isSafeInteger(input.durationDays) || input.durationDays <= 0) {
    throw new MissingExperimentGuardrailError("durationDays");
  }
  if (!Number.isSafeInteger(input.baselinePeriodDays) || input.baselinePeriodDays <= 0) {
    throw new MissingExperimentGuardrailError("baselinePeriodDays");
  }
  if (!input.successMetric) {
    throw new MissingExperimentGuardrailError("successMetric");
  }
  if (!input.stopRule) {
    throw new MissingExperimentGuardrailError("stopRule");
  }
  if (!Number.isSafeInteger(input.washoutPeriodDays) || input.washoutPeriodDays < 0) {
    throw new MissingExperimentGuardrailError("washoutPeriodDays");
  }
  if (!input.category) {
    throw new MissingExperimentGuardrailError("category");
  }
}

/**
 * Consent gate, layered on top of ExperimentStateMachine's purely
 * structural transitions:
 *
 *   - health/financial experiments may never go proposed -> baseline
 *     directly; they must pass through awaiting_consent.
 *   - awaiting_consent -> baseline requires consentGiven: true for
 *     every category, not just the regulated ones — once an experiment
 *     is sitting in awaiting_consent, entering baseline without
 *     explicit consent is never allowed.
 *
 * Throws ConsentRequiredError; does nothing (returns) if the guardrail
 * is satisfied or does not apply to this transition.
 */
export function assertConsentGuardrails(
  experiment: Pick<Experiment, "id" | "category">,
  from: ExperimentStatus,
  to: ExperimentStatus,
  consentGiven: boolean
): void {
  if (from === "proposed" && to === "baseline" && categoryRequiresExplicitConsent(experiment.category)) {
    throw new ConsentRequiredError(experiment.id);
  }
  if (from === "awaiting_consent" && to === "baseline" && !consentGiven) {
    throw new ConsentRequiredError(experiment.id);
  }
}

// ---------- Proof rules ----------

/** A single confirmed experiment may promote an edge to at most this maturity. */
export const MAX_MATURITY_FROM_SINGLE_EXPERIMENT: CausalMaturity = "experimentally_supported";

/** Minimum documented evidence required before an edge may reach stable_causal. */
export const STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS = 3;
export const STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS = 14;

export interface StableCausalEvidenceSummary {
  /** Count of confirmed experiments tied to this hypothesis/edge, including the one just evaluated. */
  confirmedExperimentCount: number;
  /** Sum of durationDays across those confirmed experiments. */
  totalConfirmedDays: number;
  /** False if any confirmed experiment's result conflicts with the others. */
  allConfirmedConsistent: boolean;
  /** True if there is an unresolved (not-rejected) competing hypothesis. */
  hasStrongCompetingHypothesis: boolean;
}

/**
 * The documented minimum CausalMaturityPolicy.ts and this module agree
 * an edge must clear before it is allowed to reach stable_causal:
 * enough confirmed experiments, enough elapsed days, consistent
 * results, and no live competing hypothesis.
 */
export function qualifiesForStableCausal(summary: StableCausalEvidenceSummary): boolean {
  return (
    summary.confirmedExperimentCount >= STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS &&
    summary.totalConfirmedDays >= STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS &&
    summary.allConfirmedConsistent &&
    !summary.hasStrongCompetingHypothesis
  );
}

/**
 * Determines the causal maturity an edge should move to after a single
 * confirmed experiment, given its current maturity and the aggregate
 * evidence summary across all confirmed experiments for that edge.
 *
 * Never promotes more than one step, and never reaches stable_causal
 * except from experimentally_supported with sufficient aggregate
 * evidence — a single experiment can never make an edge stable_causal,
 * no matter how the aggregate numbers look, because getting there
 * still requires already being at experimentally_supported first.
 */
export function resolveMaturityAfterConfirmedExperiment(
  currentMaturity: CausalMaturity,
  summary: StableCausalEvidenceSummary
): CausalMaturity {
  if (currentMaturity === "correlated" || currentMaturity === "suspected_causal") {
    return MAX_MATURITY_FROM_SINGLE_EXPERIMENT;
  }
  if (currentMaturity === "experimentally_supported") {
    return qualifiesForStableCausal(summary) ? "stable_causal" : "experimentally_supported";
  }
  // already stable_causal — a further confirmed experiment reinforces it, doesn't change it.
  return "stable_causal";
}
