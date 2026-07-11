import { describe, it, expect } from "vitest";
import { Experiment } from "../../src/types";
import { ExperimentRepository } from "../../src/learning/ExperimentRepository";
import {
  ConsentRequiredError,
  DuplicateExperimentError,
  ExperimentImmutableError,
  InvalidExperimentTransitionError,
  MissingExperimentGuardrailError,
  UnknownExperimentError,
} from "../../src/learning/errors";

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "x1",
    hypothesisId: "h1",
    intervention: "10pm lights out",
    durationDays: 14,
    singleVariable: true,
    baselinePeriodDays: 7,
    successMetric: "mood_score improves by >= 0.5",
    stopRule: "abort if sleep_duration drops below 5 hours for 2 nights",
    washoutPeriodDays: 3,
    category: "behavioral",
    requiresExplicitConsent: false,
    consentGiven: false,
    status: "proposed",
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any ExperimentRepository
 * implementation. A future PostgresExperimentRepository test file
 * should import and call this with its own factory.
 */
export function runExperimentRepositoryContractTests(makeRepo: () => ExperimentRepository) {
  describe("ExperimentRepository contract", () => {
    it("returns undefined for an experiment that was never added", async () => {
      const repo = makeRepo();
      expect(await repo.get("missing")).toBeUndefined();
    });

    it("adds an experiment retrievable via get", async () => {
      const repo = makeRepo();
      await repo.add(makeExperiment());
      expect(await repo.get("x1")).toEqual(makeExperiment());
    });

    it("rejects a duplicate experiment id", async () => {
      const repo = makeRepo();
      await repo.add(makeExperiment());
      await expect(repo.add(makeExperiment())).rejects.toThrow(DuplicateExperimentError);
    });

    it("rejects missing/invalid guardrail fields at proposal time", async () => {
      const repo = makeRepo();
      await expect(repo.add(makeExperiment({ hypothesisId: "" }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ intervention: "" }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ durationDays: 0 }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ baselinePeriodDays: 0 }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ successMetric: "" }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ stopRule: "" }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
      await expect(repo.add(makeExperiment({ washoutPeriodDays: -1 }))).rejects.toThrow(
        MissingExperimentGuardrailError
      );
    });

    it("findByHypothesisId filters and preserves insertion order", async () => {
      const repo = makeRepo();
      await repo.add(makeExperiment({ id: "x1", hypothesisId: "h1" }));
      await repo.add(makeExperiment({ id: "x2", hypothesisId: "h2" }));
      await repo.add(makeExperiment({ id: "x3", hypothesisId: "h1" }));

      const forH1 = await repo.findByHypothesisId("h1");
      expect(forH1.map((e) => e.id)).toEqual(["x1", "x3"]);
    });

    it("findByHypothesisId returns an empty array for an unknown hypothesis", async () => {
      const repo = makeRepo();
      expect(await repo.findByHypothesisId("unknown")).toEqual([]);
    });

    it("mutating the object passed to add() does not affect the stored experiment", async () => {
      const repo = makeRepo();
      const original = makeExperiment();
      await repo.add(original);
      original.intervention = "mutated";
      expect((await repo.get("x1"))?.intervention).toBe("10pm lights out");
    });

    it("mutating an object returned from get()/findByHypothesisId() does not affect the stored experiment", async () => {
      const repo = makeRepo();
      await repo.add(makeExperiment());

      const fetched = await repo.get("x1");
      if (fetched) fetched.intervention = "mutated";
      const [fromQuery] = await repo.findByHypothesisId("h1");
      fromQuery.intervention = "mutated-again";

      expect((await repo.get("x1"))?.intervention).toBe("10pm lights out");
    });

    describe("updateStatus", () => {
      it("throws UnknownExperimentError for an experiment that does not exist", async () => {
        const repo = makeRepo();
        await expect(
          repo.updateStatus("missing", { status: "awaiting_consent", timestamp: "2026-07-11T00:00:00Z" })
        ).rejects.toThrow(UnknownExperimentError);
      });

      it("allows proposed -> awaiting_consent -> baseline (with consent) -> running -> washout -> evaluated", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await repo.updateStatus("x1", { status: "awaiting_consent", timestamp: "2026-07-11T00:00:00Z" });
        const baseline = await repo.updateStatus("x1", {
          status: "baseline",
          timestamp: "2026-07-11T01:00:00Z",
          consentGiven: true,
        });
        expect(baseline.status).toBe("baseline");
        expect(baseline.consentGiven).toBe(true);
        expect(baseline.startedAt).toBe("2026-07-11T01:00:00Z");

        await repo.updateStatus("x1", { status: "running", timestamp: "2026-07-11T02:00:00Z" });
        await repo.updateStatus("x1", { status: "washout", timestamp: "2026-07-11T03:00:00Z" });
        const evaluated = await repo.updateStatus("x1", { status: "evaluated", timestamp: "2026-07-11T04:00:00Z" });
        expect(evaluated.status).toBe("evaluated");
      });

      it("allows proposed -> baseline directly for a category that does not require consent", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment({ category: "behavioral" }));
        const updated = await repo.updateStatus("x1", { status: "baseline", timestamp: "2026-07-11T00:00:00Z" });
        expect(updated.status).toBe("baseline");
        expect(updated.startedAt).toBe("2026-07-11T00:00:00Z");
      });

      it("rejects proposed -> baseline directly for health/financial categories", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment({ category: "health", requiresExplicitConsent: true }));
        await expect(
          repo.updateStatus("x1", { status: "baseline", timestamp: "2026-07-11T00:00:00Z" })
        ).rejects.toThrow(ConsentRequiredError);

        await repo.add(makeExperiment({ id: "x2", category: "financial", requiresExplicitConsent: true }));
        await expect(
          repo.updateStatus("x2", { status: "baseline", timestamp: "2026-07-11T00:00:00Z" })
        ).rejects.toThrow(ConsentRequiredError);
      });

      it("rejects awaiting_consent -> baseline without consentGiven: true", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await repo.updateStatus("x1", { status: "awaiting_consent", timestamp: "2026-07-11T00:00:00Z" });
        await expect(
          repo.updateStatus("x1", { status: "baseline", timestamp: "2026-07-11T01:00:00Z" })
        ).rejects.toThrow(ConsentRequiredError);
      });

      it("rejects a structurally invalid transition (skipping states)", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await expect(
          repo.updateStatus("x1", { status: "running", timestamp: "2026-07-11T00:00:00Z" })
        ).rejects.toThrow(InvalidExperimentTransitionError);
      });

      it("allows aborting from any non-final status", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        const aborted = await repo.updateStatus("x1", {
          status: "aborted",
          timestamp: "2026-07-11T00:00:00Z",
          reason: "no longer relevant",
        });
        expect(aborted.status).toBe("aborted");
        expect(aborted.endedAt).toBe("2026-07-11T00:00:00Z");
      });

      it("rejects any update once an experiment has reached a final status (immutable)", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await repo.updateStatus("x1", { status: "aborted", timestamp: "2026-07-11T00:00:00Z" });
        await expect(
          repo.updateStatus("x1", { status: "baseline", timestamp: "2026-07-11T01:00:00Z" })
        ).rejects.toThrow(ExperimentImmutableError);
      });

      it("sets endedAt when reaching confirmed/rejected/inconclusive", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await repo.updateStatus("x1", { status: "baseline", timestamp: "t0" });
        await repo.updateStatus("x1", { status: "running", timestamp: "t1" });
        await repo.updateStatus("x1", { status: "washout", timestamp: "t2" });
        await repo.updateStatus("x1", { status: "evaluated", timestamp: "t3" });
        const confirmed = await repo.updateStatus("x1", { status: "confirmed", timestamp: "t4" });
        expect(confirmed.endedAt).toBe("t4");
      });

      it("a failed validation does not modify the stored experiment", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        await expect(
          repo.updateStatus("x1", { status: "running", timestamp: "2026-07-11T00:00:00Z" })
        ).rejects.toThrow(InvalidExperimentTransitionError);
        expect(await repo.get("x1")).toEqual(makeExperiment());
      });

      it("mutating an object returned from updateStatus() does not affect the stored experiment", async () => {
        const repo = makeRepo();
        await repo.add(makeExperiment());
        const updated = await repo.updateStatus("x1", { status: "baseline", timestamp: "2026-07-11T00:00:00Z" });
        updated.status = "running";
        expect((await repo.get("x1"))?.status).toBe("baseline");
      });
    });
  });
}
