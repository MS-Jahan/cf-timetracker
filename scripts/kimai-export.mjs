#!/usr/bin/env node
/**
 * Export all closed time entries from cf-timetracker into a Kimai 2 instance.
 *
 * Creates any missing Kimai customers, projects, and activities (matched by
 * name — never duplicated), then posts each closed entry as a Kimai timesheet
 * record with hourlyRate = the entry's applied rate, so Kimai computes the
 * same cost. Running entries are skipped (Kimai has no running-timer concept
 * to import into). Re-running is safe for master data; timesheets re-post —
 * run once, or pass DRY_RUN=1 first.
 *
 * Environment:
 *   TRACKER_URL     e.g. https://timetracker-api.safe-browsing.workers.dev
 *   TRACKER_TOKEN   optional, if the worker has APP_TOKEN set (X-App-Token)
 *   KIMAI_URL       e.g. https://kimai.sabit.dev
 *   KIMAI_USER      Kimai username (profile → API → password/API token)
 *   KIMAI_TOKEN     Kimai API token
 *   KIMAI_TZ        IANA timezone Kimai stores times in (default: UTC). Kimai's
 *                   API takes naive local datetimes, so entries are formatted
 *                   in this zone.
 *   DRY_RUN         1 = report the plan without writing anything to Kimai
 *
 * Usage:
 *   DRY_RUN=1 TRACKER_URL=... KIMAI_URL=... KIMAI_USER=... KIMAI_TOKEN=... node scripts/kimai-export.mjs
 */

const pad = (n) => String(n).padStart(2, "0");

/** Epoch ms → naive local datetime string Kimai expects: YYYY-MM-DDTHH:mm:ss */
function toKimaiTime(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

async function api(base, path, { tokenHeaders = {}, method = "GET", body } = {}) {
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...tokenHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const env = process.env;
const required = ["TRACKER_URL", "KIMAI_URL", "KIMAI_USER", "KIMAI_TOKEN"];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(", ")}\nSee the header comment in scripts/kimai-export.mjs.`);
  process.exit(1);
}
const dry = env.DRY_RUN === "1";
const tz = env.KIMAI_TZ || "UTC";
const trackerHeaders = env.TRACKER_TOKEN ? { "X-App-Token": env.TRACKER_TOKEN } : {};
const kimaiHeaders = { "X-AUTH-USER": env.KIMAI_USER, "X-AUTH-TOKEN": env.KIMAI_TOKEN };

// 1. Pull master data + every closed entry from the tracker.
console.log(`Reading tracker from ${env.TRACKER_URL} …`);
const bootstrap = await api(env.TRACKER_URL, "/api/bootstrap", { tokenHeaders: trackerHeaders });

const entries = [];
let offset = 0;
const LIMIT = 200;
for (;;) {
  const page = await api(env.TRACKER_URL, `/api/entries?limit=${LIMIT}&offset=${offset}`, { tokenHeaders: trackerHeaders });
  entries.push(...page.entries);
  offset += page.entries.length;
  if (page.entries.length < LIMIT) break;
}
const closed = entries.filter((e) => !e.is_running);
console.log(`Tracker: ${bootstrap.customers.length} clients, ${bootstrap.projects.length} projects, ${bootstrap.activities.length} activities, ${closed.length} closed entries (${entries.length - closed.length} running skipped).`);

// 2. Plan the Kimai master data (name-matched).
const customerByKey = new Map(bootstrap.customers.map((c) => [c.id, c]));
const projectByKey = new Map(bootstrap.projects.map((p) => [p.id, p]));
const activityByKey = new Map(bootstrap.activities.map((a) => [a.id, a]));

const usedCustomers = new Set(), usedProjects = new Set(), usedActivities = new Set();
for (const e of closed) {
  usedCustomers.add(e.customer_id); usedProjects.add(e.project_id); usedActivities.add(e.activity_id);
}

if (dry) {
  console.log("\nDRY RUN — would create in Kimai if missing (matched by name):");
  for (const id of usedCustomers) console.log(`  customer:  ${customerByKey.get(id)?.name}`);
  for (const id of usedProjects) { const p = projectByKey.get(id); console.log(`  project:   ${p?.name} (${customerByKey.get(p?.customer_id)?.name})`); }
  for (const id of usedActivities) console.log(`  activity:  ${activityByKey.get(id)?.name}`);
  console.log(`  timesheets: ${closed.length}`);
  console.log(`\nSample: ${closed[0] ? `${toKimaiTime(closed[0].start_time, tz)} → ${toKimaiTime(closed[0].end_time, tz)} ${closed[0].description || "(no note)"} @ ${closed[0].rate_applied}/h` : "no entries"}`);
  process.exit(0);
}

// 3. Load existing Kimai records and create whatever is missing.
console.log(`\nWriting to Kimai at ${env.KIMAI_URL} (tz ${tz}) …`);
const kimai = (path, opts) => api(env.KIMAI_URL, path, { tokenHeaders: kimaiHeaders, ...opts });

const listAll = async (path) => {
  const out = []; let page = 1;
  for (;;) {
    const chunk = await kimai(`${path}?size=500&page=${page++}`);
    out.push(...chunk);
    if (chunk.length < 500) return out;
  }
};

const existingCustomers = new Map((await listAll("/api/customers")).map((c) => [c.name, c.id]));
const existingProjects = new Map((await listAll("/api/projects")).map((p) => [`${p.customer}:${p.name}`, p.id]));
const existingActivities = new Map((await listAll("/api/activities")).map((a) => [a.name, a.id]));

const kimaiCustomerId = new Map();
for (const id of usedCustomers) {
  const local = customerByKey.get(id);
  if (!local) continue;
  if (existingCustomers.has(local.name)) { kimaiCustomerId.set(id, existingCustomers.get(local.name)); continue; }
  const created = await kimai("/api/customers", { method: "POST", body: { name: local.name, visible: true } });
  kimaiCustomerId.set(id, created.id);
  existingCustomers.set(local.name, created.id);
  console.log(`  + customer ${local.name}`);
}

const kimaiProjectId = new Map();
for (const id of usedProjects) {
  const local = projectByKey.get(id);
  if (!local) continue;
  const customerId = kimaiCustomerId.get(local.customer_id);
  if (!customerId) continue;
  const key = `${customerId}:${local.name}`;
  if (existingProjects.has(key)) { kimaiProjectId.set(id, existingProjects.get(key)); continue; }
  const created = await kimai("/api/projects", { method: "POST", body: { name: local.name, customer: customerId, visible: true } });
  kimaiProjectId.set(id, created.id);
  existingProjects.set(key, created.id);
  console.log(`  + project ${local.name}`);
}

const kimaiActivityId = new Map();
for (const id of usedActivities) {
  const local = activityByKey.get(id);
  if (!local) continue;
  if (existingActivities.has(local.name)) { kimaiActivityId.set(id, existingActivities.get(local.name)); continue; }
  const created = await kimai("/api/activities", { method: "POST", body: { name: local.name, visible: true } });
  kimaiActivityId.set(id, created.id);
  existingActivities.set(local.name, created.id);
  console.log(`  + activity ${local.name}`);
}

// 4. Push timesheets.
let pushed = 0, failed = 0;
for (const e of closed) {
  const projectId = kimaiProjectId.get(e.project_id);
  const activityId = kimaiActivityId.get(e.activity_id);
  if (!projectId || !activityId) { console.error(`  ! skip ${e.id}: missing Kimai mapping`); failed++; continue; }
  try {
    await kimai("/api/timesheets", {
      method: "POST",
      body: {
        begin: toKimaiTime(e.start_time, tz),
        end: toKimaiTime(e.end_time, tz),
        project: projectId,
        activity: activityId,
        description: e.description || "",
        tags: e.tags || "",
        hourlyRate: e.rate_applied || 0,
      },
    });
    pushed++;
  } catch (err) {
    failed++;
    console.error(`  ! entry ${e.id}: ${err.message}`);
  }
}

console.log(`\nDone: ${pushed} timesheets imported, ${failed} failed. Verify totals in Kimai.`);
