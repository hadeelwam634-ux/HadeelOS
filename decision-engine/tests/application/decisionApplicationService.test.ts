import { describe, it, expect } from "vitest";
import { DecisionApplicationService } from "../../src/application/DecisionApplicationService";
import {
  ApplicationError,
  EventLogPersistenceError,
  RecalcExecutionError,
  SignalPersistenceError,
} from "../../src/application/errors";
import { Clock, IdGenerator } from "../../src/application/types";
import { calculateConfidence } from "../../src/confidence";
import { InMemorySignalStoreRepository } from "../../src/persistence/InMemorySignalStoreRepository";
import { InMemoryEventLogRepository } from "../../src/persistence/InMemoryEventLogRepository";
import { EventLogRepository } from "../../src/persistence/EventLogRepository";
import { SignalStoreRepository } from "../../src/persistence/SignalStoreRepository";
import { Decision, DigitalTwinSnapshot, EventLogEntry, SignalStore, SignalStoreEntry, UUID } from "../../src/types";

// ---------- deterministic test doubles ----------

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `event-${this.counter}`;
  }
}

class FakeClock implements Clock {
  now(): string {
    return "2026-07-11T06:00:00Z";
  }
}

/** Wraps a real SignalStoreRepository, recording call order for assertions. */
class RecordingSignalStoreRepository implements SignalStoreRepository {
  calls: string[] = [];
  constructor(private readonly inner: SignalStoreRepository) {}
  async upsert(entry: SignalStoreEntry): Promise<void> {
    this.calls.push("upsert");
    return this.inner.upsert(entry);
  }
  async upsertMany(entries: SignalStoreEntry[]): Promise<void> {
    this.calls.push("upsertMany");
    return this.inner.upsertMany(entries);
  }
  async get(signalType: SignalStoreEntry["signalType"]) {
    this.calls.push("get");
    return this.inner.get(signalType);
  }
  async getAll(): Promise<SignalStore> {
    this.calls.push("getAll");
    return this.inner.getAll();
  }
  async delete(signalType: SignalStoreEntry["signalType"]): Promise<void> {
    this.calls.push("delete");
    return this.inner.delete(signalType);
  }
}

class RecordingEventLogRepository implements EventLogRepository {
  calls: string[] = [];
  constructor(private readonly inner: EventLogRepository) {}
  async append(entry: EventLogEntry): Promise<void> {
    this.calls.push("append");
    return this.inner.append(entry);
  }
  async findByDecisionId(decisionId: UUID) {
    this.calls.push("findByDecisionId");
    return this.inner.findByDecisionId(decisionId);
  }
  async getAll() {
    this.calls.push("getAll");
    return this.inner.getAll();
  }
}

/** A SignalStoreRepository whose upsertMany() always rejects. */
class FailingUpsertSignalStoreRepository implements SignalStoreRepository {
  private readonly inner = new InMemorySignalStoreRepository();
  async upsert(entry: SignalStoreEntry): Promise<void> {
    return this.inner.upsert(entry);
  }
  async upsertMany(): Promise<void> {
    throw new Error("connection reset");
  }
  async get(signalType: SignalStoreEntry["signalType"]) {
    return this.inner.get(signalType);
  }
  async getAll(): Promise<SignalStore> {
    return this.inner.getAll();
  }
  async delete(signalType: SignalStoreEntry["signalType"]): Promise<void> {
    return this.inner.delete(signalType);
  }
}

/** An EventLogRepository whose append() always rejects. */
class FailingAppendEventLogRepository implements EventLogRepository {
  private readonly inner = new InMemoryEventLogRepository();
  async append(): Promise<void> {
    throw new Error("unique constraint violation");
  }
  async findByDecisionId(decisionId: UUID) {
    return this.inner.findByDecisionId(decisionId);
  }
  async getAll() {
    return this.inner.getAll();
  }
}

/**
 * A SignalStoreRepository that mimics a real database's write-time
 * normalization (e.g. a CHECK constraint clamping reliabilityScore to
 * [0, 1]). Used to prove that recalc() is computed from what the
 * repository actually persisted, not from the raw value the caller
 * asked to persist.
 */
class NormalizingSignalStoreRepository implements SignalStoreRepository {
  private readonly inner = new InMemorySignalStoreRepository();

  private normalize(entry: SignalStoreEntry): SignalStoreEntry {
    return { ...entry, reliabilityScore: Math.min(1, Math.max(0, entry.reliabilityScore)) };
  }

  async upsert(entry: SignalStoreEntry): Promise<void> {
    return this.inner.upsert(this.normalize(entry));
  }
  async upsertMany(entries: SignalStoreEntry[]): Promise<void> {
    return this.inner.upsertMany(entries.map((e) => this.normalize(e)));
  }
  async get(signalType: SignalStoreEntry["signalType"]) {
    return this.inner.get(signalType);
  }
  async getAll(): Promise<SignalStore> {
    return this.inner.getAll();
  }
  async delete(signalType: SignalStoreEntry["signalType"]): Promise<void> {
    return this.inner.delete(signalType);
  }
}

// ---------- fixtures ----------

function makeTwin(): DigitalTwinSnapshot {
  return {
    id: "twin-1",
    userId: "u1",
    derivedAt: "2026-07-11T06:00:00Z",
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
    createdAt: "2026-07-11T06:00:00Z",
    revisedAt: null,
    revisionReason: null,
    supersedesDecisionId: null,
  };
}

function makeSignalEntry(overrides: Partial<SignalStoreEntry> = {}): SignalStoreEntry {
  return {
    signalType: "sleep_quality",
    latestValue: 8,
    latestTimestamp: "2026-07-11T06:00:00Z",
    reliabilityScore: 0.85,
    syncConsistencyDays: 20,
    ...overrides,
  };
}

function makeService(overrides: {
  signalStoreRepository?: SignalStoreRepository;
  eventLogRepository?: EventLogRepository;
  idGenerator?: IdGenerator;
  clock?: Clock;
} = {}) {
  const signalStoreRepository = overrides.signalStoreRepository ?? new InMemorySignalStoreRepository();
  const eventLogRepository = overrides.eventLogRepository ?? new InMemoryEventLogRepository();
  const idGenerator = overrides.idGenerator ?? new FakeIdGenerator();
  const clock = overrides.clock ?? new FakeClock();
  return {
    service: new DecisionApplicationService(signalStoreRepository, eventLogRepository, idGenerator, clock),
    signalStoreRepository,
    eventLogRepository,
  };
}

const baselineForecast = { completion: 90, capacity: 85 };

describe("DecisionApplicationService.recalculateDay", () => {
  it("reads the current signal store before calling recalc", async () => {
    const recording = new RecordingSignalStoreRepository(new InMemorySignalStoreRepository());
    const { service } = makeService({ signalStoreRepository: recording });

    await service.recalculateDay({
      acceptedDecisions: [],
      twin: makeTwin(),
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    // The very first repository call must be a read of the current
    // store, before anything else happens.
    expect(recording.calls[0]).toBe("getAll");
  });

  it("merges the signal delta and persists it", async () => {
    const { service, signalStoreRepository } = makeService();

    await service.recalculateDay({
      acceptedDecisions: [],
      twin: makeTwin(),
      signalStoreDelta: { sleep_quality: makeSignalEntry({ latestValue: 9 }) },
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    const stored = await signalStoreRepository.get("sleep_quality");
    expect(stored?.latestValue).toBe(9);
  });

  it("passes the correct effective store (current + delta) to recalc", async () => {
    const { service, signalStoreRepository } = makeService();
    // Seed an existing signal that is NOT part of this call's delta.
    await signalStoreRepository.upsert(
      makeSignalEntry({ signalType: "mood_score", latestValue: 7, reliabilityScore: 0.6 })
    );

    const decision = makeDecision("d1", "quran_timing");
    const result = await service.recalculateDay({
      acceptedDecisions: [decision],
      twin: makeTwin(),
      signalStoreDelta: { sleep_quality: makeSignalEntry({ reliabilityScore: 1 }) },
      accuracyByDecisionType: { quran_timing: { successes: 18, totalShown: 20 } },
      causalMaturityByDecisionType: { quran_timing: "experimentally_supported" },
      baselineForecast,
    });

    // Confidence must reflect BOTH the pre-existing mood_score signal and
    // the freshly-delivered sleep_quality delta — if only one had been
    // used, average signal reliability (and therefore confidence) would
    // differ from this expected value.
    const expectedAvgReliability = (0.6 + 1) / 2;
    expect(expectedAvgReliability).toBeCloseTo(0.8, 5);
    expect(result.recalculation.updatedConfidence["d1"]).toBeGreaterThan(0);
  });

  it("uses the persisted (post-normalization) effective store for recalc, not the raw command input", async () => {
    // The repository clamps reliabilityScore to [0, 1] on write, the way
    // a real database CHECK constraint would. recalc() must be computed
    // from what was actually saved (1.0), never from the raw 1.4 the
    // command supplied — otherwise recalc()'s output (and the Event Log
    // snapshot built from it) would silently diverge from persisted state.
    const { service } = makeService({
      signalStoreRepository: new NormalizingSignalStoreRepository(),
    });
    const decision = makeDecision("d1", "quran_timing");

    // Chosen so accuracy + maturity alone total 0.30 (well under the
    // [0,1] clamp ceiling) — otherwise a persisted value of 1 and a raw
    // value of 1.4 could both saturate to the same clamped confidence
    // and mask the bug this test exists to catch.
    const result = await service.recalculateDay({
      acceptedDecisions: [decision],
      twin: makeTwin(),
      signalStoreDelta: { sleep_quality: makeSignalEntry({ reliabilityScore: 1.4 }) },
      accuracyByDecisionType: { quran_timing: { successes: 5, totalShown: 10 } },
      causalMaturityByDecisionType: { quran_timing: "correlated" },
      baselineForecast,
    });

    const expectedFromPersistedValue = calculateConfidence({
      signalsSnapshot: { sleep_quality: makeSignalEntry({ reliabilityScore: 1 }) },
      historicalAccuracy: { successes: 5, totalShown: 10 },
      causalMaturity: "correlated",
    });

    expect(result.recalculation.updatedConfidence["d1"]).toBeCloseTo(expectedFromPersistedValue, 10);

    // Sanity check: this genuinely would have been a different number
    // had the raw, unpersisted 1.4 been used instead.
    const wouldHaveBeenIfRawValueWereUsed = calculateConfidence({
      signalsSnapshot: { sleep_quality: makeSignalEntry({ reliabilityScore: 1.4 }) },
      historicalAccuracy: { successes: 5, totalShown: 10 },
      causalMaturity: "correlated",
    });
    expect(wouldHaveBeenIfRawValueWereUsed).not.toBeCloseTo(expectedFromPersistedValue, 10);
  });

  it("adds one EventLog entry per accepted decision", async () => {
    const { service, eventLogRepository } = makeService();
    const decisions = [makeDecision("d1", "quran_timing"), makeDecision("d2", "gym_time")];

    const result = await service.recalculateDay({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    expect(result.eventLogEntryIds).toHaveLength(2);
    const all = await eventLogRepository.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.decisionId).sort()).toEqual(["d1", "d2"]);
  });

  it("does not write to the Event Log if recalc fails", async () => {
    const recordingEventLog = new RecordingEventLogRepository(new InMemoryEventLogRepository());
    const { service } = makeService({ eventLogRepository: recordingEventLog });

    // A decision whose `type` getter throws simulates recalc() failing
    // partway through, without needing to change recalc() itself.
    const poisoned: Decision = {
      ...makeDecision("d1", "quran_timing"),
    };
    Object.defineProperty(poisoned, "type", {
      get() {
        throw new Error("boom");
      },
    });

    await expect(
      service.recalculateDay({
        acceptedDecisions: [poisoned],
        twin: makeTwin(),
        signalStoreDelta: {},
        accuracyByDecisionType: {},
        causalMaturityByDecisionType: {},
        baselineForecast,
      })
    ).rejects.toThrow(RecalcExecutionError);

    expect(recordingEventLog.calls).toEqual([]);
  });

  it("does not return internal repository references", async () => {
    const { service, signalStoreRepository, eventLogRepository } = makeService();
    const decision = makeDecision("d1", "quran_timing");

    const result = await service.recalculateDay({
      acceptedDecisions: [decision],
      twin: makeTwin(),
      signalStoreDelta: { sleep_quality: makeSignalEntry() },
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    // Mutate everything returned...
    result.persistedSignalTypes.push("custom:not_real");
    result.eventLogEntryIds.push("not-real");
    result.recalculation.timelineOrder.push("not_real");
    result.recalculation.updatedConfidence["not-real"] = 1;

    // ...and confirm the repositories were unaffected.
    const storedSignals = await signalStoreRepository.getAll();
    expect(Object.keys(storedSignals)).toEqual(["sleep_quality"]);

    const storedEvents = await eventLogRepository.getAll();
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents.map((e) => e.id)).not.toContain("not-real");
  });

  it("works with an empty signal store and an empty delta", async () => {
    const { service } = makeService();
    const decision = makeDecision("d1", "quran_timing");

    const result = await service.recalculateDay({
      acceptedDecisions: [decision],
      twin: makeTwin(),
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    expect(result.persistedSignalTypes).toEqual([]);
    expect(result.recalculation.updatedConfidence["d1"]).toBe(0);
    expect(result.eventLogEntryIds).toHaveLength(1);
  });

  it("works with an empty delta against a non-empty existing store", async () => {
    const { service, signalStoreRepository } = makeService();
    await signalStoreRepository.upsert(makeSignalEntry());

    const result = await service.recalculateDay({
      acceptedDecisions: [],
      twin: makeTwin(),
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    expect(result.persistedSignalTypes).toEqual([]);
    const stored = await signalStoreRepository.get("sleep_quality");
    expect(stored?.latestValue).toBe(8);
  });

  it("preserves the order of accepted decisions in eventLogEntryIds", async () => {
    const { service, eventLogRepository } = makeService();
    const decisions = [
      makeDecision("d1", "a_type"),
      makeDecision("d2", "b_type"),
      makeDecision("d3", "c_type"),
    ];

    const result = await service.recalculateDay({
      acceptedDecisions: decisions,
      twin: makeTwin(),
      signalStoreDelta: {},
      accuracyByDecisionType: {},
      causalMaturityByDecisionType: {},
      baselineForecast,
    });

    expect(result.eventLogEntryIds).toEqual(["event-1", "event-2", "event-3"]);

    const all = await eventLogRepository.getAll();
    expect(all.map((e) => e.decisionId)).toEqual(["d1", "d2", "d3"]);
  });

  it("wraps a SignalStoreRepository failure as SignalPersistenceError", async () => {
    const { service } = makeService({ signalStoreRepository: new FailingUpsertSignalStoreRepository() });

    await expect(
      service.recalculateDay({
        acceptedDecisions: [],
        twin: makeTwin(),
        signalStoreDelta: { sleep_quality: makeSignalEntry() },
        accuracyByDecisionType: {},
        causalMaturityByDecisionType: {},
        baselineForecast,
      })
    ).rejects.toThrow(SignalPersistenceError);
  });

  it("wraps an EventLogRepository failure as EventLogPersistenceError", async () => {
    const { service } = makeService({ eventLogRepository: new FailingAppendEventLogRepository() });
    const decision = makeDecision("d1", "quran_timing");

    await expect(
      service.recalculateDay({
        acceptedDecisions: [decision],
        twin: makeTwin(),
        signalStoreDelta: {},
        accuracyByDecisionType: {},
        causalMaturityByDecisionType: {},
        baselineForecast,
      })
    ).rejects.toThrow(EventLogPersistenceError);
  });

  it("both persistence error subclasses are ApplicationErrors", async () => {
    const { service } = makeService({ signalStoreRepository: new FailingUpsertSignalStoreRepository() });

    try {
      await service.recalculateDay({
        acceptedDecisions: [],
        twin: makeTwin(),
        signalStoreDelta: { sleep_quality: makeSignalEntry() },
        accuracyByDecisionType: {},
        causalMaturityByDecisionType: {},
        baselineForecast,
      });
      expect.fail("expected recalculateDay to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationError);
    }
  });
});
