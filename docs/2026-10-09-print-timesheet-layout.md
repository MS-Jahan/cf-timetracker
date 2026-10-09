# Print timesheet layout fixes (2026-10-09)

Print/PDF output (`Ledger.jsx` + `web/src/print.css`) reworked. No API or schema change.

- **Details table**: dedicated print-only table (`print-details-table`) with its own `<colgroup>`. The old shared table's colgroup was `no-print`, so print widths never applied (Project/Task overlapped, Note truncated). Screen table is now `no-print`.
- Columns: Date (`30 Sep`), Start / Stop (`30 Sep 14:05`), Project + Client · Task, Note (wraps, full text + tags), Duration, Total. Framed with outer border, "Details" heading, total row.
- **Summary**: divider above Total row restored (removed `tr:last-child` border reset).
- **Footer**: in normal flow under the details table (was `position: fixed`, overlapped rows); no longer repeats entry/hour counts.
- Dates/times in Details use the browser's local timezone (`shortDate`/`shortDateTime` in `web/src/lib/format.js`); header period and monthly slices remain UTC.

## Follow-up: print header, date formats, clickable notes (same day)

- Print header: brand reads "cf-timetracker" (cf `#f4611b`, rest `#08203e`, sampled from `logo.png`); key figures are labelled blocks (Period / Printed / Entries / Hours / Amount) instead of a `|`-separated line.
- Period reads "October 2026" (a single month) or "16 July 2025 to 22 September 2026"; "Printed" and the footer use "9 October 2026". Helpers: `longMonth`, `longDate` in `web/src/lib/format.js`.
- Saved PDF name: `Ledger.jsx` sets `document.title` to "<period> - cf-timetracker" between `beforeprint`/`afterprint`.
- Date display preferences (browser localStorage, `web/src/lib/dateFormat.js`): ledger default `YYYY-MM-DD`, edit dialog default `DD/MM/YYYY`; Settings > Date display offers four formats each. The editor's start/end fields are now text inputs (`DD/MM/YYYY HH:mm`, 24h) because native `datetime-local` follows the browser's US month-first locale. The ledger date column now shows the local date (was UTC) so it matches the editor and print.
- Ledger note text is a button that opens the same editor as the row menu's Edit.
