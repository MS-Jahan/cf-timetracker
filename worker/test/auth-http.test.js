// HTTP integration tests for the auth middleware (worker/src/index.js fetch), through worker.fetch.
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { TEST_ORIGIN, createTestEnv, insertApiToken, req } from "./helpers/d1-sqlite.js";

const PASSWORD = "correct-horse-battery";
const EVIL = "https://evil.test";

const fetchApi = (env, path, opts) => worker.fetch(req(path, opts), env);
const json = (res) => res.json();

/** Fresh env with the owner set up; returns the session token (transport: token). */
async function setupOwner(extra = {}) {
  const env = createTestEnv(extra);
  const res = await fetchApi(env, "/api/auth/setup", {
    method: "POST",
    body: { setupToken: "test-setup-token-0123456789abcdef", username: "owner", password: PASSWORD, transport: "token" },
  });
  assert.equal(res.status, 201, await res.clone().text());
  const { token } = await json(res);
  const userId = env.DB.raw.prepare("SELECT id FROM users").get().id;
  return { env, token, userId };
}

const cookieFrom = (res) => res.headers.get("set-cookie").split(";")[0]; // "tt_session=tts_..."

describe("auth middleware - anonymous and credential handling", () => {
  it("anonymous GET /api/bootstrap is 401 unauthenticated with WWW-Authenticate", async () => {
    const { env } = await setupOwner();
    const res = await fetchApi(env, "/api/bootstrap");
    assert.equal(res.status, 401);
    assert.equal((await json(res)).code, "unauthenticated");
    assert.match(res.headers.get("www-authenticate"), /^Bearer realm="cf-timetracker"$/);
  });

  it("Bearer GET /api/bootstrap is 200 with a customers array", async () => {
    const { env, token } = await setupOwner();
    const res = await fetchApi(env, "/api/bootstrap", { token });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await json(res)).customers));
  });

  it("the legacy X-App-Token and Cf-Access headers grant nothing", async () => {
    const { env } = await setupOwner();
    const headers = { "X-App-Token": "x", "Cf-Access-Authenticated-User-Email": "a@b.c" };
    assert.equal((await fetchApi(env, "/api/bootstrap", { headers })).status, 401);

    const withAppToken = await setupOwner({ APP_TOKEN: "x" });
    assert.equal((await fetchApi(withAppToken.env, "/api/bootstrap", { headers })).status, 401);
  });

  it("public routes answer anonymously", async () => {
    const { env } = await setupOwner();
    const demo = await fetchApi(env, "/api/demo/status");
    assert.equal(demo.status, 200);
    assert.deepEqual(await json(demo), { demoMode: false });

    const status = await fetchApi(env, "/api/auth/status");
    assert.equal(status.status, 200);
    assert.deepEqual(await json(status), { configured: true, setupRequired: false });
  });

  it("missing pepper: protected routes are 503 auth_not_configured, status reports configured false", async () => {
    const { env, token } = await setupOwner();
    env.AUTH_PEPPER = undefined; // simulate a deployment without the secret after setup
    const res = await fetchApi(env, "/api/bootstrap", { token });
    assert.equal(res.status, 503);
    assert.equal((await json(res)).code, "auth_not_configured");

    const status = await fetchApi(env, "/api/auth/status");
    assert.equal(status.status, 200);
    assert.equal((await json(status)).configured, false);
  });

  it("unknown /api paths: 401 anonymous, 404 authenticated", async () => {
    const { env, token } = await setupOwner();
    assert.equal((await fetchApi(env, "/api/nope")).status, 401);
    assert.equal((await fetchApi(env, "/api/nope", { token })).status, 404);
  });
});

describe("auth middleware - cookie sessions and CSRF", () => {
  it("cookie session: mutations need an allowed Origin; safe methods do not", async () => {
    const { env, token } = await setupOwner();
    const cookie = `tt_session=${token}`;

    const created = await fetchApi(env, "/api/customers", { method: "POST", cookie, origin: TEST_ORIGIN, body: { name: "Acme" } });
    assert.equal(created.status, 201, await created.clone().text());

    const noOrigin = await fetchApi(env, "/api/customers", { method: "POST", cookie, body: { name: "Beta" } });
    assert.equal(noOrigin.status, 403);
    assert.equal((await json(noOrigin)).code, "origin_not_allowed");

    const evil = await fetchApi(env, "/api/customers", { method: "POST", cookie, origin: EVIL, body: { name: "Gamma" } });
    assert.equal(evil.status, 403);
    assert.equal((await json(evil)).code, "origin_not_allowed");

    const read = await fetchApi(env, "/api/bootstrap", { cookie });
    assert.equal(read.status, 200, "GET is a safe method and needs no Origin");
  });

  it("Bearer mutations skip the CSRF check", async () => {
    const { env, token } = await setupOwner();
    const res = await fetchApi(env, "/api/customers", { method: "POST", token, body: { name: "Delta" } });
    assert.equal(res.status, 201);
  });

  it("an mcp-scope token is refused on REST (403); a full-scope token is accepted", async () => {
    const { env, userId } = await setupOwner();
    const mcp = await insertApiToken(env, userId, { scope: "mcp" });
    const denied = await fetchApi(env, "/api/bootstrap", { token: mcp });
    assert.equal(denied.status, 403);
    assert.equal((await json(denied)).code, "insufficient_scope");

    const full = await insertApiToken(env, userId, { scope: "full" });
    assert.equal((await fetchApi(env, "/api/bootstrap", { token: full })).status, 200);
  });

  it("logout clears the session: the same cookie is then 401", async () => {
    const { env, token } = await setupOwner();
    const login = await fetchApi(env, "/api/auth/login", { method: "POST", body: { username: "owner", password: PASSWORD } });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);
    assert.equal((await fetchApi(env, "/api/bootstrap", { cookie })).status, 200);

    const out = await fetchApi(env, "/api/auth/logout", { method: "POST", cookie });
    assert.equal(out.status, 200);
    assert.equal((await fetchApi(env, "/api/bootstrap", { cookie })).status, 401);
    assert.equal((await fetchApi(env, "/api/bootstrap", { token })).status, 200, "other sessions are untouched");
  });
});

describe("auth middleware - CORS", () => {
  it("preflight from a listed origin carries credentials and allows Authorization", async () => {
    const { env } = await setupOwner();
    const res = await fetchApi(env, "/api/bootstrap", { method: "OPTIONS", origin: TEST_ORIGIN });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), TEST_ORIGIN);
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
    assert.doesNotMatch(res.headers.get("access-control-allow-headers"), /X-App-Token|Cf-Access/);
  });

  it("with ALLOWED_ORIGINS=* there are no credentials", async () => {
    const { env } = await setupOwner({ ALLOWED_ORIGINS: "*" });
    const res = await fetchApi(env, "/api/bootstrap", { method: "OPTIONS", origin: "https://app.test" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  });
});

describe("auth middleware - data revision and cache headers", () => {
  it("login and token creation leave data_rev alone; a customer write bumps it once", async () => {
    const { env, token } = await setupOwner();
    const rev = async () => (await json(await fetchApi(env, "/api/rev", { token }))).rev;
    const before = await rev();

    const login = await fetchApi(env, "/api/auth/login", { method: "POST", body: { username: "owner", password: PASSWORD } });
    assert.equal(login.status, 200);
    const tokens = await fetchApi(env, "/api/auth/tokens", { method: "POST", token, body: { name: "ci" } });
    assert.equal(tokens.status, 201);
    assert.equal(await rev(), before, "auth calls do not bump the revision");

    const created = await fetchApi(env, "/api/customers", { method: "POST", token, body: { name: "Epsilon" } });
    assert.equal(created.status, 201);
    assert.equal(await rev(), before + 1);
  });

  it("GET /api/auth/me is never tagged and is no-store", async () => {
    const { env, token } = await setupOwner();
    const res = await fetchApi(env, "/api/auth/me", { token, headers: { "If-None-Match": '"rev-0"' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), null);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });
});

describe("auth middleware - timer flow with auth", () => {
  it("start, second start (409), stop, second stop (404) all work with a Bearer token", async () => {
    const { env, token } = await setupOwner();
    const post = (path, body) => fetchApi(env, path, { method: "POST", token, body });

    const customer = await (await post("/api/customers", { name: "Timer Client" })).json();
    const project = await (await post("/api/projects", { customerId: customer.customer.id, name: "Timer Project", defaultTasks: [] })).json();
    const activity = await (await post("/api/activities", { name: "Timer Work" })).json();
    const ids = { customerId: customer.customer.id, projectId: project.project.id, activityId: activity.activity.id };

    const started = await post("/api/timer/start", ids);
    assert.equal(started.status, 200, await started.clone().text());

    const again = await post("/api/timer/start", ids);
    assert.equal(again.status, 409);
    assert.equal((await json(again)).code, "timer_running");

    const stopped = await post("/api/timer/stop");
    assert.equal(stopped.status, 200);

    const stoppedAgain = await post("/api/timer/stop");
    assert.equal(stoppedAgain.status, 404);
    assert.equal((await json(stoppedAgain)).code, "no_active_timer");
  });
});
