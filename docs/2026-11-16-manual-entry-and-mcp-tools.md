# Manual time entry (web) and agent-complete MCP tools - 2026-11-16

## Why
Forgetting to start/stop a timer is routine, and the owner wants to run the whole workflow from an agent (Claude Code) without opening the dashboard: start a timer, stop it, and fix or backfill anything else by talking to it. Today the REST API can create/edit/delete entries, but the web page has no "add past entry" form and MCP has only four tools (`get_active_timer`, `start_timer`, `stop_timer`, `query_summary`), none of which can add, edit or find an entry, or even list the client/project/activity ids that `start_timer` requires.

Version bump: feat = minor, **0.22.0**.

## Part A - MCP tools (server: `worker/src/mcp.js`, `POST /mcp`)

Existing four tools are unchanged (backward compatible). New tools reuse `core.js` (never re-implement writes in the handler); every successful write calls `bumpDataRev(env)` like `start_timer`. Business errors are `{ error, code?, _isError: true }` tool results; bad params are JSON-RPC -32602 (existing `validateArgs`). `mcp`-scope and `full` API tokens may call all tools.

### Time inputs
`startTime`/`endTime` (and `fromTime`/`toTime`) accept **either** epoch milliseconds (number, or a string of digits >= 10 chars) **or** an ISO 8601 string that carries an explicit offset (`2026-11-16T09:30:00+06:00` or `...Z`). An ISO string without an offset is rejected with a clear error ("include a UTC offset, e.g. +06:00"), because the Worker cannot know the user's timezone. Schema type is `["string","number"]`. Implement one helper `parseTimeInput(value)` -> ms or `null`.

### Read tools
| Tool | Args | Returns |
|---|---|---|
| `list_catalog` | `includeArchived?: boolean` | `{ customers:[{id,name,currency,hourly_rate}], projects:[{id,customer_id,name,rate}], activities:[{id,name,emoji}], projectTasks:{ "<projectId>":["<activityId>",...] } }` - compact, active only unless `includeArchived`. Lets an agent map "Acme / Website" to ids. `readOnlyHint`. |
| `list_entries` | `fromTime?`, `toTime?` (both or neither, half-open), `customerId?`, `projectId?`, `activityId?`, `limit?` (default 20, max 100) | `{ entries:[{id,version,customer_id,customer_name,project_id,project_name,activity_id,activity_name,description,tags,start_time,end_time,start_iso,end_iso,duration_seconds,cost,currency,is_running}], returned, has_more }` newest first, includes the running entry. Reuse `listEntries`. `start_iso`/`end_iso` are UTC ISO strings. `readOnlyHint`. |

### Write tools
| Tool | Args | Behavior |
|---|---|---|
| `add_time_entry` | required `customerId`, `projectId`, `activityId`, `startTime`; **exactly one** of `endTime` or `durationMinutes`; optional `description`, `tags`, `hourlyRate` | Backfill a closed entry via core `createTimeEntry`. `durationMinutes` -> `endTime = start + minutes*60000`. Returns `{ success, entry }`. |
| `update_time_entry` | required `id`; optional `ifVersion`, `customerId`, `projectId`, `activityId`, `description`, `tags`, `startTime`, `endTime`, `hourlyRate` | Edit via core `updateTimeEntry(env, id, patch)` (duration/cost recalculated). Works on the running entry too: giving `endTime` **stops** it (this is how to fix a forgotten stop: "stop it at 17:30"). A stale `ifVersion` returns `{ error, code:"entry_changed", entry }`. Returns `{ success, entry }`. |
| `delete_time_entry` | required `id`; optional `ifVersion` | Core `deleteTimeEntry`. Running entry -> error (stop first). Annotation `destructiveHint: true`. |
| `create_customer` | required `name`; optional `currency`, `hourlyRate` | Core `createCustomer`. |
| `create_project` | required `customerId`, `name`; optional `rate`, `budgetType` | Core `createProject` (seeds General + Meeting tasks as usual). |
| `create_activity` | required `name`; optional `emoji` | Core `createActivity` (duplicate name -> error). |

Out of scope (use the web Settings): editing/archiving masters, project task curation, CSV import, Sheets sync, voice.

### Tests (`worker/test/mcp-tools.test.js`, node --test, helpers in `worker/test/helpers/d1-sqlite.js`)
tools/list lists all 12 tools with the original 4 unchanged; `list_catalog` shape + archived flag; `list_entries` filters/limit/includes running; `add_time_entry` with ISO offset, with epoch ms, with `durationMinutes`, rejects offset-less ISO, rejects both/neither of end+duration, rejects unknown ids, cost uses the resolved rate; `update_time_entry` changes times (duration+cost recomputed), stops a running timer via `endTime`, stale `ifVersion` -> `entry_changed`; `delete_time_entry` closed ok / running refused; `create_*` ok + duplicate activity refused; every write bumps `data_rev`; an `mcp`-scope token can call a write tool. Update any existing test that asserts "exactly 4 tools". `npm test` and `npm run verify` must pass.

## Part B - web "Add time entry" (`web/`)
Reuse the existing `EntryEditor` (client, project, task, start, end, note, tags, rate, live duration/cost preview) in a **create mode** instead of building a second form:
- `TrackerPage.jsx`: an **"Add entry"** button (btn btn-sm, `no-print`) near the ledger heading / timer controls opens `EntryEditor` with a blank draft: client/project/task preset to the most recent entry's (else the first client), start = now - 1 h, end = now, empty note/tags, rate = project rate ?? client rate ?? 0 (use the same resolution the form already shows).
- `EntryEditor.jsx`: new optional prop `mode` (`"edit"` default | `"create"`). Create mode: title "Add time entry", primary button "Add entry", no running-timer wording, requires an end time after the start. Everything else is shared.
- Saving calls the existing `createTimeEntry` wrapper in `lib/api.js` through `runAction` (message "Entry added."), then closes. Handle the API's 409/400 messages the same way edit does. Keep `no-print`, daisyUI classes only, no new `@apply` classes, and the conventions in `AGENTS.md`.
- Works in demo mode (the demo's row caps apply: 409 `demo_limit_reached` is shown as the error).
- Build check only (`cd web && npm run build`); no browser testing.

## Docs / release (done by the orchestrator, not the coder)
`AGENTS.md` MCP bullet (12 tools, time-input rule), `README.md` MCP section (example prompts), `CHANGELOG.md` 0.22.0, root `package.json` version, deploy-steps doc untouched.
