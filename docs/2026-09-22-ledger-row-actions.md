# Ledger row actions - plan & task list

**Date:** 2026-09-22
**Source:** user feedback - hover "Continue this task" play button never visible; wants a three-dot row menu (Edit / Duplicate / Start again / Delete with confirmation); wants a running timer to be editable in place, where filling in an end time stops it.

## Diagnosis: invisible hover play button

The play button from `feat(ledger)` (commit `660e7d1`) is absolutely positioned at
`-left-8` inside the date cell. The table sits in an `overflow-x-auto` wrapper, so the
button is clipped outside the container's left edge and never renders. Fix: render it
inline before the date text in a permanently reserved slot (~24px) - no layout shift,
no clipping. The kebab menu's "Start again" is the second entry point for the same action.

## I. Worker (contract changes)

- [x] **T1 - Editable running entries.** `updateTimeEntry` (`worker/src/core.js`) currently
  refuses running rows (`Stop the timer before editing this entry`, and the UPDATE is
  guarded `AND is_running = 0`). New behavior, branched on `current.is_running`:
  - All fields stay patchable: `customerId`, `projectId`, `activityId`, `description`,
    `tags`, `startTime`, `hourlyRate`. Same ref/project/task/currency validation as the
    closed path.
  - `endTime` absent → the entry keeps running: fields updated, `duration_seconds`/`cost`
    stay 0, `is_running` stays 1.
  - `endTime` present → manual stop: must be `> startTime`; UPDATE sets `is_running = 0`,
    `end_time`, `duration_seconds`, `cost` with `WHERE id = ? AND is_running = 1` and a
    `meta.changes` check (same race discipline as `stopTimer`), so two concurrent
    stop-edits cannot both succeed.
  - No websockets/polling anywhere - "realtime" means one request per action and the
    existing bootstrap reload on save.
- [x] **T2 - Delete entries.** New `deleteTimeEntry(env, id)` + `DELETE /api/entries/:id`
  route. Closed rows: hard delete (404 when unknown). Running rows: 409
  `"Stop the timer before deleting this entry"` - the running row is still the live timer.
- [x] **T3 - AGENTS.md contract bullet.** `PATCH /api/entries/:id` line drops
  "Running entries must be stopped first"; documents the endTime-stops-the-timer
  behavior and the new `DELETE /api/entries/:id`.

## II. Ledger UI (`web/src/components/Ledger.jsx`)

- [x] **T4 - Hover play fix.** Inline button in the date cell, reserved slot, revealed on
  `group-hover`/focus. Tooltip "Continue this task"; disabled with "Stop the running
  timer first" while a timer runs; never for the running row, rows missing FK ids, or
  print (`no-print`). Ledgers without an `onContinue` handler (detail pages, print page)
  render nothing extra.
- [x] **T5 - Kebab menu.** New `kebab` (⋮) icon in `Icon.jsx`. A `RowMenu` component
  (in `Ledger.jsx`) renders the actions column button; positioned `position: fixed` via
  `getBoundingClientRect` because a daisyUI dropdown would get clipped by the table's
  `overflow-x-auto` (same trap as the emoji picker, audit T14). Closes on outside
  click/Escape/scroll. Closed rows: Edit, Duplicate, Start again, Delete. Running row:
  Edit only. New Ledger props: `onDuplicate`, `onDelete`
  (`onEdit`/`onContinue`/`canContinue` already exist). Only `TrackerPage` passes them.
- [x] **T6 - Duplicate = instant closed copy.** `POST /api/entries` (the existing
  closed-entry create route) with the row's own customer/project/activity, note, tags,
  rate, start and end times. New entry appears in the ledger after the standard reload.
- [x] **T7 - Delete confirmation.** New small `ConfirmDialog` component (modal, danger
  confirm, busy state): "Delete this entry? … This cannot be undone." Confirm calls the
  new endpoint; cancel does nothing.

## III. Running-entry editor (`web/src/components/EntryEditor.jsx`)

- [x] **T8 - Running mode.** When the entry `is_running`: title/copy switches to "Edit
  running entry", the Ended field starts empty with placeholder "Still recording - fill
  in to stop", and the duration/amount preview only shows once an end time is entered.
- [x] **T9 - Save semantics.** Ended left blank → PATCH omits `endTime` (timer keeps
  running, other fields updated). Ended filled → PATCH includes `endTime`; the worker
  stops the timer; the bootstrap reload that follows clears the TopTimerBar, re-enables
  the tracker form, and closes the ledger row into a normal entry.

## IV. API wrappers (`web/src/lib/api.js`)

- [x] **T10 -** `deleteTimeEntry(id)` (DELETE) and `createTimeEntry(payload)` (POST
  `/api/entries`) wrappers; `TrackerPage` wires Duplicate and Delete through `runAction`.

## V. Verification

- [x] **T11 - Worker tests** (`worker/test`, node --test): running PATCH keeps the timer
  running with fields updated; running PATCH with `endTime` stops it and writes
  duration/cost; running PATCH with `endTime <= startTime` → 400; DELETE closed → gone;
  DELETE running → 409; DELETE unknown → 404.
- [x] **T12 - Gate + smoke.** `npm run verify` inside a `node:22-slim` docker container
  (wrangler needs Node ≥ 22; host node_modules bind-mount fine - same linux/x64
  binaries), plus curl smoke of running-PATCH-stop and DELETE against the temporary
  server.
