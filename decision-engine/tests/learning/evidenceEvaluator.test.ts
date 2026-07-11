import { describe, it, expect } from "vitest";
import { evaluateExperimentEvidence } from "../../src/learning/EvidenceEvaluator";

describe("evaluateExperimentEvidence", () => {
  it("returns rejected when no effect was observed at all", () => {
    expect(evaluateExperimentEvidence({ effectObserved: false, metricMet: false })).toBe("rejected");
    // even if metricMet were somehow true, no observed effect always means rejected
    expect(evaluateExperimentEvidence({ effectObserved: false, metricMet: true })).toBe("rejected");
  });

  it("returns confirmed when an effect was observed and the success metric was met", () => {
    expect(evaluateExperimentEvidence({ effectObserved: true, metricMet: true })).toBe("confirmed");
  });

  it("returns inconclusive when an effect was observed but the success metric was not met", () => {
    expect(evaluateExperimentEvidence({ effectObserved: true, metricMet: false })).toBe("inconclusive");
  });

  it("is deterministic — same input always produces the same outcome", () => {
    const input = { effectObserved: true, metricMet: true };
    expect(evaluateExperimentEvidence(input)).toBe(evaluateExperimentEvidence({ ...input }));
  });
});
