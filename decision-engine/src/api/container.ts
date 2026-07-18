import { UUID } from "../types";
import { RandomIdGenerator, SystemClock, IdGenerator, Clock } from "../application/types";
import { DecisionApplicationService } from "../application/DecisionApplicationService";
import { TodayDecisionApplicationService, TodayDecisionResult } from "../application/TodayDecisionApplicationService";
import { SignalIngestionService } from "../application/SignalIngestionService";
import { DecisionLifecycleService } from "../application/DecisionLifecycleService";
import { DigitalTwinService } from "../twin/DigitalTwinService";
import { MemoryMapService } from "../memory/MemoryMapService";
import { MemoryGovernanceService } from "../memory/MemoryGovernanceService";
import { KnowledgeGraphService } from "../knowledge-graph/KnowledgeGraphService";
import { HypothesisService } from "../learning/HypothesisService";
import { CalendarSignalService, CalendarProvider, FakeCalendarProvider } from "../calendar";
import { GmailSignalService, GmailProvider, FakeGmailProvider } from "../gmail";
import { StorageBackend, InMemoryStorageBackend, defaultStorageBackend } from "../persistence/postgres/StorageBackend";
import { GoogleTokenExchanger, defaultGoogleOAuthExchanger } from "../security/googleOAuth";

/**
 * Everything one authenticated user's requests are allowed to touch.
 * Every repository instance here is created fresh per userId and never
 * shared across users — this is what "every request bound to userId;
 * no state sharing between users" (PR #9's non-negotiable rule) means:
 * isolation by construction rather than by a runtime userId filter on
 * shared storage.
 *
 * MVP Hardening: the repositories themselves now come from an injected
 * StorageBackend (see persistence/postgres/StorageBackend.ts) instead
 * of being hardcoded to InMemory* classes. PostgresStorageBackend scopes
 * every query by the same userId this file constructs it with, so a
 * request for a decisionId/memoryId that belongs to a *different*
 * user's container still structurally 404s — isolation now holds at the
 * database layer too, not just by container-instance construction.
 */
export interface UserServices {
  readonly userId: UUID;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly signalIngestionService: SignalIngestionService;
  readonly decisionApplicationService: DecisionApplicationService;
  readonly todayDecisionApplicationService: TodayDecisionApplicationService;
  readonly decisionLifecycleService: DecisionLifecycleService;
  readonly memoryMapService: MemoryMapService;
  readonly memoryGovernanceService: MemoryGovernanceService;
  readonly knowledgeGraphService: KnowledgeGraphService;
  readonly hypothesisService: HypothesisService;
  readonly calendarSignalService: CalendarSignalService;
  readonly gmailSignalService: GmailSignalService;
  /**
   * The most recent TodayDecisionResult produced by POST
   * /api/today/recalculate for this user, so GET /api/today has
   * something to return without re-running the whole pipeline. This is
   * an in-memory cache only regardless of storage backend — recomputed
   * on demand, never itself persisted.
   */
  lastToday: TodayDecisionResult | null;
}

function buildUserServices(
  userId: UUID,
  idGenerator: IdGenerator,
  clock: Clock,
  calendarProvider: CalendarProvider,
  gmailProvider: GmailProvider,
  storageBackend: StorageBackend,
): UserServices {
  const {
    signalStoreRepository,
    eventLogRepository,
    digitalTwinRepository,
    memoryRepository,
    knowledgeGraphRepository,
    hypothesisRepository,
    calendarConnectionRepository,
    gmailConnectionRepository,
  } = storageBackend.buildUserRepositories(userId);

  const digitalTwinService = new DigitalTwinService(digitalTwinRepository, idGenerator, clock);
  const memoryMapService = new MemoryMapService(memoryRepository);
  const memoryGovernanceService = new MemoryGovernanceService(memoryRepository, idGenerator, clock);
  const knowledgeGraphService = new KnowledgeGraphService(knowledgeGraphRepository, idGenerator, clock);
  const hypothesisService = new HypothesisService(hypothesisRepository, idGenerator);
  const signalIngestionServiceForCalendar = new SignalIngestionService(signalStoreRepository);
  const calendarSignalService = new CalendarSignalService(
    calendarConnectionRepository,
    calendarProvider,
    signalIngestionServiceForCalendar,
    clock,
  );
  const signalIngestionServiceForGmail = new SignalIngestionService(signalStoreRepository);
  const gmailSignalService = new GmailSignalService(
    gmailConnectionRepository,
    gmailProvider,
    signalIngestionServiceForGmail,
    clock,
  );

  return {
    userId,
    idGenerator,
    clock,
    signalIngestionService: new SignalIngestionService(signalStoreRepository),
    decisionApplicationService: new DecisionApplicationService(
      signalStoreRepository,
      eventLogRepository,
      idGenerator,
      clock
    ),
    todayDecisionApplicationService: new TodayDecisionApplicationService(
      signalStoreRepository,
      eventLogRepository,
      digitalTwinService,
      memoryMapService,
      memoryGovernanceService,
      knowledgeGraphService,
      hypothesisService,
      idGenerator,
      clock
    ),
    decisionLifecycleService: new DecisionLifecycleService(eventLogRepository, idGenerator, clock),
    memoryMapService,
    memoryGovernanceService,
    knowledgeGraphService,
    hypothesisService,
    calendarSignalService,
    gmailSignalService,
    lastToday: null,
  };
}

/**
 * Lazily creates and memoizes one UserServices bundle per userId.
 * Injectable idGenerator/clock factories keep this testable/
 * deterministic the same way every other service in this codebase is
 * (see application/types.ts) — tests can supply a fixed Clock/IdGenerator
 * instead of the real ones.
 */
export class AppContainer {
  private readonly perUser = new Map<UUID, UserServices>();

  constructor(
    private readonly idGeneratorFactory: () => IdGenerator = () => new RandomIdGenerator(),
    private readonly clockFactory: () => Clock = () => new SystemClock(),
    /**
     * A single CalendarProvider shared across every user's container
     * (unlike the repositories above, which are deliberately fresh per
     * user) — it holds no per-user state itself, only knows how to make
     * API calls given whatever CalendarConnection it is passed. Tests
     * inject a FakeCalendarProvider here; real usage should inject a
     * GoogleCalendarProvider built from real OAuth client credentials.
     */
    private readonly calendarProvider: CalendarProvider = new FakeCalendarProvider(),
    /**
     * A single GmailProvider shared across every user's container,
     * same rationale as calendarProvider above. Defaults to
     * FakeGmailProvider; real usage should inject a GoogleGmailProvider
     * built from real OAuth client credentials.
     */
    private readonly gmailProvider: GmailProvider = new FakeGmailProvider(),
    /**
     * Where every per-user repository actually lives. Defaults to
     * defaultStorageBackend(): Postgres if DATABASE_URL is set (the
     * production default), otherwise InMemoryStorageBackend (tests and
     * local dev only — see that function's doc comment). Tests that
     * want an explicitly isolated in-memory container regardless of
     * environment should pass `new InMemoryStorageBackend()` here.
     */
    private readonly storageBackend: StorageBackend = defaultStorageBackend(),
    /**
     * Server-side Google authorization-code exchanger shared across
     * every user (holds no per-user state — only client_id/client_secret
     * and a fetch function). Defaults to real Google OAuth if
     * GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are set, otherwise a Fake
     * exchanger for local dev/tests — see defaultGoogleOAuthExchanger()'s
     * doc comment. Used by /api/calendar/oauth/exchange and
     * /api/gmail/oauth/exchange (see routes/calendar.ts, routes/gmail.ts)
     * so the refresh token never has to transit through the browser.
     */
    readonly googleOAuthExchanger: GoogleTokenExchanger = defaultGoogleOAuthExchanger(),
  ) {}

  /** Postgres-backed deployments must call this once before serving traffic. */
  async ensureReady(): Promise<void> {
    await this.storageBackend.ensureReady();
  }

  get storageMode() {
    return this.storageBackend.mode;
  }

  forUser(userId: UUID): UserServices {
    let services = this.perUser.get(userId);
    if (services === undefined) {
      services = buildUserServices(
        userId,
        this.idGeneratorFactory(),
        this.clockFactory(),
        this.calendarProvider,
        this.gmailProvider,
        this.storageBackend,
      );
      this.perUser.set(userId, services);
    }
    return services;
  }
}

export { InMemoryStorageBackend };
