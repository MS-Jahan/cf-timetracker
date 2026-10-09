# Print: Hourly rates table (2026-10-09)

Release 0.17.0. No API/schema change.

## Problem
The printed timesheet showed amounts but never the hourly rate. Rates resolve per entry as `hourlyRate ?? project.rate ?? customer.hourly_rate`, can differ per project, and can change during a period (or be overridden on one entry). A per-row rate column would crowd the Details table and still not explain changes.

## Design
A separate print-only **Hourly rate(s)** table directly under "Summary by Client & Project", built from each closed entry's stored `rate_applied` (the billed rate, frozen at record time), not from current client/project settings. Logic in `web/src/lib/rates.js` (`buildRateRows`), rendered by `Ledger.jsx`.

### Rows
- Entries sorted by start time; a new row starts each time the rate changes (runs), so A -> B -> A yields three rows, never an overlapping merged range.
- Per client:
  - One rate across all its entries -> one row (project shown as "All projects" when the Project column is visible).
  - Single project -> client-level runs.
  - Several projects -> client-level runs if that needs fewer rows than per-project runs (all projects changed together); otherwise one group per project, each with its own runs.
- Rates are compared to the cent. Rate 0 renders as `0.00 (not billed)`.
- Running entry excluded (same as totals); table hidden when there are no closed entries.

### Columns (dynamic)
| Column | Shown when |
|---|---|
| Client | always |
| Project | any client needed a per-project split |
| Dates worked | any client/project group has more than one run |
| Rate / hour | always, in the client's currency |

"Dates worked" spans the first to last entry at that rate (not an effective date: rate changes are not stored). Short local ranges (`1 – 14 Sep`, `28 Sep – 4 Oct`, single day `5 Sep`); every date carries the year when the report spans more than one calendar year.

## Known limitation
`currency` comes from the client's current setting, so a currency change rewrites the currency shown for older entries (pre-existing data model limitation, not addressed here).

## Verification
Node check of `buildRateRows` cases (single rate, project split, A->B->A, simultaneous change, zero rate, cross-year); print-to-PDF read of the table.
