-- Project tasks: per-project task lists over the shared activities table.
-- Additive and idempotent — no existing table is rebuilt. A project task is a link
-- (project_tasks) to a shared activity; time_entries keep referencing activities
-- directly, so all historical rows remain valid untouched.
-- New projects are seeded with is_default links to "General" and "Meeting"; the
-- activities themselves are created globally on demand (activities.name stays
-- UNIQUE, so "Meeting" is one shared row reused by every project).
-- Apply: npx wrangler d1 execute cf-timetracker --file=./db/migrations/2026-09-20-project-tasks.sql [--local]

CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);

-- Give existing projects the same useful defaults as newly-created projects.
-- INSERT OR IGNORE keeps this migration safe to re-run and preserves custom task links.
INSERT OR IGNORE INTO activities (id, name) VALUES ('a9999999-9999-4999-8999-999999999991', 'General');
INSERT OR IGNORE INTO activities (id, name) VALUES ('a9999999-9999-4999-8999-999999999992', 'Meeting');
INSERT OR IGNORE INTO project_tasks (id, project_id, activity_id, is_default)
  SELECT lower(hex(randomblob(16))), p.id, a.id, 1
  FROM projects p CROSS JOIN activities a
  WHERE a.name IN ('General', 'Meeting');
