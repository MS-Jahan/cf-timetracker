// Calendar and clock helpers in the workspace's default time zone. Every day, month,
// weekday or wall-clock reading derived from an instant goes through this module: never the
// browser's zone and never UTC. The default comes from bootstrap (settings.defaultTimezone,
// stored by getBootstrap in api.js); until a bootstrap has loaded it is UTC.
import { epochToWall, isValidTimezone, monthKey, monthRangeMs, wallToEpoch, zoneOffsetMs, dayKey } from "./tz.js";
import { formatClockText } from "./timeFormat.js";

const FALLBACK_ZONE = "UTC";
const ZONE_KEY = "cf-tt-default-tz";

// The server is the source of truth, but the first render happens before bootstrap returns
// (e.g. the initial "current month" filter). Start from the last zone the server told us.
function cachedZone() {
  try {
    const tz = localStorage.getItem(ZONE_KEY);
    return isValidTimezone(tz) ? tz : FALLBACK_ZONE;
  } catch {
    return FALLBACK_ZONE;
  }
}
let defaultZone = cachedZone();

/** Set the default zone (invalid or missing names fall back to UTC). Returns the zone in effect. */
export function setDefaultTimezone(tz) {
  defaultZone = isValidTimezone(tz) ? tz : FALLBACK_ZONE;
  try { localStorage.setItem(ZONE_KEY, defaultZone); } catch {}
  return defaultZone;
}

export function getDefaultTimezone() {
  return defaultZone;
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** Calendar/clock fields {year, month (1-12), day, hour, minute, second, weekday (0 = Sun)} of an instant. */
export function wallOf(ms, tz = defaultZone) {
  return epochToWall(ms, tz);
}

/** "YYYY-MM-DD" for the calendar day of an instant. */
export function dayKeyOf(ms, tz = defaultZone) {
  return dayKey(ms, tz);
}

/** Clock reading of an instant in the zone: "14:05" or "2:05 PM" per the saved time format (lib/timeFormat.js). */
export function formatClock(ms, tz = defaultZone, fmt) {
  const w = epochToWall(ms, tz);
  return formatClockText(w.hour, w.minute, fmt);
}

/** "YYYY-MM" for the calendar month of an instant. */
export function monthKeyOf(ms, tz = defaultZone) {
  return monthKey(ms, tz);
}

/** "YYYY-MM" of the current month in the zone. */
export function currentMonthKey(tz = defaultZone) {
  return monthKey(Date.now(), tz);
}

/** Half-open [fromMs, toMs) of a "YYYY-MM" month in the zone; null for "all" or malformed. */
export function monthRangeOf(month, tz = defaultZone) {
  return monthRangeMs(month, tz);
}

/** Calendar fields of "today" in the zone. */
export function todayWall(tz = defaultZone) {
  return epochToWall(Date.now(), tz);
}

/** The instant at which a wall-clock reading occurs in the zone. */
export function wallToMs(wall, tz = defaultZone) {
  return wallToEpoch(wall, tz);
}

/** Calendar date {year, month, day} moved by n days (pure calendar arithmetic, no zone involved). */
export function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** "YYYY-MM-DD" for a calendar date object (no zone involved). */
export function ymdOf({ year, month, day }) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Number of days in a month (month 1-12). */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekday label ("Mon") for a calendar date object. */
export function weekdayShort({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2);
}

/** "UTC+06:00" style offset of a zone at an instant (defaults to now). */
export function offsetLabel(tz, ms = Date.now()) {
  const off = zoneOffsetMs(tz, ms);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `UTC${sign}${pad(Math.floor(abs / 3_600_000))}:${pad(Math.floor((abs % 3_600_000) / 60_000))}`;
}

/** The browser's own zone name, or null when Intl cannot say. */
export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

const FALLBACK_ZONES = [
  "UTC", "Asia/Dhaka", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Australia/Sydney", "Pacific/Auckland",
];
let zoneList = null;

/** Zone names for pickers, sorted; `include` (e.g. the currently saved zone) is always present. */
export function timezoneOptions(include) {
  if (!zoneList) {
    let names;
    try {
      names = Intl.supportedValuesOf("timeZone");
    } catch {
      names = FALLBACK_ZONES;
    }
    zoneList = [...new Set(["UTC", ...names])].sort();
  }
  return include && !zoneList.includes(include) ? [include, ...zoneList] : zoneList;
}
