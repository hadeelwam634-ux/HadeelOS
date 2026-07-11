import { describe, it, expect } from "vitest";
import { recalc } from "../src/recalc";
import { Decision, DigitalTwinSnapshot, SignalStore } from "../src/types";

function makeTwin(): DigitalTwinSnapshot {
  return {
    id: "twin-1",
    userId: "u1",
    derivedAt: "2026-07-10T06:00:00Z",
    stress: "low",
    energyCurve: [{ hour: 9, expectedEnergy: 0.7, confidence: 0.6 }],
    decisionStyle: "decisive",
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
    confidence: 0.9,
    confidenceQualifier: "high",
    alternatives: [],
    state: "Accepted",
    createdAt: "2026-07-10T06:00:00Z",
    revisedAt: null,
    revisionReason: null,
    supersedesDecisionId: null,
  };
}

const currentSignalStore: SignalStore = {
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
      currentSignalStore,
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast: { completion: 93, capacity: 89 },
    });

    expect(result.forecast).toEqual({ completion: 93, capacity: 89 });
    expect(result.liveToast).toBe(false);
    expect(result.timelineOrder).toEqual([]);
  });

  it("does not zero out confidence when signalStoreDelta is empty (regression: quiet period with a valid current state)", () => {
    // No fresh signals since the last pass (empty delta), but the
    // system's current, known-good state should still be used to
    // compute confidence rather than treating "no delta" as "no signal".
    const decisions = [makeDecision("d1", "quran_timing")];
    const result = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      currentSignalStore,
      signalStoreDelta: {},
      accuracyByDecisionType: {
        quran_timing: { successes: 18, totalShown: 20 },
      },
      causalMaturityByDecisionType: { quran_timing: "experimentally_supported" },
      baselineForecast: { completion: 93, capacity: 89 },
    });

    expect(result.updatedConfidence["d1"]).toBeGreaterThan(0);
    expect(result.forecast.completion).toBeGreaterThan(93);
  });

  it("layers signalStoreDelta on top of currentSignalStore rather than replacing it", () => {
    const decisions = [makeDecision("d1", "quran_timing")];

    const withoutDelta = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      currentSignalStore,
      signalStoreDelta: {},
      accuracyByDecisionType: { quran_timing: { successes: 18, totalShown: 20 } },
      causalMaturityByDecisionType: { quran_timing: "experimentally_supported" },
      baselineForecast: { completion: 93, capacity: 89 },
    });

    const withBetterDelta = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      currentSignalStore,
      signalStoreDelta: {
        sleep_quality: {
          signalType: "sleep_quality",
          latestValue: 9,
          latestTimestamp: "2026-07-10T07:00:00Z",
          reliabilityScore: 1,
          syncConsistencyDays: 21,
        },
      },
      accuracyByDecisionType: { quran_timing: { successes: 18, totalShown: 20 } },
      causalMaturityByDecisionType: { quran_timing: "experimentally_supported" },
      baselineForecast: { completion: 93, capacity: 89 },
    });

    expect(withBetterDelta.updatedConfidence["d1"]).toBeGreaterThan(
      withoutDelta.updatedConfidence["d1"]
    );
  });

  it("moves forecast upward proportionally to confidence, not a flat +1% per item", () => {
    const decisions = [makeDecision("d1", "quran_timing"), makeDecision("d2", "gym_time")];

    const result = recalc({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      currentSignalStore,
      signalStoreDelta: {},
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
      currentSignalStore,
      signalStoreDelta: {},
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
      currentSignalStore,
      signalStoreDelta: {},
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
