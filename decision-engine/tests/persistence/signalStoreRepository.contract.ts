import { describe, it, expect } from "vitest";
import { SignalStoreRepository } from "../../src/persistence/SignalStoreRepository";
import { SignalStoreEntry } from "../../src/types";

function makeEntry(overrides: Partial<SignalStoreEntry> = {}): SignalStoreEntry {
  return {
    signalType: "sleep_quality",
    latestValue: 8,
    latestTimestamp: "2026-07-10T06:00:00Z",
    reliabilityScore: 0.85,
    syncConsistencyDays: 20,
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any SignalStoreRepository
 * implementation. A future PostgresSignalStoreRepository test file
 * should import and call this with its own factory — if it passes, the
 * implementation is a drop-in replacement for the in-memory one.
 */
export function runSignalStoreRepositoryContractTests(
  makeRepo: () => SignalStoreRepository
) {
  describe("SignalStoreRepository contract", () => {
    it("returns undefined for a signal that was never stored", async () => {
      const repo = makeRepo();
      expect(await repo.get("sleep_quality")).toBeUndefined();
    });

    it("upserts a new signal", async () => {
      const repo = makeRepo();
      await repo.upsert(makeEntry());
      expect(await repo.get("sleep_quality")).toEqual(makeEntry());
    });

    it("upsert overwrites the previous value for the same signal type", async () => {
      const repo = makeRepo();
      await repo.upsert(makeEntry({ latestValue: 6, reliabilityScore: 0.5 }));
      await repo.upsert(makeEntry({ latestValue: 9, reliabilityScore: 0.95 }));

      const result = await repo.get("sleep_quality");
      expect(result?.latestValue).toBe(9);
      expect(result?.reliabilityScore).toBe(0.95);
    });

    it("upsertMany writes multiple distinct signals", async () => {
      const repo = makeRepo();
      await repo.upsertMany([
        makeEntry({ signalType: "sleep_quality" }),
        makeEntry({ signalType: "mood_score", latestValue: 7 }),
      ]);

      const all = await repo.getAll();
      expect(Object.keys(all).sort()).toEqual(["mood_score", "sleep_quality"]);
    });

    it("getAll reflects only what has been upserted (a partial store)", async () => {
      const repo = makeRepo();
      await repo.upsert(makeEntry({ signalType: "mood_score" }));

      const all = await repo.getAll();
      expect(all.mood_score).toBeDefined();
      expect(all.sleep_quality).toBeUndefined();
    });

    it("delete removes a signal", async () => {
      const repo = makeRepo();
      await repo.upsert(makeEntry());
      await repo.delete("sleep_quality");
      expect(await repo.get("sleep_quality")).toBeUndefined();
    });

    it("delete on a signal that was never stored is a no-op, not an error", async () => {
      const repo = makeRepo();
      await expect(repo.delete("sleep_quality")).resolves.not.toThrow();
    });

    it("supports custom: namespaced signal types alongside known ones", async () => {
      const repo = makeRepo();
      await repo.upsert(
        makeEntry({ signalType: "custom:screen_time_minutes", latestValue: 42 })
      );
      expect(await repo.get("custom:screen_time_minutes")).toMatchObject({
        latestValue: 42,
      });
    });
  });
}
