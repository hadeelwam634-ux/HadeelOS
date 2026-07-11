import { describe, it, expect } from "vitest";
import {
  assertConsentGuardrails,
  assertExperimentGuardrails,
  categoryRequiresExplicitConsent,
  MAX_MATURITY_FROM_SINGLE_EXPERIMENT,
  qualifiesForStableCausal,
  resolveMaturityAfterConfirmedExperiment,
  STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS,
  STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS,
} from "../../src/learning/ExperimentPolicy";
import { ConsentRequiredError, MissingExperimentGuardrailError } from "../../src/learning/errors";

const VALID_GUARDRAIL_INPUT = {
  hypothesisId: "h1",
  intervention: "10pm lights out",
  singleVariable: true,
  durationDays: 14,
  baselinePeriodDays: 7,
  successMetric: "mood_score improves",
  stopRule: "abort if sleep drops",
  washoutPeriodDays: 3,
  category: "behavioral" as const,
};

describe("categoryRequiresExplicitConsent", () => {
  it("requires consent for health and financial categories only", () => {
    expect(categoryRequiresExplicitConsent("health")).toBe(true);
    expect(categoryRequiresExplicitConsent("financial")).toBe(true);
    expect(categoryRequiresExplicitConsent("behavioral")).toBe(false);
    expect(categoryRequiresExplicitConsent("other")).toBe(false);
  });
});

describe("assertExperimentGuardrails", () => {
  it("does not throw for a fully valid input", () => {
    expect(() => assertExperimentGuardrails(VALID_GUARDRAIL_INPUT)).not.toThrow();
  });

  it("throws MissingExperimentGuardrailError for a missing baseline period", () => {
    expect(() =>
      assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, baselinePeriodDays: 0 })
    ).toThrow(MissingExperimentGuardrailError);
  });

  it("throws MissingExperimentGuardrailError for a missing stop rule", () => {
    expect(() => assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, stopRule: "" })).toThrow(
      MissingExperimentGuardrailError
    );
  });

  it("throws MissingExperimentGuardrailError for a missing/non-positive duration", () => {
    expect(() => assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, durationDays: 0 })).toThrow(
      MissingExperimentGuardrailError
    );
    expect(() => assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, durationDays: 2.5 })).toThrow(
      MissingExperimentGuardrailError
    );
  });

  it("throws MissingExperimentGuardrailError for a missing intervention or success metric", () => {
    expect(() => assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, intervention: "" })).toThrow(
      MissingExperimentGuardrailError
    );
    expect(() => assertExperimentGuardrails({ ...VALID_GUARDRAIL_INPUT, successMetric: "" })).toThrow(
      MissingExperimentGuardrailError
    );
  });
});

describe("assertConsentGuardrails", () => {
  it("blocks health/financial experiments from skipping straight to baseline", () => {
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "health" }, "proposed", "baseline", false)
    ).toThrow(ConsentRequiredError);
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "financial" }, "proposed", "baseline", false)
    ).toThrow(ConsentRequiredError);
  });

  it("allows behavioral/other experiments to go proposed -> baseline directly", () => {
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "behavioral" }, "proposed", "baseline", false)
    ).not.toThrow();
  });

  it("blocks awaiting_consent -> baseline without consentGiven, for every category", () => {
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "behavioral" }, "awaiting_consent", "baseline", false)
    ).toThrow(ConsentRequiredError);
  });

  it("allows awaiting_consent -> baseline with consentGiven: true", () => {
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "health" }, "awaiting_consent", "baseline", true)
    ).not.toThrow();
  });

  it("does not apply to unrelated transitions", () => {
    expect(() =>
      assertConsentGuardrails({ id: "x1", category: "health" }, "baseline", "running", false)
    ).not.toThrow();
  });
});

describe("proof rules — resolveMaturityAfterConfirmedExperiment / qualifiesForStableCausal", () => {
  it("caps a single confirmed experiment at experimentally_supported from correlated or suspected_causal", () => {
    const weakSummary = {
      confirmedExperimentCount: 1,
      totalConfirmedDays: 5,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: false,
    };
    expect(resolveMaturityAfterConfirmedExperiment("correlated", weakSummary)).toBe(
      MAX_MATURITY_FROM_SINGLE_EXPERIMENT
    );
    expect(resolveMaturityAfterConfirmedExperiment("suspected_causal", weakSummary)).toBe(
      MAX_MATURITY_FROM_SINGLE_EXPERIMENT
    );
  });

  it("never reaches stable_causal from correlated/suspected_causal even with a strong aggregate summary", () => {
    const strongSummary = {
      confirmedExperimentCount: 10,
      totalConfirmedDays: 100,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: false,
    };
    expect(resolveMaturityAfterConfirmedExperiment("correlated", strongSummary)).toBe(
      "experimentally_supported"
    );
    expect(qualifiesForStableCausal(strongSummary)).toBe(true); // the summary itself would qualify...
    // ...but a single experiment can never skip straight from correlated to stable_causal.
  });

  it("promotes experimentally_supported -> stable_causal only once the aggregate evidence qualifies", () => {
    const insufficientSummary = {
      confirmedExperimentCount: STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS - 1,
      totalConfirmedDays: STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: false,
    };
    expect(resolveMaturityAfterConfirmedExperiment("experimentally_supported", insufficientSummary)).toBe(
      "experimentally_supported"
    );

    const sufficientSummary = {
      confirmedExperimentCount: STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS,
      totalConfirmedDays: STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: false,
    };
    expect(resolveMaturityAfterConfirmedExperiment("experimentally_supported", sufficientSummary)).toBe(
      "stable_causal"
    );
  });

  it("blocks stable_causal while a strong competing hypothesis is unresolved", () => {
    const summary = {
      confirmedExperimentCount: STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS,
      totalConfirmedDays: STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: true,
    };
    expect(qualifiesForStableCausal(summary)).toBe(false);
    expect(resolveMaturityAfterConfirmedExperiment("experimentally_supported", summary)).toBe(
      "experimentally_supported"
    );
  });

  it("blocks stable_causal when results are inconsistent", () => {
    const summary = {
      confirmedExperimentCount: STABLE_CAUSAL_MIN_CONFIRMED_EXPERIMENTS,
      totalConfirmedDays: STABLE_CAUSAL_MIN_TOTAL_CONFIRMED_DAYS,
      allConfirmedConsistent: false,
      hasStrongCompetingHypothesis: false,
    };
    expect(qualifiesForStableCausal(summary)).toBe(false);
  });

  it("reinforces (stays at) stable_causal once already there", () => {
    const summary = {
      confirmedExperimentCount: 1,
      totalConfirmedDays: 1,
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: false,
    };
    expect(resolveMaturityAfterConfirmedExperiment("stable_causal", summary)).toBe("stable_causal");
  });
});
