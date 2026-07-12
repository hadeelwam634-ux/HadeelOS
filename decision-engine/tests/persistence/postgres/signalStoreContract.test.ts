import { beforeEach, describe, expect, it } from "vitest";
import { SignalStoreEntry } from "../../../src/types";
import { SignalStoreRepository } from "../../../src/persistence/SignalStoreRepository";
import { InMemorySignalStoreRepository } from "../../../src/persistence/InMemorySignalStoreRepository";
import { PostgresSignalStoreRepository } from "../../../src/persistence/postgres/PostgresSignalStoreRepository";
import { createPgMemDb } from "./pgMemHarness";

/**
 * A single behavioral contract, run against both the in-memory and the
 * Postgres (pg-mem-backed) implementations. If these two implementations
 * ever disagree, one of them is not a true drop-in replacement for the
 * SignalStoreRepository interface — exactly the guarantee the interface's
 * own doc comment promises.
 */
function signalStoreContract(
  name: string,
  makeRepo: () => SignalStoreRepository,
) {
  describe(`SignalStoreRepository contract: ${name}`, () => {
    let repo: SignalStoreRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    const entry: SignalStoreEntry = {
      signalType: "sleep_duration",
      latestValue: 7.5,
      latestTimestamp: "2026-07-12T06:00:00.000Z",
      reliabilityScore: 0.9,
      syncConsistencyDays: 5,
    };

    it("returns undefined for an unknown signal", async () => {
      expect(await repo.get("sleep_duration")).toBeUndefined();
    });

    it("round-trips a numeric value through upsert/get", async () => {
      await repo.upsert(entry);
      expect(await repo.get("sleep_duration")).toEqual(entry);
    });

    it("round-trips a string value through upsert/get", async () => {
      const stringEntry: SignalStoreEntry = {
        signalType: "custom:journal_tag",
        latestValue: "calm",
        latestTimestamp: "2026-07-12T06:00:00.000Z",
        reliabilityScore: 0.6,
        syncConsistencyDays: 1,
      };
      await repo.upsert(stringEntry);
      expect(await repo.get("custom:journal_tag")).toEqual(stringEntry);
    });

    it("upsert overwrites the previous value for the same signal type", async () => {
      await repo.upsert(entry);
      const updated: SignalStoreEntry = { ...entry, latestValue: 6.2 };
      await repo.upsert(updated);
      expect(await repo.get("sleep_duration")).toEqual(updated);
    });

    it("upsertMany writes every entry", async () => {
      const second: SignalStoreEntry = {
        signalType: "mood_score",
        latestValue: 0.8,
        latestTimestamp: "2026-07-12T06:00:00.000Z",
        reliabilityScore: 0.7,
        syncConsistencyDays: 2,
      };
      await repo.upsertMany([entry, second]);
      expect(await repo.get("sleep_duration")).toEqual(entry);
      expect(await repo.get("mood_score")).toEqual(second);
    });

    it("getAll returns every stored entry keyed by signal type", async () => {
      await repo.upsert(entry);
      expect(await repo.getAll()).toEqual({ sleep_duration: entry });
    });

    it("delete removes a signal; deleting an unknown signal is a no-op", async () => {
      await repo.upsert(entry);
      await repo.delete("sleep_duration");
      expect(await repo.get("sleep_duration")).toBeUndefined();
      await expect(repo.delete("mood_score")).resolves.toBeUndefined();
    });

    it("mutating a previously-returned entry does not affect stored state", async () => {
      await repo.upsert(entry);
      const read = await repo.get("sleep_duration");
      // @ts-expect-error intentionally mutating a read result to prove isolation
      read.latestValue = 999;
      expect(await repo.get("sleep_duration")).toEqual(entry);
    });
  });
}

signalStoreContract("InMemorySignalStoreRepository", () => new InMemorySignalStoreRepository());
signalStoreContract("PostgresSignalStoreRepository (pg-mem)", () => new PostgresSignalStoreRepository(createPgMemDb()));
