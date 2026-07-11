import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, ApiClientError } from "../api/client";
import type { TodayDecisionResult } from "../api/types";

export type TodayViewState =
  | { kind: "loading" }
  | { kind: "offline"; lastKnown: TodayDecisionResult | null }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TodayDecisionResult; stale: boolean; retrying: boolean };

export interface UseTodayCockpitResult {
  state: TodayViewState;
  refresh: () => void;
  respond: (decisionId: string, action: "accepted" | "rejected" | "ignored") => Promise<void>;
  recordOutcome: (decisionId: string, outcome: "completed" | "skipped" | "partial") => Promise<void>;
}

const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Owns every state PR #10 requires the Today Cockpit to handle:
 * loading, empty, missing signals, low confidence, uncertain, offline,
 * retrying, accepted/rejected/ignored, application error, and stale
 * data. Each is derived from the live TodayDecisionResult (uncertainty
 * reason, confidence qualifier, decision presence) rather than being a
 * separately hand-maintained flag, so the UI can never show a state
 * that contradicts the data it's built from.
 */
export function useTodayCockpit(client: ApiClient): UseTodayCockpitResult {
  const [state, setState] = useState<TodayViewState>({ kind: "loading" });
  const lastKnownRef = useRef<TodayDecisionResult | null>(null);
  const fetchedAtRef = useRef<number>(0);

  const load = useCallback(
    async (isRetry: boolean) => {
      if (lastKnownRef.current) {
        setState({ kind: "ready", data: lastKnownRef.current, stale: true, retrying: true });
      } else if (!isRetry) {
        setState({ kind: "loading" });
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setState({ kind: "offline", lastKnown: lastKnownRef.current });
        return;
      }

      try {
        const data = await client.getToday();
        lastKnownRef.current = data;
        fetchedAtRef.current = Date.now();
        setState({ kind: "ready", data, stale: false, retrying: false });
      } catch (cause) {
        if (cause instanceof ApiClientError && cause.offline) {
          setState({ kind: "offline", lastKnown: lastKnownRef.current });
          return;
        }
        if (cause instanceof ApiClientError && cause.status === 404) {
          // UnknownTodayResultError: no recalculation has run yet for
          // this user — a well-formed empty state, not an error.
          setState({
            kind: "ready",
            data: {
              context: { signalCount: 0, missingSignals: [], generatedAt: new Date().toISOString(), graphVersion: null, twinDerivedAt: new Date().toISOString() },
              decision: null,
              confidence: { score: 0, qualifier: "low", contributors: [] },
              alternatives: [],
              forecast: { completion: 0, capacity: 0, stress: 0 },
              timelineOrder: [],
              memoryUpdates: [],
              activeHypotheses: [],
              uncertainty: { isUncertain: true, reason: "no_candidates" },
            },
            stale: false,
            retrying: false,
          });
          return;
        }
        if (lastKnownRef.current) {
          // Keep showing stale data rather than replacing it with an
          // error screen the moment a background refresh fails.
          setState({ kind: "ready", data: lastKnownRef.current, stale: true, retrying: false });
          return;
        }
        setState({ kind: "error", message: cause instanceof Error ? cause.message : "Unknown error." });
      }
    },
    [client]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const onOnline = () => load(true);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastKnownRef.current && Date.now() - fetchedAtRef.current > STALE_AFTER_MS) {
        setState((prev) => (prev.kind === "ready" ? { ...prev, stale: true } : prev));
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const refresh = useCallback(() => {
    load(true);
  }, [load]);

  const respond = useCallback(
    async (decisionId: string, action: "accepted" | "rejected" | "ignored") => {
      await client.respondToDecision(decisionId, action);
      await load(true);
    },
    [client, load]
  );

  const recordOutcome = useCallback(
    async (decisionId: string, outcome: "completed" | "skipped" | "partial") => {
      await client.recordOutcome(decisionId, outcome);
      await load(true);
    },
    [client, load]
  );

  return { state, refresh, respond, recordOutcome };
}
