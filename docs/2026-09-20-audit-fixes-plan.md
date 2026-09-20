# Audit fixes round 2 — plan & task list

**Date:** 2026-09-20
**Source:** user feedback log (UI/UX, timezones, filters, currency, footer, emoji picker).
**Method:** each task lists root cause found in code, then the fix. Executed top to bottom; verified in browser before deploy.

## I. UI/UX & default behavior

- [x] **T1 — Persist selected period.** `DashboardPage` hard-codes `useState("all")`. Fix: init from `localStorage` (`cf-tt-dashboard-period`), persist on change. Same for the ledger's period select (`cf-tt-ledger-period`). Unknown stored values fall back to `all`.
- [x] **T2 — Bar chart dates visible by default.** `DailyChart` labels only index 0, last, and every `ceil(n/6)` bar. Fix: label every bar when ≤16 points (slot ≥ ~26px at the chart's min width), else every `ceil(n/8)`; font 10px so MM-DD fits.
- [x] **T3 — Voice hint on hover.** "Optional, creates draft…" renders permanently. Fix: show only on hover/focus of the voice control (CSS `group-hover` reveal + `title` fallback); never for touch-only users — acceptable, it is a hint, not a control.
- [x] **T4 — Use the full page width.** Main container `max-w-[88rem]` (1408px) wastes space on 1920px monitors. Fix: fluid width, capped at `120rem` (1920px) for ultra-wide.

## II. Time zones

Storage/display are already correct by design; documenting here so it is on record, plus one importer improvement.

- [x] **T5 — Confirm UTC storage.** `start_time`/`end_time` are epoch milliseconds (UTC by definition) in D1. No local times stored anywhere.
- [x] **T6 — Display converts to the viewer's zone.** All rendering uses JS `Date`/`Intl`, which format epoch ms in the browser's local zone. No change needed; verified during T2/T7 work.
- [x] **T7 — Import timezone handling.** `kimai-import.mjs` takes `KIMAI_TZ` (default `Asia/Dhaka`, matching Kimai exports). Improvement: default to the machine's local zone via `Intl.DateTimeFormat().resolvedOptions().timeZone` instead of hard-coding Dhaka; the plan doc's in-app UI will auto-detect the browser zone and show it in the confirm step.

## III. Time entries & filtering

- [x] **T8 — "All months" shows a truncated ledger (real bug).** Root cause: `TrackerPage` builds its month list and its rows from `useTracker()`'s `entries`, which is bootstrap's **last 50 entries only** — so "All months" displays at most 50 rows and older months never appear. Fix: `TrackerPage` fetches the full history via `GET /api/entries` pagination on mount (bootstrap still seeds other pages), then derives months from the complete set. Reuse `DetailPager` for Older/Newer once rows exceed 200.
- [x] **T9 — Confirm client/project filters.** Working as reported; regression-check after T8.

## IV. Rates & currency

- [x] **T10 — Per-project currency, defaulting to the client's.** Schema: nullable `projects.currency` (migration `2026-09-20-project-currency.sql` + `schema.sql`). Worker: create/patch accept `currency`; project detail returns `currency` as `COALESCE(p.currency, c.currency)`. UI: CurrencySelect on the project create form and each project row, pre-filled with the client's currency; clearing it falls back to the client.
- [x] **T11 — Kill silent USD fallbacks.** Root causes found: `ActivityDetailPage` `dominantCurrency()` returns `"USD"` when its heuristic misses; `DashboardPage`/`ProjectDetailPage`/`EntryEditor` fall back to `"USD"` when currency is absent. Fix: thread the resolved project/client currency everywhere (prefer `project.currency ?? client.currency`), fall back to the row's own currency, and only then a neutral "—" instead of a wrong USD.
- [x] **T12 — Clarify the zero-rate "Bills" copy.** Rate chain is `entry hourlyRate ?? project.rate ?? client.hourly_rate ?? 0`; zero project rate is intentional (inherit). Reword project-page copy from "has no rate of its own, so X's client rate applies" to a single explicit sentence, and show "inherits client rate" in Settings' Bills column when project rate is 0.

## V. Footer & emoji picker

- [x] **T13 — Print footer leaks onto screen.** Root cause: `.print-footer` has no screen rule (only print rules in `print.css`), so it renders at the bottom of the ledger page. Fix: `display: none` on screen, visible only inside `@media print`.
- [x] **T14 — Emoji picker: bigger catalog, escape the table cell.** Fixes: catalog expanded (~100 → ~260 emojis across work/common categories); popup switches from `absolute` (clipped by table `overflow-x-auto`) to `position: fixed` anchored via `getBoundingClientRect()`, z-index above page chrome; closes on scroll/resize.

## VI. Printing system (planned — not started)

- [ ] **T15 — Dedicated print page instead of `@media print` on the ledger.** Today "Print" runs `window.print()` on the live page and relies on `no-print` classes; anything missed prints the whole UI. Decision: option 2 of the two proposed (redirect to a print-optimized page, not a popup — popups fight browser blockers and complicate multi-page layout).
  - New route `/print` (query: period/filters or explicit entry ids) rendering ONLY the timesheet: header, summary table, entries table, footer — reusing `buildSummary()` and the print markup, no app chrome.
  - Page auto-calls `window.print()` once on load (with a visible "Print" button for retry), `@page` margins defined so every printed page keeps margins and the bottom footer line (CSS `position: fixed; bottom: 0` footer repeats per printed page in most engines; verify Chromium/Firefox, fall back to a repeated footer row if not).
  - Ledger's Print button becomes `navigate("/print?…")` carrying the current filters.
  - Multi-page acceptance check: a 290-entry timesheet prints with correct margins on every page and the footer line present.

## Verification

- `npm run build` clean; worker tests green.
- Browser pass against the live personal instance: period persists across reload; chart dates visible; ledger shows all 290 entries with correct month list; project page shows BDT everywhere; print footer absent on screen; emoji picker fully visible over the table.
- Deploy: worker (schema migration applied first), then Pages.
