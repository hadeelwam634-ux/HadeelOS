import { MemoryState } from "../types";
import { InvalidMemoryTransitionError } from "./errors";

/**
 * The only structural lifecycle path is Missing -> Learning -> Knows,
 * with regression Knows -> Learning -> Missing. A same-state
 * "reinforcement" (from === to) is always allowed, mirroring the KG
 * causal-maturity "no_change" case. Skipping directly from Knows to
 * Missing is not a normal single-step transition — it's only reachable
 * via the explicit `forceCollapse` escape hatch below, used exclusively
 * by MemoryDecayPolicy's "stale_data" case (data old enough that its
 * current state can no longer be trusted at all).
 */
export const ALLOWED_MEMORY_TRANSITIONS: Record<MemoryState, MemoryState[]> = {
  Missing: ["Learning"],
  Learning: ["Knows", "Missing"],
  Knows: ["Learning"],
};

export interface MemoryTransitionOptions {
  /**
   * Allows Knows -> Missing directly, bypassing Learning. Reserved for
   * MemoryDecayPolicy's "stale_data" case; every caller using this must
   * also record a `reason` in the resulting MemoryGovernanceRecord.
   */
  forceCollapse?: boolean;
  /**
   * Allows any state to jump directly to Knows, bypassing Learning.
   * Reserved for MemoryGovernanceService.correct(): a direct,
   * user-authored statement is stronger evidence than the system's own
   * accumulated inference, so it doesn't have to earn its way through
   * Learning first. Every caller using this must also record a
   * `reason` in the resulting MemoryGovernanceRecord.
   */
  userCorrection?: boolean;
}

export function isValidMemoryTransition(
  from: MemoryState,
  to: MemoryState,
  options: MemoryTransitionOptions = {}
): boolean {
  if (from === to) return true;
  if (ALLOWED_MEMORY_TRANSITIONS[from].includes(to)) return true;
  if (options.forceCollapse && from === "Knows" && to === "Missing") return true;
  if (options.userCorrection && to === "Knows") return true;
  return false;
}

export function assertValidMemoryTransition(
  from: MemoryState,
  to: MemoryState,
  options: MemoryTransitionOptions = {}
): void {
  if (!isValidMemoryTransition(from, to, options)) {
    throw new InvalidMemoryTransitionError(
      `Cannot transition MemoryRecord from "${from}" to "${to}"${
        options.forceCollapse ? " (forceCollapse was set but this transition is still invalid)" : ""
      }.`
    );
  }
}
