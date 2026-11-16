// Clock-time display preference: 24-hour ("14:05") or 12-hour ("2:05 PM"). One setting for
// every time of day in the app, stored per browser (like the date formats in dateFormat.js).
// Pure: no React and no browser globals at import time, so Node can load it for tests.

export const TIME_FORMATS = {
  "24h": { label: "24-hour (14:05)", placeholder: "HH:mm" },
  "12h": { label: "12-hour (2:05 PM)", placeholder: "h:mm AM/PM" },
};

const KEY = "cf-tt-time-format";
const DEFAULT = "24h";

const pad2 = (n) => String(n).padStart(2, "0");

/** "24h" or "12h" (default "24h"). */
export function getTimeFormat() {
  try {
    const value = localStorage.getItem(KEY);
    if (value && TIME_FORMATS[value]) return value;
  } catch {}
  return DEFAULT;
}

/** Save the preference in this browser. Unknown values are ignored. */
export function setTimeFormat(value) {
  if (!TIME_FORMATS[value]) return;
  try { localStorage.setItem(KEY, value); } catch {}
}

/** Clock text for a wall-clock reading: "14:05" (24h) or "2:05 PM" (12h, no leading zero on the hour). */
export function formatClockText(hour, minute, fmt = getTimeFormat()) {
  if (fmt === "12h") {
    const h = hour % 12 || 12;
    return `${h}:${pad2(minute)} ${hour < 12 ? "AM" : "PM"}`;
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Parse typed clock text in either notation, regardless of the saved preference.
 * Accepts "14:05", "9:30", "2:05 PM", "2:05pm", "02:05 p.m.", "12:00 am".
 * Returns {hour (0-23), minute (0-59)} or null.
 */
export function parseClockText(text) {
  const s = String(text ?? "").trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  m = /^(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?$/i.exec(s);
  if (m) {
    const h12 = Number(m[1]);
    const minute = Number(m[2]);
    if (h12 < 1 || h12 > 12 || minute > 59) return null;
    const pm = m[3].toLowerCase() === "p";
    return { hour: (h12 % 12) + (pm ? 12 : 0), minute };
  }
  return null;
}

/** Placeholder for a clock field in the given notation. */
export function clockPlaceholder(fmt = getTimeFormat()) {
  return TIME_FORMATS[fmt === "12h" ? "12h" : "24h"].placeholder;
}
