// Wire-format types mirroring decision-engine's src/types.ts and
// src/application/TodayDecisionApplicationService.ts response shapes.
// Deliberately duplicated here rather than imported across the
// frontend/backend package boundary: the two are separate deploy
// targets (browser vs Node) with no shared build step, and the API
// layer (PR #9) is itself the contract — this file is the frontend's
// own copy of "what the API promises to send back," matching PR #10's
// rule that "no internal interfaces leak to UI."

export type ConfidenceQualifier = "low" | "moderate" | "high" | "very_high";

export interface DecisionAlternative {
  action: string;
  predictedSuccess: number;
  rejectionReason: string;
}

export type DecisionState =
  | "Proposed"
  | "Presented"
  | "Accepted"
  | "Rejected"
  | "Ignored"
  | "OutcomeRecorded"
  | "Revised";

export interface Decision {
  id: string;
  type: string;
  proposedAction: string;
  confidence: number;
  confidenceQualifier: ConfidenceQualifier;
  alternatives: DecisionAlternative[];
  state: DecisionState;
  createdAt: string;
  revisedAt: string | null;
  revisionReason: string | null;
  supersedesDecisionId: string | null;
}

export interface TodayContext {
  signalCount: number;
  missingSignals: string[];
  generatedAt: string;
  graphVersion: string | null;
  twinDerivedAt: string;
}

export interface TodayConfidence {
  score: number;
  qualifier: ConfidenceQualifier;
  contributors: Array<{ name: string; contribution: number; sourceConfidence: number }>;
}

export interface TodayForecast {
  completion: number;
  capacity: number;
  stress: number;
}

export interface TodayUncertainty {
  isUncertain: boolean;
  reason?: string;
  margin?: number;
}

export interface TodayDecisionResult {
  context: TodayContext;
  decision: Decision | null;
  confidence: TodayConfidence;
  alternatives: DecisionAlternative[];
  forecast: TodayForecast;
  timelineOrder: string[];
  memoryUpdates: string[];
  activeHypotheses: string[];
  uncertainty: TodayUncertainty;
}

export type UserAction = "proposed" | "accepted" | "rejected" | "ignored";
export type Outcome = "completed" | "skipped" | "partial" | "pending";

export interface EventLogEntry {
  id: string;
  decisionId: string;
  timestamp: string;
  signalsSnapshot: unknown;
  recommendation: unknown;
  userAction: UserAction;
  outcome: Outcome;
  outcomeTimestamp: string | null;
  experimentId: string | null;
}

export type MemoryState = "Missing" | "Learning" | "Knows";

export interface MemoryRecord {
  id: string;
  userId: string;
  key: string;
  state: MemoryState;
  value: unknown;
  confidence: number;
  evidenceCount: number;
  lastReinforcedAt: string;
  blocked: boolean;
}

export interface ApiErrorBody {
  error: {
    name: string;
    message: string;
    requestId: string;
    issues?: Array<{ path: string; message: string }>;
  };
}

// ---------- Auth (MVP Hardening: frontend wired to real sessions) ----------

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface RegisterResult {
  user: PublicUser;
  token: string;
}

export interface LoginResult {
  token: string;
}

// ---------- Calendar / Gmail connections ----------

export interface PublicCalendarConnection {
  userId: string;
  calendarId: string;
  expiresAt: string;
  connectedAt: string;
}

export interface PublicGmailConnection {
  userId: string;
  expiresAt: string;
  connectedAt: string;
}
