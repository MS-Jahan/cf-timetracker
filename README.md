# cf-timetracker

Kimai-style time tracker running entirely on Cloudflare's free tier: **Pages** (Vite + React + Tailwind) → **Worker** (REST + MCP) → **D1** (SQLite at the edge), with optional **Google Sheets sync** and **Gemini voice capture**. A shared **Flutter** client covers desktop and mobile.

🌍 **Live demo:** [https://cf-timetracker.pages.dev](https://cf-timetracker.pages.dev) — sample data included, reset anytime.

## Features

- **One-click timer** with a database-enforced single-running-timer guarantee (partial unique index — two tabs can't both start)
- **Billable ledger**: closed entries with client/project/activity, tags, rates, editable history; per-entry currency
- **Dashboards**: daily activity, by-client / by-project / by-activity breakdowns with clickable detail pages (`/clients/:id`, `/projects/:id`, `/activities/:id`)
- **Master data**: clients (currency, default rate), projects (fixed/hourly budgets, per-project curated task lists), activities (emoji, avatars)
- **47 currencies** with per-client currency and aggregate-currency rollups
- **Print/PDF timesheet**: professional `window.print()` output with summary tables — no server renderer
- **MCP server** (`POST /mcp`, JSON-RPC 2.0): `get_active_timer`, `start_timer`, `stop_timer`, `query_summary` — wire the tracker into Claude or any MCP client
- **Google Sheets sync**: Apps Script receiver with Entry-ID dedupe and shared-secret auth
- **Voice capture**: Gemini turns a short recording into a reviewable timer draft (server-side key, nothing persisted)
- **Demo mode**: splash screen, demo banner, one-click reset to a seeded dataset
- **Theming**: daisyUI 5 light/dark/system, IBM Plex type, responsive down to phone width

## Architecture

```
Browser / Flutter app
        │  REST /api/*  ·  MCP /mcp
        ▼
Cloudflare Worker (cf-timetracker-api)
  ├── src/index.js   router + REST + CORS
  ├── src/core.js    shared D1 operations (REST and MCP both call these)
  └── src/mcp.js     JSON-RPC 2.0 tool layer
        ▼
Cloudflare D1 (SQLite) ── time_entries, customers, projects, activities, project_tasks
        │
        └──► Google Apps Script webhook (Sheets sync, dedupe on Entry ID)
```

- **Single source of truth for mutations**: `core.js`. Timer start/stop, validation, FK checks — REST and MCP share one implementation.
- **Correctness in the database**: `idx_entries_single_running` is a partial unique index on `is_running`; concurrency bugs surface as 409s, not double timers.
- **Times are epoch milliseconds**; duration/cost are derived, never hand-edited.
- **History is never deleted**: master data archives softly (`archived_at`), old entries keep their joins.

## Repo layout

```
├── worker/          Cloudflare Worker: REST + MCP API, wrangler.toml, node --test suite
├── web/             Vite + React 19 + Tailwind 4 + daisyUI 5 frontend (Pages)
├── db/              schema.sql, seed.sql, dated idempotent migrations
├── gas/             Google Apps Script receiver + mocked-globals tests
├── apps/timetracker/  Flutter client (Windows/Linux/Android, macOS/iOS runners)
├── scripts/         verify gate, concurrency proof, demo seed
├── docs/            dated design/deploy docs (YYYY-MM-DD-topic.md)
└── .github/         CI: verify gate + Flutter builds
```

## Quick start (local)

```bash
# 1. API
cd worker
npm install
npx wrangler d1 execute cf-timetracker --local --file=../db/schema.sql
npm run dev                       # http://localhost:8787

# 2. UI
cd ../web
npm install
npm run dev                       # http://localhost:5173 (API base defaults to :8787)
```

Demo data: `POST http://localhost:8787/api/demo/reset` with `DEMO_MODE=true` in `wrangler.toml`, or `node scripts/seed-demo.mjs`.

## Testing

```bash
npm run verify            # full gate: worker tests + web build + live single-timer concurrency proof
cd worker && npm test     # unit tests only (Node built-in runner)
```

The concurrency proof (`scripts/check-single-timer.mjs`) starts its own Wrangler server, fires parallel starts, and asserts exactly one 200 with the rest 409.

## Deploy

Full runbooks: [`docs/2026-09-20-demo-deploy.md`](docs/2026-09-20-demo-deploy.md) (demo — what this repo currently runs) and [`docs/2026-09-20-deploy-runbook.md`](docs/2026-09-20-deploy-runbook.md) (production + Zero Trust + rollback). Short version:

```bash
cd worker && npx wrangler deploy
cd ../web && VITE_API_BASE=https://<worker-url> npm run build \
  && npx wrangler pages deploy dist --project-name cf-timetracker --force
```

Secrets (optional): `npx wrangler secret put GAS_SECRET` (Sheets sync) and `GEMINI_API_KEY` (voice). Nothing secret is committed; local overrides live in `.dev.vars` (gitignored).

## API sketch

| Endpoint | Purpose |
|---|---|
| `GET /api/bootstrap` | active timer + recent entries + all master data in one round trip |
| `POST /api/timer/start` / `stop` | 409 `timer_running` / 404 `no_active_timer` on races |
| `GET /api/dashboard`, `/api/summary` | aggregates with month or `fromMs`/`toMs` range |
| `GET/POST/PATCH /api/customers|projects|activities` | master-data CRUD + `:id/archive`, `:id/restore` |
| `PATCH /api/entries/:id` | edit closed entries; duration/cost recomputed server-side |
| `POST /api/demo/reset` | re-seed demo dataset (403 unless `DEMO_MODE=true`) |
| `POST /mcp` | JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call` |

## Docs

Everything is documented in dated files under `docs/` — architecture, phased plan, design passes, deploy runbooks, follow-ups. Start at `docs/2026-09-19-initial-prompt-system-architecture.md`.

## License

Private project. All rights reserved.
