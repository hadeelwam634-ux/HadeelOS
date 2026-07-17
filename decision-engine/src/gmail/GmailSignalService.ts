import type { Clock } from "../application/types";
import type { SignalIngestionService } from "../application/SignalIngestionService";
import type { SignalStoreEntry, UUID } from "../types";
import type { GmailConnectionRepository } from "./GmailConnectionRepository";
import type { GmailProvider } from "./GmailProvider";
import { UnknownGmailConnectionError } from "./errors";
import type { ConnectGmailCommand, GmailConnection, GmailSyncResult } from "./types";

/**
 * The sole Application Service for the Gmail bounded context, mirroring
 * CalendarSignalService's structure from PR #13. Routes may only call
 * this service, never GmailConnectionRepository or GmailProvider
 * directly.
 *
 * The signal this derives, "unread_email_count", is not one of the
 * pre-existing KnownSignalType values (src/types.ts) — rather than
 * widening that union for a single new integration, this uses the
 * `custom:${string}` extension point the type was explicitly designed
 * to support (see src/types.ts's own comment on SignalType).
 */
const UNREAD_EMAIL_COUNT_SIGNAL = "custom:unread_email_count" as const;

export class GmailSignalService {
  constructor(
    private readonly connectionRepository: GmailConnectionRepository,
    private readonly gmailProvider: GmailProvider,
    private readonly signalIngestionService: SignalIngestionService,
    private readonly clock: Clock,
  ) {}

  async connect(command: ConnectGmailCommand): Promise<void> {
    const connection: GmailConnection = {
      userId: command.userId,
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

  async getConnection(userId: UUID): Promise<GmailConnection | null> {
    return this.connectionRepository.findByUserId(userId);
  }

  async sync(userId: UUID): Promise<GmailSyncResult> {
    const connection = await this.connectionRepository.findByUserId(userId);
    if (connection === null) {
      throw new UnknownGmailConnectionError(userId);
    }

    const freshConnection = await this.ensureFreshToken(connection);

    // Data minimization: GmailProvider.countUnread() only ever returns
    // an integer — no message subject, sender, or body can reach this
    // service even in principle (see GmailProvider's doc comment).
    const unreadCount = await this.gmailProvider.countUnread(freshConnection);

    const syncedAt = this.clock.now();
    const entry: SignalStoreEntry = {
      signalType: UNREAD_EMAIL_COUNT_SIGNAL,
      latestValue: unreadCount,
      latestTimestamp: syncedAt,
      reliabilityScore: 1,
      syncConsistencyDays: 0,
    };

    await this.signalIngestionService.ingest([entry]);

    return { unreadCount, syncedAt };
  }

  private async ensureFreshToken(connection: GmailConnection): Promise<GmailConnection> {
    const isExpired = new Date(connection.expiresAt).getTime() <= new Date(this.clock.now()).getTime();
    if (!isExpired) {
      return connection;
    }

    const refreshed = await this.gmailProvider.refreshAccessToken(connection);
    if (refreshed === null) {
      return connection;
    }

    const updated: GmailConnection = {
      ...connection,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    await this.connectionRepository.upsert(updated);
    return updated;
  }
}
