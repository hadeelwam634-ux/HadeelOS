import type { Clock } from "../application/types";
import { CircuitOpenError } from "./errors";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  readonly name: string;
  /** Consecutive failures required to trip the breaker open. */
  readonly failureThreshold: number;
  /** How long the breaker stays open before allowing one trial ("half-open") call. */
  readonly cooldownMs: number;
  readonly clock: Clock;
}

/**
 * A minimal circuit breaker: closed (normal operation) -> open (fast-
 * fail every call) after `failureThreshold` consecutive failures ->
 * half-open (allow exactly one trial call) after `cooldownMs` elapses
 * -> closed again on success, or back to open on failure.
 *
 * Wraps GoogleCalendarProvider/GoogleGmailProvider calls so a
 * prolonged Google API outage fails fast (CircuitOpenError, mapped to
 * the same 502 as CalendarProviderError/GmailProviderError) instead of
 * every single request from every user retrying and timing out against
 * a dependency that is known to be down.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    this.reevaluateOpenState();
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.reevaluateOpenState();

    if (this.state === "open") {
      throw new CircuitOpenError(this.options.name);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private reevaluateOpenState(): void {
    if (this.state !== "open" || this.openedAt === null) return;
    const elapsed = new Date(this.options.clock.now()).getTime() - this.openedAt;
    if (elapsed >= this.options.cooldownMs) {
      this.state = "half-open";
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === "half-open" || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = "open";
      this.openedAt = new Date(this.options.clock.now()).getTime();
    }
  }
}
