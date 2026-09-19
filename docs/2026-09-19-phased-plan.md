# Phased Delivery Plan — cf-timetracker

**Date:** 2026-09-19
**Spec:** `2026-09-19-initial-prompt-system-architecture.md`
**Brainstorm:** `2026-09-19-brainstorm-notes.md`
**Tasks:** `2026-09-19-task-list.md`
**Status:** Plan of record; change via new dated doc, not edits after 24h.

## Objective

Ship a production-usable Kimai-lite tracker on Cloudflare (Pages + Worker + D1 + GAS sync + MCP + Zero Trust) in thin vertical slices, each smoke-tested before the next begins.

## Phase 0 — Repo scaffolding & docs (done, verify)

- **Goal:** dated docs + `AGENTS.md` + empty target layout exist.
- **Exit:** `docs/2026-09-19-*.md` (4 files) + `AGENTS.md` committed; `db/ worker/ web/ gas/ scripts/` placeholders or `.gitkeep`.
- **Verify:** `ls docs`, filenames match `YYYY-MM-DD-<kebab>.md`.

## Phase 1 — D1 schema, seed, toolchain

- **Goal:** versioned `db/schema.sql` + `db/seed.sql`, working `wrangler d1` loop.
- **Work:** port schema from spec; add FK enforcement note (`PRAGMA foreign_keys = ON` per connection); dev seed (2 customers, 3 projects, 4 activities, 5 closed entries + 0 running); document `wrangler d1 execute` + `SELECT 1` check.
- **Exit:** fresh D1 created from `schema.sql`, seeded, `idx_*` present.
- **Verify:** `wrangler d1 execute <DB> --command="SELECT count(*) FROM time_entries"`.

## Phase 2 — Worker REST API (core value)

- **Goal:** `GET /api/bootstrap`, `POST /api/timer/start`, `POST /api/timer/stop`, `POST /api/sync/google-sheets`, CORS `OPTIONS`.
- **Work:**
  - `worker/wrangler.toml` (D1 binding `DB`, compat date, `ALLOWED_ORIGINS` var).
  - Router + `jsonResponse`/`handleCors` from spec.
  - Validation: required IDs, FK existence, `hourlyRate` fallback (`project.rate → customer.hourly_rate → 0`).
  - Single-timer guard (400), stop with no timer (404), duration/cost math in seconds.
  - Implement `filterMonth` (`YYYY-MM`, UTC month slice on `start_time`); GAS forward with timeout + error surfacing.
  - Env-driven CORS (no `*` in prod).
- **Exit:** full start → stop → bootstrap cycle via `curl` against `wrangler dev`.
- **Verify:** recorded `curl` transcript: bootstrap empty → start 200 → start again 400 → stop 200 → bootstrap shows entry.

## Phase 3 — MCP server (`POST /mcp`)

- **Goal:** JSON-RPC 2.0 `tools/list` + `tools/call` for all four tools.
- **Work:** implement `get_active_timer`, `start_timer` (validated), `stop_timer`, `query_summary` (date-range GROUP BY customer/project, totals + cost); JSON-RPC error envelopes (`-32602`, `-32601`, `-32603`); decide/scaffold SSE or Streamable HTTP only if a target client demands it.
- **Exit:** `curl` `tools/list` + `tools/call` for each tool green.
- **Verify:** start via MCP → `get_active_timer` shows running → stop via MCP → `query_summary` includes entry.

## Phase 4 — Web UI (Kimai-lite on Pages)

- **Goal:** tracker bar, entries table, filters, CSV, print/PDF, Sheets button, wiring to Worker.
- **Work:** Vite + React + Tailwind scaffold; `lib/api.js` (bootstrap/start/stop/sync); live tick display-only; filter controls (month/customer/project); CSV export client-side; `print.css` from spec + screen-hidden print header; empty/loading/error states; `VITE_API_BASE` env.
- **Exit:** UI drives full timer cycle + CSV + print preview against local Worker.
- **Verify:** `npm run build` clean; manual smoke transcript in task note.

## Phase 5 — Google Apps Script sync E2E

- **Goal:** reliable Worker → GAS → Sheet rows without duplicates.
- **Work:** `gas/Code.gs` (header creation, `Entry ID` dedupe, shared-secret check, JSON responses); Worker passes secret header; month-filtered payload; doc Sheet columns + deploy steps (Execute as Me / Anyone).
- **Exit:** two consecutive syncs of same month produce zero new rows the second time.
- **Verify:** sync → Sheet count N → re-sync → still N; error case (bad secret) logged.

## Phase 6 — Zero Trust, hardening, prod deploy

- **Goal:** locked-down prod on custom domains.
- **Work:** Access Application + policy (`@yourcompany.com` / allowlist, PIN or Google); validate `Cf-Access-Authenticated-User-Email` passthrough; prod CORS allowlist; `wrangler secret` for GAS URL/secret; Pages + Worker deploys; custom domains.
- **Exit:** unauthenticated browser blocked by Access; API serves UI origin only.
- **Verify:** prod `curl` bootstrap 200 from allowed origin, Access challenge from incognito.

## Phase 7 — QA, edge cases, handover

- **Goal:** trustworthy timesheets.
- **Work:** double-click/double-tab timer test, stop-with-none, timezone/month-boundary entries, long-running timer display, CSV/print spot-check vs DB totals, MCP schema compat check; record all transcripts; file follow-up dated doc for anything deferred (multi-user, invoicing, fixed-budget burn-down).
- **Exit:** task list all checked; known limitations documented, not silently dropped.

## Milestones & dependencies

```
P0 docs ──▶ P1 D1 ──▶ P2 Worker REST ──┬──▶ P3 MCP
                                          └──▶ P4 Web UI ──▶ P5 GAS E2E ──▶ P6 Zero Trust/prod ──▶ P7 QA
```

P3 and P4 can run in parallel after P2. P5 needs P2's sync endpoint. P6 needs P2 + P4.

## Out of scope (v1)

Multi-tenancy/`user_id`, team roles, invoicing/tax, offline queue, native mobile, advanced reporting dashboards. Propose via new dated doc if needed.
