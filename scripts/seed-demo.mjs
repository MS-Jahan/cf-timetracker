#!/usr/bin/env node
/**
 * Seed demo data into the local D1 database.
 *
 * Usage:
 *   node scripts/seed-demo.mjs              # uses local D1
 *   node scripts/seed-demo.mjs --remote     # uses production D1 (careful!)
 *
 * This re-seeds the standard demo dataset: 2 clients, 3 projects, 4 activities,
 * 5 closed time entries. Existing data is preserved (INSERT OR IGNORE).
 */

import { execSync } from "node:child_process";

const isRemote = process.argv.includes("--remote");
const remoteFlag = isRemote ? "--remote" : "--local";

function run(sql) {
  const escaped = sql.replace(/"/g, '\\"');
  // Local: the top-level binding `DB` (demo name `cf-timetracker` only exists
  // under [env.demo] in worker/wrangler.toml). Remote: the demo instance.
  const target = isRemote ? "cf-timetracker --env demo --remote" : "DB --local";
  execSync(
    `npx wrangler d1 execute ${target} --command="${escaped}"`,
    { stdio: "inherit", cwd: new URL("../", import.meta.url).pathname }
  );
}

const SQL = [
  `INSERT OR IGNORE INTO customers (id, name, currency, hourly_rate) VALUES
    ('c1111111-1111-4111-8111-111111111111', 'Acme Corp', 'USD', 120.0),
    ('c2222222-2222-4222-8222-222222222222', 'Beta LLC', 'USD', 90.0)`,

  `INSERT OR IGNORE INTO projects (id, customer_id, name, budget_type, rate) VALUES
    ('p1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'Website Redesign', 'hourly', 130.0),
    ('p2222222-2222-4222-8222-222222222222', 'c1111111-1111-4111-8111-111111111111', 'Mobile App', 'fixed', 0.0),
    ('p3333333-3333-4333-8333-333333333333', 'c2222222-2222-4222-8222-222222222222', 'API Integration', 'hourly', 95.0)`,

  `INSERT OR IGNORE INTO activities (id, name) VALUES
    ('a1111111-1111-4111-8111-111111111111', 'Development'),
    ('a2222222-2222-4222-8222-222222222222', 'Meeting'),
    ('a3333333-3333-4333-8333-333333333333', 'Design'),
    ('a4444444-4444-4444-8444-444444444444', 'Testing')`,

  `DELETE FROM time_entries`,

  `INSERT INTO time_entries (id, customer_id, project_id, activity_id, description, tags, start_time, end_time, duration_seconds, rate_applied, cost, is_running) VALUES
    ('e1111111-1111-4111-8111-111111111111', 'c1111111-1111-4111-8111-111111111111', 'p1111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'Landing page build', 'frontend,react', 1752643200000, 1752646800000, 3600, 130.0, 130.0, 0),
    ('e2222222-2222-4222-8222-222222222222', 'c1111111-1111-4111-8111-111111111111', 'p1111111-1111-4111-8111-111111111111', 'a3333333-3333-4333-8333-333333333333', 'Mockup review', 'design', 1752729600000, 1752735000000, 5400, 130.0, 195.0, 0),
    ('e3333333-3333-4333-8333-333333333333', 'c1111111-1111-4111-8111-111111111111', 'p2222222-2222-4222-8222-222222222222', 'a2222222-2222-4222-8222-222222222222', 'Sprint planning', 'meeting', 1755318000000, 1755321600000, 3600, 0.0, 0.0, 0),
    ('e4444444-4444-4444-8444-444444444444', 'c2222222-2222-4222-8222-222222222222', 'p3333333-3333-4333-8333-333333333333', 'a1111111-1111-4111-8111-111111111111', 'Webhook endpoint', 'backend', 1755404400000, 1755411600000, 7200, 95.0, 190.0, 0),
    ('e5555555-5555-4555-8555-555555555555', 'c2222222-2222-4222-8222-222222222222', 'p3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444', 'Regression pass', 'qa', 1755490800000, 1755494400000, 3600, 95.0, 95.0, 0)`,
];

console.log(`Seeding demo data (${isRemote ? "REMOTE" : "local"})…`);
for (const sql of SQL) {
  run(sql);
}
console.log("Done. 2 clients, 3 projects, 4 activities, 5 entries seeded.");
