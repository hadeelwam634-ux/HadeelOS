# Deployment (single-process recipe)

This document is preparation only — nothing described here has been deployed as
part of MVP Hardening, and no credentials were requested from Hadeel to write
it, per her explicit instruction.

## What "single-process" means here

One Node process (`decision-engine/src/main.ts`, run via `npm run start`) serves
both:

- the API, every `/api/*` route, unchanged from every other document in this
  repo, and
- the built frontend (`frontend/dist`, produced by `npm run build`), via the
  optional static-file handler in `decision-engine/src/staticFiles.ts`.

This is the simplest possible topology for a personal deployment: one
container/VM, one process, one port. It intentionally does not include a CDN,
a separate static host, a load balancer, or multiple replicas — none of those
are needed for one person's own use, and adding them now would be premature
complexity.

## Prerequisites

- A PostgreSQL database reachable from wherever this process runs (a managed
  Postgres instance — e.g. Neon, Supabase, Railway, RDS — is the simplest
  option for a solo deployment; self-hosting Postgres is also fine but is not
  covered here).
- A `TOKEN_ENCRYPTION_KEY` generated once and stored securely (see below) —
  losing it makes every previously-connected Calendar/Gmail token permanently
  unusable, requiring a reconnect.
- (Optional, only for real Google Calendar/Gmail connections rather than the
  mock-provider connect flow) A Google Cloud OAuth 2.0 Client ID + Secret.

## Steps

1. **Generate a `TOKEN_ENCRYPTION_KEY`** and store it in your deployment
   platform's secret manager (not in any file that gets committed):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. **Provision Postgres** and note its connection string as `DATABASE_URL`.
   No manual migration step is needed — `src/main.ts` runs
   `runMigrations()` automatically at startup (idempotent, safe to run on
   every deploy).

3. **Set environment variables** on the deployment platform (see the main
   README's "Environment Variables" table for the full list; at minimum:
   `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `PORT`).

4. **Build and run**, either via the provided `Dockerfile`:

   ```bash
   docker build -t hadeelos .
   docker run -p 3000:3000 \
     -e DATABASE_URL="postgres://..." \
     -e TOKEN_ENCRYPTION_KEY="..." \
     hadeelos
   ```

   or directly on a host with Node 20+:

   ```bash
   cd frontend && npm ci && npm run build && cd ..
   cd decision-engine && npm ci --omit=dev
   STATIC_DIR="$(pwd)/../frontend/dist" DATABASE_URL="..." TOKEN_ENCRYPTION_KEY="..." npm run start
   ```

5. **Verify**: `GET /api/system/health` should return `{"status":"ok",...}`,
   and the app's root URL should load the Today Cockpit UI.

## What this recipe deliberately does not cover

- **TLS/HTTPS termination** — put this process behind a reverse proxy (nginx,
  Caddy, or the deployment platform's own load balancer) that terminates TLS;
  the Node process itself only speaks plain HTTP.
- **A process manager / restart policy** — Docker's own restart policy
  (`--restart unless-stopped`) or the platform's native process supervision
  is sufficient for a single-process deployment; nothing extra is bundled.
- **Backups** — configure your Postgres provider's own backup/point-in-time
  recovery; this recipe does not add anything on top of that.
- **Multi-instance / horizontal scaling** — out of scope for a single-user
  deployment, and would require session/cache changes not made here (see the
  final report's "risks and technical debt" section).
