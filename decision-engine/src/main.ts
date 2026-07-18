/**
 * Real process entrypoint — the one piece of this codebase that has
 * never existed before MVP Hardening. Every other module in this
 * repository is exercised only through supertest's request(app) in
 * tests (createApp() returns a plain request-listener function, never
 * an actually-listening server) — this file is what a real deployment
 * (see README "Deployment") actually runs.
 *
 * Responsibilities, in order:
 *   1. Build the AppContainer (Postgres by default if DATABASE_URL is
 *      set — see defaultStorageBackend()).
 *   2. Run pending migrations against that Postgres database, if any
 *      (idempotent — safe on every restart).
 *   3. Start listening on PORT (default 3000).
 *   4. Handle SIGTERM/SIGINT for a graceful shutdown: stop accepting
 *      new connections, close the Postgres pool, then exit.
 *
 * This file intentionally contains no business logic — it only wires
 * already-tested pieces (AppContainer, createHttpApiServer, ConsoleLogger,
 * InMemoryMetricsCollector) together for a real OS process.
 */
import { createHttpApiServer } from "./api/server";
import { AppContainer } from "./api/container";
import { ConsoleLogger } from "./observability";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const logger = new ConsoleLogger();
  const container = new AppContainer();

  logger.log("info", "startup", { storageMode: container.storageMode, port });

  if (container.storageMode === "postgres") {
    logger.log("info", "running_migrations");
    await container.ensureReady();
    logger.log("info", "migrations_complete");
  }

  const staticDir = process.env.STATIC_DIR;
  const server = createHttpApiServer({ container, logger, staticDir });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  logger.log("info", "listening", { port });

  const shutdown = async (signal: string): Promise<void> => {
    logger.log("info", "shutting_down", { signal });
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[HadeelOS] Fatal startup error:", err);
  process.exit(1);
});
