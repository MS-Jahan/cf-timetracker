-- Freeze the billing currency on each entry (like rate_applied) so changing a
-- client's/project's currency no longer relabels history. Nullable: readers fall back
-- to the client's currency. Run once; ALTER fails harmlessly if the column exists.
ALTER TABLE time_entries ADD COLUMN currency TEXT;

-- Backfill from the current project/client currency (the best information left).
UPDATE time_entries
SET currency = COALESCE(
  (SELECT p.currency FROM projects p WHERE p.id = time_entries.project_id),
  (SELECT c.currency FROM customers c WHERE c.id = time_entries.customer_id)
)
WHERE currency IS NULL;
