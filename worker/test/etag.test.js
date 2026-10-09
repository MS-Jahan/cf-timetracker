// Conditional reads keyed by the data revision (worker/src/index.js, phase 3).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";

function envWithRev(rev, extra = {}) {
  const queries = [];
  return {
    queries,
    ALLOWED_ORIGINS: "*",
    ...extra,
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            queries.push(sql);
            if (/key = 'data_rev'/.test(sql)) return rev === null ? null : { value: String(rev) };
            if (/MIN\(start_time\)/.test(sql)) return { min_start: 1, max_start: 2 };
            return null;
          },
          async run() { queries.push(sql); return { success: true }; },
          async all() { queries.push(sql); return { results: [] }; },
        };
      },
    },
  };
}

const get = (path, headers = {}) => new Request(`https://api.test${path}`, { headers });

describe("ETag / 304 keyed by data_rev", () => {
  it("tags a 200 with the revision and answers 304 without running the queries", async () => {
    const env = envWithRev(7);
    const first = await worker.fetch(get("/api/entries/bounds"), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("ETag"), '"rev-7"');
    assert.equal(first.headers.get("Cache-Control"), "no-cache");

    const queriesBefore = env.queries.length;
    const second = await worker.fetch(get("/api/entries/bounds", { "If-None-Match": '"rev-7"' }), env);
    assert.equal(second.status, 304);
    assert.equal(env.queries.length - queriesBefore, 1, "only the revision row is read");
    assert.equal(second.headers.get("Access-Control-Allow-Origin") !== null, true);
  });

  it("serves fresh data once the revision moved", async () => {
    const env = envWithRev(8);
    const res = await worker.fetch(get("/api/entries/bounds", { "If-None-Match": '"rev-7"' }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), '"rev-8"');
  });

  it("does not tag anything when there is no revision (counter missing)", async () => {
    const res = await worker.fetch(get("/api/entries/bounds", { "If-None-Match": '"rev-0"' }), envWithRev(null));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), null);
  });

  it("never caches the freshness probe", async () => {
    const res = await worker.fetch(get("/api/rev", { "If-None-Match": '"rev-7"' }), envWithRev(7));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("ETag"), null);
  });

  it("does not leak a 304 to an unauthorized caller", async () => {
    const env = envWithRev(7, { APP_TOKEN: "secret" });
    const res = await worker.fetch(get("/api/entries/bounds", { "If-None-Match": '"rev-7"' }), env);
    assert.equal(res.status, 401);
  });
});
