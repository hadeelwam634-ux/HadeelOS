-- HadeelOS Decision Engine — Postgres schema (PR #11: PostgreSQL Adapter v1)
--
-- Drop-in storage backend for SignalStoreRepository and EventLogRepository.
-- No application code outside src/persistence/postgres/ should ever need to
-- know these tables exist — everything else talks to the repository
-- interfaces only.

CREATE TABLE IF NOT EXISTS signal_store (
  signal_type TEXT PRIMARY KEY,
  latest_value_number DOUBLE PRECISION,
  latest_value_text TEXT,
  latest_value_kind TEXT NOT NULL,
  latest_timestamp TIMESTAMPTZ NOT NULL,
  reliability_score DOUBLE PRECISION NOT NULL,
  sync_consistency_days INTEGER NOT NULL
);

-- `seq` is a storage-only insertion-order tiebreaker (business code never
-- reads or writes it) — it exists because two EventLogEntry rows can
-- legitimately share the same `timestamp` value, and the append-only
-- contract requires findByDecisionId/getAll to reconstruct true insertion
-- order, not just chronological order.
CREATE TABLE IF NOT EXISTS event_log (
  seq SERIAL PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  decision_id UUID NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  signals_snapshot JSONB NOT NULL,
  recommendation JSONB,
  user_action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_timestamp TIMESTAMPTZ,
  experiment_id UUID
);

CREATE INDEX IF NOT EXISTS event_log_decision_id_idx ON event_log (decision_id);
