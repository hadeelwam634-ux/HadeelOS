export class GmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailError";
  }
}

export class UnknownGmailConnectionError extends GmailError {
  constructor(userId: string) {
    super(`No Gmail connection exists for user "${userId}".`);
    this.name = "UnknownGmailConnectionError";
  }
}

/**
 * Wraps any failure from the upstream Gmail API (network error, non-2xx
 * response, malformed payload, expired/revoked token that could not be
 * refreshed, etc.), matching CalendarProviderError's role from PR #13.
 */
export class GmailProviderError extends GmailError {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GmailProviderError";
  }
}
