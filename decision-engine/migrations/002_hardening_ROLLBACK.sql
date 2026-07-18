-- Reverse of migrations/002_hardening.sql. Only run this if
-- release/mvp-rc1's hardening changes must be fully reverted BEFORE any
-- real user data has been written against the new schema (dropping these
-- tables is destructive and irreversible). See README "Migrations &
-- Rollback" for the decision tree.

DROP TABLE IF EXISTS gmail_connections;
DROP TABLE IF EXISTS calendar_connections;
DROP TABLE IF EXISTS hypotheses;
DROP TABLE IF EXISTS kg_maturity_transitions;
DROP TABLE IF EXISTS kg_edges;
DROP TABLE IF EXISTS kg_nodes;
DROP TABLE IF EXISTS memory_governance_records;
DROP TABLE IF EXISTS memory_records;
DROP TABLE IF EXISTS digital_twin_snapshots;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

ALTER TABLE event_log DROP COLUMN IF EXISTS user_id;

ALTER TABLE signal_store DROP CONSTRAINT IF EXISTS signal_store_pkey;
ALTER TABLE signal_store DROP COLUMN IF EXISTS user_id;
ALTER TABLE signal_store ADD PRIMARY KEY (signal_type);
