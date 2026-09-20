# CSV import — feature plan

**Date:** 2026-09-20
**Status:** planned, not yet implemented. This doc defines the contract so implementation can start without re-deciding anything. Companion tooling that exists today: `scripts/kimai-export.mjs` (pushes this tracker's data out to a Kimai instance via its API).

## Goal

Users bring a CSV file (from Kimai, Clockify, Toggl, a spreadsheet, or anywhere), upload it in Settings, preview what will happen, confirm, and get clients/projects/activities created (matched by name) plus all closed entries inserted. No code, no API tokens.

## CSV contract

Required header row; column order does not matter. Header matching is case/space-insensitive with the aliases below.

| Column | Aliases | Required | Format / rules |
|---|---|---|---|
| `Customer` | `Client`, `Kunde` | yes | Creates the client if the exact name doesn't exist |
| `Project` | — | yes | Created under its customer if missing |
| `Activity` | `Task` | yes | Created as a shared activity if missing |
| `Start Time` | `Begin` | yes | ISO 8601 (`2026-09-20 14:30`, `2026-09-20T14:30:00Z`, `20.09.2026 14:30`) |
| `End Time` | `Stop` | yes | Same formats; must be after start |
| `Description` | `Note` | no | Free text, ≤500 chars |
| `Tags` | — | no | Comma- or semicolon-separated |
| `Hourly Rate` | `Rate` | no | Number; defaults to project rate → client rate → 0 |
| `Currency` | — | no | 3-letter code, applied when **creating** a client (existing clients keep theirs) |
| `Entry ID` | `ID` | no | Dedupe key — see idempotency |

Rows with an empty End Time (a "running" row) are skipped and reported. Max file size 5 MB / 10,000 rows for v1.

## UX flow (Settings → Import)

1. **Upload** — file picker + drag & drop; parsed entirely client-side (no upload yet).
2. **Preview** — table of the first 20 rows as they will land, plus counts: "will create 2 clients, 3 projects, 4 activities, 87 entries; 3 rows will be skipped." Skipped rows list their reason (bad date, missing project, end before start).
3. **Confirm** — rows POST to the worker in one request; progress state; summary toast; ledger reload.
4. **Result** — per-row failures stay visible until dismissed, downloadable as CSV.

## Worker API

`POST /api/import/csv` — body `{ rows: [...], dryRun: boolean }`. The client parses the CSV; the worker owns the transactional logic (this keeps parsing/encoding issues out of the Worker and the same endpoint ready for future CLI use):

- Match/create masters by exact trimmed name (same logic as `resetDemoData` — resolve real ids after insert; activities.name is UNIQUE).
- Validate: required fields, parseable times, end > start, FK resolution, rate numbers, currency code validity.
- Insert entries with `crypto.randomUUID()` ids; `duration_seconds` and `cost` computed the same way as the timer path (never trusted from the CSV).
- Response: `{ created: { customers, projects, activities, entries }, skipped: [{ row, reason }] }`.
- Caps: 10,000 rows per request; worker CPU-safe (single D1 batch).

## Idempotency

- If a row carries `Entry ID`, the worker stores it in a new `external_id` column (unique index) and skips rows whose external id already exists → re-uploading the same file adds nothing.
- Without `Entry ID`: optional "skip rows matching an existing entry (same client + project + activity + start time)" checkbox, default on.

## Permissions / safety

- Import writes real data; only expose the UI section to the owner (there is no multi-user concept yet — the whole app is single-tenant).
- `dryRun: true` performs all validation and master-match resolution but writes nothing — the preview button uses it, so "what will this create?" is always accurate before committing.
- Import never touches existing rows: no updates, no deletes, no re-rates.

## Implementation phases

1. **P1 — worker endpoint + tests**: `POST /api/import/csv` with `dryRun`, `external_id` column + migration, unit tests for the matcher and validators.
2. **P2 — Settings UI**: upload → preview → confirm flow, result reporting.
3. **P3 — templates**: downloadable sample CSV (Kimai-compatible column names) and a "copy for Kimai's importer" export variant on the ledger page, so the same file can round-trip through Kimai's own CSV importer plugin.

## Explicitly out of scope (v1)

- Editing/merging existing entries on import
- Multiple currencies per client (client's currency wins)
- XLSX/ODS (CSV/TSV only), files > 10k rows (split them)
