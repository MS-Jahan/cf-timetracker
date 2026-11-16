# Auth + authenticated MCP - implementation task list

**Date:** 2026-11-12
**Design (read first, it holds the code to copy):** `docs/2026-11-12-auth-and-mcp-blueprint.md` (referred to as **BP §n**).
**Branch:** `feat/password-auth-mcp`. Version target **0.21.0**.
**Executor:** one small task at a time, in order. Each task lists its files (max 3), what to write, and the command that proves it. Do not start a task until its dependencies pass.

---

## Guardrails (apply to every task)

1. **Do not** commit, push, or run any `--remote` wrangler command. Remote migrations and secrets are owner actions (BP §11).
2. **No secrets in the repo.** Only placeholder/test constants that are obviously local (e.g. `verify-local-pepper-not-a-secret-...`, `test-pepper-...`). Never write a real pepper, setup token, password or `ttp_`/`tts_` token into any file, log line, error message, or test snapshot.
3. **Do not change `worker/src/core.js`** (timer/billing logic, single-running-timer rule). Auth code lives in `auth-crypto.js`, `auth.js`, `auth-routes.js`, `http.js`. Timer mutations still go only through `core.js`.
4. **Do not change existing endpoint paths, request fields, or response shapes.** The only contract changes are the ones in BP §6 (auth required, new `/api/auth/*`, `GET /mcp` 405, cache headers, removal of `X-App-Token`/`Cf-Access` bypass).
5. **Do not change MCP tool names, input schemas, or result shapes** in `worker/src/mcp.js`.
6. **No new npm dependencies** in `worker/` or `web/` (WebCrypto + `node:sqlite` are built in). Flutter adds exactly one package: `flutter_secure_storage`.
7. **SQL is always parameterized** (`.bind(...)`); never interpolate user input into SQL strings. Never return `password_hash`, `token_hash`, session ids, or raw `users`/`api_tokens` rows in a response.
8. Frontend: daisyUI class names in JSX only; **no new `@apply`** or component classes in `index.css`; new screens in `web/src/pages/`; never hard-code `$`.
9. Docs: only dated files in `docs/`. Do not edit older dated docs (e.g. the deploy runbook); `AGENTS.md`/`README.md` are edited in T29.
10. If a command in "Prove it" fails, fix within the task's files. If the fix needs another file, stop and report instead of widening scope.
11. Keep existing code style: ES modules, 2-space indent, double quotes, `{ status, ... }` result objects from data-layer functions.

---

## Dependency overview

```
T00 -> T01 -> T02 -> T03
             T02 -> T04 -> T05 -> T06 -> T07 -> T08
                    T08 + T09 -> T10 -> T11 -> T12, T13
T11 -> T14, T15, T16, T17, T18
T11 -> T19 -> T20 -> T21 -> T22 ; T19 -> T23
T11 -> T24 -> T25 -> T26 -> T27
all -> T28 -> T29 -> T30
```

---

## Phase A - preflight and schema

### [x] T00 - Baseline (no edits)
- Run: `cd worker && npm install && npm test` and `cd ../web && npm install && npm run build`.
- Record the pass counts in your task note. If the baseline already fails, stop and report.

### [x] T01 - Auth tables in schema + migration
- **Files:** `db/schema.sql` (append at end), `db/migrations/2026-11-12-auth.sql` (new).
- **Do:** copy the SQL block from BP §2 exactly. In the migration, put this header comment above it:
  ```sql
  -- Auth tables (docs/2026-11-12-auth-and-mcp-blueprint.md §2). Idempotent: CREATE ... IF NOT EXISTS only.
  -- Apply BEFORE deploying 0.21.0, to both live D1s (owner action):
  --   npx wrangler d1 execute DB --remote --file=../db/migrations/2026-11-12-auth.sql
  --   npx wrangler d1 execute DB --env demo --remote --file=../db/migrations/2026-11-12-auth.sql
  ```
- **Do not** touch existing tables or `db/seed.sql`.
- **Prove it** (from repo root; schema applied twice + migration = idempotent):
  ```bash
  node -e "const {DatabaseSync}=require('node:sqlite');const fs=require('fs');const d=new DatabaseSync(':memory:');const s=fs.readFileSync('db/schema.sql','utf8');d.exec(s);d.exec(s);d.exec(fs.readFileSync('db/migrations/2026-11-12-auth.sql','utf8'));console.log(d.prepare(\"select group_concat(name) n from sqlite_master where type='table'\").get().n)"
  ```
  Output must list `users,sessions,api_tokens,auth_throttle` among the tables, with no error.

---

## Phase B - crypto and test harness

### [x] T02 - `worker/src/auth-crypto.js`
- **Depends:** T01. **Files:** `worker/src/auth-crypto.js` (new).
- **Do:** copy BP §4 code verbatim. No D1, no `env` reads except `resolveIterations(env)`.
- **Prove it:** `cd worker && node -e "import('./src/auth-crypto.js').then(async m=>{const h=await m.hashPassword('correct horse battery','p'.repeat(32),{iterations:1000});console.log(h.split('$')[0],(await m.verifyPassword('correct horse battery',h,'p'.repeat(32),{iterations:1000})).ok)})"` prints `pbkdf2-sha256 true`.

### [x] T03 - Crypto unit tests
- **Depends:** T02. **Files:** `worker/test/auth-crypto.test.js` (new).
- **Do:** `node:test` + `node:assert/strict`, same style as `worker/test/single-timer.test.js`. Use `{ iterations: 1000 }` everywhere for speed, pepper `"test-pepper-0123456789abcdef0123456789"`. Cases:
  1. `sha256Hex("abc")` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  2. `b64urlEncode`/`b64urlDecode` round-trip for lengths 0..40 of random bytes; output never contains `+`, `/`, `=`.
  3. `generateToken("tts_")` starts with `tts_`, total length 47 (`4 + 43`), two calls differ.
  4. `constantTimeEqual`: equal arrays true; one differing byte false; different lengths false; non-Uint8Array false.
  5. `hashPassword` format: 4 `$`-separated parts, scheme `pbkdf2-sha256`, iterations `1000`, salt decodes to 16 bytes, hash to 32 bytes; two hashes of the same password differ (salt).
  6. `verifyPassword`: right password `{ ok: true, needsRehash: false }`; wrong password `ok: false`; **different pepper** `ok: false`; empty pepper `ok: false`; garbage stored string `ok: false`.
  7. `needsRehash` true when stored with 1000 and verified with `{ iterations: 2000 }`.
  8. `resolveIterations`: `{}` -> 100000; `"5"` -> 1000; `"999999"` -> 100000; `"50000"` -> 50000; `"abc"` -> 100000.
  9. `hashPassword("x", "")` rejects (throws).
  10. `dummyHash(1000)` parses with `parseHash` and never verifies any password.
- **Prove it:** `cd worker && npm test` (all old + new tests pass).

### [x] T04 - In-memory D1 test helper (real SQLite, real schema)
- **Depends:** T02. **Files:** `worker/test/helpers/d1-sqlite.js` (new), `worker/test/d1-helper.test.js` (new).
- **Do:** create the helper exactly as below (the `test/*.test.js` glob does not pick up `test/helpers/`):
  ```js
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
  ```
  `d1-helper.test.js` cases: (1) `createTestEnv()` has tables `users, sessions, api_tokens, auth_throttle, time_entries` (query `sqlite_master` through `env.DB.prepare(...).all()`); (2) `insertUser` then `SELECT username FROM users` via `.first("username")` returns `owner`; (3) `.run()` on an UPDATE returns `meta.changes` as a number; (4) `INSERT ... RETURNING` works through `.first()`.
- **Prove it:** `cd worker && npm test`. An `ExperimentalWarning: SQLite` line is expected and fine.

---

## Phase C - auth data layer (`worker/src/auth.js`)

All four tasks write to the same two files: `worker/src/auth.js` and `worker/test/auth-store.test.js`. Imports in `auth.js`: from `./auth-crypto.js` only (no `core.js`, no `http.js`).

### [x] T05 - Config, validation, throttle, sessions, cookies
- **Depends:** T04. **Files:** `worker/src/auth.js` (new), `worker/test/auth-store.test.js` (new).
- **Do:** implement BP §5 constants + §5.1 + §5.2 + §5.3 exactly (exports: `SESSION_COOKIE`, `authConfigured`, `normalizeUsername`, `validateUsername`, `validatePassword`, `clientIp`, `chargeThrottle`, `clearThrottle`, `createSession`, `revokeSession`, `revokeOtherSessions`, `purgeExpired`, `sessionCookie`, `clearSessionCookie`, `parseCookies`). Keep `ipLimit`, `publicUser`, `sessionTtlMs`, `sameSite` module-private.
- **Tests** (use `createTestEnv`, `insertUser`):
  1. `authConfigured`: 32-char pepper true; 31-char false; missing false.
  2. `normalizeUsername("  Sabit ")` -> `"sabit"`; `validateUsername("ab")` non-null; `validateUsername("sabit.dev_1")` null; `validateUsername("a b")` non-null.
  3. `validatePassword`: 11 chars -> error; 12 chars ok; 257 chars -> error; equals username (case-insensitive) -> error.
  4. `chargeThrottle` with `limit: 2, windowMs: 60000, now: 1000`: calls 1,2 allowed; call 3 `allowed: false` and `retryAfter` between 1 and 60; a call with `now: 1000 + 60001` is allowed again; `clearThrottle` makes the next call allowed.
  5. `createSession(env, userId)`: token starts with `tts_`; `sessions.id` equals `await sha256Hex(token)` and is **not** the raw token; `expires_at - created_at` = 720 h; `SESSION_TTL_HOURS: "2"` gives 2 h; `maxAgeSec` matches.
  6. `revokeOtherSessions` keeps the given session, deletes the other two, returns 2.
  7. `purgeExpired(env, now)` deletes a session with `expires_at <= now` and keeps a future one.
  8. `sessionCookie(env, "tts_x", 60)` contains `tt_session=tts_x`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=60`, no `Partitioned`; with `SESSION_COOKIE_SAMESITE: "none"` contains `SameSite=None` and `Partitioned`; `clearSessionCookie` has `Max-Age=0`.
  9. `parseCookies("a=1; tt_session=tts_abc; b")` -> `{ a: "1", tt_session: "tts_abc" }`.
- **Prove it:** `cd worker && npm test`.

### [x] T06 - `authenticate()`
- **Depends:** T05. **Files:** `worker/src/auth.js`, `worker/test/auth-store.test.js`.
- **Do:** add BP §5.4 (`SESSION_LOOKUP`, `TOKEN_LOOKUP`, `authenticate`) exactly.
- **Tests** (requests built with `req()` from the helper):
  1. Bearer session token -> `{ kind: "session", via: "header", scope: "full", user.username: "owner" }`.
  2. Same token as cookie `tt_session=<token>` -> `via: "cookie"`.
  3. Cookie with `{ allowCookie: false }` -> `null`.
  4. Expired session (`UPDATE sessions SET expires_at = 1`) -> `null`.
  5. API token (scope `mcp`) via header -> `{ kind: "token", scope: "mcp" }`; `last_used_at` set; a second call within the hour does not change `last_used_at` (set it to `now - 10` first and assert unchanged).
  6. API token in the cookie -> `null`.
  7. Revoked token / expired token -> `null`.
  8. `Authorization: Basic abc` -> `null`; `Bearer xyz_unknownprefix` -> `null`; invalid Bearer plus a valid cookie -> `null` (no fallback).
  9. Returned object never contains `password_hash` or `token_hash` (assert keys).
- **Prove it:** `cd worker && npm test`.

### [x] T07 - `setupFirstUser()` and `login()`
- **Depends:** T06. **Files:** `worker/src/auth.js`, `worker/test/auth-store.test.js`.
- **Do:** implement BP §5.5 (step order matters) and copy BP §5.6 `login` verbatim. Both are exported. Error results always carry `status`, `code`, `error`.
- **Tests:**
  1. setup without `AUTH_PEPPER` -> `unavailable` / `auth_not_configured`.
  2. setup with no `SETUP_TOKEN` -> `forbidden` / `setup_disabled`.
  3. wrong setup token -> `forbidden` / `invalid_setup_token`.
  4. weak password -> `invalid` / `weak_password`; bad username -> `invalid` / `invalid_username`.
  5. valid setup -> `ok`, returns `user.username` lowercased, `token` (`tts_`), one `users` row with a `pbkdf2-sha256$1000$` hash.
  6. second setup (even with the right token) -> `conflict` / `setup_complete`.
  7. 6 setup attempts from the same `ip` with a wrong token -> the 6th is `rate_limited`.
  8. login ok -> `ok`, `failed_attempts` 0, `last_login_at` set, new session row.
  9. login wrong password -> `unauthorized` / `invalid_credentials`; unknown user -> same status, code and error text.
  10. 5 wrong passwords (use distinct `ip` values to avoid the IP limit) -> 6th attempt **with the correct password** is `rate_limited` with `retryAfter` > 0.
  11. IP limit: with `AUTH_IP_LIMIT: "3"`, the 4th attempt from one ip is `rate_limited` before any password check (`failed_attempts` not incremented by it).
  12. Rehash: user stored with 1000 iterations, env `AUTH_PBKDF2_ITERATIONS: "2000"` -> after login, stored hash has `$2000$`.
  13. Throttle row for `login:<ip>` is removed after a successful login.
- **Prove it:** `cd worker && npm test`.

### [x] T08 - `changePassword()` and API tokens
- **Depends:** T07. **Files:** `worker/src/auth.js`, `worker/test/auth-store.test.js`.
- **Do:** implement BP §5.7 and §5.8 as exports `changePassword(env, auth, body)`, `createApiToken(env, auth, body)`, `listApiTokens(env, auth)`, `revokeApiToken(env, auth, id)`, plus private `toApiTokenDto`. `auth` is the object returned by `authenticate`.
- **Tests:**
  1. changePassword with `auth.kind: "token"` -> `forbidden` / `session_required`.
  2. wrong current -> `unauthorized` / `invalid_credentials`, `failed_attempts` incremented.
  3. new password too short or equal to current -> `invalid` / `weak_password`.
  4. success -> login with the new password works, old fails; other sessions deleted, the current one kept; `revokedSessions` count correct.
  5. createApiToken: default scope `mcp`; `scope: "full"` accepted; `scope: "admin"` -> `invalid`; empty/65-char name -> `invalid`; `expiresInDays: 0` or `366` -> `invalid`; `expiresInDays: 30` sets `expiresAt` ~30 days ahead; raw token starts `ttp_`; DB stores only the SHA-256 (`token_hash != token`) and `token_prefix = token.slice(0, 12)`.
  6. The created token authenticates via `authenticate` with matching scope.
  7. listApiTokens returns DTOs with exactly the keys `id,name,scope,prefix,createdAt,lastUsedAt,expiresAt`; revoked tokens are excluded.
  8. revokeApiToken -> `ok`; second revoke -> `not_found`; another user's token id -> `not_found`; revoked token no longer authenticates.
  9. 26th active token -> `conflict` / `too_many_tokens`.
  10. All three token functions with `auth.kind: "token"` -> `forbidden` / `session_required`.
- **Prove it:** `cd worker && npm test`.

---

## Phase D - HTTP wiring

### [x] T09 - Extract HTTP helpers into `worker/src/http.js` (with credentialed CORS)
- **Depends:** T00 (independent of Phase C). **Files:** `worker/src/http.js` (new), `worker/src/index.js`.
- **Do:** create `http.js` from BP §6.1. In `index.js` delete `JSON_HEADERS_BASE`, `corsOrigin`, `jsonResponse`, `handleCors`, `readJson` and import them (plus `corsHeaders`, `originAllowed`) from `./http.js`. In the existing 304 branch replace the spread `...JSON_HEADERS_BASE, "Access-Control-Allow-Origin": corsOrigin(...)` with `...corsHeaders(request, env)`. **Leave the `APP_TOKEN` gate and everything else unchanged in this task.**
- **Prove it:** `cd worker && npm test` (existing `etag.test.js` must still pass unchanged) and `grep -n "X-App-Token\|Cf-Access-Jwt" worker/src/http.js` prints nothing.

### [x] T10 - `worker/src/auth-routes.js`
- **Depends:** T08, T09. **Files:** `worker/src/auth-routes.js` (new), `worker/test/auth-routes.test.js` (new).
- **Do:** implement `handleAuthRoute(request, env, authContext)` per the BP §6.3 table and skeleton. Rules:
  - Returns `null` for any path not under `/api/auth/`.
  - Route match: `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`, `GET /api/auth/tokens`, `POST /api/auth/tokens`, `DELETE /api/auth/tokens/:id` (`decodeURIComponent` the id). Anything else under `/api/auth/` -> 404 `{ error: "Route not found", code: "not_found" }`.
  - `status`: if `!authConfigured(env)` return `{ configured: false, setupRequired: false }` **without** a DB read; else `setupRequired` = `SELECT 1 FROM users LIMIT 1` returned null.
  - `setup` -> 201 via `sessionResponse`; `login` -> 200 via `sessionResponse`. Invalid JSON body -> 400 `invalid_request`. `transport` = `body.transport === "token" ? "token" : "cookie"`.
  - `logout`: `const a = authContext ?? await authenticate(request, env)`; if `a?.kind === "session"` -> `revokeSession(env, a.sessionId)`; always 200 `{ success: true }` with `Set-Cookie: clearSessionCookie(env)`.
  - `me`, `password`, `tokens*`: if `authContext` is null -> 401 `unauthenticated` (defence in depth; the middleware normally guarantees it). `me` -> `{ user, auth: { kind, scope, expiresAt } }`.
  - Every response: `Cache-Control: no-store`; 429 adds `Retry-After`.
- **Tests** (call `handleAuthRoute(req(...), env, ctx)` directly; get `ctx` with `authenticate` from `auth.js`):
  1. non-auth path -> `null`.
  2. status before setup `{ configured: true, setupRequired: true }`; after setup `setupRequired: false`; with no pepper `configured: false`.
  3. setup cookie transport -> 201, `Set-Cookie` starts with `tt_session=tts_`, body has no `token`; setup token transport -> body `token`, no `Set-Cookie`.
  4. login wrong password -> 401 `invalid_credentials`, `Cache-Control: no-store`; login ok -> 200.
  5. login throttled -> 429 with numeric `Retry-After` header.
  6. me with ctx -> 200 user; me with null ctx -> 401.
  7. logout with a Bearer session -> 200; the session no longer authenticates; `Set-Cookie` contains `Max-Age=0`.
  8. tokens: POST 201 returns `token` + `apiToken`; GET lists it; DELETE 200; DELETE again 404; POST with a token ctx -> 403 `session_required`.
  9. password: wrong current -> 401; ok -> 200 `{ success: true, revokedSessions }`.
  10. Search every JSON body produced in these tests: none contains `password_hash`, `token_hash`, or `pbkdf2-sha256`.
- **Prove it:** `cd worker && npm test`.

### [x] T11 - Middleware rewrite in `index.js`, MCP signature, ETag tests
- **Depends:** T10. **Files:** `worker/src/index.js`, `worker/src/mcp.js`, `worker/test/etag.test.js`.
- **Do in `index.js`:**
  - Imports: `authenticate`, `authConfigured` from `./auth.js`; `handleAuthRoute` from `./auth-routes.js`.
  - Add `PUBLIC_ROUTES`, `SAFE_METHODS` (BP §6.2). Extend `STATUS_CODES` with `unauthorized: 401, forbidden: 403, rate_limited: 429, unavailable: 503`.
  - Delete `isAuthorized()`, the `APP_TOKEN` block inside `route()`, and the `/mcp` branch inside `route()`.
  - Rewrite `fetch(request, env)` to follow BP §6.2 steps 1-14 **in that order**. Helper responses:
    - 401: `jsonResponse(request, env, { error: "Authentication required", code: "unauthenticated" }, 401, { "WWW-Authenticate": 'Bearer realm="cf-timetracker"' })`. For `/mcp` use the same body/headers.
    - 403 scope: `{ error: "This token cannot access the REST API", code: "insufficient_scope" }`.
    - 403 CSRF: `{ error: "Origin not allowed", code: "origin_not_allowed" }`.
    - 503: `{ error: "Authentication is not configured on the server", code: "auth_not_configured" }`.
    - 405 for non-POST `/mcp`: `new Response(null, { status: 405, headers: { Allow: "POST" } })`.
  - ETag: skip when `pathname.startsWith("/api/auth/")` or in `UNCACHED_GETS`; 304 and tagged 200 use `Cache-Control: private, no-cache` and `Vary: Origin, Authorization, Cookie`.
  - `data_rev` bump: unchanged rule plus `!pathname.startsWith("/api/auth/")`.
  - Add a header comment explaining the order (auth before 304; public allowlist lives here only).
- **Do in `mcp.js`:** `export async function handleMcp(request, env, auth = null)`; pass nothing new to tools. Update the file header comment: "Requires Authorization: Bearer (session or API token); see docs/2026-11-12-auth-and-mcp-blueprint.md §7". No other change.
- **Do in `etag.test.js`:** replace the stub env with `createTestEnv()` from the helper. Setup per test: `insertUser`, create a session token with `createSession` (import from `../src/auth.js`), set the revision with `env.DB.raw.exec("INSERT INTO settings (key, value) VALUES ('data_rev', '7')")`. Keep all five scenarios, adjusted:
  1. tagged 200 then 304; `Cache-Control` is `private, no-cache`; queries on the 304 path = **2** (session lookup + revision) - count with `env.DB.queries.length` before/after.
  2. moved revision -> 200 with new ETag.
  3. no `data_rev` row -> no ETag.
  4. `/api/rev` never tagged.
  5. "does not leak a 304": same request **without** credentials -> 401 (replaces the old `APP_TOKEN` case).
- **Prove it:** `cd worker && npm test`; `grep -n "APP_TOKEN\|X-App-Token\|Cf-Access" worker/src/*.js` prints nothing.

### [x] T12 - HTTP integration tests (`worker.fetch`)
- **Depends:** T11. **Files:** `worker/test/auth-http.test.js` (new).
- **Do:** import `worker from "../src/index.js"` and the helper. Get a session token by calling `POST /api/auth/setup` with `transport: "token"`. Cases (status codes are exact):
  1. Anonymous `GET /api/bootstrap` -> 401, `code: "unauthenticated"`, `WWW-Authenticate` header present.
  2. Bearer `GET /api/bootstrap` -> 200 with `customers` array.
  3. `X-App-Token: x` + `Cf-Access-Authenticated-User-Email: a@b.c` with no credential, and with `env.APP_TOKEN = "x"` -> 401.
  4. Public routes anonymous: `GET /api/demo/status` 200 `{ demoMode: false }`; `GET /api/auth/status` 200.
  5. Missing pepper (`AUTH_PEPPER: undefined`) -> `GET /api/bootstrap` 503 `auth_not_configured`; `GET /api/auth/status` 200 `configured: false`.
  6. Unknown `/api/nope` anonymous -> 401; authenticated -> 404.
  7. Cookie session (`cookie: "tt_session=<token>"`): `POST /api/customers` with `origin: TEST_ORIGIN` -> 201; without Origin -> 403 `origin_not_allowed`; with `origin: "https://evil.test"` -> 403; `GET /api/bootstrap` without Origin -> 200 (safe method).
  8. Bearer `POST /api/customers` without Origin -> 201 (no CSRF check for header auth).
  9. `mcp`-scope API token on `GET /api/bootstrap` -> 403 `insufficient_scope`; `full` scope -> 200.
  10. CORS: preflight `OPTIONS /api/bootstrap` with `Origin: https://app.test` -> 204, `Access-Control-Allow-Credentials: true`, `Access-Control-Allow-Headers` includes `Authorization`; with `ALLOWED_ORIGINS: "*"` -> no `Access-Control-Allow-Credentials` header.
  11. `data_rev`: `POST /api/auth/login` (ok) and `POST /api/auth/tokens` do **not** change `GET /api/rev`; `POST /api/customers` does (+1).
  12. `GET /api/auth/me` is never tagged with `ETag` and has `Cache-Control: no-store`.
  13. Timer path still works with auth: start -> 200, second start -> 409 `timer_running`, stop -> 200, stop again -> 404 `no_active_timer` (create a customer, then a project with `defaultTasks: []` so any active activity is allowed, then an activity, all via the API with the Bearer token).
  14. Logout via cookie, then the same cookie on `GET /api/bootstrap` -> 401.
- **Prove it:** `cd worker && npm test`.

### [x] T13 - MCP auth tests
- **Depends:** T11. **Files:** `worker/test/mcp-auth.test.js` (new).
- **Do:** POST JSON-RPC bodies to `/mcp` through `worker.fetch`. Cases:
  1. No credential -> 401 with `WWW-Authenticate`.
  2. Session cookie only (no header) -> 401.
  3. `mcp`-scope API token: `initialize` -> 200 with `result.protocolVersion === "2025-06-18"`; `tools/list` -> exactly `get_active_timer, start_timer, stop_timer, query_summary` with the same `inputSchema` objects as `TOOLS` exported from `../src/mcp.js` (deep-equal).
  4. Session Bearer token also works for `tools/list`.
  5. Revoked or expired API token -> 401.
  6. `GET /mcp` -> 405 with `Allow: POST`; `OPTIONS /mcp` -> 204.
  7. `Origin: https://evil.test` with a valid token -> 403; `Origin: https://app.test` -> 200; with `ALLOWED_ORIGINS: "*"` any Origin -> 200.
  8. `tools/call` `get_active_timer` -> `{ status: "idle" }` text content.
  9. Notification (no `id`) with a valid token -> 202.
- **Prove it:** `cd worker && npm test`.

---

## Phase E - config, gate, scripts

### [x] T14 - Local env example + wrangler comments
- **Depends:** T11. **Files:** `worker/.dev.vars.example` (new), `worker/wrangler.toml`.
- **Do:** `.dev.vars.example` = BP §3 block verbatim. In `wrangler.toml` replace the comment lines 3-4 with: secrets per worker are `AUTH_PEPPER` (required), `SETUP_TOKEN` (first-user setup), `GAS_SECRET`, `GEMINI_API_KEY`; optional vars `AUTH_PBKDF2_ITERATIONS`, `SESSION_TTL_HOURS`, `SESSION_COOKIE_SAMESITE`, `AUTH_IP_LIMIT`; "`APP_TOKEN` is no longer used". **Do not** add secrets or new `[vars]` values; do not add routes/custom domains (owner action).
- **Prove it:** `git check-ignore worker/.dev.vars.example` prints nothing (file is tracked); `cd worker && npx wrangler deploy --dry-run --outdir /tmp/tt-dry` succeeds.

### [x] T15 - Verification gate with auth
- **Depends:** T11. **Files:** `scripts/verify.mjs`, `.github/workflows/verify.yml`.
- **Do:** implement BP §10.1:
  - constants `VERIFY_PEPPER_DEFAULT = "verify-local-pepper-not-a-secret-0123456789"`, `VERIFY_SETUP_DEFAULT = "verify-local-setup-token-0123456789"`, `VERIFY_USER = { username: "verify", password: "verify-local-password-1234" }` (test-only, comment says so).
  - `readDevVars()` parses `worker/.dev.vars` if it exists (`KEY=VALUE`, skip blank and `#` lines, strip surrounding quotes).
  - When owning the worker: `mkdtempSync` dir; run `npx wrangler d1 execute DB --local --persist-to <dir> --file=../db/schema.sql --yes` and the same for `../db/seed.sql` (cwd `workerDir`, via `commandFor`); `startWorker` adds `--persist-to <dir> --var AUTH_PEPPER:<v> --var SETUP_TOKEN:<v>`; remove the dir in `finally` (`rmSync(dir, { recursive: true, force: true })`) after `stopWorker`.
  - `waitForApi` polls `/api/auth/status`.
  - `obtainToken(base)` as in BP §10.1 step 6; `VERIFY_API_BASE` mode uses `VERIFY_TOKEN` or `VERIFY_USERNAME`/`VERIFY_PASSWORD`, else throws `"set VERIFY_TOKEN or VERIFY_USERNAME/VERIFY_PASSWORD for VERIFY_API_BASE"`.
  - Pass `{ TT_TOKEN: token }` as `extraEnv` to the `check-single-timer.mjs` command. Never print the token.
  - Update the header comment (steps, env vars).
  - `verify.yml`: delete the "Prepare local D1 database" step (verify is hermetic now).
- **Prove it:** runs after T16 - see T16.

### [x] T16 - Concurrency/edge-case scripts send the token
- **Depends:** T15. **Files:** `scripts/check-single-timer.mjs`, `scripts/check-edge-cases.mjs`.
- **Do:** in each script's fetch helper add `...(process.env.TT_TOKEN ? { Authorization: \`Bearer ${process.env.TT_TOKEN}\` } : {})` to the headers. After the first request, if status is 401, print `Unauthorized: set TT_TOKEN to a session token or a full-scope API token.` and `process.exit(2)`. Update the usage comments.
- **Prove it (T15 + T16):** from repo root `npm run verify` passes end to end (still at version 0.20.0; do not bump before T28). Also `node scripts/check-single-timer.mjs http://127.0.0.1:1 2` exits non-zero with a connection message (no crash on missing token).

### [x] T17 - Kimai scripts use Bearer API tokens
- **Depends:** T11. **Files:** `scripts/kimai-import.mjs`, `scripts/kimai-export.mjs`.
- **Do:** `TRACKER_TOKEN` header becomes `Authorization: Bearer ${env.TRACKER_TOKEN}`; doc comment: "TRACKER_TOKEN - full-scope API token (Settings -> API tokens), required since 0.21.0".
- **Prove it:** `node --check scripts/kimai-import.mjs && node --check scripts/kimai-export.mjs`; `grep -n "X-App-Token" scripts/*.mjs` prints nothing.

### [x] T18 - `scripts/reset-password.mjs`
- **Depends:** T02. **Files:** `scripts/reset-password.mjs` (new).
- **Do:** BP §10.2. Details:
  - `import { hashPassword, resolveIterations } from "../worker/src/auth-crypto.js"`.
  - Args: `<username>` required, optional `--create`. Env: `AUTH_PEPPER` (required, >= 32 chars, else exit 2), `NEW_PASSWORD` (optional; else prompt twice with muted echo via `readline` and require a match), `AUTH_PBKDF2_ITERATIONS` (optional, through `resolveIterations`).
  - Validate username with `/^[a-z0-9][a-z0-9._-]{2,63}$/` after lowercasing (this also guarantees no quotes in the SQL) and password length 12..256.
  - Print only SQL to stdout (BP §10.2), status text to stderr. `--create` prints `INSERT INTO users (id, username, password_hash, password_changed_at, created_at) VALUES ('<uuid>', '<u>', '<hash>', <now>, <now>);`.
  - Never echo the password or pepper.
- **Prove it:**
  ```bash
  AUTH_PEPPER=test-pepper-0123456789abcdef0123456789 NEW_PASSWORD=correct-horse-battery AUTH_PBKDF2_ITERATIONS=1000 \
    node scripts/reset-password.mjs Owner --create
  ```
  prints one `INSERT` with `'owner'` and `'pbkdf2-sha256$1000$`; the same without `--create` prints the `UPDATE` + `DELETE FROM sessions`; `NEW_PASSWORD=short` exits non-zero.

---

## Phase F - web

### [x] T19 - `web/src/lib/api.js` auth transport and wrappers
- **Depends:** T11. **Files:** `web/src/lib/api.js`.
- **Do:** BP §8.1 exactly. Keep `request()` signature backward compatible (`request(path, options)`); destructure `{ auth = true, headers: extraHeaders, ...rest }`. On error also set `error.retryAfter = Number(res.headers.get("Retry-After")) || null`. Wrap `localStorage` access in `try/catch`. Export `AUTH_TRANSPORT`, `UNAUTHORIZED_EVENT = "tt:unauthorized"`, `MCP_URL`, and the nine auth wrappers with the names in BP §8.1.
- **Prove it:** `cd web && npm run build`; `grep -c "credentials" web/src/lib/api.js` >= 1.

### [x] T20 - `useAuth` hook and login page
- **Depends:** T19. **Files:** `web/src/lib/useAuth.js` (new), `web/src/pages/LoginPage.jsx` (new).
- **Do:** BP §8.2 and §8.3. `LoginPage` props: `{ auth }` (the hook's return value). Client-side checks: setup password >= 12 chars and equals confirm. Disable the submit button while a request is in flight. Show `err.message`; for `err.status === 429` show `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} min.` Use `document.title = "Sign in · Timetracker"`.
- **Prove it:** `cd web && npm run build`.

### [x] T21 - Auth gate in `App.jsx`
- **Depends:** T20. **Files:** `web/src/App.jsx`.
- **Do:** BP §8.4. Concretely: rename `export default function App()` to `function AuthedApp({ user, onSignOut })` and move the splash state/handler out of it into the new `export default function App()`. New `App`: splash first (unchanged behaviour) -> `const auth = useAuth()` -> `loading` (`<div className="grid min-h-dvh place-items-center"><span className="loading loading-spinner loading-lg" /></div>`) / `error` (`alert alert-error` + Retry calling `auth.refresh`) / `anonymous` -> `<LoginPage auth={auth} />` / authenticated -> `<AuthedApp user={auth.user} onSignOut={auth.signOut} />`. In the sidebar under Appearance add the "Signed in as" line and a Sign out button (`btn btn-ghost btn-sm`, `no-print`). Keep `ROUTES`, `NAV`, demo banner, `/print` handling unchanged.
- **Prove it:** `cd web && npm run build`. Manual (optional): `cd worker && npx wrangler dev` with `.dev.vars` from the example + local D1 prepared with schema/seed, and `cd web && npm run dev` -> the login/setup screen appears, sign-in shows the dashboard, sign-out returns to the login screen.

### [x] T22 - Settings: Account + API tokens & MCP
- **Depends:** T21. **Files:** `web/src/components/AccountPanel.jsx` (new), `web/src/components/ApiTokensPanel.jsx` (new), `web/src/pages/SettingsPage.jsx`.
- **Do:** BP §8.5. Both panels manage their own `busy/error/notice` state and call the `api.js` wrappers directly (they are not tracker data, so no `runAction`). Revoke asks `window.confirm("Revoke token \"<name>\"? Clients using it stop working immediately.")`. Show dates with existing helpers in `web/src/lib/format.js` if a suitable one exists, else `new Date(ms).toLocaleDateString()`. The created token is held only in component state and cleared when the panel unmounts or "Done" is clicked. Snippets:
  - `claude mcp add --transport http timetracker ${MCP_URL} --header "Authorization: Bearer <token>"`
  - the `.mcp.json` block from BP §7.3 with `${TIMETRACKER_MCP_TOKEN}` (not the raw token).
  - Copy buttons use `navigator.clipboard.writeText` inside `try/catch`.
  In `SettingsPage.jsx` add `<Section title="Account">` and `<Section title="API tokens & MCP" description="Personal tokens for MCP clients and scripts. A token is shown once.">` before "Connection", and an "Auth transport" row (`AUTH_TRANSPORT`) in the Connection list.
- **Prove it:** `cd web && npm run build`.

### [x] T23 - Demo build uses Bearer transport
- **Depends:** T19. **Files:** `.github/workflows/deploy.yml`.
- **Do:** in "Build frontend" `env`, add `VITE_AUTH_TRANSPORT: bearer` with a comment `# pages.dev and workers.dev are different sites; cookies would be third-party`. Add to the header comment: "Before the first 0.21.0 deploy: apply db/migrations/2026-11-12-auth.sql to the demo D1 and set AUTH_PEPPER + SETUP_TOKEN with --env demo (docs/2026-11-12-auth-and-mcp-blueprint.md §11.2)."
- **Prove it:** `node -e "require('fs').readFileSync('.github/workflows/deploy.yml','utf8').includes('VITE_AUTH_TRANSPORT: bearer')||process.exit(1)"`.

---

## Phase G - Flutter (minimal)

### [x] T24 - Secure token storage
- **Depends:** T11. **Files:** `apps/timetracker/pubspec.yaml`, `apps/timetracker/lib/token_store.dart` (new), `.github/workflows/build.yml`.
- **Do:** add `flutter_secure_storage: ^9.2.2` under dependencies. `token_store.dart`:
  ```dart
  import 'package:flutter_secure_storage/flutter_secure_storage.dart';

  abstract class TokenStore {
    Future<String?> read();
    Future<void> write(String token);
    Future<void> clear();
  }

  class SecureTokenStore implements TokenStore {
    SecureTokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
    static const _key = 'tt_session_token';
    final FlutterSecureStorage _storage;
    @override
    Future<String?> read() => _storage.read(key: _key);
    @override
    Future<void> write(String token) => _storage.write(key: _key, value: token);
    @override
    Future<void> clear() => _storage.delete(key: _key);
  }

  class MemoryTokenStore implements TokenStore {
    MemoryTokenStore([this._token]);
    String? _token;
    @override
    Future<String?> read() async => _token;
    @override
    Future<void> write(String token) async => _token = token;
    @override
    Future<void> clear() async => _token = null;
  }
  ```
  `build.yml` Linux "Install Linux dependencies": add `libsecret-1-dev` and `libjsoncpp-dev`.
- **Prove it:** if Flutter is installed: `cd apps/timetracker && flutter pub get && flutter analyze lib/token_store.dart`. If not installed, state that in the task note (CI `build.yml` covers it).

### [x] T25 - `TrackerApi` Bearer auth
- **Depends:** T24. **Files:** `apps/timetracker/lib/main.dart`.
- **Do:** only inside `class TrackerApi` and a new `class UnauthorizedException implements Exception { const UnauthorizedException([this.message = 'Signed out']); final String message; @override String toString() => message; }`:
  - rename field `appToken` -> `token`; constructor `TrackerApi(this.baseUrl, [this.token = '']);` `configure(String url, String token)` unchanged semantics.
  - `headers`: `'Authorization': 'Bearer $token'` when non-empty (remove `X-App-Token`).
  - `Future<String> login(String username, String password)`: POST `/api/auth/login` with `{'username': username, 'password': password, 'transport': 'token'}`; returns `body['token'] as String`.
  - `Future<void> logout()`: POST `/api/auth/logout` with headers; swallow all errors.
  - `_decode`: if `statusCode == 401` throw `UnauthorizedException(...)`; parse body defensively (`try { jsonDecode } catch { {} }`).
  - Update the two call sites that construct `TrackerApi` with `String.fromEnvironment('APP_TOKEN')` to `TrackerApi(apiBaseUrl)`.
- **Prove it:** `flutter analyze` (if available) shows no new errors in `main.dart`.

### [x] T26 - Login screen and shell gating
- **Depends:** T25. **Files:** `apps/timetracker/lib/login_view.dart` (new), `apps/timetracker/lib/main.dart`.
- **Do:** BP §9.
  - `LoginView({required String apiUrl, required Future<void> Function(String url, String username, String password) onLogin, String? error})`: three `TextField`s (API URL, Username, Password with `obscureText`), `FilledButton` "Sign in" (disabled while busy), error `Text` in `colorScheme.error`. Title text **`Sign in`**.
  - `TimeTrackerApp({super.key, this.tokenStore})` with `final TokenStore? tokenStore;` passed to `TrackerShell(tokenStore: tokenStore ?? SecureTokenStore(), ...)`.
  - `_TrackerShellState`: remove `configuredToken` and `app_token` usage (call `prefs.remove('app_token')` once in `loadConfig`); add `bool signedIn = false`. `loadConfig`: read URL from prefs, token from the store; `client.configure(url, token ?? '')`; if no token -> `signedIn = false; loading = false` and return; else `signedIn = true; await load()`.
  - `signIn(url, username, password)`: save URL to prefs, `client.configure(url, '')`, `final t = await client.login(...)`, `await store.write(t)`, `client.configure(url, t)`, `signedIn = true`, `await load()`; on exception show the message in LoginView.
  - `signOut()`: `await client.logout(); await store.clear(); setState(() { signedIn = false; bootstrap = null; })`.
  - In `load`, `start`, `stop`: `on UnauthorizedException` -> `await store.clear()` and `signedIn = false`.
  - `build`: if `!signedIn` return `Scaffold(body: Center(child: LoginView(...)))` before the existing scaffold.
  - `SettingsView`: remove the token `TextField` and the `appToken` param; `onSaveConfig(String url)`; add `OutlinedButton.icon(icon: Icon(Icons.logout), label: Text('Sign out'), onPressed: onSignOut)`.
- **Prove it:** `flutter analyze` (if available) has no errors.

### [x] T27 - Flutter widget test
- **Depends:** T26. **Files:** `apps/timetracker/test/widget_test.dart`.
- **Do:**
  ```dart
  import 'package:flutter_test/flutter_test.dart';
  import 'package:shared_preferences/shared_preferences.dart';
  import 'package:timetracker/main.dart';
  import 'package:timetracker/token_store.dart';

  void main() {
    testWidgets('shows the sign-in screen without a stored token', (tester) async {
      SharedPreferences.setMockInitialValues({});
      await tester.pumpWidget(TimeTrackerApp(tokenStore: MemoryTokenStore()));
      await tester.pumpAndSettle();
      expect(find.text('Sign in'), findsWidgets);
    });
  }
  ```
- **Prove it:** `cd apps/timetracker && flutter test` (if Flutter is installed; otherwise note it for CI).

---

## Phase H - version, docs, final gate

### [x] T28 - Version 0.21.0
- **Depends:** T01-T27. **Files:** `package.json`, `CHANGELOG.md`.
- **Do:** `"version": "0.21.0"`. New top entry:
  ```md
  ## 0.21.0 - 2026-11-12
  - feat!: BREAKING: username + password authentication replaces Cloudflare Zero Trust reliance. Every `/api/*` route except `/api/auth/status|login|setup|logout` and `/api/demo/status` - and `POST /mcp` - now requires a session (HttpOnly `tt_session` cookie for the web, `Authorization: Bearer` for native/scripts) or a personal API token. `APP_TOKEN`/`X-App-Token` and the `Cf-Access-Authenticated-User-Email` bypass are removed. Passwords: HMAC(`AUTH_PEPPER`) + PBKDF2-SHA256 with per-user salt. New tables via migration `2026-11-12-auth.sql` (apply to both live D1s before deploying). New secrets `AUTH_PEPPER` (required) and `SETUP_TOKEN` (first account).
  - feat: personal API tokens (scope `mcp` or `full`) for MCP clients such as Claude Code (`claude mcp add --transport http ... --header "Authorization: Bearer ttp_..."`); `GET /mcp` answers 405
  - feat: web sign-in/first-account screens, sign out, password change, API token management in Settings; Flutter sign-in screen with secure token storage
  - feat: authed reads send `Cache-Control: private, no-cache`; the 304 path authenticates first
  ```
- **Prove it:** `node scripts/check-version.mjs` prints `Version 0.21.0 matches CHANGELOG.md.`

### [x] T29 - `AGENTS.md` and `README.md`
- **Depends:** T28. **Files:** `AGENTS.md`, `README.md`.
- **Do:** apply every bullet in BP §14 to `AGENTS.md` (API contract, CORS, MCP, conditional reads, worker layout, known gaps, definition of done; also replace "Protected by Cloudflare Zero Trust Access" in the snapshot with "Protected by built-in username/password auth (sessions + API tokens)"). Update the repo-layout tree with `worker/src/auth-crypto.js, auth.js, auth-routes.js, http.js`, `worker/test/helpers/`, `worker/.dev.vars.example`, `scripts/reset-password.mjs`. In `README.md` add a short "Authentication" section: required secrets, first-account setup, MCP client one-liner, link to the blueprint; replace any instruction that sets `APP_TOKEN`.
- **Prove it:** `grep -n "X-App-Token\|APP_TOKEN" AGENTS.md README.md` only shows lines that say it was removed.

### [ ] T30 - Final gate and smoke record
- **Depends:** T29. **Files:** none (PR/task note only).
- **Do:**
  1. `npm run verify` from repo root -> passes.
  2. `cd worker && npm test` -> all suites pass; note the test count vs T00.
  3. Local smoke with `cd worker && npx wrangler dev` (`.dev.vars` copied from the example, local D1 prepared with `npx wrangler d1 execute DB --local --file=../db/schema.sql --yes` and `seed.sql`) and record outputs for: BP §11.3 rows 1-5, 7-9 against `http://127.0.0.1:8787`.
  4. Confirm `git status` shows no `.dev.vars`, no `.wrangler/` state, and no file containing a `tts_`/`ttp_` token: `git grep -nE "tt[sp]_[A-Za-z0-9_-]{20,}"` prints nothing.
  5. List in the PR note the owner actions from BP §11.1/§11.2 (migrations on `timetracker` and `cf-timetracker`, secrets, custom domain, demo before merge).
