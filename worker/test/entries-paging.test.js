// Tests for period-scoped, filtered, keyset-paged entry listing (worker/src/core.js).
// Run: npm test   (node --test)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entryBounds, listEntries } from "../src/core.js";

/** Records every statement; time_entries page queries return `rows`, COUNT returns `total`. */
function recordingDb({ rows = [], total = 0, bounds = { min_start: 10, max_start: 90 } } = {}) {
  const calls = [];
  return {
    calls,
    pages: () => calls.filter((c) => /ORDER BY te\.start_time DESC/.test(c.sql)),
    counts: () => calls.filter((c) => /COUNT\(\*\)/.test(c.sql)),
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() { calls.push({ sql, args: this.args }); return { results: rows }; },
        async first() {
          calls.push({ sql, args: this.args });
          if (/COUNT\(\*\)/.test(sql)) return { total };
          if (/MIN\(start_time\)/.test(sql)) return bounds;
          return null;
        },
      };
    },
  };
}

const row = (n) => ({ id: `e${n}`, start_time: 1000 - n });

describe("listEntries filters and cursor", () => {
  it("filters by client/project/activity inside the range, for the page and the count", async () => {
    const db = recordingDb({ rows: [row(1)], total: 1 });
    await listEntries({ DB: db }, { fromMs: 100, toMs: 200, customerId: "c1", projectId: "p1", activityId: "a1" });

    const [page] = db.pages();
    assert.match(page.sql, /te\.customer_id = \? AND te\.project_id = \? AND te\.activity_id = \?/);
    assert.deepEqual(page.args.slice(0, 5), [100, 200, "c1", "p1", "a1"]);
    assert.match(db.counts()[0].sql, /te\.customer_id = \?/, "the first-page count honours the same filters");
  });

  it("continues after a keyset cursor without OFFSET or COUNT", async () => {
    const db = recordingDb({ rows: [row(1), row(2)] });
    const result = await listEntries({ DB: db }, { limit: 5, before: "900:e-last" });

    const [page] = db.pages();
    assert.match(page.sql, /te\.start_time < \? OR \(te\.start_time = \? AND te\.id < \?\)/);
    assert.doesNotMatch(page.sql, /OFFSET/);
    assert.deepEqual(page.args, [900, 900, "e-last", 6]);
    assert.equal(db.counts().length, 0);
    assert.equal(result.paging.total, null);
    assert.equal(result.paging.next, null, "a short page has no next cursor");
  });

  it("returns a next cursor when more rows exist, dropping the probe row", async () => {
    const db = recordingDb({ rows: [row(1), row(2), row(3)] });
    const result = await listEntries({ DB: db }, { limit: 2 });

    assert.equal(result.entries.length, 2);
    assert.equal(result.paging.has_more, true);
    assert.equal(result.paging.next, "998:e2", "cursor is the last returned row");
  });

  it("rejects a malformed cursor", async () => {
    const result = await listEntries({ DB: recordingDb() }, { before: "nonsense" });
    assert.equal(result.status, "invalid");
  });

  it("lean mode skips the name joins", async () => {
    const db = recordingDb({ rows: [row(1)] });
    await listEntries({ DB: db }, { lean: true });
    assert.doesNotMatch(db.pages()[0].sql, /LEFT JOIN/);

    const full = recordingDb({ rows: [row(1)] });
    await listEntries({ DB: full }, {});
    assert.match(full.pages()[0].sql, /LEFT JOIN customers/);
  });
});

describe("entryBounds", () => {
  it("reports the earliest and latest start", async () => {
    const result = await entryBounds({ DB: recordingDb({ bounds: { min_start: 5, max_start: 77 } }) });
    assert.deepEqual(result, { status: "ok", minStart: 5, maxStart: 77 });
  });

  it("is null/null for an empty database", async () => {
    const result = await entryBounds({ DB: recordingDb({ bounds: { min_start: null, max_start: null } }) });
    assert.equal(result.minStart, null);
  });
});
