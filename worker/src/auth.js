// Auth data layer: config, validation, throttling, sessions, cookies, and credential checks.
// D1 operations only; HTTP mapping lives in auth-routes.js. See docs/2026-11-12-auth-and-mcp-blueprint.md §5.
import {
  API_TOKEN_PREFIX,
  SESSION_PREFIX,
  constantTimeEqual,
  dummyHash,
  generateToken,
  hashPassword,
  resolveIterations,
  sha256Hex,
  utf8,
  verifyPassword,
} from "./auth-crypto.js";

export const SESSION_COOKIE = "tt_session";
const WINDOW_MS = 15 * 60_000; // throttle window
const LOCK_MS = 15 * 60_000; // account lock length
const MAX_FAILED = 5; // consecutive failures before lock
const SETUP_IP_LIMIT = 5;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const TOKEN_LAST_USED_GRANULARITY_MS = 60 * 60_000; // write last_used_at at most hourly

// ---- 5.1 Config and validation ----

export const authConfigured = (env) => typeof env.AUTH_PEPPER === "string" && env.AUTH_PEPPER.length >= 32;
export const normalizeUsername = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export function validateUsername(name) {
  return USERNAME_RE.test(name) ? null : "username must be 3-64 chars: a-z, 0-9, dot, dash, underscore";
}
export function validatePassword(password, username) {
  if (typeof password !== "string" || password.length < 12) return "password must be at least 12 characters";
  if (password.length > 256) return "password must be at most 256 characters";
  if (password.toLowerCase() === username) return "password must not equal the username";
  return null;
}
const ipLimit = (env) => {
  const n = Number.parseInt(env.AUTH_IP_LIMIT ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 10;
};
export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";
const publicUser = (row) => ({ id: row.id ?? row.user_id, username: row.username });

// ---- 5.2 Throttle (atomic, race-free) ----

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

// ---- 5.3 Sessions and cookies ----

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

// ---- 5.4 authenticate ----

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

// ---- 5.5 First-user setup ----

export async function setupFirstUser(env, { setupToken, username, password, ip = "unknown", userAgent = "" } = {}) {
  if (!authConfigured(env)) return { status: "unavailable", code: "auth_not_configured", error: "Authentication is not configured on the server" };
  const existing = await env.DB.prepare("SELECT 1 AS found FROM users LIMIT 1").first();
  if (existing) return { status: "conflict", code: "setup_complete", error: "Setup is already complete" };
  if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 24) return { status: "forbidden", code: "setup_disabled", error: "First-account setup is disabled" };

  const throttle = await chargeThrottle(env, `setup:${ip}`, { limit: SETUP_IP_LIMIT });
  if (!throttle.allowed) return { status: "rate_limited", code: "too_many_attempts", retryAfter: throttle.retryAfter, error: "Too many attempts. Try again later." };

  const givenDigest = utf8(await sha256Hex(setupToken ?? ""));
  const expectedDigest = utf8(await sha256Hex(env.SETUP_TOKEN));
  if (!constantTimeEqual(givenDigest, expectedDigest)) return { status: "forbidden", code: "invalid_setup_token", error: "Invalid setup token" };

  const name = normalizeUsername(username);
  const nameError = validateUsername(name);
  if (nameError) return { status: "invalid", code: "invalid_username", error: nameError };
  const passwordError = validatePassword(password, name);
  if (passwordError) return { status: "invalid", code: "weak_password", error: passwordError };

  const now = Date.now();
  const id = crypto.randomUUID();
  const hash = await hashPassword(password, env.AUTH_PEPPER, { iterations: resolveIterations(env) });
  const res = await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, password_changed_at, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)"
  ).bind(id, name, hash, now, now).run();
  if (!(res.meta?.changes > 0)) return { status: "conflict", code: "setup_complete", error: "Setup is already complete" };

  await clearThrottle(env, `setup:${ip}`);
  const session = await createSession(env, id, { userAgent, now });
  return { status: "ok", user: { id, username: name }, ...session };
}

// ---- 5.6 Sign-in ----

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

// ---- 5.7 Change password (session only) ----

export async function changePassword(env, auth, { currentPassword, newPassword } = {}) {
  if (auth?.kind !== "session") return { status: "forbidden", code: "session_required", error: "This action requires a signed-in session" };
  const now = Date.now();
  const user = await env.DB.prepare("SELECT id, username, password_hash, locked_until FROM users WHERE id = ?").bind(auth.user.id).first();
  if (!user) return { status: "unauthorized", code: "invalid_credentials", error: "Invalid username or password" };
  if (user.locked_until && user.locked_until > now) {
    return { status: "rate_limited", code: "too_many_attempts", retryAfter: Math.ceil((user.locked_until - now) / 1000), error: "Too many sign-in attempts. Try again later." };
  }

  const { ok } = await verifyPassword(typeof currentPassword === "string" ? currentPassword : "", user.password_hash, env.AUTH_PEPPER, { iterations: resolveIterations(env) });
  if (!ok) {
    await env.DB.prepare(
      `UPDATE users SET failed_attempts = failed_attempts + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= ? THEN ? ELSE locked_until END
       WHERE id = ?`
    ).bind(MAX_FAILED, now + LOCK_MS, user.id).run();
    return { status: "unauthorized", code: "invalid_credentials", error: "Invalid username or password" };
  }

  const passwordError = validatePassword(newPassword, user.username);
  if (passwordError) return { status: "invalid", code: "weak_password", error: passwordError };
  if (newPassword === currentPassword) return { status: "invalid", code: "weak_password", error: "new password must differ from the current one" };

  const hash = await hashPassword(newPassword, env.AUTH_PEPPER, { iterations: resolveIterations(env) });
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?"
  ).bind(hash, now, user.id).run();
  const revokedSessions = await revokeOtherSessions(env, user.id, auth.sessionId);
  return { status: "ok", revokedSessions };
}

// ---- 5.8 API tokens (session only) ----

const API_TOKEN_MAX_ACTIVE = 25;
const toApiTokenDto = (r) => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  prefix: r.token_prefix,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at ?? null,
  expiresAt: r.expires_at ?? null,
});

export async function createApiToken(env, auth, { name, scope = "mcp", expiresInDays = null } = {}) {
  if (auth?.kind !== "session") return { status: "forbidden", code: "session_required", error: "This action requires a signed-in session" };
  const label = typeof name === "string" ? name.trim() : "";
  if (label.length < 1 || label.length > 64) return { status: "invalid", code: "invalid_request", error: "name must be 1-64 characters" };
  if (scope !== "mcp" && scope !== "full") return { status: "invalid", code: "invalid_request", error: "scope must be mcp or full" };
  if (expiresInDays !== null && expiresInDays !== undefined && !(Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= 365)) {
    return { status: "invalid", code: "invalid_request", error: "expiresInDays must be an integer from 1 to 365, or null" };
  }
  const now = Date.now();
  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
  ).bind(auth.user.id, now).first("n");
  if (active >= API_TOKEN_MAX_ACTIVE) return { status: "conflict", code: "too_many_tokens", error: `At most ${API_TOKEN_MAX_ACTIVE} active API tokens per account` };

  const token = generateToken(API_TOKEN_PREFIX);
  const row = {
    id: crypto.randomUUID(),
    name: label,
    scope,
    token_prefix: token.slice(0, 12),
    created_at: now,
    last_used_at: null,
    expires_at: expiresInDays ? now + expiresInDays * 86_400_000 : null,
  };
  await env.DB.prepare(
    "INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(row.id, auth.user.id, row.name, await sha256Hex(token), row.token_prefix, row.scope, row.created_at, row.expires_at).run();
  return { status: "ok", token, apiToken: toApiTokenDto(row) };
}

export async function listApiTokens(env, auth) {
  if (auth?.kind !== "session") return { status: "forbidden", code: "session_required", error: "This action requires a signed-in session" };
  const rows = await env.DB.prepare(
    `SELECT id, name, scope, token_prefix, created_at, last_used_at, expires_at FROM api_tokens
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`
  ).bind(auth.user.id).all();
  return { status: "ok", tokens: rows.results.map(toApiTokenDto) };
}

export async function revokeApiToken(env, auth, id) {
  if (auth?.kind !== "session") return { status: "forbidden", code: "session_required", error: "This action requires a signed-in session" };
  const res = await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(Date.now(), id, auth.user.id).run();
  if (!(res.meta?.changes > 0)) return { status: "not_found", code: "not_found", error: "API token not found" };
  return { status: "ok" };
}
