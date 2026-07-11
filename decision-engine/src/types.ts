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

/**
 * "proposed" (added in PR #8) records that the system generated and
 * presented a recommendation — including its context snapshot and
 * alternative scenarios in `recommendation` — before the user has
 * responded at all. It is written once per TodayDecisionApplicationService
 * run that produces a non-null decision, with `outcome: "pending"`.
 * Once the user actually responds (PR #9's respond endpoint), a
 * separate "accepted"/"rejected"/"ignored" entry is appended for the
 * same decisionId — this mirrors how a Decision can move through
 * several EventLogEntry rows over its lifetime without ever mutating
 * an earlier one (see the append-only guarantee documented on
 * EventLogRepository).
 */
export type UserAction = "proposed" | "accepted" | "rejected" | "ignored";
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

// ---------- Digital Twin Snapshot (PR #6) ----------
//
// A persisted derivation of user state. DigitalTwinSnapshot is derived
// by DigitalTwinService from the Signal Store, Event Log, Knowledge
// Graph, Hypotheses, and Experiments — see src/twin/ — and never
// stores raw signal values itself, only interpreted/derived fields.
//
// This replaces the earlier, simpler `DigitalTwin` type that recalc()
// and the Application Service originally depended on (from the initial
// Decision Engine Specification v1). That type has been migrated away
// from entirely: `RecalcInput.twin` / `RecalculateDayCommand.twin` now
// both use DigitalTwinSnapshot, and the old interface has been removed
// from this file since nothing referenced it anymore. Neither
// recalc() nor DecisionApplicationService ever read any field off
// `twin` — it was (and remains) a reserved, unused pass-through field —
// so this was a type-only migration with no behavior change.

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

// ---------- Memory Governance (PR #6) ----------
//
// A persisted per-fact memory model with an append-only governance
// audit trail. See src/memory/.

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

// The original "Memory Governance" section (GovernanceAction /
// MemoryGovernanceLogEntry) has been removed: it predated the PR #6
// Memory module, was never referenced anywhere outside this file, and
// is fully superseded by MemoryGovernanceAction / MemoryGovernanceRecord
// above.
