-- Auth tables (docs/2026-11-12-auth-and-mcp-blueprint.md §2). Idempotent: CREATE ... IF NOT EXISTS only.
-- Apply BEFORE deploying 0.21.0, to both live D1s (owner action):
--   npx wrangler d1 execute DB --remote --file=../db/migrations/2026-11-12-auth.sql
--   npx wrangler d1 execute DB --env demo --remote --file=../db/migrations/2026-11-12-auth.sql

-- Auth (docs/2026-11-12-auth-and-mcp-blueprint.md). Single-tenant: users share all data.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                       -- crypto.randomUUID()
    username TEXT NOT NULL UNIQUE COLLATE NOCASE, -- stored lowercase; NOCASE is belt and braces
    password_hash TEXT NOT NULL,               -- "pbkdf2-sha256$<iter>$<salt b64url>$<hash b64url>"
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,                      -- epoch ms; NULL = not locked
    password_changed_at INTEGER NOT NULL,      -- epoch ms
    created_at INTEGER NOT NULL,               -- epoch ms
    last_login_at INTEGER                      -- epoch ms
);

-- Browser/native sessions. The raw token ("tts_...") is never stored: id = hex SHA-256 of it.
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Long-lived personal API tokens ("ttp_..."), e.g. for MCP clients. Hash only.
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,                       -- crypto.randomUUID()
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,           -- hex SHA-256 of the raw token
    token_prefix TEXT NOT NULL,                -- first 12 chars of the raw token, display only
    scope TEXT NOT NULL DEFAULT 'mcp' CHECK (scope IN ('mcp', 'full')),
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    expires_at INTEGER,                        -- NULL = never
    revoked_at INTEGER                         -- NULL = active
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- Fixed-window attempt counters for login/setup throttling ("login:<ip>", "setup:<ip>").
CREATE TABLE IF NOT EXISTS auth_throttle (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,             -- epoch ms
    count INTEGER NOT NULL
);
