// In-memory D1 stand-in backed by node:sqlite and the real db/schema.sql.
// Implements the subset the Worker uses: prepare().bind().first()/all()/run(), batch().
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashPassword, sha256Hex } from "../../src/auth-crypto.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../../../db/schema.sql", import.meta.url)), "utf8");
const norm = (args) => args.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
const plain = (row) => (row ? { ...row } : null);

export const TEST_PEPPER = "test-pepper-0123456789abcdef0123456789";
export const TEST_SETUP_TOKEN = "test-setup-token-0123456789abcdef";
export const TEST_ORIGIN = "https://app.test";

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  const queries = [];
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first(column) {
      queries.push(sql);
      const row = plain(db.prepare(sql).get(...norm(args)));
      return column ? (row?.[column] ?? null) : row;
    },
    async all() {
      queries.push(sql);
      return { success: true, results: db.prepare(sql).all(...norm(args)).map(plain) };
    },
    async run() {
      queries.push(sql);
      const info = db.prepare(sql).run(...norm(args));
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return {
    queries,
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function createTestEnv(extra = {}) {
  return {
    DB: createD1(),
    ALLOWED_ORIGINS: TEST_ORIGIN,
    AUTH_PEPPER: TEST_PEPPER,
    SETUP_TOKEN: TEST_SETUP_TOKEN,
    AUTH_PBKDF2_ITERATIONS: "1000",
    DEMO_MODE: "false",
    ...extra,
  };
}

/** Insert a user directly (bypasses setup). Returns the user id. */
export async function insertUser(env, { username = "owner", password = "correct-horse-battery" } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const hash = await hashPassword(password, env.AUTH_PEPPER, { iterations: 1000 });
  env.DB.raw.prepare("INSERT INTO users (id, username, password_hash, password_changed_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, username, hash, now, now);
  return id;
}

/** Insert an API token row directly. Returns the raw token. */
export async function insertApiToken(env, userId, { scope = "mcp", expiresAt = null, revokedAt = null } = {}) {
  const token = `ttp_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 47);
  env.DB.raw.prepare(
    "INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scope, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), userId, "test", await sha256Hex(token), token.slice(0, 12), scope, Date.now(), expiresAt, revokedAt);
  return token;
}

/** Build a Request against the fake API host. */
export function req(path, { method = "GET", token, cookie, origin, body, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = cookie;
  if (origin) h.Origin = origin;
  return new Request(`https://api.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
