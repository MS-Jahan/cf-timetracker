# Print period label (2026-10-09)

Follow-up to `2026-10-09-print-timesheet-layout.md`. No API/schema change.

## Problem
The printed "Period" was derived loosely:
- Any entries within one calendar month printed as the bare month ("October 2026"), even when they covered only a few days.
- Entries spanning months printed "28 September 2026 to 4 October 2026" (long, repeated year, "to").
- Client/project/activity detail pages printed only "Client: X" with no dates.

## Rules
1. Explicit month filter (`YYYY-MM` in the scope label) -> month name ("September 2026").
2. No explicit scope: bare month name only when entries really span the whole month (first entry on day 1, last on the month's last day); otherwise a compact range.
3. Compact range (`formatPeriod` in `web/src/lib/format.js`, local dates, en dash):
   - same month: `28 – 30 September 2026`
   - same year: `28 Sep – 4 Oct 2026`
   - across years: `28 Dec 2025 – 3 Jan 2026`
   - single day: `28 September 2026`
4. Detail pages (scope label without a month): `Client: Vendy · 28 Sep – 4 Oct 2026`.
5. The same label feeds the saved PDF name (`<period> - cf-timetracker`).

## Verification
Unit-check `formatPeriod` cases; print-to-PDF the print page and read the Period block.
