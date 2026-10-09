// User-selectable date display: one preference for the ledger column, one for the
// entry editor. Stored per browser (like the theme); the editor uses a text field
// because native datetime-local inputs follow the browser locale (US month-first).
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

/** Local calendar date in the chosen format, e.g. "30/09/2026". */
export function formatDate(ms, format) {
  const d = new Date(ms);
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  switch (format) {
    case "dmy": return `${pad2(day)}/${pad2(month + 1)}/${year}`;
    case "mdy": return `${pad2(month + 1)}/${pad2(day)}/${year}`;
    case "dMonY": return `${day} ${MONTHS[month]} ${year}`;
    default: return `${year}-${pad2(month + 1)}-${pad2(day)}`;
  }
}

/** Date + 24h time for the editor field, e.g. "30/09/2026 14:05". */
export function formatDateTimeInput(ms, format) {
  const d = new Date(ms);
  return `${formatDate(ms, format)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function dateTimeHint(format) {
  return `${DATE_FORMATS[format].hint} HH:mm`;
}

/** Parse editor text back to epoch ms (local time). NaN when it does not match the format. */
export function parseDateTimeInput(text, format) {
  const m = String(text).trim().match(/^(.+?)\s+(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const [, datePart, hh, mm] = m;
  let y, mo, d;
  let p;
  if (format === "ymd" && (p = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, mo, d] = [+p[1], +p[2], +p[3]];
  else if (format === "dmy" && (p = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [d, mo, y] = [+p[1], +p[2], +p[3]];
  else if (format === "mdy" && (p = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [mo, d, y] = [+p[1], +p[2], +p[3]];
  else if (format === "dMonY" && (p = datePart.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/))) {
    d = +p[1];
    mo = MONTHS.findIndex((name) => name.toLowerCase() === p[2].toLowerCase()) + 1;
    y = +p[3];
  } else return NaN;
  const date = new Date(y, mo - 1, d, +hh, +mm);
  // Reject overflow like 31/02 or 25:00 that Date silently rolls over.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || +hh > 23 || +mm > 59) return NaN;
  return date.getTime();
}
