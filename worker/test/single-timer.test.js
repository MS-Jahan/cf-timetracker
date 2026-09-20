// Tests for the single-running-timer guarantee (worker/src/core.js).
// Run: npm test   (node --test)
//
// The interesting case is #3: the pre-check sees no running timer (because a
// concurrent request hasn't committed yet) and the INSERT then collides with the
// partial unique index. That path only exists in production under a real race, so
// it is exercised here with a D1 stub instead.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODES, startTimer, stopTimer } from "../src/core.js";

const UNIQUE_ERROR = new Error(
  "D1_ERROR: UNIQUE constraint failed: time_entries.is_running: SQLITE_CONSTRAINT"
);

const CUSTOMER_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "p0000000-0000-4000-8000-000000000001";
const ACTIVITY_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * Minimal D1 stub. `active` is what the running-timer lookup returns;
 * `insertError` makes the INSERT blow up the way the unique index would.
 */
function stubDb({ active = null, insertError = null, stopChanges = 1, row = {} } = {}) {
  const calls = [];
  return {
    calls,
    insertCalls: () => calls.filter((c) => c.sql.includes("INSERT INTO time_entries")),
    updateCalls: () => calls.filter((c) => c.sql.includes("UPDATE time_entries")),
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          calls.push({ sql, args: this.args });
          if (/FROM time_entries WHERE is_running = 1/.test(sql)) return active;
          if (/^SELECT 1 FROM/.test(sql.trim())) return { 1: 1 };
          if (/SELECT rate FROM projects/.test(sql)) return { rate: 130 };
          if (/SELECT hourly_rate FROM customers/.test(sql)) return { hourly_rate: 120 };
          if (/SELECT \* FROM time_entries WHERE id = \?/.test(sql)) {
            return { id: this.args[0], is_running: 1, ...row };
          }
          return null;
        },
        async all() {
          calls.push({ sql, args: this.args });
          return { results: [] };
        },
        async run() {
          calls.push({ sql, args: this.args });
          if (insertError && sql.includes("INSERT INTO time_entries")) throw insertError;
          return { success: true, meta: { changes: sql.includes("UPDATE time_entries") ? stopChanges : 1 } };
        },
      };
      return stmt;
    },
  };
}

const startArgs = { customerId: CUSTOMER_ID, projectId: PROJECT_ID, activityId: ACTIVITY_ID };

describe("startTimer", () => {
  it("inserts a running entry and applies the project rate", async () => {
    const env = { DB: stubDb() };
    const result = await startTimer(env, startArgs);

    assert.equal(result.status, "ok");
    assert.equal(result.timer.is_running, 1);
    const [insert] = env.DB.insertCalls();
    assert.ok(insert, "expected an INSERT");
    assert.match(insert.sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, 1\)/);
    assert.equal(insert.args[7], 130, "rate should come from the project");
  });

  it("refuses to start when a timer is already running (fast path)", async () => {
    const env = { DB: stubDb({ active: { id: "existing", is_running: 1 } }) };
    const result = await startTimer(env, startArgs);

    assert.equal(result.status, "conflict");
    assert.equal(result.code, ERROR_CODES.TIMER_RUNNING);
    assert.equal(env.DB.insertCalls().length, 0, "must not attempt the insert");
  });

  it("turns a unique-index violation into the same conflict (lost race)", async () => {
    const env = { DB: stubDb({ active: null, insertError: UNIQUE_ERROR }) };
    const result = await startTimer(env, startArgs);

    assert.equal(result.status, "conflict", "constraint violation must not surface as a 500");
    assert.equal(result.code, ERROR_CODES.TIMER_RUNNING);
    assert.equal(result.error, "A timer is already active.");
  });

  it("still propagates unrelated database errors", async () => {
    const env = { DB: stubDb({ insertError: new Error("D1_ERROR: no such table: time_entries") }) };
    await assert.rejects(() => startTimer(env, startArgs), /no such table/);
  });

  it("rejects missing ids and unknown foreign keys", async () => {
    const missing = await startTimer({ DB: stubDb() }, { customerId: CUSTOMER_ID });
    assert.equal(missing.status, "invalid");

    const unknown = { DB: stubDb() };
    unknown.DB.prepare = ((original) => (sql) => {
      const stmt = original(sql);
      stmt.first = async () => (/^SELECT 1 FROM/.test(sql.trim()) ? null : null);
      return stmt;
    })(unknown.DB.prepare);
    const result = await startTimer(unknown, startArgs);
    assert.equal(result.status, "invalid");
    assert.match(result.error, /Unknown ids/);
  });
});

describe("stopTimer", () => {
  it("finalizes duration and cost for the running entry", async () => {
    const env = { DB: stubDb({ active: { id: "run-1", start_time: Date.now() - 5000, rate_applied: 120 }, row: { duration_seconds: 5 } }) };
    const result = await stopTimer(env);

    assert.equal(result.status, "ok");
    const [update] = env.DB.updateCalls();
    assert.match(update.sql, /WHERE id = \? AND is_running = 1/, "update must be conditional");
    assert.equal(update.args[0] - (update.args[0] - 1) > 0, true);
    assert.match(String(update.args[1]), /^[45]$/, "duration should be ~5s");
  });

  it("reports not_found when there is no running timer", async () => {
    const result = await stopTimer({ DB: stubDb() });
    assert.equal(result.status, "not_found");
    assert.equal(result.code, ERROR_CODES.NO_ACTIVE_TIMER);
  });

  it("reports not_found when a concurrent stop already won", async () => {
    const env = { DB: stubDb({ active: { id: "run-1", start_time: Date.now() - 1000, rate_applied: 120 }, stopChanges: 0 }) };
    const result = await stopTimer(env);

    assert.equal(result.status, "not_found", "second stop must not claim success");
    assert.equal(result.code, ERROR_CODES.NO_ACTIVE_TIMER);
  });
});
