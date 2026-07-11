import {
  MemoryGovernanceAction,
  MemoryGovernanceActor,
  MemoryGovernanceRecord,
  MemoryRecord,
  MemoryState,
  UUID,
} from "../types";
import { MemoryTransitionOptions } from "./MemoryStateMachine";

/**
 * Everything needed to apply one updateState() call and record it in
 * the governance log, atomically, in a single repository call —
 * mirroring KnowledgeGraphRepository.updateEdgeMaturity()'s
 * transition object from PR #4/#5. `governanceRecordId` and
 * `timestamp` are caller-supplied (by MemoryGovernanceService, via the
 * injected IdGenerator/Clock) so the repository never generates IDs or
 * reads the system clock itself.
 */
export interface UpdateMemoryStateInput extends MemoryTransitionOptions {
  state: MemoryState;
  /** Omit to leave the memory's current value unchanged (e.g. a pure block/unblock). */
  value?: unknown;
  confidence: number;
  evidenceCount: number;
  /** Omit to leave the memory's current blocked flag unchanged. */
  blocked?: boolean;
  actor: MemoryGovernanceActor;
  action: MemoryGovernanceAction;
  reason: string;
  timestamp: string;
  governanceRecordId: UUID;
}

/**
 * Storage-agnostic contract for MemoryRecord state and its append-only
 * MemoryGovernanceRecord audit trail. Like every other repository in
 * this codebase, every method returns a Promise and every
 * implementation is expected to defensively clone at both write and
 * read boundaries.
 */
export interface MemoryRepository {
  /**
   * Throws DuplicateMemoryRecordError if memory.id already exists,
   * MemoryInvalidConfidenceError / MemoryInvalidEvidenceCountError for
   * out-of-range values.
   */
  add(memory: MemoryRecord): Promise<void>;

  get(id: UUID): Promise<MemoryRecord | undefined>;

  getByKey(userId: UUID, key: string): Promise<MemoryRecord | undefined>;

  /** Every memory for userId, in insertion order. */
  getAllForUser(userId: UUID): Promise<MemoryRecord[]>;

  /**
   * Updates an existing memory's state/value/confidence/evidenceCount/
   * blocked flag and appends exactly one MemoryGovernanceRecord to its
   * audit trail, atomically.
   *
   * Throws UnknownMemoryRecordError if id does not exist,
   * MemoryInvalidConfidenceError / MemoryInvalidEvidenceCountError for
   * out-of-range values, InvalidMemoryTransitionError if the state
   * transition is not allowed (see MemoryStateMachine.ts), and
   * DuplicateMemoryGovernanceRecordError if
   * input.governanceRecordId already identifies a
   * MemoryGovernanceRecord on any memory (checked globally, not just
   * this memory's own log). On any of these failures, nothing is
   * written: the memory is unchanged and no MemoryGovernanceRecord is
   * appended.
   */
  updateState(id: UUID, input: UpdateMemoryStateInput): Promise<MemoryRecord>;

  /**
   * The append-only audit trail for this memory, in insertion order.
   * Returns an empty array for a memory with no history yet (including
   * a memory that does not exist — this method never throws
   * UnknownMemoryRecordError).
   */
  getGovernanceLog(memoryId: UUID): Promise<MemoryGovernanceRecord[]>;
}
