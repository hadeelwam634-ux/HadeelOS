import type { Clock } from "../application/types";
import type { SignalIngestionService } from "../application/SignalIngestionService";
import type { SignalStoreEntry, UUID } from "../types";
import type { CalendarConnectionRepository } from "./CalendarConnectionRepository";
import type { CalendarProvider } from "./CalendarProvider";
import { UnknownCalendarConnectionError } from "./errors";
import type { CalendarConnection, CalendarSyncResult, ConnectCalendarCommand } from "./types";

const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The sole Application Service for the calendar bounded context. Routes
 * may only call this service, never CalendarConnectionRepository or
 * CalendarProvider directly (repo-wide Application-Service-only
 * orchestration boundary).
 */
export class CalendarSignalService {
  constructor(
    private readonly connectionRepository: CalendarConnectionRepository,
    private readonly calendarProvider: CalendarProvider,
    private readonly signalIngestionService: SignalIngestionService,
    private readonly clock: Clock,
  ) {}

  async connect(command: ConnectCalendarCommand): Promise<void> {
    const connection: CalendarConnection = {
      userId: command.userId,
      calendarId: command.calendarId,
      accessToken: command.accessToken,
      refreshToken: command.refreshToken,
      expiresAt: command.expiresAt,
      connectedAt: this.clock.now(),
    };
    await this.connectionRepository.upsert(connection);
  }

  async disconnect(userId: UUID): Promise<void> {
    await this.connectionRepository.delete(userId);
  }

  async getConnection(userId: UUID): Promise<CalendarConnection | null> {
    return this.connectionRepository.findByUserId(userId);
  }

  async sync(userId: UUID): Promise<CalendarSyncResult> {
    const connection = await this.connectionRepository.findByUserId(userId);
    if (connection === null) {
      throw new UnknownCalendarConnectionError(userId);
    }

    const freshConnection = await this.ensureFreshToken(connection);

    const windowStart = new Date(this.clock.now());
    const windowEnd = new Date(windowStart.getTime() + SYNC_WINDOW_MS);

    const events = await this.calendarProvider.listUpcomingEvents(
      freshConnection,
      windowStart,
      windowEnd,
    );

    // Data minimization: only a derived count is persisted as a signal.
    // Raw event content (titles, attendees, etc.) is never stored beyond
    // this single computation.
    const entry: SignalStoreEntry = {
      signalType: "meeting_count",
      latestValue: events.length,
      latestTimestamp: windowStart.toISOString(),
      reliabilityScore: 1,
      syncConsistencyDays: 0,
    };

    await this.signalIngestionService.ingest([entry]);

    return {
      eventCount: events.length,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  private async ensureFreshToken(connection: CalendarConnection): Promise<CalendarConnection> {
    const isExpired = new Date(connection.expiresAt).getTime() <= new Date(this.clock.now()).getTime();
    if (!isExpired) {
      return connection;
    }

    const refreshed = await this.calendarProvider.refreshAccessToken(connection);
    if (refreshed === null) {
      return connection;
    }

    const updated: CalendarConnection = {
      ...connection,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    await this.connectionRepository.upsert(updated);
    return updated;
  }
}
