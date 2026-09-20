# Product ideas and voice task capture plan

**Date:** 2026-09-20
**Inputs:** current Timetracker codebase, `docs/uiux-doc.md`, `docs/uiux-meeting.md`, and the request for client/project/task visuals plus Gemini voice capture.

## 1. Product direction

The product is strongest when it makes the first useful action obvious: decide where work belongs, start the clock, and later understand the result. New features should reinforce that loop rather than turn the tracker into a crowded project-management suite.

## 2. Brainstorm: feature opportunities

### Identity and recognition

1. **Client identity** - optional low-resolution avatar/logo stored as a client-side resized base64 data URL in D1. Show it in Settings, client detail, dashboard client rows, and the timer context.
2. **Project identity** - optional low-resolution image stored as a client-side resized base64 data URL in D1; show it beside project names in Settings, detail pages, dashboard rankings, and the timer form.
3. **Activity/task identity** - emoji now for instant scanning; optional low-resolution base64 image for a richer task/category identity. Use it in activity lists, ledger links, dashboard breakdowns, and voice-created drafts.
4. **Color accents** - a small curated accent choice per client/project, constrained to the design token palette rather than arbitrary hex values.

### Faster capture

5. **Voice task capture (this pass)** - record a short audio note, send it to Gemini through the Worker, receive strict JSON, map recognized client/project/activity names to existing records, and fill a draft. Never auto-start billable time.
6. **Quick-add command palette** - keyboard shortcut to start a timer, open a client, or create a manual entry.
7. **Natural-language manual entry** - type “45 minutes on Acme website review yesterday” and turn it into a reviewable draft.
8. **Recent-task shortcuts** - one-click “start again” for the most recent client/project/activity combinations.

### Workflow and planning

9. **Task inbox** - separate non-billable task ideas from time entries; tasks can be promoted into a timer entry after review.
10. **Recurring tasks** - weekly/monthly prompts for repeated client work.
11. **Due dates and priorities** - useful only after a true task entity exists; do not overload time entries.
12. **Calendar integration** - turn meetings into reviewable time drafts, never silently bill calendar duration.
13. **Idle reminders** - optional local notifications when a timer has run unusually long; user-controlled and privacy-preserving.

### Reporting and intelligence

14. **Client/project health** - fixed-budget burn-down, utilization, and remaining estimate.
15. **AI summaries** - summarize notes/tags for a selected period, with explicit “draft only” language and no automatic external sharing.
16. **Anomaly checks** - flag missing descriptions, unusually long entries, or entries with no rate before export.
17. **Approval/export workflow** - lock a period after review and export a signed report.

### Collaboration and infrastructure

18. **R2 asset storage** - private upload, content-type/size validation, signed URLs, thumbnails, and deletion policy.
19. **Multi-user/team roles** - required before shared task inboxes or approvals; every query needs `user_id`/workspace scoping.
20. **Offline/PWA queue** - idempotent entry writes and conflict resolution before enabling offline capture.

## 3. Prioritization

| Priority | Feature | Reason |
|---|---|---|
| P0 (this pass) | Optional identity metadata: client-side resized base64 images + activity emoji | Small schema/API/UI change, immediately improves recognition, no external service required |
| P0 (this pass) | Gemini voice-to-draft | Directly reduces capture friction while keeping the user in control |
| P1 | Recent-task shortcuts + command palette | High-frequency speed improvement without changing the data model |
| P1 | Natural-language manual entry | Complements voice and works in quiet/public environments |
| P1 | R2 uploads | Better than URL-only identity once real asset ownership is needed |
| P2 | Task inbox / recurring tasks | Requires a separate task model instead of overloading time entries |
| P2 | Calendar integration / AI summaries | Valuable after privacy, review, and consent UX is settled |
| P3 | Teams, approvals, offline, advanced forecasting | Architectural scope; should follow workspace/user modeling |

## 4. Implementation plan for this pass

### Data model

Add nullable fields:

- `customers.image_url` - optional HTTPS/HTTP client avatar/logo URL.
- `projects.image_url` - optional HTTPS/HTTP project image URL.
- `activities.emoji` - optional short emoji label for a task/activity.
- `activities.image_url` - optional HTTPS/HTTP task/activity image URL.

Update `db/schema.sql` and add the dated additive migration (matching this repository's existing migration convention). Existing rows remain valid and render their normal names when metadata is absent.

### Worker API

- Extend create/update customer/project/activity validation to accept the metadata.
- Include metadata in bootstrap and existing detail responses through `SELECT *`.
- Add `POST /api/voice/parse`:
  - Request: `{ audioBase64, mimeType }`.
  - Requires `env.GEMINI_API_KEY`; otherwise returns a clear 503 configuration error.
  - Calls Gemini from the Worker, never from the browser, so the key is not exposed.
  - Uses a strict JSON schema/prompt for `description`, `tags[]`, `client`, `project`, `activity`, and optional `hourlyRate`.
  - Validates response size/type and returns a reviewable draft only.
  - Does not create an entry, start a timer, or mutate D1.

### Web UI

- Add identity fields to Settings manage forms and rows using a client-side file picker. Resize images to a maximum 256×256, encode as bounded JPEG/WebP data URLs, show a preview, and allow clearing before save.
- Add a reusable `IdentityMark` component: image when valid, otherwise emoji/initials, always with meaningful accessible text.
- Add `VoiceTaskCapture` to the timesheet form. Use `MediaRecorder` when available, show recording/processing/error states, and send the resulting audio to the Worker.
- Match Gemini's returned names to active bootstrap records case-insensitively. If a match is missing, show the recognized text for the user to choose; do not silently invent a client/project/activity.
- Applying a voice draft populates the existing timer form. The user must still click **Start timer**.

## 5. Safety and privacy decisions

- Gemini API access is server-side only; `GEMINI_API_KEY` is a Worker secret.
- Audio is sent only after an explicit Record → Stop → Process action.
- The Worker does not persist audio or Gemini transcripts; the UI keeps only the current draft in memory.
- Voice output is untrusted input: length, field types, tags, and rate ranges are validated before returning it.
- No automatic timer start, task creation, billing, or external sync follows voice parsing.
- If Gemini is unavailable, the normal manual timer flow remains unchanged.
- Images are deliberately stored as bounded client-generated data URLs in D1; no external asset storage or R2 is required. The UI rejects oversized output before it reaches the Worker.

## 6. Acceptance criteria

- Existing seeded data works unchanged after the migration.
- Client/project/activity metadata can be created and edited in Settings.
- Empty metadata never produces broken-image noise; initials/emoji fallback works.
- Missing Gemini configuration gives a useful UI error, not a broken recording flow.
- A successful voice parse fills a draft but never starts the timer automatically.
- `cd worker && npm test` and `cd web && npm run build` pass.
- Results and any limitations are appended to this document.

## 7. What actually happened

Implemented the P0 slice as planned.

### Identity metadata

- Added `customers.image_url`, `projects.image_url`, `activities.emoji`, and `activities.image_url` to `db/schema.sql` (the column names remain for migration compatibility, but now contain image data URLs rather than remote URLs).
- Added `db/migrations/2026-09-20-identity-metadata.sql` and applied it to the local D1 database.
- Added a browser-side image picker that accepts either a local file upload or an image pasted from the clipboard, resizes to at most 256×256, compresses to JPEG, and rejects output above the bounded 180 KB data-URL limit before saving.
- Extended Worker create/update validation to accept only bounded `data:image/(jpeg|jpg|webp|png);base64,...` values; remote URLs are rejected so images cannot bypass the client-side conversion; activity emoji is limited to 8 Unicode characters.
- Settings manage forms now select, paste, preview, replace, clear, and save client/project/activity images plus activity emoji.
- `IdentityMark` falls back to emoji/initials if a stored image cannot render.
- Added `IdentityMark`, which shows an image when available and falls back to activity emoji or initials.
- Identity marks appear in manage rows, dashboard ranking rows, and client/project/activity detail headers.
- Dashboard aggregate rows now carry the relevant identity metadata for those marks.

### Gemini voice-to-draft

- Added `POST /api/voice/parse`.
- The Worker calls Gemini server-side using `GEMINI_API_KEY`; the browser never receives the key.
- The request uses a strict JSON response schema for client, project, activity, description, tags, and optional hourly rate.
- Added `VoiceTaskCapture` to the timer form using `MediaRecorder`.
- Voice output is matched to active bootstrap records case-insensitively and applied to the existing form fields.
- The user still has to review the draft and click **Start timer**. Voice never creates a time entry, starts a timer, bills time, or syncs externally.
- Missing configuration returns HTTP 503 with a clear message; recording/browser permission failures remain local UI errors.
- Audio and transcripts are not persisted by the Worker.

### Configuration

For local or production Worker use:

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
# Optional model override in wrangler.toml or environment:
# GEMINI_MODEL = "gemini-2.5-flash"
```

Without `GEMINI_API_KEY`, manual time tracking remains fully functional and the voice control reports that it is not configured.

### Verification

- Local migration: applied successfully to the local D1 database.
- `cd worker && npm test`: **8/8 passed**.
- `cd web && npm run build`: clean after the upload/paste picker and voice controls.
- Local Worker bootstrap confirmed the new nullable metadata columns.
- Worker voice endpoint without a configured key returned the expected HTTP 503; no external Gemini request was made.
- Image storage contract is enforced in Worker validation: remote URL input is rejected and oversized data URLs are rejected.

### Intentionally deferred

- R2/direct external storage; client-side resizing plus bounded D1 data URLs is the selected storage strategy for this app. The database columns are `TEXT` and contain the complete small data URL.
- Automatic task creation or timer start from voice; this would create billable side effects without confirmation.
- A separate task inbox; activities/time entries are not yet a true task model.
- Gemini transcript persistence, model analytics, and cost tracking; these require explicit retention and privacy decisions.

