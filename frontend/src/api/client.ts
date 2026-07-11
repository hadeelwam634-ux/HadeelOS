import type { ApiErrorBody, EventLogEntry, MemoryRecord, TodayDecisionResult } from "./types";

/**
 * ApiClientError carries the parsed structured error body (PR #9's
 * `{ error: { name, message, requestId, issues? } }`) plus an
 * `offline` flag for network-level failures (no response at all,
 * e.g. the browser is offline) — the two are distinguished so the UI
 * can show "offline" vs "application error" as different states
 * (both required by PR #10's state list).
 */
export class ApiClientError extends Error {
  readonly status: number | null;
  readonly body: ApiErrorBody | null;
  readonly offline: boolean;

  constructor(message: string, options: { status: number | null; body: ApiErrorBody | null; offline: boolean }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.body = options.body;
    this.offline = options.offline;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  userId: string;
}

/**
 * Thin fetch wrapper around the PR #9 API. Every call attaches
 * `x-user-id` (the same v1 mock-auth header the API's
 * MockHeaderAuthResolver expects) and normalizes both network failures
 * and structured API error responses into ApiClientError, so calling
 * code (useTodayCockpit) never has to branch on fetch's own error
 * shapes directly.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly userId: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl ?? "/api";
    this.userId = options.userId;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-user-id": this.userId,
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ApiClientError("Network request failed.", { status: null, body: null, offline: true });
    }

    const text = await response.text();
    const parsed = text.length > 0 ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new ApiClientError((parsed as ApiErrorBody | undefined)?.error?.message ?? "Request failed.", {
        status: response.status,
        body: (parsed as ApiErrorBody) ?? null,
        offline: false,
      });
    }

    return parsed as T;
  }

  getToday(): Promise<TodayDecisionResult> {
    return this.request<TodayDecisionResult>("/today");
  }

  recalculateToday(command: {
    signalStoreDelta: unknown[];
    candidateDecisions: unknown[];
    previouslyAcceptedDecisions: unknown[];
    accuracyByDecisionType: Record<string, { successes: number; totalShown: number }>;
    baselineForecast: { completion: number; capacity: number };
    sourceVersions: { signalsUpdatedAt: string | null; eventLogCursor: string | null; graphVersion: string | null };
  }): Promise<TodayDecisionResult> {
    return this.request<TodayDecisionResult>("/today/recalculate", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  respondToDecision(decisionId: string, action: "accepted" | "rejected" | "ignored"): Promise<{ entry: EventLogEntry }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/respond`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  }

  recordOutcome(decisionId: string, outcome: "completed" | "skipped" | "partial"): Promise<{ entry: EventLogEntry }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/outcome`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    });
  }

  getDecisionHistory(decisionId: string): Promise<{ history: EventLogEntry[] }> {
    return this.request(`/decisions/${encodeURIComponent(decisionId)}/history`);
  }

  getMemory(): Promise<{ memories: MemoryRecord[] }> {
    return this.request("/memory");
  }

  correctMemory(memoryId: string, value: unknown): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/correct`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  forgetMemory(memoryId: string): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/forget`, { method: "POST" });
  }

  blockMemory(memoryId: string, reason: string): Promise<{ memory: MemoryRecord }> {
    return this.request(`/memory/${encodeURIComponent(memoryId)}/block`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  health(): Promise<{ status: string }> {
    return this.request("/system/health");
  }
}
