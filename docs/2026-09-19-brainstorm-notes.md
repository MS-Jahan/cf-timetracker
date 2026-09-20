# Brainstorm Notes - cf-timetracker

**Date:** 2026-09-19
**Status:** Design deliberation backing the phased plan
**Spec:** `2026-09-19-initial-prompt-system-architecture.md`

## 1. Goal & success criteria

- Single-user (then small-team) Kimai-lite tracker with one-click timer, monthly timesheet table, CSV export, browser-print PDF, and Sheets backup.
- AI-operable via MCP (`get_active_timer`, `start_timer`, `stop_timer`, `query_summary`).
- Cheap to run: Cloudflare free tiers (Pages + Worker + D1, Zero Trust ≤ 50 users). Minimal request footprint (single-trip `/api/bootstrap`).
- Success = start → stop → filtered view → CSV/print → Sheets row, all smoke-tested with `curl` + UI.

## 2. Constraints

- D1 is SQLite at edge: no long-lived connections, keep queries simple, index `customer/project/start/is_running`.
- Zero Trust sits in front of Pages; Worker must not trust `Allow-Origin: *` in prod.
- GAS Web App deployed "Anyone" is inherently open - needs shared-secret or token check plus `Entry ID` dedupe.
- Browser-print only for PDF - no server renderer, no binary deps in Worker.
- Single active timer is a hard invariant; enforce in SQL/logic, not just UI.

## 3. Approaches considered

### A. Monorepo layout (chosen) vs. split repos
- **Chosen:** one repo (`db/`, `worker/`, `web/`, `gas/`, `scripts/`) per `AGENTS.md`.
- **Why:** one person/small team, atomic contract changes (schema ↔ worker ↔ UI), single dated-docs stream.
- **Trade-off:** Pages + Worker deploy separately anyway; keep their `package.json`/`wrangler.toml` independent.

### B. PDF via `print.css` (chosen) vs. server-side renderer
- **Chosen:** `@media print` + `window.print()` per spec.
- **Why:** zero Worker cost, no Puppeteer/wkhtmltopdf, good enough for timesheets.
- **Follow-up:** dedicated print header (period, customer, totals) hidden on screen.

### C. Sheets sync via Worker forwarding (chosen) vs. direct from browser
- **Chosen:** `POST /api/sync/google-sheets` forwards to GAS.
- **Why:** keeps GAS URL server-side, allows month filtering + audit logging, one place to add auth.
- **Gap to close:** implement `filterMonth`, cap payload size, handle GAS errors/retries.

### D. MCP transport: JSON-RPC POST (now) vs. SSE / Streamable HTTP (later)
- **Now:** `POST /mcp` JSON-RPC 2.0 (`tools/list`, `tools/call`) - matches spec snippet, testable with `curl`.
- **Later:** adopt MCP Streamable HTTP / SSE if Claude Desktop / Cursor requires it; keep tool schemas stable.
- **Gap to close:** implement missing `stop_timer`, `start_timer`, `query_summary` handlers + validation + error envelopes.

### E. Rate resolution: explicit `hourlyRate` on start (spec) vs. inherited customer/project rate
- **Spec behavior:** client sends `hourlyRate`, stored as `rate_applied`.
- **Improvement (Phase 2):** if omitted, resolve `projects.rate → customers.hourly_rate → 0`; document precedence.
- **Why:** avoids $0 entries when UI forgets the rate.

## 4. Key decisions

1. Time in **epoch ms** (`start_time`/`end_time`); billing in integer `duration_seconds`; `cost = duration/3600 * rate_applied`.
2. CRUD for customers/projects/activities is required (spec has reads only) - minimal POST endpoints or D1-seeded + SQL-admin to start; full UI forms in Phase 4.
3. Tags stay opaque strings in Worker; parsing/formatting is a frontend concern.
4. No auth logic in Worker v1 beyond reading `Cf-Access-Jwt-Assertion` / `Cf-Access-Authenticated-User-Email` headers; real enforcement is the Access Application. Tighten CORS origins via env.
5. GAS sheet `TimeEntries` dedupes on `Entry ID`; rejects requests without shared secret.

## 5. Open questions (for owner, non-blocking)

1. Multi-user now or later? (Spec implies single user; schema has no `user_id`.)
2. Currency: single per customer (spec) - need conversion/reporting currency?
3. `filterMonth` format: `YYYY-MM`? Timezone for month boundary (UTC vs local)?
4. MCP clients: which must work day one (Cursor, Claude Desktop, custom)? Dictates transport priority.
5. Domains: Pages + Worker custom domains + Access app hostname?
6. Seed data: real customers/projects or generic Acme/Globex fixtures?

Assumed answers for planning: single user, per-customer currency display only, `filterMonth=YYYY-MM` in UTC, `curl`-compatible JSON-RPC first, `*.pages.dev` + localhost for dev, generic seed fixtures.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Double-running timers (double-click / two tabs) | Server-side `is_running` check + unique partial index; 400 with clear message |
| Clock skew on durations | Server `Date.now()` owns `start/end`; client tick is display-only |
| Sheets duplicates on re-sync | GAS dedupe on `Entry ID`; Worker sends idempotent full-month payloads |
| GAS URL leakage | Store in Worker secret/env, never commit; optional shared-secret header |
| CORS `*` in prod | Env-driven allowlist; `*` only for local dev |
| MCP drift | Version tool schemas; additive changes only |
| D1 free-tier limits | 50-row bootstrap cap, indexed queries, month-filtered sync |

## 7. What this unlocks

Phases in `2026-09-19-phased-plan.md`, checkable items in `2026-09-19-task-list.md`. Build order: DB → Worker REST → MCP → Web UI → GAS E2E → Zero Trust + prod hardening.
