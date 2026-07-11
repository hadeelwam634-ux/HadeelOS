import { describe, it, expect } from "vitest";
import { ExperimentService, ProposeExperimentInput } from "../../src/learning/ExperimentService";
import { HypothesisService } from "../../src/learning/HypothesisService";
import { InMemoryExperimentRepository } from "../../src/learning/InMemoryExperimentRepository";
import { InMemoryHypothesisRepository } from "../../src/learning/InMemoryHypothesisRepository";
import { KnowledgeGraphService } from "../../src/knowledge-graph/KnowledgeGraphService";
import { InMemoryKnowledgeGraphRepository } from "../../src/knowledge-graph/InMemoryKnowledgeGraphRepository";
import { ConsentRequiredError, ExperimentImmutableError, MissingExperimentGuardrailError } from "../../src/learning/errors";
import { Clock, IdGenerator } from "../../src/application/types";
import { UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class FakeClock implements Clock {
  private current = new Date("2026-07-11T06:00:00Z").getTime();
  now(): string {
    const ts = new Date(this.current).toISOString();
    this.current += 60 * 60 * 1000; // advance an hour on every read, so successive calls differ
    return ts;
  }
}

async function makeHarness() {
  const kgRepo = new InMemoryKnowledgeGraphRepository();
  const knowledgeGraph = new KnowledgeGraphService(kgRepo, new FakeIdGenerator(), new FakeClock());
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const hypotheses = new HypothesisService(hypothesisRepo, new FakeIdGenerator());
  const experimentRepo = new InMemoryExperimentRepository();
  const experiments = new ExperimentService(
    experimentRepo,
    hypothesisRepo,
    knowledgeGraph,
    new FakeIdGenerator(),
    new FakeClock()
  );

  const nodeA = await knowledgeGraph.recordNode("sleep");
  const nodeB = await knowledgeGraph.recordNode("mood");
  const edge = await knowledgeGraph.recordEdge({
    fromNodeId: nodeA.id,
    toNodeId: nodeB.id,
    recordType: "Observation",
    directionBasis: "temporal_precedence",
  });
  const hypothesis = await hypotheses.formHypothesis({
    statement: "sleep_duration causes mood_score",
    relatedEdgeId: edge.id,
  });
  await hypotheses.beginTesting(hypothesis.id);

  return { knowledgeGraph, kgRepo, hypotheses, hypothesisRepo, experiments, experimentRepo, edge, hypothesis };
}

function baseExperimentInput(hypothesisId: UUID, overrides: Partial<ProposeExperimentInput> = {}): ProposeExperimentInput {
  return {
    hypothesisId,
    intervention: "10pm lights out",
    durationDays: 5,
    singleVariable: true,
    baselinePeriodDays: 3,
    successMetric: "mood_score improves by >= 0.5",
    stopRule: "abort if sleep_duration drops below 5 hours for 2 nights",
    washoutPeriodDays: 2,
    category: "behavioral",
    ...overrides,
  };
}

async function runToEvaluated(experiments: ExperimentService, id: UUID, options: { consentGiven?: boolean } = {}) {
  const experiment = await experiments.get(id);
  if (experiment?.category === "health" || experiment?.category === "financial") {
    await experiments.advance(id, "awaiting_consent");
    await experiments.advance(id, "baseline", { consentGiven: true });
  } else {
    await experiments.advance(id, "baseline");
  }
  await experiments.advance(id, "running");
  await experiments.advance(id, "washout");
  await experiments.advance(id, "evaluated");
}

describe("ExperimentService", () => {
  it("proposeExperiment derives requiresExplicitConsent from category and rejects missing guardrails", async () => {
    const { experiments, hypothesis } = await makeHarness();
    const behavioral = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    expect(behavioral.requiresExplicitConsent).toBe(false);
    expect(behavioral.consentGiven).toBe(false);
    expect(behavioral.status).toBe("proposed");

    const health = await experiments.proposeExperiment(
      baseExperimentInput(hypothesis.id, { category: "health" })
    );
    expect(health.requiresExplicitConsent).toBe(true);

    await expect(
      experiments.proposeExperiment(baseExperimentInput(hypothesis.id, { stopRule: "" }))
    ).rejects.toThrow(MissingExperimentGuardrailError);
    await expect(
      experiments.proposeExperiment(baseExperimentInput(hypothesis.id, { baselinePeriodDays: 0 }))
    ).rejects.toThrow(MissingExperimentGuardrailError);
  });

  it("enforces consent: a health experiment cannot start (enter baseline) before explicit consent", async () => {
    const { experiments, hypothesis } = await makeHarness();
    const experiment = await experiments.proposeExperiment(
      baseExperimentInput(hypothesis.id, { category: "health" })
    );

    await expect(experiments.advance(experiment.id, "baseline")).rejects.toThrow(ConsentRequiredError);

    await experiments.advance(experiment.id, "awaiting_consent");
    await expect(experiments.advance(experiment.id, "baseline")).rejects.toThrow(ConsentRequiredError);

    const started = await experiments.advance(experiment.id, "baseline", { consentGiven: true });
    expect(started.status).toBe("baseline");
    expect(started.consentGiven).toBe(true);
  });

  it("abort works from any non-final status and the experiment becomes immutable afterward", async () => {
    const { experiments, hypothesis } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    const aborted = await experiments.abort(experiment.id, "no longer relevant");
    expect(aborted.status).toBe("aborted");
    await expect(experiments.advance(experiment.id, "baseline")).rejects.toThrow(ExperimentImmutableError);
  });

  it("evaluate with insufficient evidence produces inconclusive and leaves hypothesis/edge unchanged", async () => {
    const { experiments, hypotheses, knowledgeGraph, hypothesis, edge } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    await runToEvaluated(experiments, experiment.id);

    const result = await experiments.evaluate(experiment.id, { effectObserved: true, metricMet: false });
    expect(result.outcome).toBe("inconclusive");
    expect(result.experiment.status).toBe("inconclusive");
    expect(result.experiment.endedAt).not.toBeNull();

    const unchangedHypothesis = await hypotheses.get(hypothesis.id);
    expect(unchangedHypothesis?.status).toBe("testing");
    const unchangedEdge = await knowledgeGraph.getEdge(edge.id);
    expect(unchangedEdge?.causalMaturity).toBe("correlated");
  });

  it("evaluate with no observed effect produces rejected and moves the hypothesis to rejected", async () => {
    const { experiments, hypotheses, hypothesis } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    await runToEvaluated(experiments, experiment.id);

    const result = await experiments.evaluate(experiment.id, { effectObserved: false, metricMet: false });
    expect(result.outcome).toBe("rejected");
    const updatedHypothesis = await hypotheses.get(hypothesis.id);
    expect(updatedHypothesis?.status).toBe("rejected");
  });

  it("a single confirmed experiment updates KG maturity to experimentally_supported, never higher", async () => {
    const { experiments, knowledgeGraph, hypothesis, edge } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    await runToEvaluated(experiments, experiment.id);

    const result = await experiments.evaluate(experiment.id, { effectObserved: true, metricMet: true });
    expect(result.outcome).toBe("confirmed");
    expect(result.hypothesis.status).toBe("confirmed");
    expect(result.edge?.causalMaturity).toBe("experimentally_supported");

    const storedEdge = await knowledgeGraph.getEdge(edge.id);
    expect(storedEdge?.causalMaturity).toBe("experimentally_supported");
  });

  it("does not promote to stable_causal from a single confirmed experiment (no excessive causal promotion)", async () => {
    const { experiments, knowledgeGraph, hypothesis, edge } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    await runToEvaluated(experiments, experiment.id);
    await experiments.evaluate(experiment.id, { effectObserved: true, metricMet: true });

    const storedEdge = await knowledgeGraph.getEdge(edge.id);
    expect(storedEdge?.causalMaturity).not.toBe("stable_causal");
  });

  it("reaches stable_causal only once enough confirmed experiments and days accumulate", async () => {
    const { experiments, hypotheses, knowledgeGraph, hypothesis, edge } = await makeHarness();

    // First confirmed experiment: correlated -> experimentally_supported.
    const first = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id, { durationDays: 5 }));
    await runToEvaluated(experiments, first.id);
    await experiments.evaluate(first.id, { effectObserved: true, metricMet: true });
    expect((await knowledgeGraph.getEdge(edge.id))?.causalMaturity).toBe("experimentally_supported");

    // Two more confirmed experiments against a *new* hypothesis.beginTesting cycle each time,
    // accumulating enough confirmed experiments/days for the same edge.
    for (let i = 0; i < 2; i++) {
      const h = await hypotheses.formHypothesis({
        statement: `reinforcement ${i}`,
        relatedEdgeId: edge.id,
      });
      await hypotheses.beginTesting(h.id);
      const exp = await experiments.proposeExperiment(baseExperimentInput(h.id, { durationDays: 10 }));
      await runToEvaluated(experiments, exp.id);
      await experiments.evaluate(exp.id, { effectObserved: true, metricMet: true });
    }

    const finalEdge = await knowledgeGraph.getEdge(edge.id);
    expect(finalEdge?.causalMaturity).toBe("stable_causal");
  });

  it("stable_causal is blocked while an unresolved competing hypothesis exists", async () => {
    const { experiments, hypotheses, knowledgeGraph, edge } = await makeHarness();

    const rival = await hypotheses.formHypothesis({ statement: "rival explanation", relatedEdgeId: edge.id });
    const withRival = await hypotheses.formHypothesis({
      statement: "sleep_duration causes mood_score (v2)",
      relatedEdgeId: edge.id,
      competingHypothesisId: rival.id,
    });
    await hypotheses.beginTesting(withRival.id);

    for (let i = 0; i < 3; i++) {
      const exp = await experiments.proposeExperiment(baseExperimentInput(withRival.id, { durationDays: 10 }));
      await runToEvaluated(experiments, exp.id);
      await experiments.evaluate(exp.id, { effectObserved: true, metricMet: true });
    }

    const finalEdge = await knowledgeGraph.getEdge(edge.id);
    expect(finalEdge?.causalMaturity).toBe("experimentally_supported");
    expect(finalEdge?.causalMaturity).not.toBe("stable_causal");
  });

  it("cloning: mutating a returned experiment/hypothesis/edge does not affect stored state", async () => {
    const { experiments, hypotheses, knowledgeGraph, hypothesis, edge } = await makeHarness();
    const experiment = await experiments.proposeExperiment(baseExperimentInput(hypothesis.id));
    await runToEvaluated(experiments, experiment.id);
    const result = await experiments.evaluate(experiment.id, { effectObserved: true, metricMet: true });

    result.experiment.status = "aborted";
    result.hypothesis.status = "forming";
    if (result.edge) result.edge.causalMaturity = "stable_causal";

    expect((await experiments.get(experiment.id))?.status).toBe("confirmed");
    expect((await hypotheses.get(hypothesis.id))?.status).toBe("confirmed");
    expect((await knowledgeGraph.getEdge(edge.id))?.causalMaturity).toBe("experimentally_supported");
  });
});
