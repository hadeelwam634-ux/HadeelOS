import { Decision, UUID } from "../types";

/**
 * One evaluable "what if" scenario. v1 evaluates exactly one candidate
 * Decision per scenario (decisionIds always has length 1) —
 * candidateDecisions are treated as mutually exclusive options for the
 * same decision point (e.g. different times/actions for "gym_time"),
 * mirroring Decision.alternatives. decisionIds is kept as an array
 * (not a single UUID) so a future version can evaluate combinations of
 * decisions accepted together without changing this shape.
 */
export interface Scenario {
  id: UUID;
  decisionIds: UUID[];
  decisions: Decision[];
}

/** Builds one Scenario per candidate decision, in input order. Pure — never mutates candidateDecisions. */
export function buildScenarios(candidateDecisions: readonly Decision[]): Scenario[] {
  return candidateDecisions.map((decision) => ({
    id: decision.id,
    decisionIds: [decision.id],
    decisions: [decision],
  }));
}
