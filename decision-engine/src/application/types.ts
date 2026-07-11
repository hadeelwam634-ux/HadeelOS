import {
  CausalMaturity,
  Decision,
  DigitalTwinSnapshot,
  SignalStore,
  SignalType,
  UUID,
} from "../types";
import { HistoricalAccuracyInput } from "../confidence";
import { RecalcOutput } from "../recalc";

/**
 * Command accepted by DecisionApplicationService.recalculateDay(). This is
 * the only shape the future API/UI layers need to know about — nothing
 * about SignalStoreRepository or EventLogRepository leaks through it.
 */
export interface RecalculateDayCommand {
  acceptedDecisions: Decision[];
  twin: DigitalTwinSnapshot;
  signalStoreDelta: SignalStore;
  accuracyByDecisionType: Record<string, HistoricalAccuracyInput>;
  causalMaturityByDecisionType: Record<string, CausalMaturity | null>;
  baselineForecast: {
    completion: number;
    capacity: number;
  };
}

/**
 * Uniform output of recalculateDay(). Callers get the recalc() result
 * plus a record of what was actually persisted — never the repositories
 * themselves, and never a reference into their internal storage.
 */
export interface RecalculateDayResult {
  recalculation: RecalcOutput;
  persistedSignalTypes: SignalType[];
  eventLogEntryIds: UUID[];
}

/**
 * Injectable ID source for new EventLogEntry ids, so tests can supply a
 * deterministic sequence instead of depending on real randomness.
 */
export interface IdGenerator {
  next(): UUID;
}

/**
 * Injectable time source, so tests can supply a fixed/deterministic
 * clock instead of depending on the real wall clock.
 */
export interface Clock {
  now(): string; // ISO 8601
}

/** Default IdGenerator for real usage — wraps crypto.randomUUID(). */
export class RandomIdGenerator implements IdGenerator {
  next(): UUID {
    return crypto.randomUUID();
  }
}

/** Default Clock for real usage — wraps `new Date().toISOString()`. */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
