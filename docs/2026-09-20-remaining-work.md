# Remaining work audit vs. the phased plan (plan + results)

**Date:** 2026-09-20
**Inputs:** `2026-09-19-initial-prompt-system-architecture.md`, `2026-09-19-phased-plan.md`, `2026-09-19-task-list.md`
**Method:** every phase/task re-checked against the actual repo state (not the checkbox column).

## 1. Audit result

| Phase | Status | Evidence |
|---|---|---|
| P0 docs/scaffolding | ✅ done | all dated docs + `AGENTS.md` + layout exist |
| P1 D1 schema/seed/toolchain | ✅ done | `db/schema.sql` + migrations + seed; verification-log transcript |
| P2 Worker REST | ✅ done | all routes live; single-timer race enforced at the DB level; verification gate |
| P3 MCP | ✅ done | `tools/list` + 4 tools, JSON-RPC envelopes; transcript in task list |
| P4 Web UI | ✅ done | dashboard / timesheet / settings / detail pages, editing, CSV, print, archive, currencies |
| P5 GAS sync | ❌ **not started** | `gas/` contains only `.gitkeep` - T-G1, T-G2, T-G3 open |
| P6 Zero Trust / prod | ⛔ blocked locally | T-W4 (prod origin allowlist), T-Z1-T-Z3 need the owner's Cloudflare account - **deliverable here: a runbook** |
| P7 QA | ◐ partially | double-click/stop-none/MCP compat covered by earlier passes + gate; **month-boundary attribution and CSV-vs-DB reconciliation never executed** (T-Q1); T-Q2 follow-up doc never filed |

Also found: the task list's B5 note is stale (archive shipped 2026-09-19 but the note still says delete is the only strategy); AGENTS.md "known gaps" will change with T-G2/G3.

## 2. Execution plan (this doc's work)

1. **`gas/Code.gs`** (T-G1-G3): secret check, `TimeEntries` sheet + header creation, row mapping, **dedupe on `Entry ID`**, JSON responses `{status:"success",count,skipped}` / `{status:"error"}`.
2. **Worker change:** the sync payload carries the secret in the JSON body. Reason (executed evidence, see §5): GAS Web Apps do not expose arbitrary request headers to `doPost` - only query params and the body. The `X-Gas-Secret` header stays (harmless, future-proof).
3. **Local GAS harness** `gas/test/gas-receiver.test.mjs`: loads `Code.gs` with mocked `SpreadsheetApp`/`PropertiesService`/`ContentService`/`LockService` globals and proves header creation, dedupe (re-sync adds 0 rows), fail-closed secret handling, and row mapping. Wired into `npm run verify`.
4. **`scripts/check-edge-cases.mjs`** (T-Q1): live pass - double-start → one 200/one 409, stop-none → 404, **month-boundary attribution** (create + PATCH an entry onto the last day of the previous UTC month, assert `/api/summary?month=` splits correctly), **CSV/DB reconciliation** (bootstrap sums vs `/api/summary` totals), MCP re-check (`initialize`, `tools/list`, `query_summary` parity with REST).
5. **Runbook** `docs/2026-09-20-deploy-runbook.md` for T-W4/T-Z1-Z3: prod `ALLOWED_ORIGINS`, remote D1 migrations, `wrangler secret put GAS_SECRET`, Pages deploy, Access app + policy, smoke checklist. Executable only by the account owner.
6. **Follow-ups doc** (T-Q2) consolidating every deferred item with pointers; fix stale B5 note; update task list + AGENTS.md; run the full gate.

Not executed here (needs the CF account): T-W4 allowlist value, T-Z1-Z3 live config/deploy. Everything else closes with this pass.

## 3. GAS design decisions

- Sheet `TimeEntries`, header `Entry ID, Date, Customer, Project, Activity, Duration (Hours), Cost, Description, Tags` (matches `CSV_COLUMNS` and the Worker payload field names).
- Secret sources checked in order: `X-Gas-Secret` header (if a future GAS runtime exposes it), `e.parameter.secret` (query string), `payload.secret` (JSON body). Empty `SHARED_SECRET` script property → **fail closed**.
- `LockService` guards concurrent sync appends; ids already present are skipped, and duplicates *within* one payload are skipped too.
- Setup: Script Properties → `SHARED_SECRET` = the Worker's `GAS_SECRET` value; deploy as Web App (Execute as Me, access: Anyone).

## 4. Verification

1. `gas` harness via `node --test` (in the gate).
2. `cd worker && npm test`, `cd web && npm run build` (in the gate).
3. Full `npm run verify` at the end.
4. Live edge-case transcript recorded in the task list (server started/stopped for the run).

## 5. What actually happened (executed 2026-09-20)

- **GAS limitation confirmed by design review, not by a live Google call:** the event object passed to a Web App `doPost` documents `parameter`/`postData` only; there is no `headers`. So the secret must travel in the query string or body. Worker now sends `{ entries, secret }`; header check kept as a no-cost fallback.
- Implemented `gas/Code.gs` exactly as §3. Harness `gas/test/gas-receiver.test.mjs` covers: fresh sheet + header, mapping (5400 s → `1.50`), dedupe across syncs, intra-payload duplicate skip, bad secret fail-closed, unset `SHARED_SECRET` fail-closed, missing payload rejected, `LockService` engaged.
- `scripts/verify.mjs` gained a "GAS receiver tests" step; `worker` sync handler sends the body secret.
- `scripts/check-edge-cases.mjs` written and run against a temporary `wrangler dev`: results in the task list transcript (§ T-Q1).
- Runbook + follow-ups filed; task list checkboxes updated (deployment-only remainder of T-G1-G3 and T-Z* left explicitly open, pointed at the runbook); AGENTS.md gaps updated.
- Final gate: worker tests 8/8, GAS harness 8/8, web build clean, concurrency 1×200/19×409.
