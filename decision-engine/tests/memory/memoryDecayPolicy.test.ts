import { describe, it, expect } from "vitest";
import { MemoryRecord } from "../../src/types";
import {
  DECAY_THRESHOLD_DAYS,
  STALE_THRESHOLD_DAYS,
  evaluateDecay,
} from "../../src/memory/MemoryDecayPolicy";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    userId: "u1",
    key: "decision_style",
    state: "Knows",
    value: "reflective",
    confidence: 0.8,
    evidenceCount: 3,
    lastReinforcedAt: "2026-06-01T00:00:00Z",
    blocked: false,
    ...overrides,
  };
}

describe("MemoryDecayPolicy.evaluateDecay", () => {
  it("does not regress a Missing memory regardless of age", () => {
    const memory = makeMemory({ state: "Missing", lastReinforcedAt: "2020-01-01T00:00:00Z" });
    expect(evaluateDecay(memory, "2026-07-11T00:00:00Z")).toEqual({ shouldRegress: false });
  });

  it("does not regress a memory reinforced recently", () => {
    const memory = makeMemory({ lastReinforcedAt: "2026-07-10T00:00:00Z" });
    expect(evaluateDecay(memory, "2026-07-11T00:00:00Z")).toEqual({ shouldRegress: false });
  });

  it("regresses with reason evidence_decay once the decay threshold is crossed", () => {
    const now = "2026-07-11T00:00:00Z";
    const lastReinforcedAt = new Date(
      Date.parse(now) - (DECAY_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    const memory = makeMemory({ lastReinforcedAt });
    expect(evaluateDecay(memory, now)).toEqual({
      shouldRegress: true,
      reason: "evidence_decay",
      forceCollapse: false,
    });
  });

  it("regresses with reason stale_data and forceCollapse once the staleness threshold is crossed", () => {
    const now = "2026-07-11T00:00:00Z";
    const lastReinforcedAt = new Date(
      Date.parse(now) - (STALE_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();
    const memory = makeMemory({ lastReinforcedAt });
    expect(evaluateDecay(memory, now)).toEqual({
      shouldRegress: true,
      reason: "stale_data",
      forceCollapse: true,
    });
  });

  it("is deterministic: the same memory and now always produce the same evaluation", () => {
    const memory = makeMemory({ lastReinforcedAt: "2026-05-01T00:00:00Z" });
    const now = "2026-07-11T00:00:00Z";
    expect(evaluateDecay(memory, now)).toEqual(evaluateDecay(memory, now));
  });
});
