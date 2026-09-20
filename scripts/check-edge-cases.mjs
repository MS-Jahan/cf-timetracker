#!/usr/bin/env node
/**
 * Edge-case pass (task list T-Q1). Requires a running, seeded API:
 *
 *   node scripts/check-edge-cases.mjs [apiBase]        # default http://127.0.0.1:8787
 *
 * Proves, against the real surface:
 *   1. double start → exactly one 200, the other 409 (code timer_running)
 *   2. stop with no timer → 404 (code no_active_timer)
 *   3. month-boundary attribution: an entry started 1 min before a UTC month boundary
 *      and stopped 1 h after it must count fully in the PREVIOUS month (attribution is
 *      by start_time) and not at all in the current month
 *   4. CSV/DB reconciliation: the entry's CSV row (1.02 h / 101.67) matches the DB sums
 *      the /api/summary totals moved by
 *   5. MCP parity: initialize + tools/list + tools/call query_summary totals equal the
 *      REST /api/summary totals for the same month
 *
 * Leaves one closed probe entry behind (description: "edge-case-probe"); the script
 * prints the exact cleanup command. It never deletes data itself.
 */

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✔" : "  ✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function call(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let json = null;
  try { json = await res.json(); } catch { /* 204s etc. */ }
  return { status: res.status, json };
}

const j = (v) => JSON.stringify(v);

async function main() {
  console.log(`edge-case pass against ${base}\n`);

  // ---- 0. clean slate: make sure no timer is running --------------------------
  let boot = await call("/api/bootstrap");
  if (boot.json?.activeTimer) {
    console.log("  note: a timer was already running; stopping it first");
    await call("/api/timer/stop", { method: "POST" });
    boot = await call("/api/bootstrap");
  }
  const { customerId, projectId, activityId } = pickRefs(boot.json);

  // ---- 1. double start --------------------------------------------------------
  const startArgs = {
    customerId, projectId, activityId,
    description: "edge-case-probe",
    hourlyRate: 100,
  };
  const [first, second] = await Promise.all([
    call("/api/timer/start", { method: "POST", body: j(startArgs) }),
    call("/api/timer/start", { method: "POST", body: j(startArgs) }),
  ]);
  const runningId = first.json?.timer?.id;
  check("double start: exactly one 200", [first.status, second.status].filter((s) => s === 200).length === 1,
    `${first.status}/${second.status}`);
  const conflict = [first, second].find((r) => r.status !== 200);
  check("double start: loser gets 409 timer_running", conflict?.status === 409 && conflict.json?.code === "timer_running",
    conflict ? `${conflict.status} ${conflict.json?.code}` : "none");

  // ---- 2. stop, then stop with no timer ---------------------------------------
  const stopped = await call("/api/timer/stop", { method: "POST" });
  check("stop running timer: 200", stopped.status === 200 && stopped.json?.timer?.is_running === 0);
  const probeSecondsBeforePatch = stopped.json?.timer?.duration_seconds || 1;
  const stoppedAgain = await call("/api/timer/stop", { method: "POST" });
  check("stop with no timer: 404 no_active_timer",
    stoppedAgain.status === 404 && stoppedAgain.json?.code === "no_active_timer",
    `${stoppedAgain.status} ${stoppedAgain.json?.code || ""}`);

  // ---- 3. month-boundary attribution ------------------------------------------
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const prevMonthKey = new Date(monthStart - 1).toISOString().slice(0, 7);
  const curMonthKey = now.toISOString().slice(0, 7);
  // Starts 1 min before the boundary, ends 1 h after it → 3660 s, cost 101.67 @ 100/h.
  const startTime = monthStart - 60_000;
  const endTime = monthStart + 3_600_000;

  const before = {
    prev: (await call(`/api/summary?month=${prevMonthKey}`)).json?.totals,
    cur: (await call(`/api/summary?month=${curMonthKey}`)).json?.totals,
  };

  const patched = await call(`/api/entries/${encodeURIComponent(runningId)}`, {
    method: "PATCH",
    body: j({ startTime, endTime }),
  });
  check("PATCH onto the month boundary: 200", patched.status === 200,
    patched.status === 200 ? "" : patched.json?.error || "");

  const after = {
    prev: (await call(`/api/summary?month=${prevMonthKey}`)).json?.totals,
    cur: (await call(`/api/summary?month=${curMonthKey}`)).json?.totals,
  };
  const dPrev = after.prev.total_seconds - before.prev.total_seconds;
  const dCur = after.cur.total_seconds - before.cur.total_seconds;
  check("boundary entry counts in the PREVIOUS month only (3660 s)", dPrev === 3660, `prev delta ${dPrev} s`);
  check("current month loses exactly the probe's pre-patch seconds (nothing else moves)",
    dCur === -probeSecondsBeforePatch, `cur delta ${dCur} s (probe was ${probeSecondsBeforePatch} s)`);
  const dCost = Number((after.prev.total_cost - before.prev.total_cost).toFixed(2));
  check("boundary cost = 3660 s × 100/h = 101.67", dCost === 101.67, `prev cost delta ${dCost}`);

  // ---- 4. CSV/DB reconciliation -----------------------------------------------
  boot = await call("/api/bootstrap");
  const probe = boot.json.entries.find((e) => e.id === runningId);
  check("CSV row for the probe: 1.02 h", probe && (probe.duration_seconds / 3600).toFixed(2) === "1.02",
    probe ? `${(probe.duration_seconds / 3600).toFixed(2)} h` : "probe missing from bootstrap");
  check("CSV row for the probe: 101.67", probe && Number(probe.cost).toFixed(2) === "101.67",
    probe ? `${Number(probe.cost).toFixed(2)}` : "");

  // ---- 5. MCP parity ----------------------------------------------------------
  const init = await call("/mcp", {
    method: "POST",
    body: j({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "edge-cases", version: "0" } } }),
  });
  check("MCP initialize", init.status === 200 && Boolean(init.json?.result?.protocolVersion));

  const list = await call("/mcp", { method: "POST", body: j({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  check("MCP tools/list has the 4 tools", (list.json?.result?.tools || []).length === 4,
    `${(list.json?.result?.tools || []).length} tools`);

  const mcpSummary = await call("/mcp", {
    method: "POST",
    body: j({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "query_summary", arguments: { month: prevMonthKey } } }),
  });
  const mcpTotals = JSON.parse(mcpSummary.json?.result?.content?.[0]?.text || "{}")?.totals;
  check("MCP query_summary totals match REST for the same month",
    mcpTotals && mcpTotals.total_seconds === after.prev.total_seconds && mcpTotals.total_cost === after.prev.total_cost,
    mcpTotals ? `${mcpTotals.total_seconds} s / ${mcpTotals.total_cost}` : "no result");

  console.log(`\nprobe entry: ${runningId}`);
  console.log(`cleanup (local): cd worker && npx wrangler d1 execute cf-timetracker --local --command "DELETE FROM time_entries WHERE description = 'edge-case-probe'"`);
  console.log(failures === 0 ? "\nALL EDGE-CASE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

function pickRefs(bootstrap) {
  // The project determines the client (time_entries requires project.customer_id to
  // match), so pick a project first and take its owner — the first customer and first
  // project in the bootstrap lists do not necessarily belong together.
  const p = bootstrap?.projects?.[0];
  const a = bootstrap?.activities?.[0]?.id;
  if (!p?.id || !p.customer_id || !a) {
    console.error("bootstrap has no usable project/activity; seed the database first");
    process.exit(2);
  }
  return { customerId: p.customer_id, projectId: p.id, activityId: a };
}

main().catch((err) => {
  console.error(`edge-case pass could not run: ${err.message}`);
  process.exitCode = 1;
});
