# CSV import — Kimai export format is the canonical format

**Date:** 2026-09-20
**Status:** script-based import shipped (`scripts/kimai-import.mjs`); in-app UI planned below.

## Decision

The app officially supports **one import format: Kimai's own CSV export**. Anyone with data in another system (Clockify, Toggl, a spreadsheet) converts it to that column layout themselves — programmatically or by hand — then imports here. We do not maintain per-tool adapters.

Rationale: one contract to test and document; Kimai is the app's explicit reference point; the format is rich enough (currency, hourly price, tags) to carry everything the tracker models.

## The format (Kimai export CSV)

Header row required; column order free; these columns are read:

| Kimai column | Used for |
|---|---|
| `Date`, `From`, `To` | entry start/end. Naive local wall-clock, interpreted in `KIMAI_TZ` (default `Asia/Dhaka`). `To` past midnight rolls to the next day. Rows without `To` (running) are skipped |
| `Customer` | client, created when missing (exact-name match) |
| `Project` | project under its customer, created when missing |
| `Activity` | shared activity, created when missing |
| `Currency` | client's currency (existing clients keep theirs) |
| `Hourly price` | entry-level rate; cost is recomputed server-side from duration × rate |
| `Description` | entry note |
| `Tags` | stored as-is (comma/semicolon string) |

Ignored: `Duration`, `Price`, `Internal price`, `Fixed price`, `Name`, `User`, `E-mail`, `Staff number`, `Billable`, `Type`, `category`, `Account`, `Project number`, `VAT-ID`, `Order number`.

## What shipped today

- **Worker:** `POST /api/import/csv` — **one batched request carries masters + up to 1000 entries**, each entry referencing masters by NAME. The server match-or-creates the masters, dedupes rows on (project, activity, start), derives duration/cost server-side, validates every row, and inserts all clean rows in a single D1 batch (atomic). `dryRun: true` validates and reports without writing. Response: `{ imported, skipped: [{row, reason}], created, received }`. Timer starts keep using `/api/timer/start` so the single-running-timer rule is untouched.
- **`scripts/kimai-import.mjs`:** parses a Kimai export and pushes it in **chunks** (default 200 rows/request, `CHUNK` env) — a 290-row file is 2 requests, not 290. DRY_RUN previews the first chunk. Proven against the real Kimai dump: first run 290/290 across 2 batches, second run 0 imported / 290 skipped (dedupe), all inside one atomic batch per request.

## In-app UI (planned, Settings → Import)

1. **Upload** — file picker + drag & drop; parsed client-side, nothing sent yet.
2. **Preview** — first 20 mapped rows + counts ("will create 1 client, 3 projects, 87 entries; 2 rows skipped") via `POST /api/import/csv` with `dryRun: true`; skipped rows listed with reasons.
3. **Confirm** — same endpoint with `dryRun: false`; summary toast; ledger reload.
4. **Result** — per-row failures remain visible, downloadable as CSV.

The worker endpoint wraps the exact logic of `kimai-import.mjs` (match-or-create masters, server-side duration/cost, same dedupe), so script and UI never diverge.

## Converting other CSVs to the Kimai format

Document a recipe per common source (Clockify, Toggl, Excel timesheet): rename/re-map columns to `Date, From, To, Customer, Project, Activity, Currency, Hourly price, Description, Tags`, merge date+time into Kimai's two-column style, and save as UTF-8 CSV. A `convert/` folder with tiny example scripts can live under `scripts/` later.

## Idempotency

- Current: (project, activity, start) dedupe — re-running is safe.
- Planned addition: honor Kimai's exported `ID`-like column if present in future exports (new `external_id` column with a unique index) for exact re-imports.

## Out of scope

- Updating/merging existing entries on import (import only adds)
- XLSX/ODS (CSV only), >10k rows per run (split the file)
- Per-tool import adapters (convert to Kimai format instead)
