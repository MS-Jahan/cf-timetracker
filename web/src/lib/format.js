import { dayKeyOf, wallOf } from "./time.js";
import { formatDate, getDateFormat } from "./dateFormat.js";
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

/** Calendar date in the default zone, in the saved display date format (Settings): "2026-09-30". */
export function shortDate(ms) {
  return formatDate(ms, getDateFormat("ledger"));
}

/** Date (saved date format) + clock time (saved time format) in the default zone: "2026-09-30 14:05". */
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

/** Date in the default zone in the saved display date format (printed "generated on" line). */
export function longDate(ms) {
  return formatDate(ms, getDateFormat("ledger"));
}

/** Date range in the default zone, en dash, each end in the saved display date format; one date when both ends fall on the same day. */
export function formatPeriod(startMs, endMs) {
  const a = formatDate(Math.min(startMs, endMs), getDateFormat("ledger"));
  const b = formatDate(Math.max(startMs, endMs), getDateFormat("ledger"));
  return a === b ? a : `${a} \u2013 ${b}`;
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
