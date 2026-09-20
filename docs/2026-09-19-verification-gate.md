# Verification Gate - cf-timetracker

**Date:** 2026-09-19

The project has one verification command for the checks that protect the timer's core behavior:

```bash
npm run verify
```

It runs, in order:

1. `cd worker && npm test` - unit tests, including the D1 unique-constraint race path and concurrent-stop behavior.
2. `cd web && npm run build` - production frontend build.
3. `node scripts/check-single-timer.mjs <api> 20` - live concurrent start/stop requests, asserting one successful start, `timer_running` conflicts for the losers, one successful stop, and `no_active_timer` for the losing stops.

## Prerequisites

Install dependencies once:

```bash
cd worker && npm install
cd ../web && npm install
cd ..
```

The live check needs a local D1 database with master data and no running timer. For a fresh local database:

```bash
cd worker
npx wrangler d1 execute cf-timetracker --local --file=../db/schema.sql --yes
npx wrangler d1 execute cf-timetracker --local --file=../db/seed.sql --yes
cd ..
npm run verify
```

The gate starts its own temporary `wrangler dev --local` process on an automatically selected free loopback port, waits for `/api/bootstrap`, runs the race check, and sends `SIGTERM` during cleanup. It never stops a server it did not start. The check creates one closed test entry; remove it from the local database if a clean seed is required.

To use an already-running API without managing its lifecycle:

```bash
VERIFY_API_BASE=http://127.0.0.1:8787 npm run verify
```

That server must already have seeded clients, projects, and activities, and must have no active timer. A custom race size is available for local diagnosis:

```bash
npm run verify -- --attempts 20
```

## CI

`.github/workflows/verify.yml` runs the same `npm run verify` command on every push and pull request. CI installs the locked worker and web dependencies, creates a fresh local D1 database from `db/schema.sql` and `db/seed.sql`, then lets the gate own the local Worker lifecycle.

A failed unit test or build prevents the live check from running. A server startup failure, unexpected HTTP status, or incorrect number of running rows also fails the command with a non-zero exit code.
