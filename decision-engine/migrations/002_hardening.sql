-- HadeelOS Decision Engine — Postgres schema hardening (MVP Hardening pass)
--
-- Context: PR #11 shipped Postgres adapters for signal_store/event_log
-- only, and they were NOT tenant-scoped (see README risk note "no
-- multi-tenant user_id scoping on Postgres tables"). This migration:
--
--   1. Adds user_id scoping to signal_store and event_log.
--   2. Creates tables for every remaining per-user domain that was
--      in-memory-only: digital twin snapshots, memory + its governance
--      log, the knowledge graph (nodes/edges/maturity transitions),
--      and hypotheses.
--   3. Creates calendar_connections / gmail_connections with
--      ENCRYPTED token columns (see src/security/tokenCipher.ts —
--      AES-256-GCM, key from TOKEN_ENCRYPTION_KEY env var, never
--      stored in the database or the repo).
--   4. Creates users / sessions, moving auth off InMemory.
--
-- Idempotent: every statement is safe to re-run against an
-- already-migrated database. See migrations/002_hardening_ROLLBACK.sql
-- for the reverse of every statement here, and README "Migrations &
-- Rollback" for when/how to run it.

-- ---- Re-scope PR #11 tables by user_id ----

ALTER TABLE signal_store ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE signal_store SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
ALTER TABLE signal_store ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE signal_store DROP CONSTRAINT IF EXISTS signal_store_pkey;
ALTER TABLE signal_store ADD PRIMARY KEY (user_id, signal_type);

ALTER TABLE event_log ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE event_log SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
ALTER TABLE event_log ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS event_log_user_id_idx ON event_log (user_id);

-- ---- users / sessions ----

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- ---- digital twin ----

CREATE TABLE IF NOT EXISTS digital_twin_snapshots (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  derived_at TIMESTAMPTZ NOT NULL,
  stress TEXT NOT NULL,
  energy_curve JSONB NOT NULL,
  decision_style TEXT,
  behavior_patterns JSONB NOT NULL,
  known_preferences JSONB NOT NULL,
  active_constraints JSONB NOT NULL,
  source_versions JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS digital_twin_snapshots_user_idx ON digital_twin_snapshots (user_id, derived_at);

-- ---- memory ----

CREATE TABLE IF NOT EXISTS memory_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  state TEXT NOT NULL,
  value JSONB,
  confidence DOUBLE PRECISION NOT NULL,
  evidence_count INTEGER NOT NULL,
  last_reinforced_at TIMESTAMPTZ NOT NULL,
  blocked BOOLEAN NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_records_user_key_idx ON memory_records (user_id, key);

CREATE TABLE IF NOT EXISTS memory_governance_records (
  seq SERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  memory_id UUID NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_state TEXT,
  next_state TEXT,
  reason TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_governance_records_memory_idx ON memory_governance_records (memory_id);

-- ---- knowledge graph ----

CREATE TABLE IF NOT EXISTS kg_nodes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  domain TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS kg_nodes_user_domain_idx ON kg_nodes (user_id, domain);

CREATE TABLE IF NOT EXISTS kg_edges (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  from_node_id UUID NOT NULL,
  to_node_id UUID NOT NULL,
  record_type TEXT NOT NULL,
  causal_maturity TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  evidence_count INTEGER NOT NULL,
  direction_basis TEXT NOT NULL,
  last_reinforced_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS kg_edges_from_idx ON kg_edges (user_id, from_node_id);
CREATE INDEX IF NOT EXISTS kg_edges_to_idx ON kg_edges (user_id, to_node_id);

CREATE TABLE IF NOT EXISTS kg_maturity_transitions (
  seq SERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  edge_id UUID NOT NULL,
  from_maturity TEXT NOT NULL,
  to_maturity TEXT NOT NULL,
  kind TEXT NOT NULL,
  previous_confidence DOUBLE PRECISION NOT NULL,
  next_confidence DOUBLE PRECISION NOT NULL,
  previous_evidence_count INTEGER NOT NULL,
  next_evidence_count INTEGER NOT NULL,
  reason TEXT,
  override_used BOOLEAN NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS kg_maturity_transitions_edge_idx ON kg_maturity_transitions (edge_id);

-- ---- hypotheses ----

CREATE TABLE IF NOT EXISTS hypotheses (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  statement TEXT NOT NULL,
  related_edge_id UUID NOT NULL,
  status TEXT NOT NULL,
  competing_hypothesis_id UUID,
  confidence DOUBLE PRECISION NOT NULL,
  evidence_count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hypotheses_user_related_edge_idx ON hypotheses (user_id, related_edge_id);

-- ---- calendar / gmail connections (ENCRYPTED tokens) ----

CREATE TABLE IF NOT EXISTS calendar_connections (
  user_id UUID PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id UUID PRIMARY KEY,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL
);
