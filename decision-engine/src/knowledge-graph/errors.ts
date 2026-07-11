import { UUID } from "../types";

/** Base class for every error this module throws. */
export class KnowledgeGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeGraphError";
  }
}

export class DuplicateNodeError extends KnowledgeGraphError {
  constructor(id: UUID) {
    super(`KGNode with id "${id}" already exists.`);
    this.name = "DuplicateNodeError";
  }
}

export class DuplicateEdgeError extends KnowledgeGraphError {
  constructor(id: UUID) {
    super(`KGEdge with id "${id}" already exists.`);
    this.name = "DuplicateEdgeError";
  }
}

/** Thrown when an edge references a fromNodeId/toNodeId that was never added. */
export class UnknownNodeReferenceError extends KnowledgeGraphError {
  constructor(nodeId: UUID) {
    super(`KGEdge references unknown node id "${nodeId}".`);
    this.name = "UnknownNodeReferenceError";
  }
}

/** Thrown by updateEdgeMaturity() when the edgeId does not exist. */
export class UnknownEdgeError extends KnowledgeGraphError {
  constructor(id: UUID) {
    super(`KGEdge with id "${id}" does not exist.`);
    this.name = "UnknownEdgeError";
  }
}

export class InvalidConfidenceError extends KnowledgeGraphError {
  constructor(confidence: number) {
    super(`confidence must be between 0 and 1 inclusive, got ${confidence}.`);
    this.name = "InvalidConfidenceError";
  }
}

export class InvalidEvidenceCountError extends KnowledgeGraphError {
  constructor(evidenceCount: number) {
    super(`evidenceCount must be >= 0, got ${evidenceCount}.`);
    this.name = "InvalidEvidenceCountError";
  }
}

export class SelfEdgeNotAllowedError extends KnowledgeGraphError {
  constructor(nodeId: UUID) {
    super(
      `Edge from node "${nodeId}" to itself is not allowed unless options.allowSelfEdge is true.`
    );
    this.name = "SelfEdgeNotAllowedError";
  }
}

/** Thrown by assertValidMaturityTransition() — see CausalMaturityPolicy.ts. */
export class InvalidMaturityTransitionError extends KnowledgeGraphError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMaturityTransitionError";
  }
}
