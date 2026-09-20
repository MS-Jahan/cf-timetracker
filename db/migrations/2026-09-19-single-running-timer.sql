-- Enforce "at most one running timer" in the schema itself.
--
-- Before this, the guarantee was a SELECT-then-INSERT in worker/src/core.js: two
-- requests arriving in different isolates could both see no running row and both
-- insert one. A partial unique index makes the second INSERT fail at the storage
-- layer, which is the only place the guarantee can actually hold.
--
-- Apply: npx wrangler d1 execute cf-timetracker --file=./db/migrations/2026-09-19-single-running-timer.sql [--local]
--
-- Run this FIRST if the migration fails with "UNIQUE constraint failed". It lists
-- databases that already contain a leaked second timer:
--
--   SELECT id, customer_id, project_id, start_time FROM time_entries
--   WHERE is_running = 1 ORDER BY start_time DESC;
--
-- Close the extra rows via the API/admin SQL before retrying — the migration
-- deliberately does not guess an end_time for a timer whose stop time we don't know.

CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_single_running
  ON time_entries(is_running)
  WHERE is_running = 1;
