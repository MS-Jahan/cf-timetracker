// Local harness for gas/Code.gs (T-G1..T-G3) - runs without a Google account.
// Run: node --test gas/test/   (wired into `npm run verify`)
//
// Code.gs is plain script code for the Apps Script runtime. Loading it here means
// evaluating the source with the GAS globals (`SpreadsheetApp`, `PropertiesService`,
// `ContentService`, `LockService`) supplied by stubs, then grabbing `doPost`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, "../Code.gs"), "utf8");

/** In-memory SpreadsheetApp stub: sheets are 2-D arrays; row 1 is the header. */
function stubSpreadsheet() {
  const sheets = new Map();
  const api = {
    sheet(name) {
      if (!sheets.has(name)) return null;
      const rows = sheets.get(name);
      return {
        getValues_: () => rows.map((r) => [...r]),
        getLastRow: () => rows.length,
        appendRow: (row) => rows.push([...row]),
        getRange: (row, col, numRows = 1, numCols = 1) => ({
          getValues: () => rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
          setValues: (values) => {
            values.forEach((v, i) => {
              const target = row - 1 + i;
              while (rows.length <= target) rows.push([]);
              v.forEach((cell, j) => { rows[target][col - 1 + j] = cell; });
            });
          },
        }),
      };
    },
  };
  api.stubs = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => api.sheet(name),
      insertSheet: (name) => { sheets.set(name, []); return api.sheet(name); },
    }),
    sheets,
  };
  return api;
}

/** Evaluates Code.gs with GAS globals and returns its doPost. */
function loadReceiver({ sharedSecret = "", calls = [] } = {}) {
  const spreadsheet = stubSpreadsheet();
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => {
          calls.push({ op: "getProperty", key });
          return key === "SHARED_SECRET" ? sharedSecret : null;
        },
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: spreadsheet.stubs.getActiveSpreadsheet },
    LockService: {
      getScriptLock: () => {
        calls.push({ op: "lock" });
        return { waitLock() {}, releaseLock() {} };
      },
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (text) => ({ text, setMimeType: () => ({ text }) }),
    },
  };
  const doPost = new Function(
    ...Object.keys(globals),
    `${SOURCE}\nreturn doPost;`
  )(...Object.values(globals));
  return {
    doPost,
    sheets: spreadsheet.stubs.sheets,
    calls,
    // Event object shaped like a real POST from the Worker.
    event(body, secret) {
      return { postData: { contents: JSON.stringify(body) }, parameter: secret === undefined ? {} : { secret } };
    },
    response(result) {
      return JSON.parse(result.text);
    },
  };
}

const ENTRIES = [
  { id: "e1", log_date: "2026-09-19", customer: "Acme", project: "Website", activity: "Development", duration_seconds: 5400, cost: 150, description: "Build page", tags: "react" },
  { id: "e2", log_date: "2026-09-19", customer: "Acme", project: "Website", activity: "Meeting", duration_seconds: 1800, cost: 50, description: "Kickoff", tags: "" },
];

describe("GAS receiver (Code.gs)", () => {
  it("creates the sheet + header on first sync and appends mapped rows (T-G1)", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const result = env.response(env.doPost(env.event({ entries: ENTRIES, secret: "s3cret" })));

    assert.equal(result.status, "success");
    assert.equal(result.count, 2);
    const rows = env.sheets.get("TimeEntries");
    assert.deepEqual(rows[0], ["Entry ID", "Date", "Customer", "Project", "Activity", "Duration (Hours)", "Cost", "Description", "Tags"]);
    assert.deepEqual(rows[1], ["e1", "2026-09-19", "Acme", "Website", "Development", "1.50", 150, "Build page", "react"]);
    assert.equal(rows[2][5], "0.50");
  });

  it("re-syncing the same entries appends nothing and reports skipped (T-G2)", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const payload = { entries: ENTRIES, secret: "s3cret" };
    env.doPost(env.event(payload));
    const second = env.response(env.doPost(env.event(payload)));

    assert.equal(second.status, "success");
    assert.equal(second.count, 0, "dedupe must prevent a second append");
    assert.equal(second.skipped, 2);
    assert.equal(env.sheets.get("TimeEntries").length, 3, "header + 2 rows, unchanged");
  });

  it("skips duplicates inside one payload", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const result = env.response(env.doPost(env.event({ entries: [ENTRIES[0], ENTRIES[0]], secret: "s3cret" })));
    assert.equal(result.count, 1);
    assert.equal(result.skipped, 1);
  });

  it("rejects a wrong secret without touching the sheet (T-G3)", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const result = env.response(env.doPost(env.event({ entries: ENTRIES, secret: "wrong" })));

    assert.equal(result.status, "error");
    assert.match(result.message, /Unauthorized/);
    assert.equal(env.sheets.has("TimeEntries"), false, "no sheet may be created");
  });

  it("fails closed when SHARED_SECRET is not configured (T-G3)", () => {
    const env = loadReceiver({ sharedSecret: "" });
    const result = env.response(env.doPost(env.event({ entries: ENTRIES, secret: "" })));
    assert.equal(result.status, "error");
    assert.match(result.message, /Unauthorized/);
  });

  it("rejects a payload without entries", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const result = env.response(env.doPost(env.event({ secret: "s3cret" })));
    assert.equal(result.status, "error");
    assert.match(result.message, /No entries/);
  });

  it("rejects a malformed JSON body", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    const result = env.response(env.doPost({ postData: { contents: "not json" }, parameter: {} }));
    assert.equal(result.status, "error");
    assert.match(result.message, /Invalid JSON/);
  });

  it("takes the lock around sheet writes", () => {
    const env = loadReceiver({ sharedSecret: "s3cret" });
    env.doPost(env.event({ entries: ENTRIES, secret: "s3cret" }));
    assert.ok(env.calls.some((c) => c.op === "lock"), "LockService must be engaged");
  });
});
