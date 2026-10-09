# Changelog

All notable changes. Newest first. Rules: `docs/2026-10-09-versioning.md` (SemVer, pre-1.0: `feat` = minor, `fix` = patch; docs/chore/ci do not bump).
Versions 0.1.0 to 0.15.x were assigned retroactively from commit history on 2026-10-09.

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
