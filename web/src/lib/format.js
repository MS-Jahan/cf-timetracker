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

/** UTC date string (YYYY-MM-DD) for an epoch-ms timestamp — matches SQLite date(start_time/1000,'unixepoch'). */
export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC month key (YYYY-MM) for an epoch-ms timestamp. */
export function utcMonth(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

/** Local datetime-local input value for an epoch-ms timestamp. */
export function formatDateTimeLocal(ms) {
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Parse a datetime-local value into epoch milliseconds. */
export function parseDateTimeLocal(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
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
    utcDate(entry.start_time),
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
