# Detail pages for projects, activities, and the graph rows (plan)

**Date:** 2026-09-20
**Follows:** `2026-09-19` client-detail turn (`/clients/:id`, parametric router, `GET /api/clients/:id`).

## 1. Problem

`/clients/:id` exists, but the other two master-data entities have no detail surface, and the
places that name them are dead text:

- Ledger project/activity cells are plain strings.
- Dashboard "By project" and "By activity" bars are not clickable (only "By client" is).
- Settings rows offer a "view" link to the *client* page only.
- The client detail page lists projects without links, and its ledger's client column
  shows "-" because `getClientDetail` doesn't return `customer_name` (an existing bug).

## 2. Design decisions

- **Same shape as the client page.** Both new pages are profile + totals + a breakdown of
  where the time went + paginated time history through the shared `Ledger`. Consistency
  beats per-entity novelty: one mental model, one print surface.
  - `/projects/:id` breaks down by **activity** (development vs meeting vs design on this project).
  - `/activities/:id` breaks down by **client** (who this activity bills).
- **Money on aggregates uses the row's own currency** (`MIN(c.currency)` per group), same
  rule the dashboard already uses. For the activity header totals (which can span
  currencies) the page computes the dominant currency from its by-client rows, exactly
  like `Ledger.currencyFor`.
- **Shared machinery, not copy-paste.** Three pages now fetch + paginate identically, so:
  - `web/src/lib/useDetailPage.js` - fetch/error/loading/offset state + `reload()`.
  - `web/src/components/DetailPager.jsx` - the "Showing X of Y / Newer / Older" bar.
  - `web/src/components/RankedBars.jsx` - extracted from `DashboardPage` (gains a
    `barClass` prop so the activity breakdown keeps its accent color); reused by all
    three breakdown views.
  - `ClientDetailPage` is refactored onto the hook (markup unchanged) rather than left
    as the one-off copy.
- **No router changes.** `:id` params already work; only the `ROUTES` table grows.
- **Detail endpoints return archived records too** (like `getClientDetail`): history must
  be inspectable even for archived master data; pages show an "Archived" badge.
- **Running entries appear in history** (marked "recording" by `Ledger`), totals count
  closed entries only - same as the client page.

## 3. Worker

`worker/src/core.js`:

- `getProjectDetail(env, id, { limit, offset })` →
  `{ status, project (with customer_name, customer_currency, customer_rate), entries[] (te.* + customer_name + activity_name), totals {entry_count, total_seconds, total_cost}, by_activity[] {activity_id, name, total_seconds, total_hours, total_cost, entry_count}, paging }`; 404 unknown id; `limit` clamped 1-200.
- `getActivityDetail(env, id, { limit, offset })` →
  `{ status, activity, entries[] (te.* + customer_name + project_name), totals, by_client[] {customer_id, name, currency, total_seconds, total_hours, total_cost, entry_count}, paging }`; same clamps.
- `getClientDetail` entries query gains `c.name AS customer_name` (fixes the "-" column).
- `queryDashboard`: `by_project` rows gain `project_id` + `currency`;
  `by_activity` rows gain `activity_id` + `currency` (joins customers where needed).

`worker/src/index.js`:

- `GET /api/projects/:id?limit=&offset=` and `GET /api/activities/:id?limit=&offset=`,
  mapped through the existing `STATUS_CODES` (404 / 400), alongside the client route.

## 4. Web

- `web/src/lib/api.js`: `getProject(id, {limit, offset})`, `getActivity(id, {limit, offset})`.
- Routes in `App.jsx`: `/projects/:id` → `ProjectDetailPage`, `/activities/:id` →
  `ActivityDetailPage` (after `/clients/:id`, before catch-alls).
- `ProjectDetailPage`: breadcrumb `Settings / <Client>` (client name links to
  `/clients/:id`); header shows budget type, rate line (`rate` or "bills X/h from
  <client>"), Archived badge; totals (closed entries / hours / billed in the client's
  currency); activity breakdown (clickable bars); time history + pager. Dynamic title.
- `ActivityDetailPage`: breadcrumb `Settings / Activities`; totals in the dominant
  currency; by-client breakdown with links to client pages; time history + pager. Dynamic title.
- Links wired:
  - `Ledger`: project cell → `/projects/:id`, activity cell → `/activities/:id`
    (every entry query carries `te.*`, so ids are always present).
  - Dashboard: by-project and by-activity bars become clickable via `RankedBars linkRows`.
  - `ClientDetailPage`: project names link to `/projects/:id`.
  - `ManagePanel`: project name cell gets a "view" link to the project page; activity
    rows get one too; the client link is relabeled "client" to stay unambiguous.

## 5. Verification (light, per current working agreement)

1. `cd worker && npm test` - existing 8 tests stay green (module imports new code).
2. `cd web && npm run build` - clean build.
3. Live `wrangler dev` + curl: detail payloads for a seeded project/activity (ids +
   totals + breakdown + paging correct), 404 for bogus ids, `limit=1` paging honored;
   dashboard rows carry `project_id` / `activity_id`. Server stopped afterwards.

## 6. Out of scope (noted, not dropped)

- Tag detail pages (entries are tagged with free-form strings; needs a tag index first).
- Edit-in-place on detail pages (Settings remains the master-data editor).
- Breakdown-by-month on detail pages (candidate once someone asks for it).

## 7. What actually happened (executed 2026-09-20)

Executed as planned, in §3-§6 order. No divergences from the plan; §5 checks all passed:

| Check | Result |
|---|---|
| `cd worker && npm test` | 8/8 pass |
| `cd web && npm run build` | clean (`index-*.js` 292 kB, CSS 95.6 kB) |
| `GET /api/projects/:id` (seeded `API Integration`) | project + client context (`Beta LLC`, `customer_currency`), totals `2 entries / 10800 s / 285`, by-activity `[Development 7200, Testing 3600]`, entries carry `customer_name` + `activity_name` |
| `GET /api/activities/:id` (seeded `Design`) | totals `8 entries / 5428 s / 195.93`, by-client `[Acme Corp, USD, 195.93]`, entries carry `customer_name` + `project_name` |
| Unknown ids | both endpoints 404 |
| `?limit=1` | `paging {limit:1, offset:0, returned:1}` of 2 totals - stable pages honored |
| `GET /api/dashboard` | `by_project[0]` now carries `project_id` + `currency`; `by_activity[0]` carries `activity_id` + `currency` |
| `GET /api/clients/:id` entries | now include `customer_name` (the "-" client-column bug fixed) |
| Server lifecycle | temporary `wrangler dev --port 8791` used for the checks and stopped afterwards; port verified free |
