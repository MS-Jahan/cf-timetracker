// Unit tests for the web clock-time helpers (web/src/lib/timeFormat.js), run with Node's built-in runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clockPlaceholder, formatClockText, parseClockText } from "../../web/src/lib/timeFormat.js";

test("24h text is zero-padded HH:mm", () => {
  assert.equal(formatClockText(14, 5, "24h"), "14:05");
  assert.equal(formatClockText(0, 0, "24h"), "00:00");
  assert.equal(formatClockText(23, 59, "24h"), "23:59");
});

test("12h text has no leading zero on the hour and AM/PM", () => {
  assert.equal(formatClockText(14, 5, "12h"), "2:05 PM");
  assert.equal(formatClockText(9, 30, "12h"), "9:30 AM");
  assert.equal(formatClockText(0, 5, "12h"), "12:05 AM");
  assert.equal(formatClockText(12, 0, "12h"), "12:00 PM");
  assert.equal(formatClockText(23, 59, "12h"), "11:59 PM");
  assert.equal(formatClockText(11, 59, "12h"), "11:59 AM");
});

test("parseClockText accepts 24h and 12h notations", () => {
  assert.deepEqual(parseClockText("14:05"), { hour: 14, minute: 5 });
  assert.deepEqual(parseClockText("9:30"), { hour: 9, minute: 30 });
  assert.deepEqual(parseClockText(" 2:05 PM "), { hour: 14, minute: 5 });
  assert.deepEqual(parseClockText("2:05pm"), { hour: 14, minute: 5 });
  assert.deepEqual(parseClockText("02:05 p.m."), { hour: 14, minute: 5 });
  assert.deepEqual(parseClockText("12:00 am"), { hour: 0, minute: 0 });
  assert.deepEqual(parseClockText("12:00 PM"), { hour: 12, minute: 0 });
  assert.deepEqual(parseClockText("12:30"), { hour: 12, minute: 30 });
  assert.deepEqual(parseClockText("00:00"), { hour: 0, minute: 0 });
  assert.deepEqual(parseClockText("23:59"), { hour: 23, minute: 59 });
  assert.deepEqual(parseClockText("11:59 a.m."), { hour: 11, minute: 59 });
});

test("parseClockText rejects invalid input", () => {
  for (const bad of ["", "   ", "25:00", "24:00", "13:00 PM", "0:30 AM", "13:00 am", "12:60", "14:60",
    "0930", "9", "9:5", "2:05 XM", "2:05 P", "abc", "1405 PM", "-1:00", null, undefined]) {
    assert.equal(parseClockText(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("round-trip holds for every hour and minute in both notations", () => {
  for (const fmt of ["24h", "12h"]) {
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute++) {
        const text = formatClockText(hour, minute, fmt);
        assert.deepEqual(parseClockText(text), { hour, minute }, `${fmt} ${text}`);
      }
    }
  }
});

test("clockPlaceholder matches the notation", () => {
  assert.equal(clockPlaceholder("24h"), "HH:mm");
  assert.equal(clockPlaceholder("12h"), "h:mm AM/PM");
});

const { formatPeriod, longDate, shortDate, shortDateTime } = await import("../../web/src/lib/format.js");
const { shortRange } = await import("../../web/src/lib/rates.js");
const at = (iso) => Date.parse(iso);

// Display date format defaults to ymd and the default zone to UTC when run in Node.
test("date-only displays use the display date format", () => {
  assert.equal(shortDate(at("2026-09-30T10:00:00Z")), "2026-09-30");
  assert.equal(longDate(at("2026-10-09T10:00:00Z")), "2026-10-09");
  assert.equal(shortDateTime(at("2026-09-30T14:05:00Z")), "2026-09-30 14:05");
});

test("date ranges show both ends and collapse a single day", () => {
  assert.equal(formatPeriod(at("2026-09-28T01:00:00Z"), at("2026-09-30T01:00:00Z")), "2026-09-28 \u2013 2026-09-30");
  assert.equal(formatPeriod(at("2026-09-30T20:00:00Z"), at("2026-09-28T01:00:00Z")), "2026-09-28 \u2013 2026-09-30");
  assert.equal(formatPeriod(at("2026-09-30T01:00:00Z"), at("2026-09-30T20:00:00Z")), "2026-09-30");
  assert.equal(shortRange(at("2025-12-28T01:00:00Z"), at("2026-01-03T01:00:00Z")), "2025-12-28 \u2013 2026-01-03");
  assert.equal(shortRange(at("2026-09-05T01:00:00Z"), at("2026-09-05T20:00:00Z")), "2026-09-05");
});
