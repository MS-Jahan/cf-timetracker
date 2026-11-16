// Open demo deployment: DEMO_MODE="true" means no accounts, no MCP, no Sheets forwarding,
// full CRUD, and a scheduled wipe + re-seed. Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { DEMO_ROW_CAPS } from "../src/demo-limits.js";
import { createTestEnv, req } from "./helpers/d1-sqlite.js";

const demoEnv = () => createTestEnv({ DEMO_MODE: "true", AUTH_PEPPER: undefined, SETUP_TOKEN: undefined });
const call = (env, path, opts) => worker.fetch(req(path, opts), env);
const runScheduled = async (env) => {
  const pending = [];
  await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
};
const customerNames = (env) => env.DB.raw.prepare("SELECT name FROM customers ORDER BY name").all().map((r) => r.name);

describe("demo mode - open access", () => {
  it("serves protected reads without a credential, even with no AUTH_PEPPER", async () => {
    const env = demoEnv();
    const res = await call(env, "/api/bootstrap");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).customers));
  });

  it("allows add, edit and delete without a credential", async () => {
    const env = demoEnv();
    const created = await call(env, "/api/customers", { method: "POST", body: { name: "Visitor Co" } });
    assert.equal(created.status, 201);
    const { customer } = await created.json();
    const patched = await call(env, `/api/customers/${customer.id}`, { method: "PATCH", body: { name: "Renamed Co" } });
    assert.equal(patched.status, 200);
    assert.deepEqual(customerNames(env), ["Renamed Co"]);
  });

  it("reports demo:true and no setup on /api/auth/status", async () => {
    const res = await call(demoEnv(), "/api/auth/status");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { configured: true, setupRequired: false, demo: true });
  });

  it("disables every other /api/auth/* route with code demo_mode", async () => {
    const env = demoEnv();
    for (const [method, path] of [["POST", "/api/auth/login"], ["POST", "/api/auth/setup"], ["GET", "/api/auth/me"], ["GET", "/api/auth/tokens"], ["POST", "/api/auth/tokens"]]) {
      const res = await call(env, path, { method, body: method === "POST" ? {} : undefined });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal((await res.json()).code, "demo_mode");
    }
  });

  it("disables MCP and Google Sheets forwarding", async () => {
    const env = demoEnv();
    const mcp = await call(env, "/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    assert.equal(mcp.status, 404);
    assert.equal((await mcp.json()).code, "demo_mode");
    const sync = await call(env, "/api/sync/google-sheets", { method: "POST", body: { gasWebhookUrl: "https://example.test/x" } });
    assert.equal(sync.status, 403);
    assert.equal((await sync.json()).code, "demo_mode");
  });

  it("voice capture answers 503 'not configured' without a Gemini key", async () => {
    const res = await call(demoEnv(), "/api/voice/parse", { method: "POST", body: { audioBase64: "A".repeat(200), mimeType: "audio/webm" } });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not configured/i);
  });
});

describe("demo mode - never opens a non-demo deployment", () => {
  for (const value of ["false", "TRUE", "1", "yes", "", undefined]) {
    it(`DEMO_MODE=${JSON.stringify(value)} still requires a credential`, async () => {
      const env = createTestEnv({ DEMO_MODE: value });
      const res = await call(env, "/api/bootstrap");
      assert.equal(res.status, 401);
    });
  }

  it("non-demo /api/auth/status is unchanged (no demo flag)", async () => {
    const res = await call(createTestEnv(), "/api/auth/status");
    assert.equal((await res.json()).demo, undefined);
  });
});

describe("demo mode - scheduled reset", () => {
  it("wipes visitor data and restores the exact sample dataset", async () => {
    const env = demoEnv();
    await runScheduled(env);
    assert.deepEqual(customerNames(env), ["Acme Corp", "Beta LLC"]);

    // A visitor renames a seed client, adds another, and deletes an entry.
    await call(env, "/api/customers", { method: "POST", body: { name: "Visitor Co" } });
    env.DB.raw.prepare("UPDATE customers SET name = 'Hacked' WHERE name = 'Acme Corp'").run();
    env.DB.raw.prepare("DELETE FROM time_entries WHERE id LIKE 'e1%'").run();

    await runScheduled(env);
    assert.deepEqual(customerNames(env), ["Acme Corp", "Beta LLC"]);
    const counts = env.DB.raw.prepare(
      "SELECT (SELECT COUNT(*) FROM projects) p, (SELECT COUNT(*) FROM activities) a, (SELECT COUNT(*) FROM time_entries) e"
    ).get();
    assert.deepEqual({ ...counts }, { p: 3, a: 4, e: 5 });
  });

  it("bumps the data revision so cached clients refetch", async () => {
    const env = demoEnv();
    const rev = () => Number(env.DB.raw.prepare("SELECT value FROM settings WHERE key = 'data_rev'").get()?.value ?? 0);
    const before = rev();
    await runScheduled(env);
    assert.ok(rev() > before);
  });

  it("is a no-op when DEMO_MODE is not 'true'", async () => {
    const env = createTestEnv({ DEMO_MODE: "false" });
    env.DB.raw.prepare("INSERT INTO customers (id, name) VALUES ('x', 'Keep Me')").run();
    await runScheduled(env);
    assert.deepEqual(customerNames(env), ["Keep Me"]);
  });
});

describe("demo mode - abuse limits", () => {
  const post = (env, path, body, ip = "203.0.113.7") =>
    call(env, path, { method: "POST", body, headers: { "CF-Connecting-IP": ip } });
  const newCustomer = (env, ip) => post(env, "/api/customers", { name: `C ${Math.random()}` }, ip);

  it("rate-limits mutating requests per IP with 429 + Retry-After, never reads", async () => {
    const env = createTestEnv({ DEMO_MODE: "true", DEMO_WRITE_LIMIT: "3" });
    for (let i = 0; i < 3; i++) assert.equal((await newCustomer(env)).status, 201);
    const blocked = await newCustomer(env);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, "demo_rate_limited");
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(env, "/api/bootstrap", { headers: { "CF-Connecting-IP": "203.0.113.7" } })).status, 200);
    }
  });

  it("counts each IP separately", async () => {
    const env = createTestEnv({ DEMO_MODE: "true", DEMO_WRITE_LIMIT: "1" });
    assert.equal((await newCustomer(env, "198.51.100.1")).status, 201);
    assert.equal((await newCustomer(env, "198.51.100.1")).status, 429);
    assert.equal((await newCustomer(env, "198.51.100.2")).status, 201);
  });

  it("limits the public reset endpoint much harder", async () => {
    const env = createTestEnv({ DEMO_MODE: "true", DEMO_RESET_LIMIT: "1" });
    assert.equal((await post(env, "/api/demo/reset")).status, 200);
    const second = await post(env, "/api/demo/reset");
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, "demo_rate_limited");
  });

  it("refuses new rows once a table is at its cap, but still allows edits and deletes", async () => {
    const env = createTestEnv({ DEMO_MODE: "true", DEMO_WRITE_LIMIT: "1000" });
    const insert = env.DB.raw.prepare("INSERT INTO customers (id, name) VALUES (?, ?)");
    for (let i = 0; i < DEMO_ROW_CAPS.customers; i++) insert.run(`cap-${i}`, `Cap ${i}`);
    const full = await newCustomer(env);
    assert.equal(full.status, 409);
    assert.equal((await full.json()).code, "demo_limit_reached");
    const edit = await call(env, "/api/customers/cap-0", { method: "PATCH", body: { name: "Edited" } });
    assert.equal(edit.status, 200);
  });

  it("caps time entries on timer start but never blocks stopping a running timer", async () => {
    const env = createTestEnv({ DEMO_MODE: "true", DEMO_WRITE_LIMIT: "1000" });
    await runScheduled(env); // seed
    const start = await call(env, "/api/timer/start", {
      method: "POST",
      body: { customerId: "c1111111-1111-4111-8111-111111111111", projectId: "p1111111-1111-4111-8111-111111111111", activityId: "a1111111-1111-4111-8111-111111111111" },
    });
    assert.equal(start.status, 200, await start.clone().text());
    const insert = env.DB.raw.prepare(
      "INSERT INTO time_entries (id, customer_id, project_id, activity_id, start_time, end_time, duration_seconds, rate_applied, cost, is_running) VALUES (?, 'c1111111-1111-4111-8111-111111111111', 'p1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 1, 2, 1, 0, 0, 0)"
    );
    for (let i = 0; i < DEMO_ROW_CAPS.time_entries; i++) insert.run(`fill-${i}`);
    const stop = await call(env, "/api/timer/stop", { method: "POST" });
    assert.equal(stop.status, 200, await stop.clone().text());
    const again = await call(env, "/api/timer/start", {
      method: "POST",
      body: { customerId: "c1111111-1111-4111-8111-111111111111", projectId: "p1111111-1111-4111-8111-111111111111", activityId: "a1111111-1111-4111-8111-111111111111" },
    });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, "demo_limit_reached");
  });

  it("disables bulk CSV import", async () => {
    const res = await call(createTestEnv({ DEMO_MODE: "true" }), "/api/import/csv", { method: "POST", body: { rows: [] } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "demo_mode");
  });

  it("does not throttle a non-demo deployment (auth applies instead)", async () => {
    const env = createTestEnv({ DEMO_MODE: "false", DEMO_WRITE_LIMIT: "1" });
    for (let i = 0; i < 3; i++) assert.equal((await newCustomer(env)).status, 401);
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) c FROM auth_throttle WHERE key LIKE 'demo-%'").get().c, 0);
  });
});
