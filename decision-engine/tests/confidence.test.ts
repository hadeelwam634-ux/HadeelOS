import { describe, it, expect } from "vitest";
import {
  calculateConfidence,
  averageSignalReliability,
  historicalAccuracy,
  causalMaturityScore,
  qualifierFor,
} from "../src/confidence";
import { SignalStore } from "../src/types";

const mockSignalStore: SignalStore = {
  sleep_duration: {
    signalType: "sleep_duration",
    latestValue: 7.5,
    latestTimestamp: "2026-07-10T06:00:00Z",
    reliabilityScore: 0.9,
    syncConsistencyDays: 30,
  },
  mood_score: {
    signalType: "mood_score",
    latestValue: 8,
    latestTimestamp: "2026-07-10T07:00:00Z",
    reliabilityScore: 0.7,
    syncConsistencyDays: 12,
  },
};

describe("averageSignalReliability", () => {
  it("averages reliability across all signals in the store", () => {
    expect(averageSignalReliability(mockSignalStore)).toBeCloseTo(0.8, 5);
  });

  it("returns 0 for an empty store", () => {
    expect(averageSignalReliability({})).toBe(0);
  });
});

describe("historicalAccuracy", () => {
  it("computes successes / totalShown", () => {
    expect(historicalAccuracy({ successes: 18, totalShown: 20 })).toBeCloseTo(0.9, 5);
  });

  it("returns 0 when nothing has been shown yet (cold start)", () => {
    expect(historicalAccuracy({ successes: 0, totalShown: 0 })).toBe(0);
  });
});

describe("causalMaturityScore", () => {
  it("maps each maturity stage to its documented weight", () => {
    expect(causalMaturityScore("correlated")).toBe(0.25);
    expect(causalMaturityScore("suspected_causal")).toBe(0.5);
    expect(causalMaturityScore("experimentally_supported")).toBe(0.75);
    expect(causalMaturityScore("stable_causal")).toBe(1.0);
  });

  it("returns 0 when there is no linked causal edge yet", () => {
    expect(causalMaturityScore(null)).toBe(0);
  });
});

describe("calculateConfidence", () => {
  it("applies the v1.5 default weights (0.3 / 0.5 / 0.2)", () => {
    const confidence = calculateConfidence({
      signalsSnapshot: mockSignalStore,
      historicalAccuracy: { successes: 18, totalShown: 20 },
      causalMaturity: "suspected_causal",
    });
    // 0.3*0.8 + 0.5*0.9 + 0.2*0.5 = 0.24 + 0.45 + 0.10 = 0.79
    expect(confidence).toBeCloseTo(0.79, 5);
  });

  it("clamps to [0, 1] even with exaggerated custom weights", () => {
    const confidence = calculateConfidence({
      signalsSnapshot: mockSignalStore,
      historicalAccuracy: { successes: 20, totalShown: 20 },
      causalMaturity: "stable_causal",
      weights: { signalReliability: 2, historicalAccuracy: 2, causalMaturity: 2 },
    });
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("approaches 1 for a maxed-out, fully mature decision", () => {
    const confidence = calculateConfidence({
      signalsSnapshot: {
        "custom:perfect_signal": {
          signalType: "custom:perfect_signal",
          latestValue: 1,
          latestTimestamp: "now",
          reliabilityScore: 1,
          syncConsistencyDays: 99,
        },
      },
      historicalAccuracy: { successes: 100, totalShown: 100 },
      causalMaturity: "stable_causal",
    });
    expect(confidence).toBeCloseTo(1, 5);
  });
});

describe("qualifierFor", () => {
  it("matches the UI thresholds from today_cockpit v6/v7", () => {
    expect(qualifierFor(0.96)).toBe("very_high");
    expect(qualifierFor(0.92)).toBe("high");
    expect(qualifierFor(0.8)).toBe("moderate");
    expect(qualifierFor(0.5)).toBe("low");
  });

  it("treats each threshold's lower bound as inclusive", () => {
    expect(qualifierFor(0.95)).toBe("very_high");
    expect(qualifierFor(0.9)).toBe("high");
    expect(qualifierFor(0.75)).toBe("moderate");
  });
});
