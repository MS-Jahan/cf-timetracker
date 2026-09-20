-- Soft-archive master data without deleting history.
-- Apply with: npx wrangler d1 execute cf-timetracker --file=./db/migrations/2026-09-19-master-data-archive.sql
ALTER TABLE customers ADD COLUMN archived_at DATETIME;
ALTER TABLE projects ADD COLUMN archived_at DATETIME;
ALTER TABLE activities ADD COLUMN archived_at DATETIME;
