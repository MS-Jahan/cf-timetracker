-- cf-timetracker D1 schema (spec §1)
-- Apply: npx wrangler d1 execute cf-timetracker --file=./db/schema.sql [--local]
-- FKs are enforced per-connection by D1 by default (PRAGMA foreign_keys = ON).

-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT DEFAULT 'USD',
    hourly_rate REAL DEFAULT 0.0,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME
);

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    budget_type TEXT CHECK(budget_type IN ('hourly', 'fixed')) DEFAULT 'hourly',
    rate REAL DEFAULT 0.0,
    currency TEXT,               -- NULL inherits the client's currency
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Activities Table (e.g., Development, Meeting, Design) — shared task categories
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    emoji TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME
);

-- Time Entries Table
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    description TEXT,
    tags TEXT, -- Comma-separated tags or JSON array string
    start_time INTEGER NOT NULL, -- Unix Epoch timestamp in milliseconds
    end_time INTEGER,            -- Null if timer is currently running
    duration_seconds INTEGER DEFAULT 0,
    rate_applied REAL DEFAULT 0.0,
    cost REAL DEFAULT 0.0,
    is_running INTEGER DEFAULT 0 CHECK(is_running IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Application Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Project tasks: which shared activities a project exposes as its task list.
-- New projects are seeded with is_default links to "General" and "Meeting"
-- (created globally on demand); users add more tasks per project. Time entries
-- keep referencing activities(id) directly, so history is untouched.
CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, activity_id)
);

-- Indices for rapid filtering
CREATE INDEX IF NOT EXISTS idx_entries_customer ON time_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_entries_start ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_entries_running ON time_entries(is_running);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);

-- At most one running timer, enforced by the storage engine rather than by an
-- application-level check. Partial index: closed rows (is_running = 0) are not
-- constrained, so any number of them may share the value.
-- Added 2026-09-19 in db/migrations/2026-09-19-single-running-timer.sql for
-- databases created before this line existed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_single_running
  ON time_entries(is_running)
  WHERE is_running = 1;
