import { MemoryRecord, MemoryState, UUID } from "../types";
import { Clock, IdGenerator } from "../application/types";
import { MemoryRepository } from "./MemoryRepository";
import { evaluateDecay } from "./MemoryDecayPolicy";
import { UnknownMemoryRecordError } from "./errors";

/**
 * Every state-transitioning action a memory can undergo — promotion,
 * correction, forgetting, blocking, decay, contradiction, and the
 * source-quality demotions — lives here, as the only orchestration
 * boundary allowed to call MemoryRepository.updateState()/add()
 * (MemoryMapService is the read-only counterpart). Every method
 * constructs its own governanceRecordId (via the injected
 * IdGenerator) and timestamp (via the injected Clock), so the
 * repository itself never has to.
 */
export class MemoryGovernanceService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  /** Creates a brand-new memory at state "Missing" — nothing is known yet. */
  async createMemory(userId: UUID, key: string): Promise<MemoryRecord> {
    const memory: MemoryRecord = {
      id: this.idGenerator.next(),
      userId,
      key,
      state: "Missing",
      value: null,
      confidence: 0,
      evidenceCount: 0,
      lastReinforcedAt: this.clock.now(),
      blocked: false,
    };
    await this.repository.add(memory);
    return memory;
  }

  /**
   * Records one piece of supporting evidence, promoting the memory
   * exactly one step forward (Missing -> Learning, or Learning ->
   * Knows). Calling this repeatedly as evidence accumulates is what
   * eventually reaches "Knows" — there is no single-call shortcut
   * straight from Missing to Knows, matching the state machine's
   * single-step-forward rule.
   */
  async reinforce(memoryId: UUID, value: unknown, confidenceDelta: number): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    const nextState: MemoryState = existing.state === "Missing" ? "Learning" : "Knows";
    return this.repository.updateState(memoryId, {
      state: nextState,
      value,
      confidence: Math.min(1, existing.confidence + confidenceDelta),
      evidenceCount: existing.evidenceCount + 1,
      actor: "system",
      action: "promote",
      reason: "new supporting evidence observed",
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /**
   * A user-provided correction is maximal-confidence, user-authored
   * evidence — it jumps straight to "Knows" regardless of the memory's
   * current state (Missing/Learning/Knows -> Knows are all one
   * governance-log-relevant "action", even though Missing -> Knows
   * would otherwise skip a state machine step for evidence-based
   * promotion). This is deliberately allowed for corrections: a direct
   * user statement is stronger evidence than accumulated inference.
   */
  async correct(memoryId: UUID, newValue: unknown): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    return this.repository.updateState(memoryId, {
      state: "Knows",
      value: newValue,
      confidence: 1,
      evidenceCount: existing.evidenceCount + 1,
      userCorrection: true,
      actor: "user",
      action: "correct",
      reason: "user provided a corrected value",
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /**
   * user_forget: resets the memory to "Missing" and sets blocked: true.
   * Blocking (not just resetting the value) is what actually satisfies
   * "prevents future use of this information" — MemoryMapService's
   * getKnownMemories() (and therefore Digital Twin derivation) excludes
   * any blocked memory even if it's later re-promoted to "Knows".
   */
  async forget(memoryId: UUID): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    return this.repository.updateState(memoryId, {
      state: "Missing",
      value: null,
      confidence: 0,
      evidenceCount: 0,
      blocked: true,
      forceCollapse: existing.state === "Knows",
      actor: "user",
      action: "forget",
      reason: "user requested this information be forgotten",
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /**
   * Blocks a memory from being used for inference without resetting
   * its state or value — distinct from forget(): the system still
   * "knows" the fact, it's just not allowed to act on it right now.
   */
  async blockInference(memoryId: UUID, reason: string): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    return this.repository.updateState(memoryId, {
      state: existing.state,
      confidence: existing.confidence,
      evidenceCount: existing.evidenceCount,
      blocked: true,
      forceCollapse: false,
      actor: "user",
      action: "block_inference",
      reason,
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  async unblockInference(memoryId: UUID, reason: string): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    return this.repository.updateState(memoryId, {
      state: existing.state,
      confidence: existing.confidence,
      evidenceCount: existing.evidenceCount,
      blocked: false,
      forceCollapse: false,
      actor: "user",
      action: "unblock_inference",
      reason,
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /**
   * Evaluates time-based decay for one memory and, if warranted,
   * demotes it. Returns null (no write at all) when no decay applies
   * yet — a no-op never touches the governance log, matching "no
   * silent audit-log deletion" (there's simply nothing to log when
   * nothing changed).
   */
  async applyDecay(memoryId: UUID): Promise<MemoryRecord | null> {
    const existing = await this.getOrThrow(memoryId);
    const evaluation = evaluateDecay(existing, this.clock.now());
    if (!evaluation.shouldRegress) return null;

    const nextState: MemoryState = evaluation.forceCollapse
      ? "Missing"
      : existing.state === "Knows"
        ? "Learning"
        : "Missing";

    return this.repository.updateState(memoryId, {
      state: nextState,
      confidence: Math.max(0, existing.confidence - 0.3),
      evidenceCount: existing.evidenceCount,
      forceCollapse: evaluation.forceCollapse,
      actor: "system",
      action: "demote",
      reason: evaluation.reason,
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /** New evidence directly contradicts the current value: regress one step. */
  async applyContradiction(memoryId: UUID): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    const nextState: MemoryState = existing.state === "Knows" ? "Learning" : "Missing";
    return this.repository.updateState(memoryId, {
      state: nextState,
      confidence: Math.max(0, existing.confidence - 0.4),
      evidenceCount: existing.evidenceCount,
      forceCollapse: false,
      actor: "system",
      action: "demote",
      reason: "contradiction",
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /** The experiment this memory was learned from was opted out of: regress one step. */
  async optOutExperiment(memoryId: UUID): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    const nextState: MemoryState = existing.state === "Knows" ? "Learning" : "Missing";
    return this.repository.updateState(memoryId, {
      state: nextState,
      confidence: Math.max(0, existing.confidence - 0.2),
      evidenceCount: existing.evidenceCount,
      forceCollapse: false,
      actor: "user",
      action: "demote",
      reason: "experiment_opt_out",
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  /** The connector/source this memory was learned from was disabled or found unreliable: regress one step. */
  async demoteForSourceIssue(
    memoryId: UUID,
    reason: "source_disabled" | "unreliable_source"
  ): Promise<MemoryRecord> {
    const existing = await this.getOrThrow(memoryId);
    const nextState: MemoryState = existing.state === "Knows" ? "Learning" : "Missing";
    return this.repository.updateState(memoryId, {
      state: nextState,
      confidence: Math.max(0, existing.confidence - 0.2),
      evidenceCount: existing.evidenceCount,
      forceCollapse: false,
      actor: "system",
      action: "demote",
      reason,
      timestamp: this.clock.now(),
      governanceRecordId: this.idGenerator.next(),
    });
  }

  private async getOrThrow(id: UUID): Promise<MemoryRecord> {
    const memory = await this.repository.get(id);
    if (memory === undefined) {
      throw new UnknownMemoryRecordError(id);
    }
    return memory;
  }
}
