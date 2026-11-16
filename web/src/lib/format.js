import { dayKeyOf, wallOf } from "./time.js";
import { formatClockText } from "./timeFormat.js";

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function toHours(totalSeconds) {
  return (Math.max(0, totalSeconds || 0) / 3600).toFixed(2);
}

/**
 * Format an amount in a currency. Every money figure in the UI goes through here so
 * symbols and layouts agree everywhere. Per-entry amounts pass their own currency;
 * mixed aggregates pass the ledger's dominant currency (currencyFor).
 *
 * Known codes render with their catalog symbol (€1.234,56-style via Intl); unknown
 * valid ISO codes still render via Intl; invalid codes fall back to "CODE 1,234.56".
 */
export function formatMoney(value, currency = "USD") {
  const n = Number(value || 0);
  if (!currency) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return n.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 2 });
    } catch {
      // fall through to the prefix fallback below
    }
  }
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short date in the default zone for printed reports: "30 Sep". */
export function shortDate(ms) {
  const w = wallOf(ms);
  return `${w.day} ${MONTHS[w.month - 1]}`;
}

/** Short date + clock time (per the saved time format) in the default zone for printed reports: "30 Sep 14:05". */
export function shortDateTime(ms) {
  const w = wallOf(ms);
  return `${shortDate(ms)} ${formatClockText(w.hour, w.minute)}`;
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" -> "October 2026". */
export function longMonth(yyyymm) {
  const [y, m] = String(yyyymm).split("-");
  return MONTHS_LONG[Number(m) - 1] ? `${MONTHS_LONG[Number(m) - 1]} ${y}` : yyyymm;
}

/** Long date in the default zone for printed reports: "9 October 2026". */
export function longDate(ms) {
  const w = wallOf(ms);
  return `${w.day} ${MONTHS_LONG[w.month - 1]} ${w.year}`;
}

/**
 * Compact date range in the default zone for printed reports (en dash):
 * "28 - 30 September 2026", "28 Sep - 4 Oct 2026", "28 Dec 2025 - 3 Jan 2026".
 */
export function formatPeriod(startMs, endMs) {
  const a = wallOf(Math.min(startMs, endMs));
  const b = wallOf(Math.max(startMs, endMs));
  const [ad, am, ay, bd, bm, by] = [a.day, a.month - 1, a.year, b.day, b.month - 1, b.year];
  if (ay === by && am === bm) {
    return ad === bd ? `${ad} ${MONTHS_LONG[am]} ${ay}` : `${ad} \u2013 ${bd} ${MONTHS_LONG[am]} ${ay}`;
  }
  if (ay === by) return `${ad} ${MONTHS[am]} \u2013 ${bd} ${MONTHS[bm]} ${ay}`;
  return `${ad} ${MONTHS[am]} ${ay} \u2013 ${bd} ${MONTHS[bm]} ${by}`;
}

export const CSV_COLUMNS = [
  "Entry ID",
  "Date",
  "Customer",
  "Project",
  "Activity",
  "Duration (Hours)",
  "Cost",
  "Description",
  "Tags",
];

/** Rows for the same 9 columns the GAS sheet uses. */
export function entryToCsvRow(entry) {
  return [
    entry.id,
    dayKeyOf(entry.start_time),
    entry.customer_name ?? entry.customer ?? "",
    entry.project_name ?? entry.project ?? "",
    entry.activity_name ?? entry.activity ?? "",
    toHours(entry.duration_seconds),
    Number(entry.cost || 0).toFixed(2),
    entry.description || "",
    entry.tags || "",
  ];
}

export function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(entries) {
  return [
    CSV_COLUMNS.join(","),
    ...entries.map((e) => entryToCsvRow(e).map(csvEscape).join(",")),
  ].join("\n");
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
