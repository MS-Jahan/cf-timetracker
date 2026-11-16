# Time zones: one default, per-entry zone - 2026-11-17

## Problem
Times are stored as epoch milliseconds (zone-neutral), but the zone used to *read* them was inconsistent: the entry editor and ledger used the browser's zone, while server summaries, the dashboard's per-day bars, the week strip and the MCP `query_summary` used UTC. One entry could therefore fall on different days or months on different screens (Dhaka 02:00 on the 16th is the 15th in UTC).

## Decisions (from the owner)
1. A **default time zone** lives in the database (`settings.default_timezone`, IANA name) and governs all day/month logic and display for every entry.
2. **Each entry stores its own zone** (`time_entries.timezone`, nullable IANA name). NULL means "the default".
3. API and MCP accept an **optional `timezone`** when adding/editing/starting entries.
4. Web: **no zone field when creating** an entry (it uses the default). The **edit form has a Time zone field**, defaulting to the entry's saved zone.
5. Default zone for existing data and for new databases: **`Asia/Dhaka`** (the owner's zone; changeable in Settings).

Version: feat = minor, **0.23.0**. Schema change: **migration required on both live D1s before deploy**.

## Shared helper (done)
`worker/src/tz.js` (pure Intl, tested by `worker/test/tz.test.js`) is copied byte-for-byte to `web/src/lib/tz.js`; a test enforces they stay identical. API: `isValidTimezone`, `epochToWall`, `zoneOffsetMs`, `wallToEpoch`, `dayKey`, `monthKey`, `monthRangeMs`, `parseLocalIso`, `formatOffsetIso`. **Do not edit either copy** (if a change is truly needed, edit the worker one and `cp` it to web).

## Contract
- DB: `ALTER TABLE time_entries ADD COLUMN timezone TEXT;` and `INSERT OR IGNORE INTO settings (key, value) VALUES ('default_timezone', 'Asia/Dhaka');` in `db/migrations/2026-11-17-entry-timezone.sql` (header comment like `2026-10-09-entry-currency.sql`: ALTER is not repeatable; the INSERT is). Mirror both in `db/schema.sql` (column in the `time_entries` CREATE; the settings row can be an `INSERT OR IGNORE` at the end).
- `GET /api/bootstrap` adds `settings: { defaultTimezone }`. New `PATCH /api/settings` `{ defaultTimezone }` -> `200 { success: true, settings }`, `400` for an invalid IANA name. Normal auth; mutating (bumps `data_rev`).
- Entry objects (list, bootstrap, detail, POST/PATCH responses) carry `timezone` (string or null). `entryVersion` includes it.
- `POST /api/entries`, `PATCH /api/entries/:id`, `POST /api/timer/start` accept optional `timezone` (validated; invalid -> 400). When omitted on create/start, the default zone **at that moment** is stored. REST time fields stay epoch ms.
- Aggregations use the default zone: `month=YYYY-MM` (summary, dashboard, MCP) means that calendar month in the default zone (`monthRangeMs`); `by_day` groups by `dayKey(start_time, defaultTz)`.

## Part A - worker (`worker/`, `db/`)
1. Migration + `schema.sql` as above.
2. `core.js`: `getDefaultTimezone(env)` (setting, validated, fallback `"UTC"`), `setDefaultTimezone(env, tz)`; `createTimeEntry`, `updateTimeEntry` (add `timezone` to `ENTRY_FIELDS`), `startTimer` store/validate `timezone`; `entryVersion` includes `row.timezone ?? null`; `monthRange` -> zone-aware using `monthRangeMs` (callers pass the default tz; keep the exported shape `{startMs,endMs}` working for existing callers/tests, adding a `tz` parameter); `queryDashboard` `by_day` computed from rows with `dayKey` in the default zone (the SQL `date(...,'unixepoch')` grouping is replaced; other groupings stay SQL).
3. `index.js`: bootstrap `settings`, `PATCH /api/settings`; pass `timezone` through the entry routes. Demo mode: the settings route works (rate limited like other writes).
4. `mcp.js`: optional `timezone` on `add_time_entry`, `update_time_entry`, `start_timer` (stored), `list_entries` (affects reading `fromTime`/`toTime`). **Offset-less ISO is now accepted** and read in `timezone` (else the default zone); ISO with an offset or epoch ms are instants. `list_entries` returns each entry's `timezone` (effective: stored ?? default) plus `start_local`/`end_local` (`formatOffsetIso` in that zone). `list_catalog` includes `defaultTimezone`. `query_summary` `month` uses the default zone. Existing four tools stay backward compatible. Update the existing test that expected offset-less ISO to be rejected.
5. Tests: `core`/HTTP tests for settings GET/PATCH + validation, entry `timezone` round-trip and default-at-creation, month boundaries in `Asia/Dhaka` (an entry at 02:00 local on the 1st belongs to that month, not the previous), `by_day` grouping in the default zone, MCP offset-less ISO read in the default and in an explicit zone, `list_entries` local fields. `npm test` and `npm run verify` pass.

## Part B - web (`web/src/`)
1. Load `settings.defaultTimezone` with bootstrap (via `useTracker`) and keep it in a small module `lib/time.js` (`setDefaultTimezone`, `getDefaultTimezone`; fallback `"UTC"` until loaded) built on `lib/tz.js`. Everything that reads a calendar day, month, "today", weekday or wall-clock time from an instant must use the default zone through this module, **not** the browser zone and not UTC. Call sites to convert: `lib/format.js`, `lib/dateFormat.js`, `lib/periods.js`, `lib/rates.js`, `components/Ledger.jsx`, `components/WeekStrip.jsx`, `pages/DashboardPage.jsx` (and any other `new Date(`, `toLocale*String`, `getHours/getDate/getMonth/getFullYear/getTimezoneOffset`, `Date.UTC`, `toISOString().slice` use that derives a day/month/clock from an instant). `ApiTokensPanel.jsx` token dates may stay browser-local. The `month=` query values the web sends must be consistent with the server (default zone).
2. Settings page: a **Time zone** section: current default, a select/datalist of zones (`Intl.supportedValuesOf("timeZone")` with fallback to a short list), a button "Use this browser's zone (<name>)", saved with `PATCH /api/settings` (new wrapper in `lib/api.js` through `runAction`). Show the zone's current offset.
3. `EntryEditor.jsx`: in **edit** mode add a **Time zone** field defaulting to `entry.timezone ?? defaultTimezone`; start/end text is shown and parsed in the selected zone; changing the zone keeps the instants and re-renders the fields; the patch includes `timezone`. In **create** mode there is no zone field: times are read in the default zone and `timezone: <default>` is sent.
4. Timer start sends no zone (server stores the default).
5. `npm run build` passes. No browser testing.

## Docs / release (orchestrator)
`AGENTS.md` (contract + conventions), `README.md`, `CHANGELOG.md` 0.23.0, root `package.json` 0.23.0, deploy steps doc (new migration for **both** D1s: personal `timetracker`, demo `cf-timetracker`).
