export class ObservabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservabilityError";
  }
}

/**
 * Thrown by CircuitBreaker.execute() when the breaker is open — the
 * wrapped operation is never attempted, so this always fails fast
 * instead of waiting out a network timeout against a known-unhealthy
 * dependency (graceful degradation).
 */
export class CircuitOpenError extends ObservabilityError {
  constructor(circuitName: string) {
    super(`Circuit "${circuitName}" is open — refusing to call the underlying dependency.`);
    this.name = "CircuitOpenError";
  }
}
