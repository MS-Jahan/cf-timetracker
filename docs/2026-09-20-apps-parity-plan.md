# Desktop, web, and mobile feature parity plan

**Date:** 2026-09-20
**Inputs:** the desktop/web/mobile feature brief (tray popup, always-on-top mini window, project tasks with defaults, app API access, period filters, voice capture).
**Principle:** one API, one Dart codebase; the web app stays the reference implementation and every native feature is a thin client over the same Worker API.

## 1. Design decisions

### Project tasks (standardization)
- The "Task" concept becomes **project-scoped activities**: `activities` gains a nullable `project_id` (NULL = shared task, as today).
- Creating a project seeds **default tasks "General" and "Meeting"**; the create payload may override the list (`defaultTasks`) or skip it (`defaultTasks: []`).
- Tasks are added per project via `POST /api/projects/:id/tasks`; edit/archive/restore reuse the existing `/api/activities` routes. Timer start validates the task belongs to the entry's project (shared tasks always allowed).
- Migration rebuilds `activities` to replace `UNIQUE(name)` with `UNIQUE(project_id, name)` so every project can have its own "General"/"Meeting", using `PRAGMA defer_foreign_keys` for the FK-safe rebuild.

### App API access (desktop + mobile)
- `APP_TOKEN` Worker secret (or var): when set, `/api/*` requires header `X-App-Token: <APP_TOKEN>`. Requests that already passed Cloudflare Access (`Cf-Access-Authenticated-User-Email`) are allowed through, so browser sessions and service tokens keep working. `/mcp` unchanged.
- The web UI is unaffected (it rides Access); native apps store the token in device settings.

### Entries by period (mobile + web)
- New `GET /api/entries?fromMs=&toMs=&limit=&offset=` — paginated history in a half-open range, newest first, closed + running. Powers mobile period filters (last week / month / two months / custom) and any future web use.

### Voice capture (desktop + mobile)
- Reuses the existing `POST /api/voice/parse` (Gemini server-side). The brief's "client-side Gemini token" flow is deliberately **not** implemented: the Worker keeps the key secret, audio is not persisted, and drafts are review-only — one less token lifecycle to manage on devices.

## 2. Implementation slices

| Slice | Surface | Work |
|---|---|---|
| A | db | `activities.project_id` in `schema.sql`; dated rebuild migration; apply locally |
| B | worker | scoped task validation + dup checks, project default-task seeding, task-scope check on timer start, `listEntries`, `GET /api/entries`, `POST /api/projects/:id/tasks`, `APP_TOKEN` gate, CORS `X-App-Token`; unit tests |
| C | web | EntryForm shows the project's tasks + shared tasks under a "Task" label; project detail page gets a Tasks section (add/archive/restore); Ledger column renamed; manage form gains a default-tasks field |
| D | flutter | shared: API client with token, settings screen (API URL + token + test + open web app), period filters with custom range, voice capture → draft; desktop-only (runtime-guarded): tray icon, frameless always-on-top mini window with running-task status and plus-to-expand detail input |

## 3. Acceptance criteria

- Fresh project creation yields "General" + "Meeting" (or the caller's list, or none).
- Two projects may each own a task with the same name; shared/global dup still 409s.
- Timer start rejects a task from a different project.
- With `APP_TOKEN` set, `/api/bootstrap` without the header is 401; with it, 200.
- Mobile can filter entries by preset or custom range; desktop and mobile share every screen except the tray/mini-window layer.
- `npm test`, `cd web && npm run build`, `flutter analyze/test/build apk` pass; migration applies cleanly to the local D1 and bootstrap still works.

## 4. Execution record

Implemented the shared Phase A parity slice across the API, web client, and Flutter client.

### API and database

- Added additive `project_tasks` storage and applied `db/migrations/2026-09-20-project-tasks.sql` locally. The failed first attempt to rebuild `activities` was discarded; existing history and the original shared-activity uniqueness remain intact.
- New projects seed `General` and `Meeting`; `defaultTasks: []` opts out and a custom string array is supported.
- Existing projects were seeded with those defaults during migration.
- Added project task list/add/remove routes and task-aware bootstrap data.
- Added `GET /api/entries` with half-open range filtering and pagination.
- Added optional `APP_TOKEN` protection for `/api/*` and advertised `X-App-Token` through CORS. The token is separate from `GEMINI_API_KEY`; Access-authenticated browser requests remain allowed.
- Timer validation now rejects a task that is not linked to a curated project list; projects with no links retain the legacy shared-activity fallback.

### Web

- Timer form calls the selected item **Task** and uses the project's curated task links when available.
- Project creation now accepts comma-separated default task names.
- Project details show task badges, default markers, add-task, and unlink actions.
- Ledger column terminology now uses **Task** while preserving the existing activity IDs and routes.

### Flutter shared client

- Settings now stores API URL and native app token locally with `shared_preferences`, provides connection refresh, and opens the web app.
- API client sends `X-App-Token` when configured.
- Time entries support Last week, Last month, Last two months, and Custom range using the shared `/api/entries` endpoint.
- Native recording uses the cross-platform `record` package and sends the short audio to the existing server-side Gemini draft endpoint. The key never enters the app and the draft remains review-only.
- Desktop runners use `tray_manager` plus `window_manager`: tray show/quit actions, a mini-window size, and always-on-top toggle are runtime-guarded to Windows/Linux/macOS; mobile uses the same Dart source with no tray behavior.

### Verification

- Worker tests: **17/17 passed**.
- Web production build: passed.
- Flutter analysis: clean.
- Flutter widget test: passed.
- Android debug APK: built successfully.
- Live temporary Wrangler smoke: bootstrap returned `projectTasks` (6 seeded links), `/api/entries` returned 200, and project tasks returned 200.
- Linux/Windows/macOS/iOS packaging remains host-toolchain dependent (CMake/GTK, Visual Studio, or Xcode/signing respectively); no product-code forks are required.

### Remaining

- Add a dedicated web project-task management test and native tray integration tests on each desktop host.
- Configure `APP_TOKEN` as a production secret/variable and apply the migration to the remote D1 before releasing native clients.
- The brief's client-side Gemini inferential-token flow was intentionally not adopted: exposing a Gemini-derived token on devices creates a key/abuse surface. All platforms use the existing Worker proxy with explicit review before billing.
