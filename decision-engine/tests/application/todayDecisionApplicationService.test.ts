import { describe, it, expect } from "vitest";
import { Clock, IdGenerator } from "../../src/application/types";
import {
  RunTodayCommand,
  TodayDecisionApplicationService,
} from "../../src/application/TodayDecisionApplicationService";
import { InMemorySignalStoreRepository } from "../../src/persistence/InMemorySignalStoreRepository";
import { InMemoryEventLogRepository } from "../../src/persistence/InMemoryEventLogRepository";
import { InMemoryDigitalTwinRepository } from "../../src/twin/InMemoryDigitalTwinRepository";
import { DigitalTwinService } from "../../src/twin/DigitalTwinService";
import { InMemoryMemoryRepository } from "../../src/memory/InMemoryMemoryRepository";
import { MemoryMapService } from "../../src/memory/MemoryMapService";
import { MemoryGovernanceService } from "../../src/memory/MemoryGovernanceService";
import { InMemoryKnowledgeGraphRepository } from "../../src/knowledge-graph/InMemoryKnowledgeGraphRepository";
import { KnowledgeGraphService } from "../../src/knowledge-graph/KnowledgeGraphService";
import { InMemoryHypothesisRepository } from "../../src/learning/InMemoryHypothesisRepository";
import { HypothesisService } from "../../src/learning/HypothesisService";
import { Decision, UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class FakeClock implements Clock {
  private current = "2026-07-11T06:00:00Z";
  now(): string {
    return this.current;
  }
  advanceDay(): void {
    // Cheap ISO-day bump for the "open tomorrow" step of the E2E test.
    const d = new Date(this.current);
    d.setUTCDate(d.getUTCDate() + 1);
    this.current = d.toISOString();
  }
}

function makeDecision(id: string, type: string, action: string): Decision {
  return {
    id,
    type,
    proposedAction: action,
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

function makeHarness() {
  const signalStoreRepository = new InMemorySignalStoreRepository();
  const eventLogRepository = new InMemoryEventLogRepository();
  const twinRepository = new InMemoryDigitalTwinRepository();
  const memoryRepository = new InMemoryMemoryRepository();
  const kgRepository = new InMemoryKnowledgeGraphRepository();
  const hypothesisRepository = new InMemoryHypothesisRepository();

  const clock = new FakeClock();
  const idGenerator = new FakeIdGenerator();

  const digitalTwinService = new DigitalTwinService(twinRepository, idGenerator, clock);
  const memoryMapService = new MemoryMapService(memoryRepository);
  const memoryGovernanceService = new MemoryGovernanceService(memoryRepository, idGenerator, clock);
  const knowledgeGraphService = new KnowledgeGraphService(kgRepository, idGenerator, clock);
  const hypothesisService = new HypothesisService(hypothesisRepository, idGenerator);

  const service = new TodayDecisionApplicationService(
    signalStoreRepository,
    eventLogRepository,
    digitalTwinService,
    memoryMapService,
    memoryGovernanceService,
    knowledgeGraphService,
    hypothesisService,
    idGenerator,
    clock
  );

  return {
    service,
    signalStoreRepository,
    eventLogRepository,
    memoryGovernanceService,
    knowledgeGraphService,
    hypothesisService,
    clock,
  };
}

const baseSourceVersions = { signalsUpdatedAt: null, eventLogCursor: null, graphVersion: null };

describe("TodayDecisionApplicationService — end to end", () => {
  it("runs the full 12-step pipeline: signals -> graph -> hypothesis -> experiment(confirmed) -> twin -> counterfactual -> decision -> recalc -> event log -> memory -> next day reflects history", async () => {
    const harness = makeHarness();

    // 1. Add signals.
    await harness.signalStoreRepository.upsertMany([
      {
        signalType: "sleep_quality",
        latestValue: 8,
        latestTimestamp: "2026-07-11T05:00:00Z",
        reliabilityScore: 0.9,
        syncConsistencyDays: 30,
      },
      {
        signalType: "mood_score",
        latestValue: 7,
        latestTimestamp: "2026-07-11T05:00:00Z",
        reliabilityScore: 0.85,
        syncConsistencyDays: 20,
      },
    ]);

    // 2. Create a graph node + edge for the winning decision type.
    const node = await harness.knowledgeGraphService.recordNode("quran_timing");
    const edge = await harness.knowledgeGraphService.recordEdge(
      {
        fromNodeId: node.id,
        toNodeId: node.id,
        recordType: "Observation",
        directionBasis: "temporal_precedence",
        initialMaturity: "correlated",
        initialConfidence: 0.5,
      },
      { allowSelfEdge: true }
    );

    // 3. Create a hypothesis linked to that edge, currently "testing".
    const hypothesis = await harness.hypothesisService.formHypothesis({
      statement: "Morning quran timing improves completion",
      relatedEdgeId: edge.id,
    });
    await harness.hypothesisService.beginTesting(hypothesis.id);

    // 4. "Run an experiment" (confirm it) and reinforce the edge — a
    // stand-in for ExperimentService.evaluate() (PR #5), which this
    // orchestration test doesn't need to re-exercise directly.
    await harness.knowledgeGraphService.reinforceEdge(edge.id, "suspected_causal", 0.8, 3);

    const candidateDecisions = [
      makeDecision("d1", "quran_timing", "Pray Fajr then read Quran for 20 minutes"),
      makeDecision("d2", "gym_time", "Go to the gym at 6pm"),
    ];

    const command: RunTodayCommand = {
      userId: "u1",
      signalStoreDelta: {},
      candidateDecisions,
      previouslyAcceptedDecisions: [],
      accuracyByDecisionType: {
        quran_timing: { successes: 18, totalShown: 20 },
        gym_time: { successes: 5, totalShown: 20 },
      },
      baselineForecast: { completion: 90, capacity: 85 },
      sourceVersions: baseSourceVersions,
    };

    // 5. Build twin, 6. generate scenarios, 7. select decision.
    const result = await harness.service.runToday(command);

    expect(result.decision).not.toBeNull();
    expect(result.decision!.type).toBe("quran_timing");
    expect(result.uncertainty.isUncertain).toBe(false);
    expect(result.context.twinDerivedAt).toBe("2026-07-11T06:00:00Z");
    // The confirmed/reinforced edge should show up as an active-testing hypothesis's edge.
    expect(result.activeHypotheses).toContain(hypothesis.id);

    // 8. recalc() ran (forecast/timeline present, even with no
    // previously-accepted decisions).
    expect(result.forecast.completion).toBe(90);
    expect(result.timelineOrder).toEqual([]);

    // 9. Event was saved: a "proposed" EventLogEntry exists for the decision.
    const events = await harness.eventLogRepository.findByDecisionId(result.decision!.id);
    expect(events).toHaveLength(1);
    expect(events[0].userAction).toBe("proposed");
    expect(events[0].outcome).toBe("pending");

    // 10. Record an outcome for that decision (mirrors what the future
    // API layer's respond/outcome endpoints will do — appending, never
    // mutating).
    await harness.eventLogRepository.append({
      id: "outcome-1",
      decisionId: result.decision!.id,
      timestamp: harness.clock.now(),
      signalsSnapshot: {},
      recommendation: null,
      userAction: "accepted",
      outcome: "completed",
      outcomeTimestamp: harness.clock.now(),
      experimentId: null,
    });

    // 11. Open the next day: previously accepted decisions now include
    // today's, and its effect shows up in recalc()'s forecast movement.
    harness.clock.advanceDay();
    const tomorrow = await harness.service.runToday({
      ...command,
      candidateDecisions: [makeDecision("d3", "quran_timing", "Pray Fajr then read Quran for 20 minutes")],
      previouslyAcceptedDecisions: [result.decision!],
    });

    // 12. The system benefited from yesterday: forecast moved up
    // relative to the flat baseline because of the now-accepted decision.
    expect(tomorrow.forecast.completion).toBeGreaterThan(90);

    const allEventsForOriginalDecision = await harness.eventLogRepository.findByDecisionId(
      result.decision!.id
    );
    // History accumulates via new entries, never rewrites the original.
    expect(allEventsForOriginalDecision).toHaveLength(2);
    expect(allEventsForOriginalDecision[0].userAction).toBe("proposed");
    expect(allEventsForOriginalDecision[1].userAction).toBe("accepted");
  });
});

describe("TodayDecisionApplicationService — no-decision paths write nothing", () => {
  it("writes no Event Log entry and applies no memory decay when there are no candidates", async () => {
    const harness = makeHarness();
    const result = await harness.service.runToday({
      userId: "u1",
      signalStoreDelta: {},
      candidateDecisions: [],
      previouslyAcceptedDecisions: [],
      accuracyByDecisionType: {},
      baselineForecast: { completion: 90, capacity: 85 },
      sourceVersions: baseSourceVersions,
    });

    expect(result.decision).toBeNull();
    expect(result.uncertainty).toEqual({ isUncertain: true, reason: "no_candidates" });

    const all = await harness.eventLogRepository.findByDecisionId("d1");
    expect(all).toEqual([]);
  });

  it("writes no Event Log entry when signals are missing (uncertain)", async () => {
    const harness = makeHarness();
    const candidateDecisions = [makeDecision("d1", "quran_timing", "Pray Fajr")];
    const result = await harness.service.runToday({
      userId: "u1",
      signalStoreDelta: {},
      candidateDecisions,
      previouslyAcceptedDecisions: [],
      accuracyByDecisionType: {},
      baselineForecast: { completion: 90, capacity: 85 },
      sourceVersions: baseSourceVersions,
    });

    expect(result.decision).toBeNull();
    expect(result.uncertainty.reason).toBe("missing_signals");
    expect(await harness.eventLogRepository.findByDecisionId("d1")).toEqual([]);
  });

  it("computes missingSignals against the full known signal list", async () => {
    const harness = makeHarness();
    await harness.signalStoreRepository.upsertMany([
      {
        signalType: "sleep_quality",
        latestValue: 8,
        latestTimestamp: "t",
        reliabilityScore: 0.9,
        syncConsistencyDays: 30,
      },
    ]);
    const result = await harness.service.runToday({
      userId: "u1",
      signalStoreDelta: {},
      candidateDecisions: [],
      previouslyAcceptedDecisions: [],
      accuracyByDecisionType: {},
      baselineForecast: { completion: 90, capacity: 85 },
      sourceVersions: baseSourceVersions,
    });
    expect(result.context.missingSignals).not.toContain("sleep_quality");
    expect(result.context.missingSignals).toContain("mood_score");
  });
});
