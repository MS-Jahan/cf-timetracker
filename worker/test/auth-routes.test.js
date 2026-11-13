// Tests for /api/auth/* handlers (worker/src/auth-routes.js) against the real schema in an in-memory D1.
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleAuthRoute } from "../src/auth-routes.js";
import { authenticate } from "../src/auth.js";
import { TEST_SETUP_TOKEN, createTestEnv, insertApiToken, insertUser, req } from "./helpers/d1-sqlite.js";

const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "another-long-password-1";
const bodies = []; // every JSON body produced by these tests, scanned at the end

/** Calls the handler the way the middleware would: credentials resolved first unless `ctx` is given. */
async function call(env, path, { method = "GET", token, cookie, body, headers, ctx } = {}) {
  const request = req(path, { method, token, cookie, body, headers });
  const context = ctx === undefined ? await authenticate(request, env) : ctx;
  const res = await handleAuthRoute(request, env, context);
  const text = res === null ? null : await res.text();
  if (text) bodies.push(text);
  return { res, status: res?.status, text, json: text ? JSON.parse(text) : null };
}

async function setupSession(env) {
  const out = await call(env, "/api/auth/setup", {
    method: "POST",
    ctx: null,
    body: { setupToken: TEST_SETUP_TOKEN, username: "owner", password: PASSWORD, transport: "token" },
  });
  assert.equal(out.status, 201, out.text);
  return out.json.token;
}

describe("auth routes - dispatch", () => {
  it("returns null for paths outside /api/auth/", async () => {
    const env = createTestEnv();
    assert.equal(await handleAuthRoute(req("/api/bootstrap"), env, null), null);
    assert.equal(await handleAuthRoute(req("/mcp", { method: "POST" }), env, null), null);
  });

  it("answers unknown /api/auth/ routes with 404 not_found", async () => {
    const env = createTestEnv();
    const out = await call(env, "/api/auth/nope", { ctx: null });
    assert.equal(out.status, 404);
    assert.deepEqual(out.json, { error: "Route not found", code: "not_found" });
    assert.equal(out.res.headers.get("cache-control"), "no-store");
  });
});

describe("auth routes - status", () => {
  it("reports setup required before any user exists, then not after setup", async () => {
    const env = createTestEnv();
    const before = await call(env, "/api/auth/status", { ctx: null });
    assert.equal(before.status, 200);
    assert.deepEqual(before.json, { configured: true, setupRequired: true });
    assert.equal(before.res.headers.get("cache-control"), "no-store");

    await setupSession(env);
    const after = await call(env, "/api/auth/status", { ctx: null });
    assert.deepEqual(after.json, { configured: true, setupRequired: false });
  });

  it("reports unconfigured without a database read when the pepper is missing", async () => {
    const env = createTestEnv({ AUTH_PEPPER: undefined });
    const before = env.DB.queries.length;
    const out = await call(env, "/api/auth/status", { ctx: null });
    assert.deepEqual(out.json, { configured: false, setupRequired: false });
    assert.equal(env.DB.queries.length, before, "no SQL when auth is not configured");
  });
});

describe("auth routes - setup and login transport", () => {
  it("setup with the default (cookie) transport sets tt_session and omits the token", async () => {
    const env = createTestEnv();
    const out = await call(env, "/api/auth/setup", {
      method: "POST",
      ctx: null,
      body: { setupToken: TEST_SETUP_TOKEN, username: "owner", password: PASSWORD },
    });
    assert.equal(out.status, 201, out.text);
    assert.match(out.res.headers.get("set-cookie"), /^tt_session=tts_/);
    assert.equal(out.json.token, undefined);
    assert.equal(out.json.user.username, "owner");
    assert.equal(out.res.headers.get("cache-control"), "no-store");
  });

  it("setup with token transport returns the token and sets no cookie", async () => {
    const env = createTestEnv();
    const out = await call(env, "/api/auth/setup", {
      method: "POST",
      ctx: null,
      body: { setupToken: TEST_SETUP_TOKEN, username: "owner", password: PASSWORD, transport: "token" },
    });
    assert.equal(out.status, 201);
    assert.match(out.json.token, /^tts_/);
    assert.equal(out.res.headers.get("set-cookie"), null);
  });

  it("setup with a non-JSON body answers 400 invalid_request", async () => {
    const env = createTestEnv();
    const request = new Request("https://api.test/api/auth/setup", { method: "POST", body: "{not json" });
    const res = await handleAuthRoute(request, env, null);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "invalid_request");
  });

  it("login with a wrong password answers 401 invalid_credentials with no-store", async () => {
    const env = createTestEnv();
    await setupSession(env);
    const out = await call(env, "/api/auth/login", { method: "POST", ctx: null, body: { username: "owner", password: "wrong-password-here" } });
    assert.equal(out.status, 401);
    assert.equal(out.json.code, "invalid_credentials");
    assert.equal(out.res.headers.get("cache-control"), "no-store");
  });

  it("login with the right password answers 200 and a cookie", async () => {
    const env = createTestEnv();
    await setupSession(env);
    const out = await call(env, "/api/auth/login", { method: "POST", ctx: null, body: { username: "owner", password: PASSWORD } });
    assert.equal(out.status, 200, out.text);
    assert.match(out.res.headers.get("set-cookie"), /^tt_session=tts_/);
  });

  it("login after too many attempts answers 429 with a numeric Retry-After", async () => {
    const env = createTestEnv({ AUTH_IP_LIMIT: "2" });
    await setupSession(env);
    const headers = { "CF-Connecting-IP": "203.0.113.9" };
    const attempt = () => call(env, "/api/auth/login", { method: "POST", ctx: null, headers, body: { username: "owner", password: "wrong-password-here" } });
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, "too_many_attempts");
    assert.match(limited.res.headers.get("retry-after"), /^\d+$/);
  });
});

describe("auth routes - me, logout", () => {
  it("me with a resolved context answers 200 with the user and auth summary", async () => {
    const env = createTestEnv();
    const token = await setupSession(env);
    const out = await call(env, "/api/auth/me", { token });
    assert.equal(out.status, 200);
    assert.equal(out.json.user.username, "owner");
    assert.equal(out.json.auth.kind, "session");
    assert.equal(out.json.auth.scope, "full");
    assert.equal(typeof out.json.auth.expiresAt, "number");
  });

  it("me with no context answers 401 unauthenticated", async () => {
    const env = createTestEnv();
    await setupSession(env);
    const out = await call(env, "/api/auth/me", { ctx: null });
    assert.equal(out.status, 401);
    assert.equal(out.json.code, "unauthenticated");
    assert.match(out.res.headers.get("www-authenticate"), /^Bearer/);
  });

  it("logout with a Bearer session revokes it and clears the cookie", async () => {
    const env = createTestEnv();
    const token = await setupSession(env);
    const out = await call(env, "/api/auth/logout", { method: "POST", token, ctx: null });
    assert.equal(out.status, 200);
    assert.deepEqual(out.json, { success: true });
    assert.match(out.res.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal(await authenticate(req("/api/bootstrap", { token }), env), null, "the session no longer authenticates");
  });
});

describe("auth routes - API tokens and password", () => {
  it("creates, lists, and revokes an API token; a token context is refused", async () => {
    const env = createTestEnv();
    const token = await setupSession(env);

    const created = await call(env, "/api/auth/tokens", { method: "POST", token, body: { name: "laptop", scope: "mcp", expiresInDays: 30 } });
    assert.equal(created.status, 201, created.text);
    assert.match(created.json.token, /^ttp_/);
    assert.equal(created.json.apiToken.name, "laptop");
    assert.equal(created.json.apiToken.scope, "mcp");

    const listed = await call(env, "/api/auth/tokens", { token });
    assert.equal(listed.status, 200);
    assert.equal(listed.json.tokens.length, 1);
    assert.equal(listed.json.tokens[0].id, created.json.apiToken.id);

    const deleted = await call(env, `/api/auth/tokens/${created.json.apiToken.id}`, { method: "DELETE", token });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.json, { success: true });

    const again = await call(env, `/api/auth/tokens/${created.json.apiToken.id}`, { method: "DELETE", token });
    assert.equal(again.status, 404);
    assert.equal(again.json.code, "not_found");

    const apiUser = await insertUser(env, { username: "machine" });
    const mcpToken = await insertApiToken(env, apiUser, { scope: "full" });
    const refused = await call(env, "/api/auth/tokens", { method: "POST", token: mcpToken, body: { name: "x" } });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.code, "session_required");
  });

  it("DELETE with a malformed id answers 404 instead of throwing", async () => {
    const env = createTestEnv();
    const token = await setupSession(env);
    const out = await call(env, "/api/auth/tokens/%E0%A4%A", { method: "DELETE", token });
    assert.equal(out.status, 404);
  });

  it("GET tokens with no context answers 401", async () => {
    const env = createTestEnv();
    await setupSession(env);
    const out = await call(env, "/api/auth/tokens", { ctx: null });
    assert.equal(out.status, 401);
  });

  it("password: wrong current answers 401; correct one answers 200 with revokedSessions", async () => {
    const env = createTestEnv();
    const token = await setupSession(env);
    const wrong = await call(env, "/api/auth/password", { method: "POST", token, body: { currentPassword: "not-the-password", newPassword: NEW_PASSWORD } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, "invalid_credentials");

    const ok = await call(env, "/api/auth/password", { method: "POST", token, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.success, true);
    assert.equal(typeof ok.json.revokedSessions, "number");
    assert.equal(ok.json.revokedSessions, 0, "the only session is the current one and is kept");
  });

  it("password with a token context answers 403 session_required", async () => {
    const env = createTestEnv();
    await setupSession(env);
    const userId = env.DB.raw.prepare("SELECT id FROM users").get().id;
    const apiToken = await insertApiToken(env, userId, { scope: "full" });
    const out = await call(env, "/api/auth/password", { method: "POST", token: apiToken, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD } });
    assert.equal(out.status, 403);
    assert.equal(out.json.code, "session_required");
  });
});

describe("auth routes - response hygiene", () => {
  it("no produced JSON body contains password or token hashes", () => {
    assert.ok(bodies.length > 10, "the tests above produced bodies to scan");
    for (const text of bodies) {
      assert.doesNotMatch(text, /password_hash|token_hash|pbkdf2-sha256/);
    }
  });
});
