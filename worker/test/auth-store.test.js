// Tests for the auth data layer (worker/src/auth.js) against the real schema in an in-memory D1.
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_COOKIE,
  authConfigured,
  authenticate,
  changePassword,
  createApiToken,
  listApiTokens,
  revokeApiToken,
  chargeThrottle,
  clearSessionCookie,
  clearThrottle,
  clientIp,
  createSession,
  normalizeUsername,
  parseCookies,
  purgeExpired,
  revokeOtherSessions,
  login,
  sessionCookie,
  setupFirstUser,
  validatePassword,
  validateUsername,
} from "../src/auth.js";
import { sha256Hex } from "../src/auth-crypto.js";
import { TEST_SETUP_TOKEN, createTestEnv, insertApiToken, insertUser, req } from "./helpers/d1-sqlite.js";

const HOUR = 3_600_000;

describe("authConfigured", () => {
  it("needs a pepper of at least 32 characters", () => {
    assert.equal(authConfigured({ AUTH_PEPPER: "p".repeat(32) }), true);
    assert.equal(authConfigured({ AUTH_PEPPER: "p".repeat(31) }), false);
    assert.equal(authConfigured({}), false);
  });
});

describe("username validation", () => {
  it("normalizes to trimmed lowercase", () => {
    assert.equal(normalizeUsername("  Sabit "), "sabit");
  });

  it("accepts a-z, 0-9, dot, dash, underscore and rejects the rest", () => {
    assert.notEqual(validateUsername("ab"), null);
    assert.equal(validateUsername("sabit.dev_1"), null);
    assert.notEqual(validateUsername("a b"), null);
  });
});

describe("password validation", () => {
  it("enforces 12..256 characters and differs from the username", () => {
    assert.notEqual(validatePassword("a".repeat(11), "owner"), null);
    assert.equal(validatePassword("a".repeat(12), "owner"), null);
    assert.notEqual(validatePassword("a".repeat(257), "owner"), null);
    assert.notEqual(validatePassword("OwnerName123", "ownername123"), null);
  });
});

describe("chargeThrottle", () => {
  it("allows up to the limit, blocks the next call, and resets after the window", async () => {
    const env = createTestEnv();
    const opts = { limit: 2, windowMs: 60000, now: 1000 };
    assert.equal((await chargeThrottle(env, "k", opts)).allowed, true);
    assert.equal((await chargeThrottle(env, "k", opts)).allowed, true);
    const third = await chargeThrottle(env, "k", opts);
    assert.equal(third.allowed, false);
    assert.ok(third.retryAfter >= 1 && third.retryAfter <= 60, `retryAfter ${third.retryAfter}`);
    assert.equal((await chargeThrottle(env, "k", { ...opts, now: 1000 + 60001 })).allowed, true);
  });

  it("clearThrottle makes the next call allowed again", async () => {
    const env = createTestEnv();
    const opts = { limit: 1, windowMs: 60000, now: 1000 };
    await chargeThrottle(env, "k", opts);
    assert.equal((await chargeThrottle(env, "k", opts)).allowed, false);
    await clearThrottle(env, "k");
    assert.equal((await chargeThrottle(env, "k", opts)).allowed, true);
  });
});

describe("sessions", () => {
  it("createSession stores only the SHA-256 of a tts_ token with a 720 h TTL", async () => {
    const env = createTestEnv();
    const userId = await insertUser(env);
    const session = await createSession(env, userId, { now: 1000 });
    assert.ok(session.token.startsWith("tts_"));
    assert.equal(session.maxAgeSec, 720 * 3600);
    const row = await env.DB.prepare("SELECT id, created_at, expires_at FROM sessions").first();
    assert.equal(row.id, await sha256Hex(session.token));
    assert.notEqual(row.id, session.token);
    assert.equal(row.expires_at - row.created_at, 720 * HOUR);
  });

  it("honours SESSION_TTL_HOURS", async () => {
    const env = createTestEnv({ SESSION_TTL_HOURS: "2" });
    const userId = await insertUser(env);
    const session = await createSession(env, userId, { now: 1000 });
    assert.equal(session.maxAgeSec, 2 * 3600);
    assert.equal(session.expiresAt - 1000, 2 * HOUR);
  });

  it("revokeOtherSessions keeps the given session and returns the count removed", async () => {
    const env = createTestEnv();
    const userId = await insertUser(env);
    const keep = await createSession(env, userId);
    await createSession(env, userId);
    await createSession(env, userId);
    const removed = await revokeOtherSessions(env, userId, await sha256Hex(keep.token));
    assert.equal(removed, 2);
    const left = await env.DB.prepare("SELECT id FROM sessions").all();
    assert.deepEqual(left.results.map((r) => r.id), [await sha256Hex(keep.token)]);
  });

  it("purgeExpired deletes expired sessions and keeps future ones", async () => {
    const env = createTestEnv();
    const userId = await insertUser(env);
    const past = await createSession(env, userId, { now: 1000 }); // expires at 1000 + 720 h
    const future = await createSession(env, userId); // expires 720 h from real now
    await purgeExpired(env, 1000 + 720 * HOUR + 1);
    const ids = (await env.DB.prepare("SELECT id FROM sessions").all()).results.map((r) => r.id);
    assert.equal(ids.includes(await sha256Hex(past.token)), false);
    assert.equal(ids.includes(await sha256Hex(future.token)), true);
  });
});

describe("cookies", () => {
  it("sessionCookie uses HttpOnly, Secure, SameSite=Lax, Path=/ by default", () => {
    const cookie = sessionCookie({}, "tts_x", 60);
    assert.ok(cookie.includes("tt_session=tts_x"));
    for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=60"]) {
      assert.ok(cookie.includes(part), `missing ${part}`);
    }
    assert.equal(cookie.includes("Partitioned"), false);
  });

  it("SESSION_COOKIE_SAMESITE=none adds SameSite=None and Partitioned", () => {
    const cookie = sessionCookie({ SESSION_COOKIE_SAMESITE: "none" }, "tts_x", 60);
    assert.ok(cookie.includes("SameSite=None"));
    assert.ok(cookie.includes("Partitioned"));
  });

  it("clearSessionCookie expires the cookie immediately", () => {
    const cookie = clearSessionCookie({});
    assert.ok(cookie.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(cookie.includes("Max-Age=0"));
  });

  it("parseCookies reads name=value pairs and ignores bare names", () => {
    assert.deepEqual(parseCookies("a=1; tt_session=tts_abc; b"), { a: "1", tt_session: "tts_abc" });
  });
});

describe("authenticate", () => {
  async function setup() {
    const env = createTestEnv();
    const userId = await insertUser(env, { username: "owner" });
    const session = await createSession(env, userId);
    const apiToken = await insertApiToken(env, userId, { scope: "mcp" });
    return { env, userId, session, apiToken };
  }

  it("accepts a session token as a Bearer header", async () => {
    const { env, session } = await setup();
    const auth = await authenticate(req("/api/x", { token: session.token }), env);
    assert.equal(auth.kind, "session");
    assert.equal(auth.via, "header");
    assert.equal(auth.scope, "full");
    assert.equal(auth.user.username, "owner");
  });

  it("accepts the same session token from the tt_session cookie", async () => {
    const { env, session } = await setup();
    const auth = await authenticate(req("/api/x", { cookie: `${SESSION_COOKIE}=${session.token}` }), env);
    assert.equal(auth.kind, "session");
    assert.equal(auth.via, "cookie");
  });

  it("ignores the cookie when allowCookie is false", async () => {
    const { env, session } = await setup();
    const auth = await authenticate(req("/mcp", { cookie: `${SESSION_COOKIE}=${session.token}` }), env, { allowCookie: false });
    assert.equal(auth, null);
  });

  it("rejects an expired session", async () => {
    const { env, session } = await setup();
    env.DB.raw.exec("UPDATE sessions SET expires_at = 1");
    assert.equal(await authenticate(req("/api/x", { token: session.token }), env), null);
  });

  it("accepts an mcp-scope API token from the header and bumps last_used_at at most hourly", async () => {
    const { env, apiToken } = await setup();
    const auth = await authenticate(req("/mcp", { token: apiToken }), env);
    assert.equal(auth.kind, "token");
    assert.equal(auth.scope, "mcp");
    const first = env.DB.raw.prepare("SELECT last_used_at FROM api_tokens").get().last_used_at;
    assert.equal(typeof first, "number");

    const recent = Date.now() - 10;
    env.DB.raw.prepare("UPDATE api_tokens SET last_used_at = ?").run(recent);
    await authenticate(req("/mcp", { token: apiToken }), env);
    assert.equal(env.DB.raw.prepare("SELECT last_used_at FROM api_tokens").get().last_used_at, recent);
  });

  it("never accepts an API token from the cookie", async () => {
    const { env, apiToken } = await setup();
    assert.equal(await authenticate(req("/api/x", { cookie: `${SESSION_COOKIE}=${apiToken}` }), env), null);
  });

  it("rejects revoked and expired API tokens", async () => {
    const { env, userId } = await setup();
    const revoked = await insertApiToken(env, userId, { revokedAt: Date.now() });
    const expired = await insertApiToken(env, userId, { expiresAt: 1 });
    assert.equal(await authenticate(req("/mcp", { token: revoked }), env), null);
    assert.equal(await authenticate(req("/mcp", { token: expired }), env), null);
  });

  it("rejects unknown schemes and prefixes, and never falls back to the cookie", async () => {
    const { env, session } = await setup();
    assert.equal(await authenticate(req("/api/x", { headers: { Authorization: "Basic abc" } }), env), null);
    assert.equal(await authenticate(req("/api/x", { token: "xyz_unknownprefix" }), env), null);
    const mixed = req("/api/x", { token: "xyz_unknownprefix", cookie: `${SESSION_COOKIE}=${session.token}` });
    assert.equal(await authenticate(mixed, env), null);
  });

  it("never exposes password or token hashes", async () => {
    const { env, session } = await setup();
    const auth = await authenticate(req("/api/x", { token: session.token }), env);
    const json = JSON.stringify(auth);
    assert.equal(json.includes("password_hash"), false);
    assert.equal(json.includes("token_hash"), false);
    assert.deepEqual(Object.keys(auth).sort(), ["expiresAt", "kind", "scope", "sessionId", "user", "via"]);
  });
});

const GOOD_PASSWORD = "correct-horse-battery";

describe("setupFirstUser", () => {
  const setup = (env, extra = {}) =>
    setupFirstUser(env, { setupToken: TEST_SETUP_TOKEN, username: "Owner", password: GOOD_PASSWORD, ip: "1.1.1.1", ...extra });

  it("is unavailable without AUTH_PEPPER", async () => {
    const env = createTestEnv({ AUTH_PEPPER: undefined });
    const res = await setup(env);
    assert.equal(res.status, "unavailable");
    assert.equal(res.code, "auth_not_configured");
  });

  it("is disabled without SETUP_TOKEN", async () => {
    const env = createTestEnv({ SETUP_TOKEN: undefined });
    const res = await setup(env);
    assert.equal(res.status, "forbidden");
    assert.equal(res.code, "setup_disabled");
  });

  it("rejects a wrong setup token", async () => {
    const env = createTestEnv();
    const res = await setup(env, { setupToken: "wrong-token-0123456789abcdefgh" });
    assert.equal(res.status, "forbidden");
    assert.equal(res.code, "invalid_setup_token");
  });

  it("rejects a weak password and an invalid username", async () => {
    const env = createTestEnv();
    const weak = await setup(env, { password: "short" });
    assert.equal(weak.status, "invalid");
    assert.equal(weak.code, "weak_password");
    const badName = await setup(env, { username: "a b" });
    assert.equal(badName.status, "invalid");
    assert.equal(badName.code, "invalid_username");
  });

  it("creates the first user with a lowercased name, a 1000-iteration hash and a session", async () => {
    const env = createTestEnv();
    const res = await setup(env);
    assert.equal(res.status, "ok");
    assert.equal(res.user.username, "owner");
    assert.ok(res.token.startsWith("tts_"));
    const rows = (await env.DB.prepare("SELECT password_hash FROM users").all()).results;
    assert.equal(rows.length, 1);
    assert.ok(rows[0].password_hash.startsWith("pbkdf2-sha256$1000$"));
  });

  it("refuses a second setup even with the right token", async () => {
    const env = createTestEnv();
    await setup(env);
    const again = await setup(env, { username: "second.user" });
    assert.equal(again.status, "conflict");
    assert.equal(again.code, "setup_complete");
  });

  it("rate-limits setup attempts per IP (5 allowed, the 6th is refused)", async () => {
    const env = createTestEnv();
    let last;
    for (let i = 0; i < 6; i++) last = await setup(env, { setupToken: "wrong-token-0123456789abcdefgh" });
    assert.equal(last.status, "rate_limited");
    assert.equal(last.code, "too_many_attempts");
  });
});

describe("login", () => {
  it("succeeds with the right password, resets failures, records last login and creates a session", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    const res = await login(env, { username: "Owner", password: GOOD_PASSWORD, ip: "2.2.2.2" });
    assert.equal(res.status, "ok");
    const row = await env.DB.prepare("SELECT failed_attempts, last_login_at FROM users").first();
    assert.equal(row.failed_attempts, 0);
    assert.notEqual(row.last_login_at, null);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")), 1);
  });

  it("answers wrong-password and unknown-user identically", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    const wrong = await login(env, { username: "owner", password: "not-the-password-1", ip: "3.3.3.3" });
    const unknown = await login(env, { username: "nobody-here", password: "not-the-password-1", ip: "3.3.3.4" });
    assert.equal(wrong.status, "unauthorized");
    assert.equal(wrong.code, "invalid_credentials");
    assert.equal(unknown.status, wrong.status);
    assert.equal(unknown.code, wrong.code);
    assert.equal(unknown.error, wrong.error);
  });

  it("locks the account after 5 consecutive failures, even for the correct password", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    for (let i = 1; i <= 5; i++) {
      await login(env, { username: "owner", password: "wrong-password-xx", ip: `10.0.0.${i}` });
    }
    const locked = await login(env, { username: "owner", password: GOOD_PASSWORD, ip: "10.0.0.6" });
    assert.equal(locked.status, "rate_limited");
    assert.ok(locked.retryAfter > 0);
  });

  it("applies the per-IP limit before any password check", async () => {
    const env = createTestEnv({ AUTH_IP_LIMIT: "3" });
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    for (let i = 0; i < 3; i++) await login(env, { username: "owner", password: "wrong-password-xx", ip: "5.5.5.5" });
    const fourth = await login(env, { username: "owner", password: "wrong-password-xx", ip: "5.5.5.5" });
    assert.equal(fourth.status, "rate_limited");
    const row = await env.DB.prepare("SELECT failed_attempts FROM users").first();
    assert.equal(row.failed_attempts, 3);
  });

  it("rehashes to the configured iteration count on successful login", async () => {
    const env = createTestEnv({ AUTH_PBKDF2_ITERATIONS: "2000" });
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD }); // stored with 1000
    assert.equal((await login(env, { username: "owner", password: GOOD_PASSWORD, ip: "6.6.6.6" })).status, "ok");
    const row = await env.DB.prepare("SELECT password_hash FROM users").first();
    assert.ok(row.password_hash.includes("$2000$"));
  });

  it("removes the login:<ip> throttle row after a successful login", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    await login(env, { username: "owner", password: "wrong-password-xx", ip: "4.4.4.4" });
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_throttle WHERE key = 'login:4.4.4.4'").first("n")), 1);
    await login(env, { username: "owner", password: GOOD_PASSWORD, ip: "4.4.4.4" });
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_throttle WHERE key = 'login:4.4.4.4'").first("n")), 0);
  });
});

describe("changePassword", () => {
  async function signedIn() {
    const env = createTestEnv();
    const userId = await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    const current = await createSession(env, userId);
    const other1 = await createSession(env, userId);
    const other2 = await createSession(env, userId);
    const auth = await authenticate(req("/api/auth/me", { token: current.token }), env);
    return { env, userId, auth, current, other1, other2 };
  }

  it("refuses API-token callers with session_required", async () => {
    const { env, userId } = await signedIn();
    const token = await insertApiToken(env, userId, { scope: "full" });
    const auth = await authenticate(req("/api/auth/password", { token }), env);
    const res = await changePassword(env, auth, { currentPassword: GOOD_PASSWORD, newPassword: "a-brand-new-password" });
    assert.equal(res.status, "forbidden");
    assert.equal(res.code, "session_required");
  });

  it("rejects a wrong current password and counts it as a failure", async () => {
    const { env, auth } = await signedIn();
    const res = await changePassword(env, auth, { currentPassword: "not-the-password-1", newPassword: "a-brand-new-password" });
    assert.equal(res.status, "unauthorized");
    assert.equal(res.code, "invalid_credentials");
    assert.equal(await env.DB.prepare("SELECT failed_attempts FROM users").first("failed_attempts"), 1);
  });

  it("rejects a too-short new password or one equal to the current password", async () => {
    const { env, auth } = await signedIn();
    const short = await changePassword(env, auth, { currentPassword: GOOD_PASSWORD, newPassword: "short" });
    assert.equal(short.code, "weak_password");
    const same = await changePassword(env, auth, { currentPassword: GOOD_PASSWORD, newPassword: GOOD_PASSWORD });
    assert.equal(same.status, "invalid");
    assert.equal(same.code, "weak_password");
  });

  it("switches the password, keeps the current session, and revokes the other sessions", async () => {
    const { env, auth, current, other1, other2 } = await signedIn();
    const res = await changePassword(env, auth, { currentPassword: GOOD_PASSWORD, newPassword: "a-brand-new-password" });
    assert.deepEqual(res, { status: "ok", revokedSessions: 2 });
    assert.equal((await login(env, { username: "owner", password: "a-brand-new-password", ip: "7.7.7.7" })).status, "ok");
    assert.equal((await login(env, { username: "owner", password: GOOD_PASSWORD, ip: "7.7.7.8" })).status, "unauthorized");
    const ids = (await env.DB.prepare("SELECT id FROM sessions").all()).results.map((r) => r.id);
    assert.ok(ids.includes(await sha256Hex(current.token)));
    assert.equal(ids.includes(await sha256Hex(other1.token)), false);
    assert.equal(ids.includes(await sha256Hex(other2.token)), false);
  });
});

describe("API tokens", () => {
  async function signedIn() {
    const env = createTestEnv();
    const userId = await insertUser(env, { username: "owner", password: GOOD_PASSWORD });
    const session = await createSession(env, userId);
    const auth = await authenticate(req("/api/auth/tokens", { token: session.token }), env);
    return { env, userId, auth };
  }

  it("creates an mcp-scope token by default and stores only its hash", async () => {
    const { env, auth } = await signedIn();
    const res = await createApiToken(env, auth, { name: "claude-code" });
    assert.equal(res.status, "ok");
    assert.equal(res.apiToken.scope, "mcp");
    assert.ok(res.token.startsWith("ttp_"));
    const row = await env.DB.prepare("SELECT token_hash, token_prefix FROM api_tokens").first();
    assert.notEqual(row.token_hash, res.token);
    assert.equal(row.token_hash, await sha256Hex(res.token));
    assert.equal(row.token_prefix, res.token.slice(0, 12));
  });

  it("validates scope, name length and expiry", async () => {
    const { env, auth } = await signedIn();
    assert.equal((await createApiToken(env, auth, { name: "x", scope: "full" })).status, "ok");
    assert.equal((await createApiToken(env, auth, { name: "x", scope: "admin" })).code, "invalid_request");
    assert.equal((await createApiToken(env, auth, { name: "   " })).code, "invalid_request");
    assert.equal((await createApiToken(env, auth, { name: "a".repeat(65) })).code, "invalid_request");
    assert.equal((await createApiToken(env, auth, { name: "x", expiresInDays: 0 })).code, "invalid_request");
    assert.equal((await createApiToken(env, auth, { name: "x", expiresInDays: 366 })).code, "invalid_request");
  });

  it("sets expiresAt about 30 days ahead when expiresInDays is 30", async () => {
    const { env, auth } = await signedIn();
    const res = await createApiToken(env, auth, { name: "x", expiresInDays: 30 });
    const expected = Date.now() + 30 * 86_400_000;
    assert.ok(Math.abs(res.apiToken.expiresAt - expected) < 60_000);
  });

  it("a created token authenticates with its scope", async () => {
    const { env, auth } = await signedIn();
    const { token } = await createApiToken(env, auth, { name: "x", scope: "full" });
    const bearer = await authenticate(req("/api/bootstrap", { token }), env);
    assert.equal(bearer.kind, "token");
    assert.equal(bearer.scope, "full");
  });

  it("lists DTOs with exactly the documented keys and hides revoked tokens", async () => {
    const { env, auth } = await signedIn();
    const keep = await createApiToken(env, auth, { name: "keep" });
    const drop = await createApiToken(env, auth, { name: "drop" });
    assert.equal((await revokeApiToken(env, auth, drop.apiToken.id)).status, "ok");
    const listed = await listApiTokens(env, auth);
    assert.equal(listed.tokens.length, 1);
    assert.equal(listed.tokens[0].id, keep.apiToken.id);
    assert.deepEqual(Object.keys(listed.tokens[0]).sort(), ["createdAt", "expiresAt", "id", "lastUsedAt", "name", "prefix", "scope"].sort());
  });

  it("revokes once; a second revoke, another user's id, or a revoked token all fail", async () => {
    const { env, auth } = await signedIn();
    const { token, apiToken } = await createApiToken(env, auth, { name: "x" });
    assert.equal((await revokeApiToken(env, auth, apiToken.id)).status, "ok");
    assert.equal((await revokeApiToken(env, auth, apiToken.id)).status, "not_found");
    assert.equal(await authenticate(req("/mcp", { token }), env), null);

    const otherId = await insertUser(env, { username: "someone" });
    const otherToken = await insertApiToken(env, otherId);
    const otherRow = env.DB.raw.prepare("SELECT id FROM api_tokens WHERE token_hash = ?").get(await sha256Hex(otherToken));
    assert.equal((await revokeApiToken(env, auth, otherRow.id)).status, "not_found");
  });

  it("refuses a 26th active token with too_many_tokens", async () => {
    const { env, auth } = await signedIn();
    for (let i = 0; i < 25; i++) assert.equal((await createApiToken(env, auth, { name: `t${i}` })).status, "ok");
    const res = await createApiToken(env, auth, { name: "one-too-many" });
    assert.equal(res.status, "conflict");
    assert.equal(res.code, "too_many_tokens");
  });

  it("refuses all token management from API-token callers with session_required", async () => {
    const { env, userId } = await signedIn();
    const raw = await insertApiToken(env, userId, { scope: "full" });
    const auth = await authenticate(req("/api/auth/tokens", { token: raw }), env);
    for (const res of [
      await createApiToken(env, auth, { name: "x" }),
      await listApiTokens(env, auth),
      await revokeApiToken(env, auth, "00000000-0000-4000-8000-000000000000"),
    ]) {
      assert.equal(res.status, "forbidden");
      assert.equal(res.code, "session_required");
    }
  });
});

describe("clientIp", () => {
  it("uses CF-Connecting-IP and falls back to 'unknown'", () => {
    assert.equal(clientIp(req("/x", { headers: { "CF-Connecting-IP": "1.2.3.4" } })), "1.2.3.4");
    assert.equal(clientIp(req("/x")), "unknown");
  });
});
