import { describe, it, expect } from "vitest";
import { DigitalTwinSnapshot } from "../../src/types";
import { DigitalTwinRepository } from "../../src/twin/DigitalTwinRepository";
import { DuplicateDigitalTwinSnapshotError } from "../../src/twin/errors";

function makeSnapshot(overrides: Partial<DigitalTwinSnapshot> = {}): DigitalTwinSnapshot {
  return {
    id: "t1",
    userId: "u1",
    derivedAt: "2026-07-11T00:00:00Z",
    stress: "low",
    energyCurve: [{ hour: 9, expectedEnergy: 0.6, confidence: 0.5 }],
    decisionStyle: null,
    behaviorPatterns: [],
    knownPreferences: [],
    activeConstraints: [],
    sourceVersions: { signalsUpdatedAt: null, eventLogCursor: null, graphVersion: null },
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any DigitalTwinRepository
 * implementation. A future PostgresDigitalTwinRepository test file
 * should import and call this with its own factory.
 */
export function runDigitalTwinRepositoryContractTests(makeRepo: () => DigitalTwinRepository) {
  describe("DigitalTwinRepository contract", () => {
    it("returns undefined for a snapshot that was never saved", async () => {
      const repo = makeRepo();
      expect(await repo.getById("missing")).toBeUndefined();
      expect(await repo.getLatest("u1")).toBeUndefined();
    });

    it("saves a snapshot retrievable via getById() and getLatest()", async () => {
      const repo = makeRepo();
      await repo.save(makeSnapshot());
      expect(await repo.getById("t1")).toEqual(makeSnapshot());
      expect(await repo.getLatest("u1")).toEqual(makeSnapshot());
    });

    it("rejects a duplicate snapshot id", async () => {
      const repo = makeRepo();
      await repo.save(makeSnapshot());
      await expect(repo.save(makeSnapshot())).rejects.toThrow(DuplicateDigitalTwinSnapshotError);
    });

    it("getLatest returns the most recently saved snapshot for that user", async () => {
      const repo = makeRepo();
      await repo.save(makeSnapshot({ id: "t1", derivedAt: "2026-07-11T00:00:00Z", stress: "low" }));
      await repo.save(makeSnapshot({ id: "t2", derivedAt: "2026-07-11T06:00:00Z", stress: "high" }));
      expect((await repo.getLatest("u1"))?.id).toBe("t2");
    });

    it("getHistory returns every snapshot for a user in insertion order, and only that user's", async () => {
      const repo = makeRepo();
      await repo.save(makeSnapshot({ id: "t1", userId: "u1" }));
      await repo.save(makeSnapshot({ id: "t2", userId: "u2" }));
      await repo.save(makeSnapshot({ id: "t3", userId: "u1" }));

      const history = await repo.getHistory("u1");
      expect(history.map((s) => s.id)).toEqual(["t1", "t3"]);
    });

    it("getHistory returns an empty array for a user with no snapshots", async () => {
      const repo = makeRepo();
      expect(await repo.getHistory("nobody")).toEqual([]);
    });

    it("mutating the object passed to save() does not affect the stored snapshot", async () => {
      const repo = makeRepo();
      const original = makeSnapshot();
      await repo.save(original);
      original.stress = "high";
      original.behaviorPatterns.push("mutated");
      expect((await repo.getById("t1"))?.stress).toBe("low");
      expect((await repo.getById("t1"))?.behaviorPatterns).toEqual([]);
    });

    it("mutating an object returned from getById()/getLatest()/getHistory() does not affect stored state", async () => {
      const repo = makeRepo();
      await repo.save(makeSnapshot());

      const byId = await repo.getById("t1");
      if (byId) byId.stress = "high";
      const latest = await repo.getLatest("u1");
      if (latest) latest.stress = "medium";
      const [fromHistory] = await repo.getHistory("u1");
      fromHistory.stress = "unknown";

      expect((await repo.getById("t1"))?.stress).toBe("low");
    });
  });
}
