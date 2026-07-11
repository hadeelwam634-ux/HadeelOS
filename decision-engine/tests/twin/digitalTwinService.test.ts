import { describe, it, expect } from "vitest";
import { DigitalTwinService, DeriveTwinInput } from "../../src/twin/DigitalTwinService";
import { InMemoryDigitalTwinRepository } from "../../src/twin/InMemoryDigitalTwinRepository";
import { MemoryRecord, SignalStore } from "../../src/types";
import { Clock, IdGenerator } from "../../src/application/types";
import { UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `twin-${this.counter}`;
  }
}

class FakeClock implements Clock {
  now(): string {
    return "2026-07-11T06:00:00Z";
  }
}

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

const RAW_SIGNAL_MARKER = "RAW_SIGNAL_MARKER_9182";

function makeInput(overrides: Partial<DeriveTwinInput> = {}): DeriveTwinInput {
  const signalStore: SignalStore = {
    mood_score: {
      signalType: "mood_score",
      latestValue: 0.4,
      latestTimestamp: RAW_SIGNAL_MARKER,
      reliabilityScore: 0.9,
      syncConsistencyDays: 7,
    },
    sleep_quality: {
      signalType: "sleep_quality",
      latestValue: 0.5,
      latestTimestamp: "t",
      reliabilityScore: 0.9,
      syncConsistencyDays: 7,
    },
    sleep_duration: {
      signalType: "sleep_duration",
      latestValue: 6.5,
      latestTimestamp: "t",
      reliabilityScore: 0.7,
      syncConsistencyDays: 7,
    },
  };
  return {
    userId: "u1",
    signalStore,
    memories: [
      makeMemory({ id: "m1", key: "decision_style", value: "reflective" }),
      makeMemory({ id: "m2", key: "pattern:late_night_snacking", value: "late_night_snacking" }),
      makeMemory({ id: "m3", key: "preference:gym_time", value: "morning" }),
      makeMemory({ id: "m4", key: "constraint:no_evening_calls", value: "no_evening_calls" }),
    ],
    sourceVersions: { signalsUpdatedAt: "2026-07-11T05:00:00Z", eventLogCursor: "cursor-1", graphVersion: "v3" },
    ...overrides,
  };
}

function makeService() {
  const repository = new InMemoryDigitalTwinRepository();
  const service = new DigitalTwinService(repository, new FakeIdGenerator(), new FakeClock());
  return { repository, service };
}

describe("DigitalTwinService.deriveAndPersist", () => {
  it("derives every field from the given inputs and persists it", async () => {
    const { service } = makeService();
    const snapshot = await service.deriveAndPersist(makeInput());

    expect(snapshot.userId).toBe("u1");
    expect(snapshot.derivedAt).toBe("2026-07-11T06:00:00Z");
    expect(snapshot.decisionStyle).toBe("reflective");
    expect(snapshot.behaviorPatterns).toEqual(["late_night_snacking"]);
    expect(snapshot.knownPreferences).toEqual(["morning"]);
    expect(snapshot.activeConstraints).toEqual(["no_evening_calls"]);
    expect(["low", "medium", "high", "unknown"]).toContain(snapshot.stress);
  });

  it("is deterministic: identical inputs (via a fresh service/repository) produce identical derived fields", async () => {
    const { service: serviceA } = makeService();
    const { service: serviceB } = makeService();
    const input = makeInput();

    const snapshotA = await serviceA.deriveAndPersist(input);
    const snapshotB = await serviceB.deriveAndPersist(input);

    // ids are assigned per-service instance, so compare everything else.
    const { id: _idA, ...restA } = snapshotA;
    const { id: _idB, ...restB } = snapshotB;
    expect(restA).toEqual(restB);
  });

  it("excludes a blocked memory from every derived field, even when it's Knows", async () => {
    const { service } = makeService();
    const input = makeInput({
      memories: [makeMemory({ id: "m1", key: "decision_style", value: "reflective", blocked: true })],
    });
    const snapshot = await service.deriveAndPersist(input);
    expect(snapshot.decisionStyle).toBeNull();
    expect(snapshot.behaviorPatterns).toEqual([]);
  });

  it("never leaks a raw signal value verbatim into the persisted snapshot", async () => {
    const { service } = makeService();
    const snapshot = await service.deriveAndPersist(makeInput());
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(RAW_SIGNAL_MARKER);
  });

  it("does not mutate the input it's given", async () => {
    const { service } = makeService();
    const input = makeInput();
    const before = JSON.stringify(input);
    await service.deriveAndPersist(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("getLatest and getHistory reflect what was persisted", async () => {
    const { service } = makeService();
    await service.deriveAndPersist(makeInput());
    await service.deriveAndPersist(makeInput());

    const latest = await service.getLatest("u1");
    expect(latest?.id).toBe("twin-2");
    const history = await service.getHistory("u1");
    expect(history.map((s) => s.id)).toEqual(["twin-1", "twin-2"]);
  });

  it("cloning: mutating a returned snapshot does not affect stored state", async () => {
    const { service } = makeService();
    const snapshot = await service.deriveAndPersist(makeInput());
    snapshot.stress = "high";
    snapshot.behaviorPatterns.push("tampered");

    const stored = await service.getLatest("u1");
    expect(stored?.stress).not.toBe("high");
    expect(stored?.behaviorPatterns).not.toContain("tampered");
  });
});
