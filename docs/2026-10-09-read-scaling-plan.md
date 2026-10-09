# Read scaling and multi-device freshness plan (2026-10-09)

Status: **Phase 1 shipped in 0.18.1**; phases 2-4 are plans only. Phases ship as separate releases under `docs/2026-10-09-versioning.md`.

## 1. Why

The D1 dashboard for the personal instance showed 554 queries / 202k rows read in 24 h after light use (about 312 entries). That is harmless today (~4 % of the free 5M reads/day), but the read cost grows with total history, not with what is on screen:

| Step on opening Time entries | ~312 entries today | ~11k entries (5 years at ~6/day) |
|---|---|---|
| `fetchAllEntries()` pages through all history, 200/page | 2 requests | 55 requests |
| `listEntries` runs `SELECT COUNT(*)` on every page | ~600 rows | ~600k rows |
| `LIMIT/OFFSET` re-reads skipped rows | small | ~300k rows |
| Each row joins customers/projects/activities (~4 reads/row) | ~1.3k rows | ~44k rows |
| **Total per page open** | **~2.5k** | **~1M** |

Aggravating factors in the current code:
- `TrackerPage.jsx` (`useEffect(() => reloadHistory(), [reloadHistory, tracker.entries])`) refetches the whole history after every start/stop/edit, because each action refreshes bootstrap and changes `tracker.entries`.
- Month/client/project filters are applied in the browser after downloading everything.
- `PrintPage.jsx` also downloads the full history to print one month.
- Dashboard "All time" rescans every closed entry in five aggregate queries per load.
- No index on `time_entries.activity_id`; `ORDER BY start_time DESC, id DESC` has only a single-column `start_time` index.

Goal: cost per view proportional to what the view shows (a month is ~200 rows), near-zero cost for revisits when nothing changed, and correct data when another device edits.

## 2. Multi-device freshness (applies to every phase)

"Load once, patch locally" alone is wrong: an edit or delete on device B is never seen on device A. Use a **server data revision**:

- `settings` row `data_rev` (integer). Every mutation in `worker/src/core.js` increments it in the same request (`UPDATE settings SET value = value + 1 WHERE key = 'data_rev'`, inserted by migration). All writers already go through `core.js` (REST, MCP, CSV import, demo reset), per AGENTS.md.
- `GET /api/rev` -> `{ rev }` (1 row read). Clients store the last rev they rendered.
- Web: on `visibilitychange` to visible and on window `focus`, fetch `rev`; if different, reload the current view only. Optional slow poll (e.g. 5 min) while visible.
- A counter, not `updated_at`: catches hard deletes and is immune to device clock skew.

## 3. Edge cases

| # | Case | Handling |
|---|---|---|
| E1 | Old entry edited/deleted on another device | `data_rev` check on focus/visibility reloads the current view |
| E2 | Same entry edited on two devices | Phase 4: optimistic concurrency, PATCH carries the `version`/`updated_at` it was loaded with; mismatch -> 409 "changed on another device" |
| E3 | Timer started elsewhere, then Start here | Existing 409 `timer_running`; UI must refresh bootstrap on that 409 |
| E4 | Tab open for days / month rollover | Focus check covers data; "This month" recomputed on focus |
| E5 | Offline or failed rev check | Keep current data, show "may be out of date"; never blank the view |
| E6 | Client/project/task renamed | Phase 2 returns ids; names resolved from bootstrap masters, so renames appear everywhere; rate/currency stay frozen on the entry |
| E7 | Archived masters referenced by old entries | Bootstrap already returns `archived*` lists; name lookup must include them |
| E8 | Flutter client and MCP share endpoints | All API changes additive (new optional params); old responses keep their fields until clients migrate; MCP writes bump `data_rev` via `core.js` |
| E9 | CSV import of thousands of rows | One `data_rev` bump per batch, not per row |
| E10 | Local vs UTC month boundaries | Browser sends `fromMs/toMs` for the *local* month; server `month=` stays UTC for API/MCP compatibility |
| E11 | Pagination while data changes | Keyset cursor (`before=<start_time>:<id>`) instead of OFFSET: no skips/duplicates when rows are added |
| E12 | All-time print/CSV with years of data | Print requires a period (warn above N entries); CSV export streams server-side in chunks |
| E13 | Demo reset | Bumps `data_rev`; every device reloads |
| E14 | Edge cache serving stale data | Cache key includes `data_rev`, so a write makes old keys unreachable |
| E15 | Running entry inside a period view | Always included (from bootstrap `activeTimer`), even if outside the selected period |

## 4. Phases

### Phase 1 - stop the waste (patch, 0.18.1) - DONE
Implementation notes: `data_rev` lives in `settings` and is bumped by the router wrapper in `worker/src/index.js` after every successful non-GET `/api/*` request (excluding `/api/voice/parse` and `/api/sync/google-sheets`) and by MCP `start_timer`/`stop_timer`; the upsert needs no pre-seeded row and a missing table is tolerated, so the code is safe to deploy before the index migration. Bootstrap returns `dataRev`; the web `useTracker` compares `GET /api/rev` on focus/visibility. `GET /api/entries` returns `paging.has_more` and `paging.total` only for `offset = 0` (`null` afterwards).
Small, low risk, no API change.
1. `TrackerPage.jsx`: load history on mount and after this page's own successful mutations only; drop the `tracker.entries` dependency. Add the `data_rev` focus/visibility check (needs P1.4).
2. `listEntries` (`core.js`): run `COUNT(*)` only when `offset = 0` (or replace with `has_more` via `LIMIT n+1`); keep `paging.total` on the first page for compatibility.
3. Migration: `CREATE INDEX IF NOT EXISTS idx_entries_activity ON time_entries(activity_id)`.
4. Migration + `core.js`: `data_rev` setting, bumped by every mutation; `GET /api/rev`.
- Files: `web/src/pages/TrackerPage.jsx`, `web/src/lib/api.js`, `worker/src/core.js`, `worker/src/index.js`, `db/schema.sql`, `db/migrations/2026-10-xx-read-scaling-p1.sql`, worker tests.
- Expected: no refetch storm on actions; COUNT cost /N.

### Phase 2 - load only what is on screen (minor, 0.19.0) - the real 5-year fix
1. Ledger requests the selected period from the server: default **this local month** (`fromMs/toMs`), with `customerId`/`projectId` filters server-side (new optional params on `GET /api/entries`).
2. Month dropdown from `GET /api/entries/bounds` -> `{ minStart, maxStart }` (two index lookups); months generated client-side (empty months allowed or greyed).
3. Keyset pagination: `GET /api/entries?before=<start_time>:<id>&limit=` alongside existing `offset` (kept for Flutter until migrated).
4. Composite indexes: `(start_time, id)`, `(customer_id, start_time)`, `(project_id, start_time)`, `(activity_id, start_time)`; drop the single-column ones they supersede after checking `EXPLAIN QUERY PLAN`.
5. Lean rows: `fields=lean` returns entry columns without joins; web resolves names from bootstrap masters (incl. archived). Default response unchanged for other clients.
6. Print (`PrintPage.jsx`) and CSV export use the same period query instead of `fetchAllEntries()`.
- Expected at 11k entries: Time entries open ~1M -> ~200 rows.

### Phase 3 - do not repeat identical reads (minor, 0.20.0)
1. `ETag: "rev-<data_rev>"` on bootstrap, entries, summary, dashboard, detail endpoints; `If-None-Match` hit -> 304 after reading `data_rev` only.
2. Workers Cache API for dashboard/bootstrap responses keyed by URL + `data_rev` (per-colo; never stale because the key changes on write). Respect Access/APP_TOKEN: cache only after auth passes, key includes nothing user-specific (single-tenant).
3. If all-time dashboard is still heavy: `daily_totals(day, customer_id, project_id, activity_id, currency, seconds, cost, entries)` maintained in `core.js` on every write (and rebuilt by a script); dashboard reads rollups. Decide with D1 metrics after 3.1-3.2.
- Expected: revisit with no changes = 1 row read; dashboard reload = 1 row when cached.

### Phase 4 - safe concurrent edits (patch)
1. `time_entries.updated_at` (or `version` integer) set on every write.
2. `PATCH /api/entries/:id` accepts `ifVersion`; mismatch -> 409 `{ code: "entry_changed" }`; editor shows "changed on another device - reload". Additive: omitted `ifVersion` keeps last-write-wins for old clients.

## 5. Verification per phase
- Worker unit tests for each new query path (stub D1 like `worker/test/*.test.js`), including COUNT-only-first-page, keyset ordering, rev bump on every mutation type, 304 path.
- `EXPLAIN QUERY PLAN` on local D1 for every changed query: index used, no temp B-tree for `ORDER BY`.
- Synthetic load: seed ~11k entries locally (`scripts/seed-demo.mjs` extension), measure rows read via `meta.rows_read` from D1 responses before/after; record numbers in the phase's release notes.
- Two-browser test (two agent-browser sessions): edit/delete on A, focus B -> B reloads; concurrent edit -> 409 in Phase 4.
- `npm run verify`; migrations applied to both live D1 databases **before** pushing (AGENTS.md, Schema changes).

## 6. Out of scope
- Multi-user / per-user data (single-tenant app).
- Real-time push (WebSockets/Durable Objects): the focus/visibility rev check is enough for one person on a few devices.
- Currency conversion for mixed-currency dashboard totals (see `2026-10-09-entry-currency.md`).
