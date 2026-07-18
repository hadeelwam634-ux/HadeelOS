import { beforeEach, describe, expect, it } from "vitest";
import { EventLogEntry } from "../../../src/types";
import {
  DuplicateEventLogEntryError,
  EventLogRepository,
} from "../../../src/persistence/EventLogRepository";
import { InMemoryEventLogRepository } from "../../../src/persistence/InMemoryEventLogRepository";
import { PostgresEventLogRepository } from "../../../src/persistence/postgres/PostgresEventLogRepository";
import { createPgMemDb, DEFAULT_TEST_USER_ID } from "./pgMemHarness";

function makeEntry(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    decisionId: "22222222-2222-4222-8222-222222222222",
    timestamp: "2026-07-12T06:00:00.000Z",
    signalsSnapshot: { sleep_duration: { signalType: "sleep_duration", latestValue: 7, latestTimestamp: "2026-07-12T06:00:00.000Z", reliabilityScore: 0.9, syncConsistencyDays: 3 } },
    recommendation: { action: "rest" },
    userAction: "proposed",
    outcome: "pending",
    outcomeTimestamp: null,
    experimentId: null,
    ...overrides,
  };
}

/**
 * A single behavioral contract, run against both the in-memory and the
 * Postgres (pg-mem-backed) implementations — including the duplicate-id
 * rejection path, which each backend enforces a different way (an
 * explicit array scan in-memory, a UNIQUE constraint in Postgres) but
 * which must surface as the exact same DuplicateEventLogEntryError
 * either way.
 */
function eventLogContract(name: string, makeRepo: () => EventLogRepository) {
  describe(`EventLogRepository contract: ${name}`, () => {
    let repo: EventLogRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("returns an empty array when nothing has been appended", async () => {
      expect(await repo.getAll()).toEqual([]);
      expect(await repo.findByDecisionId("22222222-2222-4222-8222-222222222222")).toEqual([]);
    });

    it("round-trips an appended entry", async () => {
      const entry = makeEntry();
      await repo.append(entry);
      expect(await repo.getAll()).toEqual([entry]);
      expect(await repo.findByDecisionId(entry.decisionId)).toEqual([entry]);
    });

    it("rejects a second append with the same id", async () => {
      const entry = makeEntry();
      await repo.append(entry);
      await expect(repo.append(entry)).rejects.toBeInstanceOf(DuplicateEventLogEntryError);
    });

    it("preserves insertion order across appends with identical timestamps", async () => {
      const first = makeEntry({ id: "11111111-1111-4111-8111-111111111111", userAction: "proposed" });
      const second = makeEntry({ id: "33333333-3333-4333-8333-333333333333", userAction: "accepted" });
      await repo.append(first);
      await repo.append(second);
      const all = await repo.getAll();
      expect(all.map((e) => e.id)).toEqual([first.id, second.id]);
    });

    it("findByDecisionId only returns entries for the requested decision", async () => {
      const forThisDecision = makeEntry();
      const forAnotherDecision = makeEntry({
        id: "44444444-4444-4444-8444-444444444444",
        decisionId: "55555555-5555-4555-8555-555555555555",
      });
      await repo.append(forThisDecision);
      await repo.append(forAnotherDecision);
      expect(await repo.findByDecisionId(forThisDecision.decisionId)).toEqual([forThisDecision]);
    });

    it("mutating a previously-returned entry does not affect stored state", async () => {
      const entry = makeEntry();
      await repo.append(entry);
      const [read] = await repo.getAll();
      read.outcome = "completed";
      expect((await repo.getAll())[0]).toEqual(entry);
    });
  });
}

eventLogContract("InMemoryEventLogRepository", () => new InMemoryEventLogRepository());
eventLogContract("PostgresEventLogRepository (pg-mem)", () => new PostgresEventLogRepository(createPgMemDb(), DEFAULT_TEST_USER_ID));
