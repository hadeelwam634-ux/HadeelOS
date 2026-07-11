import { UUID } from "../types";

/** Base class for every error this module throws. */
export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export class DuplicateMemoryRecordError extends MemoryError {
  constructor(id: UUID) {
    super(`MemoryRecord with id "${id}" already exists.`);
    this.name = "DuplicateMemoryRecordError";
  }
}

export class UnknownMemoryRecordError extends MemoryError {
  constructor(id: UUID) {
    super(`MemoryRecord with id "${id}" does not exist.`);
    this.name = "UnknownMemoryRecordError";
  }
}

/** Thrown by assertValidMemoryTransition() — see MemoryStateMachine.ts. */
export class InvalidMemoryTransitionError extends MemoryError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemoryTransitionError";
  }
}

// Named Memory*Error (not Invalid*Error) to avoid the ambiguous-export
// TS2308 error that would occur if src/index.ts re-exported this module
// alongside knowledge-graph/ and learning/, both of which already
// export their own confidence/evidence-count error classes.
export class MemoryInvalidConfidenceError extends MemoryError {
  constructor(confidence: number) {
    super(`confidence must be between 0 and 1 inclusive, got ${confidence}.`);
    this.name = "MemoryInvalidConfidenceError";
  }
}

export class MemoryInvalidEvidenceCountError extends MemoryError {
  constructor(evidenceCount: number) {
    super(`evidenceCount must be >= 0, got ${evidenceCount}.`);
    this.name = "MemoryInvalidEvidenceCountError";
  }
}

/**
 * Thrown by updateState() if governanceRecordId is already used by an
 * existing MemoryGovernanceRecord (checked globally, across every
 * memory's governance log — the same discipline just added to
 * KnowledgeGraphRepository's MaturityTransitionRecord.id in PR #5's
 * review, applied here from the start rather than deferred).
 */
export class DuplicateMemoryGovernanceRecordError extends MemoryError {
  constructor(id: UUID) {
    super(`MemoryGovernanceRecord with id "${id}" already exists.`);
    this.name = "DuplicateMemoryGovernanceRecordError";
  }
}
