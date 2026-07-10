import { describe, it, expect } from "vitest";
import { recalc } from "../src/recalc";
import { Decision, DigitalTwin, SignalStore } from "../src/types";

function makeTwin(): DigitalTwin {
  return {
    userId: "u1",
    currentStress: "low",
    decisionStyle: "decisive",
    energyCurveShape: "morning_peak",
    motivation: "high",
    lastComputedAt: "2026-07-10T06:00:00Z",
    version: 1,
  };
}

function makeDecision(id: string, type: string): Decision {
  return {
    id,
    type,
    proposedAction: type,
    confidence: 0.9,
    confidenceQualifier: "high",
    alternatives: [],
    state: "Accepted",
    createdAt: "2026-07-10T06:00:00Z",
    revisedAt: null,
    revisionReason: null,
  };
}

const signalStore: SignalStore = {
  sleep_quality: {
    signalType: "sleep_quality",
    latestValue: 8,
    latestTimestamp: "2026-07-10T06:00:00Z",
    reliabilityScore: 0.85,
    syncConsistencyDays: 20,
  },
};

describe("recalc", () => {
  it("returns no forecast movement and no toast when nothing is accepted", () => {
    const result = recalc({
      acceptedDecisions: [],
      twin: makeTwin(),
      signalStoreDelta: signalStore,
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast: { completion: 93, capacity: 89 },
    });

    expect(result.forecast).toEqual({ completion: 93, capacity: 89 });
    expect(result.liveToast).toBe(false);
    expect(result.timelineOrder).toEqual([]);
  });

  it("moves forecast upward proportionally to confidence, not a flat +1% per item", () => {
    const decisions = [makeDecision("d1", "quran_timing"), makeDecision("d2", "gym_time")];

    const result = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      signalStoreDelta: signalStore,
      accuracyByDecisionType: {
        quran_timing: { successes: 18, totalShown: 20 },
        gym_time: { successes: 5, totalShown: 20 },
      },
      causalMaturityByDecisionType: {
        quran_timing: "experimentally_supported",
        gym_time: "correlated",
      },
      baselineForecast: { completion: 93, capacity: 89 },
    });

    // quran_timing has much higher accuracy + maturity than gym_time,
    // so its confidence should dominate the ordering.
    expect(result.timelineOrder[0]).toBe("quran_timing");
    expect(result.forecast.completion).toBeGreaterThan(93);
    expect(result.forecast.capacity).toBeGreaterThan(89);
  });

  it("never lets forecast values exceed the 99% ceiling", () => {
    const decisions = [makeDecision("d1", "quran_timing")];
    const result = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      signalStoreDelta: signalStore,
      accuracyByDecisionType: { quran_timing: { successes: 50, totalShown: 50 } },
      causalMaturityByDecisionType: { quran_timing: "stable_causal" },
      baselineForecast: { completion: 98.9, capacity: 98.9 },
    });

    expect(result.forecast.completion).toBeLessThanOrEqual(99);
    expect(result.forecast.capacity).toBeLessThanOrEqual(99);
  });

  it("orders decisions by descending confidence with a stable tie-break", () => {
    const decisions = [
      makeDecision("d1", "a_type"),
      makeDecision("d2", "b_type"),
      makeDecision("d3", "c_type"),
    ];
    const result = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      signalStoreDelta: signalStore,
      accuracyByDecisionType: {
        a_type: { successes: 5, totalShown: 10 },
        b_type: { successes: 5, totalShown: 10 },
        c_type: { successes: 9, totalShown: 10 },
      },
      causalMaturityByDecisionType: {
        a_type: "correlated",
        b_type: "correlated",
        c_type: "stable_causal",
      },
      baselineForecast: { completion: 90, capacity: 85 },
    });

    expect(result.timelineOrder[0]).toBe("c_type");
    // a_type and b_type tie -> stable sort preserves original array order
    expect(result.timelineOrder.slice(1)).toEqual(["a_type", "b_type"]);
  });
});
