// HadeelOS Decision Engine — Core Types
// Implements the schemas defined in "Decision Engine Specification v1" (Notion).

export type UUID = string;

// ---------- Signals ----------

export type KnownSignalType =
  | "sleep_duration"
  | "sleep_quality"
  | "cycle_day"
  | "meeting_count"
  | "weather_temp"
  | "task_completion"
  | "mood_score";

// `| string` on a union collapses the whole type to `string` and silently
// disables the union's error-checking. Namespacing new/unforeseen signal
// types under `custom:` keeps the known signals type-checked while still
// allowing extension.
export type SignalType = KnownSignalType | `custom:${string}`;

export type SignalSource =
  | "apple_watch"
  | "google_calendar"
  | "manual_entry"
  | "hadeelos_internal";

export interface Signal {
  id: UUID;
  type: SignalType;
  value: number | string;
  unit: string;
  timestamp: string; // ISO 8601
  source: SignalSource;
  reliabilityScore: number; // 0..1
}

export interface SignalStoreEntry {
  signalType: SignalType;
  latestValue: number | string;
  latestTimestamp: string;
  reliabilityScore: number;
  syncConsistencyDays: number;
}

// A signal store is almost always partial in practice (most signals
// aren't available at any given moment) — `Record<SignalType, X>` would
// (incorrectly) force every known signal key to be present. Partial<>
// over the full union keeps both known and `custom:` keys optional.
export type SignalStore = Partial<Record<SignalType, SignalStoreEntry>>;

// ---------- Event Log ----------

export type UserAction = "accepted" | "rejected" | "ignored";
export type Outcome = "completed" | "skipped" | "partial" | "pending";

export interface EventLogEntry {
  id: UUID;
  decisionId: UUID;
  timestamp: string;
  signalsSnapshot: SignalStore;
  recommendation: unknown;
  userAction: UserAction;
  outcome: Outcome;
  outcomeTimestamp: string | null;
  experimentId: UUID | null;
}

// ---------- Decision ----------

export type DecisionState =
  | "Proposed"
  | "Presented"
  | "Accepted"
  | "Rejected"
  | "Ignored"
  | "OutcomeRecorded"
  | "Revised";

export type ConfidenceQualifier = "low" | "moderate" | "high" | "very_high";

export interface DecisionAlternative {
  action: string;
  predictedSuccess: number; // 0..1
  rejectionReason: string;
}

export interface Decision {
  id: UUID;
  type: string; // e.g. "gym_time", "quran_timing"
  proposedAction: string;
  confidence: number; // 0..1
  confidenceQualifier: ConfidenceQualifier;
  alternatives: DecisionAlternative[];
  state: DecisionState;
  createdAt: string;
  revisedAt: string | null;
  revisionReason: string | null;
  /**
   * Once a Decision reaches OutcomeRecorded it is closed history and is
   * never rewritten. If new signals warrant a different recommendation,
   * a *new* Decision is created that points back here via
   * supersedesDecisionId, instead of mutating this one to Revised.
   */
  supersedesDecisionId: UUID | null;
}

// ---------- Knowledge Graph ----------

export interface KGNode {
  id: UUID;
  domain: string;
  createdAt: string;
}

export type RecordType = "Observation" | "Hypothesis" | "Belief" | "Decision";

export type CausalMaturity =
  | "correlated"
  | "suspected_causal"
  | "experimentally_supported"
  | "stable_causal";

export interface KGEdge {
  id: UUID;
  fromNodeId: UUID;
  toNodeId: UUID;
  recordType: RecordType;
  causalMaturity: CausalMaturity;
  confidence: number;
  evidenceCount: number;
  directionBasis: "temporal_precedence" | "experiment";
  lastReinforcedAt: string;
}

// ---------- Hypothesis ----------

export type HypothesisStatus =
  | "forming"
  | "testing"
  | "confirmed"
  | "rejected"
  | "unknown_competing";

export interface Hypothesis {
  id: UUID;
  statement: string;
  relatedEdgeId: UUID;
  status: HypothesisStatus;
  competingHypothesisId: UUID | null;
  confidence: number;
  evidenceCount: number;
}

// ---------- Experiment ----------

export type ExperimentCategory = "behavioral" | "health" | "financial" | "other";

export type ExperimentStatus =
  | "proposed"
  | "awaiting_consent"
  | "baseline"
  | "running"
  | "washout"
  | "evaluated"
  | "confirmed"
  | "rejected"
  | "aborted"
  | "inconclusive";

export interface Experiment {
  id: UUID;
  hypothesisId: UUID;
  intervention: string;
  durationDays: number;
  singleVariable: boolean;
  baselinePeriodDays: number;
  successMetric: string;
  stopRule: string;
  washoutPeriodDays: number;
  category: ExperimentCategory;
  requiresExplicitConsent: boolean;
  /**
   * Recorded true only when the user has explicitly consented to run
   * this experiment (see learning/ExperimentPolicy.ts). health and
   * financial category experiments cannot leave "awaiting_consent"
   * while this is false — added in PR #5 alongside the Learning Engine.
   */
  consentGiven: boolean;
  status: ExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
}

// ---------- Digital Twin ----------

export interface DigitalTwin {
  userId: UUID;
  currentStress: "low" | "medium" | "high";
  decisionStyle: "reflective" | "decisive";
  energyCurveShape: "morning_peak" | "afternoon_peak" | "evening_peak" | "flat";
  motivation: "low" | "medium" | "high";
  lastComputedAt: string;
  version: number;
}

// ---------- Digital Twin Snapshot (PR #6) ----------
//
// A richer, persisted derivation of user state, distinct from the
// lightweight `DigitalTwin` above (which only feeds recalc()'s
// confidence calculation and predates this module). A
// DigitalTwinSnapshot is derived by DigitalTwinService from the Signal
// Store, Event Log, Knowledge Graph, Hypotheses, and Experiments — see
// src/twin/ — and never stores raw signal values itself, only
// interpreted/derived fields.

export interface EnergyCurvePoint {
  hour: number; // 0-23
  expectedEnergy: number; // 0..1
  confidence: number; // 0..1
}

export interface DigitalTwinSourceVersions {
  signalsUpdatedAt: string | null;
  eventLogCursor: string | null;
  graphVersion: string | null;
}

export interface DigitalTwinSnapshot {
  id: UUID;
  userId: UUID;
  derivedAt: string;

  stress: "low" | "medium" | "high" | "unknown";
  energyCurve: EnergyCurvePoint[];

  decisionStyle: string | null;
  behaviorPatterns: string[];
  knownPreferences: string[];
  activeConstraints: string[];

  sourceVersions: DigitalTwinSourceVersions;
}

// ---------- Memory Governance v2 (PR #6) ----------
//
// A richer, persisted per-fact memory model, distinct from the
// lightweight `MemoryGovernanceLogEntry` below (unused elsewhere in the
// codebase, predates this module). See src/memory/.

export type MemoryState = "Missing" | "Learning" | "Knows";

export type MemoryRegressionReason =
  | "evidence_decay"
  | "stale_data"
  | "contradiction"
  | "user_correction"
  | "user_forget"
  | "experiment_opt_out"
  | "source_disabled"
  | "unreliable_source";

export interface MemoryRecord {
  id: UUID;
  userId: UUID;
  key: string;
  state: MemoryState;
  value: unknown;
  confidence: number;
  evidenceCount: number;
  lastReinforcedAt: string;
  blocked: boolean;
}

export type MemoryGovernanceActor = "system" | "user";

export type MemoryGovernanceAction =
  | "promote"
  | "demote"
  | "correct"
  | "forget"
  | "block_inference"
  | "unblock_inference";

/** Append-only — no update or delete method exists anywhere in this module. */
export interface MemoryGovernanceRecord {
  id: UUID;
  memoryId: UUID;
  actor: MemoryGovernanceActor;
  action: MemoryGovernanceAction;
  previousState: string | null;
  nextState: string | null;
  reason: string;
  timestamp: string;
}

// ---------- Journal ----------

export interface JournalEntry {
  id: UUID;
  date: string;
  templateId: string;
  filledText: string;
  linkedHypothesisId: UUID | null;
  linkedExperimentId: UUID | null;
}

// ---------- Memory Governance ----------

export type GovernanceAction =
  | "decay"
  | "delete"
  | "user_correction"
  | "user_forget"
  | "experiment_opt_out";

export interface MemoryGovernanceLogEntry {
  id: UUID;
  action: GovernanceAction;
  targetId: UUID;
  targetType: string;
  timestamp: string;
  actor: "system" | "user";
}
