import { Experiment, UUID } from "../types";
import { clone } from "../persistence/clone";
import { assertValidExperimentTransition, isFinalExperimentStatus } from "./ExperimentStateMachine";
import { assertConsentGuardrails, assertExperimentGuardrails } from "./ExperimentPolicy";
import { DuplicateExperimentError, ExperimentImmutableError, UnknownExperimentError } from "./errors";
import { ExperimentRepository, UpdateExperimentStatusInput } from "./ExperimentRepository";

/**
 * In-memory implementation of ExperimentRepository. Deep-clones
 * (structuredClone, via ../persistence/clone) at every read/write
 * boundary, and is the final enforcement point for both the purely
 * structural lifecycle (ExperimentStateMachine) and the consent
 * guardrail (ExperimentPolicy) — mirroring how
 * InMemoryKnowledgeGraphRepository enforces CausalMaturityPolicy
 * itself rather than trusting the caller to have already checked it.
 */
export class InMemoryExperimentRepository implements ExperimentRepository {
  private experiments = new Map<UUID, Experiment>();
  private insertionOrder: UUID[] = [];

  async add(experiment: Experiment): Promise<void> {
    if (this.experiments.has(experiment.id)) {
      throw new DuplicateExperimentError(experiment.id);
    }
    assertExperimentGuardrails(experiment);
    this.experiments.set(experiment.id, clone(experiment));
    this.insertionOrder.push(experiment.id);
  }

  async get(id: UUID): Promise<Experiment | undefined> {
    const experiment = this.experiments.get(id);
    return experiment === undefined ? undefined : clone(experiment);
  }

  async findByHypothesisId(hypothesisId: UUID): Promise<Experiment[]> {
    const result: Experiment[] = [];
    for (const id of this.insertionOrder) {
      const experiment = this.experiments.get(id)!;
      if (experiment.hypothesisId === hypothesisId) result.push(clone(experiment));
    }
    return result;
  }

  async updateStatus(id: UUID, input: UpdateExperimentStatusInput): Promise<Experiment> {
    const existing = this.experiments.get(id);
    if (existing === undefined) {
      throw new UnknownExperimentError(id);
    }
    if (isFinalExperimentStatus(existing.status)) {
      throw new ExperimentImmutableError(id, existing.status);
    }

    assertValidExperimentTransition(existing.status, input.status);
    assertConsentGuardrails(existing, existing.status, input.status, input.consentGiven ?? existing.consentGiven);

    const enteringBaselineForFirstTime = input.status === "baseline" && existing.startedAt === null;
    const enteringFinalStatus = isFinalExperimentStatus(input.status);

    const updated: Experiment = {
      ...existing,
      status: input.status,
      consentGiven: input.consentGiven ?? existing.consentGiven,
      startedAt: enteringBaselineForFirstTime ? input.timestamp : existing.startedAt,
      endedAt: enteringFinalStatus ? input.timestamp : existing.endedAt,
    };
    this.experiments.set(id, clone(updated));
    return clone(updated);
  }
}
