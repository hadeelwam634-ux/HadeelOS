import { Decision, DigitalTwin, SignalStore, CausalMaturity } from "./types";
import { calculateConfidence, HistoricalAccuracyInput } from "./confidence";

/**
 * Formal recalc() — "Decision Engine Specification v1" §9.
 *
 * Replaces the flat "n accepted -> +1%" heuristic used in the
 * today_cockpit v5-v7 HTML prototypes with real reads from the
 * Digital Twin / Signal Store / Knowledge Graph (via the caller-supplied
 * accuracy + causal maturity maps below).
 *
 * The output shape intentionally matches what the prototype's recalc()
 * already renders (completion %, capacity %, per-decision confidence,
 * timeline order, a toast flag) so the existing UI can be wired to this
 * function without a rewrite.
 */

export interface RecalcInput {
  acceptedDecisions: Decision[];
  twin: DigitalTwin;
  /** Live SignalStore updates since the last recalc pass. */
  signalStoreDelta: SignalStore;
  /** Per-decision-type historical accuracy, normally read from EventLog. */
  accuracyByDecisionType: Record<string, HistoricalAccuracyInput>;
  /** Per-decision-type linked causal maturity, normally read from the Knowledge Graph. */
  causalMaturityByDecisionType: Record<string, CausalMaturity | null>;
  /** Forecast values before this recalc pass. */
  baselineForecast: { completion: number; capacity: number };
}

export interface RecalcOutput {
  updatedConfidence: Record<string, number>; // decisionId -> confidence [0..1]
  forecast: { completion: number; capacity: number };
  timelineOrder: string[]; // decision "type" keys, ordered
  liveToast: boolean;
}

/**
 * A decision's contribution to forecast movement is proportional to its
 * own freshly-calculated confidence, not a flat +1% per acceptance. This
 * keeps forecast increases tied to real signal quality and historical
 * accuracy instead of a raw acceptance count.
 */
function forecastDelta(confidences: number[]): number {
  if (confidences.length === 0) return 0;
  const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  // A fully-confident, fully-accepted plan can move the forecast by up
  // to ~6 points total across all accepted decisions in a single pass.
  return avg * confidences.length * 1.2;
}

function clampPct(value: number): number {
  return Math.min(99, Math.max(0, value));
}

/**
 * Orders accepted decisions by confidence, descending, as a stand-in for
 * reading the Counterfactual Engine's argmax scenario. Ties are broken
 * by original array order (stable sort) — this is what the FLIP-based
 * reorderTimeline() in v6/v7 ultimately needs to animate against.
 */
function orderByConfidence(
  decisions: Decision[],
  confidenceById: Record<string, number>
): string[] {
  return [...decisions]
    .map((d, i) => ({ d, i, c: confidenceById[d.id] ?? 0 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map((entry) => entry.d.type);
}

export function recalc(input: RecalcInput): RecalcOutput {
  const updatedConfidence: Record<string, number> = {};

  for (const decision of input.acceptedDecisions) {
    const accuracy =
      input.accuracyByDecisionType[decision.type] ?? { successes: 0, totalShown: 0 };
    const maturity = input.causalMaturityByDecisionType[decision.type] ?? null;

    updatedConfidence[decision.id] = calculateConfidence({
      signalsSnapshot: input.signalStoreDelta,
      historicalAccuracy: accuracy,
      causalMaturity: maturity,
    });
  }

  const confidenceValues = Object.values(updatedConfidence);
  const delta = forecastDelta(confidenceValues);

  const forecast = {
    completion: clampPct(input.baselineForecast.completion + delta),
    capacity: clampPct(input.baselineForecast.capacity + delta * 0.8),
  };

  const timelineOrder = orderByConfidence(input.acceptedDecisions, updatedConfidence);

  return {
    updatedConfidence,
    forecast,
    timelineOrder,
    liveToast: input.acceptedDecisions.length > 0,
  };
}
