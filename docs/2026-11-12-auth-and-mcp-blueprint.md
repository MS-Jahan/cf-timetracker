# Auth (username + password) and authenticated MCP - blueprint

**Date:** 2026-11-12
**Branch:** `feat/password-auth-mcp`
**Version target:** 0.20.0 -> **0.21.0** (`feat!`, marked BREAKING in `CHANGELOG.md`)
**Supersedes:** the Zero Trust Access steps in `docs/2026-09-20-deploy-runbook.md` §5 and the `APP_TOKEN` / `Cf-Access-*` gate in `worker/src/index.js`. The runbook is not edited (dated-docs rule); this file is the new source of truth for auth.
**Companion:** `docs/2026-11-12-auth-and-mcp-task-list.md` (ordered implementation tasks).

---

## 0. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | **Single-tenant shared workspace.** Users authenticate; every authenticated user sees the same data. No `user_id` on `customers/projects/activities/time_entries`. | Existing rows have no owner. Per-user scoping would touch every query in `core.js` (1500 lines), and the single-running-timer guarantee is a *global* partial unique index (`idx_entries_single_running`) that would have to become `(user_id, is_running)` - a rewrite of the most safety-critical invariant. `data_rev`/ETag is also global. This is a personal instance; multi-tenancy is a separate project (see §13). |
| D2 | **Password hash = HMAC-SHA256 pepper pre-hash, then PBKDF2-SHA256, per-user random 16-byte salt, 100 000 iterations, 256-bit output.** Pepper = `AUTH_PEPPER` Worker secret. | WebCrypto in Workers offers PBKDF2, not Argon2/scrypt. **workerd rejects PBKDF2 iteration counts above 100 000**, below OWASP's 600 000 for PBKDF2-SHA256. The secret pepper (not stored in D1) compensates: a leaked D1 export/backup alone is not crackable. The per-user salt defeats precomputation and makes equal passwords hash differently. HMAC pre-hash is the standard way to apply a pepper and also bounds input length. |
| D3 | **Credentials:** opaque random tokens, stored only as SHA-256 hashes in D1. Two kinds: **session** (`tts_` prefix, 30-day absolute expiry) and **personal API token** (`ttp_` prefix, optional expiry, scope `mcp` or `full`). | Revocable server-side (logout, password change, token revoke). No JWT signing key to manage. SHA-256 (no pepper) is sufficient for 256-bit random tokens. |
| D4 | **Web transport = HttpOnly cookie `tt_session`** (`Secure; SameSite=Lax; Path=/`) by default; **Bearer fallback** (`VITE_AUTH_TRANSPORT=bearer`, token in `localStorage`) for deployments where UI and API are cross-site (the demo: `*.pages.dev` vs `*.workers.dev`). Native app, scripts and MCP always use `Authorization: Bearer`. | Cookies keep the token away from JS but only work reliably when the UI and API are **same-site**. Personal instance: move the API to a `sabit.dev` subdomain (`tt-api.sabit.dev`) - same site as `timetracker.sabit.dev`. The demo cannot get a shared registrable domain, so it uses Bearer. |
| D5 | **First user = one-time setup endpoint** `POST /api/auth/setup` guarded by the `SETUP_TOKEN` secret, only while the `users` table is empty (atomic `INSERT ... WHERE NOT EXISTS`). Recovery/offline path: `scripts/reset-password.mjs` prints SQL using the same hashing module. | No plaintext admin password ever sits in Worker env. Setup is self-disabling. |
| D6 | **Remove** `APP_TOKEN`/`X-App-Token` and the `Cf-Access-Authenticated-User-Email` bypass entirely. | The Access header bypass is a live hole today: when Access is not in front of the Worker (it is not - T-Z1 never done), anyone can send that header and skip `APP_TOKEN`. One auth path is easier to reason about. Breaking for native clients that used `APP_TOKEN` (personal instance has it unset). |
| D7 | **MCP stays `POST /mcp` (JSON-RPC, plain JSON response)**, now requires `Authorization: Bearer <session or API token>`. Cookies are **not** accepted on `/mcp` (CSRF: `handleMcp` parses any body as JSON). `GET /mcp` -> 405. Tool schemas unchanged. | Works with Claude Code's `--transport http` + `--header`, `.mcp.json` `headers`, and `mcp-remote` for stdio-only clients. |
| D8 | **Auth runs before the ETag/304 shortcut.** Authed responses carry `Cache-Control: private, no-cache`; `/api/auth/*` responses carry `Cache-Control: no-store` and are never ETagged. Auth routes never bump `data_rev`. | A 304 must never be served to an unauthenticated caller; identity responses must not be revalidated against a data counter. |
| D9 | **Rate limiting in D1**: per-IP attempt window (10 per 15 min, pre-charged atomically) for login/setup + per-account lockout (5 consecutive failures -> locked 15 min). No new binding. | Testable with the in-memory SQLite test DB; no paid-plan dependency; race-free via a single upsert-with-RETURNING. |

---

## 1. Threat model

**Assets:** time entries, client names, billing rates/costs (confidential business data); the ability to start/stop timers and edit history; Worker secrets (`GAS_SECRET`, `GEMINI_API_KEY` - abusable for cost); the Sheets webhook proxy.

| Threat | Today | After |
|---|---|---|
| Anonymous internet reads/writes the API (workers.dev URL is public) | Open unless `APP_TOKEN` set; personal has it unset | Every `/api/*` (except 5 public routes) and `/mcp` require a credential |
| Spoofed `Cf-Access-Authenticated-User-Email` header bypassing `APP_TOKEN` | Possible (Access not deployed) | Header ignored |
| Online password guessing | n/a | Per-IP window (10/15 min) + per-account lockout (5 -> 15 min) + 100k-iteration PBKDF2 |
| Username enumeration by timing | n/a | Unknown usernames still run PBKDF2 against a dummy hash; same 401 body |
| D1 dump / backup / Time Travel export leaked | n/a | Password hashes need `AUTH_PEPPER` (not in D1); session/API tokens stored as SHA-256 only |
| CSRF against cookie sessions (incl. sibling `*.sabit.dev` hosts - the zone has a wildcard record) | n/a | `SameSite=Lax` + **Origin must be in the explicit `ALLOWED_ORIGINS` list for every cookie-authenticated non-GET request**; `/mcp` never accepts cookies |
| Credentialed cross-origin reads | n/a | `Access-Control-Allow-Credentials: true` only for an origin explicitly listed (never with `*`) |
| XSS stealing the session | n/a | Cookie is HttpOnly (default transport). Bearer fallback in `localStorage` is weaker - only used on the demo |
| Stolen MCP/API token from a harness config | n/a | Scoped (`mcp` = `/mcp` only), revocable, optional expiry, shown once, prefix visible for identification; cannot mint tokens or change password |
| DNS rebinding against `/mcp` | n/a | If an `Origin` header is present on `/mcp` it must be allowed (MCP spec requirement) |
| Cached authed data served to someone else | n/a | `Cache-Control: private`; auth before 304 |
| Lockout used to deny the owner | n/a | Lock is 15 min and auto-expires; per-IP limit throttles the attacker first. Accepted risk |

Not defended (out of scope, see §13): compromised device/browser, malicious authenticated user (single-tenant: any user can do anything), SSRF through the user-supplied `gasWebhookUrl` (pre-existing, authenticated-only now).

---

## 2. Schema

Append to `db/schema.sql` **and** create `db/migrations/2026-11-12-auth.sql` with the identical statements. All are `CREATE ... IF NOT EXISTS`, so the migration is idempotent and safe to re-run (unlike `ALTER TABLE ADD COLUMN`). Timestamps are epoch **milliseconds** (`INTEGER`), matching `time_entries`.

```sql
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
```

`db/seed.sql` is **not** changed: no user is seeded (a hash depends on the secret pepper). `resetDemoData` in `core.js` must keep deleting only `time_entries` (it never touches auth tables - verify, do not change).

---

## 3. Environment variables and secrets

| Name | Kind | Required | Default | Purpose |
|---|---|---|---|---|
| `AUTH_PEPPER` | secret | **yes** | - | HMAC key applied before PBKDF2. >= 32 chars (`openssl rand -base64 48`). Missing/short -> every protected route answers **503 `auth_not_configured`** (fail closed). **Rotating it invalidates every password** (reset with `scripts/reset-password.mjs`). |
| `SETUP_TOKEN` | secret | only for first-user setup | - | >= 24 chars (`openssl rand -base64 32`). Unset -> `POST /api/auth/setup` answers 403 `setup_disabled`. Delete after setup (optional hardening; setup is also disabled once a user exists). |
| `AUTH_PBKDF2_ITERATIONS` | var | no | `100000` | Clamped to `[1000, 100000]`. Tests use `1000`. Lower only if the Workers plan CPU limit forces it (see §12 R1). Stored per hash, so changing it rehashes on next successful login. |
| `SESSION_TTL_HOURS` | var | no | `720` (30 days) | Absolute session lifetime, clamped `[1, 2160]`. |
| `SESSION_COOKIE_SAMESITE` | var | no | `Lax` | `Lax` / `Strict` / `None`. `None` also adds `Partitioned`. Only needed for cross-site cookie experiments; the supported cross-site path is Bearer. |
| `AUTH_IP_LIMIT` | var | no | `10` | Attempts per IP per 15-min window for login (setup uses a fixed 5). |
| `ALLOWED_ORIGINS` | var (existing) | yes in prod | `*` | Now also the **CSRF allowlist** for cookie sessions and the credentialed-CORS allowlist. `*` disables cookie writes (cookie-authenticated non-GET -> 403) - use Bearer transport with `*`. |
| `DEMO_MODE` | var (existing) | no | `"false"` | Unchanged. Auth is required in demo mode too; there is **no auth-disable switch**. |
| `APP_TOKEN` | secret (existing) | **removed** | - | No longer read. `wrangler secret delete APP_TOKEN` if it was ever set. |

Local development: `worker/.dev.vars` (gitignored). Commit `worker/.dev.vars.example` with placeholder values only:

```ini
# Copy to worker/.dev.vars. Local-only values; never reuse in production.
AUTH_PEPPER=local-dev-pepper-change-me-0123456789abcdef
SETUP_TOKEN=local-dev-setup-token-0123456789
ALLOWED_ORIGINS=http://localhost:5173
# AUTH_PBKDF2_ITERATIONS=100000
```

---

## 4. Crypto module - `worker/src/auth-crypto.js` (pure, no D1)

Pure WebCrypto (`globalThis.crypto`), so the **same file** runs in the Worker, in `node --test`, and in `scripts/reset-password.mjs` (Node 22 exposes `crypto.subtle`, `btoa`, `atob`). Copy this verbatim:

```js
// Pure WebCrypto helpers shared by the Worker, node --test, and scripts/reset-password.mjs.
// No D1, no env access beyond what callers pass in. See docs/2026-11-12-auth-and-mcp-blueprint.md §4.

export const PBKDF2_MAX_ITERATIONS = 100_000; // Cloudflare Workers rejects higher counts
export const PBKDF2_MIN_ITERATIONS = 1_000; // floor for tests; production default is the max
export const SESSION_PREFIX = "tts_";
export const API_TOKEN_PREFIX = "ttp_";
const HASH_SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;
const encoder = new TextEncoder();

export const utf8 = (text) => encoder.encode(text);

export function b64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 256-bit random opaque token with a type prefix ("tts_" session, "ttp_" API token). */
export const generateToken = (prefix) => `${prefix}${b64urlEncode(randomBytes(32))}`;

export async function sha256Hex(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal lengths; length mismatch returns false (lengths are public here). */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Iteration count from env, clamped to what workerd accepts. */
export function resolveIterations(env) {
  const n = Number.parseInt(env?.AUTH_PBKDF2_ITERATIONS ?? "", 10);
  if (!Number.isFinite(n)) return PBKDF2_MAX_ITERATIONS;
  return Math.min(PBKDF2_MAX_ITERATIONS, Math.max(PBKDF2_MIN_ITERATIONS, n));
}

async function derive(password, pepper, salt, iterations) {
  const hmacKey = await crypto.subtle.importKey("raw", utf8(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const peppered = await crypto.subtle.sign("HMAC", hmacKey, utf8(String(password).normalize("NFKC")));
  const baseKey = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, baseKey, KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password, pepper, { iterations = PBKDF2_MAX_ITERATIONS } = {}) {
  if (!pepper) throw new Error("AUTH_PEPPER is required to hash passwords");
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, pepper, salt, iterations);
  return `${HASH_SCHEME}$${iterations}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export function parseHash(stored) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 4 || parts[0] !== HASH_SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return null;
  try {
    return { iterations, salt: b64urlDecode(parts[2]), hash: b64urlDecode(parts[3]) };
  } catch {
    return null;
  }
}

/** Well-formed hash that matches nothing: verify against it when the user does not exist (timing). */
export const dummyHash = (iterations = PBKDF2_MAX_ITERATIONS) =>
  `${HASH_SCHEME}$${iterations}$${b64urlEncode(new Uint8Array(SALT_BYTES))}$${b64urlEncode(new Uint8Array(KEY_BITS / 8))}`;

/** { ok, needsRehash }. needsRehash = matched but stored with a different iteration count. */
export async function verifyPassword(password, stored, pepper, { iterations: wanted = PBKDF2_MAX_ITERATIONS } = {}) {
  const parsed = parseHash(stored);
  if (!parsed || !pepper) return { ok: false, needsRehash: false };
  const candidate = await derive(password, pepper, parsed.salt, parsed.iterations);
  const ok = constantTimeEqual(candidate, parsed.hash);
  return { ok, needsRehash: ok && parsed.iterations !== wanted };
}
```

Known vector for tests: `sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
Measured cost on the dev box (Node, ARM): PBKDF2-SHA256 100k = ~35 ms, 1k = ~1 ms.

Token hash lookup uses SQL equality on the SHA-256 hex. That comparison is not constant-time, but the attacker cannot steer a 256-bit preimage's hash, so the timing reveals nothing usable (same reasoning as GitHub token storage).

---

## 5. Auth store - `worker/src/auth.js` (D1 operations)

Layering mirrors `core.js`: functions take `env` (+ args), touch D1, and return `{ status, ... }` objects; HTTP mapping happens in the route layer. Statuses: `ok | invalid | unauthorized | forbidden | not_found | conflict | rate_limited | unavailable`.

Constants:

```js
export const SESSION_COOKIE = "tt_session";
const WINDOW_MS = 15 * 60_000;     // throttle window
const LOCK_MS = 15 * 60_000;       // account lock length
const MAX_FAILED = 5;              // consecutive failures before lock
const SETUP_IP_LIMIT = 5;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const TOKEN_LAST_USED_GRANULARITY_MS = 60 * 60_000; // write last_used_at at most hourly
```

### 5.1 Config and validation

```js
export const authConfigured = (env) => typeof env.AUTH_PEPPER === "string" && env.AUTH_PEPPER.length >= 32;
export const normalizeUsername = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export function validateUsername(name) { return USERNAME_RE.test(name) ? null : "username must be 3-64 chars: a-z, 0-9, dot, dash, underscore"; }
export function validatePassword(password, username) {
  if (typeof password !== "string" || password.length < 12) return "password must be at least 12 characters";
  if (password.length > 256) return "password must be at most 256 characters";
  if (password.toLowerCase() === username) return "password must not equal the username";
  return null;
}
const ipLimit = (env) => { const n = Number.parseInt(env.AUTH_IP_LIMIT ?? "", 10); return Number.isFinite(n) && n >= 1 ? n : 10; };
export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";
const publicUser = (row) => ({ id: row.id ?? row.user_id, username: row.username });
```

### 5.2 Throttle (atomic, race-free)

Every attempt is pre-charged with one upsert; a success clears the key. In SQLite `UPDATE ... SET` expressions all read the pre-update row, so `count` and `window_start` use the old `window_start`.

```js
export async function chargeThrottle(env, key, { limit, windowMs = WINDOW_MS, now = Date.now() }) {
  const cutoff = now - windowMs;
  const row = await env.DB.prepare(
    `INSERT INTO auth_throttle (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
     RETURNING count, window_start`
  ).bind(key, now, cutoff, cutoff, now).first();
  const allowed = row.count <= limit;
  return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
}
export const clearThrottle = (env, key) => env.DB.prepare("DELETE FROM auth_throttle WHERE key = ?").bind(key).run();
```

### 5.3 Sessions and cookies

```js
const sessionTtlMs = (env) => {
  const h = Number.parseInt(env.SESSION_TTL_HOURS ?? "", 10);
  return (Number.isFinite(h) && h >= 1 && h <= 2160 ? h : 720) * 3_600_000;
};

export async function createSession(env, userId, { userAgent = "", now = Date.now() } = {}) {
  const token = generateToken(SESSION_PREFIX);
  const ttlMs = sessionTtlMs(env);
  const expiresAt = now + ttlMs;
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, expiresAt, String(userAgent || "").slice(0, 200)).run();
  return { token, expiresAt, maxAgeSec: Math.floor(ttlMs / 1000) };
}
export const revokeSession = (env, sessionId) => env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
export async function revokeOtherSessions(env, userId, keepSessionId) {
  const res = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, keepSessionId ?? "").run();
  return res.meta?.changes ?? 0;
}
export async function purgeExpired(env, now = Date.now()) {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM auth_throttle WHERE window_start <= ?").bind(now - 24 * 3_600_000).run();
}

function sameSite(env) {
  const v = String(env.SESSION_COOKIE_SAMESITE || "Lax").toLowerCase();
  return v === "strict" ? "Strict" : v === "none" ? "None" : "Lax";
}
export function sessionCookie(env, token, maxAgeSec) {
  const s = sameSite(env);
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "Secure", `SameSite=${s}`, `Max-Age=${maxAgeSec}`];
  if (s === "None") parts.push("Partitioned");
  return parts.join("; ");
}
export const clearSessionCookie = (env) => sessionCookie(env, "", 0);
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
```

### 5.4 `authenticate(request, env, { allowCookie })`

```js
const SESSION_LOOKUP = `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username
  FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`;
const TOKEN_LOOKUP = `SELECT t.id AS token_id, t.scope, t.expires_at, t.last_used_at, u.id AS user_id, u.username
  FROM api_tokens t JOIN users u ON u.id = t.user_id
  WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`;

/** Returns { kind, via, scope, user, sessionId?, tokenId?, expiresAt } or null. Never throws on bad input. */
export async function authenticate(request, env, { allowCookie = true, now = Date.now() } = {}) {
  let token = null;
  let via = null;
  const header = request.headers.get("Authorization") || "";
  const bearer = header.match(/^Bearer\s+(\S+)$/i);
  if (bearer) {
    token = bearer[1];
    via = "header";
  } else if (allowCookie) {
    token = parseCookies(request.headers.get("Cookie"))[SESSION_COOKIE] || null;
    via = token ? "cookie" : null;
  }
  if (!token || token.length > 200) return null;
  const hash = await sha256Hex(token);

  if (token.startsWith(SESSION_PREFIX)) {
    const row = await env.DB.prepare(SESSION_LOOKUP).bind(hash, now).first();
    if (!row) return null;
    return { kind: "session", via, scope: "full", sessionId: row.session_id, expiresAt: row.expires_at, user: publicUser(row) };
  }
  if (token.startsWith(API_TOKEN_PREFIX) && via === "header") {
    const row = await env.DB.prepare(TOKEN_LOOKUP).bind(hash, now).first();
    if (!row) return null;
    if (!row.last_used_at || row.last_used_at < now - TOKEN_LAST_USED_GRANULARITY_MS) {
      await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(now, row.token_id).run();
    }
    return { kind: "token", via, scope: row.scope, tokenId: row.token_id, expiresAt: row.expires_at, user: publicUser(row) };
  }
  return null;
}
```

Rules: an invalid `Authorization` header does **not** fall back to the cookie. API tokens are only accepted from the header.

### 5.5 `setupFirstUser(env, { setupToken, username, password, ip, userAgent })`

Order (each step returns early):
1. `!authConfigured(env)` -> `{ status: "unavailable", code: "auth_not_configured" }`.
2. `SELECT 1 FROM users LIMIT 1` exists -> `{ status: "conflict", code: "setup_complete" }`.
3. `!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 24` -> `{ status: "forbidden", code: "setup_disabled" }`.
4. `chargeThrottle(env, "setup:" + ip, { limit: 5 })` not allowed -> `{ status: "rate_limited", code: "too_many_attempts", retryAfter }`.
5. Compare `utf8(await sha256Hex(setupToken ?? ""))` vs `utf8(await sha256Hex(env.SETUP_TOKEN))` with `constantTimeEqual`; mismatch -> `{ status: "forbidden", code: "invalid_setup_token" }`.
6. Validate username/password -> `{ status: "invalid", code: "invalid_username" | "weak_password", error }`.
7. `hashPassword(password, env.AUTH_PEPPER, { iterations: resolveIterations(env) })`, then
   ```sql
   INSERT INTO users (id, username, password_hash, password_changed_at, created_at)
   SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)
   ```
   `meta.changes === 0` -> `conflict / setup_complete` (lost a race).
8. `clearThrottle`, `createSession` -> `{ status: "ok", user, token, expiresAt, maxAgeSec }`.

### 5.6 `login(env, { username, password, ip, userAgent })`

```js
export async function login(env, { username, password, ip = "unknown", userAgent = "" } = {}) {
  if (!authConfigured(env)) return { status: "unavailable", code: "auth_not_configured", error: "Authentication is not configured on the server" };
  const name = normalizeUsername(username);
  if (!name || typeof password !== "string" || !password) return { status: "invalid", code: "invalid_request", error: "username and password are required" };
  const now = Date.now();
  const throttleKey = `login:${ip}`;
  const throttle = await chargeThrottle(env, throttleKey, { limit: ipLimit(env), now });
  const tooMany = (retryAfter) => ({ status: "rate_limited", code: "too_many_attempts", retryAfter, error: "Too many sign-in attempts. Try again later." });
  if (!throttle.allowed) return tooMany(throttle.retryAfter);

  const user = await env.DB.prepare("SELECT id, username, password_hash, locked_until FROM users WHERE username = ?").bind(name).first();
  if (user?.locked_until && user.locked_until > now) return tooMany(Math.ceil((user.locked_until - now) / 1000));

  const iterations = resolveIterations(env);
  const { ok, needsRehash } = await verifyPassword(password, user?.password_hash ?? dummyHash(iterations), env.AUTH_PEPPER, { iterations });
  if (!user || !ok) {
    if (user) {
      await env.DB.prepare(
        `UPDATE users SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END
         WHERE id = ?`
      ).bind(MAX_FAILED, now + LOCK_MS, user.id).run();
    }
    return { status: "unauthorized", code: "invalid_credentials", error: "Invalid username or password" };
  }

  if (needsRehash) {
    const rehashed = await hashPassword(password, env.AUTH_PEPPER, { iterations });
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(rehashed, user.id).run();
  }
  await env.DB.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(now, user.id).run();
  await clearThrottle(env, throttleKey);
  await purgeExpired(env, now);
  const session = await createSession(env, user.id, { userAgent, now });
  return { status: "ok", user: publicUser(user), ...session };
}
```

Notes: after a lock expires, `failed_attempts` is still >= 5, so the next wrong password re-locks immediately (progressive; intended). The lock check precedes password verification, so a correct password during a lock is still refused (429).

### 5.7 `changePassword(env, auth, { currentPassword, newPassword })`

- `auth.kind !== "session"` -> `forbidden / session_required`.
- Load user; verify `currentPassword` (same failure bookkeeping as login: increments `failed_attempts`, may lock) -> `unauthorized / invalid_credentials`.
- `validatePassword(newPassword, username)` -> `invalid / weak_password`; equal to current -> `invalid / weak_password` ("must differ").
- Update `password_hash`, `password_changed_at = now`, `failed_attempts = 0`, `locked_until = NULL`; `revokeOtherSessions(env, user.id, auth.sessionId)`.
- Returns `{ status: "ok", revokedSessions }`. API tokens are **not** revoked (they are managed explicitly; the UI lists them).

### 5.8 API tokens

```js
// createApiToken(env, auth, { name, scope = "mcp", expiresInDays = null })
//   auth.kind !== "session"            -> forbidden / session_required
//   name: trimmed string 1..64         -> else invalid / invalid_request
//   scope in ("mcp","full")            -> else invalid / invalid_request
//   expiresInDays null | int 1..365    -> else invalid / invalid_request
//   >= 25 active (unrevoked, unexpired) tokens for the user -> conflict / too_many_tokens
//   token = generateToken(API_TOKEN_PREFIX); store sha256Hex(token), token.slice(0, 12)
//   -> { status: "ok", token, apiToken: toApiTokenDto(row) }   (raw token returned ONCE)
// listApiTokens(env, auth)   -> session only; active + expired, excluding revoked, newest first
// revokeApiToken(env, auth, id) -> session only;
//   UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL
//   changes === 0 -> not_found
const toApiTokenDto = (r) => ({
  id: r.id, name: r.name, scope: r.scope, prefix: r.token_prefix,
  createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null, expiresAt: r.expires_at ?? null,
});
```

**Never** return `password_hash`, `token_hash`, session ids, or raw DB rows from any auth function.

---

## 6. HTTP layer

### 6.1 `worker/src/http.js` (new; moved out of `index.js`)

```js
const BASE_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "ETag, Retry-After",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};
export const allowedOrigins = (env) => (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);

/** True only when the request Origin is explicitly listed ("*" never counts). */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return Boolean(origin) && allowedOrigins(env).some((o) => o !== "*" && o === origin);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const list = allowedOrigins(env);
  if (origin && list.includes(origin)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
  }
  if (list.includes("*")) return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin || "*" }; // no credentials with "*"
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": list[0] || "" };
}

export function jsonResponse(request, env, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env), ...extraHeaders },
  });
}
export const handleCors = (request, env) => new Response(null, { status: 204, headers: corsHeaders(request, env) });
export async function readJson(request) { try { return await request.json(); } catch { return null; } }
```

`X-App-Token` and `Cf-Access-Jwt-Assertion` leave the allowed-headers list.

### 6.2 Middleware order in `worker/src/index.js` `fetch`

```js
const PUBLIC_ROUTES = new Set([
  "GET /api/auth/status", "POST /api/auth/login", "POST /api/auth/setup", "POST /api/auth/logout", "GET /api/demo/status",
]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UNCACHED_GETS = new Set(["/api/rev", "/api/demo/status"]); // + any /api/auth/* (prefix check)
```

1. `OPTIONS` (any path) -> `handleCors` 204. No auth.
2. `pathname === "/mcp" && method !== "POST"` -> `405`, headers `{ Allow: "POST" }`, empty body.
3. Not `/api/*` and not `/mcp` -> `jsonResponse 404 { error: "Route not found" }`.
4. `PUBLIC_ROUTES.has(`${method} ${pathname}`)` -> `/api/auth/*` -> `handleAuthRoute(request, env, null)`; `/api/demo/status` -> `route()`. No ETag, no `data_rev` bump.
5. `!authConfigured(env)` -> `503 { error, code: "auth_not_configured" }`.
6. `auth = await authenticate(request, env, { allowCookie: pathname !== "/mcp" })`; null -> `401 { error: "Authentication required", code: "unauthenticated" }` with `WWW-Authenticate: Bearer realm="cf-timetracker"`.
7. `/api/*` and `auth.scope !== "full"` -> `403 { code: "insufficient_scope" }`.
8. `auth.via === "cookie" && !SAFE_METHODS.has(method) && !originAllowed(request, env)` -> `403 { code: "origin_not_allowed" }` (CSRF).
9. `/mcp`: if an `Origin` header is present, it must be allowed or `ALLOWED_ORIGINS` must contain `*`, else 403. Then `return handleMcp(request, env, auth)` (unchanged JSON-RPC; `start_timer`/`stop_timer` still bump `data_rev` inside `mcp.js`).
10. `/api/auth/*` (protected ones) -> `handleAuthRoute(request, env, auth)`; response gets `Cache-Control: no-store`; no ETag; no bump.
11. ETag block (existing logic) for `GET`, not in `UNCACHED_GETS`: read rev; `If-None-Match` match -> 304 with `ETag`, `Cache-Control: private, no-cache`, `Vary: Origin, Authorization, Cookie`, CORS headers.
12. `response = await route(request, env, auth)` (the old `APP_TOKEN` gate and the `/mcp` branch are deleted from `route`).
13. 200 + etag -> set `ETag`, `Cache-Control: private, no-cache`, `Vary: Origin, Authorization, Cookie`.
14. Mutating `/api/*` (`method` not GET/OPTIONS), not in `NON_MUTATING_POSTS`, not `/api/auth/*`, status < 400 -> `bumpDataRev`.

Wrap steps 4-14 in `try/catch` -> `jsonResponse 500 { error: err.message }` (route keeps its own catch too). Unknown `/api/*` paths now answer 401 to anonymous callers (no route enumeration) and 404 to authenticated ones.

`STATUS_CODES` in `index.js` gains: `unauthorized: 401, forbidden: 403, rate_limited: 429, unavailable: 503` (existing `invalid/conflict/not_found` unchanged).

### 6.3 `worker/src/auth-routes.js` - endpoint contracts

All bodies JSON. All responses `Content-Type: application/json`, CORS headers, `Cache-Control: no-store`. Error shape everywhere: `{ error: string, code: string }`; 429 adds header `Retry-After: <seconds>`.

| Method + path | Auth | Request body | Success | Errors |
|---|---|---|---|---|
| `GET /api/auth/status` | public | - | `200 { configured: bool, setupRequired: bool }` (`setupRequired` = no users; `false` when not configured) | - |
| `POST /api/auth/setup` | public + `setupToken` | `{ setupToken, username, password, transport?: "cookie"\|"token" }` | `201 { user: {id, username}, expiresAt, token? }`; `Set-Cookie` when transport is cookie (default) | 400 `invalid_request`/`invalid_username`/`weak_password`; 403 `setup_disabled`/`invalid_setup_token`; 409 `setup_complete`; 429 `too_many_attempts`; 503 `auth_not_configured` |
| `POST /api/auth/login` | public | `{ username, password, transport?: "cookie"\|"token" }` | `200 { user, expiresAt, token? }` (+ `Set-Cookie` for cookie) | 400 `invalid_request`; 401 `invalid_credentials`; 429 `too_many_attempts`; 503 `auth_not_configured` |
| `POST /api/auth/logout` | public (uses credential if present) | - | `200 { success: true }`; deletes the presented session (cookie or `tts_` Bearer); always sends the clearing `Set-Cookie` | - |
| `GET /api/auth/me` | any credential, scope `full` | - | `200 { user: {id, username}, auth: { kind: "session"\|"token", scope, expiresAt } }` | 401 |
| `POST /api/auth/password` | session only | `{ currentPassword, newPassword }` | `200 { success: true, revokedSessions: n }` | 400 `weak_password`; 401 `invalid_credentials`; 403 `session_required`; 429 |
| `GET /api/auth/tokens` | session only | - | `200 { tokens: ApiToken[] }` | 403 `session_required` |
| `POST /api/auth/tokens` | session only | `{ name, scope?: "mcp"\|"full", expiresInDays?: 1..365\|null }` | `201 { token: "ttp_...", apiToken: ApiToken }` | 400 `invalid_request`; 403; 409 `too_many_tokens` |
| `DELETE /api/auth/tokens/:id` | session only | - | `200 { success: true }` | 403; 404 `not_found` |

`ApiToken` = `{ id, name, scope, prefix, createdAt, lastUsedAt, expiresAt }` (epoch ms or null).
`transport` defaults to `"cookie"`; any value other than `"token"` means cookie. With `"token"`, no cookie is set and `token` is in the body.

Skeleton:

```js
import { jsonResponse, readJson } from "./http.js";
import * as auth from "./auth.js";

const CODES = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429, unavailable: 503 };
const NO_STORE = { "Cache-Control": "no-store" };

function fail(request, env, result) {
  const headers = { ...NO_STORE, ...(result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {}) };
  return jsonResponse(request, env, { error: result.error || result.code, code: result.code }, CODES[result.status] || 400, headers);
}

function sessionResponse(request, env, result, transport, status) {
  const body = { user: result.user, expiresAt: result.expiresAt };
  const headers = { ...NO_STORE };
  if (transport === "token") body.token = result.token;
  else headers["Set-Cookie"] = auth.sessionCookie(env, result.token, result.maxAgeSec);
  return jsonResponse(request, env, body, status, headers);
}

/** Returns a Response for /api/auth/* or null when the path is not an auth route. */
export async function handleAuthRoute(request, env, authContext) { /* dispatch per table above */ }
```

`ip` = `auth.clientIp(request)`; `userAgent` = `request.headers.get("User-Agent")`.

---

## 7. MCP server and clients

### 7.1 Server (unchanged protocol, new gate)

- Endpoint: `POST <API_BASE>/mcp`, JSON-RPC 2.0, `protocolVersion: "2025-06-18"`, single JSON response (no SSE, no session id), notifications -> 202.
- New: requires `Authorization: Bearer <tts_... | ttp_...>`; API tokens of scope `mcp` or `full` both work. No cookie. 401 carries `WWW-Authenticate: Bearer realm="cf-timetracker"`.
- New: `GET /mcp` (and any non-POST) -> 405 `Allow: POST` (Streamable HTTP spec: a server without an SSE stream answers GET with 405).
- `handleMcp(request, env, auth)` gains the `auth` argument (unused by tools today; reserved for attribution). Tool list, names, input schemas and result shapes are **unchanged**: `get_active_timer`, `start_timer`, `stop_timer`, `query_summary`.

Smoke:
```bash
TOKEN=ttp_xxx; BASE=https://tt-api.sabit.dev
curl -s "$BASE/mcp" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'                         # 200, 4 tools
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/mcp" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'                               # 401
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/mcp"                           # 405
```

### 7.2 Getting a token

Web: Settings -> **API tokens** -> name it (e.g. "Claude Code laptop"), scope **MCP only**, expiry -> Create -> copy the `ttp_...` value (shown once). Or via API with a session:
```bash
curl -s "$BASE/api/auth/tokens" -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"claude-code","scope":"mcp","expiresInDays":90}'
```

### 7.3 Client configs

**Claude Code (CLI):**
```bash
claude mcp add --transport http timetracker https://tt-api.sabit.dev/mcp \
  --header "Authorization: Bearer ttp_xxx"            # add --scope user to use it in every project
claude mcp list                                        # should show timetracker connected
```

**Project `.mcp.json`** (do **not** commit a real token; Claude Code expands `${VAR}`):
```json
{
  "mcpServers": {
    "timetracker": {
      "type": "http",
      "url": "https://tt-api.sabit.dev/mcp",
      "headers": { "Authorization": "Bearer ${TIMETRACKER_MCP_TOKEN}" }
    }
  }
}
```

**Stdio-only clients (e.g. Claude Desktop local config)** via the `mcp-remote` bridge:
```json
{
  "mcpServers": {
    "timetracker": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://tt-api.sabit.dev/mcp", "--header", "Authorization:${TT_AUTH}"],
      "env": { "TT_AUTH": "Bearer ttp_xxx" }
    }
  }
}
```

If a client reports that the server "needs authentication" or tries an OAuth flow, the token is missing, wrong, expired or revoked (the server answers 401; it has no OAuth endpoints). claude.ai remote connectors that require OAuth are out of scope (§13).

The `.mcp.json` file is not added to the repo (the URL and token are per user); this section is the reference.

---

## 8. Web (Vite + React)

### 8.1 `web/src/lib/api.js`
- `AUTH_TRANSPORT = import.meta.env.VITE_AUTH_TRANSPORT === "bearer" ? "bearer" : "cookie"`.
- `request(path, { auth = true, ...options })`:
  - cookie transport: `credentials: "include"`; bearer transport: `credentials: "omit"` and `Authorization: Bearer <localStorage["cf-tt-session"]>` when present.
  - On `401` and `auth !== false`: remove the stored token and `window.dispatchEvent(new Event("tt:unauthorized"))`.
  - Keep the existing error object (`status`, `code`, `entry`); add `retryAfter` from the `Retry-After` header.
- New exports: `UNAUTHORIZED_EVENT`, `getAuthStatus()`, `getMe()`, `login(username, password)`, `setupFirstUser({ setupToken, username, password })`, `logout()`, `changePassword(currentPassword, newPassword)`, `listApiTokens()`, `createApiToken({ name, scope, expiresInDays })`, `revokeApiToken(id)`, `MCP_URL` (`new URL("/mcp", API_BASE || window.location.origin).href`).
  - `getAuthStatus`, `getMe`, `login`, `setupFirstUser`, `logout`, `changePassword` pass `auth: false` (a wrong current password must not sign the user out).
  - `login`/`setupFirstUser` send `transport: AUTH_TRANSPORT === "bearer" ? "token" : "cookie"` and store `data.token` when present.
  - `logout` always clears the stored token, even when the request fails.
- Every existing wrapper keeps its signature.

### 8.2 `web/src/lib/useAuth.js` (new hook)
State `{ status: "loading" | "authenticated" | "anonymous" | "error", user, setupRequired, configured, error }`.
- Mount: `getMe()` -> authenticated. On `err.status === 401` -> `getAuthStatus()` -> anonymous (+ `setupRequired`, `configured`). Other errors (503, network) -> `error`.
- Listens to `UNAUTHORIZED_EVENT` -> anonymous.
- Returns `{ ...state, refresh, signIn(username, password), setup(fields), signOut() }`.

### 8.3 `web/src/pages/LoginPage.jsx` (new screen)
daisyUI `card` centered: brand mark, "Sign in" form (`username` autocomplete=`username`, `password` autocomplete=`current-password`), submit `btn btn-primary`, `alert alert-error` for errors (429 shows "Try again in N minutes" from `retryAfter`). When `setupRequired`: "Create the first account" form with Setup token, Username, Password, Confirm password (autocomplete=`new-password`, min 12). When `!configured`: `alert alert-warning` "Server authentication is not configured (AUTH_PEPPER)". No Tailwind `@apply`, no new CSS.

### 8.4 `web/src/App.jsx`
- Rename current component to `AuthedApp({ user, onSignOut })`; new default `App()`: splash (unchanged) -> `useAuth()` -> `loading` spinner (`loading loading-spinner`) / `error` panel with Retry / `LoginPage` / `AuthedApp`.
- `AuthedApp` sidebar, under Appearance: "Signed in as **username**" + `btn btn-ghost btn-sm` **Sign out** (`no-print`).
- Because `useTracker()` lives in `AuthedApp`, no data request is made before sign-in. `/print` stays inside `AuthedApp`.

### 8.5 Settings (`web/src/pages/SettingsPage.jsx` + two components)
- `web/src/components/AccountPanel.jsx`: change password (current, new, confirm); success notice "Password changed. Other sessions were signed out."
- `web/src/components/ApiTokensPanel.jsx`: list (name, scope badge, `prefix…`, created, last used, expires, Revoke); create form (name, scope `mcp`/`full`, expiry none/30/90/365 days); after create, show the raw token once in a `<code>` block with a Copy button plus ready-to-paste `claude mcp add ...` and `.mcp.json` snippets built from `MCP_URL`.
- SettingsPage gets sections **Account** and **API tokens & MCP** (before "Connection"). "Connection" gains an "Auth transport" row (`cookie`/`bearer`).

### 8.6 Builds
- Personal (Pages Git integration, dashboard env vars): `VITE_API_BASE=https://tt-api.sabit.dev` (cookie transport, default). If the custom API domain is not set up yet: keep the workers.dev URL and set `VITE_AUTH_TRANSPORT=bearer`.
- Demo (`.github/workflows/deploy.yml`, build step env): add `VITE_AUTH_TRANSPORT: bearer`.
- Local: `worker/.dev.vars` with `ALLOWED_ORIGINS=http://localhost:5173`; web on `localhost:5173` and worker on `localhost:8787` are same-site, so cookies work in Chrome/Firefox (Secure cookies are allowed on `localhost`). If a browser refuses, run with `VITE_AUTH_TRANSPORT=bearer npm run dev`.

---

## 9. Flutter (`apps/timetracker`) - minimal

- Dependency: `flutter_secure_storage: ^9.2.2` (Keychain / Android Keystore / Windows Credential Manager / libsecret). Linux build needs `libsecret-1-dev` and `libjsoncpp-dev` -> add to `.github/workflows/build.yml` Linux apt step.
- `lib/token_store.dart`: `abstract class TokenStore { Future<String?> read(); Future<void> write(String token); Future<void> clear(); }`, `SecureTokenStore` (key `tt_session_token`), `MemoryTokenStore` (tests).
- `TrackerApi`: replace `appToken` with `token`; header `Authorization: Bearer <token>` when non-empty; `Future<String> login(String username, String password)` posting `{username, password, transport: "token"}` to `/api/auth/login` and returning `token`; `Future<void> logout()` (POST `/api/auth/logout`, ignore errors); `_decode` throws `UnauthorizedException` on 401 (new class), `Exception(body['error'])` otherwise; tolerate non-JSON bodies.
- `lib/login_view.dart`: `LoginView` with API URL (prefilled from prefs), username, password, Sign in button, error text.
- Shell: `TimeTrackerApp({TokenStore? tokenStore})` -> passes store to `TrackerShell`. `loadConfig` reads API URL (SharedPreferences, as today) and token (TokenStore). No token -> `LoginView`. Successful login -> write token, `load()`. Any `UnauthorizedException` -> clear token -> `LoginView`. Settings: remove the "App token" field (the `app_token` pref is deleted on first run), add **Sign out**.
- Test: `test/widget_test.dart` pumps `TimeTrackerApp(tokenStore: MemoryTokenStore())` with `SharedPreferences.setMockInitialValues({})` and expects the text `Sign in`.
- Not part of `npm run verify`; runs in `build.yml` (`flutter test`).

---

## 10. Verification gate and scripts

### 10.1 `scripts/verify.mjs`
When it owns the Worker (no `VERIFY_API_BASE`):
1. Create a temp dir (`mkdtempSync(join(tmpdir(), "tt-verify-"))`) -> hermetic local D1; delete it in `finally`.
2. `npx wrangler d1 execute DB --local --persist-to <dir> --file=../db/schema.sql --yes`, same for `../db/seed.sql` (cwd `worker/`).
3. Read `worker/.dev.vars` if present (simple `KEY=VALUE` parser). `AUTH_PEPPER = devVars.AUTH_PEPPER ?? "verify-local-pepper-not-a-secret-0123456789"`, `SETUP_TOKEN = devVars.SETUP_TOKEN ?? "verify-local-setup-token-0123456789"`. These are test-only constants, not secrets. Using the `.dev.vars` value when present makes the result independent of `--var` vs `.dev.vars` precedence.
4. `wrangler dev --local --port P --persist-to <dir> --var AUTH_PEPPER:<v> --var SETUP_TOKEN:<v>`.
5. `waitForApi` polls `GET /api/auth/status` (public) instead of `/api/bootstrap`.
6. `token = obtainToken(base)`: `POST /api/auth/setup { setupToken, username: "verify", password: "verify-local-password-1234", transport: "token" }`; on 409 fall back to `POST /api/auth/login` with the same credentials and `transport: "token"`.
7. Run `check-single-timer.mjs` with env `TT_TOKEN=<token>`.

With `VERIFY_API_BASE`: token from `VERIFY_TOKEN`, else login with `VERIFY_USERNAME` + `VERIFY_PASSWORD`, else fail with a clear message. The `verify.yml` "Prepare local D1 database" step becomes redundant and is removed.

### 10.2 Other scripts
- `scripts/check-single-timer.mjs`, `scripts/check-edge-cases.mjs`: send `Authorization: Bearer ${process.env.TT_TOKEN}` when set; on a 401 from the first call, exit 2 with "set TT_TOKEN (session or full-scope API token)".
- `scripts/kimai-import.mjs`, `scripts/kimai-export.mjs`: `TRACKER_TOKEN` now means a **full-scope API token**, sent as `Authorization: Bearer` (was `X-App-Token`).
- `scripts/reset-password.mjs` (new): `AUTH_PEPPER=... node scripts/reset-password.mjs <username> [--create]`, reads the new password from `NEW_PASSWORD` env or prompts (hidden input via `readline`), imports `../worker/src/auth-crypto.js`, validates username/password with the same rules, prints SQL only (never executes, never prints the password):
  ```sql
  UPDATE users SET password_hash = '<hash>', failed_attempts = 0, locked_until = NULL, password_changed_at = <now> WHERE username = '<u>';
  DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = '<u>');
  ```
  `--create` prints an `INSERT INTO users (...) VALUES (...)` instead. Run the output with `npx wrangler d1 execute DB [--env demo] --remote --command "<sql>"`.

---

## 11. Rollout and runbook (owner actions)

The orchestrator does **not** run remote commands. Apply in this order; **deploys do not run migrations**, and `deploy.yml` auto-deploys the **demo** on every push to `main`, so the demo steps must be done **before** merging.

### 11.1 Personal instance (`timetracker` D1, top-level wrangler env, `sabit.dev` account)
From `worker/`:
1. Check: `npx wrangler d1 execute DB --remote --command "SELECT group_concat(name) FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','api_tokens','auth_throttle')"`.
2. Migrate: `npx wrangler d1 execute DB --remote --file=../db/migrations/2026-11-12-auth.sql` (idempotent; safe to re-run).
3. Secrets: `npx wrangler secret put AUTH_PEPPER` (`openssl rand -base64 48`), `npx wrangler secret put SETUP_TOKEN` (`openssl rand -base64 32`). Store the pepper in a password manager - losing it means resetting every password.
4. Recommended - same-site API: Workers dashboard -> `timetracker-api` -> Settings -> Domains & Routes -> **Add Custom Domain** `tt-api.sabit.dev`. Pages project env: `VITE_API_BASE=https://tt-api.sabit.dev`. (Alternative: keep workers.dev and set `VITE_AUTH_TRANSPORT=bearer`.) `ALLOWED_ORIGINS` stays `https://timetracker.sabit.dev,https://timetracker-8ss.pages.dev` (the pages.dev fallback is cross-site with `tt-api.sabit.dev`, so cookie sign-in only works on `timetracker.sabit.dev`).
5. Deploy Worker: `npx wrangler deploy`; rebuild Pages (push or dashboard retry).
6. First user: open `https://timetracker.sabit.dev` -> "Create the first account" with the setup token. Or:
   `curl -s https://tt-api.sabit.dev/api/auth/setup -H 'Content-Type: application/json' -d '{"setupToken":"...","username":"sabit","password":"...","transport":"token"}'`
7. Optional: `npx wrangler secret delete SETUP_TOKEN`; `npx wrangler secret delete APP_TOKEN` if it exists.
8. Create an MCP token in Settings and configure Claude Code (§7.3).

### 11.2 Demo instance (`cf-timetracker` D1, `--env demo`, other account login)
1. `npx wrangler d1 execute DB --env demo --remote --file=../db/migrations/2026-11-12-auth.sql`
2. `npx wrangler secret put AUTH_PEPPER --env demo`, `npx wrangler secret put SETUP_TOKEN --env demo`.
3. Merge to `main` -> CI deploys Worker + Pages (Pages built with `VITE_AUTH_TRANSPORT=bearer`).
4. Create the demo account via the setup form. **Product note:** the demo now requires a login; publishing demo credentials (or a future guest mode) is a separate decision.

### 11.3 Smoke checklist (record in the PR)
| # | Check | Expected |
|---|---|---|
| 1 | `curl -s $BASE/api/auth/status` | `{"configured":true,"setupRequired":false}` |
| 2 | `curl -s -o /dev/null -w '%{http_code}' $BASE/api/bootstrap` | `401` |
| 3 | `curl -s $BASE/api/bootstrap -H 'X-App-Token: anything' -H 'Cf-Access-Authenticated-User-Email: a@b.c' -o /dev/null -w '%{http_code}'` | `401` |
| 4 | Login with `transport:"token"` -> `GET /api/bootstrap` with Bearer | `200`, `ETag`, `Cache-Control: private, no-cache` |
| 5 | Same request with `If-None-Match` | `304` |
| 6 | Browser: sign in, start -> stop timer, sign out, reload | login screen after sign-out |
| 7 | 11 wrong passwords from one IP | 401 x10, then `429` + `Retry-After` |
| 8 | MCP `tools/list` with `ttp_` token; without token; `GET /mcp` | `200` (4 tools) / `401` / `405` |
| 9 | `mcp`-scope token on `/api/bootstrap` | `403 insufficient_scope` |
| 10 | `npx wrangler tail` during a login | no `exceededCpu`; if present see R1 |
| 11 | `VERIFY_API_BASE=$BASE VERIFY_TOKEN=<full token> npm run verify` | passes (leaves one closed race-check entry, as before) |

### 11.4 Rollback
`npx wrangler rollback` restores the previous Worker; the four new tables are additive and ignored by old code. **Rolling back re-opens the API** (old code had no auth and `APP_TOKEN` is unset) - if you roll back, also set `APP_TOKEN` as a stopgap.

---

## 12. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | PBKDF2 100k costs ~35 ms CPU; the Workers **Free** plan limit is 10 ms CPU per request, so login/setup/password-change may fail with "exceeded CPU" | Check the plan; on Free set `AUTH_PBKDF2_ITERATIONS` (e.g. `20000`) and rely on the pepper; existing hashes are upgraded/downgraded on next login. Paid plan: keep 100k. |
| R2 | Breaking change: native clients using `APP_TOKEN`, scripts using `X-App-Token`, and the open demo | CHANGELOG `BREAKING`; Flutter gets a login screen; scripts switch to Bearer API tokens; demo gets an account |
| R3 | Third-party cookie blocking when UI and API are cross-site | Same-site custom API domain for personal; Bearer transport for demo |
| R4 | Deploy before migration -> `no such table: users` (500) on every protected route; deploy before secrets -> 503 | Runbook order; `/api/auth/status` shows `configured`; the error text names the table |
| R5 | Lost `AUTH_PEPPER` | Password-manager backup; `scripts/reset-password.mjs` with a new pepper re-creates access |
| R6 | Account lockout as a nuisance DoS | 15-minute auto-expiry; per-IP limit hits the attacker first |
| R7 | `CF-Connecting-IP` missing locally -> all local attempts share the `unknown` bucket | Only affects dev/tests; verify does 1-2 attempts |
| R8 | `node:sqlite` test helper prints an ExperimentalWarning (Node 22) | Harmless; CI pins Node 22 which ships it |
| R9 | Flutter Linux build needs libsecret | build.yml apt step updated |
| R10 | Extra D1 read per request (session lookup) and one more read on the 304 path | Acceptable (2 point reads); could be fused later |

---

## 13. Out of scope (explicit)

Per-user data scoping / multi-tenancy; user management UI beyond the first user (extra users only via `scripts/reset-password.mjs --create`); roles/permissions; OAuth 2.1 authorization server for MCP (needed for claude.ai remote connectors); MFA/TOTP/WebAuthn; email-based password reset; Argon2/scrypt (WASM); pepper rotation with dual peppers; audit log; Turnstile/captcha; SSRF hardening of `gasWebhookUrl`; MCP SSE streaming; new MCP tools; sliding session renewal; session list/revoke-one UI.

---

## 14. Contract changes to mirror in `AGENTS.md`

- New "Auth" bullets under API contract: the §6.3 table in short form; middleware order summary; `Authorization: Bearer` for native/MCP; cookie `tt_session` for web; `transport` field.
- Replace the CORS bullet: `Authorization` instead of `X-App-Token`; credentials only for listed origins; CSRF Origin rule.
- `POST /mcp` bullet: requires Bearer (session or API token), `GET /mcp` = 405.
- Conditional reads bullet: "auth runs before the 304; `Cache-Control: private, no-cache`; `/api/auth/*` never ETagged".
- Worker layout: add `auth-crypto.js` (pure crypto), `auth.js` (auth D1 ops), `auth-routes.js` (`/api/auth/*` handlers), `http.js` (CORS/JSON helpers).
- Known gaps: Zero Trust items replaced by "owner: set `AUTH_PEPPER`/`SETUP_TOKEN`, apply `2026-11-12-auth.sql` to both D1s, custom API domain".
- Definition of done item 3: "auth enforced on every new route (public allowlist only in `index.js`), no secrets committed".
