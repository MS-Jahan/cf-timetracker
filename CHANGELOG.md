# Changelog

All notable changes. Newest first. Rules: `docs/2026-10-09-versioning.md` (SemVer, pre-1.0: `feat` = minor, `fix` = patch; docs/chore/ci do not bump).
Versions 0.1.0 to 0.15.x were assigned retroactively from commit history on 2026-10-09.

## 0.24.0 - 2026-11-17
- feat: the ledger shows each entry's time range in a new Time column (`09:30–11:00` in the default zone; `+1` when it ends on a later day, `09:30 → now` for the running entry, a small zone tag when the entry's zone differs from the default, full start/end in the tooltip)
- fix: the "Add entry" button moved next to the Ledger heading as the primary action instead of floating between the title and the filters

## 0.23.0 - 2026-11-17
- feat!: one time zone for all day/month logic. A default zone lives in the database (`settings.default_timezone`, seeded `Asia/Dhaka`, changeable in Settings) and every entry records its own zone (`time_entries.timezone`, NULL = default). Day and month grouping, the dashboard's per-day bars, the week strip, summaries, Sheets sync dates and the MCP `query_summary` now all use the default zone instead of a mix of UTC and the browser's zone. Migration `2026-11-17-entry-timezone.sql` must be applied to both live D1s before deploying.
- feat: API/MCP accept an optional `timezone` on entry create/edit/timer start; MCP times without an offset (`2026-11-16T09:30`) are now accepted and read in that zone (else the entry's own zone for edits, else the default); `list_entries` returns each entry's `timezone` and `start_local`/`end_local`; `list_catalog` returns `defaultTimezone`. `GET /api/bootstrap` adds `settings.defaultTimezone`; new `PATCH /api/settings`
- feat: web edit form has a Time zone field (default: the entry's saved zone; changing it keeps the exact moment); creating an entry uses the default zone; Settings has a Time zone section
- note: entry `version` hashes now include the zone, so one stale edit made across the upgrade gets a 409 and reloads

## 0.22.0 - 2026-11-16
- feat: manual time entry in the web app - an "Add entry" button on the Timesheet opens the entry editor in create mode (client, project, task, start, end, note, tags, rate) and creates a closed entry
- feat: MCP covers the whole day-to-day workflow without the dashboard. New tools: `list_catalog` (client/project/activity ids), `list_entries`, `add_time_entry` (start + end or `durationMinutes`), `update_time_entry` (also stops a forgotten running timer via `endTime`), `delete_time_entry`, `create_customer`, `create_project`, `create_activity`. Times are epoch ms or ISO 8601 with a UTC offset (offset-less ISO is rejected). The original four tools are unchanged. Plan: `docs/2026-11-16-manual-entry-and-mcp-tools.md`

## 0.21.0 - 2026-11-12
- feat!: BREAKING: username + password authentication replaces Cloudflare Zero Trust reliance. Every `/api/*` route except `/api/auth/status|login|setup|logout` and `/api/demo/status` - and `POST /mcp` - now requires a session (HttpOnly `tt_session` cookie for the web, `Authorization: Bearer` for native/scripts) or a personal API token. `APP_TOKEN`/`X-App-Token` and the `Cf-Access-Authenticated-User-Email` bypass are removed. Passwords: HMAC(`AUTH_PEPPER`) + PBKDF2-SHA256 with per-user salt. New tables via migration `2026-11-12-auth.sql` (apply to both live D1s before deploying). New secrets `AUTH_PEPPER` (required) and `SETUP_TOKEN` (first account).
- feat: personal API tokens (scope `mcp` or `full`) for MCP clients such as Claude Code (`claude mcp add --transport http ... --header "Authorization: Bearer ttp_..."`); `GET /mcp` answers 405
- feat: web sign-in/first-account screens, sign out, password change, API token management in Settings; Flutter sign-in screen with secure token storage
- feat: authed reads send `Cache-Control: private, no-cache`; the 304 path authenticates first
- feat: the demo deployment (`DEMO_MODE="true"`) is open: no accounts, no login screen, no API tokens, MCP and Sheets sync disabled (`code: "demo_mode"`), full add/edit/delete otherwise. A daily cron (`[env.demo.triggers]`, 03:00 UTC) wipes clients, projects, activities and entries and re-seeds the sample set; `POST /api/demo/reset` now does the same full wipe. `AUTH_PEPPER`/`SETUP_TOKEN` are not needed on the demo. Abuse limits (`worker/src/demo-limits.js`): 60 writes per IP per 10 min (`DEMO_WRITE_LIMIT`), 3 resets per IP per hour (`DEMO_RESET_LIMIT`), row caps (300 entries, 30 clients, 60 projects, 30 activities) answering 409 `demo_limit_reached`, CSV import disabled; 429 `demo_rate_limited` carries `Retry-After`

## 0.20.0 - 2026-10-09
- feat: read scaling phases 3-4 - `ETag: "rev-N"` + 304 on every API read (one settings row instead of re-running queries); entries carry a `version` and PATCH/DELETE accept `ifVersion`, answering 409 `entry_changed` with the latest entry when another device edited first; the editor reopens on the latest version instead of overwriting

## 0.19.0 - 2026-10-09
- feat: read scaling phase 2 - the ledger and print page load only the selected local month (and client/project) from the server as lean rows; period picker built from `GET /api/entries/bounds`; keyset paging (`before`), `customerId`/`projectId`/`activityId` filters on `GET /api/entries`; composite indexes (migration `2026-10-09-read-scaling-p2.sql`, optional for correctness)

## 0.18.1 - 2026-10-09
- fix: read scaling phase 1 - history no longer refetched on every bootstrap refresh; `data_rev` counter + `GET /api/rev` let a returning tab detect other-device changes with one row read; `GET /api/entries` counts only on the first page and reports `has_more`; index on `time_entries(activity_id)`

## 0.18.0 - 2026-10-09
- feat: billing currency is stored on each entry (migration `2026-10-09-entry-currency.sql`); changing a client or project currency no longer relabels history; summaries, rates and printed totals are per currency

## 0.17.0 - 2026-10-09
- feat: printed timesheet gets an Hourly rate(s) table built from billed entry rates; Project and Dates worked columns appear only when rates differ by project or change within the period

## 0.16.1 - 2026-10-09
- fix: client detail page crashed (`setLoading is not defined`); removed leftover duplicate fetch effect

## 0.16.0 - 2026-10-09
- feat: versioning: SemVer rules, CHANGELOG, version shown on printed reports

## 0.15.0 - 2026-10-09
- feat: compact period range, lowercase cf-timetracker brand

## 0.14.0 - 2026-10-09
- feat: print header polish, date format settings, clickable notes

## 0.13.3 - 2026-10-09
- fix: rebalance details columns, keep total+footer together

## 0.13.2 - 2026-10-09
- fix: dedicated details table, fixed summary rule and footer

## 0.13.1 - 2026-09-22
- fix: kebab menu rendered off-view; page-enter transform trapped fixed elements

## 0.13.0 - 2026-09-22
- feat: row actions menu, delete, duplicate, editable running timer

## 0.12.0 - 2026-09-21
- feat: continue a past task via hover play button

## 0.11.1 - 2026-09-21
- fix: remove .wrangler deploy config before Pages deploy

## 0.11.0 - 2026-09-21
- feat: Gemini key fallback list via GEMINI_API_KEYS

## 0.10.2 - 2026-09-21
- fix: D1 commands target the DB binding, not the demo database name

## 0.10.1 - 2026-09-21
- fix: white rounded backing behind logo and favicon

## 0.10.0 - 2026-09-20
- feat: logo, favicon, banner; strip em dashes everywhere

## 0.9.1 - 2026-09-20
- fix: tables fit the page, total once, BDT amounts complete

## 0.9.0 - 2026-09-20
- feat: dedicated /print page for timesheet printing

## 0.8.1 - 2026-09-20
- fix: audit round 2 - periods, ledger history, currency, layout

## 0.8.0 - 2026-09-20
- feat: batched CSV import endpoint, chunked importer

## 0.7.0 - 2026-09-20
- feat: POST /api/entries + Kimai CSV import script

## 0.6.0 - 2026-09-20
- feat: Kimai export tool; plan CSV import feature

## 0.5.3 - 2026-09-20
- fix: layout spread, dropdown overlap, settings forms, emoji picker

## 0.5.2 - 2026-09-20
- fix: demo flag compares exact string, personal instance live

## 0.5.1 - 2026-09-20
- fix: resolve master ids by name in demo reset

## 0.5.0 - 2026-09-20
- feat: Flutter shared client

## 0.4.0 - 2026-09-20
- feat: Google Sheets receiver with dedupe

## 0.3.0 - 2026-09-20
- feat: Kimai-lite tracker UI on Pages

## 0.2.0 - 2026-09-20
- feat: REST API + MCP server on D1

## 0.1.0 - 2026-09-20
- feat: D1 schema, migrations, seed data
