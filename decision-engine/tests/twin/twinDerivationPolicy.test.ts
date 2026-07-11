import { describe, it, expect } from "vitest";
import { MemoryRecord, SignalStore } from "../../src/types";
import {
  deriveActiveConstraints,
  deriveBehaviorPatterns,
  deriveDecisionStyle,
  deriveEnergyCurve,
  deriveKnownPreferences,
  deriveStress,
} from "../../src/twin/TwinDerivationPolicy";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    userId: "u1",
    key: "pattern:late_night_snacking",
    state: "Knows",
    value: "late_night_snacking",
    confidence: 0.8,
    evidenceCount: 3,
    lastReinforcedAt: "2026-07-10T00:00:00Z",
    blocked: false,
    ...overrides,
  };
}

describe("TwinDerivationPolicy.deriveStress", () => {
  it("returns unknown when mood_score is missing", () => {
    const store: SignalStore = { sleep_quality: { signalType: "sleep_quality", latestValue: 0.8, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 } };
    expect(deriveStress(store)).toBe("unknown");
  });

  it("returns unknown when sleep_quality is missing", () => {
    const store: SignalStore = { mood_score: { signalType: "mood_score", latestValue: 0.8, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 } };
    expect(deriveStress(store)).toBe("unknown");
  });

  it("returns low stress when both mood and sleep quality are high", () => {
    const store: SignalStore = {
      mood_score: { signalType: "mood_score", latestValue: 0.9, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
      sleep_quality: { signalType: "sleep_quality", latestValue: 0.9, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
    };
    expect(deriveStress(store)).toBe("low");
  });

  it("returns high stress when both mood and sleep quality are low", () => {
    const store: SignalStore = {
      mood_score: { signalType: "mood_score", latestValue: 0.1, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
      sleep_quality: { signalType: "sleep_quality", latestValue: 0.1, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
    };
    expect(deriveStress(store)).toBe("high");
  });

  it("is deterministic for identical inputs", () => {
    const store: SignalStore = {
      mood_score: { signalType: "mood_score", latestValue: 0.5, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
      sleep_quality: { signalType: "sleep_quality", latestValue: 0.5, latestTimestamp: "t", reliabilityScore: 1, syncConsistencyDays: 7 },
    };
    expect(deriveStress(store)).toBe(deriveStress(store));
  });
});

describe("TwinDerivationPolicy.deriveEnergyCurve", () => {
  it("returns a fixed-shape curve of neutral, zero-confidence points when no sleep signal exists", () => {
    const curve = deriveEnergyCurve({});
    expect(curve.length).toBeGreaterThan(0);
    for (const point of curve) {
      expect(point.expectedEnergy).toBe(0.5);
      expect(point.confidence).toBe(0);
    }
  });

  it("never returns a raw signal value as expectedEnergy/confidence", () => {
    const store: SignalStore = {
      sleep_duration: { signalType: "sleep_duration", latestValue: 7.3, latestTimestamp: "t", reliabilityScore: 0.9, syncConsistencyDays: 7 },
    };
    const curve = deriveEnergyCurve(store);
    for (const point of curve) {
      expect(point.expectedEnergy).not.toBe(7.3);
      expect(point.expectedEnergy).toBeGreaterThanOrEqual(0);
      expect(point.expectedEnergy).toBeLessThanOrEqual(1);
      expect(point.confidence).toBeGreaterThanOrEqual(0);
      expect(point.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for identical inputs", () => {
    const store: SignalStore = {
      sleep_duration: { signalType: "sleep_duration", latestValue: 6, latestTimestamp: "t", reliabilityScore: 0.8, syncConsistencyDays: 7 },
    };
    expect(deriveEnergyCurve(store)).toEqual(deriveEnergyCurve(store));
  });

  it("does not mutate the SignalStore it's given", () => {
    const store: SignalStore = {
      sleep_duration: { signalType: "sleep_duration", latestValue: 6, latestTimestamp: "t", reliabilityScore: 0.8, syncConsistencyDays: 7 },
    };
    const before = JSON.stringify(store);
    deriveEnergyCurve(store);
    expect(JSON.stringify(store)).toBe(before);
  });
});

describe("TwinDerivationPolicy memory-derived fields", () => {
  it("deriveDecisionStyle returns the value of a Known, unblocked decision_style memory", () => {
    const memories = [makeMemory({ key: "decision_style", value: "reflective" })];
    expect(deriveDecisionStyle(memories)).toBe("reflective");
  });

  it("deriveDecisionStyle returns null when the memory is blocked", () => {
    const memories = [makeMemory({ key: "decision_style", value: "reflective", blocked: true })];
    expect(deriveDecisionStyle(memories)).toBeNull();
  });

  it("deriveDecisionStyle returns null when the memory is not yet Knows", () => {
    const memories = [makeMemory({ key: "decision_style", value: "reflective", state: "Learning" })];
    expect(deriveDecisionStyle(memories)).toBeNull();
  });

  it("deriveBehaviorPatterns excludes blocked memories even when Knows", () => {
    const memories = [
      makeMemory({ id: "m1", key: "pattern:a", value: "a", blocked: false }),
      makeMemory({ id: "m2", key: "pattern:b", value: "b", blocked: true }),
    ];
    expect(deriveBehaviorPatterns(memories)).toEqual(["a"]);
  });

  it("deriveKnownPreferences and deriveActiveConstraints only read their own key prefix", () => {
    const memories = [
      makeMemory({ id: "m1", key: "preference:gym_time", value: "morning" }),
      makeMemory({ id: "m2", key: "constraint:no_evening_calls", value: "no_evening_calls" }),
      makeMemory({ id: "m3", key: "pattern:x", value: "x" }),
    ];
    expect(deriveKnownPreferences(memories)).toEqual(["morning"]);
    expect(deriveActiveConstraints(memories)).toEqual(["no_evening_calls"]);
  });

  it("does not mutate the memories array it's given", () => {
    const memories = [makeMemory()];
    const before = JSON.stringify(memories);
    deriveBehaviorPatterns(memories);
    expect(JSON.stringify(memories)).toBe(before);
  });
});
