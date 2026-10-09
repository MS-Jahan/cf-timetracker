# Per-entry currency (2026-10-09)

Release 0.18.0. Schema + API data change (additive).

## Problem
`time_entries` stored the billed rate (`rate_applied`) but not its currency; every read joined `customers.currency`. Changing a client's currency relabelled all historical amounts (`250.00` USD became `250.00` BDT without conversion). Projects also carry an optional `currency` that entry/dashboard/print queries ignored.

## Decision
Freeze the currency on each entry when it is recorded, like the rate:
`entry.currency = project.currency ?? customer.currency` at start/create/import; re-resolved only when an edit changes the entry's client or project. Editing times, note, tags or rate keeps it.

## Changes
- `db/schema.sql`: `time_entries.currency TEXT` (nullable). Migration `db/migrations/2026-10-09-entry-currency.sql` adds it and backfills `COALESCE(project.currency, customer.currency)` for existing rows (history already overwritten cannot be recovered).
- `worker/src/core.js`: `resolveCurrency`; stored in `startTimer`, `createTimeEntry`, `updateTimeEntry` (on client/project change), `importCsvBatch`. All reads use `COALESCE(te.currency, c.currency)` (NULL-safe for rows from older seeds). Summary/dashboard/detail breakdowns group by currency, so a client that switched currency shows one row per currency.
- Web: `buildSummary`, `buildRateRows`, totals rows and the header Amount are per currency (`BDT 7,013.33 + $120.00`; one Total row per currency). Settings warns that currency changes affect only new entries.

## Not changed
- Dashboard `by_day` and the headline totals still add raw numbers across currencies (no conversion, no per-currency split there). The dominant currency label is kept. Follow-up if mixed-currency dashboards matter.
- `seed.sql` / demo reset insert NULL currency; reads fall back to the client's.

## Verification
Worker unit tests (insert carries currency; edit re-resolves only on client/project change), migration + backfill run on a local D1, then end-to-end: change a client's currency and confirm old entries keep their currency in `/api/bootstrap`, ledger and print.

## Rollout incident (2026-10-09)
0.18.0 was deployed by CI before the migration was applied to the live D1 databases, so every entry query failed with `no such column: te.currency`. The demo database was additionally missing `projects.currency` (migration `2026-09-20-project-currency.sql` had never been applied there), which made the first attempt at the new migration fail and roll back. Fix: apply `2026-09-20-project-currency.sql` then `2026-10-09-entry-currency.sql` to each live D1, in that order, skipping any already applied. Rule added to `AGENTS.md` (Schema changes): migrate every live D1 before pushing a schema change.
