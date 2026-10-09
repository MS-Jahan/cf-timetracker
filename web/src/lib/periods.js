// Local-calendar month helpers for the ledger and print views. Periods are "YYYY-MM"
// in the viewer's timezone (the server only sees half-open fromMs/toMs ranges).
const pad2 = (n) => String(n).padStart(2, "0");

export const monthKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

export const currentMonth = () => monthKey(new Date());

/** Half-open [fromMs, toMs) range covering one local month, or null for "all"/invalid. */
export function monthRange(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return { fromMs: new Date(year, month, 1).getTime(), toMs: new Date(year, month + 1, 1).getTime() };
}

/**
 * Month keys for the period picker, newest first: every month from the earliest to the
 * latest entry (empty months included so the list has no gaps), plus the current month
 * and any extra keys passed in (e.g. the selected period).
 */
export function monthOptions(minStart, maxStart, extra = []) {
  const keys = new Set([currentMonth(), ...extra.filter((k) => /^\d{4}-\d{2}$/.test(k))]);
  if (Number.isFinite(minStart) && Number.isFinite(maxStart)) {
    const cursor = new Date(new Date(minStart).getFullYear(), new Date(minStart).getMonth(), 1);
    const last = new Date(maxStart);
    while (cursor.getFullYear() < last.getFullYear() || (cursor.getFullYear() === last.getFullYear() && cursor.getMonth() <= last.getMonth())) {
      keys.add(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return [...keys].sort().reverse();
}
