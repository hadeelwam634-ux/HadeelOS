import { CausalMaturity, DigitalTwinSnapshot, SignalStore, UUID } from "../types";
import {
  DEFAULT_WEIGHTS,
  HistoricalAccuracyInput,
  averageSignalReliability,
  causalMaturityScore,
  historicalAccuracy,
} from "../confidence";
import { maturityRank } from "../knowledge-graph/CausalMaturityPolicy";
import { Scenario } from "./Scenario";

/**
 * A single Knowledge Graph edge's relevance to one decision type,
 * pre-extracted so this engine never depends on the live repository —
 * see KnowledgeGraphSnapshot below.
 */
export interface KnowledgeGraphEdgeSummary {
  decisionType: string;
  causalMaturity: CausalMaturity;
  /** The edge's own confidence (KGEdge.confidence), 0..1. */
  confidence: number;
}

/**
 * A read-only, pre-computed view of the Knowledge Graph the engine
 * needs — never the live repository. Built by the caller (the future
 * TodayDecisionApplicationService, per PR #8) from
 * KnowledgeGraphRepository.findEdgesFrom/To, keeping this engine free
 * of any repository dependency so it stays a pure, deterministic
 * function of plain data.
 */
export interface KnowledgeGraphSnapshot {
  edgesByDecisionType: Record<string, KnowledgeGraphEdgeSummary[]>;
}

export interface ScenarioEvaluationContext {
  twin: DigitalTwinSnapshot;
  signals: SignalStore;
  graph: KnowledgeGraphSnapshot;
  historicalAccuracy: Record<string, HistoricalAccuracyInput>;
  baselineForecast: { completion: number; capacity: number };
}

export interface ScenarioContributor {
  source: string;
  /** This contributor's share of the decision confidence, normalized so all contributors for a scenario sum to 1 (or 0 if every source is empty). */
  contribution: number;
  /** The contributor's own confidence/reliability value, 0..1. */
  confidence: number;
}

export interface ScenarioResult {
  id: UUID;
  decisionIds: UUID[];
  completionProbability: number;
  capacityProbability: number;
  stressEstimate: number;
  score: number;
  contributors: ScenarioContributor[];
}

const STRESS_BASE: Record<DigitalTwinSnapshot["stress"], number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  unknown: 0.5,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Picks the single strongest edge for a decision type: highest causal
 * maturity rank first, then highest edge confidence as a tie-break.
 * Never mutates the input array.
 */
function selectStrongestEdge(
  edges: readonly KnowledgeGraphEdgeSummary[]
): KnowledgeGraphEdgeSummary | null {
  if (edges.length === 0) return null;
  return [...edges].sort((a, b) => {
    const rankDiff = maturityRank(b.causalMaturity) - maturityRank(a.causalMaturity);
    if (rankDiff !== 0) return rankDiff;
    return b.confidence - a.confidence;
  })[0];
}

/**
 * Pure, deterministic evaluation of one Scenario. Never mutates
 * `scenario` or `context`, never reads the clock, never generates an
 * ID. v1 evaluates exactly one decision per scenario (see Scenario.ts).
 */
export function evaluateScenario(
  scenario: Scenario,
  context: ScenarioEvaluationContext
): ScenarioResult {
  const decision = scenario.decisions[0];

  const accuracyInput: HistoricalAccuracyInput = context.historicalAccuracy[decision.type] ?? {
    successes: 0,
    totalShown: 0,
  };
  const edges = context.graph.edgesByDecisionType[decision.type] ?? [];
  const bestEdge = selectStrongestEdge(edges);
  const causalMaturity = bestEdge?.causalMaturity ?? null;
  const edgeConfidence = bestEdge?.confidence ?? 0;

  const signalReliability = averageSignalReliability(context.signals);
  const accuracy = historicalAccuracy(accuracyInput);
  // A relation's maturity only counts as a strong reason if the edge
  // itself is reported with confidence — a low-confidence relation must
  // not act as a strong reason on its own ("Final Execution Orders" PR
  // #7: "لا تستخدم relation منخفضة الثقة كسبب قوي").
  const maturityScore = causalMaturityScore(causalMaturity) * edgeConfidence;

  const rawContributions = {
    signal_reliability: DEFAULT_WEIGHTS.signalReliability * signalReliability,
    historical_accuracy: DEFAULT_WEIGHTS.historicalAccuracy * accuracy,
    causal_maturity: DEFAULT_WEIGHTS.causalMaturity * maturityScore,
  };
  const decisionConfidence = clamp01(
    rawContributions.signal_reliability +
      rawContributions.historical_accuracy +
      rawContributions.causal_maturity
  );

  const totalRaw =
    rawContributions.signal_reliability +
    rawContributions.historical_accuracy +
    rawContributions.causal_maturity;
  const contributors: ScenarioContributor[] = [
    {
      source: "signal_reliability",
      contribution: totalRaw > 0 ? rawContributions.signal_reliability / totalRaw : 0,
      confidence: signalReliability,
    },
    {
      source: "historical_accuracy",
      contribution: totalRaw > 0 ? rawContributions.historical_accuracy / totalRaw : 0,
      confidence: accuracy,
    },
    {
      source: "causal_maturity",
      contribution: totalRaw > 0 ? rawContributions.causal_maturity / totalRaw : 0,
      confidence: edgeConfidence,
    },
  ];

  const baseCompletion = clamp01(context.baselineForecast.completion / 100);
  const baseCapacity = clamp01(context.baselineForecast.capacity / 100);
  // Mirrors recalc()'s forecastDelta shape (a fully-confident scenario
  // moves the forecast by a small, bounded amount) but on the 0..1
  // probability scale ScenarioResult uses instead of recalc()'s 0..99%
  // scale.
  const delta = decisionConfidence * 0.15;
  const completionProbability = clamp01(baseCompletion + delta);
  const capacityProbability = clamp01(baseCapacity + delta * 0.8);

  const stressBase = STRESS_BASE[context.twin.stress];
  // An unevidenced plan is more stressful to execute than a
  // well-evidenced one, so lower decisionConfidence nudges stress up.
  const stressEstimate = clamp01(stressBase + (1 - decisionConfidence) * 0.25);

  const score = clamp01(
    completionProbability * 0.45 + capacityProbability * 0.35 + (1 - stressEstimate) * 0.2
  );

  return {
    id: scenario.id,
    decisionIds: scenario.decisionIds,
    completionProbability,
    capacityProbability,
    stressEstimate,
    score,
    contributors,
  };
}
