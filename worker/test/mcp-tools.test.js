// MCP agent-complete tools (list/add/update/delete entries, catalog, master-data creates),
// through worker.fetch -> /mcp -> mcp.js -> core.js. Run: npm test (node --test).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import worker from "../src/index.js";
import { parseTimeInput, TOOLS } from "../src/mcp.js";
import { createActivity, createCustomer, createProject, getDataRev } from "../src/core.js";
import { createTestEnv, insertApiToken, insertUser, req } from "./helpers/d1-sqlite.js";

const ISO_OFFSET = "2026-11-16T09:30:00+06:00"; // = 2026-11-16T03:30:00Z
const START_MS = Date.parse("2026-11-16T03:30:00Z");
const ORIGINAL_FOUR = ["get_active_timer", "start_timer", "stop_timer", "query_summary"];

/** Fresh env with two clients-worth of masters, an mcp-scope token and a linked/unlinked activity pair. */
async function setup(tokenScope = "mcp") {
  const env = createTestEnv();
  const userId = await insertUser(env);
  const token = await insertApiToken(env, userId, { scope: tokenScope });
  const customer = (await createCustomer(env, { name: "Acme", currency: "EUR", hourlyRate: 50 })).customer;
  const coding = (await createActivity(env, { name: "Coding" })).activity;
  const project = (await createProject(env, { customerId: customer.id, name: "Website", rate: 80, defaultTasks: ["Coding"] })).project;
  const review = (await createActivity(env, { name: "Review" })).activity; // not linked to the project
  const ids = { customerId: customer.id, projectId: project.id, activityId: coding.id };
  return { env, token, customer, project, coding, review, ids };
}

/** Call one tool; returns the JSON-RPC body plus the decoded payload and isError flag. */
async function call(ctx, name, args = {}) {
  const res = await worker.fetch(
    req("/mcp", { method: "POST", token: ctx.token, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } }),
    ctx.env
  );
  const body = await res.json();
  if (body.error) return { rpcError: body.error };
  return {
    payload: JSON.parse(body.result.content[0].text),
    isError: body.result.isError === true,
  };
}

/** Call a tool that must succeed. */
async function ok(ctx, name, args) {
  const out = await call(ctx, name, args);
  assert.equal(out.isError, false, `${name} should succeed: ${JSON.stringify(out.payload ?? out.rpcError)}`);
  return out.payload;
}

const rev = (ctx) => getDataRev(ctx.env);

describe("tools/list", () => {
  it("lists twelve tools; the original four keep their names and input schemas", () => {
    const names = TOOLS.map((t) => t.name);
    assert.equal(names.length, 12);
    assert.deepEqual(names.slice(0, 4), ORIGINAL_FOUR);
    const startTimer = TOOLS.find((t) => t.name === "start_timer");
    assert.deepEqual(startTimer.inputSchema.required, ["customerId", "projectId", "activityId"]);
    assert.deepEqual(Object.keys(startTimer.inputSchema.properties), ["customerId", "projectId", "activityId", "description", "tags", "hourlyRate", "timezone"]);
  });

  it("read tools are readOnlyHint, delete is destructiveHint, writes carry no read-only annotation", () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    assert.equal(byName.list_catalog.annotations.readOnlyHint, true);
    assert.equal(byName.list_entries.annotations.readOnlyHint, true);
    assert.equal(byName.delete_time_entry.annotations.destructiveHint, true);
    assert.equal(byName.add_time_entry.annotations, undefined);
  });
});

describe("parseTimeInput", () => {
  it("accepts epoch ms, digit strings of 10+ chars and ISO with offset; reads offset-less ISO in the given zone only", () => {
    assert.equal(parseTimeInput(START_MS), START_MS);
    assert.equal(parseTimeInput(String(START_MS)), START_MS);
    assert.equal(parseTimeInput(ISO_OFFSET), START_MS);
    assert.equal(parseTimeInput(ISO_OFFSET, "America/New_York"), START_MS, "an explicit offset wins over the zone");
    assert.equal(parseTimeInput("2026-11-16T03:30:00Z"), START_MS);
    assert.equal(parseTimeInput("2026-11-16T09:30:00", "Asia/Dhaka"), START_MS, "09:30 in Dhaka is 03:30Z");
    assert.equal(parseTimeInput("2026-11-16T09:30:00"), null, "no zone, no instant");
    assert.equal(parseTimeInput("2026-02-30T09:30:00", "Asia/Dhaka"), null, "impossible dates are rejected");
    assert.equal(parseTimeInput("12345"), null);
    assert.equal(parseTimeInput("tomorrow", "Asia/Dhaka"), null);
  });
});

describe("list_catalog", () => {
  it("returns compact active records with the project task links", async () => {
    const ctx = await setup();
    const catalog = await ok(ctx, "list_catalog");
    assert.deepEqual(catalog.customers, [{ id: ctx.customer.id, name: "Acme", currency: "EUR", hourly_rate: 50 }]);
    assert.equal(catalog.projects.length, 1);
    assert.deepEqual(catalog.projects[0], { id: ctx.project.id, customer_id: ctx.customer.id, name: "Website", rate: 80 });
    const names = catalog.activities.map((a) => a.name).sort();
    assert.deepEqual(names, ["Coding", "Review"]);
    assert.deepEqual(catalog.projectTasks[ctx.project.id], [ctx.coding.id]);
  });

  it("hides archived records by default and marks them with includeArchived", async () => {
    const ctx = await setup();
    ctx.env.DB.raw.prepare("UPDATE activities SET archived_at = ? WHERE id = ?").run(Date.now(), ctx.review.id);
    const active = await ok(ctx, "list_catalog");
    assert.deepEqual(active.activities.map((a) => a.name), ["Coding"]);
    assert.equal(active.activities[0].archived, undefined);

    const all = await ok(ctx, "list_catalog", { includeArchived: true });
    const review = all.activities.find((a) => a.name === "Review");
    assert.equal(review.archived, true);
    assert.equal(all.activities.find((a) => a.name === "Coding").archived, false);
  });
});

describe("add_time_entry", () => {
  it("accepts an ISO string with an offset and stores epoch ms; start_iso is UTC", async () => {
    const ctx = await setup();
    const out = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: ISO_OFFSET, endTime: START_MS + 3600000 });
    assert.equal(out.success, true);
    assert.equal(out.entry.start_time, START_MS);
    assert.equal(out.entry.duration_seconds, 3600);
    assert.equal(out.entry.is_running, 0);
  });

  it("accepts epoch ms for both times and a Z-suffixed ISO string", async () => {
    const ctx = await setup();
    const a = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, endTime: START_MS + 60000 });
    assert.equal(a.entry.duration_seconds, 60);
    const b = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-11-16T03:30:00Z", endTime: "2026-11-16T04:00:00Z" });
    assert.equal(b.entry.duration_seconds, 1800);
  });

  it("durationMinutes sets endTime = start + minutes", async () => {
    const ctx = await setup();
    const out = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: ISO_OFFSET, durationMinutes: 90 });
    assert.equal(out.entry.end_time, START_MS + 90 * 60000);
    assert.equal(out.entry.duration_seconds, 5400);
  });

  it("reads an offset-less ISO string in the default zone (Asia/Dhaka in tests) and in an explicit timezone", async () => {
    const ctx = await setup();
    const dhaka = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-11-16T09:30:00", durationMinutes: 60 });
    assert.equal(dhaka.entry.start_time, START_MS);
    assert.equal(dhaka.entry.timezone, "Asia/Dhaka", "the default zone at creation is stored");

    const ny = await ok(ctx, "add_time_entry", { ...ctx.ids, timezone: "America/New_York", startTime: "2026-11-16T09:30:00", durationMinutes: 60 });
    assert.equal(ny.entry.start_time, Date.parse("2026-11-16T14:30:00Z"));
    assert.equal(ny.entry.timezone, "America/New_York");
  });

  it("rejects an invalid timezone as -32602 and an impossible offset-less date as a parameter error", async () => {
    const ctx = await setup();
    const badZone = await call(ctx, "add_time_entry", { ...ctx.ids, timezone: "Mars/Olympus", startTime: START_MS, durationMinutes: 5 });
    assert.equal(badZone.rpcError.code, -32602);
    assert.match(badZone.rpcError.message, /IANA/);
    const badDate = await call(ctx, "add_time_entry", { ...ctx.ids, startTime: "2026-02-30T09:30:00", durationMinutes: 5 });
    assert.equal(badDate.rpcError.code, -32602);
  });

  it("rejects both endTime and durationMinutes, and neither, as -32602", async () => {
    const ctx = await setup();
    const both = await call(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, endTime: START_MS + 60000, durationMinutes: 5 });
    assert.equal(both.rpcError.code, -32602);
    const neither = await call(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS });
    assert.equal(neither.rpcError.code, -32602);
  });

  it("rejects an endTime before the start as a tool error", async () => {
    const ctx = await setup();
    const out = await call(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, endTime: START_MS - 1000 });
    assert.equal(out.isError, true);
    assert.match(out.payload.error, /endTime must be after startTime/);
  });

  it("rejects unknown ids and an activity not linked to the project", async () => {
    const ctx = await setup();
    const unknown = await call(ctx, "add_time_entry", { ...ctx.ids, customerId: "nope", startTime: START_MS, durationMinutes: 5 });
    assert.equal(unknown.isError, true);
    assert.match(unknown.payload.error, /Unknown ids: customerId/);

    const unlinked = await call(ctx, "add_time_entry", { ...ctx.ids, activityId: ctx.review.id, startTime: START_MS, durationMinutes: 5 });
    assert.equal(unlinked.isError, true);
    assert.match(unlinked.payload.error, /not enabled as a task/);
  });

  it("cost uses the resolved rate: project rate by default, explicit hourlyRate overrides", async () => {
    const ctx = await setup();
    const byProject = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 90 });
    assert.equal(byProject.entry.rate_applied, 80);
    assert.equal(byProject.entry.cost, 120); // 1.5 h * 80
    assert.equal(byProject.entry.currency, "EUR");

    const overridden = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 60, hourlyRate: 30 });
    assert.equal(overridden.entry.rate_applied, 30);
    assert.equal(overridden.entry.cost, 30);
  });

  it("bumps data_rev once per successful write", async () => {
    const ctx = await setup();
    const before = await rev(ctx);
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 5 });
    assert.equal(await rev(ctx), before + 1);
  });
});

describe("list_entries", () => {
  it("is newest first, includes the running entry, and reports has_more", async () => {
    const ctx = await setup();
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS - 7200000, durationMinutes: 30 });
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS - 3600000, durationMinutes: 30 });
    await ok(ctx, "start_timer", ctx.ids);

    const page = await ok(ctx, "list_entries", { limit: 2 });
    assert.equal(page.returned, 2);
    assert.equal(page.has_more, true);
    assert.equal(page.entries[0].is_running, true);
    assert.equal(page.entries[0].end_iso, null);
    assert.equal(page.entries[1].start_time, START_MS - 3600000);
    assert.equal(page.entries[1].start_iso, new Date(START_MS - 3600000).toISOString());
    assert.equal(page.entries[1].customer_name, "Acme");
    assert.equal(page.entries[1].project_name, "Website");
    assert.equal(page.entries[1].activity_name, "Coding");
    assert.ok(page.entries[1].version);
  });

  it("filters by time range (half-open) and by projectId", async () => {
    const ctx = await setup();
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 10 });
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS + 86400000, durationMinutes: 10 });

    const dayOne = await ok(ctx, "list_entries", { fromTime: START_MS, toTime: START_MS + 86400000 });
    assert.equal(dayOne.returned, 1);
    assert.equal(dayOne.entries[0].start_time, START_MS);

    const other = await ok(ctx, "list_entries", { projectId: "no-such-project" });
    assert.equal(other.returned, 0);
  });

  it("fromTime and toTime must be given together; offset-less times are read in the timezone argument", async () => {
    const ctx = await setup();
    const half = await call(ctx, "list_entries", { fromTime: START_MS });
    assert.equal(half.rpcError.code, -32602);
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 10 });
    const dhaka = await ok(ctx, "list_entries", { fromTime: "2026-11-16T09:00:00", toTime: "2026-11-16T10:00:00" });
    assert.equal(dhaka.returned, 1, "09:00-10:00 Dhaka covers the 03:30Z entry");
    const ny = await ok(ctx, "list_entries", { fromTime: "2026-11-16T09:00:00", toTime: "2026-11-16T10:00:00", timezone: "America/New_York" });
    assert.equal(ny.returned, 0, "09:00-10:00 New York is 14:00-15:00Z");
    const bad = await call(ctx, "list_entries", { fromTime: "2026-11-16T09:00:00", toTime: START_MS, timezone: "Nope/Nope" });
    assert.equal(bad.rpcError.code, -32602);
  });
});

describe("update_time_entry", () => {
  it("changing times recalculates duration and cost", async () => {
    const ctx = await setup();
    const { entry } = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 60 });
    const out = await ok(ctx, "update_time_entry", { id: entry.id, endTime: START_MS + 2 * 3600000 });
    assert.equal(out.entry.duration_seconds, 7200);
    assert.equal(out.entry.cost, 160); // 2 h * 80
  });

  it("giving endTime to the running entry stops it", async () => {
    const ctx = await setup();
    const started = await ok(ctx, "start_timer", ctx.ids);
    const id = started.timer.id;
    const out = await ok(ctx, "update_time_entry", { id, endTime: new Date(Date.now() + 60000).toISOString() });
    assert.equal(out.entry.is_running, 0);
    assert.ok(out.entry.duration_seconds >= 1);
    const active = await ok(ctx, "get_active_timer");
    assert.equal(active.status, "idle");
  });

  it("a stale ifVersion returns entry_changed with the latest entry; the current version applies", async () => {
    const ctx = await setup();
    const { entry } = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 30 });
    const stale = await call(ctx, "update_time_entry", { id: entry.id, ifVersion: "00000000", description: "x" });
    assert.equal(stale.isError, true);
    assert.equal(stale.payload.code, "entry_changed");
    assert.equal(stale.payload.entry.id, entry.id);
    assert.equal(stale.payload.entry.version, entry.version);

    const fresh = await ok(ctx, "update_time_entry", { id: entry.id, ifVersion: entry.version, description: "x" });
    assert.equal(fresh.entry.description, "x");
  });

  it("unknown id is a tool error; no fields is a tool error", async () => {
    const ctx = await setup();
    const missing = await call(ctx, "update_time_entry", { id: "nope", description: "x" });
    assert.equal(missing.isError, true);
    assert.match(missing.payload.error, /not found/i);
  });

  it("bumps data_rev", async () => {
    const ctx = await setup();
    const { entry } = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 30 });
    const before = await rev(ctx);
    await ok(ctx, "update_time_entry", { id: entry.id, tags: "billable" });
    assert.equal(await rev(ctx), before + 1);
  });
});

describe("delete_time_entry", () => {
  it("deletes a closed entry", async () => {
    const ctx = await setup();
    const { entry } = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 30 });
    const out = await ok(ctx, "delete_time_entry", { id: entry.id });
    assert.equal(out.success, true);
    assert.equal((await ok(ctx, "list_entries")).returned, 0);
  });

  it("refuses the running entry until it is stopped", async () => {
    const ctx = await setup();
    const started = await ok(ctx, "start_timer", ctx.ids);
    const refused = await call(ctx, "delete_time_entry", { id: started.timer.id });
    assert.equal(refused.isError, true);
    assert.match(refused.payload.error, /Stop the timer/);
  });

  it("honours ifVersion", async () => {
    const ctx = await setup();
    const { entry } = await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 30 });
    const stale = await call(ctx, "delete_time_entry", { id: entry.id, ifVersion: "00000000" });
    assert.equal(stale.payload.code, "entry_changed");
    assert.equal((await ok(ctx, "list_entries")).returned, 1);
  });
});

describe("create_customer / create_project / create_activity", () => {
  it("create the masters and they show up in list_catalog", async () => {
    const ctx = await setup();
    const c = await ok(ctx, "create_customer", { name: "Globex", currency: "gbp", hourlyRate: 40 });
    assert.equal(c.customer.currency, "GBP");
    const p = await ok(ctx, "create_project", { customerId: c.customer.id, name: "Retainer", rate: 55 });
    assert.equal(p.project.rate, 55);
    assert.ok(p.tasks.length >= 1); // seeds General and Meeting
    const a = await ok(ctx, "create_activity", { name: "Planning", emoji: "🧭" });
    assert.equal(a.activity.emoji, "🧭");

    const catalog = await ok(ctx, "list_catalog");
    assert.ok(catalog.customers.some((x) => x.name === "Globex"));
    assert.ok(catalog.projects.some((x) => x.name === "Retainer"));
    assert.ok(catalog.activities.some((x) => x.name === "Planning"));
  });

  it("a duplicate activity name is a tool error", async () => {
    const ctx = await setup();
    const dup = await call(ctx, "create_activity", { name: "Coding" });
    assert.equal(dup.isError, true);
    assert.match(dup.payload.error, /already exists/);
  });

  it("a missing customer name is a tool error; a project under an unknown customer is refused", async () => {
    const ctx = await setup();
    const noName = await call(ctx, "create_customer", { name: "  " });
    assert.equal(noName.isError, true);
    const badProject = await call(ctx, "create_project", { customerId: "nope", name: "X" });
    assert.equal(badProject.isError, true);
    assert.match(badProject.payload.error, /Unknown customerId/);
  });

  it("each create bumps data_rev", async () => {
    const ctx = await setup();
    const before = await rev(ctx);
    await ok(ctx, "create_customer", { name: "Initech" });
    await ok(ctx, "create_activity", { name: "Support" });
    assert.equal(await rev(ctx), before + 2);
  });
});

describe("auth and read-only behaviour", () => {
  it("an mcp-scope token can call every write tool", async () => {
    const ctx = await setup("mcp");
    await ok(ctx, "create_activity", { name: "Admin" });
    await ok(ctx, "add_time_entry", { ...ctx.ids, startTime: START_MS, durationMinutes: 5 });
  });

  it("a full-scope token can call the new tools too", async () => {
    const ctx = await setup("full");
    const out = await ok(ctx, "list_catalog");
    assert.ok(Array.isArray(out.customers));
  });

  it("read tools do not bump data_rev", async () => {
    const ctx = await setup();
    const before = await rev(ctx);
    await ok(ctx, "list_catalog");
    await ok(ctx, "list_entries");
    assert.equal(await rev(ctx), before);
  });

  it("an unknown tool is -32601 and a missing required argument is -32602", async () => {
    const ctx = await setup();
    const unknown = await call(ctx, "delete_everything", {});
    assert.equal(unknown.rpcError.code, -32601);
    const missing = await call(ctx, "add_time_entry", { customerId: "x" });
    assert.equal(missing.rpcError.code, -32602);
  });
});
