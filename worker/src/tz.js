// Time-zone math on IANA zones (e.g. "Asia/Dhaka"), using only Intl - no dependencies.
// Stored times are epoch milliseconds; a zone only matters when a wall-clock reading
// ("2026-11-16 09:30"), a calendar day or a calendar month has to be derived from an instant
// or the other way round. This file is copied verbatim to web/src/lib/tz.js (keep them
// identical; a worker test checks that).

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** True for a zone name Intl knows ("Asia/Dhaka", "UTC", "America/New_York"). */
export function isValidTimezone(tz) {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Calendar/clock fields of an instant as seen in `tz`. month is 1-12, weekday 0 (Sun) - 6. */
export function epochToWall(ms, tz) {
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (east is positive). */
export function zoneOffsetMs(tz, ms) {
  const w = epochToWall(ms, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which a wall clock reads these fields in `tz`. month is 1-12.
 * A time skipped by a DST jump resolves forward; a repeated time resolves to its first occurrence.
 */
export function wallToEpoch({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const o1 = zoneOffsetMs(tz, asUtc);
  const guess = asUtc - o1;
  const o2 = zoneOffsetMs(tz, guess);
  if (o1 === o2) return guess;
  const alt = asUtc - o2;
  return zoneOffsetMs(tz, alt) === o2 ? alt : guess;
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** Calendar day of an instant in `tz`, "YYYY-MM-DD". */
export function dayKey(ms, tz) {
  const w = epochToWall(ms, tz);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Calendar month of an instant in `tz`, "YYYY-MM". */
export function monthKey(ms, tz) {
  const w = epochToWall(ms, tz);
  return `${pad(w.year, 4)}-${pad(w.month)}`;
}

/** Half-open range [fromMs, toMs) covering the calendar month "YYYY-MM" in `tz`; null if malformed. */
export function monthRangeMs(month, tz) {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const nextYear = mo === 12 ? year + 1 : year;
  const nextMonth = mo === 12 ? 1 : mo + 1;
  return {
    fromMs: wallToEpoch({ year, month: mo, day: 1 }, tz),
    toMs: wallToEpoch({ year: nextYear, month: nextMonth, day: 1 }, tz),
  };
}

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** "2026-11-16T09:30" or "2026-11-16 09:30:15" (no offset) read as wall time in `tz`; null if malformed. */
export function parseLocalIso(text, tz) {
  const m = LOCAL_ISO.exec(String(text ?? "").trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = wallToEpoch({ year, month, day, hour, minute, second }, tz);
  // Reject impossible dates (e.g. Feb 30): the wall clock must read back the same day.
  const back = epochToWall(ms, tz);
  return back.day === day && back.month === month ? ms : null;
}

/** ISO 8601 with the zone's offset at that instant, e.g. "2026-11-16T09:30:00+06:00". */
export function formatOffsetIso(ms, tz) {
  const w = epochToWall(ms, tz);
  const off = zoneOffsetMs(tz, ms);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const oh = Math.floor(abs / 3_600_000);
  const om = Math.floor((abs % 3_600_000) / 60_000);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(oh)}:${pad(om)}`;
}
