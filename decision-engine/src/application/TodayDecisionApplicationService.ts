import {
  CausalMaturity,
  ConfidenceQualifier,
  Decision,
  DecisionAlternative,
  DigitalTwinSourceVersions,
  KnownSignalType,
  MemoryRecord,
  SignalStore,
  SignalType,
  UUID,
} from "../types";
import { HistoricalAccuracyInput, qualifierFor } from "../confidence";
import { recalc } from "../recalc";
import { SignalStoreRepository } from "../persistence/SignalStoreRepository";
import { EventLogRepository } from "../persistence/EventLogRepository";
import { DigitalTwinService } from "../twin/DigitalTwinService";
import { MemoryMapService } from "../memory/MemoryMapService";
import { MemoryGovernanceService } from "../memory/MemoryGovernanceService";
import { KnowledgeGraphService } from "../knowledge-graph/KnowledgeGraphService";
import { HypothesisService } from "../learning/HypothesisService";
import {
  KnowledgeGraphEdgeSummary,
  KnowledgeGraphSnapshot,
  runCounterfactualEngine,
} from "../counterfactual";
import { Clock, IdGenerator } from "./types";
import {
  EventLogPersistenceError,
  RecalcExecutionError,
  SignalPersistenceError,
  TodayOrchestrationError,
} from "./errors";

/**
 * Mirrors KnownSignalType in ../types.ts. TypeScript unions aren't
 * runtime-inspectable, so this list has to be kept in sync by hand
 * whenever KnownSignalType changes — it exists only to compute
 * TodayDecisionResult.context.missingSignals. `custom:${string}`
 * signals are intentionally excluded: "missing" only makes sense for
 * signals the system knows to expect.
 */
const KNOWN_SIGNAL_TYPES: readonly KnownSignalType[] = [
  "sleep_duration",
  "sleep_quality",
  "cycle_day",
  "meeting_count",
  "weather_temp",
  "task_completion",
  "mood_score",
];

export interface RunTodayCommand {
  userId: UUID;
  /** Live SignalStore updates since the last run. */
  signalStoreDelta: SignalStore;
  /** Mutually exclusive options for today's recommendation — see Scenario.ts. */
  candidateDecisions: Decision[];
  /** Decisions the user has already accepted in earlier interactions — feeds recalc()'s forecast/timeline movement, same as v1. */
  previouslyAcceptedDecisions: Decision[];
  accuracyByDecisionType: Record<string, HistoricalAccuracyInput>;
  baselineForecast: { completion: number; capacity: number };
  sourceVersions: DigitalTwinSourceVersions;
}

export interface TodayDecisionResult {
  context: {
    signalCount: number;
    missingSignals: SignalType[];
    generatedAt: string;
    graphVersion: string | null;
    twinDerivedAt: string;
  };
  decision: Decision | null;
  confidence: {
    score: number;
    qualifier: ConfidenceQualifier;
    contributors: Array<{
      name: string;
      contribution: number;
      sourceConfidence: number;
    }>;
  };
  alternatives: DecisionAlternative[];
  forecast: {
    completion: number;
    capacity: number;
    stress: number;
  };
  timelineOrder: string[];
  memoryUpdates: UUID[];
  activeHypotheses: UUID[];
  uncertainty: {
    isUncertain: boolean;
    reason?: string;
    margin?: number;
  };
}

/**
 * Decision Orchestration v2 ("Final Execution Orders" PR #8). Connects
 * every module built so far into the full path:
 *
 *   Signals -> Signal Store -> Digital Twin -> Knowledge Graph ->
 *   Hypotheses/Experiments -> Counterfactual Engine -> Decision ->
 *   recalc() -> Event Log -> Memory Updates
 *
 * This does NOT replace DecisionApplicationService (PR #3) — that
 * class is untouched and still valid for its original, narrower job
 * (recalculating forecast/timeline from a set of already-accepted
 * decisions). TodayDecisionApplicationService is a new, separate v2
 * service that additionally decides *which* decision to propose today
 * in the first place, via the Counterfactual Engine. Both can coexist;
 * nothing about this class silently changes DecisionApplicationService's
 * behavior.
 *
 * Ordering rules enforced by this method:
 *   - No EventLogEntry is written before Digital Twin derivation,
 *     Knowledge Graph reads, and the Counterfactual Engine have all
 *     succeeded.
 *   - No EventLogEntry and no memory writes happen when the result is
 *     `decision: null` (either because there were no candidates, or
 *     because the Counterfactual Engine reported uncertainty) — an
 *     unmade decision has nothing to log or reinforce memory from.
 *   - Not atomic (same caveat as DecisionApplicationService v1): the
 *     Event Log append and the per-memory decay loop are separate
 *     repository calls; a failure partway through the decay loop
 *     leaves earlier iterations' writes persisted. True atomicity
 *     needs a real transaction boundary, deferred to the PostgreSQL
 *     adapter PR.
 */
export class TodayDecisionApplicationService {
  constructor(
    private readonly signalStoreRepository: SignalStoreRepository,
    private readonly eventLogRepository: EventLogRepository,
    private readonly digitalTwinService: DigitalTwinService,
    private readonly memoryMapService: MemoryMapService,
    private readonly memoryGovernanceService: MemoryGovernanceService,
    private readonly knowledgeGraphService: KnowledgeGraphService,
    private readonly hypothesisService: HypothesisService,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async runToday(command: RunTodayCommand): Promise<TodayDecisionResult> {
    const effectiveSignalStore = await this.persistAndReadSignals(command.signalStoreDelta);

    const missingSignals = KNOWN_SIGNAL_TYPES.filter(
      (type) => effectiveSignalStore[type] === undefined
    );
    const signalCount = Object.keys(effectiveSignalStore).length;

    let knownMemories: MemoryRecord[];
    let twinDerivedAt: string;
    let twin;
    try {
      knownMemories = await this.memoryMapService.getKnownMemories(command.userId);
      twin = await this.digitalTwinService.deriveAndPersist({
        userId: command.userId,
        signalStore: effectiveSignalStore,
        memories: knownMemories,
        sourceVersions: command.sourceVersions,
      });
      twinDerivedAt = twin.derivedAt;
    } catch (cause) {
      throw new TodayOrchestrationError("Failed to derive today's Digital Twin.", cause);
    }

    let graph: KnowledgeGraphSnapshot;
    let activeHypotheses: UUID[];
    try {
      const built = await this.buildGraphSnapshotAndHypotheses(command.candidateDecisions);
      graph = built.graph;
      activeHypotheses = built.activeHypotheses;
    } catch (cause) {
      throw new TodayOrchestrationError("Failed to read the Knowledge Graph.", cause);
    }

    const counterfactual = runCounterfactualEngine({
      twin,
      signals: effectiveSignalStore,
      candidateDecisions: command.candidateDecisions,
      graph,
      historicalAccuracy: command.accuracyByDecisionType,
      baselineForecast: command.baselineForecast,
    });

    let recalculation;
    try {
      recalculation = recalc({
        acceptedDecisions: command.previouslyAcceptedDecisions,
        twin,
        currentSignalStore: effectiveSignalStore,
        signalStoreDelta: {},
        accuracyByDecisionType: command.accuracyByDecisionType,
        causalMaturityByDecisionType: this.strongestMaturityByType(graph),
        baselineForecast: command.baselineForecast,
      });
    } catch (cause) {
      // Nothing has been written to the Event Log or Memory yet.
      throw new RecalcExecutionError(cause);
    }

    const selected = counterfactual.selectedScenario;
    const decision = selected
      ? (command.candidateDecisions.find((d) => d.id === selected.decisionIds[0]) ?? null)
      : null;

    const alternatives: DecisionAlternative[] = counterfactual.alternatives.map((alt) => {
      const altDecision = command.candidateDecisions.find((d) => d.id === alt.decisionIds[0]);
      const reasons = counterfactual.explanation.rejectedBecause[alt.id] ?? [];
      return {
        action: altDecision?.proposedAction ?? alt.id,
        predictedSuccess: alt.completionProbability,
        rejectionReason: reasons.join("; "),
      };
    });

    const confidenceScore = selected
      ? selected.completionProbability * 0.5 + selected.capacityProbability * 0.5
      : 0;

    // "لا قرار عند missing critical inputs" / "عند uncertainty: لا اختيار
    // إجباري" — a null decision writes nothing: no Event Log entry, no
    // memory maintenance. There is nothing to log or reinforce from a
    // recommendation that was never actually made.
    const eventLogEntryIds: UUID[] = [];
    const memoryUpdates: UUID[] = [];
    if (decision !== null) {
      try {
        const entryId = this.idGenerator.next();
        await this.eventLogRepository.append({
          id: entryId,
          decisionId: decision.id,
          timestamp: this.clock.now(),
          signalsSnapshot: effectiveSignalStore,
          recommendation: {
            type: decision.type,
            proposedAction: decision.proposedAction,
            confidence: confidenceScore,
            context: {
              signalCount,
              missingSignals,
              graphVersion: command.sourceVersions.graphVersion,
              twinDerivedAt,
            },
            alternativeScenarios: counterfactual.alternatives,
          },
          userAction: "proposed",
          outcome: "pending",
          outcomeTimestamp: null,
          experimentId: null,
        });
        eventLogEntryIds.push(entryId);
      } catch (cause) {
        throw new EventLogPersistenceError(cause);
      }

      try {
        for (const memory of knownMemories) {
          const updated = await this.memoryGovernanceService.applyDecay(memory.id);
          if (updated !== null) memoryUpdates.push(updated.id);
        }
      } catch (cause) {
        throw new TodayOrchestrationError("Failed to apply memory decay.", cause);
      }
    }

    return {
      context: {
        signalCount,
        missingSignals,
        generatedAt: this.clock.now(),
        graphVersion: command.sourceVersions.graphVersion,
        twinDerivedAt,
      },
      decision,
      confidence: {
        score: confidenceScore,
        qualifier: qualifierFor(confidenceScore),
        contributors: selected
          ? selected.contributors.map((c) => ({
              name: c.source,
              contribution: c.contribution,
              sourceConfidence: c.confidence,
            }))
          : [],
      },
      alternatives,
      forecast: {
        completion: recalculation.forecast.completion,
        capacity: recalculation.forecast.capacity,
        stress: selected ? selected.stressEstimate : 0,
      },
      timelineOrder: recalculation.timelineOrder,
      memoryUpdates,
      activeHypotheses,
      uncertainty: counterfactual.uncertainty,
    };
  }

  private async persistAndReadSignals(delta: SignalStore): Promise<SignalStore> {
    const deltaEntries = Object.values(delta).filter((e) => e !== undefined);
    try {
      if (deltaEntries.length > 0) {
        await this.signalStoreRepository.upsertMany(deltaEntries);
      }
      return await this.signalStoreRepository.getAll();
    } catch (cause) {
      throw new SignalPersistenceError(cause);
    }
  }

  /**
   * Builds a plain KnowledgeGraphSnapshot (one entry per relevant edge,
   * per decision type) for the Counterfactual Engine, and collects the
   * ids of every Hypothesis still in status "testing" on one of those
   * edges — this is TodayDecisionResult.activeHypotheses. A decision
   * type maps to Knowledge Graph nodes via KGNode.domain === decision.type.
   */
  private async buildGraphSnapshotAndHypotheses(
    candidateDecisions: readonly Decision[]
  ): Promise<{ graph: KnowledgeGraphSnapshot; activeHypotheses: UUID[] }> {
    const edgesByDecisionType: Record<string, KnowledgeGraphEdgeSummary[]> = {};
    const activeHypotheses: UUID[] = [];
    const seenTypes = new Set<string>();
    const seenHypothesisIds = new Set<UUID>();

    for (const decision of candidateDecisions) {
      if (seenTypes.has(decision.type)) continue;
      seenTypes.add(decision.type);

      const nodes = await this.knowledgeGraphService.getNodesByDomain(decision.type);
      const summaries: KnowledgeGraphEdgeSummary[] = [];

      for (const node of nodes) {
        const [outgoing, incoming] = await Promise.all([
          this.knowledgeGraphService.findEdgesFrom(node.id),
          this.knowledgeGraphService.findEdgesTo(node.id),
        ]);

        for (const edge of [...outgoing, ...incoming]) {
          summaries.push({
            decisionType: decision.type,
            causalMaturity: edge.causalMaturity,
            confidence: edge.confidence,
          });

          const hypotheses = await this.hypothesisService.getByRelatedEdgeId(edge.id);
          for (const hypothesis of hypotheses) {
            if (hypothesis.status === "testing" && !seenHypothesisIds.has(hypothesis.id)) {
              seenHypothesisIds.add(hypothesis.id);
              activeHypotheses.push(hypothesis.id);
            }
          }
        }
      }

      if (summaries.length > 0) {
        edgesByDecisionType[decision.type] = summaries;
      }
    }

    return { graph: { edgesByDecisionType }, activeHypotheses };
  }

  /**
   * Reduces a KnowledgeGraphSnapshot to the shape recalc() still
   * expects (one CausalMaturity per decision type — the strongest one
   * present, same "pick the best edge" rule ScenarioEvaluator uses).
   * recalc()'s acceptedDecisions here are *previously* accepted
   * decisions, so this look-up is keyed by their types too.
   */
  private strongestMaturityByType(
    graph: KnowledgeGraphSnapshot
  ): Record<string, CausalMaturity | null> {
    const result: Record<string, CausalMaturity | null> = {};
    const rank: Record<string, number> = {
      correlated: 0,
      suspected_causal: 1,
      experimentally_supported: 2,
      stable_causal: 3,
    };
    for (const [type, edges] of Object.entries(graph.edgesByDecisionType)) {
      let best: CausalMaturity | null = null;
      for (const edge of edges) {
        if (best === null || rank[edge.causalMaturity] > rank[best]) {
          best = edge.causalMaturity;
        }
      }
      result[type] = best;
    }
    return result;
  }
}
