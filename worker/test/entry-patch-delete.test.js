// Tests for editing a running entry in place and deleting entries (worker/src/core.js).
// Run: npm test   (node --test)
//
// Running-entry edits are the interesting surface: a patch without endTime keeps the
// clock running, a patch with endTime stops it in one guarded UPDATE, and DELETE must
// refuse the running row because it is still the live timer.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deleteTimeEntry, updateTimeEntry } from "../src/core.js";

const ENTRY_ID = "e0000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "p0000000-0000-4000-8000-000000000001";
const ACTIVITY_ID = "a0000000-0000-4000-8000-000000000001";
const START = Date.parse("2026-09-22T09:00:00Z");
const HOUR = 3600_000;

const closedRow = (overrides = {}) => ({
  id: ENTRY_ID,
  customer_id: CUSTOMER_ID,
  project_id: PROJECT_ID,
  activity_id: ACTIVITY_ID,
  description: "original note",
  tags: "",
  start_time: START,
  end_time: START + HOUR,
  duration_seconds: 3600,
  rate_applied: 100,
  cost: 100,
  is_running: 0,
  ...overrides,
});

/**
 * Minimal D1 stub. `current` is what the entry lookup returns; the reselect after an
 * UPDATE returns `after` (defaults to the current row). Updates are captured for
 * assertion.
 */
function stubDb({ current, after } = {}) {
  const updates = [];
  let deleted = false;
  const db = {
    updates,
    deleted: () => deleted,
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          if (/^SELECT \* FROM time_entries WHERE id = \?$/.test(sql.trim())) {
            return updates.length ? (after ?? current) : current;
          }
          if (/SELECT is_running FROM time_entries/.test(sql)) return current;
          if (/^SELECT 1 FROM/.test(sql.trim())) return { 1: 1 };
          if (/SELECT customer_id FROM projects/.test(sql)) return { customer_id: CUSTOMER_ID };
          if (/COUNT\(\*\) AS total FROM project_tasks/.test(sql)) return { total: 0 };
          return null;
        },
        async run() {
          if (sql.includes("UPDATE time_entries")) {
            updates.push({ sql, args: this.args });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM time_entries")) {
            deleted = true;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { DB: db };
}

describe("updateTimeEntry on a running entry", () => {
  const running = { current: closedRow({ is_running: 1, end_time: null, duration_seconds: 0, cost: 0 }) };

  it("keeps the clock running when endTime is absent", async () => {
    const env = stubDb(running);
    const result = await updateTimeEntry(env, ENTRY_ID, { description: "edited", tags: "a,b", hourlyRate: 150 });

    assert.equal(result.status, "ok");
    const [update] = env.DB.updates;
    assert.ok(update, "expected an UPDATE");
    assert.match(update.sql, /WHERE id = \? AND is_running = 1/);
    assert.doesNotMatch(update.sql, /is_running = 0/);
    assert.doesNotMatch(update.sql, /end_time/);
    assert.equal(update.args[5], START, "start_time passes through");
    assert.equal(update.args[6], 150, "new rate is applied");
  });

  it("stops the timer and writes duration/cost when endTime is present", async () => {
    const env = stubDb(running);
    const endTime = START + 2 * HOUR;
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime });

    assert.equal(result.status, "ok");
    const [update] = env.DB.updates;
    assert.match(update.sql, /is_running = 0/);
    assert.equal(update.args[6], endTime);
    assert.equal(update.args[7], 7200, "duration in seconds");
    assert.equal(update.args[9], 200, "cost at rate 100 for two hours");
  });

  it("accepts endTime through the stop-shape the editor sends (string timestamp)", async () => {
    const env = stubDb(running);
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime: String(START + 60_000) });

    assert.equal(result.status, "ok");
    const [update] = env.DB.updates;
    assert.match(update.sql, /is_running = 0/);
    assert.equal(update.args[7], 60);
  });

  it("rejects an endTime before or at the start", async () => {
    const env = stubDb(running);
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime: START });

    assert.equal(result.status, "invalid");
    assert.equal(env.DB.updates.length, 0);
  });

  it("rejects an unparseable endTime", async () => {
    const env = stubDb(running);
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime: "not-a-time" });

    assert.equal(result.status, "invalid");
    assert.equal(env.DB.updates.length, 0);
  });

  it("revalidates masters when the client changes mid-run", async () => {
    const env = stubDb(running);
    const result = await updateTimeEntry(env, ENTRY_ID, { customerId: CUSTOMER_ID, projectId: PROJECT_ID, activityId: ACTIVITY_ID });

    assert.equal(result.status, "ok");
    const [update] = env.DB.updates;
    assert.match(update.sql, /WHERE id = \? AND is_running = 1/);
  });
});

describe("updateTimeEntry on a closed entry", () => {
  it("still recomputes duration and cost with the closed guard", async () => {
    const env = stubDb({ current: closedRow() });
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime: START + 30 * 60_000 });

    assert.equal(result.status, "ok");
    const [update] = env.DB.updates;
    assert.match(update.sql, /WHERE id = \? AND is_running = 0/);
    assert.equal(update.args[7], 1800);
    assert.equal(update.args[9], 50);
  });

  it("rejects an endTime that does not follow startTime", async () => {
    const env = stubDb({ current: closedRow() });
    const result = await updateTimeEntry(env, ENTRY_ID, { endTime: START - 1000 });

    assert.equal(result.status, "invalid");
  });
});

describe("deleteTimeEntry", () => {
  it("deletes a closed entry", async () => {
    const env = stubDb({ current: closedRow() });
    const result = await deleteTimeEntry(env, ENTRY_ID);

    assert.equal(result.status, "ok");
    assert.ok(env.DB.deleted());
  });

  it("refuses the running entry - it is still the live timer", async () => {
    const env = stubDb({ current: closedRow({ is_running: 1, end_time: null, duration_seconds: 0, cost: 0 }) });
    const result = await deleteTimeEntry(env, ENTRY_ID);

    assert.equal(result.status, "conflict");
    assert.match(result.error, /Stop the timer/);
    assert.ok(!env.DB.deleted());
  });

  it("reports not_found for an unknown id", async () => {
    const env = stubDb({ current: null });
    const result = await deleteTimeEntry(env, ENTRY_ID);

    assert.equal(result.status, "not_found");
  });
});
