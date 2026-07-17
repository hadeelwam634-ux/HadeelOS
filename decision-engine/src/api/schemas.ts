import { z } from "zod";
import { KnownSignalType, SignalType } from "../types";

const KNOWN_SIGNAL_TYPES: readonly KnownSignalType[] = [
  "sleep_duration",
  "sleep_quality",
  "cycle_day",
  "meeting_count",
  "weather_temp",
  "task_completion",
  "mood_score",
];

/** Matches SignalType = KnownSignalType | `custom:${string}` from src/types.ts. */
export const signalTypeSchema = z.union([
  z.enum(KNOWN_SIGNAL_TYPES as unknown as [KnownSignalType, ...KnownSignalType[]]),
  z.string().regex(/^custom:.+/, 'custom signal types must be of the form "custom:<name>"'),
]);

/**
 * Zod schemas mirroring src/types.ts + src/confidence.ts + src/twin's
 * DigitalTwinSourceVersions. Kept in this one file (rather than next
 * to each domain type) since these are API-boundary contracts, not
 * the domain types themselves — the API layer intentionally validates
 * its own copy of "what a client is allowed to send" rather than
 * exporting the domain types directly as the wire format, so a future
 * internal type change doesn't silently change what's accepted over
 * HTTP.
 */

export const signalStoreEntrySchema = z.object({
  signalType: signalTypeSchema,
  latestValue: z.union([z.number(), z.string()]),
  latestTimestamp: z.string().min(1),
  reliabilityScore: z.number().min(0).max(1),
  syncConsistencyDays: z.number().int().min(0),
});

export const decisionAlternativeSchema = z.object({
  action: z.string(),
  predictedSuccess: z.number().min(0).max(1),
  rejectionReason: z.string(),
});

export const decisionStateSchema = z.enum([
  "Proposed",
  "Presented",
  "Accepted",
  "Rejected",
  "Ignored",
  "OutcomeRecorded",
  "Revised",
]);

export const confidenceQualifierSchema = z.enum(["low", "moderate", "high", "very_high"]);

export const decisionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  proposedAction: z.string(),
  confidence: z.number().min(0).max(1),
  confidenceQualifier: confidenceQualifierSchema,
  alternatives: z.array(decisionAlternativeSchema),
  state: decisionStateSchema,
  createdAt: z.string().min(1),
  revisedAt: z.string().nullable(),
  revisionReason: z.string().nullable(),
  supersedesDecisionId: z.string().nullable(),
});

export const historicalAccuracyInputSchema = z.object({
  successes: z.number().int().min(0),
  totalShown: z.number().int().min(0),
});

export const digitalTwinSourceVersionsSchema = z.object({
  signalsUpdatedAt: z.string().nullable(),
  eventLogCursor: z.string().nullable(),
  graphVersion: z.string().nullable(),
});

export const postSignalsBodySchema = z.object({
  signals: z.array(signalStoreEntrySchema).min(1),
});

export const recalculateTodayBodySchema = z.object({
  // An array (not a keyed record) so the wire format never has to
  // duplicate signalType as both an object key and a field — the
  // server derives the SignalStore record from each entry's own
  // signalType (see routes/today.ts).
  signalStoreDelta: z.array(signalStoreEntrySchema).default([]),
  candidateDecisions: z.array(decisionSchema).default([]),
  previouslyAcceptedDecisions: z.array(decisionSchema).default([]),
  accuracyByDecisionType: z.record(z.string(), historicalAccuracyInputSchema).default({}),
  baselineForecast: z.object({
    completion: z.number().min(0).max(100),
    capacity: z.number().min(0).max(100),
  }),
  sourceVersions: digitalTwinSourceVersionsSchema,
});

export const respondBodySchema = z.object({
  action: z.enum(["accepted", "rejected", "ignored"]),
});

export const outcomeBodySchema = z.object({
  outcome: z.enum(["completed", "skipped", "partial"]),
});

export const correctMemoryBodySchema = z.object({
  value: z.unknown(),
});

export const blockMemoryBodySchema = z.object({
  reason: z.string().min(1),
});

export const idParamSchema = z.object({
  id: z.string().min(1),
});

/**
 * Auth baseline (PR #12) password policy: at least 10 characters, at
 * least one letter and one digit. Deliberately not a maximum-strictness
 * policy (no forced special characters) — length is the strongest
 * single factor for resisting brute force, and overly strict composition
 * rules are well-documented to push users toward predictable patterns.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200, "Password must be at most 200 characters.")
  .regex(/[A-Za-z]/, "Password must contain at least one letter.")
  .regex(/[0-9]/, "Password must contain at least one digit.");

export const registerBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

/**
 * Calendar Integration (PR #13) v1 connect body. The client completes
 * Google's OAuth consent flow itself and hands us the resulting token
 * pair — this endpoint never brokers or initiates the OAuth exchange
 * (documented v1 scope limitation, see README).
 */
export const connectCalendarBodySchema = z.object({
  calendarId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.string().min(1),
});

/**
 * Gmail Integration (PR #14) v1 connect body — same OAuth-handoff
 * shape as connectCalendarBodySchema, minus calendarId (Gmail has no
 * equivalent concept; it always reads the user's own primary mailbox).
 */
export const connectGmailBodySchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.string().min(1),
});

export const logoutBodySchema = z.object({
  token: z.string().min(1),
});

/**
 * signalTypeSchema's z.union([z.enum(...), z.string().regex(...)]) type-checks
 * its *input* correctly, but its *inferred output type* widens to
 * plain `string` (TypeScript has no way to encode "this string, once
 * validated, is safely a SignalType" through a union with a bare
 * `string` regex branch). This helper documents and localizes the one
 * cast that bridges that gap — safe specifically because it is only
 * ever called on a value signalTypeSchema has already validated at
 * runtime, never on unvalidated input.
 */
export function asValidatedSignalType(value: string): SignalType {
  return value as SignalType;
}
