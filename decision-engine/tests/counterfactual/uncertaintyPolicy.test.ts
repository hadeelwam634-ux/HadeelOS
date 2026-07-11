import { describe, it, expect } from "vitest";
import { evaluateScoreUncertainty, NEAR_TIE_SCORE_THRESHOLD } from "../../src/counterfactual/UncertaintyPolicy";

describe("evaluateScoreUncertainty", () => {
  it("is uncertain with reason no_candidates for an empty list", () => {
    expect(evaluateScoreUncertainty([])).toEqual({ isUncertain: true, reason: "no_candidates" });
  });

  it("is never uncertain for a single scenario", () => {
    expect(evaluateScoreUncertainty([0.7])).toEqual({ isUncertain: false });
  });

  it("is uncertain when the top two scores are within the threshold", () => {
    const result = evaluateScoreUncertainty([0.7, 0.7 - NEAR_TIE_SCORE_THRESHOLD / 2]);
    expect(result.isUncertain).toBe(true);
    expect(result.reason).toBe("near_tie");
  });

  it("is confident when the top two scores are exactly at the threshold boundary or wider", () => {
    const result = evaluateScoreUncertainty([0.7, 0.7 - NEAR_TIE_SCORE_THRESHOLD]);
    expect(result.isUncertain).toBe(false);
  });

  it("never mutates the input array", () => {
    const scores = [0.9, 0.5, 0.3];
    const copy = [...scores];
    evaluateScoreUncertainty(scores);
    expect(scores).toEqual(copy);
  });
});
