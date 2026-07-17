export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarError";
  }
}

export class UnknownCalendarConnectionError extends CalendarError {
  constructor(userId: string) {
    super(`No calendar connection exists for user "${userId}".`);
    this.name = "UnknownCalendarConnectionError";
  }
}

/**
 * Wraps any failure from the upstream Google Calendar API (network error,
 * non-2xx response, malformed payload, expired/revoked token that could
 * not be refreshed, etc.) so callers only need to catch one type. The
 * original cause is preserved for logging/observability.
 */
export class CalendarProviderError extends CalendarError {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}
