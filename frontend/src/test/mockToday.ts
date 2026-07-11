import type { TodayDecisionResult } from "../api/types";

export function makeTodayResult(overrides: Partial<TodayDecisionResult> = {}): TodayDecisionResult {
  return {
    context: {
      signalCount: 3,
      missingSignals: [],
      generatedAt: "2026-01-01T08:00:00.000Z",
      graphVersion: "v1",
      twinDerivedAt: "2026-01-01T08:00:00.000Z",
    },
    decision: {
      id: "decision-1",
      type: "quran_timing",
      proposedAction: "اقرئي بعد الفجر",
      confidence: 0.82,
      confidenceQualifier: "high",
      alternatives: [],
      state: "Proposed",
      createdAt: "2026-01-01T08:00:00.000Z",
      revisedAt: null,
      revisionReason: null,
      supersedesDecisionId: null,
    },
    confidence: {
      score: 0.82,
      qualifier: "high",
      contributors: [{ name: "signal_reliability", contribution: 0.6, sourceConfidence: 0.9 }],
    },
    alternatives: [{ action: "اقرئي بعد المغرب", predictedSuccess: 0.4, rejectionReason: "ثقة أقل" }],
    forecast: { completion: 80, capacity: 70, stress: 0.3 },
    timelineOrder: ["decision-1"],
    memoryUpdates: [],
    activeHypotheses: [],
    uncertainty: { isUncertain: false },
    ...overrides,
  };
}
