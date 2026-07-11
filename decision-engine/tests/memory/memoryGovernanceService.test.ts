import { describe, it, expect } from "vitest";
import { InMemoryMemoryRepository } from "../../src/memory/InMemoryMemoryRepository";
import { MemoryGovernanceService } from "../../src/memory/MemoryGovernanceService";
import { MemoryMapService } from "../../src/memory/MemoryMapService";
import { UnknownMemoryRecordError } from "../../src/memory/errors";
import { Clock, IdGenerator } from "../../src/application/types";
import { UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class FakeClock implements Clock {
  constructor(private current: number = new Date("2026-07-11T06:00:00Z").getTime()) {}
  now(): string {
    const ts = new Date(this.current).toISOString();
    this.current += 60 * 60 * 1000; // advance an hour per read
    return ts;
  }
  advanceDays(days: number): void {
    this.current += days * 24 * 60 * 60 * 1000;
  }
}

function makeHarness() {
  const repo = new InMemoryMemoryRepository();
  const clock = new FakeClock();
  const governance = new MemoryGovernanceService(repo, new FakeIdGenerator(), clock);
  const map = new MemoryMapService(repo);
  return { repo, governance, map, clock };
}

describe("MemoryGovernanceService", () => {
  it("createMemory starts at Missing with zero confidence/evidence", async () => {
    const { governance } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    expect(memory.state).toBe("Missing");
    expect(memory.confidence).toBe(0);
    expect(memory.evidenceCount).toBe(0);
    expect(memory.blocked).toBe(false);
  });

  it("reinforce() promotes Missing -> Learning -> Knows, one step per call", async () => {
    const { governance, map } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");

    const afterFirst = await governance.reinforce(memory.id, "reflective", 0.3);
    expect(afterFirst.state).toBe("Learning");

    const afterSecond = await governance.reinforce(memory.id, "reflective", 0.3);
    expect(afterSecond.state).toBe("Knows");

    const known = await map.getKnownMemories("u1");
    expect(known.map((m) => m.id)).toContain(memory.id);
  });

  it("throws UnknownMemoryRecordError for an id that was never created", async () => {
    const { governance } = makeHarness();
    await expect(governance.reinforce("missing", "x", 0.1)).rejects.toThrow(UnknownMemoryRecordError);
  });

  it("correct() jumps straight to Knows with confidence 1, regardless of current state", async () => {
    const { governance } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    const corrected = await governance.correct(memory.id, "decisive");
    expect(corrected.state).toBe("Knows");
    expect(corrected.value).toBe("decisive");
    expect(corrected.confidence).toBe(1);
  });

  it("forget() resets to Missing, blocks the memory, and excludes it from getKnownMemories even after re-promotion", async () => {
    const { governance, map } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    await governance.reinforce(memory.id, "reflective", 0.5);
    await governance.reinforce(memory.id, "reflective", 0.5);
    expect((await map.getKnownMemories("u1")).map((m) => m.id)).toContain(memory.id);

    const forgotten = await governance.forget(memory.id);
    expect(forgotten.state).toBe("Missing");
    expect(forgotten.blocked).toBe(true);
    expect(forgotten.value).toBeNull();
    expect(await map.getKnownMemories("u1")).toEqual([]);

    // Even if the system later re-learns the same fact, it stays excluded while blocked.
    await governance.reinforce(memory.id, "reflective", 0.5);
    const reKnown = await governance.reinforce(memory.id, "reflective", 0.5);
    expect(reKnown.state).toBe("Knows");
    expect(await map.getKnownMemories("u1")).toEqual([]);
  });

  it("blockInference() blocks without touching state or value; unblockInference() reverses it", async () => {
    const { governance, map } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    await governance.reinforce(memory.id, "reflective", 0.5);
    const known = await governance.reinforce(memory.id, "reflective", 0.5);
    expect(known.state).toBe("Knows");

    const blocked = await governance.blockInference(memory.id, "user requested privacy for this fact");
    expect(blocked.state).toBe("Knows");
    expect(blocked.value).toBe("reflective");
    expect(blocked.blocked).toBe(true);
    expect(await map.getKnownMemories("u1")).toEqual([]);

    const unblocked = await governance.unblockInference(memory.id, "user re-enabled this fact");
    expect(unblocked.blocked).toBe(false);
    expect((await map.getKnownMemories("u1")).map((m) => m.id)).toContain(memory.id);
  });

  it("applyDecay() returns null and writes nothing when no decay is due", async () => {
    const { governance, repo } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    const result = await governance.applyDecay(memory.id);
    expect(result).toBeNull();
    expect(await repo.getGovernanceLog(memory.id)).toEqual([]);
  });

  it("applyDecay() regresses one step with reason evidence_decay after the decay threshold", async () => {
    const { governance, clock } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    await governance.reinforce(memory.id, "reflective", 0.5);
    const known = await governance.reinforce(memory.id, "reflective", 0.5);
    expect(known.state).toBe("Knows");

    clock.advanceDays(31);
    const decayed = await governance.applyDecay(memory.id);
    expect(decayed?.state).toBe("Learning");
  });

  it("applyDecay() force-collapses Knows straight to Missing with reason stale_data after the staleness threshold", async () => {
    const { governance, clock } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    await governance.reinforce(memory.id, "reflective", 0.5);
    const known = await governance.reinforce(memory.id, "reflective", 0.5);
    expect(known.state).toBe("Knows");

    clock.advanceDays(91);
    const decayed = await governance.applyDecay(memory.id);
    expect(decayed?.state).toBe("Missing");
  });

  it("applyContradiction() regresses one step and is logged with reason contradiction", async () => {
    const { governance, map } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    await governance.reinforce(memory.id, "reflective", 0.5);
    await governance.reinforce(memory.id, "reflective", 0.5);

    const contradicted = await governance.applyContradiction(memory.id);
    expect(contradicted.state).toBe("Learning");

    const log = await map.getGovernanceLog(memory.id);
    expect(log[log.length - 1].reason).toBe("contradiction");
  });

  it("optOutExperiment() and demoteForSourceIssue() each regress one step with the matching reason", async () => {
    const { governance, map } = makeHarness();
    const memoryA = await governance.createMemory("u1", "preference:gym_time");
    await governance.reinforce(memoryA.id, "morning", 0.5);
    await governance.reinforce(memoryA.id, "morning", 0.5);
    const afterOptOut = await governance.optOutExperiment(memoryA.id);
    expect(afterOptOut.state).toBe("Learning");
    expect((await map.getGovernanceLog(memoryA.id)).at(-1)?.reason).toBe("experiment_opt_out");

    const memoryB = await governance.createMemory("u1", "preference:quiet_hours");
    await governance.reinforce(memoryB.id, "evening", 0.5);
    await governance.reinforce(memoryB.id, "evening", 0.5);
    const afterSourceIssue = await governance.demoteForSourceIssue(memoryB.id, "unreliable_source");
    expect(afterSourceIssue.state).toBe("Learning");
    expect((await map.getGovernanceLog(memoryB.id)).at(-1)?.reason).toBe("unreliable_source");
  });

  it("cloning: mutating a returned MemoryRecord does not affect stored state", async () => {
    const { governance, map } = makeHarness();
    const memory = await governance.createMemory("u1", "decision_style");
    const promoted = await governance.reinforce(memory.id, "reflective", 0.5);
    promoted.state = "Knows";
    promoted.value = "tampered";

    const stored = await map.get(memory.id);
    expect(stored?.state).toBe("Learning");
    expect(stored?.value).toBe("reflective");
  });
});
