// User-selectable date display: one preference for the ledger column, one for the
// entry editor. Stored per browser (like the theme); the editor uses a text field
// because native datetime-local inputs follow the browser locale (US month-first).
// Dates are read in the workspace's default zone unless a zone is passed (see lib/time.js).
import { getDefaultTimezone, wallOf } from "./time.js";
import { parseLocalIso } from "./tz.js";
import { formatClockText, clockPlaceholder, parseClockText } from "./timeFormat.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

export const DATE_FORMATS = {
  ymd: { label: "Year-Month-Day", hint: "YYYY-MM-DD" },
  dmy: { label: "Day/Month/Year", hint: "DD/MM/YYYY" },
  mdy: { label: "Month/Day/Year", hint: "MM/DD/YYYY" },
  dMonY: { label: "Day Mon Year", hint: "D Mon YYYY" },
};

const KEYS = { ledger: "cf-tt-date-format-ledger", edit: "cf-tt-date-format-edit" };
const DEFAULTS = { ledger: "ymd", edit: "dmy" };

export function getDateFormat(kind) {
  try {
    const value = localStorage.getItem(KEYS[kind]);
    if (value && DATE_FORMATS[value]) return value;
  } catch {}
  return DEFAULTS[kind];
}

export function setDateFormat(kind, value) {
  try { localStorage.setItem(KEYS[kind], value); } catch {}
}

/** Date text for calendar fields {year, month (1-12), day} in the chosen format, e.g. "30/09/2026". */
export function formatDateParts({ year, month, day }, format) {
  const m = month - 1;
  switch (format) {
    case "dmy": return `${pad2(day)}/${pad2(month)}/${year}`;
    case "mdy": return `${pad2(month)}/${pad2(day)}/${year}`;
    case "dMonY": return `${day} ${MONTHS[m]} ${year}`;
    default: return `${year}-${pad2(month)}-${pad2(day)}`;
  }
}

/** Calendar date in the chosen format and zone, e.g. "30/09/2026". */
export function formatDate(ms, format, tz = getDefaultTimezone()) {
  return formatDateParts(wallOf(ms, tz), format);
}

/** Date text in the chosen format -> "YYYY-MM-DD" (ISO), or null when it does not match the format or is impossible. */
export function dateTextToIso(text, format) {
  const s = String(text ?? "").trim();
  let y, mo, d, p;
  if (format === "ymd" && (p = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, mo, d] = [+p[1], +p[2], +p[3]];
  else if (format === "dmy" && (p = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [d, mo, y] = [+p[1], +p[2], +p[3]];
  else if (format === "mdy" && (p = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [mo, d, y] = [+p[1], +p[2], +p[3]];
  else if (format === "dMonY" && (p = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/))) {
    d = +p[1];
    mo = MONTHS.findIndex((name) => name.toLowerCase() === p[2].toLowerCase()) + 1;
    y = +p[3];
  } else return null;
  if (mo < 1) return null;
  const iso = `${y}-${pad2(mo)}-${pad2(d)}`;
  // parseLocalIso rejects impossible dates (31/02) that Date would silently roll over.
  return parseLocalIso(`${iso}T00:00`, "UTC") === null ? null : iso;
}

/** "YYYY-MM-DD" (ISO) -> date text in the chosen format; "" for anything that is not an ISO date. */
export function isoToDateText(iso, format) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!p) return "";
  return formatDateParts({ year: +p[1], month: +p[2], day: +p[3] }, format);
}

/** Clock text for an instant in the zone, per the saved time format: "14:05" or "2:05 PM". */
export function formatClockOf(ms, tz = getDefaultTimezone()) {
  const w = wallOf(ms, tz);
  return formatClockText(w.hour, w.minute);
}

/** Date + clock time for the editor field, e.g. "30/09/2026 2:05 PM". */
export function formatDateTimeInput(ms, format, tz = getDefaultTimezone()) {
  return `${formatDate(ms, format, tz)} ${formatClockOf(ms, tz)}`;
}

/** Hint for a date+time field, e.g. "DD/MM/YYYY HH:mm" or "DD/MM/YYYY h:mm AM/PM". */
export function dateTimeHint(format, timeFormat) {
  return `${DATE_FORMATS[format].hint} ${clockPlaceholder(timeFormat)}`;
}

/**
 * Combine separately typed date text and clock text into an instant in `tz`.
 * The clock accepts 24h or 12h text. NaN when either part is invalid or the combination is impossible.
 */
export function parseDateTimeParts(dateText, clockText, format, tz = getDefaultTimezone()) {
  const iso = dateTextToIso(dateText, format);
  const clock = parseClockText(clockText);
  if (!iso || !clock) return NaN;
  const ms = parseLocalIso(`${iso}T${pad2(clock.hour)}:${pad2(clock.minute)}`, tz);
  return ms === null ? NaN : ms;
}

/** Parse one editor text ("30/09/2026 2:05 PM" or "30/09/2026 14:05") back to epoch ms. NaN when invalid. */
export function parseDateTimeInput(text, format, tz = getDefaultTimezone()) {
  const m = String(text ?? "").trim().match(/^(.*\S)\s+(\d{1,2}:\d{2}(?:\s*[ap]\.?\s*m\.?)?)$/i);
  if (!m) return NaN;
  return parseDateTimeParts(m[1], m[2], format, tz);
}
