import { describe, expect, it } from "vitest";
import { Clock } from "../../src/application/types";
import { SignalIngestionService } from "../../src/application/SignalIngestionService";
import { InMemorySignalStoreRepository } from "../../src/persistence/InMemorySignalStoreRepository";
import { InMemoryGmailConnectionRepository } from "../../src/gmail/InMemoryGmailConnectionRepository";
import { GmailSignalService } from "../../src/gmail/GmailSignalService";
import { FakeGmailProvider } from "../../src/gmail/FakeGmailProvider";
import { UnknownGmailConnectionError } from "../../src/gmail/errors";

class FakeClock implements Clock {
  private current = Date.parse("2026-07-17T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

function buildService(unreadCount = 0, refreshResult: { accessToken: string; expiresAt: string } | null = null) {
  const connectionRepository = new InMemoryGmailConnectionRepository();
  const signalStoreRepository = new InMemorySignalStoreRepository();
  const signalIngestionService = new SignalIngestionService(signalStoreRepository);
  const gmailProvider = new FakeGmailProvider(unreadCount, refreshResult);
  const clock = new FakeClock();
  const service = new GmailSignalService(connectionRepository, gmailProvider, signalIngestionService, clock);
  return { service, connectionRepository, signalStoreRepository, clock };
}

const userId = "user-1";

describe("GmailSignalService.connect/getConnection/disconnect", () => {
  it("stores a connection and returns it via getConnection", async () => {
    const { service, clock } = buildService();
    await service.connect({
      userId,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-07-18T00:00:00.000Z",
    });

    const connection = await service.getConnection(userId);
    expect(connection).not.toBeNull();
    expect(connection?.connectedAt).toBe(clock.now());
  });

  it("returns null for a user with no connection", async () => {
    const { service } = buildService();
    expect(await service.getConnection(userId)).toBeNull();
  });

  it("disconnect removes the connection", async () => {
    const { service } = buildService();
    await service.connect({ userId, accessToken: "a", refreshToken: null, expiresAt: "2026-07-18T00:00:00.000Z" });
    await service.disconnect(userId);
    expect(await service.getConnection(userId)).toBeNull();
  });

  it("disconnect on a user with no connection is a no-op", async () => {
    const { service } = buildService();
    await expect(service.disconnect(userId)).resolves.toBeUndefined();
  });
});

describe("GmailSignalService.sync", () => {
  it("throws UnknownGmailConnectionError when no connection exists", async () => {
    const { service } = buildService();
    await expect(service.sync(userId)).rejects.toBeInstanceOf(UnknownGmailConnectionError);
  });

  it("persists a custom:unread_email_count signal from the provider's count", async () => {
    const { service, signalStoreRepository } = buildService(7);
    await service.connect({ userId, accessToken: "a", refreshToken: null, expiresAt: "2099-01-01T00:00:00.000Z" });

    const result = await service.sync(userId);
    expect(result.unreadCount).toBe(7);

    const store = await signalStoreRepository.getAll();
    expect(store["custom:unread_email_count"]?.latestValue).toBe(7);
  });

  it("never persists anything beyond the derived count", async () => {
    const { service, signalStoreRepository } = buildService(3);
    await service.connect({ userId, accessToken: "a", refreshToken: null, expiresAt: "2099-01-01T00:00:00.000Z" });
    await service.sync(userId);

    const store = await signalStoreRepository.getAll();
    const entry = store["custom:unread_email_count"];
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      ["latestTimestamp", "latestValue", "reliabilityScore", "signalType", "syncConsistencyDays"].sort(),
    );
  });

  it("refreshes an expired access token before syncing and persists the refreshed token", async () => {
    const refreshResult = { accessToken: "new-access-token", expiresAt: "2026-07-18T12:00:00.000Z" };
    const { service, connectionRepository } = buildService(1, refreshResult);

    await service.connect({
      userId,
      accessToken: "stale-access-token",
      refreshToken: "refresh-1",
      expiresAt: "2026-07-17T00:00:00.000Z",
    });

    await service.sync(userId);

    const stored = await connectionRepository.findByUserId(userId);
    expect(stored?.accessToken).toBe("new-access-token");
    expect(stored?.expiresAt).toBe(refreshResult.expiresAt);
  });

  it("keeps the existing token when the provider has no refresh result", async () => {
    const { service, connectionRepository } = buildService(0, null);
    await service.connect({
      userId,
      accessToken: "stale-access-token",
      refreshToken: null,
      expiresAt: "2026-07-17T00:00:00.000Z",
    });

    await service.sync(userId);

    const stored = await connectionRepository.findByUserId(userId);
    expect(stored?.accessToken).toBe("stale-access-token");
  });
});
