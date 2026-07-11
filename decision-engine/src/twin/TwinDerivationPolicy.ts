import { EnergyCurvePoint, MemoryRecord, SignalStore } from "../types";

/**
 * Every function in this file is a pure, deterministic derivation:
 * same inputs always produce the same output, nothing here reads the
 * system clock or a random source, and nothing mutates its inputs.
 * DigitalTwinService is the only caller — it supplies the derivedAt
 * timestamp itself (via the injected Clock), so these functions never
 * need to know the current time.
 *
 * "No raw signal leakage": every function below returns only an
 * interpreted/classified value (a stress tier, a rounded curve point,
 * a memory's already-governed value) — never a Signal or
 * SignalStoreEntry object, and never a raw signal value copied
 * verbatim into a DigitalTwinSnapshot field.
 */

const HOURS_OF_INTEREST = [6, 9, 12, 15, 18, 21];

function numericValue(entry: { latestValue: number | string } | undefined): number | undefined {
  if (entry === undefined) return undefined;
  return typeof entry.latestValue === "number" ? entry.latestValue : undefined;
}

/**
 * Coarse stress classification from mood_score and sleep_quality, both
 * assumed to be on a 0..1 scale where higher is better. Returns
 * "unknown" whenever either critical signal is missing or non-numeric
 * — an absent signal must never be silently treated as "low stress".
 */
export function deriveStress(signalStore: SignalStore): "low" | "medium" | "high" | "unknown" {
  const mood = numericValue(signalStore.mood_score);
  const sleepQuality = numericValue(signalStore.sleep_quality);
  if (mood === undefined || sleepQuality === undefined) {
    return "unknown";
  }
  const normalizedMood = Math.min(1, Math.max(0, mood));
  const normalizedSleep = Math.min(1, Math.max(0, sleepQuality));
  const stressScore = (1 - normalizedMood) * 0.5 + (1 - normalizedSleep) * 0.5;
  if (stressScore >= 0.66) return "high";
  if (stressScore >= 0.33) return "medium";
  return "low";
}

/**
 * A fixed set of hours of interest, each given an expectedEnergy
 * derived from sleep_duration reliability/value when available. With
 * no relevant signal at all, every point is returned with
 * expectedEnergy: 0.5 (a neutral prior, not a guess dressed up as
 * evidence) and confidence: 0 — never omitted, so callers can always
 * rely on a full, fixed-shape curve.
 */
export function deriveEnergyCurve(signalStore: SignalStore): EnergyCurvePoint[] {
  const sleepDuration = numericValue(signalStore.sleep_duration);
  const sleepReliability = signalStore.sleep_duration?.reliabilityScore ?? 0;

  return HOURS_OF_INTEREST.map((hour) => {
    if (sleepDuration === undefined) {
      return { hour, expectedEnergy: 0.5, confidence: 0 };
    }
    // A simple, deterministic, mid-day-peaking curve shaped by how much
    // sleep was recorded — not a claim of real predictive power, just a
    // stable placeholder model until PR #7's Counterfactual Engine and
    // real historical accuracy data replace it.
    const normalizedSleep = Math.min(1, Math.max(0, sleepDuration / 8));
    const middayBoost = 1 - Math.abs(hour - 13) / 13;
    const expectedEnergy = Math.min(1, Math.max(0, normalizedSleep * 0.6 + middayBoost * 0.4));
    return {
      hour,
      expectedEnergy: Math.round(expectedEnergy * 100) / 100,
      confidence: Math.min(1, Math.max(0, sleepReliability)),
    };
  });
}

function unblockedKnownValues(memories: MemoryRecord[], keyPrefix: string): string[] {
  return memories
    .filter((m) => m.state === "Knows" && !m.blocked && m.key.startsWith(keyPrefix))
    .map((m) => (typeof m.value === "string" ? m.value : String(m.value)))
    .sort();
}

/** The memory keyed "decision_style", if it's Known and not blocked. */
export function deriveDecisionStyle(memories: MemoryRecord[]): string | null {
  const match = memories.find(
    (m) => m.key === "decision_style" && m.state === "Knows" && !m.blocked
  );
  if (match === undefined) return null;
  return typeof match.value === "string" ? match.value : String(match.value);
}

/** Every Known, unblocked memory keyed "pattern:*", sorted for determinism. */
export function deriveBehaviorPatterns(memories: MemoryRecord[]): string[] {
  return unblockedKnownValues(memories, "pattern:");
}

/** Every Known, unblocked memory keyed "preference:*", sorted for determinism. */
export function deriveKnownPreferences(memories: MemoryRecord[]): string[] {
  return unblockedKnownValues(memories, "preference:");
}

/** Every Known, unblocked memory keyed "constraint:*", sorted for determinism. */
export function deriveActiveConstraints(memories: MemoryRecord[]): string[] {
  return unblockedKnownValues(memories, "constraint:");
}
