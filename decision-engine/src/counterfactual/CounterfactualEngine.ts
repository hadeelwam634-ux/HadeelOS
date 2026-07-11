import { Decision, DigitalTwinSnapshot, SignalStore } from "../types";
import { HistoricalAccuracyInput } from "../confidence";
import { buildScenarios } from "./Scenario";
import {
  KnowledgeGraphSnapshot,
  ScenarioEvaluationContext,
  ScenarioResult,
  evaluateScenario,
} from "./ScenarioEvaluator";
import { UncertaintyOutcome, evaluateScoreUncertainty } from "./UncertaintyPolicy";
import { buildExplanation } from "./ExplainAlternatives";

export interface CounterfactualInput {
  twin: DigitalTwinSnapshot;
  signals: SignalStore;
  candidateDecisions: Decision[];
  graph: KnowledgeGraphSnapshot;
  historicalAccuracy: Record<string, HistoricalAccuracyInput>;
  baselineForecast: { completion: number; capacity: number };
}

export interface CounterfactualResult {
  selectedScenario: ScenarioResult | null;
  alternatives: ScenarioResult[];
  explanation: {
    selectedBecause: string[];
    rejectedBecause: Record<string, string[]>;
  };
  uncertainty: UncertaintyOutcome;
}

/**
 * Pure, deterministic comparison of candidate decisions ("Final
 * Execution Orders" PR #7). Never mutates any input, never reads the
 * clock, never generates an ID, and never calls a repository — every
 * dependency arrives as plain data (CounterfactualInput), so the same
 * input always produces the same output.
 */
export function runCounterfactualEngine(input: CounterfactualInput): CounterfactualResult {
  // "لا قرار عند missing critical inputs" / "empty candidates تعيد نتيجة
  // واضحة، لا exception غامضة" — an empty candidate list is a clear,
  // well-formed result, never an exception.
  if (input.candidateDecisions.length === 0) {
    return {
      selectedScenario: null,
      alternatives: [],
      explanation: { selectedBecause: [], rejectedBecause: {} },
      uncertainty: { isUncertain: true, reason: "no_candidates" },
    };
  }

  const evaluationContext: ScenarioEvaluationContext = {
    twin: input.twin,
    signals: input.signals,
    graph: input.graph,
    historicalAccuracy: input.historicalAccuracy,
    baselineForecast: input.baselineForecast,
  };

  const ranked = buildScenarios(input.candidateDecisions)
    .map((scenario, i) => ({ result: evaluateScenario(scenario, evaluationContext), i }))
    .sort((a, b) => b.result.score - a.result.score || a.i - b.i)
    .map((entry) => entry.result);

  // No signals at all is a "missing critical inputs" state: still
  // compute scenarios (so alternatives/explanation are populated) but
  // refuse to select a confident winner.
  const hasSignals = Object.keys(input.signals).length > 0;
  const uncertainty: UncertaintyOutcome = hasSignals
    ? evaluateScoreUncertainty(ranked.map((s) => s.score))
    : { isUncertain: true, reason: "missing_signals" };

  if (uncertainty.isUncertain) {
    return {
      selectedScenario: null,
      alternatives: ranked,
      explanation: buildExplanation(null, ranked),
      uncertainty,
    };
  }

  const [selected, ...alternatives] = ranked;
  return {
    selectedScenario: selected,
    alternatives,
    explanation: buildExplanation(selected, alternatives),
    uncertainty,
  };
}
