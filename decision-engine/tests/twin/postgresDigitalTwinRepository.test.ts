import { describe, expect, it } from "vitest";
import { PostgresDigitalTwinRepository } from "../../src/twin/PostgresDigitalTwinRepository";
import { DuplicateDigitalTwinSnapshotError } from "../../src/twin/errors";
import { DigitalTwinSnapshot } from "../../src/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID, OTHER_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";

function makeSnapshot(id: string, userId: string, derivedAt: string): DigitalTwinSnapshot {
  return {
    id: id as any,
    userId: userId as any,
    derivedAt,
    stress: "low",
    energyCurve: [],
    decisionStyle: null,
    behaviorPatterns: [],
    knownPreferences: [],
    activeConstraints: [],
    sourceVersions: {} as any,
  };
}

describe("PostgresDigitalTwinRepository (pg-mem)", () => {
  it("round-trips save/getById/getLatest/getHistory", async () => {
    const db = createPgMemDb();
    const repo = new PostgresDigitalTwinRepository(db, DEFAULT_TEST_USER_ID);
    const a = makeSnapshot("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", DEFAULT_TEST_USER_ID, "2026-07-01T00:00:00.000Z");
    const b = makeSnapshot("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", DEFAULT_TEST_USER_ID, "2026-07-02T00:00:00.000Z");
    await repo.save(a);
    await repo.save(b);

    expect(await repo.getById(a.id)).toEqual(a);
    expect(await repo.getLatest(DEFAULT_TEST_USER_ID)).toEqual(b);
    expect(await repo.getHistory(DEFAULT_TEST_USER_ID)).toEqual([a, b]);
  });

  it("rejects a duplicate snapshot id", async () => {
    const db = createPgMemDb();
    const repo = new PostgresDigitalTwinRepository(db, DEFAULT_TEST_USER_ID);
    const a = makeSnapshot("cccccccc-cccc-4ccc-8ccc-cccccccccccc", DEFAULT_TEST_USER_ID, "2026-07-01T00:00:00.000Z");
    await repo.save(a);
    await expect(repo.save(a)).rejects.toThrow(DuplicateDigitalTwinSnapshotError);
  });

  it("isolates snapshots by userId even though getById only takes an id", async () => {
    const db = createPgMemDb();
    const ownerRepo = new PostgresDigitalTwinRepository(db, DEFAULT_TEST_USER_ID);
    const otherRepo = new PostgresDigitalTwinRepository(db, OTHER_TEST_USER_ID);
    const snapshot = makeSnapshot("dddddddd-dddd-4ddd-8ddd-dddddddddddd", DEFAULT_TEST_USER_ID, "2026-07-01T00:00:00.000Z");
    await ownerRepo.save(snapshot);

    expect(await ownerRepo.getById(snapshot.id)).toEqual(snapshot);
    // getById has no userId parameter in the interface, so isolation here
    // relies entirely on the constructor-bound userId (see class doc
    // comment) — a different bound instance must not see this snapshot.
    expect(await otherRepo.getById(snapshot.id)).toBeUndefined();
  });
});
