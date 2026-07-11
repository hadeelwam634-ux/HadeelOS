import { HypothesisStatus } from "../types";
import { InvalidHypothesisTransitionError } from "./errors";

/**
 * The only three lifecycle paths a Hypothesis can take:
 *
 *   forming -> testing -> confirmed
 *   forming -> testing -> rejected
 *   forming -> unknown_competing
 *
 * "confirmed", "rejected", and "unknown_competing" are terminal — a
 * Hypothesis that has reached one of them never transitions again.
 */
const ALLOWED_HYPOTHESIS_TRANSITIONS: Record<HypothesisStatus, readonly HypothesisStatus[]> = {
  forming: ["testing", "unknown_competing"],
  testing: ["confirmed", "rejected"],
  confirmed: [],
  rejected: [],
  unknown_competing: [],
};

const TERMINAL_HYPOTHESIS_STATUSES: readonly HypothesisStatus[] = [
  "confirmed",
  "rejected",
  "unknown_competing",
];

export function isTerminalHypothesisStatus(status: HypothesisStatus): boolean {
  return TERMINAL_HYPOTHESIS_STATUSES.includes(status);
}

export function isValidHypothesisTransition(from: HypothesisStatus, to: HypothesisStatus): boolean {
  return ALLOWED_HYPOTHESIS_TRANSITIONS[from].includes(to);
}

/** Throws InvalidHypothesisTransitionError if `from -> to` is not one of the three allowed paths. */
export function assertValidHypothesisTransition(from: HypothesisStatus, to: HypothesisStatus): void {
  if (!isValidHypothesisTransition(from, to)) {
    throw new InvalidHypothesisTransitionError(from, to);
  }
}
