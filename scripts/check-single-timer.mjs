#!/usr/bin/env node
// Proves the single-active-timer guarantee under concurrency.
//
//   node scripts/check-single-timer.mjs [apiBase] [attempts]
//
// Fires N simultaneous POST /api/timer/start requests, then asserts:
//   1. exactly one returned 200, the rest 409 with code "timer_running"
//   2. GET /api/bootstrap reports exactly one activeTimer
// It then fires N simultaneous stops and asserts exactly one 200 and the rest 404.
//
// Needs a running API (wrangler dev or deployed). Exits non-zero on failure.
// Leaves the winning entry behind as a closed row, and prints its id.

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const attempts = Number(process.argv[3] || 20);

let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed = true;
};

async function json(path, options) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

const bootstrap = await json("/api/bootstrap");
if (bootstrap.status !== 200) {
  console.error(`Cannot reach ${base}/api/bootstrap (status ${bootstrap.status}). Start the worker first.`);
  process.exit(2);
}
for (const key of ["customers", "projects", "activities"]) {
  if (!bootstrap.body[key]?.length) {
    console.error(`No ${key} in the database; seed it first.`);
    process.exit(2);
  }
}
if (bootstrap.body.activeTimer) {
  console.error("A timer is already running - stop it before running this check.");
  process.exit(2);
}

const customerId = bootstrap.body.customers[0].id;
const projectId = bootstrap.body.projects.find((p) => p.customer_id === customerId)?.id ?? bootstrap.body.projects[0].id;
const activityId = bootstrap.body.activities[0].id;
const startBody = JSON.stringify({ customerId, projectId, activityId, description: "single-timer race check", tags: "race-check" });

console.log(`\n== ${attempts} concurrent starts against ${base} ==`);
const started = await Promise.all(
  Array.from({ length: attempts }, () => json("/api/timer/start", { method: "POST", body: startBody }))
);

const created = started.filter((r) => r.status === 200);
const conflicts = started.filter((r) => r.status === 409);
const others = started.filter((r) => r.status !== 200 && r.status !== 409);

check(created.length === 1, "exactly one start succeeded", `${created.length}/${attempts}`);
check(conflicts.length === attempts - 1, "every other start was refused", `${conflicts.length} × 409`);
check(others.length === 0, "no unexpected statuses", others.map((r) => r.status).join(",") || "none");
check(
  conflicts.every((r) => r.body.code === "timer_running"),
  'refusals carry code "timer_running"',
  conflicts[0]?.body?.code ?? "n/a"
);

const afterStart = await json("/api/bootstrap");
const runningIds = afterStart.body.entries.filter((e) => e.is_running === 1).map((e) => e.id);
check(runningIds.length === 1, "database holds exactly one running entry", `${runningIds.length} found`);

console.log(`\n== ${attempts} concurrent stops ==`);
const stopped = await Promise.all(Array.from({ length: attempts }, () => json("/api/timer/stop", { method: "POST" })));
const stopOk = stopped.filter((r) => r.status === 200).length;
const stopMissing = stopped.filter((r) => r.status === 404).length;
check(stopOk === 1, "exactly one stop succeeded", `${stopOk}/${attempts}`);
check(stopMissing === attempts - 1, "every other stop reported no active timer", `${stopMissing} × 404`);
check(
  stopped.filter((r) => r.status === 404).every((r) => r.body.code === "no_active_timer"),
  'refusals carry code "no_active_timer"'
);

const afterStop = await json("/api/bootstrap");
check(afterStop.body.activeTimer === null, "database holds no running entry");

const winner = created[0]?.body?.timer;
if (winner) {
  const finalized = afterStop.body.entries.find((e) => e.id === winner.id);
  console.log(`\nLeftover closed entry: ${winner.id} (${finalized?.duration_seconds ?? "?"}s, ${finalized?.cost ?? "?"})`);
}

console.log(`\n${failed ? "FAILED" : "All single-timer checks passed."}`);
process.exit(failed ? 1 : 0);
