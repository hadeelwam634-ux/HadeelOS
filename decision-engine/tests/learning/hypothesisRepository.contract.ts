import { describe, it, expect } from "vitest";
import { Hypothesis } from "../../src/types";
import { HypothesisRepository } from "../../src/learning/HypothesisRepository";
import {
  DuplicateHypothesisError,
  InvalidHypothesisTransitionError,
  LearningInvalidConfidenceError,
  LearningInvalidEvidenceCountError,
  UnknownHypothesisError,
} from "../../src/learning/errors";

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "h1",
    statement: "sleep_duration causes mood_score",
    relatedEdgeId: "e1",
    status: "forming",
    competingHypothesisId: null,
    confidence: 0,
    evidenceCount: 0,
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any HypothesisRepository
 * implementation. A future PostgresHypothesisRepository test file
 * should import and call this with its own factory.
 */
export function runHypothesisRepositoryContractTests(makeRepo: () => HypothesisRepository) {
  describe("HypothesisRepository contract", () => {
    it("returns undefined for a hypothesis that was never added", async () => {
      const repo = makeRepo();
      expect(await repo.get("missing")).toBeUndefined();
    });

    it("adds a hypothesis retrievable via get", async () => {
      const repo = makeRepo();
      await repo.add(makeHypothesis());
      expect(await repo.get("h1")).toEqual(makeHypothesis());
    });

    it("rejects a duplicate hypothesis id", async () => {
      const repo = makeRepo();
      await repo.add(makeHypothesis());
      await expect(repo.add(makeHypothesis())).rejects.toThrow(DuplicateHypothesisError);
    });

    it("getByRelatedEdgeId filters by edge and preserves insertion order", async () => {
      const repo = makeRepo();
      await repo.add(makeHypothesis({ id: "h1", relatedEdgeId: "e1" }));
      await repo.add(makeHypothesis({ id: "h2", relatedEdgeId: "e2" }));
      await repo.add(makeHypothesis({ id: "h3", relatedEdgeId: "e1" }));

      const forE1 = await repo.getByRelatedEdgeId("e1");
      expect(forE1.map((h) => h.id)).toEqual(["h1", "h3"]);
    });

    it("getByRelatedEdgeId returns an empty array for an unknown edge", async () => {
      const repo = makeRepo();
      expect(await repo.getByRelatedEdgeId("unknown")).toEqual([]);
    });

    it("mutating the object passed to add() does not affect the stored hypothesis", async () => {
      const repo = makeRepo();
      const original = makeHypothesis();
      await repo.add(original);
      original.statement = "mutated";
      expect((await repo.get("h1"))?.statement).toBe("sleep_duration causes mood_score");
    });

    it("mutating an object returned from get()/getByRelatedEdgeId() does not affect the stored hypothesis", async () => {
      const repo = makeRepo();
      await repo.add(makeHypothesis());

      const fetched = await repo.get("h1");
      if (fetched) fetched.statement = "mutated";
      const [fromQuery] = await repo.getByRelatedEdgeId("e1");
      fromQuery.statement = "mutated-again";

      expect((await repo.get("h1"))?.statement).toBe("sleep_duration causes mood_score");
    });

    describe("updateStatus", () => {
      it("throws UnknownHypothesisError for a hypothesis that does not exist", async () => {
        const repo = makeRepo();
        await expect(
          repo.updateStatus("missing", { status: "testing", confidence: 0.5, evidenceCount: 1 })
        ).rejects.toThrow(UnknownHypothesisError);
      });

      it("allows forming -> testing", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        const updated = await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        expect(updated.status).toBe("testing");
        expect(updated.confidence).toBe(0.2);
        expect(updated.evidenceCount).toBe(1);
      });

      it("allows forming -> unknown_competing with a competingHypothesisId", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        const updated = await repo.updateStatus("h1", {
          status: "unknown_competing",
          confidence: 0,
          evidenceCount: 0,
          competingHypothesisId: "h-other",
        });
        expect(updated.status).toBe("unknown_competing");
        expect(updated.competingHypothesisId).toBe("h-other");
      });

      it("allows testing -> confirmed", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        const updated = await repo.updateStatus("h1", { status: "confirmed", confidence: 0.8, evidenceCount: 3 });
        expect(updated.status).toBe("confirmed");
      });

      it("allows testing -> rejected", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        const updated = await repo.updateStatus("h1", { status: "rejected", confidence: 0.1, evidenceCount: 3 });
        expect(updated.status).toBe("rejected");
      });

      it("rejects forming -> confirmed (must pass through testing)", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await expect(
          repo.updateStatus("h1", { status: "confirmed", confidence: 0.8, evidenceCount: 3 })
        ).rejects.toThrow(InvalidHypothesisTransitionError);
      });

      it("rejects testing -> unknown_competing", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        await expect(
          repo.updateStatus("h1", { status: "unknown_competing", confidence: 0.2, evidenceCount: 1 })
        ).rejects.toThrow(InvalidHypothesisTransitionError);
      });

      it("rejects any transition out of a terminal status", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        await repo.updateStatus("h1", { status: "confirmed", confidence: 0.8, evidenceCount: 3 });
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: 0.8, evidenceCount: 3 })
        ).rejects.toThrow(InvalidHypothesisTransitionError);
      });

      it("rejects invalid confidence (out of range, NaN, Infinity)", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: 1.5, evidenceCount: 1 })
        ).rejects.toThrow(LearningInvalidConfidenceError);
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: NaN, evidenceCount: 1 })
        ).rejects.toThrow(LearningInvalidConfidenceError);
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: Infinity, evidenceCount: 1 })
        ).rejects.toThrow(LearningInvalidConfidenceError);
      });

      it("rejects invalid evidenceCount (negative, NaN, fractional)", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: -1 })
        ).rejects.toThrow(LearningInvalidEvidenceCountError);
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: NaN })
        ).rejects.toThrow(LearningInvalidEvidenceCountError);
        await expect(
          repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 2.5 })
        ).rejects.toThrow(LearningInvalidEvidenceCountError);
      });

      it("a failed validation does not modify the stored hypothesis", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        await expect(
          repo.updateStatus("h1", { status: "confirmed", confidence: 0.8, evidenceCount: 3 })
        ).rejects.toThrow(InvalidHypothesisTransitionError);
        expect(await repo.get("h1")).toEqual(makeHypothesis());
      });

      it("mutating an object returned from updateStatus() does not affect the stored hypothesis", async () => {
        const repo = makeRepo();
        await repo.add(makeHypothesis());
        const updated = await repo.updateStatus("h1", { status: "testing", confidence: 0.2, evidenceCount: 1 });
        updated.confidence = 0.99;
        expect((await repo.get("h1"))?.confidence).toBe(0.2);
      });
    });
  });
}
