/**
 * Application-layer errors.
 *
 * The Application Service is the only place domain code, persistence,
 * and (eventually) the API boundary meet. Callers on the other side of
 * that boundary (the API layer in PR #9, and the UI beyond it) should
 * never need to know whether a failure came from a repository, from
 * recalc(), or from anywhere else internal to this package — they
 * should only ever see an ApplicationError (or a specific subclass) and
 * decide what to do with it (retry, surface to the user, map to an
 * HTTP status, etc).
 */
export class ApplicationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ApplicationError";
  }
}

/** Thrown when reading from or writing to the SignalStoreRepository fails. */
export class SignalPersistenceError extends ApplicationError {
  constructor(cause: unknown) {
    super("Failed to read or persist the signal store.", cause);
    this.name = "SignalPersistenceError";
  }
}

/** Thrown when appending to the EventLogRepository fails. */
export class EventLogPersistenceError extends ApplicationError {
  constructor(cause: unknown) {
    super("Failed to append an event log entry.", cause);
    this.name = "EventLogPersistenceError";
  }
}

/**
 * Thrown when recalc() itself throws. The Event Log must never be
 * written to before recalc() has succeeded — if this error is thrown,
 * the caller can rely on no EventLogEntry having been appended for
 * this call.
 */
export class RecalcExecutionError extends ApplicationError {
  constructor(cause: unknown) {
    super("Failed to recalculate the day's decisions.", cause);
    this.name = "RecalcExecutionError";
  }
}

/**
 * Thrown when a PR #8 orchestration step outside the existing
 * signal/event-log/recalc error paths fails: deriving the Digital
 * Twin, reading the Knowledge Graph, or applying memory decay. Kept
 * distinct from SignalPersistenceError/EventLogPersistenceError/
 * RecalcExecutionError so a caller can tell which stage of the
 * pipeline actually failed.
 */
export class TodayOrchestrationError extends ApplicationError {
  constructor(message: string, cause: unknown) {
    super(message, cause);
    this.name = "TodayOrchestrationError";
  }
}
