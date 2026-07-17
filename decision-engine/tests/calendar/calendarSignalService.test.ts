import { describe, expect, it } from "vitest";
import { Clock } from "../../src/application/types";
import { SignalIngestionService } from "../../src/application/SignalIngestionService";
import { InMemorySignalStoreRepository } from "../../src/persistence/InMemorySignalStoreRepository";
import { InMemoryCalendarConnectionRepository } from "../../src/calendar/InMemoryCalendarConnectionRepository";
import { CalendarSignalService } from "../../src/calendar/CalendarSignalService";
import { FakeCalendarProvider } from "../../src/calendar/FakeCalendarProvider";
import { UnknownCalendarConnectionError } from "../../src/calendar/errors";
import { CalendarEvent } from "../../src/calendar/types";

class FakeClock implements Clock {
  private current = Date.parse("2026-07-17T06:00:00.000Z");
  now(): string {
    return new Date(this.current).toISOString();
  }
  advanceMs(ms: number): void {
    this.current += ms;
  }
}

function buildService(events: CalendarEvent[] = [], refreshResult: { accessToken: string; expiresAt: string } | null = null) {
  const connectionRepository = new InMemoryCalendarConnectionRepository();
  const signalStoreRepository = new InMemorySignalStoreRepository();
  const signalIngestionService = new SignalIngestionService(signalStoreRepository);
  const calendarProvider = new FakeCalendarProvider(events, refreshResult);
  const clock = new FakeClock();
  const service = new CalendarSignalService(connectionRepository, calendarProvider, signalIngestionService, clock);
  return { service, connectionRepository, signalStoreRepository, clock, calendarProvider };
}

const userId = "user-1";

describe("CalendarSignalService.connect/getConnection/disconnect", () => {
  it("stores a connection and returns it via getConnection", async () => {
    const { service, clock } = buildService();
    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-07-18T00:00:00.000Z",
    });

    const connection = await service.getConnection(userId);
    expect(connection).not.toBeNull();
    expect(connection?.calendarId).toBe("primary");
    expect(connection?.connectedAt).toBe(clock.now());
  });

  it("returns null for a user with no connection", async () => {
    const { service } = buildService();
    const connection = await service.getConnection(userId);
    expect(connection).toBeNull();
  });

  it("disconnect removes the connection", async () => {
    const { service } = buildService();
    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "access-1",
      refreshToken: null,
      expiresAt: "2026-07-18T00:00:00.000Z",
    });
    await service.disconnect(userId);
    expect(await service.getConnection(userId)).toBeNull();
  });

  it("disconnect on a user with no connection is a no-op", async () => {
    const { service } = buildService();
    await expect(service.disconnect(userId)).resolves.toBeUndefined();
  });
});

describe("CalendarSignalService.sync", () => {
  it("throws UnknownCalendarConnectionError when no connection exists", async () => {
    const { service } = buildService();
    await expect(service.sync(userId)).rejects.toBeInstanceOf(UnknownCalendarConnectionError);
  });

  it("counts only events within the 24h sync window and persists a meeting_count signal", async () => {
    const events: CalendarEvent[] = [
      { id: "e1", title: "Standup", start: "2026-07-17T07:00:00.000Z", end: "2026-07-17T07:30:00.000Z", isAllDay: false },
      { id: "e2", title: "Design review", start: "2026-07-17T20:00:00.000Z", end: "2026-07-17T21:00:00.000Z", isAllDay: false },
      { id: "e3", title: "Next week", start: "2026-07-25T09:00:00.000Z", end: "2026-07-25T10:00:00.000Z", isAllDay: false },
    ];
    const { service, signalStoreRepository } = buildService(events);
    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "access-1",
      refreshToken: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const result = await service.sync(userId);
    expect(result.eventCount).toBe(2);

    const store = await signalStoreRepository.getAll();
    expect(store.meeting_count?.latestValue).toBe(2);
    expect(store.meeting_count?.signalType).toBe("meeting_count");
  });

  it("never persists raw event content — only the derived count", async () => {
    const events: CalendarEvent[] = [
      { id: "e1", title: "Sensitive 1:1", start: "2026-07-17T07:00:00.000Z", end: "2026-07-17T07:30:00.000Z", isAllDay: false },
    ];
    const { service, signalStoreRepository } = buildService(events);
    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "access-1",
      refreshToken: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await service.sync(userId);

    const store = await signalStoreRepository.getAll();
    const serialized = JSON.stringify(store);
    expect(serialized).not.toContain("Sensitive 1:1");
    expect(typeof store.meeting_count?.latestValue).toBe("number");
  });

  it("refreshes an expired access token before syncing and persists the refreshed token", async () => {
    const events: CalendarEvent[] = [
      { id: "e1", title: "Standup", start: "2026-07-17T07:00:00.000Z", end: "2026-07-17T07:30:00.000Z", isAllDay: false },
    ];
    const refreshResult = { accessToken: "new-access-token", expiresAt: "2026-07-18T12:00:00.000Z" };
    const { service, connectionRepository } = buildService(events, refreshResult);

    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "stale-access-token",
      refreshToken: "refresh-1",
      // Already expired relative to the FakeClock's fixed "now".
      expiresAt: "2026-07-17T00:00:00.000Z",
    });

    await service.sync(userId);

    const stored = await connectionRepository.findByUserId(userId);
    expect(stored?.accessToken).toBe("new-access-token");
    expect(stored?.expiresAt).toBe(refreshResult.expiresAt);
  });

  it("keeps the existing token when the provider has no refresh result", async () => {
    const { service, connectionRepository } = buildService([], null);
    await service.connect({
      userId,
      calendarId: "primary",
      accessToken: "stale-access-token",
      refreshToken: null,
      expiresAt: "2026-07-17T00:00:00.000Z",
    });

    await service.sync(userId);

    const stored = await connectionRepository.findByUserId(userId);
    expect(stored?.accessToken).toBe("stale-access-token");
  });
});
