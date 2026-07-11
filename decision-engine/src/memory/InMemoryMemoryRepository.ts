import { MemoryGovernanceRecord, MemoryRecord, UUID } from "../types";
import { clone } from "../persistence/clone";
import { assertValidMemoryTransition } from "./MemoryStateMachine";
import { MemoryRepository, UpdateMemoryStateInput } from "./MemoryRepository";
import {
  DuplicateMemoryGovernanceRecordError,
  DuplicateMemoryRecordError,
  MemoryInvalidConfidenceError,
  MemoryInvalidEvidenceCountError,
  UnknownMemoryRecordError,
} from "./errors";

/** Same NaN/Infinity-safe validation pattern established in PR #4/#5. */
function assertValidConfidence(confidence: number): void {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new MemoryInvalidConfidenceError(confidence);
  }
}

function assertValidEvidenceCount(evidenceCount: number): void {
  if (!Number.isSafeInteger(evidenceCount) || evidenceCount < 0) {
    throw new MemoryInvalidEvidenceCountError(evidenceCount);
  }
}

/**
 * In-memory implementation of MemoryRepository. Every entry is
 * deep-cloned (structuredClone, via ../persistence/clone) on the way in
 * and on the way out, mirroring every other repository in this
 * codebase. IDs and timestamps are never generated inside the
 * repository — callers supply fully-formed values.
 */
export class InMemoryMemoryRepository implements MemoryRepository {
  private memories = new Map<UUID, MemoryRecord>();
  private byUser = new Map<UUID, UUID[]>();

  /** Append-only, per-memory, in insertion order — never mutated or spliced. */
  private governanceLog = new Map<UUID, MemoryGovernanceRecord[]>();

  async add(memory: MemoryRecord): Promise<void> {
    if (this.memories.has(memory.id)) {
      throw new DuplicateMemoryRecordError(memory.id);
    }
    assertValidConfidence(memory.confidence);
    assertValidEvidenceCount(memory.evidenceCount);

    this.memories.set(memory.id, clone(memory));
    const order = this.byUser.get(memory.userId) ?? [];
    order.push(memory.id);
    this.byUser.set(memory.userId, order);
  }

  async get(id: UUID): Promise<MemoryRecord | undefined> {
    const memory = this.memories.get(id);
    return memory === undefined ? undefined : clone(memory);
  }

  async getByKey(userId: UUID, key: string): Promise<MemoryRecord | undefined> {
    for (const id of this.byUser.get(userId) ?? []) {
      const memory = this.memories.get(id)!;
      if (memory.key === key) return clone(memory);
    }
    return undefined;
  }

  async getAllForUser(userId: UUID): Promise<MemoryRecord[]> {
    return (this.byUser.get(userId) ?? []).map((id) => clone(this.memories.get(id)!));
  }

  async updateState(id: UUID, input: UpdateMemoryStateInput): Promise<MemoryRecord> {
    const existing = this.memories.get(id);
    if (existing === undefined) {
      throw new UnknownMemoryRecordError(id);
    }

    // Every check below throws before anything is written: a failed
    // validation must leave both the memory and its governance log
    // untouched.
    assertValidConfidence(input.confidence);
    assertValidEvidenceCount(input.evidenceCount);
    assertValidMemoryTransition(existing.state, input.state, {
      forceCollapse: input.forceCollapse,
      userCorrection: input.userCorrection,
    });
    this.assertUniqueGovernanceRecordId(input.governanceRecordId);

    const updated: MemoryRecord = {
      ...existing,
      state: input.state,
      value: input.value !== undefined ? input.value : existing.value,
      confidence: input.confidence,
      evidenceCount: input.evidenceCount,
      lastReinforcedAt: input.timestamp,
      blocked: input.blocked !== undefined ? input.blocked : existing.blocked,
    };
    this.memories.set(id, clone(updated));

    const record: MemoryGovernanceRecord = {
      id: input.governanceRecordId,
      memoryId: id,
      actor: input.actor,
      action: input.action,
      previousState: existing.state,
      nextState: input.state,
      reason: input.reason,
      timestamp: input.timestamp,
    };
    const log = this.governanceLog.get(id) ?? [];
    log.push(clone(record));
    this.governanceLog.set(id, log);

    return clone(updated);
  }

  async getGovernanceLog(memoryId: UUID): Promise<MemoryGovernanceRecord[]> {
    return (this.governanceLog.get(memoryId) ?? []).map((record) => clone(record));
  }

  /**
   * Enforces global uniqueness of MemoryGovernanceRecord.id across
   * every memory's log — not just the memory currently being updated —
   * mirroring the same fix just applied to
   * KnowledgeGraphRepository.assertUniqueMaturityRecordId() in PR #5's
   * review, applied here proactively rather than deferred.
   */
  private assertUniqueGovernanceRecordId(id: UUID): void {
    for (const records of this.governanceLog.values()) {
      if (records.some((record) => record.id === id)) {
        throw new DuplicateMemoryGovernanceRecordError(id);
      }
    }
  }
}
