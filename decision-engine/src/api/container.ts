import { UUID } from "../types";
import { RandomIdGenerator, SystemClock, IdGenerator, Clock } from "../application/types";
import { DecisionApplicationService } from "../application/DecisionApplicationService";
import { TodayDecisionApplicationService, TodayDecisionResult } from "../application/TodayDecisionApplicationService";
import { SignalIngestionService } from "../application/SignalIngestionService";
import { DecisionLifecycleService } from "../application/DecisionLifecycleService";
import { InMemorySignalStoreRepository } from "../persistence/InMemorySignalStoreRepository";
import { InMemoryEventLogRepository } from "../persistence/InMemoryEventLogRepository";
import { InMemoryDigitalTwinRepository } from "../twin/InMemoryDigitalTwinRepository";
import { DigitalTwinService } from "../twin/DigitalTwinService";
import { InMemoryMemoryRepository } from "../memory/InMemoryMemoryRepository";
import { MemoryMapService } from "../memory/MemoryMapService";
import { MemoryGovernanceService } from "../memory/MemoryGovernanceService";
import { InMemoryKnowledgeGraphRepository } from "../knowledge-graph/InMemoryKnowledgeGraphRepository";
import { KnowledgeGraphService } from "../knowledge-graph/KnowledgeGraphService";
import { InMemoryHypothesisRepository } from "../learning/InMemoryHypothesisRepository";
import { HypothesisService } from "../learning/HypothesisService";
import {
  CalendarSignalService,
  CalendarProvider,
  InMemoryCalendarConnectionRepository,
  FakeCalendarProvider,
} from "../calendar";

/**
 * Everything one authenticated user's requests are allowed to touch.
 * Every repository instance here is created fresh per userId and never
 * shared across users — this is what "every request bound to userId;
 * no state sharing between users" (PR #9's non-negotiable rule) means
 * in an in-memory, single-process API layer: isolation by construction
 * rather than by a runtime userId filter on shared storage. Because of
 * this, a request for a decisionId/memoryId that belongs to a
 * *different* user's container simply cannot be found — it structurally
 * 404s rather than needing an explicit cross-tenant ownership check
 * (see ForbiddenError's doc comment in errors.ts).
 *
 * PR #11 (PostgreSQL Adapter) replaces the InMemory* repositories
 * constructed here with Postgres-backed ones scoped by a `user_id`
 * column instead of by container instance — AppContainer's public
 * shape (the services it exposes) does not need to change for that
 * swap, only this file's construction of each repository.
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
  /**
   * The most recent TodayDecisionResult produced by POST
   * /api/today/recalculate for this user, so GET /api/today has
   * something to return without re-running the whole pipeline. This is
   * an in-memory cache only — like every other piece of state in this
   * container, it does not survive a process restart until PR #11.
   */
  lastToday: TodayDecisionResult | null;
}

function buildUserServices(
  userId: UUID,
  idGenerator: IdGenerator,
  clock: Clock,
  calendarProvider: CalendarProvider,
): UserServices {
  const signalStoreRepository = new InMemorySignalStoreRepository();
  const eventLogRepository = new InMemoryEventLogRepository();
  const digitalTwinRepository = new InMemoryDigitalTwinRepository();
  const memoryRepository = new InMemoryMemoryRepository();
  const knowledgeGraphRepository = new InMemoryKnowledgeGraphRepository();
  const hypothesisRepository = new InMemoryHypothesisRepository();
  const calendarConnectionRepository = new InMemoryCalendarConnectionRepository();

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
  ) {}

  forUser(userId: UUID): UserServices {
    let services = this.perUser.get(userId);
    if (services === undefined) {
      services = buildUserServices(
        userId,
        this.idGeneratorFactory(),
        this.clockFactory(),
        this.calendarProvider,
      );
      this.perUser.set(userId, services);
    }
    return services;
  }
}
