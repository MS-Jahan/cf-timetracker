# AGENTS.md — cf-timetracker (Kimai-Lite on Cloudflare)

This file guides coding agents working in this repo. Follow it unless the user overrides.

## Project snapshot

Kimai-style time tracker: **Cloudflare Pages (Vite + React + Tailwind)** → **Cloudflare Worker (REST + MCP JSON-RPC)** → **Cloudflare D1 (SQLite)** → optional **Google Sheets sync via Apps Script webhook**. Protected by **Cloudflare Zero Trust Access**.

Foundational spec: `docs/2026-09-19-initial-prompt-system-architecture.md`
Delivery plan: `docs/2026-09-19-phased-plan.md`
Checkable work items: `docs/2026-09-19-task-list.md`
Design deliberation: `docs/2026-09-19-brainstorm-notes.md`

## Repo layout (target — create as phases land)

```
/
├── AGENTS.md
├── docs/                        # Dated docs only: YYYY-MM-DD-<topic>.md
├── db/
│   ├── schema.sql               # D1 schema (customers, projects, activities, time_entries, settings)
│   └── seed.sql                 # Dev seed data
├── worker/
│   ├── worker.js (or src/)      # REST + MCP handlers, CORS, Sheets forwarding
│   ├── package.json
│   └── wrangler.toml            # D1 binding `DB`, compat date, routes
├── web/                         # Vite + React + Tailwind Pages app
│   ├── src/ (components, pages, lib/api.js, print.css)
│   └── package.json
├── gas/
│   └── Code.gs                  # Apps Script receiver (TimeEntries sheet)
└── scripts/                     # CSV export helpers, deploy checks (no secrets)
```

Do not introduce top-level folders outside this layout without updating this file.

## Dated-docs rule

- Every file in `docs/` MUST be named `YYYY-MM-DD-<kebab-topic>.md` (e.g. `2026-09-19-phased-plan.md`).
- Never write undated docs. Never version by `v2`/`final` suffixes — new date, new file; edit in place only for typos within 24h.
- The initial architecture prompt is archived, not rewritten: extend it via new dated docs.

## Stack & commands

- Runtime: Cloudflare Workers + D1 (SQLite at edge). Frontend: Vite + React + Tailwind, deployed on Pages.
- Toolchain: `wrangler`, `npm`. D1 init: `wrangler d1 execute <DB_NAME> --file=./db/schema.sql`.
- Local dev: `wrangler dev` (worker), `npm run dev` (web). Verify worker with `curl` against `/api/bootstrap`; verify D1 with `wrangler d1 execute <DB> --command="SELECT 1"`.
- No committed secrets. GAS webhook URL, Access team config, and D1 IDs go through env / `wrangler secret` / local `.dev.vars` (gitignored).

## API contract (from foundational spec — keep stable)

- `GET /api/bootstrap` → `{ activeTimer, entries[50], customers, projects, activities }`
- `POST /api/timer/start` `{ customerId, projectId, activityId, description?, tags?, hourlyRate? }` → 400 if a timer is already running
- `POST /api/timer/stop` → computes `duration_seconds`, `cost`; 404 if none running
- `POST /api/sync/google-sheets` `{ gasWebhookUrl, filterMonth? }` → forwards non-running entries; `filterMonth` is currently unimplemented (see task list T-W3)
- `POST /mcp` (JSON-RPC 2.0): `tools/list`, `tools/call` for `get_active_timer` / `start_timer` / `stop_timer` / `query_summary`
- CORS: handle `OPTIONS` 204; send `Access-Control-Allow-*` headers. Tighten `Allow-Origin: *` before prod (Zero Trust).

## Conventions

- **Time:** `start_time`/`end_time` are Unix epoch **milliseconds**. `duration_seconds` is integer seconds; cost = `duration/3600 * rate_applied`.
- **IDs:** `crypto.randomUUID()` strings. FKs: `time_entries.customer_id/project_id/activity_id`.
- **Tags:** stored as comma-separated or JSON-array string; frontend owns parsing, worker stores opaque string.
- **Single active timer:** enforced server-side (`is_running = 1` uniqueness check). Never rely on client-only gating.
- **Print/PDF:** browser `window.print()` + `@media print` stylesheet only — no server PDF renderer.
- **Sheets sync:** GAS `TimeEntries` sheet columns: `Entry ID, Date, Customer, Project, Activity, Duration (Hours), Cost, Description, Tags`. Dedupe on `Entry ID` (not yet in spec snippet — required, see T-G2).
- **MCP:** JSON-RPC 2.0 over Worker route; keep tool schemas backward-compatible; validate `customerId/projectId/activityId`.

## Definition of done (per task)

1. Code + migration (if schema) + seed/update where relevant.
2. `curl`/smoke test recorded in the PR/task note (bootstrap, start→stop cycle, sync dry-run).
3. No `*` CORS in prod path, no secrets committed, Zero Trust headers respected.
4. Dated doc updated or new dated follow-up if contract changed.

## Known gaps for agents to close (do not ignore)

- `filterMonth` accepted but unused; GAS has no dedupe/auth; MCP snippet lacks `stop_timer`/`start_timer`/`query_summary` handlers + transport choice (SSE vs Streamable HTTP); no CRUD for customers/projects/activities; no validation/FK checks; `Allow-Origin: *` vs Zero Trust conflict. All tracked in `docs/2026-09-19-task-list.md`.

## Behavioral rules

- Prefer editing existing files over creating new ones. Keep Worker and frontend thin; push filtering/aggregation to SQL.
- Verify by execution (`wrangler dev`, `curl`, `npm run build`) before claiming done.
- When findings contradict the spec, trust executed evidence and file a new dated doc noting the discrepancy.
