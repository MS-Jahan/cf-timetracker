// Sanity tests for the in-memory D1 helper (worker/test/helpers/d1-sqlite.js).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestEnv, insertUser } from "./helpers/d1-sqlite.js";

describe("in-memory D1 helper", () => {
  it("creates the auth and timer tables from the real schema", async () => {
    const env = createTestEnv();
    const rows = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results;
    const names = rows.map((r) => r.name);
    for (const table of ["users", "sessions", "api_tokens", "auth_throttle", "time_entries"]) {
      assert.ok(names.includes(table), `missing table ${table}`);
    }
  });

  it("reads a single column from a row seeded by insertUser", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner" });
    const username = await env.DB.prepare("SELECT username FROM users LIMIT 1").first("username");
    assert.equal(username, "owner");
  });

  it("reports meta.changes as a number for UPDATE", async () => {
    const env = createTestEnv();
    await insertUser(env, { username: "owner" });
    const res = await env.DB.prepare("UPDATE users SET failed_attempts = 0 WHERE username = ?").bind("owner").run();
    assert.equal(typeof res.meta.changes, "number");
    assert.equal(res.meta.changes, 1);
  });

  it("supports INSERT ... RETURNING through first()", async () => {
    const env = createTestEnv();
    const row = await env.DB.prepare(
      "INSERT INTO auth_throttle (key, window_start, count) VALUES (?, ?, 1) RETURNING count, window_start"
    ).bind("login:test", 1000).first();
    assert.equal(row.count, 1);
    assert.equal(row.window_start, 1000);
  });
});
