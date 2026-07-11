import { Experiment, ExperimentCategory, ExperimentStatus, Hypothesis, KGEdge, UUID } from "../types";
import { Clock, IdGenerator } from "../application/types";
import { KnowledgeGraphService } from "../knowledge-graph/KnowledgeGraphService";
import { maturityRank } from "../knowledge-graph/CausalMaturityPolicy";
import { ExperimentRepository } from "./ExperimentRepository";
import { HypothesisRepository } from "./HypothesisRepository";
import {
  categoryRequiresExplicitConsent,
  resolveMaturityAfterConfirmedExperiment,
  StableCausalEvidenceSummary,
} from "./ExperimentPolicy";
import { ExperimentEvidenceInput, ExperimentEvaluationOutcome, evaluateExperimentEvidence } from "./EvidenceEvaluator";
import { UnknownExperimentError, UnknownHypothesisError } from "./errors";

export interface ProposeExperimentInput {
  hypothesisId: UUID;
  intervention: string;
  durationDays: number;
  singleVariable: boolean;
  baselinePeriodDays: number;
  successMetric: string;
  stopRule: string;
  washoutPeriodDays: number;
  category: ExperimentCategory;
}

export interface ExperimentEvaluationResult {
  outcome: ExperimentEvaluationOutcome;
  experiment: Experiment;
  hypothesis: Hypothesis;
  /** Only set when the outcome was "confirmed" and the related edge could be reinforced. */
  edge?: KGEdge;
}

/**
 * Thin orchestration layer over ExperimentRepository, HypothesisRepository,
 * and KnowledgeGraphService — the only place that constructs Experiment
 * ids/timestamps and the only place that connects a confirmed
 * experiment's result back to its Hypothesis and Knowledge Graph edge.
 * Nothing outside this service should call ExperimentRepository
 * directly.
 */
export class ExperimentService {
  constructor(
    private readonly experiments: ExperimentRepository,
    private readonly hypotheses: HypothesisRepository,
    private readonly knowledgeGraph: KnowledgeGraphService,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  /**
   * Proposes a new experiment at status "proposed". requiresExplicitConsent
   * is derived from category (never caller-supplied), so a health or
   * financial experiment can never be proposed without the consent gate
   * active — see ExperimentPolicy.categoryRequiresExplicitConsent().
   */
  async proposeExperiment(input: ProposeExperimentInput): Promise<Experiment> {
    const experiment: Experiment = {
      id: this.idGenerator.next(),
      hypothesisId: input.hypothesisId,
      intervention: input.intervention,
      durationDays: input.durationDays,
      singleVariable: input.singleVariable,
      baselinePeriodDays: input.baselinePeriodDays,
      successMetric: input.successMetric,
      stopRule: input.stopRule,
      washoutPeriodDays: input.washoutPeriodDays,
      category: input.category,
      requiresExplicitConsent: categoryRequiresExplicitConsent(input.category),
      consentGiven: false,
      status: "proposed",
      startedAt: null,
      endedAt: null,
    };
    await this.experiments.add(experiment);
    return experiment;
  }

  /** Moves the experiment to any structurally/consent-valid next status. Legality is enforced by the repository. */
  async advance(id: UUID, status: ExperimentStatus, options: { consentGiven?: boolean } = {}): Promise<Experiment> {
    return this.experiments.updateStatus(id, {
      status,
      timestamp: this.clock.now(),
      consentGiven: options.consentGiven,
    });
  }

  /** Aborts an experiment from any non-final status. */
  async abort(id: UUID, reason: string): Promise<Experiment> {
    return this.experiments.updateStatus(id, { status: "aborted", timestamp: this.clock.now(), reason });
  }

  /**
   * Evaluates an experiment already in status "evaluated" against its
   * evidence, transitions it to confirmed/rejected/inconclusive, and —
   * only on a confirmed outcome — updates the related Hypothesis and
   * reinforces the related Knowledge Graph edge's causal maturity per
   * the proof rules in ExperimentPolicy.ts. A single confirmed
   * experiment never promotes an edge past experimentally_supported
   * unless the edge was already there and the aggregate evidence
   * clears the stable_causal bar (qualifiesForStableCausal).
   */
  async evaluate(id: UUID, evidence: ExperimentEvidenceInput): Promise<ExperimentEvaluationResult> {
    const experiment = await this.getOrThrowExperiment(id);
    const outcome = evaluateExperimentEvidence(evidence);

    const updatedExperiment = await this.experiments.updateStatus(id, {
      status: outcome,
      timestamp: this.clock.now(),
    });

    const hypothesis = await this.hypotheses.get(experiment.hypothesisId);
    if (hypothesis === undefined) {
      throw new UnknownHypothesisError(experiment.hypothesisId);
    }

    let updatedHypothesis = hypothesis;
    let updatedEdge: KGEdge | undefined;

    if (outcome === "confirmed") {
      if (hypothesis.status === "testing") {
        updatedHypothesis = await this.hypotheses.updateStatus(hypothesis.id, {
          status: "confirmed",
          confidence: Math.min(1, hypothesis.confidence + 0.2),
          evidenceCount: hypothesis.evidenceCount + 1,
        });
      }
      updatedEdge = await this.reinforceEdgeAfterConfirmedExperiment(hypothesis, updatedExperiment);
    } else if (outcome === "rejected" && hypothesis.status === "testing") {
      updatedHypothesis = await this.hypotheses.updateStatus(hypothesis.id, {
        status: "rejected",
        confidence: hypothesis.confidence,
        evidenceCount: hypothesis.evidenceCount + 1,
      });
    }
    // inconclusive: neither the hypothesis nor the edge changes — insufficient
    // results don't move the causal claim in either direction.

    return { outcome, experiment: updatedExperiment, hypothesis: updatedHypothesis, edge: updatedEdge };
  }

  private async reinforceEdgeAfterConfirmedExperiment(
    hypothesis: Hypothesis,
    confirmedExperiment: Experiment
  ): Promise<KGEdge | undefined> {
    const edge = await this.knowledgeGraph.getEdge(hypothesis.relatedEdgeId);
    if (edge === undefined) {
      return undefined;
    }

    // Aggregate across every hypothesis tied to this edge, not just the one
    // that was just confirmed — the causal maturity belongs to the edge,
    // and separate hypotheses/experiments can each contribute evidence
    // toward the same causal claim.
    const relatedHypotheses = await this.hypotheses.getByRelatedEdgeId(hypothesis.relatedEdgeId);
    const confirmedExperiments = (
      await Promise.all(relatedHypotheses.map((h) => this.experiments.findByHypothesisId(h.id)))
    )
      .flat()
      .filter((e) => e.status === "confirmed");
    const competingHypothesis =
      hypothesis.competingHypothesisId !== null
        ? await this.hypotheses.get(hypothesis.competingHypothesisId)
        : undefined;

    const summary: StableCausalEvidenceSummary = {
      confirmedExperimentCount: confirmedExperiments.length,
      totalConfirmedDays: confirmedExperiments.reduce((sum, e) => sum + e.durationDays, 0),
      allConfirmedConsistent: true,
      hasStrongCompetingHypothesis: competingHypothesis !== undefined && competingHypothesis.status !== "rejected",
    };

    const targetMaturity = resolveMaturityAfterConfirmedExperiment(edge.causalMaturity, summary);
    const rankDelta = maturityRank(targetMaturity) - maturityRank(edge.causalMaturity);

    return this.knowledgeGraph.reinforceEdge(
      edge.id,
      targetMaturity,
      Math.min(1, edge.confidence + 0.2),
      edge.evidenceCount + 1,
      rankDelta > 1
        ? {
            overrideMaturityTransition: true,
            reason: `confirmed experiment ${confirmedExperiment.id} for hypothesis ${hypothesis.id}`,
          }
        : undefined
    );
  }

  async get(id: UUID): Promise<Experiment | undefined> {
    return this.experiments.get(id);
  }

  async findByHypothesisId(hypothesisId: UUID): Promise<Experiment[]> {
    return this.experiments.findByHypothesisId(hypothesisId);
  }

  private async getOrThrowExperiment(id: UUID): Promise<Experiment> {
    const experiment = await this.experiments.get(id);
    if (experiment === undefined) {
      throw new UnknownExperimentError(id);
    }
    return experiment;
  }
}
