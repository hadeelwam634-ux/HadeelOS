import { describe, expect, it } from "vitest";
import { PostgresMemoryRepository } from "../../src/memory/PostgresMemoryRepository";
import { DuplicateMemoryRecordError, UnknownMemoryRecordError } from "../../src/memory/errors";
import { MemoryRecord } from "../../src/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID, OTHER_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";

function makeMemory(id: string, key: string): MemoryRecord {
  return {
    id: id as any,
    userId: DEFAULT_TEST_USER_ID as any,
    key,
    state: "Learning",
    value: null,
    confidence: 0.5,
    evidenceCount: 1,
    lastReinforcedAt: "2026-07-01T00:00:00.000Z",
    blocked: false,
  };
}

describe("PostgresMemoryRepository (pg-mem)", () => {
  it("round-trips add/get/getByKey/getAllForUser", async () => {
    const db = createPgMemDb();
    const repo = new PostgresMemoryRepository(db, DEFAULT_TEST_USER_ID);
    const memory = makeMemory("11111111-1111-4111-8111-111111111112", "sleep_pattern");
    await repo.add(memory);

    expect(await repo.get(memory.id)).toEqual(memory);
    expect(await repo.getByKey(DEFAULT_TEST_USER_ID, "sleep_pattern")).toEqual(memory);
    expect(await repo.getAllForUser(DEFAULT_TEST_USER_ID)).toEqual([memory]);
  });

  it("rejects a duplicate memory id", async () => {
    const db = createPgMemDb();
    const repo = new PostgresMemoryRepository(db, DEFAULT_TEST_USER_ID);
    const memory = makeMemory("22222222-2222-4222-8222-222222222223", "k1");
    await repo.add(memory);
    await expect(repo.add(memory)).rejects.toThrow(DuplicateMemoryRecordError);
  });

  it("updateState updates the record and appends exactly one governance record", async () => {
    const db = createPgMemDb();
    const repo = new PostgresMemoryRepository(db, DEFAULT_TEST_USER_ID);
    const memory = makeMemory("33333333-3333-4333-8333-333333333334", "k2");
    await repo.add(memory);

    const updated = await repo.updateState(memory.id, {
      state: "Knows",
      confidence: 0.9,
      evidenceCount: 3,
      actor: "system",
      action: "promote",
      reason: "enough evidence",
      timestamp: "2026-07-02T00:00:00.000Z",
      governanceRecordId: "44444444-4444-4444-8444-444444444445" as any,
    });

    expect(updated.state).toBe("Knows");
    expect(updated.confidence).toBe(0.9);

    const log = await repo.getGovernanceLog(memory.id);
    expect(log).toHaveLength(1);
    expect(log[0].previousState).toBe("Learning");
    expect(log[0].nextState).toBe("Knows");
  });

  it("throws UnknownMemoryRecordError when updating a nonexistent memory", async () => {
    const db = createPgMemDb();
    const repo = new PostgresMemoryRepository(db, DEFAULT_TEST_USER_ID);
    await expect(
      repo.updateState("55555555-5555-4555-8555-555555555556" as any, {
        state: "Knows",
        confidence: 0.9,
        evidenceCount: 3,
        actor: "system",
        action: "promote",
        reason: "x",
        timestamp: "2026-07-02T00:00:00.000Z",
        governanceRecordId: "66666666-6666-4666-8666-666666666667" as any,
      }),
    ).rejects.toThrow(UnknownMemoryRecordError);
  });

  it("isolates memory records by bound userId", async () => {
    const db = createPgMemDb();
    const ownerRepo = new PostgresMemoryRepository(db, DEFAULT_TEST_USER_ID);
    const otherRepo = new PostgresMemoryRepository(db, OTHER_TEST_USER_ID);
    const memory = makeMemory("77777777-7777-4777-8777-777777777778", "k3");
    await ownerRepo.add(memory);

    // get()/updateState()/getGovernanceLog() have no userId parameter in
    // the interface, so isolation for them relies entirely on the
    // constructor-bound userId.
    expect(await otherRepo.get(memory.id)).toBeUndefined();
  });
});
