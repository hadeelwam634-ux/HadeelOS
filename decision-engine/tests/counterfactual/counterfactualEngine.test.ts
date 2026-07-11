import { describe, it, expect } from "vitest";
import { runCounterfactualEngine, CounterfactualInput } from "../../src/counterfactual/CounterfactualEngine";
import { KnowledgeGraphSnapshot } from "../../src/counterfactual/ScenarioEvaluator";
import { Decision, DigitalTwinSnapshot, SignalStore } from "../../src/types";

function makeTwin(overrides: Partial<DigitalTwinSnapshot> = {}): DigitalTwinSnapshot {
  return {
    id: "twin-1",
    userId: "u1",
    derivedAt: "2026-07-11T06:00:00Z",
    stress: "low",
    energyCurve: [],
    decisionStyle: "decisive",
    behaviorPatterns: [],
    knownPreferences: [],
    activeConstraints: [],
    sourceVersions: { signalsUpdatedAt: null, eventLogCursor: null, graphVersion: null },
    ...overrides,
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

const richSignals: SignalStore = {
  sleep_quality: {
    signalType: "sleep_quality",
    latestValue: 8,
    latestTimestamp: "2026-07-11T06:00:00Z",
    reliabilityScore: 0.9,
    syncConsistencyDays: 30,
  },
  mood_score: {
    signalType: "mood_score",
    latestValue: 7,
    latestTimestamp: "2026-07-11T06:00:00Z",
    reliabilityScore: 0.8,
    syncConsistencyDays: 20,
  },
};

const emptyGraph: KnowledgeGraphSnapshot = { edgesByDecisionType: {} };

function baseInput(overrides: Partial<CounterfactualInput> = {}): CounterfactualInput {
  return {
    twin: makeTwin(),
    signals: richSignals,
    candidateDecisions: [makeDecision("d1", "quran_timing"), makeDecision("d2", "gym_time")],
    graph: emptyGraph,
    historicalAccuracy: {
      quran_timing: { successes: 18, totalShown: 20 },
      gym_time: { successes: 5, totalShown: 20 },
    },
    baselineForecast: { completion: 90, capacity: 85 },
    ...overrides,
  };
}

describe("runCounterfactualEngine — determinism", () => {
  it("produces identical output for identical input", () => {
    const input = baseInput();
    const first = runCounterfactualEngine(input);
    const second = runCounterfactualEngine(input);
    expect(second).toEqual(first);
  });
});

describe("runCounterfactualEngine — no mutation", () => {
  it("never mutates candidateDecisions, signals, or graph", () => {
    const input = baseInput();
    const snapshotBefore = JSON.parse(JSON.stringify(input));
    runCounterfactualEngine(input);
    expect(input).toEqual(snapshotBefore);
  });
});

describe("runCounterfactualEngine — empty candidates", () => {
  it("returns a clear result instead of throwing", () => {
    const result = runCounterfactualEngine(baseInput({ candidateDecisions: [] }));
    expect(result.selectedScenario).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.uncertainty).toEqual({ isUncertain: true, reason: "no_candidates" });
  });
});

describe("runCounterfactualEngine — missing data", () => {
  it("refuses to select a confident winner when signals are empty", () => {
    const result = runCounterfactualEngine(baseInput({ signals: {} }));
    expect(result.selectedScenario).toBeNull();
    expect(result.uncertainty.isUncertain).toBe(true);
    expect(result.uncertainty.reason).toBe("missing_signals");
    // Alternatives are still populated so the caller can show something.
    expect(result.alternatives.length).toBe(2);
  });
});

describe("runCounterfactualEngine — low-confidence graph", () => {
  it("does not let a low-confidence relation dominate the winning scenario's score the way a high-confidence one would", () => {
    const graphLowConfidence: KnowledgeGraphSnapshot = {
      edgesByDecisionType: {
        quran_timing: [{ decisionType: "quran_timing", causalMaturity: "stable_causal", confidence: 0.05 }],
      },
    };
    const graphHighConfidence: KnowledgeGraphSnapshot = {
      edgesByDecisionType: {
        quran_timing: [{ decisionType: "quran_timing", causalMaturity: "stable_causal", confidence: 0.95 }],
      },
    };

    const low = runCounterfactualEngine(baseInput({ graph: graphLowConfidence }));
    const high = runCounterfactualEngine(baseInput({ graph: graphHighConfidence }));

    const lowScenario = low.alternatives.concat(low.selectedScenario ? [low.selectedScenario] : []).find(
      (s) => s.id === "d1"
    )!;
    const highScenario = high.alternatives
      .concat(high.selectedScenario ? [high.selectedScenario] : [])
      .find((s) => s.id === "d1")!;

    expect(highScenario.score).toBeGreaterThan(lowScenario.score);
  });
});

describe("runCounterfactualEngine — tie and near-tie", () => {
  it("reports uncertainty when the top two scenarios are a near-tie", () => {
    const decisions = [makeDecision("d1", "type_a"), makeDecision("d2", "type_b")];
    const result = runCounterfactualEngine(
      baseInput({
        candidateDecisions: decisions,
        historicalAccuracy: {
          type_a: { successes: 10, totalShown: 20 },
          type_b: { successes: 10, totalShown: 20 },
        },
      })
    );
    // Identical accuracy/maturity inputs for both types -> identical scores -> a tie.
    expect(result.uncertainty.isUncertain).toBe(true);
    expect(result.uncertainty.reason).toBe("near_tie");
    expect(result.selectedScenario).toBeNull();
  });

  it("selects a confident winner when the score gap is wide", () => {
    const result = runCounterfactualEngine(baseInput());
    // quran_timing (18/20 accuracy) should clearly beat gym_time (5/20).
    expect(result.uncertainty.isUncertain).toBe(false);
    expect(result.selectedScenario).not.toBeNull();
    expect(result.selectedScenario!.id).toBe("d1");
  });
});

describe("runCounterfactualEngine — bounded probabilities", () => {
  it("keeps every probability within [0, 1] even at extreme inputs", () => {
    const result = runCounterfactualEngine(
      baseInput({
        historicalAccuracy: { quran_timing: { successes: 50, totalShown: 50 }, gym_time: { successes: 0, totalShown: 50 } },
        baselineForecast: { completion: 99.9, capacity: 99.9 },
      })
    );
    for (const scenario of [result.selectedScenario, ...result.alternatives]) {
      if (!scenario) continue;
      expect(scenario.completionProbability).toBeGreaterThanOrEqual(0);
      expect(scenario.completionProbability).toBeLessThanOrEqual(1);
      expect(scenario.capacityProbability).toBeGreaterThanOrEqual(0);
      expect(scenario.capacityProbability).toBeLessThanOrEqual(1);
      expect(scenario.stressEstimate).toBeGreaterThanOrEqual(0);
      expect(scenario.stressEstimate).toBeLessThanOrEqual(1);
      expect(scenario.score).toBeGreaterThanOrEqual(0);
      expect(scenario.score).toBeLessThanOrEqual(1);
    }
  });
});

describe("runCounterfactualEngine — contributors sum/normalization", () => {
  it("normalizes each scenario's contributors to sum to 1 when any source has signal", () => {
    const result = runCounterfactualEngine(baseInput());
    for (const scenario of [result.selectedScenario, ...result.alternatives]) {
      if (!scenario) continue;
      const sum = scenario.contributors.reduce((acc, c) => acc + c.contribution, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

describe("runCounterfactualEngine — explanation consistency", () => {
  it("derives selectedBecause and rejectedBecause from the scenarios' own contributors", () => {
    const result = runCounterfactualEngine(baseInput());
    expect(result.selectedScenario).not.toBeNull();
    expect(result.explanation.selectedBecause.length).toBeGreaterThan(0);
    for (const alt of result.alternatives) {
      expect(result.explanation.rejectedBecause[alt.id]).toBeDefined();
      expect(result.explanation.rejectedBecause[alt.id].length).toBeGreaterThan(0);
    }
  });

  it("returns empty explanation when uncertain", () => {
    const result = runCounterfactualEngine(baseInput({ candidateDecisions: [] }));
    expect(result.explanation.selectedBecause).toEqual([]);
    expect(result.explanation.rejectedBecause).toEqual({});
  });
});
