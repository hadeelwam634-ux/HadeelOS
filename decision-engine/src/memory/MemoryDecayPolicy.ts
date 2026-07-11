import { MemoryRecord } from "../types";

/**
 * Deterministic time-based decay thresholds. A memory that hasn't been
 * reinforced in DECAY_THRESHOLD_DAYS regresses one step (reason:
 * "evidence_decay"). One that hasn't been reinforced in
 * STALE_THRESHOLD_DAYS is old enough that its current state can no
 * longer be trusted at all, so it collapses straight to "Missing"
 * (reason: "stale_data"), regardless of how many steps that skips.
 */
export const DECAY_THRESHOLD_DAYS = 30;
export const STALE_THRESHOLD_DAYS = 90;

export type DecayEvaluation =
  | { shouldRegress: false }
  | { shouldRegress: true; reason: "evidence_decay"; forceCollapse: false }
  | { shouldRegress: true; reason: "stale_data"; forceCollapse: true };

function daysBetween(earlierIso: string, laterIso: string): number {
  return (Date.parse(laterIso) - Date.parse(earlierIso)) / (1000 * 60 * 60 * 24);
}

/**
 * Pure function of (memory, now) — no system clock reads, no
 * randomness, so the same memory evaluated at the same instant always
 * produces the same evaluation. Callers (MemoryGovernanceService) pass
 * `now` from the injected Clock.
 */
export function evaluateDecay(memory: MemoryRecord, now: string): DecayEvaluation {
  if (memory.state === "Missing") {
    return { shouldRegress: false };
  }
  const ageDays = daysBetween(memory.lastReinforcedAt, now);
  if (ageDays >= STALE_THRESHOLD_DAYS) {
    return { shouldRegress: true, reason: "stale_data", forceCollapse: true };
  }
  if (ageDays >= DECAY_THRESHOLD_DAYS) {
    return { shouldRegress: true, reason: "evidence_decay", forceCollapse: false };
  }
  return { shouldRegress: false };
}
