import type { TranslationShape } from "./ar";

// English strings, kept in exact structural sync with ar.ts (enforced
// by the shared TranslationShape type) so the two never drift apart.
const en: TranslationShape = {
  appName: "HadeelOS",
  today: {
    title: "Today",
    loading: "Loading today's decision…",
    retrying: "Retrying…",
    offline: "You're offline. Showing the last known data, if any.",
    stale: "This data may be out of date. Pull down to refresh.",
    applicationError: "Something went wrong while loading today's decision.",
    retry: "Retry",
    empty: "No candidate decisions yet today.",
    missingSignals: "Not enough signals yet for a confident decision.",
    lowConfidence: "Confidence in this decision is currently low.",
    uncertain: "The options are too close to call — no clear winner yet.",
    partialConnectorFailure: "Some sources (like Calendar or Gmail) couldn't refresh, but the rest of your data is current.",
  },
  context: {
    heading: "At a glance",
    signalCount: "Signal count",
    missingSignals: "Missing signals",
    generatedAt: "Last updated",
    graphVersion: "Knowledge graph version",
  },
  decision: {
    heading: "Proposed decision",
    accept: "Accept",
    reject: "Reject",
    ignore: "Ignore",
    accepted: "Accepted",
    rejected: "Rejected",
    ignored: "Ignored",
    recordOutcome: "Record outcome",
    outcomeCompleted: "Completed",
    outcomeSkipped: "Skipped",
    outcomePartial: "Partially done",
  },
  confidence: {
    heading: "Confidence",
    low: "Low",
    moderate: "Moderate",
    high: "High",
    very_high: "Very high",
  },
  why: {
    heading: "Why this decision?",
    empty: "No explanation available for this decision yet.",
  },
  alternatives: {
    heading: "Other options",
    predictedSuccess: "Predicted success",
    rejectionReason: "Why not this one",
    empty: "No other options.",
  },
  forecast: {
    heading: "Forecast",
    completion: "Completion",
    capacity: "Capacity",
    stress: "Stress",
  },
  timeline: {
    heading: "Timeline",
    empty: "No timeline yet.",
  },
  ifYouDoNothing: {
    heading: "If you do nothing",
    highStress: "Stress may rise and expected completion may drop without a decision.",
    default: "Staying on the current path will keep today's forecast where it is.",
  },
  memory: {
    heading: "What HadeelOS knows about you",
    empty: "No memories saved yet.",
    state: {
      Missing: "Unknown",
      Learning: "Learning",
      Knows: "Known",
    },
    correct: "Correct",
    forget: "Forget",
    block: "Block inference",
    blocked: "Blocked",
    correctPrompt: "Enter the correct value",
    blockPrompt: "Reason for blocking",
  },
  language: {
    toggle: "العربية",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    unauthenticated: "Please sign in.",
  },
};

export default en;
