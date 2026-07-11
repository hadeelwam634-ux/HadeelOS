import { CausalMaturity } from "../types";
import { InvalidMaturityTransitionError } from "./errors";

/**
 * The only natural progression for an edge's causal maturity. Index in
 * this array is the edge's "rank" — used to detect advances, skips, and
 * downgrades below.
 */
export const MATURITY_ORDER: readonly CausalMaturity[] = [
  "correlated",
  "suspected_causal",
  "experimentally_supported",
  "stable_causal",
];

export function maturityRank(maturity: CausalMaturity): number {
  return MATURITY_ORDER.indexOf(maturity);
}

export interface MaturityTransitionOptions {
  /**
   * Required to skip more than one step ahead in MATURITY_ORDER (e.g.
   * correlated -> stable_causal directly). A `reason` must also be
   * supplied when this is set.
   */
  overrideMaturityTransition?: boolean;
  /**
   * Required whenever the transition is a downgrade (moving to a lower
   * rank) or an override-skip. Never required for a same-state update
   * or a single natural step forward.
   */
  reason?: string;
}

export type MaturityTransitionKind =
  | "no_change"
  | "advance_one_step"
  | "downgrade"
  | "override_skip";

/**
 * Classifies a proposed maturity transition without validating it —
 * pure function, useful on its own for tests and for callers that want
 * to know what *kind* of change is being made before deciding how to
 * log it.
 */
export function classifyMaturityTransition(
  from: CausalMaturity,
  to: CausalMaturity
): MaturityTransitionKind {
  const fromRank = maturityRank(from);
  const toRank = maturityRank(to);

  if (toRank === fromRank) return "no_change";
  if (toRank === fromRank + 1) return "advance_one_step";
  if (toRank < fromRank) return "downgrade";
  return "override_skip";
}

/**
 * Throws InvalidMaturityTransitionError (imported lazily to avoid a
 * circular import — see errors.ts) if the transition is not allowed:
 *
 *   - A single natural step forward is always allowed.
 *   - Skipping ahead more than one step requires
 *     `overrideMaturityTransition: true` AND a `reason`.
 *   - Any downgrade requires a `reason` (no silent downgrades), but
 *     does not require `overrideMaturityTransition`.
 *
 * This is intentionally the *only* place transition legality is
 * decided, so both the in-memory repository and any future
 * Postgres-backed repository enforce identical rules.
 */
export function assertValidMaturityTransition(
  from: CausalMaturity,
  to: CausalMaturity,
  options: MaturityTransitionOptions = {}
): void {
  const kind = classifyMaturityTransition(from, to);

  if (kind === "no_change" || kind === "advance_one_step") {
    return;
  }

  if (kind === "downgrade") {
    if (!options.reason) {
      throw new InvalidMaturityTransitionError(
        `Downgrading causal maturity from "${from}" to "${to}" requires a reason.`
      );
    }
    return;
  }

  // override_skip
  if (!options.overrideMaturityTransition) {
    throw new InvalidMaturityTransitionError(
      `Skipping causal maturity from "${from}" to "${to}" is not allowed without overrideMaturityTransition: true.`
    );
  }
  if (!options.reason) {
    throw new InvalidMaturityTransitionError(
      `Overriding a causal maturity transition from "${from}" to "${to}" requires a reason.`
    );
  }
}
