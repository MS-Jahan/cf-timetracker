-- Read-scaling phase 1 (docs/2026-10-09-read-scaling-plan.md). Idempotent.
-- Activity detail pages and joins filter time_entries by activity_id.
CREATE INDEX IF NOT EXISTS idx_entries_activity ON time_entries(activity_id);
-- data_rev needs no migration: the Worker creates the settings row on first write
-- and treats a missing row as revision 0.
