import { ExperimentStatus } from "../types";
import { InvalidExperimentTransitionError } from "./errors";

/**
 * Purely structural lifecycle graph — the same for every experiment
 * regardless of category or consent state (category/consent guardrails
 * live in ExperimentPolicy.ts, layered on top of this):
 *
 *   proposed -> awaiting_consent -> baseline -> running -> washout
 *     -> evaluated -> confirmed / rejected / inconclusive
 *
 * "proposed -> baseline" is also structurally allowed (a direct start,
 * used by categories that don't require explicit consent); it is
 * ExperimentPolicy's job to reject it for health/financial experiments.
 *
 * From any non-final status, "aborted" is always allowed. Once an
 * experiment reaches a final status, it is immutable — enforced by the
 * repository (ExperimentImmutableError), not by this state machine.
 */
const NON_FINAL_STATUSES: readonly ExperimentStatus[] = [
  "proposed",
  "awaiting_consent",
  "baseline",
  "running",
  "washout",
  "evaluated",
];

const FINAL_STATUSES: readonly ExperimentStatus[] = [
  "confirmed",
  "rejected",
  "inconclusive",
  "aborted",
];

const FORWARD_TRANSITIONS: Partial<Record<ExperimentStatus, readonly ExperimentStatus[]>> = {
  proposed: ["awaiting_consent", "baseline"],
  awaiting_consent: ["baseline"],
  baseline: ["running"],
  running: ["washout"],
  washout: ["evaluated"],
  evaluated: ["confirmed", "rejected", "inconclusive"],
};

export function isFinalExperimentStatus(status: ExperimentStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

export function isValidExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  if (isFinalExperimentStatus(from)) {
    return false;
  }
  if (to === "aborted") {
    return NON_FINAL_STATUSES.includes(from);
  }
  return (FORWARD_TRANSITIONS[from] ?? []).includes(to);
}

/** Throws InvalidExperimentTransitionError if `from -> to` is not a structurally valid step. */
export function assertValidExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (!isValidExperimentTransition(from, to)) {
    throw new InvalidExperimentTransitionError(from, to);
  }
}
