/**
 * How close the top two scenario scores must be before the engine
 * refuses to pick a confident winner and reports uncertainty instead.
 * A near-tie is a real epistemic state, not a rounding error — see
 * "Final Execution Orders" PR #7: "عند فارق أقل من threshold، يعيد
 * uncertain بدل اختيار واثق."
 */
export const NEAR_TIE_SCORE_THRESHOLD = 0.03;

export interface UncertaintyOutcome {
  isUncertain: boolean;
  reason?: string;
  margin?: number;
}

/**
 * Decides whether the gap between the best and second-best scenario
 * score is wide enough to select a confident winner. `sortedScores`
 * must already be sorted descending; only the top two entries matter.
 * Never mutates its input.
 */
export function evaluateScoreUncertainty(sortedScores: readonly number[]): UncertaintyOutcome {
  if (sortedScores.length === 0) {
    return { isUncertain: true, reason: "no_candidates" };
  }
  if (sortedScores.length === 1) {
    return { isUncertain: false };
  }
  const top = sortedScores[0];
  const second = sortedScores[1];
  const margin = top - second;
  if (margin < NEAR_TIE_SCORE_THRESHOLD) {
    return { isUncertain: true, reason: "near_tie", margin };
  }
  return { isUncertain: false, margin };
}
