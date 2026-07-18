import { describe, expect, it, vi } from "vitest";
import { GoogleOAuthTokenExchanger } from "../../src/security/googleOAuth";
import { OAuthExchangeError } from "../../src/security/errors";

function fakeFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.fn().mockResolvedValue(response as Response);
}

describe("GoogleOAuthTokenExchanger", () => {
  it("posts the authorization code to Google's token endpoint and returns the parsed tokens", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    } as any);
    const exchanger = new GoogleOAuthTokenExchanger("client-id", "client-secret", fetchImpl as any);

    const result = await exchanger.exchangeAuthorizationCode("the-code", "https://app.example.test/callback");

    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = (fetchImpl.mock.calls[0][1] as RequestInit).body as string;
    expect(body).toContain("client_secret=client-secret");
    expect(body).toContain("code=the-code");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("throws OAuthExchangeError on a non-OK response", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 400 } as any);
    const exchanger = new GoogleOAuthTokenExchanger("id", "secret", fetchImpl as any);
    await expect(exchanger.exchangeAuthorizationCode("bad-code", "https://x/callback")).rejects.toThrow(
      OAuthExchangeError,
    );
  });

  it("throws OAuthExchangeError when the network call itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const exchanger = new GoogleOAuthTokenExchanger("id", "secret", fetchImpl as any);
    await expect(exchanger.exchangeAuthorizationCode("code", "https://x/callback")).rejects.toThrow(
      OAuthExchangeError,
    );
  });

  it("treats a missing refresh_token in the response as null", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => ({ access_token: "at-only", expires_in: 1800 }),
    } as any);
    const exchanger = new GoogleOAuthTokenExchanger("id", "secret", fetchImpl as any);
    const result = await exchanger.exchangeAuthorizationCode("code", "https://x/callback");
    expect(result.refreshToken).toBeNull();
  });
});
