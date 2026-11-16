// Calendar-month helpers for the ledger, the tracker period picker and the print view.
// Periods are "YYYY-MM" in the workspace's default time zone (lib/time.js); the server only
// sees the half-open fromMs/toMs range that monthRange returns.
import { currentMonthKey, monthRangeOf, wallOf } from "./time.js";

const pad2 = (n) => String(n).padStart(2, "0");

export const currentMonth = () => currentMonthKey();

/** Half-open [fromMs, toMs) range covering one month in the default zone, or null for "all"/invalid. */
export function monthRange(period) {
  return monthRangeOf(period || "");
}

/**
 * Month keys for the period picker, newest first: every month from the earliest to the
 * latest entry (empty months included so the list has no gaps), plus the current month
 * and any extra keys passed in (e.g. the selected period).
 */
export function monthOptions(minStart, maxStart, extra = []) {
  const keys = new Set([currentMonth(), ...extra.filter((k) => /^\d{4}-\d{2}$/.test(k))]);
  if (Number.isFinite(minStart) && Number.isFinite(maxStart)) {
    const first = wallOf(minStart);
    const last = wallOf(maxStart);
    let year = first.year;
    let month = first.month;
    while (year < last.year || (year === last.year && month <= last.month)) {
      keys.add(`${year}-${pad2(month)}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  return [...keys].sort().reverse();
}
