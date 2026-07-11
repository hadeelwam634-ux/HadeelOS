import { describe, it, expect } from "vitest";
import { buildExplanation } from "../../src/counterfactual/ExplainAlternatives";
import { ScenarioResult } from "../../src/counterfactual/ScenarioEvaluator";

function makeScenario(id: string, score: number, contributors: ScenarioResult["contributors"]): ScenarioResult {
  return {
    id,
    decisionIds: [id],
    completionProbability: 0.8,
    capacityProbability: 0.7,
    stressEstimate: 0.3,
    score,
    contributors,
  };
}

describe("buildExplanation", () => {
  it("returns empty explanation when selected is null", () => {
    const alt = makeScenario("a", 0.5, [{ source: "x", contribution: 1, confidence: 0.5 }]);
    const result = buildExplanation(null, [alt]);
    expect(result.selectedBecause).toEqual([]);
    // Even with no selected scenario, alternatives still get a reason keyed by id.
    expect(Object.keys(result.rejectedBecause)).toEqual(["a"]);
  });

  it("derives selectedBecause strings from the selected scenario's own contributors", () => {
    const selected = makeScenario("s", 0.9, [
      { source: "signal_reliability", contribution: 0.6, confidence: 0.9 },
      { source: "historical_accuracy", contribution: 0.4, confidence: 0.8 },
    ]);
    const result = buildExplanation(selected, []);
    expect(result.selectedBecause.some((s) => s.includes("signal_reliability"))).toBe(true);
  });

  it("never mutates the scenarios it is given", () => {
    const selected = makeScenario("s", 0.9, [{ source: "a", contribution: 0.5, confidence: 0.5 }]);
    const alt = makeScenario("alt", 0.5, [{ source: "b", contribution: 0.5, confidence: 0.5 }]);
    const selectedCopy = JSON.parse(JSON.stringify(selected));
    const altCopy = JSON.parse(JSON.stringify(alt));
    buildExplanation(selected, [alt]);
    expect(selected).toEqual(selectedCopy);
    expect(alt).toEqual(altCopy);
  });

  it("gives each alternative a rejection reason keyed by its scenario id", () => {
    const selected = makeScenario("s", 0.9, [{ source: "a", contribution: 1, confidence: 0.9 }]);
    const alt1 = makeScenario("alt1", 0.5, [{ source: "a", contribution: 1, confidence: 0.5 }]);
    const alt2 = makeScenario("alt2", 0.4, [{ source: "a", contribution: 1, confidence: 0.4 }]);
    const result = buildExplanation(selected, [alt1, alt2]);
    expect(result.rejectedBecause["alt1"].length).toBeGreaterThan(0);
    expect(result.rejectedBecause["alt2"].length).toBeGreaterThan(0);
  });
});
