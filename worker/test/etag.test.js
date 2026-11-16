// Conditional reads keyed by the data revision (worker/src/index.js, phase 3; auth order per BP §6.2).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { createSession } from "../src/auth.js";
import { createTestEnv, insertUser, req } from "./helpers/d1-sqlite.js";

/** Fresh env with one user, a session token, and the given data revision (null = no counter row). */
async function setup(rev) {
  const env = createTestEnv();
  const userId = await insertUser(env);
  const { token } = await createSession(env, userId);
  if (rev !== null) env.DB.raw.exec(`INSERT INTO settings (key, value) VALUES ('data_rev', '${rev}')`);
  return { env, token };
}

const get = (path, { token, headers = {} } = {}) => req(path, { token, headers });

describe("ETag / 304 keyed by data_rev", () => {
  it("tags a 200 with the revision and answers 304 without running the queries", async () => {
    const { env, token } = await setup(7);
    const first = await worker.fetch(get("/api/entries/bounds", { token }), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("ETag"), '"rev-7"');
    assert.equal(first.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(first.headers.get("Vary"), "Origin, Authorization, Cookie");

    const queriesBefore = env.DB.queries.length;
    const second = await worker.fetch(get("/api/entries/bounds", { token, headers: { "If-None-Match": '"rev-7"' } }), env);
    assert.equal(second.status, 304);
    assert.equal(env.DB.queries.length - queriesBefore, 2, "only the session lookup and the revision row are read");
    assert.equal(second.headers.get("Cache-Control"), "private, no-cache");
    assert.equal(second.headers.get("Access-Control-Allow-Origin") !== null, true);
  });

  it("serves fresh data once the revision moved", async () => {
    const { env, token } = await setup(7);
    env.DB.raw.exec("UPDATE settings SET value = '8' WHERE key = 'data_rev'");
    const res = await worker.fetch(get("/api/entries/bounds", { token, headers: { "If-None-Match": '"rev-7"' } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), '"rev-8"');
  });

  it("does not tag anything when there is no revision (counter missing)", async () => {
    const { env, token } = await setup(null);
    const res = await worker.fetch(get("/api/entries/bounds", { token, headers: { "If-None-Match": '"rev-0"' } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), null);
  });

  it("never caches the freshness probe", async () => {
    const { env, token } = await setup(7);
    const res = await worker.fetch(get("/api/rev", { token, headers: { "If-None-Match": '"rev-7"' } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), null);
  });

  it("does not leak a 304 to an unauthenticated caller", async () => {
    const { env } = await setup(7);
    const res = await worker.fetch(get("/api/entries/bounds", { headers: { "If-None-Match": '"rev-7"' } }), env);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("ETag"), null);
  });
});
