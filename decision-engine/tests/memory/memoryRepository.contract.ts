import { describe, it, expect } from "vitest";
import { MemoryRecord } from "../../src/types";
import { MemoryRepository } from "../../src/memory/MemoryRepository";
import {
  DuplicateMemoryGovernanceRecordError,
  DuplicateMemoryRecordError,
  InvalidMemoryTransitionError,
  MemoryInvalidConfidenceError,
  MemoryInvalidEvidenceCountError,
  UnknownMemoryRecordError,
} from "../../src/memory/errors";

function makeMemory(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    userId: "u1",
    key: "decision_style",
    state: "Missing",
    value: null,
    confidence: 0,
    evidenceCount: 0,
    lastReinforcedAt: "2026-07-10T06:00:00Z",
    blocked: false,
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any MemoryRepository
 * implementation. A future PostgresMemoryRepository test file should
 * import and call this with its own factory.
 */
export function runMemoryRepositoryContractTests(makeRepo: () => MemoryRepository) {
  describe("MemoryRepository contract", () => {
    describe("add / get / getByKey / getAllForUser", () => {
      it("returns undefined for a memory that was never added", async () => {
        const repo = makeRepo();
        expect(await repo.get("missing")).toBeUndefined();
        expect(await repo.getByKey("u1", "decision_style")).toBeUndefined();
      });

      it("adds a memory retrievable via get() and getByKey()", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory());
        expect(await repo.get("m1")).toEqual(makeMemory());
        expect(await repo.getByKey("u1", "decision_style")).toEqual(makeMemory());
      });

      it("rejects a duplicate memory id", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory());
        await expect(repo.add(makeMemory())).rejects.toThrow(DuplicateMemoryRecordError);
      });

      it("rejects invalid confidence and evidenceCount on add", async () => {
        const repo = makeRepo();
        await expect(repo.add(makeMemory({ confidence: 1.5 }))).rejects.toThrow(
          MemoryInvalidConfidenceError
        );
        await expect(repo.add(makeMemory({ confidence: NaN }))).rejects.toThrow(
          MemoryInvalidConfidenceError
        );
        await expect(repo.add(makeMemory({ evidenceCount: -1 }))).rejects.toThrow(
          MemoryInvalidEvidenceCountError
        );
        await expect(repo.add(makeMemory({ evidenceCount: 2.5 }))).rejects.toThrow(
          MemoryInvalidEvidenceCountError
        );
      });

      it("getAllForUser preserves insertion order and only returns that user's memories", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ id: "m1", userId: "u1", key: "a" }));
        await repo.add(makeMemory({ id: "m2", userId: "u2", key: "b" }));
        await repo.add(makeMemory({ id: "m3", userId: "u1", key: "c" }));

        const u1Memories = await repo.getAllForUser("u1");
        expect(u1Memories.map((m) => m.id)).toEqual(["m1", "m3"]);
      });

      it("getAllForUser returns an empty array for an unknown user", async () => {
        const repo = makeRepo();
        expect(await repo.getAllForUser("nobody")).toEqual([]);
      });

      it("mutating the object passed to add() does not affect the stored memory", async () => {
        const repo = makeRepo();
        const original = makeMemory();
        await repo.add(original);
        original.confidence = 0.9;
        expect((await repo.get("m1"))?.confidence).toBe(0);
      });

      it("mutating an object returned from get()/getByKey()/getAllForUser() does not affect stored state", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory());

        const fetched = await repo.get("m1");
        if (fetched) fetched.confidence = 0.9;
        const byKey = await repo.getByKey("u1", "decision_style");
        if (byKey) byKey.confidence = 0.8;
        const [fromList] = await repo.getAllForUser("u1");
        fromList.confidence = 0.7;

        expect((await repo.get("m1"))?.confidence).toBe(0);
      });
    });

    describe("updateState", () => {
      async function seedMemory(repo: MemoryRepository) {
        await repo.add(makeMemory({ state: "Missing", confidence: 0, evidenceCount: 0 }));
      }

      it("throws UnknownMemoryRecordError for a memory that does not exist", async () => {
        const repo = makeRepo();
        await expect(
          repo.updateState("missing", {
            state: "Learning",
            confidence: 0.2,
            evidenceCount: 1,
            actor: "system",
            action: "promote",
            reason: "evidence",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(UnknownMemoryRecordError);
      });

      it("allows a single natural promotion step and records lastReinforcedAt", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        const updated = await repo.updateState("m1", {
          state: "Learning",
          value: "reflective",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "first signal observed",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.state).toBe("Learning");
        expect(updated.value).toBe("reflective");
        expect(updated.lastReinforcedAt).toBe("2026-07-11T00:00:00Z");
      });

      it("omitting value leaves the existing value unchanged", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ state: "Learning", value: "reflective", confidence: 0.3, evidenceCount: 1 }));
        const updated = await repo.updateState("m1", {
          state: "Knows",
          confidence: 0.5,
          evidenceCount: 2,
          actor: "system",
          action: "promote",
          reason: "second signal observed",
          timestamp: "2026-07-11T01:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.value).toBe("reflective");
      });

      it("omitting blocked leaves the existing blocked flag unchanged", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ state: "Knows", blocked: true, confidence: 0.9, evidenceCount: 3 }));
        const updated = await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.6,
          evidenceCount: 3,
          actor: "system",
          action: "demote",
          reason: "evidence_decay",
          timestamp: "2026-07-11T01:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.blocked).toBe(true);
      });

      it("rejects skipping Missing straight to Knows", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await expect(
          repo.updateState("m1", {
            state: "Knows",
            confidence: 0.9,
            evidenceCount: 3,
            actor: "system",
            action: "promote",
            reason: "too fast",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(InvalidMemoryTransitionError);
      });

      it("rejects Knows straight to Missing without forceCollapse", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ state: "Knows", confidence: 0.9, evidenceCount: 3 }));
        await expect(
          repo.updateState("m1", {
            state: "Missing",
            confidence: 0,
            evidenceCount: 0,
            actor: "system",
            action: "demote",
            reason: "stale_data",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(InvalidMemoryTransitionError);
      });

      it("rejects Missing straight to Knows without userCorrection", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await expect(
          repo.updateState("m1", {
            state: "Knows",
            confidence: 1,
            evidenceCount: 1,
            actor: "user",
            action: "correct",
            reason: "user provided a corrected value",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(InvalidMemoryTransitionError);
      });

      it("allows Missing straight to Knows when userCorrection is set", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        const updated = await repo.updateState("m1", {
          state: "Knows",
          value: "decisive",
          confidence: 1,
          evidenceCount: 1,
          userCorrection: true,
          actor: "user",
          action: "correct",
          reason: "user provided a corrected value",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.state).toBe("Knows");
        expect(updated.value).toBe("decisive");
      });

      it("allows Knows straight to Missing when forceCollapse is set", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ state: "Knows", confidence: 0.9, evidenceCount: 3 }));
        const updated = await repo.updateState("m1", {
          state: "Missing",
          confidence: 0,
          evidenceCount: 0,
          forceCollapse: true,
          actor: "system",
          action: "demote",
          reason: "stale_data",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.state).toBe("Missing");
      });

      it("allows a same-state reinforcement", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ state: "Knows", confidence: 0.7, evidenceCount: 3 }));
        const updated = await repo.updateState("m1", {
          state: "Knows",
          confidence: 0.9,
          evidenceCount: 4,
          actor: "system",
          action: "promote",
          reason: "reinforced",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        expect(updated.state).toBe("Knows");
        expect(updated.confidence).toBe(0.9);
      });

      it("rejects invalid confidence/evidenceCount on update and writes nothing", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        const before = await repo.get("m1");
        await expect(
          repo.updateState("m1", {
            state: "Learning",
            confidence: NaN,
            evidenceCount: 1,
            actor: "system",
            action: "promote",
            reason: "bad",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(MemoryInvalidConfidenceError);
        await expect(
          repo.updateState("m1", {
            state: "Learning",
            confidence: 0.5,
            evidenceCount: -1,
            actor: "system",
            action: "promote",
            reason: "bad",
            timestamp: "2026-07-11T00:00:00Z",
            governanceRecordId: "g2",
          })
        ).rejects.toThrow(MemoryInvalidEvidenceCountError);
        expect(await repo.get("m1")).toEqual(before);
        expect(await repo.getGovernanceLog("m1")).toEqual([]);
      });

      it("mutating an object returned from updateState() does not affect stored state", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        const updated = await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "evidence",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        updated.confidence = 0.99;
        expect((await repo.get("m1"))?.confidence).toBe(0.3);
      });
    });

    describe("governance log", () => {
      async function seedMemory(repo: MemoryRepository) {
        await repo.add(makeMemory({ state: "Missing", confidence: 0, evidenceCount: 0 }));
      }

      it("returns an empty array for a memory with no history yet", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        expect(await repo.getGovernanceLog("m1")).toEqual([]);
      });

      it("returns an empty array for a memory that does not exist", async () => {
        const repo = makeRepo();
        expect(await repo.getGovernanceLog("missing")).toEqual([]);
      });

      it("a successful updateState() appends one record with previousState/nextState/reason", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "first signal observed",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        const log = await repo.getGovernanceLog("m1");
        expect(log).toHaveLength(1);
        expect(log[0]).toEqual({
          id: "g1",
          memoryId: "m1",
          actor: "system",
          action: "promote",
          previousState: "Missing",
          nextState: "Learning",
          reason: "first signal observed",
          timestamp: "2026-07-11T00:00:00Z",
        });
      });

      it("records are returned in stable insertion order across multiple updates", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "step 1",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        await repo.updateState("m1", {
          state: "Knows",
          confidence: 0.6,
          evidenceCount: 2,
          actor: "system",
          action: "promote",
          reason: "step 2",
          timestamp: "2026-07-11T01:00:00Z",
          governanceRecordId: "g2",
        });
        const log = await repo.getGovernanceLog("m1");
        expect(log.map((r) => r.id)).toEqual(["g1", "g2"]);
      });

      it("mutating a returned governance record does not affect stored history", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "first signal observed",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        const [record] = await repo.getGovernanceLog("m1");
        record.reason = "tampered";
        const [stored] = await repo.getGovernanceLog("m1");
        expect(stored.reason).toBe("first signal observed");
      });

      it("rejects a governanceRecordId that was already used on the same memory, and writes nothing", async () => {
        const repo = makeRepo();
        await seedMemory(repo);
        await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "step 1",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "g1",
        });
        const before = await repo.get("m1");

        await expect(
          repo.updateState("m1", {
            state: "Knows",
            confidence: 0.6,
            evidenceCount: 2,
            actor: "system",
            action: "promote",
            reason: "step 2",
            timestamp: "2026-07-11T01:00:00Z",
            governanceRecordId: "g1",
          })
        ).rejects.toThrow(DuplicateMemoryGovernanceRecordError);

        expect(await repo.get("m1")).toEqual(before);
        expect(await repo.getGovernanceLog("m1")).toHaveLength(1);
      });

      it("rejects a governanceRecordId that collides across different memories (global uniqueness)", async () => {
        const repo = makeRepo();
        await repo.add(makeMemory({ id: "m1", userId: "u1", key: "a" }));
        await repo.add(makeMemory({ id: "m2", userId: "u1", key: "b" }));

        await repo.updateState("m1", {
          state: "Learning",
          confidence: 0.3,
          evidenceCount: 1,
          actor: "system",
          action: "promote",
          reason: "step 1",
          timestamp: "2026-07-11T00:00:00Z",
          governanceRecordId: "shared-id",
        });

        await expect(
          repo.updateState("m2", {
            state: "Learning",
            confidence: 0.3,
            evidenceCount: 1,
            actor: "system",
            action: "promote",
            reason: "step 1",
            timestamp: "2026-07-11T01:00:00Z",
            governanceRecordId: "shared-id",
          })
        ).rejects.toThrow(DuplicateMemoryGovernanceRecordError);

        expect(await repo.getGovernanceLog("m2")).toEqual([]);
      });
    });
  });
}
