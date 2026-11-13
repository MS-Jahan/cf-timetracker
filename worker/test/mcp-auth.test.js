// MCP endpoint auth and transport tests, through worker.fetch (worker/src/index.js + mcp.js).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { TOOLS } from "../src/mcp.js";
import { TEST_ORIGIN, createTestEnv, insertApiToken, req } from "./helpers/d1-sqlite.js";

const PASSWORD = "correct-horse-battery";
const TOOL_NAMES = ["get_active_timer", "start_timer", "stop_timer", "query_summary"];

/** Fresh env with the owner set up; returns the session token and user id. */
async function setupOwner(extra = {}) {
  const env = createTestEnv(extra);
  const res = await worker.fetch(
    req("/api/auth/setup", {
      method: "POST",
      body: { setupToken: "test-setup-token-0123456789abcdef", username: "owner", password: PASSWORD, transport: "token" },
    }),
    env
  );
  assert.equal(res.status, 201);
  const { token } = await res.json();
  const userId = env.DB.raw.prepare("SELECT id FROM users").get().id;
  return { env, token, userId };
}

/** POST one JSON-RPC message to /mcp. */
const rpc = (env, message, opts = {}) => worker.fetch(req("/mcp", { method: "POST", body: message, ...opts }), env);

const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };

describe("MCP auth - credentials", () => {
  it("no credential is 401 with WWW-Authenticate", async () => {
    const { env } = await setupOwner();
    const res = await rpc(env, { jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "unauthenticated");
    assert.match(res.headers.get("www-authenticate"), /^Bearer realm="cf-timetracker"$/);
  });

  it("a session cookie alone is 401 (MCP takes Bearer only)", async () => {
    const { env, token } = await setupOwner();
    const res = await rpc(env, LIST, { cookie: `tt_session=${token}`, origin: TEST_ORIGIN });
    assert.equal(res.status, 401);
  });

  it("an mcp-scope API token: initialize and tools/list succeed; tools are exactly the four with the same schemas", async () => {
    const { env, userId } = await setupOwner();
    const token = await insertApiToken(env, userId, { scope: "mcp" });

    const init = await rpc(env, INIT, { token });
    assert.equal(init.status, 200);
    const initBody = await init.json();
    assert.equal(initBody.result.protocolVersion, "2025-06-18");

    const list = await rpc(env, LIST, { token });
    assert.equal(list.status, 200);
    const { tools } = (await list.json()).result;
    assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
    for (const tool of tools) {
      const expected = TOOLS.find((t) => t.name === tool.name);
      assert.deepEqual(tool.inputSchema, expected.inputSchema, `${tool.name} inputSchema`);
    }
  });

  it("a session Bearer token also works for tools/list", async () => {
    const { env, token } = await setupOwner();
    const res = await rpc(env, LIST, { token });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result.tools.length, 4);
  });

  it("revoked and expired API tokens are 401", async () => {
    const { env, userId } = await setupOwner();
    const revoked = await insertApiToken(env, userId, { scope: "mcp", revokedAt: Date.now() });
    assert.equal((await rpc(env, LIST, { token: revoked })).status, 401);

    const expired = await insertApiToken(env, userId, { scope: "mcp", expiresAt: Date.now() - 1000 });
    assert.equal((await rpc(env, LIST, { token: expired })).status, 401);
  });
});

describe("MCP transport", () => {
  it("GET /mcp is 405 with Allow: POST", async () => {
    const { env } = await setupOwner();
    const res = await worker.fetch(req("/mcp"), env);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  });

  it("OPTIONS /mcp is a 204 preflight without credentials", async () => {
    const { env } = await setupOwner();
    const res = await worker.fetch(req("/mcp", { method: "OPTIONS", origin: TEST_ORIGIN }), env);
    assert.equal(res.status, 204);
  });

  it("a browser Origin is checked: evil is 403, the listed origin is 200", async () => {
    const { env, userId } = await setupOwner();
    const token = await insertApiToken(env, userId, { scope: "mcp" });

    const evil = await rpc(env, LIST, { token, origin: "https://evil.test" });
    assert.equal(evil.status, 403);
    assert.equal((await evil.json()).code, "origin_not_allowed");

    const listed = await rpc(env, LIST, { token, origin: TEST_ORIGIN });
    assert.equal(listed.status, 200);
  });

  it("with ALLOWED_ORIGINS=* any Origin is accepted", async () => {
    const { env, userId } = await setupOwner({ ALLOWED_ORIGINS: "*" });
    const token = await insertApiToken(env, userId, { scope: "mcp" });
    const res = await rpc(env, LIST, { token, origin: "https://evil.test" });
    assert.equal(res.status, 200);
  });

  it("tools/call get_active_timer returns the idle status as text content", async () => {
    const { env, token } = await setupOwner();
    const res = await rpc(env, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_active_timer", arguments: {} } }, { token });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].type, "text");
    assert.deepEqual(JSON.parse(result.content[0].text), { status: "idle" });
  });

  it("a notification (no id) with a valid token is 202", async () => {
    const { env, token } = await setupOwner();
    const res = await rpc(env, { jsonrpc: "2.0", method: "notifications/initialized" }, { token });
    assert.equal(res.status, 202);
  });
});
