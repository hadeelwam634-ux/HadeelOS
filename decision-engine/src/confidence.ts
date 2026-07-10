import { CausalMaturity, ConfidenceQualifier, SignalStore, SignalStoreEntry } from "./types";

/**
 * Confidence = w1·SignalReliability + w2·HistoricalAccuracy + w3·CausalMaturityScore
 *
 * Default v1.5 weights per "Decision Engine Specification v1" §6.
 * Accuracy dominates until enough causal edges mature past `correlated`.
 */
export interface ConfidenceWeights {
  signalReliability: number;
  historicalAccuracy: number;
  causalMaturity: number;
}

export const DEFAULT_WEIGHTS: ConfidenceWeights = {
  signalReliability: 0.3,
  historicalAccuracy: 0.5,
  causalMaturity: 0.2,
};

const MATURITY_WEIGHT: Record<CausalMaturity, number> = {
  correlated: 0.25,
  suspected_causal: 0.5,
  experimentally_supported: 0.75,
  stable_causal: 1.0,
};

export interface HistoricalAccuracyInput {
  successes: number;
  totalShown: number;
}

export interface ConfidenceInput {
  signalsSnapshot: SignalStore;
  historicalAccuracy: HistoricalAccuracyInput;
  /** null when this decision type has no linked causal edge yet (cold start). */
  causalMaturity: CausalMaturity | null;
  weights?: Partial<ConfidenceWeights>;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function averageSignalReliability(signalsSnapshot: SignalStore): number {
  // SignalStore entries are optional (a partial map), so Object.values()
  // is typed as (SignalStoreEntry | undefined)[]; filter before reducing.
  const entries = Object.values(signalsSnapshot).filter(
    (e): e is SignalStoreEntry => e !== undefined
  );
  if (entries.length === 0) return 0;
  const sum = entries.reduce((acc, e) => acc + e.reliabilityScore, 0);
  return sum / entries.length;
}

export function historicalAccuracy(input: HistoricalAccuracyInput): number {
  if (input.totalShown === 0) return 0;
  return clamp(input.successes / input.totalShown);
}

export function causalMaturityScore(maturity: CausalMaturity | null): number {
  if (maturity === null) return 0;
  return MATURITY_WEIGHT[maturity];
}

export function calculateConfidence(input: ConfidenceInput): number {
  const weights = { ...DEFAULT_WEIGHTS, ...input.weights };

  const signalReliability = averageSignalReliability(input.signalsSnapshot);
  const accuracy = historicalAccuracy(input.historicalAccuracy);
  const maturityScore = causalMaturityScore(input.causalMaturity);

  const confidence =
    weights.signalReliability * signalReliability +
    weights.historicalAccuracy * accuracy +
    weights.causalMaturity * maturityScore;

  return clamp(confidence);
}

/**
 * Mirrors qualifierFor() already implemented in the today_cockpit v6/v7
 * HTML prototypes: >=95 Very High, >=90 High, >=75 Moderate, else Low.
 */
export function qualifierFor(confidence: number): ConfidenceQualifier {
  const pct = confidence * 100;
  if (pct >= 95) return "very_high";
  if (pct >= 90) return "high";
  if (pct >= 75) return "moderate";
  return "low";
}
