import { Decision, DecisionState } from "./types";

/**
 * Decision lifecycle state machine — "Decision Engine Specification v1" §3.
 *
 *   Proposed -> Presented -> { Accepted | Rejected | Ignored } -> OutcomeRecorded
 *                   ^__________________________________________________|
 *                   (Revised: new signals arrived before the outcome window
 *                    closed -> loops back to Presented with a revisionReason)
 */

const ALLOWED_TRANSITIONS: Record<DecisionState, DecisionState[]> = {
  Proposed: ["Presented"],
  Presented: ["Accepted", "Rejected", "Ignored", "Revised"],
  Accepted: ["OutcomeRecorded", "Revised"],
  Rejected: ["OutcomeRecorded", "Revised"],
  Ignored: ["OutcomeRecorded", "Revised"],
  OutcomeRecorded: ["Revised"],
  Revised: ["Presented"],
};

export class InvalidTransitionError extends Error {
  constructor(from: DecisionState, to: DecisionState) {
    super(`Invalid decision transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: DecisionState, to: DecisionState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(
  decision: Decision,
  to: DecisionState,
  opts?: { revisionReason?: string; now?: () => string }
): Decision {
  const now = opts?.now ?? (() => new Date().toISOString());

  if (!canTransition(decision.state, to)) {
    throw new InvalidTransitionError(decision.state, to);
  }

  if (to === "Revised" && !opts?.revisionReason) {
    throw new Error("A revisionReason is required when transitioning to Revised.");
  }

  const next: Decision = { ...decision, state: to };

  if (to === "Revised") {
    next.revisedAt = now();
    next.revisionReason = opts!.revisionReason!;
  }

  return next;
}
