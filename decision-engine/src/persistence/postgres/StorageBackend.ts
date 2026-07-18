import { UUID } from "../../types";
import { Pool, PoolConfig } from "pg";
import { createPostgresPool, runMigrations } from "./pool";
import { InMemorySignalStoreRepository } from "../InMemorySignalStoreRepository";
import { InMemoryEventLogRepository } from "../InMemoryEventLogRepository";
import { PostgresSignalStoreRepository } from "./PostgresSignalStoreRepository";
import { PostgresEventLogRepository } from "./PostgresEventLogRepository";
import { SignalStoreRepository } from "../SignalStoreRepository";
import { EventLogRepository } from "../EventLogRepository";
import { InMemoryDigitalTwinRepository } from "../../twin/InMemoryDigitalTwinRepository";
import { PostgresDigitalTwinRepository } from "../../twin/PostgresDigitalTwinRepository";
import { DigitalTwinRepository } from "../../twin/DigitalTwinRepository";
import { InMemoryMemoryRepository } from "../../memory/InMemoryMemoryRepository";
import { PostgresMemoryRepository } from "../../memory/PostgresMemoryRepository";
import { MemoryRepository } from "../../memory/MemoryRepository";
import { InMemoryKnowledgeGraphRepository } from "../../knowledge-graph/InMemoryKnowledgeGraphRepository";
import { PostgresKnowledgeGraphRepository } from "../../knowledge-graph/PostgresKnowledgeGraphRepository";
import { KnowledgeGraphRepository } from "../../knowledge-graph/KnowledgeGraphRepository";
import { InMemoryHypothesisRepository } from "../../learning/InMemoryHypothesisRepository";
import { PostgresHypothesisRepository } from "../../learning/PostgresHypothesisRepository";
import { HypothesisRepository } from "../../learning/HypothesisRepository";
import { InMemoryCalendarConnectionRepository } from "../../calendar/InMemoryCalendarConnectionRepository";
import { PostgresCalendarConnectionRepository } from "../../calendar/PostgresCalendarConnectionRepository";
import { CalendarConnectionRepository } from "../../calendar/CalendarConnectionRepository";
import { InMemoryGmailConnectionRepository } from "../../gmail/InMemoryGmailConnectionRepository";
import { PostgresGmailConnectionRepository } from "../../gmail/PostgresGmailConnectionRepository";
import { GmailConnectionRepository } from "../../gmail/GmailConnectionRepository";
import { Queryable } from "./Queryable";

export type StorageMode = "postgres" | "in-memory";

/** Every per-user repository AppContainer.forUser() needs, for one userId. */
export interface UserScopedRepositories {
  signalStoreRepository: SignalStoreRepository;
  eventLogRepository: EventLogRepository;
  digitalTwinRepository: DigitalTwinRepository;
  memoryRepository: MemoryRepository;
  knowledgeGraphRepository: KnowledgeGraphRepository;
  hypothesisRepository: HypothesisRepository;
  calendarConnectionRepository: CalendarConnectionRepository;
  gmailConnectionRepository: GmailConnectionRepository;
}

/**
 * Chooses and constructs the repositories backing every per-user domain
 * (signal store, event log, digital twin, memory, knowledge graph,
 * hypotheses, calendar/gmail connections). Two implementations:
 * InMemoryStorageBackend (test/local-dev default, no persistence across
 * restarts) and PostgresStorageBackend (production default — see
 * defaultStorageBackend() below). AppContainer's public shape never
 * changes when swapping backends, only which concrete repository
 * classes buildUserRepositories() returns — this is the seam
 * container.ts's own doc comment anticipated since PR #11.
 */
export interface StorageBackend {
  readonly mode: StorageMode;
  buildUserRepositories(userId: UUID): UserScopedRepositories;
  /** Applies pending migrations (no-op for in-memory). Call once at startup. */
  ensureReady(): Promise<void>;
  /** Releases underlying connections (no-op for in-memory). Call on graceful shutdown. */
  close(): Promise<void>;
}

export class InMemoryStorageBackend implements StorageBackend {
  readonly mode: StorageMode = "in-memory";

  buildUserRepositories(_userId: UUID): UserScopedRepositories {
    return {
      signalStoreRepository: new InMemorySignalStoreRepository(),
      eventLogRepository: new InMemoryEventLogRepository(),
      digitalTwinRepository: new InMemoryDigitalTwinRepository(),
      memoryRepository: new InMemoryMemoryRepository(),
      knowledgeGraphRepository: new InMemoryKnowledgeGraphRepository(),
      hypothesisRepository: new InMemoryHypothesisRepository(),
      calendarConnectionRepository: new InMemoryCalendarConnectionRepository(),
      gmailConnectionRepository: new InMemoryGmailConnectionRepository(),
    };
  }

  async ensureReady(): Promise<void> {}
  async close(): Promise<void> {}
}

export class PostgresStorageBackend implements StorageBackend {
  readonly mode: StorageMode = "postgres";

  constructor(private readonly pool: Pool) {}

  buildUserRepositories(userId: UUID): UserScopedRepositories {
    const db: Queryable = this.pool;
    return {
      signalStoreRepository: new PostgresSignalStoreRepository(db, userId),
      eventLogRepository: new PostgresEventLogRepository(db, userId),
      digitalTwinRepository: new PostgresDigitalTwinRepository(db, userId),
      memoryRepository: new PostgresMemoryRepository(db, userId),
      knowledgeGraphRepository: new PostgresKnowledgeGraphRepository(db, userId),
      hypothesisRepository: new PostgresHypothesisRepository(db, userId),
      // Calendar/Gmail connection repos are not constructor-bound to a
      // single userId (their interface already takes userId per method,
      // and both encrypt tokens internally) — one shared instance is
      // sufficient and mirrors how they're used elsewhere.
      calendarConnectionRepository: new PostgresCalendarConnectionRepository(db),
      gmailConnectionRepository: new PostgresGmailConnectionRepository(db),
    };
  }

  async ensureReady(): Promise<void> {
    await runMigrations(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let sharedPool: Pool | undefined;

/** One Pool per process, reused by every PostgresStorageBackend/PostgresAuthBackend instance. */
export function getSharedPostgresPool(config?: PoolConfig): Pool {
  if (!sharedPool) {
    const connectionString = config?.connectionString ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set — cannot construct a Postgres connection pool. " +
          "Set DATABASE_URL, or explicitly pass an InMemoryStorageBackend for local dev/tests.",
      );
    }
    const ssl =
      process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined;
    sharedPool = createPostgresPool({ connectionString, ssl, ...config });
  }
  return sharedPool;
}

/** Test-only escape hatch: forces the next getSharedPostgresPool() call to create a fresh Pool. */
export function resetSharedPostgresPool(): void {
  sharedPool = undefined;
}

/**
 * PostgreSQL is the default, production storage backend for HadeelOS:
 * if DATABASE_URL is set, every repository is Postgres-backed and data
 * survives process restarts. Without it, the process falls back to
 * InMemoryStorageBackend and logs a loud warning — this fallback exists
 * only for local development and the test suite (where no test ever
 * sets DATABASE_URL), never for a real deployment. See README
 * "Environment Variables" and the MVP Hardening final report's
 * "production blockers" section for why DATABASE_URL is mandatory
 * before any real personal use.
 */
export function defaultStorageBackend(): StorageBackend {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.warn(
      "[HadeelOS] DATABASE_URL is not set — falling back to in-memory storage. " +
        "ALL DATA WILL BE LOST ON RESTART. This is expected for local development " +
        "and tests, but must never happen in a real deployment. Set DATABASE_URL " +
        "to enable the default, persistent Postgres backend.",
    );
    return new InMemoryStorageBackend();
  }
  return new PostgresStorageBackend(getSharedPostgresPool({ connectionString }));
}
