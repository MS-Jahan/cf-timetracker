# Print timesheet layout fixes (2026-10-09)

Print/PDF output (`Ledger.jsx` + `web/src/print.css`) reworked. No API or schema change.

- **Details table**: dedicated print-only table (`print-details-table`) with its own `<colgroup>`. The old shared table's colgroup was `no-print`, so print widths never applied (Project/Task overlapped, Note truncated). Screen table is now `no-print`.
- Columns: Date (`30 Sep`), Start / Stop (`30 Sep 14:05`), Project + Client · Task, Note (wraps, full text + tags), Duration, Total. Framed with outer border, "Details" heading, total row.
- **Summary**: divider above Total row restored (removed `tr:last-child` border reset).
- **Footer**: in normal flow under the details table (was `position: fixed`, overlapped rows); no longer repeats entry/hour counts.
- Dates/times in Details use the browser's local timezone (`shortDate`/`shortDateTime` in `web/src/lib/format.js`); header period and monthly slices remain UTC.
