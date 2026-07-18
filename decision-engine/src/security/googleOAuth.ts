import { OAuthExchangeError } from "./errors";

export interface ExchangedTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
}

/**
 * Storage-agnostic contract for turning a short-lived Google OAuth
 * authorization code into an access/refresh token pair. This is the
 * server-side half of the "harden OAuth token exposure" pass: instead
 * of the frontend completing the full OAuth exchange itself and
 * handing HadeelOS a live access_token + refresh_token pair (the v1
 * design documented in CalendarConnection/GmailConnection's SECURITY
 * NOTE), the frontend now only ever needs to hand the backend the
 * single-use authorization `code` Google's redirect gives it — the
 * refresh_token (the long-lived, most sensitive credential) is
 * fetched directly server-to-server and never transits through our
 * API surface from the browser at all.
 *
 * `/api/calendar/connect` and `/api/gmail/connect` (the raw-token-pair
 * routes from PR #13/#14) still exist for local development, tests,
 * and the FakeCalendarProvider/FakeGmailProvider flows — but every
 * real deployment should use `/api/calendar/oauth/exchange` and
 * `/api/gmail/oauth/exchange` instead. See README "OAuth Token
 * Exchange" for the full comparison.
 */
export interface GoogleTokenExchanger {
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ExchangedTokens>;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Real implementation: POSTs directly to Google's token endpoint using
 * this server's own client_id/client_secret (never sent to the
 * frontend — sourced from GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
 * environment variables at composition time, same pattern as
 * GoogleCalendarProvider/GoogleGmailProvider's constructor params).
 */
export class GoogleOAuthTokenExchanger implements GoogleTokenExchanger {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ExchangedTokens> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
    } catch (cause) {
      throw new OAuthExchangeError("Failed to reach Google's token endpoint.", cause);
    }

    if (!response.ok) {
      throw new OAuthExchangeError(`Google authorization code exchange returned status ${response.status}.`);
    }

    let payload: GoogleTokenResponse;
    try {
      payload = (await response.json()) as GoogleTokenResponse;
    } catch (cause) {
      throw new OAuthExchangeError("Failed to parse Google's token exchange response.", cause);
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    };
  }
}

/** Deterministic test/local-dev substitute — never calls the network. */
export class FakeGoogleOAuthTokenExchanger implements GoogleTokenExchanger {
  public lastCode: string | null = null;
  public lastRedirectUri: string | null = null;

  constructor(
    private readonly response: ExchangedTokens = {
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
    private readonly shouldFail: boolean = false,
  ) {}

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ExchangedTokens> {
    this.lastCode = code;
    this.lastRedirectUri = redirectUri;
    if (this.shouldFail) {
      throw new OAuthExchangeError("Simulated OAuth exchange failure.");
    }
    return this.response;
  }
}

/**
 * PostgreSQL-style default-selection: if GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are both set, real Google OAuth exchange is
 * used; otherwise this falls back to a Fake exchanger and logs a loud
 * warning — same fallback discipline as
 * persistence/postgres/StorageBackend.ts's defaultStorageBackend().
 */
export function defaultGoogleOAuthExchanger(): GoogleTokenExchanger {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HadeelOS] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set — " +
        "falling back to a fake OAuth exchanger. /api/calendar/oauth/exchange " +
        "and /api/gmail/oauth/exchange will not reach real Google APIs. Set " +
        "both environment variables to enable real Calendar/Gmail connections.",
    );
    return new FakeGoogleOAuthTokenExchanger();
  }
  return new GoogleOAuthTokenExchanger(clientId, clientSecret);
}
