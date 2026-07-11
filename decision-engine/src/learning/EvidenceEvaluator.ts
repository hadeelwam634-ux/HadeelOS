/**
 * What an experiment's run produced, measured against its own
 * successMetric/stopRule (defined when the experiment was proposed).
 * This is intentionally a small, pre-computed summary rather than raw
 * measurements — turning raw data into "did we see an effect, did it
 * meet the bar" is outside this engine's scope for the MVP.
 */
export interface ExperimentEvidenceInput {
  /** Was any directional effect observed at all, in either direction? */
  effectObserved: boolean;
  /** Did the effect meet the experiment's pre-declared successMetric? */
  metricMet: boolean;
}

export type ExperimentEvaluationOutcome = "confirmed" | "rejected" | "inconclusive";

/**
 * Deterministic evidence -> outcome mapping, so the same evidence
 * always produces the same verdict:
 *
 *   - no effect observed at all           -> rejected
 *   - effect observed and metric met      -> confirmed
 *   - effect observed but metric not met  -> inconclusive (insufficient)
 */
export function evaluateExperimentEvidence(
  input: ExperimentEvidenceInput
): ExperimentEvaluationOutcome {
  if (!input.effectObserved) {
    return "rejected";
  }
  return input.metricMet ? "confirmed" : "inconclusive";
}
