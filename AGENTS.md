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
├── package.json                 # root `npm run verify` verification gate
├── .github/workflows/verify.yml # CI invocation of the verification gate
├── docs/                        # Dated docs only: YYYY-MM-DD-<topic>.md
├── db/
│   ├── schema.sql               # D1 schema (customers, projects, activities, time_entries, settings)
│   ├── migrations/              # Dated, idempotent ALTER/INDEX scripts for existing DBs
│   └── seed.sql                 # Dev seed data
├── worker/
│   ├── src/ (index.js router+REST+CORS, core.js D1 ops, mcp.js JSON-RPC)
│   ├── test/                    # node --test unit tests (`npm test`)
│   ├── package.json
│   └── wrangler.toml            # D1 binding `DB`, compat date, routes
├── web/                         # Vite + React + Tailwind Pages app
│   ├── src/ (components/, pages/, lib/, print.css)
│   │   └── lib/ (api.js, router.jsx, theme.js, colors.js, format.js, useTracker.js)
│   ├── public/_redirects        # Pages SPA fallback for deep links
│   └── package.json
├── gas/
│   ├── Code.gs                  # Apps Script receiver (TimeEntries sheet, dedupe, secret)
│   └── test/gas-receiver.test.mjs # mocked-globals harness, part of `npm run verify`
├── apps/timetracker/            # one shared Flutter client for desktop + mobile
│   ├── lib/                     # shared Dart UI/API code; no platform forks
│   ├── test/                    # shared Flutter tests
│   └── android/ ios/ linux/ macos/ windows/ # generated runners/config only
└── scripts/                     # CSV export helpers, deploy/verification checks (no secrets)
```

Do not introduce top-level folders outside this layout without updating this file.

## Dated-docs rule

- Every file in `docs/` MUST be named `YYYY-MM-DD-<kebab-topic>.md` (e.g. `2026-09-19-phased-plan.md`).
- Never write undated docs. Never version by `v2`/`final` suffixes — new date, new file; edit in place only for typos within 24h.
- The initial architecture prompt is archived, not rewritten: extend it via new dated docs.

## Stack & commands

- Runtime: Cloudflare Workers + D1 (SQLite at edge). Frontend: Vite + React + Tailwind + daisyUI, deployed on Pages. Native client: one Flutter project under `apps/timetracker/`, shared across Windows/Linux/Android and compatible with macOS/iOS runners.
- Toolchain: `wrangler`, `npm`. D1 init: `wrangler d1 execute <DB_NAME> --file=./db/schema.sql`.
- Local dev: `wrangler dev` (worker), `npm run dev` (web), `cd apps/timetracker && flutter run -d <target> --dart-define=API_BASE_URL=<worker-url>` (native). Verify worker with `curl` against `/api/bootstrap`; verify D1 with `wrangler d1 execute <DB> --command="SELECT 1"`.
- Verification gate: `npm run verify` (worker unit tests, web production build, and a managed local concurrency check). It starts/stops its own temporary Wrangler server; use `VERIFY_API_BASE=http://127.0.0.1:8787 npm run verify` to target an existing server. Details: `docs/2026-09-19-verification-gate.md`.
- Tests: `cd worker && npm test` (Node's built-in runner, no framework). The lower-level concurrency check is `node scripts/check-single-timer.mjs [apiBase] [attempts]` and requires a running, seeded API.
- No committed secrets. GAS webhook URL, Access team config, and D1 IDs go through env / `wrangler secret` / local `.dev.vars` (gitignored).

## API contract (from foundational spec — keep stable)

- `GET /api/bootstrap` → `{ activeTimer, entries[50], customers, projects, activities, projectTasks }`; `projectTasks` links project IDs to shared task/activity IDs and includes `is_default`. New projects seed `General` and `Meeting` unless `defaultTasks` overrides the list or passes `[]`.
- `POST /api/timer/start` `{ customerId, projectId, activityId, description?, tags?, hourlyRate? }` → **409** `{ error, code: "timer_running" }` if a timer is already running (previously 400 — changed 2026-09-19), 400 only for validation/unknown-FK problems
- `POST /api/timer/stop` → computes `duration_seconds`, `cost`; **404** `{ error, code: "no_active_timer" }` if none running (including a lost concurrent stop)
- `POST /api/sync/google-sheets` `{ gasWebhookUrl, filterMonth? }` → forwards non-running entries to the GAS Web App with the secret in the JSON body (`payload.secret` — GAS Web Apps do not expose request headers to `doPost`); `filterMonth` slices a UTC month
- `GET /api/summary` → `{ range, totals, rows }`; optional `?month=YYYY-MM` or `?fromMs=&toMs=` (half-open, both required together). Same aggregation as the MCP `query_summary` tool.
- `GET /api/dashboard` → detailed closed-entry aggregates `{ range, totals, by_day, by_customer, by_project, by_activity }`; accepts the same `month` or `fromMs`/`toMs` range parameters and is not limited to bootstrap's 50 recent entries. `by_customer` rows carry `customer_id` so the UI can link to detail pages.
- `GET /api/clients/:id?limit=&offset=` → `{ customer, projects (all, incl. archived), entries (closed + running, newest first, paginated limit≤200, each with customer_name), totals, paging }`; 404 for unknown ids. Backs the `/clients/:id` page.
- `GET /api/projects/:id?limit=&offset=` → `{ project (with customer_name, customer_currency, customer_rate), entries (with customer_name + activity_name), totals, by_activity (dashboard-shaped rows), paging }`; 404 for unknown ids. Backs `/projects/:id`.
- `GET /api/activities/:id?limit=&offset=` → `{ activity, entries (with customer_name + project_name), totals, by_client (dashboard-shaped rows with customer_id + per-client currency), paging }`; 404 for unknown ids. Backs `/activities/:id`.
- `POST /api/customers` `{ name, currency?, hourlyRate?, imageUrl? }` → 201; `PATCH /api/customers/:id` `{ name?, currency?, hourlyRate?, imageUrl? }`. `hourly_rate` is the client's default rate; `imageUrl` is an optional bounded client-generated `data:image/...;base64` avatar/logo stored in D1.
- `POST /api/projects` `{ customerId, name, budgetType?, rate?, imageUrl?, defaultTasks?: string[] }` → 201; `PATCH /api/projects/:id` `{ name?, customerId?, budgetType?, rate?, imageUrl? }`. A project `rate` overrides the client rate; `defaultTasks` defaults to `['General','Meeting']`, and `[]` opts out. `imageUrl` is optional bounded client-generated `data:image/...;base64` metadata stored in D1. `GET/POST/DELETE /api/projects/:id/tasks[/:taskId]` manages project task links without deleting shared activities.
- `POST /api/activities` `{ name, emoji?, imageUrl? }` → 201, duplicate name → 409; `PATCH /api/activities/:id` `{ name?, emoji?, imageUrl? }`. Emoji is limited to 8 Unicode characters; `imageUrl` is optional bounded client-generated `data:image/...;base64` metadata stored in D1.
- `POST /api/voice/parse` `{ audioBase64, mimeType }` → `{ success: true, draft }`; calls Gemini server-side using the `GEMINI_API_KEY` Worker secret, returns 503 when unconfigured, and never creates or starts a time entry. Voice drafts are reviewed in the existing timer form before the user clicks Start.
- `GET /api/entries?fromMs=&toMs=&limit=&offset=` returns stable paginated closed + running history for native period filters; `fromMs` and `toMs` are optional together and half-open.
- `PATCH /api/entries/:id` edits a closed entry's `customerId`, `projectId`, `activityId`, `description`, `tags`, `startTime`, `endTime`, and `hourlyRate`; `startTime`/`endTime` are epoch milliseconds, and the worker recalculates duration and cost from the edited time range and rate. Running entries must be stopped first.
- `POST /api/{customers|projects|activities}/:id/archive` and `/restore` soft-archive or restore master data. Bootstrap returns active records for tracker selects plus `archivedCustomers`, `archivedProjects`, and `archivedActivities` for Settings. Historical joins and time entries are never deleted.
- `GET /api/demo/status` → `{ demoMode: boolean }`. `POST /api/demo/reset` clears time entries and re-seeds the standard demo dataset (2 clients, 3 projects, 4 activities, 5 entries); guarded by `DEMO_MODE` env var, returns 403 when off.
- Master-data validation lives in `worker/src/core.js` and maps to HTTP 400 / 404 / 409 (`STATUS_CODES`). Timers resolve their rate as `hourlyRate ?? project.rate ?? customer.hourly_rate ?? 0`.
- `POST /mcp` (JSON-RPC 2.0, `2025-06-18` protocol, plain JSON response — no SSE): `initialize`, `ping`, `tools/list`, `tools/call` for `get_active_timer` / `start_timer` / `stop_timer` / `query_summary`. Unknown method/tool → `-32601`, bad params → `-32602`, business errors → `result.isError`. `query_summary` takes `month` (YYYY-MM, UTC) or `fromMs`/`toMs` (half-open) or neither (all time).
- CORS: handle `OPTIONS` 204; send `Access-Control-Allow-*` headers including `X-App-Token`. If `APP_TOKEN` is configured, native `/api/*` clients need `X-App-Token` unless the request already carries the Cloudflare Access authenticated-user header. Tighten `Allow-Origin: *` before prod (Zero Trust).

## Conventions

- **Schema changes:** edit `db/schema.sql` for fresh databases *and* add a dated, idempotent script under `db/migrations/` for existing ones (see `2026-09-19-single-running-timer.sql`).
- **Time:** `start_time`/`end_time` are Unix epoch **milliseconds**. `duration_seconds` is integer seconds; cost = `duration/3600 * rate_applied`.
- **IDs:** `crypto.randomUUID()` strings. FKs: `time_entries.customer_id/project_id/activity_id`.
- **Tags:** stored as comma-separated or JSON-array string; frontend owns parsing, worker stores opaque string.
- **Visual identity and voice:** customers/projects support optional `image_url`; activities support optional `emoji` + `image_url`. `ImagePicker` is an avatar control rendered next to each name field in Settings: it shows the stored image or an initials/emoji placeholder, reveals an edit overlay on hover/focus, and opens a dialog supporting drag & drop, clipboard paste, and file upload with a confirm step. Processing is unchanged — resize to ≤256×256 JPEG and save a bounded ≤180 KB base64 data URL in D1; remote URLs are rejected. `IdentityMark` renders the read-only image or initials/emoji fallback on dashboard/detail surfaces; both share `initialsOf()`. `POST /api/voice/parse` is a server-side Gemini draft parser; audio is not persisted and voice never has automatic billing side effects.
- **Project tasks:** `project_tasks` is the additive link table between projects and shared activities. It preserves existing `time_entries.activity_id` history, permits per-project curated task lists, and lets default tasks remain standardized across projects. A project with no links falls back to all active shared activities for backward compatibility.
- **Currency:** a client's `currency` (3-letter ISO 4217, validated by `core.js`) applies to all their rates and billed amounts; project rates inherit the client's currency. The frontend renders every amount through `formatMoney(value, currency)` (`web/src/lib/format.js`) using the catalog in `web/src/lib/currencies.js` (47 currencies with names/symbols, plus a "Custom code…" path for any other valid ISO code). Per-row amounts use the entry's own currency; aggregate figures (ledger total, dashboard, week strip) use the currency with the most billed value in the selection, which the worker now returns (`currency` on `/api/dashboard` totals and summary rows, `MIN(c.currency)` per group). Never hard-code "$" in UI copy.
- **Historical entries:** closed rows are editable through `PATCH /api/entries/:id`; duration and cost are derived values, never independently patched. The UI exposes the editor from each closed ledger row.
- **Single active timer:** enforced by the database, not by application code — `idx_entries_single_running` is a partial unique index on `time_entries(is_running) WHERE is_running = 1`. The `getActiveTimer` check in `startTimer` is a fast path for a readable error only; correctness comes from the INSERT failing with a unique violation, which is mapped to the same 409. Never add a second running-row path (e.g. an admin import) that bypasses the insert. `stopTimer` updates with `WHERE id = ? AND is_running = 1` and checks `meta.changes`, so two concurrent stops cannot both report success.
- **Print/PDF:** browser `window.print()` + `@media print` stylesheet only — no server PDF renderer. The print output is a professional timesheet with "CS Time Tracker" header, logo placeholder, summary table (client/project breakdown with hours and amounts), and detailed entries table. `web/src/print.css` handles the layout, hiding interactive chrome and forcing clean white/black output. `Ledger.jsx` includes `buildSummary()` for the summary table and print-only header/footer. Anything that should not print needs `no-print` (hidden by `web/src/print.css`, which also hides daisyUI `badge`/`status`/`alert`). Mobile print is responsive with reduced margins, smaller fonts, and hidden note column on narrow screens.
- **Routing:** slash-based client routes from `web/src/lib/router.jsx` (history API: `Link`, `usePath`, `navigate`, `matchPath`, `matchRoutes`, `useParams`) — no routing dependency. Patterns support one-segment params (`/clients/:id`). The route table lives in `web/src/App.jsx` (`ROUTES`, first match wins; parametric patterns before catch-alls): `/` or `/dashboard` = dashboard, `/timesheet` = time entry list and timer, `/clients/:id` = client detail, `/projects/:id` = project detail, `/activities/:id` = activity detail, `/settings` = settings, anything else = not-found. New screens go in `web/src/pages/`. Deep links need the Pages SPA fallback in `web/public/_redirects` (`/* /index.html 200`), which Vite copies into `dist/`. The route links are presented in the responsive left sidebar; on narrow screens the sidebar becomes a compact top navigation.
- **Detail pages:** client/project/activity detail pages share `web/src/lib/useDetailPage.js` (fetch + pagination state, reload resets offset), `web/src/components/DetailPager.jsx` (the Newer/Older bar), and `web/src/components/RankedBars.jsx` (breakdown bars; `linkRows` makes rows clickable, `barClass` keeps an accent). New detail pages should reuse all three rather than re-implementing pagination or bar charts. Detail endpoints always return archived records too — pages show an Archived badge; totals count closed entries only, history includes the running row (Ledger marks it "recording").
- **Cross-links:** ledger client/project/activity cells link to `/clients/:id`, `/projects/:id`, `/activities/:id`; dashboard by-client/by-project/by-activity bars are clickable (worker rows carry `customer_id`/`project_id`/`activity_id`); Settings rows link to the entity pages. Keep those alive when adding columns or reworking the tables.
- **Page data:** use `web/src/lib/useTracker.js` rather than fetching in `App.jsx`; each page mounts its own instance so a deep link loads only what it needs. A page must not re-implement start/stop/CRUD requests — call the wrappers in `lib/api.js` through `runAction`.
- **Settings vs tracking:** anything that configures the system (clients, projects, activities, Sheets webhook, appearance, connection info) belongs on `/settings`; the tracker page stays focused on recording and reviewing time. Actions that print keep `no-print`.
- **UI components:** the frontend uses **daisyUI 5** (`@plugin "daisyui"` in `web/src/index.css`) for buttons, cards, inputs, selects, tables, badges, alerts, stats, status dots, loading and tabs. Compose those class names directly in JSX; do **not** add new `@apply` component classes to `index.css`. Tailwind v4 only lets `@apply` reference built-in utilities, so hand-rolled component classes cannot be derived from each other (`.card-accent { @apply card }` fails the build) — that trap is why the custom layer was removed in `docs/2026-09-19-daisyui-migration.md`. `index.css` holds only: the two plugins, `@custom-variant dark`, body backdrop, the `section-title`/`live-status` utilities and the pulse keyframes.
- **Theming:** daisyUI themes selected by `data-theme` on `<html>`; `web/src/lib/theme.js` is the single writer and also toggles the `.dark` class so `dark:` utilities agree with the active theme. `system` removes `data-theme` entirely and mirrors `prefers-color-scheme` (daisyUI's `--prefersdark`), explicit light/dark set the attribute. The header toggle and the Settings Appearance group both call `applyTheme()`. Per-entity accents come from `web/src/lib/colors.js` using daisyUI tokens (`status-primary`, `badge-soft badge-accent`, `bg-info`) — add literal class strings there, since Tailwind only sees classes it can scan.
- **Sheets sync:** GAS `TimeEntries` sheet columns: `Entry ID, Date, Customer, Project, Activity, Duration (Hours), Cost, Description, Tags`. Dedupe on `Entry ID` (`gas/Code.gs`, proven by `gas/test/gas-receiver.test.mjs`). The secret travels in the JSON body (`payload.secret`) and is checked against the `SHARED_SECRET` Script Property — fail closed when unset; the `X-Gas-Secret` header is honored only as a fallback. Deploy steps: `docs/2026-09-20-deploy-runbook.md` §4.
- **MCP:** JSON-RPC 2.0 over Worker route; keep tool schemas backward-compatible; validate `customerId/projectId/activityId`. Timer mutations must go through `worker/src/core.js` so REST and MCP share one implementation — never re-implement start/stop in a handler.
- **Worker layout:** `worker/src/index.js` (router + REST + CORS), `worker/src/core.js` (D1 operations), `worker/src/mcp.js` (JSON-RPC tools).

## Definition of done (per task)

1. Code + migration (if schema) + seed/update where relevant.
2. `curl`/smoke test recorded in the PR/task note (bootstrap, start→stop cycle, sync dry-run).
3. No `*` CORS in prod path, no secrets committed, Zero Trust headers respected.
4. Dated doc updated or new dated follow-up if contract changed.

## Known gaps for agents to close (do not ignore)

- Closed: `filterMonth` implemented (UTC month slice); MCP handlers + transport decision done (`worker/src/mcp.js`, JSON-RPC POST); validation/FK checks + single-timer guard in REST and MCP via shared `worker/src/core.js`.
- Still open (owner actions, runbook: `docs/2026-09-20-deploy-runbook.md`): configure `GEMINI_API_KEY` if voice capture is wanted, prod `ALLOWED_ORIGINS` (T-W4/T-Z2), Zero Trust Access apps (T-Z1), remote D1 + deploys + prod smoke (T-Z3), and the real-Sheets acceptance of the deployed GAS Web App (T-G1–G3 E2E). Code-side: all closed — GAS receiver + dedupe + secret done with local proof; B5 closed via soft archive. Follow-ups and deferred scope live in `docs/2026-09-20-follow-ups.md`.

## Behavioral rules

- Prefer editing existing files over creating new ones. Keep Worker and frontend thin; push filtering/aggregation to SQL.
- Verify by execution. The normal project gate is `npm run verify`; it runs the worker tests, web build, and live single-timer concurrency proof. Use the lower-level `wrangler dev`/`curl` commands only when diagnosing a failure.
- When findings contradict the spec, trust executed evidence and file a new dated doc noting the discrepancy.
