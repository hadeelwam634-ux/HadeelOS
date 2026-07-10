import { describe, it, expect } from "vitest";
import {
  DuplicateEventLogEntryError,
  EventLogRepository,
} from "../../src/persistence/EventLogRepository";
import { EventLogEntry } from "../../src/types";

function makeEntry(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    id: "e1",
    decisionId: "d1",
    timestamp: "2026-07-10T06:00:00Z",
    signalsSnapshot: {},
    recommendation: { action: "quran_before_noon" },
    userAction: "accepted",
    outcome: "pending",
    outcomeTimestamp: null,
    experimentId: null,
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any EventLogRepository
 * implementation, verifying the append-only guarantee: no matter how
 * an implementation stores data, history must accumulate — never be
 * overwritten in place. A future PostgresEventLogRepository test file
 * should import and call this with its own factory.
 */
export function runEventLogRepositoryContractTests(
  makeRepo: () => EventLogRepository
) {
  describe("EventLogRepository contract", () => {
    it("returns an empty log initially", async () => {
      const repo = makeRepo();
      expect(await repo.getAll()).toEqual([]);
    });

    it("append adds an entry retrievable via getAll", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry());
      expect(await repo.getAll()).toEqual([makeEntry()]);
    });

    it("preserves insertion order across multiple appends", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry({ id: "e1", timestamp: "2026-07-10T06:00:00Z" }));
      await repo.append(makeEntry({ id: "e2", timestamp: "2026-07-10T07:00:00Z" }));
      await repo.append(makeEntry({ id: "e3", timestamp: "2026-07-10T08:00:00Z" }));

      const all = await repo.getAll();
      expect(all.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    });

    it("is append-only: recording an outcome later means appending a new entry, not mutating the old one", async () => {
      const repo = makeRepo();
      const proposed = makeEntry({
        id: "e1",
        decisionId: "d1",
        outcome: "pending",
        outcomeTimestamp: null,
      });
      await repo.append(proposed);

      const outcomeRecorded = makeEntry({
        id: "e2",
        decisionId: "d1",
        outcome: "completed",
        outcomeTimestamp: "2026-07-10T20:00:00Z",
      });
      await repo.append(outcomeRecorded);

      const history = await repo.findByDecisionId("d1");
      expect(history).toHaveLength(2);
      expect(history[0].outcome).toBe("pending"); // original entry untouched
      expect(history[1].outcome).toBe("completed");
    });

    it("findByDecisionId only returns entries for that decision, in order", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry({ id: "e1", decisionId: "d1" }));
      await repo.append(makeEntry({ id: "e2", decisionId: "d2" }));
      await repo.append(makeEntry({ id: "e3", decisionId: "d1" }));

      const history = await repo.findByDecisionId("d1");
      expect(history.map((e) => e.id)).toEqual(["e1", "e3"]);
    });

    it("findByDecisionId returns an empty array for an unknown decision", async () => {
      const repo = makeRepo();
      expect(await repo.findByDecisionId("unknown")).toEqual([]);
    });

    it("getAll returns a copy: mutating the result does not affect the stored log", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry());
      const all = await repo.getAll();
      all.pop();
      expect(await repo.getAll()).toHaveLength(1);
    });

    it("findByDecisionId returns a copy too", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry({ id: "e1", decisionId: "d1" }));
      const history = await repo.findByDecisionId("d1");
      history.pop();
      expect(await repo.findByDecisionId("d1")).toHaveLength(1);
    });

    it("mutating the object passed to append() does not affect the stored entry", async () => {
      const repo = makeRepo();
      const original = makeEntry({ id: "e1", outcome: "pending" });
      await repo.append(original);

      original.outcome = "completed";
      original.outcomeTimestamp = "2026-07-10T20:00:00Z";

      const [stored] = await repo.getAll();
      expect(stored.outcome).toBe("pending");
      expect(stored.outcomeTimestamp).toBeNull();
    });

    it("mutating an object returned from getAll() does not affect the stored log", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry({ id: "e1", outcome: "pending" }));

      const all = await repo.getAll();
      all[0].outcome = "skipped";

      const [stillStored] = await repo.getAll();
      expect(stillStored.outcome).toBe("pending");
    });

    it("rejects appending an entry whose id already exists", async () => {
      const repo = makeRepo();
      await repo.append(makeEntry({ id: "e1", outcome: "pending" }));

      await expect(
        repo.append(makeEntry({ id: "e1", outcome: "completed" }))
      ).rejects.toThrow(DuplicateEventLogEntryError);

      // and the original entry must be untouched by the rejected attempt
      const [stored] = await repo.getAll();
      expect(stored.outcome).toBe("pending");
    });
  });
}
