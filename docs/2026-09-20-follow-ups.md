# Follow-ups and deferred scope (T-Q2)

**Date:** 2026-09-20
**Closes:** task-list item T-Q2 ("filed follow-ups; no silent scope drops").
**Baseline:** everything in `2026-09-19-initial-prompt-system-architecture.md` §"Out of scope" plus items surfaced by later passes.

## Explicitly deferred from v1 (unchanged intent)

| Item | Why deferred | Where it would start |
|---|---|---|
| Multi-tenancy (`user_id`, team roles) | single-user tool; schema-wide change (every table + every query) | `db/`, `worker/src/core.js` |
| Invoicing / tax | needs per-client totals by period, tax rules, document generation | new `/api/invoices` + dashboard → invoice draft |
| Offline queue / PWA | D1 is the source of truth; conflicts need an idempotent upsert path per entry | `web/` service worker + `worker` upsert endpoint |
| Native mobile | Shared Flutter client now has API URL/token settings, timer flow, period filters, custom range, and server-side Gemini voice drafts; management parity, dashboard aggregates, and offline remain deferred | `docs/2026-09-20-apps-parity-plan.md` |

## Surfaced by later passes (new since the spec)

| Item | Origin | Note |
|---|---|---|
| Fixed-budget burn-down per project | `projects.budget_type = 'fixed'` exists but nothing consumes it | burn-down belongs on `/projects/:id` (needs a `budget_amount` column first) |
| SSE / Streamable HTTP transport for MCP | T-M4 decision: plain JSON-RPC POST for v1 | revisit only when a named client rejects it |
| MCP admin tools (CRUD master data) | `core.js` comment "in future, by MCP admin tools" | tools would wrap the existing `create*/update*/setArchived` functions |
| Tag index + tag detail pages | tags are free-form CSV on `time_entries` | needs a tag table or an FTS index; then `/tags/:tag` |
| Monthly breakdown strip on detail pages | `2026-09-20-detail-pages.md` §6 | one more aggregate per entity endpoint |
| Query-param deep links (`/timesheet?client=`) | same doc | router already parses paths only |
| Verify `Cf-Access-Jwt-Assertion` in the Worker | deploy runbook §5 | Access already gates the route; JWT check is defense-in-depth |

## Open production items (need the account owner, not code)

- T-W4: set prod `ALLOWED_ORIGINS` (runbook §2).
- T-Z1-T-Z3: Access apps, remote D1, secrets, deploys, smoke checklist (runbook §§1-6).
- T-G1-G3 final acceptance: real-Sheets E2E of the deployed Web App (runbook §4) - code and local proof are done (`gas/test/gas-receiver.test.mjs`).

## Deliberately not built (with reasons)

- **Hard delete** of master data: archive covers the workflow; `ON DELETE CASCADE` would orphan history silently. Revisit only with an "export then purge" flow.
- **Server-side PDF rendering**: `@media print` satisfies the requirement; a renderer would add a dependency for the same output.
- **Advanced reporting beyond the dashboard**: not requested yet; the `queryDashboard` aggregate shape is the extension point.
