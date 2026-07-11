import { describe, it, expect } from "vitest";
import { buildScenarios } from "../../src/counterfactual/Scenario";
import {
  ScenarioEvaluationContext,
  evaluateScenario,
  KnowledgeGraphSnapshot,
} from "../../src/counterfactual/ScenarioEvaluator";
import { Decision, DigitalTwinSnapshot, SignalStore } from "../../src/types";

function makeTwin(stress: DigitalTwinSnapshot["stress"] = "low"): DigitalTwinSnapshot {
  return {
    id: "twin-1",
    userId: "u1",
    derivedAt: "2026-07-11T06:00:00Z",
    stress,
    energyCurve: [],
    decisionStyle: null,
    behaviorPatterns: [],
    knownPreferences: [],
    activeConstraints: [],
    sourceVersions: { signalsUpdatedAt: null, eventLogCursor: null, graphVersion: null },
  };
}

function makeDecision(id: string, type: string): Decision {
  return {
    id,
    type,
    proposedAction: type,
    confidence: 0,
    confidenceQualifier: "low",
    alternatives: [],
    state: "Proposed",
    createdAt: "2026-07-11T06:00:00Z",
    revisedAt: null,
    revisionReason: null,
    supersedesDecisionId: null,
  };
}

const signals: SignalStore = {
  sleep_quality: {
    signalType: "sleep_quality",
    latestValue: 8,
    latestTimestamp: "t",
    reliabilityScore: 0.9,
    syncConsistencyDays: 30,
  },
};

function baseContext(overrides: Partial<ScenarioEvaluationContext> = {}): ScenarioEvaluationContext {
  const emptyGraph: KnowledgeGraphSnapshot = { edgesByDecisionType: {} };
  return {
    twin: makeTwin(),
    signals,
    graph: emptyGraph,
    historicalAccuracy: {},
    baselineForecast: { completion: 90, capacity: 85 },
    ...overrides,
  };
}

describe("evaluateScenario", () => {
  it("returns a decisionIds array containing exactly the scenario's one decision", () => {
    const [scenario] = buildScenarios([makeDecision("d1", "gym_time")]);
    const result = evaluateScenario(scenario, baseContext());
    expect(result.decisionIds).toEqual(["d1"]);
    expect(result.id).toBe("d1");
  });

  it("gives higher score to a decision type with strong historical accuracy", () => {
    const [strong] = buildScenarios([makeDecision("d1", "strong_type")]);
    const [weak] = buildScenarios([makeDecision("d2", "weak_type")]);
    const context = baseContext({
      historicalAccuracy: {
        strong_type: { successes: 20, totalShown: 20 },
        weak_type: { successes: 1, totalShown: 20 },
      },
    });
    const strongResult = evaluateScenario(strong, context);
    const weakResult = evaluateScenario(weak, context);
    expect(strongResult.score).toBeGreaterThan(weakResult.score);
  });

  it("increases stressEstimate for a higher-stress twin", () => {
    const [scenario] = buildScenarios([makeDecision("d1", "gym_time")]);
    const lowStress = evaluateScenario(scenario, baseContext({ twin: makeTwin("low") }));
    const highStress = evaluateScenario(scenario, baseContext({ twin: makeTwin("high") }));
    expect(highStress.stressEstimate).toBeGreaterThan(lowStress.stressEstimate);
  });

  it("treats a decision type with no linked graph edges as causal_maturity contribution 0, not an error", () => {
    const [scenario] = buildScenarios([makeDecision("d1", "unlinked_type")]);
    const result = evaluateScenario(scenario, baseContext());
    const maturityContributor = result.contributors.find((c) => c.source === "causal_maturity")!;
    expect(maturityContributor.confidence).toBe(0);
  });

  it("never mutates the scenario or context it receives", () => {
    const [scenario] = buildScenarios([makeDecision("d1", "gym_time")]);
    const context = baseContext();
    const scenarioCopy = JSON.parse(JSON.stringify(scenario));
    const contextCopy = JSON.parse(JSON.stringify(context));
    evaluateScenario(scenario, context);
    expect(scenario).toEqual(scenarioCopy);
    expect(context).toEqual(contextCopy);
  });
});
