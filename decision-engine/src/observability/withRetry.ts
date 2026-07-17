export interface RetryOptions {
  /** Total number of attempts, including the first — must be >= 1. */
  readonly maxAttempts: number;
  /** Base delay in ms before the first retry; doubles each subsequent retry (exponential backoff). */
  readonly baseDelayMs: number;
  /** Injectable so tests never actually sleep. Defaults to a real setTimeout-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries an async operation with exponential backoff. Used to wrap
 * calls to external dependencies (GoogleCalendarProvider,
 * GoogleGmailProvider) so a single transient network blip doesn't
 * immediately surface as a 502 to the end user — a reliability
 * improvement layered on top of the PR #13/#14 integrations without
 * changing either provider's public interface.
 *
 * Does not distinguish retryable from non-retryable errors — every
 * failure from `operation` is retried up to maxAttempts. This is a
 * deliberate v1 simplification; see README's Observability &
 * Reliability scope note.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === options.maxAttempts;
      if (isLastAttempt) break;
      const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
