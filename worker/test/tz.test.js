// Time-zone helpers (worker/src/tz.js). Run: npm test   (node --test)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  dayKey, epochToWall, formatOffsetIso, isValidTimezone, monthKey, monthRangeMs, parseLocalIso, wallToEpoch, zoneOffsetMs,
} from "../src/tz.js";

const HOUR = 3_600_000;

describe("tz - validation and offsets", () => {
  it("accepts IANA names and rejects junk", () => {
    for (const ok of ["UTC", "Asia/Dhaka", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) assert.equal(isValidTimezone(ok), true, ok);
    for (const bad of ["", "Mars/Olympus", "dhaka", 5, null, undefined, "x".repeat(80)]) assert.equal(isValidTimezone(bad), false, String(bad));
  });

  it("knows fixed and DST offsets", () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    const summer = Date.UTC(2026, 6, 15, 12);
    assert.equal(zoneOffsetMs("Asia/Dhaka", winter), 6 * HOUR);
    assert.equal(zoneOffsetMs("Asia/Kolkata", winter), 5.5 * HOUR);
    assert.equal(zoneOffsetMs("America/New_York", winter), -5 * HOUR);
    assert.equal(zoneOffsetMs("America/New_York", summer), -4 * HOUR);
    assert.equal(zoneOffsetMs("UTC", summer), 0);
  });
});

describe("tz - wall clock <-> instant", () => {
  it("round-trips in several zones", () => {
    for (const tz of ["Asia/Dhaka", "America/New_York", "Europe/London", "Asia/Kolkata", "Pacific/Auckland", "UTC"]) {
      const ms = wallToEpoch({ year: 2026, month: 11, day: 16, hour: 9, minute: 30 }, tz);
      const w = epochToWall(ms, tz);
      assert.deepEqual([w.year, w.month, w.day, w.hour, w.minute], [2026, 11, 16, 9, 30], tz);
    }
  });

  it("Dhaka 02:00 on the 16th is the 15th in UTC (the original bug)", () => {
    const ms = wallToEpoch({ year: 2026, month: 11, day: 16, hour: 2 }, "Asia/Dhaka");
    assert.equal(dayKey(ms, "Asia/Dhaka"), "2026-11-16");
    assert.equal(dayKey(ms, "UTC"), "2026-11-15");
  });

  it("resolves a skipped DST hour forward and a repeated hour to its first occurrence", () => {
    // New York 2026-03-08 02:30 does not exist (clocks jump 02:00 -> 03:00).
    const gap = wallToEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York");
    assert.equal(epochToWall(gap, "America/New_York").hour, 3);
    // 2026-11-01 01:30 happens twice; the first one is still daylight time (UTC-4).
    const repeat = wallToEpoch({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    assert.equal(repeat, Date.UTC(2026, 10, 1, 5, 30));
  });
});

describe("tz - day and month keys and ranges", () => {
  it("month range is zone-aware, half-open and contiguous", () => {
    const nov = monthRangeMs("2026-11", "Asia/Dhaka");
    const dec = monthRangeMs("2026-12", "Asia/Dhaka");
    assert.equal(nov.fromMs, Date.UTC(2026, 9, 31, 18)); // Nov 1 00:00 +06:00
    assert.equal(nov.toMs, dec.fromMs);
    assert.equal(monthKey(nov.fromMs, "Asia/Dhaka"), "2026-11");
    assert.equal(monthKey(nov.toMs - 1, "Asia/Dhaka"), "2026-11");
    assert.equal(monthKey(nov.toMs, "Asia/Dhaka"), "2026-12");
  });

  it("handles December and DST months", () => {
    const dec = monthRangeMs("2026-12", "UTC");
    assert.equal(dec.toMs, Date.UTC(2027, 0, 1));
    const mar = monthRangeMs("2026-03", "America/New_York");
    assert.equal((mar.toMs - mar.fromMs) / HOUR, 31 * 24 - 1); // one hour lost to DST
  });

  it("rejects malformed months", () => {
    for (const bad of ["2026-13", "2026-00", "26-11", "", null, "2026-1"]) assert.equal(monthRangeMs(bad, "UTC"), null, String(bad));
  });
});

describe("tz - local ISO parsing and offset formatting", () => {
  it("parses offset-less ISO in the given zone", () => {
    assert.equal(parseLocalIso("2026-11-16T09:30", "Asia/Dhaka"), Date.UTC(2026, 10, 16, 3, 30));
    assert.equal(parseLocalIso("2026-11-16 09:30:15", "UTC"), Date.UTC(2026, 10, 16, 9, 30, 15));
  });

  it("rejects malformed and impossible values", () => {
    for (const bad of ["2026-11-16", "2026-11-16T25:00", "2026-02-30T10:00", "nope", "", null]) assert.equal(parseLocalIso(bad, "UTC"), null, String(bad));
  });

  it("formats with the zone's offset, including half-hour and negative zones", () => {
    const ms = Date.UTC(2026, 10, 16, 3, 30);
    assert.equal(formatOffsetIso(ms, "Asia/Dhaka"), "2026-11-16T09:30:00+06:00");
    assert.equal(formatOffsetIso(ms, "Asia/Kolkata"), "2026-11-16T09:00:00+05:30");
    assert.equal(formatOffsetIso(ms, "America/New_York"), "2026-11-15T22:30:00-05:00");
    assert.equal(formatOffsetIso(ms, "UTC"), "2026-11-16T03:30:00+00:00");
  });
});

describe("tz - web copy", () => {
  it("web/src/lib/tz.js is byte-identical to worker/src/tz.js", () => {
    const worker = readFileSync(new URL("../src/tz.js", import.meta.url), "utf8");
    const web = readFileSync(new URL("../../web/src/lib/tz.js", import.meta.url), "utf8");
    assert.equal(web, worker);
  });
});
