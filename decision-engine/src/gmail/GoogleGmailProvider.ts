import { SystemClock } from "../application/types";
import { CircuitBreaker, withRetry, RetryOptions } from "../observability";
import { GmailProviderError } from "./errors";
import type { GmailProvider } from "./GmailProvider";
import type { GmailConnection } from "./types";

interface GmailListResponse {
  resultSizeEstimate?: number;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = { maxAttempts: 3, baseDelayMs: 100 };

/**
 * Real production implementation, calling the Gmail API v1 directly
 * via the platform `fetch` (no new dependency, matching the
 * GoogleCalendarProvider precedent from PR #13).
 *
 * countUnread() calls users.messages.list with q="is:unread in:inbox"
 * and maxResults=1, then reads only the `resultSizeEstimate` field —
 * it never requests message metadata or bodies, so no message subject,
 * sender, or content ever reaches this process. This is a stricter
 * data-minimization guarantee than PR #13's Calendar integration
 * (which at least sees event titles before discarding them): here,
 * the provider itself is structurally incapable of seeing message
 * content, not just disciplined about discarding it.
 *
 * Reliability (PR #15): every call to Google is wrapped in withRetry
 * inside a CircuitBreaker, identical pattern to GoogleCalendarProvider.
 */
export class GoogleGmailProvider implements GmailProvider {
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryOptions: RetryOptions;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    circuitBreaker?: CircuitBreaker,
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
  ) {
    this.circuitBreaker =
      circuitBreaker ??
      new CircuitBreaker({
        name: "google-gmail",
        failureThreshold: 5,
        cooldownMs: 30_000,
        clock: new SystemClock(),
      });
    this.retryOptions = retryOptions;
  }

  async countUnread(connection: GmailConnection): Promise<number> {
    return this.circuitBreaker.execute(() =>
      withRetry(() => this.fetchUnreadCount(connection), this.retryOptions),
    );
  }

  async refreshAccessToken(
    connection: GmailConnection,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    if (connection.refreshToken === null) {
      return null;
    }
    return this.circuitBreaker.execute(() =>
      withRetry(() => this.fetchRefreshedToken(connection), this.retryOptions),
    );
  }

  private async fetchUnreadCount(connection: GmailConnection): Promise<number> {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", "is:unread in:inbox");
    url.searchParams.set("maxResults", "1");

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
    } catch (cause) {
      throw new GmailProviderError("Failed to reach the Gmail API.", cause);
    }

    if (!response.ok) {
      throw new GmailProviderError(`Gmail API returned status ${response.status}.`);
    }

    let payload: GmailListResponse;
    try {
      payload = (await response.json()) as GmailListResponse;
    } catch (cause) {
      throw new GmailProviderError("Failed to parse Gmail API response.", cause);
    }

    return payload.resultSizeEstimate ?? 0;
  }

  private async fetchRefreshedToken(
    connection: GmailConnection,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: connection.refreshToken ?? "",
          grant_type: "refresh_token",
        }).toString(),
      });
    } catch (cause) {
      throw new GmailProviderError("Failed to reach Google's token endpoint.", cause);
    }

    if (!response.ok) {
      throw new GmailProviderError(`Google token refresh returned status ${response.status}.`);
    }

    let payload: GoogleTokenResponse;
    try {
      payload = (await response.json()) as GoogleTokenResponse;
    } catch (cause) {
      throw new GmailProviderError("Failed to parse Google token refresh response.", cause);
    }

    const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
    return { accessToken: payload.access_token, expiresAt };
  }
}
