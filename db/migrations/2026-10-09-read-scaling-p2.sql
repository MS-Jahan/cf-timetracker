-- Read-scaling phase 2 (docs/2026-10-09-read-scaling-plan.md). Idempotent; safe to run
-- before or after deploying 0.19.0 (the Worker works without these, just slower).
-- Composite indexes serve "ORDER BY start_time DESC, id DESC" with keyset cursors and the
-- per-client / per-project / per-activity filtered ledgers. Each supersedes a single-column
-- index on the same leading column, which is dropped.
CREATE INDEX IF NOT EXISTS idx_entries_start_id ON time_entries(start_time, id);
CREATE INDEX IF NOT EXISTS idx_entries_customer_start ON time_entries(customer_id, start_time, id);
CREATE INDEX IF NOT EXISTS idx_entries_project_start ON time_entries(project_id, start_time, id);
CREATE INDEX IF NOT EXISTS idx_entries_activity_start ON time_entries(activity_id, start_time, id);
DROP INDEX IF EXISTS idx_entries_start;
DROP INDEX IF EXISTS idx_entries_customer;
DROP INDEX IF EXISTS idx_entries_project;
DROP INDEX IF EXISTS idx_entries_activity;
