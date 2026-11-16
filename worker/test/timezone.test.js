// Time zones (docs/2026-11-17-timezones.md, Part A): the default zone in settings, the per-entry
// zone, calendar month/day boundaries in the default zone, and MCP local-time handling.
// The test schema seeds default_timezone = Asia/Dhaka, so "the default" is Dhaka here unless a test changes it.
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { createActivity, createCustomer, createProject, entryVersion, getDataRev } from "../src/core.js";
import { createTestEnv, insertApiToken, insertUser, req } from "./helpers/d1-sqlite.js";

const DHAKA_NOV_1_0200 = Date.parse("2026-11-01T02:00:00+06:00"); // = 2026-10-31T20:00Z
const DHAKA_NOV_16_0100 = Date.parse("2026-11-16T01:00:00+06:00"); // = 2026-11-15T19:00Z
const HOUR = 3_600_000;

async function setup() {
  const env = createTestEnv();
  const userId = await insertUser(env);
  const token = await insertApiToken(env, userId, { scope: "full" });
  const customer = (await createCustomer(env, { name: "Acme", currency: "EUR", hourlyRate: 50 })).customer;
  const coding = (await createActivity(env, { name: "Coding" })).activity;
  const project = (await createProject(env, { customerId: customer.id, name: "Website", rate: 80, defaultTasks: ["Coding"] })).project;
  const ids = { customerId: customer.id, projectId: project.id, activityId: coding.id };
  return { env, token, ids };
}

async function api(ctx, method, path, body) {
  const res = await worker.fetch(req(path, { method, token: ctx.token, body }), ctx.env);
  return { status: res.status, body: await res.json() };
}

async function mcp(ctx, name, args = {}) {
  const res = await worker.fetch(
    req("/mcp", { method: "POST", token: ctx.token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } }),
    ctx.env
  );
  const body = await res.json();
  if (body.error) return { rpcError: body.error };
  return { payload: JSON.parse(body.result.content[0].text), isError: body.result.isError === true };
}

async function mcpOk(ctx, name, args) {
  const out = await mcp(ctx, name, args);
  assert.equal(out.isError, false, `${name}: ${JSON.stringify(out.payload ?? out.rpcError)}`);
  return out.payload;
}

const setDefault = (ctx, defaultTimezone) => api(ctx, "PATCH", "/api/settings", { defaultTimezone });
const addEntry = (ctx, extra) => api(ctx, "POST", "/api/entries", { ...ctx.ids, description: "", tags: "", ...extra });

describe("settings: default time zone", () => {
  it("bootstrap exposes the seeded default and PATCH changes it, bumping data_rev", async () => {
    const ctx = await setup();
    const boot = await api(ctx, "GET", "/api/bootstrap");
    assert.equal(boot.body.settings.defaultTimezone, "Asia/Dhaka");

    const before = await getDataRev(ctx.env);
    const patched = await setDefault(ctx, "Europe/London");
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body, { success: true, settings: { defaultTimezone: "Europe/London" } });
    assert.equal((await api(ctx, "GET", "/api/bootstrap")).body.settings.defaultTimezone, "Europe/London");
    assert.equal(await getDataRev(ctx.env), before + 1);
  });

  it("rejects an invalid or missing zone with 400 and keeps the old value", async () => {
    const ctx = await setup();
    assert.equal((await setDefault(ctx, "Mars/Olympus")).status, 400);
    assert.equal((await setDefault(ctx, 5)).status, 400);
    assert.equal((await api(ctx, "PATCH", "/api/settings", {})).status, 400);
    assert.equal((await api(ctx, "PATCH", "/api/settings", { defaultTimezone: "" })).status, 400);
    assert.equal((await api(ctx, "GET", "/api/bootstrap")).body.settings.defaultTimezone, "Asia/Dhaka");
  });

  it("requires a credential like every other /api route", async () => {
    const ctx = await setup();
    const res = await worker.fetch(req("/api/settings", { method: "PATCH", body: { defaultTimezone: "UTC" } }), ctx.env);
    assert.equal(res.status, 401);
  });
});

describe("entries: per-entry zone", () => {
  it("stores the zone given on create, else the default zone at that moment", async () => {
    const ctx = await setup();
    const explicit = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR, timezone: "America/New_York" });
    assert.equal(explicit.status, 201);
    assert.equal(explicit.body.entry.timezone, "America/New_York");

    const implicit = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    assert.equal(implicit.body.entry.timezone, "Asia/Dhaka");
  });

  it("freezes the default at creation: a later default change does not move existing entries", async () => {
    const ctx = await setup();
    const first = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    await setDefault(ctx, "UTC");
    const second = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    assert.equal(first.body.entry.timezone, "Asia/Dhaka");
    assert.equal(second.body.entry.timezone, "UTC");
  });

  it("rejects an invalid zone on create with 400", async () => {
    const ctx = await setup();
    const res = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR, timezone: "Nowhere/City" });
    assert.equal(res.status, 400);
  });

  it("PATCH changes the zone but keeps the instants; null returns it to the default; invalid is 400", async () => {
    const ctx = await setup();
    const created = await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    const id = created.body.entry.id;

    const moved = await api(ctx, "PATCH", `/api/entries/${id}`, { timezone: "Europe/London" });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.entry.timezone, "Europe/London");
    assert.equal(moved.body.entry.start_time, DHAKA_NOV_16_0100);
    assert.equal(moved.body.entry.end_time, DHAKA_NOV_16_0100 + HOUR);
    assert.equal(moved.body.entry.duration_seconds, 3600);

    const cleared = await api(ctx, "PATCH", `/api/entries/${id}`, { timezone: null });
    assert.equal(cleared.body.entry.timezone, null);

    assert.equal((await api(ctx, "PATCH", `/api/entries/${id}`, { timezone: "Bogus/Zone" })).status, 400);
  });

  it("the timer start stores an explicit zone or the default", async () => {
    const ctx = await setup();
    const explicit = await api(ctx, "POST", "/api/timer/start", { ...ctx.ids, timezone: "Europe/London" });
    assert.equal(explicit.body.timer.timezone, "Europe/London");
    await api(ctx, "POST", "/api/timer/stop");
    const implicit = await api(ctx, "POST", "/api/timer/start", ctx.ids);
    assert.equal(implicit.body.timer.timezone, "Asia/Dhaka");
    assert.equal((await api(ctx, "POST", "/api/timer/stop")).status, 200);
  });

  it("a timer start with a bad zone is 400 and starts nothing", async () => {
    const ctx = await setup();
    const res = await api(ctx, "POST", "/api/timer/start", { ...ctx.ids, timezone: "Not/AZone" });
    assert.equal(res.status, 400);
    assert.equal((await api(ctx, "GET", "/api/bootstrap")).body.activeTimer, null);
  });

  it("the version hash covers the zone, so a zone-only edit is detected", () => {
    const row = { customer_id: "c", project_id: "p", activity_id: "a", start_time: 1, end_time: 2, duration_seconds: 1, rate_applied: 0, cost: 0, currency: "EUR", is_running: 0 };
    assert.notEqual(entryVersion({ ...row, timezone: "Asia/Dhaka" }), entryVersion({ ...row, timezone: "UTC" }));
    assert.notEqual(entryVersion({ ...row, timezone: null }), entryVersion({ ...row, timezone: "UTC" }));
  });
});

describe("calendar month and day come from the default zone", () => {
  it("an entry at 02:00 on the 1st in Dhaka belongs to that month, not the previous one", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_1_0200, endTime: DHAKA_NOV_1_0200 + HOUR });
    const november = await api(ctx, "GET", "/api/summary?month=2026-11");
    const october = await api(ctx, "GET", "/api/summary?month=2026-10");
    assert.equal(november.body.totals.entry_count, 1);
    assert.equal(october.body.totals.entry_count, 0);
  });

  it("switching the default to UTC moves the same instant into the previous month", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_1_0200, endTime: DHAKA_NOV_1_0200 + HOUR });
    await setDefault(ctx, "UTC");
    assert.equal((await api(ctx, "GET", "/api/summary?month=2026-10")).body.totals.entry_count, 1);
    assert.equal((await api(ctx, "GET", "/api/summary?month=2026-11")).body.totals.entry_count, 0);
  });

  it("explicit fromMs/toMs ranges are instants and ignore the zone", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_1_0200, endTime: DHAKA_NOV_1_0200 + HOUR });
    await setDefault(ctx, "America/New_York");
    const res = await api(ctx, "GET", `/api/summary?fromMs=${Date.UTC(2026, 9, 1)}&toMs=${Date.UTC(2026, 10, 1)}`);
    assert.equal(res.body.totals.entry_count, 1, "20:00Z on Oct 31 is inside [Oct 1Z, Nov 1Z)");
  });

  it("dashboard by_day groups by calendar day in the default zone", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    const dhaka = await api(ctx, "GET", "/api/dashboard?month=2026-11");
    assert.deepEqual(dhaka.body.by_day.map((d) => [d.day, d.entry_count, d.total_seconds]), [["2026-11-16", 1, 3600]]);

    await setDefault(ctx, "UTC");
    const utc = await api(ctx, "GET", "/api/dashboard?month=2026-11");
    assert.deepEqual(utc.body.by_day.map((d) => d.day), ["2026-11-15"]);
  });

  it("dashboard by_day is oldest first and sums per day", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_16_0100 + 2 * HOUR, endTime: DHAKA_NOV_16_0100 + 3 * HOUR });
    await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    await addEntry(ctx, { startTime: DHAKA_NOV_1_0200, endTime: DHAKA_NOV_1_0200 + HOUR });
    const res = await api(ctx, "GET", "/api/dashboard");
    assert.deepEqual(res.body.by_day.map((d) => [d.day, d.entry_count, d.total_seconds]), [
      ["2026-11-01", 1, 3600],
      ["2026-11-16", 2, 7200],
    ]);
  });
});

describe("MCP: zones", () => {
  it("list_catalog reports the default zone", async () => {
    const ctx = await setup();
    assert.equal((await mcpOk(ctx, "list_catalog")).defaultTimezone, "Asia/Dhaka");
  });

  it("query_summary month uses the default zone", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_1_0200, endTime: DHAKA_NOV_1_0200 + HOUR });
    assert.equal((await mcpOk(ctx, "query_summary", { month: "2026-11" })).totals.entry_count, 1);
    await setDefault(ctx, "UTC");
    assert.equal((await mcpOk(ctx, "query_summary", { month: "2026-11" })).totals.entry_count, 0);
  });

  it("list_entries shows each entry's zone and its local start and end", async () => {
    const ctx = await setup();
    await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR });
    await addEntry(ctx, { startTime: DHAKA_NOV_16_0100, endTime: DHAKA_NOV_16_0100 + HOUR, timezone: "America/New_York" });
    const page = await mcpOk(ctx, "list_entries", { limit: 10 });
    const ny = page.entries.find((e) => e.timezone === "America/New_York");
    const dhaka = page.entries.find((e) => e.timezone === "Asia/Dhaka");
    assert.equal(dhaka.start_local, "2026-11-16T01:00:00+06:00");
    assert.equal(dhaka.end_local, "2026-11-16T02:00:00+06:00");
    assert.equal(ny.start_local, "2026-11-15T14:00:00-05:00");
  });

  it("list_entries falls back to the default zone for entries stored without one", async () => {
    const ctx = await setup();
    ctx.env.DB.raw.prepare(
      "INSERT INTO time_entries (id, customer_id, project_id, activity_id, start_time, end_time, duration_seconds, rate_applied, cost, is_running) VALUES ('legacy', ?, ?, ?, ?, ?, 3600, 0, 0, 0)"
    ).run(ctx.ids.customerId, ctx.ids.projectId, ctx.ids.activityId, DHAKA_NOV_16_0100, DHAKA_NOV_16_0100 + HOUR);
    const page = await mcpOk(ctx, "list_entries");
    assert.equal(page.entries[0].timezone, "Asia/Dhaka");
    assert.equal(page.entries[0].start_local, "2026-11-16T01:00:00+06:00");
  });

  it("offset-less times on add_time_entry are read in the default zone, or in the zone argument", async () => {
    const ctx = await setup();
    const dhaka = await mcpOk(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-11-16T09:30:00", durationMinutes: 30 });
    assert.equal(dhaka.entry.start_time, Date.parse("2026-11-16T03:30:00Z"));
    const london = await mcpOk(ctx, "add_time_entry", { ...ctx.ids, timezone: "Europe/London", startTime: "2026-11-16T09:30:00", durationMinutes: 30 });
    assert.equal(london.entry.start_time, Date.parse("2026-11-16T09:30:00Z"));
    assert.equal(london.entry.timezone, "Europe/London");
  });

  it("update_time_entry can move an entry's zone, and an offset-less start is read in that zone", async () => {
    const ctx = await setup();
    const { entry } = await mcpOk(ctx, "add_time_entry", { ...ctx.ids, startTime: DHAKA_NOV_16_0100, durationMinutes: 60 });
    // The end instant (2026-11-15T20:00Z) is kept; 19:30 London (GMT in November) is 19:30Z.
    const moved = await mcpOk(ctx, "update_time_entry", { id: entry.id, timezone: "Europe/London", startTime: "2026-11-15T19:30:00" });
    assert.equal(moved.entry.timezone, "Europe/London");
    assert.equal(moved.entry.start_time, Date.parse("2026-11-15T19:30:00Z"));
    assert.equal(moved.entry.end_time, Date.parse("2026-11-15T20:00:00Z"));
    assert.equal(moved.entry.duration_seconds, 1800, "duration is recalculated from the new start");

    const reset = await mcpOk(ctx, "update_time_entry", { id: entry.id, timezone: null });
    assert.equal(reset.entry.timezone, null);
  });

  it("start_timer stores the zone; a bad zone is a parameter error", async () => {
    const ctx = await setup();
    const started = await mcpOk(ctx, "start_timer", { ...ctx.ids, timezone: "America/New_York" });
    assert.equal(started.timer.timezone, "America/New_York");
    await mcpOk(ctx, "stop_timer");
    const bad = await mcp(ctx, "start_timer", { ...ctx.ids, timezone: "Nope/Nope" });
    assert.equal(bad.rpcError.code, -32602);
  });
});

describe("update_time_entry reads offset-less times in the entry's own zone", () => {
  const mcp = async (ctx, name, args) => {
    const res = await worker.fetch(
      req("/mcp", { method: "POST", token: ctx.token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } }),
      ctx.env
    );
    return JSON.parse((await res.json()).result.content[0].text);
  };

  it("uses the stored zone when no timezone argument is given, and an explicit one when it is", async () => {
    const ctx = await setup();
    const added = await mcp(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-11-16T09:00", durationMinutes: 60, timezone: "America/New_York" });
    assert.equal(added.entry.timezone, "America/New_York");

    const edited = await mcp(ctx, "update_time_entry", { id: added.entry.id, startTime: "2026-11-16T10:00", endTime: "2026-11-16T11:30" });
    assert.equal(edited.entry.start_time, Date.parse("2026-11-16T10:00:00-05:00"));
    assert.equal(edited.entry.end_time, Date.parse("2026-11-16T11:30:00-05:00"));

    const moved = await mcp(ctx, "update_time_entry", { id: added.entry.id, timezone: "Asia/Dhaka", startTime: "2026-11-16T10:00", endTime: "2026-11-16T11:30" });
    assert.equal(moved.entry.timezone, "Asia/Dhaka");
    assert.equal(moved.entry.start_time, Date.parse("2026-11-16T10:00:00+06:00"));
  });

  it("falls back to the default zone for an entry with no stored zone", async () => {
    const ctx = await setup();
    const added = await mcp(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-11-16T09:00", durationMinutes: 60 });
    ctx.env.DB.raw.prepare("UPDATE time_entries SET timezone = NULL WHERE id = ?").run(added.entry.id);
    const edited = await mcp(ctx, "update_time_entry", { id: added.entry.id, startTime: "2026-11-16T10:00", endTime: "2026-11-16T11:00" });
    assert.equal(edited.entry.start_time, Date.parse("2026-11-16T10:00:00+06:00")); // default = Asia/Dhaka
  });
});
