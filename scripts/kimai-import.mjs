#!/usr/bin/env node
/**
 * Import a Kimai CSV export into cf-timetracker.
 *
 * Kimai's export format (Date, From, To, Customer, Project, Activity, …) is the
 * ONE officially supported import format for this app — other CSVs must be
 * converted to it first. Column order does not matter; header names must match
 * Kimai's export.
 *
 * What it does:
 *   - creates missing clients (currency from the CSV), projects (under their
 *     client), and shared activities — all matched by exact name, never duplicated
 *   - posts every row as a closed entry via POST /api/entries; duration and cost
 *     are derived server-side. The row's "Hourly price" becomes the entry rate.
 *   - skips rows whose (project, activity, start) already exists in the tracker,
 *     so re-running the same file adds nothing.
 *
 * Environment:
 *   TRACKER_URL    e.g. https://timetracker-api.safe-browsing.workers.dev
 *   TRACKER_TOKEN  optional, if the worker has APP_TOKEN set (X-App-Token)
 *   KIMAI_TZ       IANA zone the Kimai export's naive times are in
 *                  (default: Asia/Dhaka — Kimai exports local wall-clock times)
 *   DRY_RUN        1 = report the plan without writing anything
 *
 * Usage:
 *   DRY_RUN=1 TRACKER_URL=... node scripts/kimai-import.mjs path/to/kimai-export.csv
 */

const fs = await import("node:fs");

const csvPath = process.argv[2];
const env = process.env;
if (!csvPath || !env.TRACKER_URL) {
  console.error("Usage: TRACKER_URL=... [-- env DRY_RUN=1] node scripts/kimai-import.mjs kimai-export.csv\nKIMAI_TZ defaults to Asia/Dhaka. TRACKER_TOKEN optional.");
  process.exit(1);
}
const dry = env.DRY_RUN === "1";
const tz = env.KIMAI_TZ || "Asia/Dhaka";
const base = env.TRACKER_URL.replace(/\/$/, "");
const headers = env.TRACKER_TOKEN ? { "X-App-Token": env.TRACKER_TOKEN, "Content-Type": "application/json" } : { "Content-Type": "application/json" };

/* ---------- CSV parsing (RFC-4180-ish: quoted fields, "" escapes, CRLF) ---------- */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  return rows;
}

/* ---------- naive wall-clock → epoch ms, honoring KIMAI_TZ ---------- */

function tzOffsetMs(timeZone, utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - utcMs;
}

function naiveToEpochMs(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let utc = guess - tzOffsetMs(timeZone, guess);
  utc = guess - tzOffsetMs(timeZone, utc); // second pass settles DST edges
  return utc;
}

/* ---------- read the CSV ---------- */

const raw = fs.readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const rows = parseCsv(raw);
if (!rows.length) { console.error("CSV is empty."); process.exit(1); }
const header = rows[0].map((h) => h.trim());
const col = (name) => header.indexOf(name);
const REQUIRED = ["Date", "From", "To", "Customer", "Project", "Activity"];
for (const name of REQUIRED) {
  if (col(name) === -1) { console.error(`CSV is missing required column "${name}". This importer expects Kimai's own export format.`); process.exit(1); }
}
const at = (row, name) => (row[col(name)] ?? "").trim();

const records = [];
const skipped = [];
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const where = `row ${i + 1}`;
  const date = at(row, "Date"), from = at(row, "From"), to = at(row, "To");
  const customer = at(row, "Customer"), project = at(row, "Project"), activity = at(row, "Activity");
  if (!date && !from && !customer && !project) continue; // fully blank line
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}/.test(from)) { skipped.push({ where, reason: `bad date/time (${date} ${from})` }); continue; }
  if (!customer || !project || !activity) { skipped.push({ where, reason: "missing customer/project/activity" }); continue; }

  let startMs = naiveToEpochMs(date, from, tz);
  let endTime = to || "";
  let endMs = endTime ? naiveToEpochMs(date, endTime, tz) : NaN;
  if (!endTime || endMs <= startMs) {
    if (endTime) endMs += 86_400_000; // "To" past midnight rolls to the next day
    else { skipped.push({ where, reason: "no end time (running rows are skipped)" }); continue; }
  }
  if (endMs <= startMs) { skipped.push({ where, reason: "end is not after start" }); continue; }

  const hourlyPrice = parseFloat(at(row, "Hourly price"));
  records.push({
    customer, project, activity,
    currency: at(row, "Currency"),
    hourlyRate: Number.isFinite(hourlyPrice) ? hourlyPrice : 0,
    description: at(row, "Description"),
    tags: at(row, "Tags"),
    startMs, endMs, where,
  });
}

console.log(`CSV: ${records.length} importable rows, ${skipped.length} skipped.`);
for (const s of skipped.slice(0, 10)) console.log(`  skip ${s.where}: ${s.reason}`);
if (skipped.length > 10) console.log(`  … and ${skipped.length - 10} more skipped`);

/* ---------- tracker master data ---------- */

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { headers, ...opts });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok && !opts.allowError) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)} — sent: ${String(opts.body ?? "").slice(0, 200)}`);
  return json;
}

console.log(`\nReading tracker at ${base} …`);
const bootstrap = await api("/api/bootstrap");
const customers = [...bootstrap.customers, ...(bootstrap.archivedCustomers || [])];
const projects = [...bootstrap.projects, ...(bootstrap.archivedProjects || [])];
const activities = [...bootstrap.activities, ...(bootstrap.archivedActivities || [])];

// Existing entries, for dedupe on re-runs.
const existing = new Set();
let offset = 0;
for (;;) {
  const page = await api(`/api/entries?limit=200&offset=${offset}`);
  for (const e of page.entries) existing.add(`${e.project_id}|${e.activity_id}|${e.start_time}`);
  offset += page.entries.length;
  if (page.entries.length < 200) break;
}

const mode = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const planCustomers = new Map(); // name -> { currency, hourlyRate }
for (const r of records) {
  const entry = planCustomers.get(r.customer) || { currency: r.currency || "USD", rates: [] };
  if (r.currency) entry.currency = r.currency;
  entry.rates.push(r.hourlyRate);
  planCustomers.set(r.customer, entry);
}
const planProjects = new Map(); // "customer\u0000project" -> customer name
const planActivities = new Set();
for (const r of records) {
  planProjects.set(`${r.customer}\u0000${r.project}`, r.customer);
  planActivities.add(r.activity);
}

const findOrCreate = async (list, name, createPath, body, label) => {
  const hit = list.find((x) => x.name === name);
  if (hit) { console.log(`  = ${label} "${name}" exists`); return hit.id; }
  if (dry) { console.log(`  + ${label} "${name}" (dry run)`); return `dry-${label}-${name}`; }
  const created = await api(createPath, { method: "POST", body: JSON.stringify(body) });
  console.log(`  + ${label} "${name}"`);
  // Tracker create endpoints answer { success: true, customer|project|activity: {...} }.
  return created.customer?.id ?? created.project?.id ?? created.activity?.id ?? created.record?.id ?? created.id;
};

console.log(`\nPlan: ${planCustomers.size} clients, ${planProjects.size} projects, ${planActivities.size} activities, ${records.length} entries${dry ? " (DRY RUN — nothing written)" : ""}`);

const customerId = new Map(), projectId = new Map(), activityId = new Map();
for (const [name, info] of planCustomers) {
  const hourlyRate = mode(info.rates) || 0;
  const id = await findOrCreate(customers, name, "/api/customers", { name, currency: info.currency, hourlyRate }, "client");
  customerId.set(name, id);
}
for (const [key, customerName] of planProjects) {
  const name = key.split("\u0000")[1];
  const id = await findOrCreate(projects, name, "/api/projects", { customerId: customerId.get(customerName), name }, "project");
  projectId.set(key, id);
}
for (const name of planActivities) {
  const id = await findOrCreate(activities, name, "/api/activities", { name }, "activity");
  activityId.set(name, id);
}

if (dry) {
  console.log(`\nSample entry: ${new Date(records[0].startMs).toISOString()} → ${new Date(records[0].endMs).toISOString()} "${records[0].description}" @ ${records[0].hourlyRate}/h`);
  process.exit(0);
}

/* ---------- push entries ---------- */

let pushed = 0, dupes = 0, failed = 0;
for (const r of records) {
  const pId = projectId.get(`${r.customer}\u0000${r.project}`);
  const aId = activityId.get(r.activity);
  const key = `${pId}|${aId}|${r.startMs}`;
  if (existing.has(key)) { dupes++; continue; }
  try {
    await api("/api/entries", {
      method: "POST",
      body: JSON.stringify({
        customerId: customerId.get(r.customer),
        projectId: pId,
        activityId: aId,
        description: r.description,
        tags: r.tags,
        startTime: r.startMs,
        endTime: r.endMs,
        hourlyRate: r.hourlyRate,
      }),
    });
    existing.add(key);
    pushed++;
  } catch (err) {
    failed++;
    console.error(`  ! ${r.where}: ${err.message}`);
  }
}

console.log(`\nDone: ${pushed} entries imported, ${dupes} already present (skipped), ${failed} failed.`);
