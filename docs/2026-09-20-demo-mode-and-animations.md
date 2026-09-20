# Demo Mode & UI Animations

**Date:** 2026-09-20
**Scope:** demo deployment experience + subtle UI animations across the web app.

## 1. Demo mode

### Configuration

- `VITE_DEMO_MODE=true` environment variable toggles demo mode.
- Exposed as `import.meta.env.VITE_DEMO_MODE` in client code.
- Worker env var `DEMO_MODE=true` enables the reset endpoint.

### Entry flow (demo only)

1. **Splash screen**: SVG logo (clock/timer motif) animates in with a scale + fade.
2. **Progress bar**: fills over 1.2s with the accent color.
3. **Onboarding**: first-run guidance banner after splash completes.

### Demo deployment banner

- Persistent banner below the header: "This is a demo deployment with sample data."
- Links to the settings page.
- Dismissible per session (sessionStorage).

### Reset button

- `POST /api/demo/reset` endpoint on the worker.
- Resets D1 to seed state: clears time entries, re-seeds customers/projects/activities.
- Button appears in:
  - Top timer bar area (when demo mode is on)
  - Settings page
- Confirmation dialog before reset.

### Demo seed data

- `scripts/seed-demo.mjs` script that populates:
  - 3 clients with different currencies
  - 5 projects (mixed hourly/fixed)
  - 6 activities (Development, Design, Meeting, Testing, Review, Documentation)
  - 20 closed entries across 3 months
  - 1 running entry

## 2. UI animations

### Animation system

Pure CSS/Tailwind — no new dependencies. All animations respect `prefers-reduced-motion`.

### Where animations apply

| Surface | Animation | Duration |
|---|---|---|
| Page navigation | fade-in + slight upward slide | 200ms |
| Splash logo | scale from 0.8 → 1.0 + fade | 400ms |
| Splash progress bar | width 0% → 100% | 1200ms |
| Toast/banner enter | slide down + fade | 200ms |
| Toast/banner exit | fade out | 150ms |
| Button press | scale 0.98 → 1.0 | 100ms |
| Modal/dialog | fade + scale 0.95 → 1.0 | 200ms |
| Empty state → content | fade | 300ms |
| Running timer pulse | subtle opacity pulse on accent dot | 2s loop |

### CSS classes

```css
.animate-fade-in { animation: fadeIn 200ms ease-out; }
.animate-slide-down { animation: slideDown 200ms ease-out; }
.animate-slide-up { animation: slideUp 200ms ease-out; }
.animate-scale-in { animation: scaleIn 400ms ease-out; }
.animate-progress { animation: progressFill 1200ms ease-in-out forwards; }
```

All wrapped in `@media (prefers-reduced-motion: no-preference)` so they vanish for users who prefer reduced motion.

## 3. Implementation order

1. Plan doc (this file).
2. Worker: demo reset endpoint + demo seed script.
3. Web: splash screen component with logo SVG + progress bar.
4. Web: demo mode banner + reset button.
5. Web: animation CSS classes + apply to pages/toasts/buttons.
6. Web: entry flow orchestration (splash → onboarding → app).
7. Verify: build, worker tests, live smoke.
8. Update AGENTS.md + task list.

## 4. Acceptance criteria

- `VITE_DEMO_MODE=true` shows splash → progress → onboarding → banner.
- Reset button clears and re-seeds demo data without page reload.
- All animations work in light and dark themes.
- `prefers-reduced-motion` disables all animations.
- No new npm dependencies added.
- Web build clean, worker tests pass.

## 5. What actually happened

Implemented 2026-09-20. All items from §3 executed in order.

### Worker

- Added `resetDemoData(env)` to `worker/src/core.js` — clears `time_entries`, upserts 2 clients, 3 projects, 4 activities, and 5 closed entries using `INSERT OR IGNORE` so the script is idempotent.
- Added `POST /api/demo/reset` route in `worker/src/index.js` — guarded by `env.DEMO_MODE`; returns 403 when demo mode is off.
- Added `GET /api/demo/status` — returns `{ demoMode: boolean }` so the client can detect demo mode without a page-level env var.
- Added `DEMO_MODE = "false"` to `worker/wrangler.toml` `[vars]` — set to `"true"` for demo deployments.
- Created `scripts/seed-demo.mjs` — standalone script that re-seeds the standard demo dataset via `wrangler d1 execute`.

### Web

#### Animation system

Added pure-CSS utility classes in `web/src/index.css`:

- `animate-fade-in` — 200ms opacity fade.
- `animate-slide-down` — 200ms slide down + fade.
- `animate-slide-up` — 200ms slide up + fade.
- `animate-scale-in` — 400ms scale from 0.85 → 1.0 + fade.
- `animate-progress` — 1200ms width fill for the splash progress bar.
- `animate-pulse-dot` — 2s infinite opacity pulse for the running-timer indicator.
- `animate-fade-out` — 400ms fade out for splash dismissal.
- `page-enter` — 250ms slide-up for page content transitions.

All gated behind `@media (prefers-reduced-motion: no-preference)` so they vanish for users who prefer reduced motion. Duration and `animation-iteration-count` are clamped in the `reduce` block.

#### Splash screen

Created `web/src/components/SplashScreen.jsx`:

- SVG clock logo (circle, hour marks, hour hand, minute hand) scales in over 400ms.
- "Timetracker — Billable hours, clearly kept." text fades in.
- Progress bar fills with the accent color over 1200ms.
- Whole screen fades out over 400ms.
- Total visible time ≈ 2s.
- Calls `onDone()` when complete; stored in `sessionStorage("cf-tt-splash-seen")` so it shows once per session.

#### Demo mode integration

- `App.jsx` detects demo mode via `GET /api/demo/status` on mount.
- Persistent banner below the header (demo only): "This is a demo deployment with sample data." with links to Settings and a Reset button.
- Banner is dismissible per session via `sessionStorage("cf-tt-demo-banner-dismissed")`.
- "Reset demo" button in the TopTimerBar (visible only in demo mode).
- Confirmation dialog before reset; reloads the page after success.

#### Settings page

- New "Demo mode" section (demo only): explains sample data, provides a "Reset demo data" button with the restore icon.
- Section is hidden entirely when demo mode is off.

#### Page transitions

- Page content wraps in a `<div key={pageKey} className="page-enter">` that re-animates on route change.
- The running-timer dot now pulses with `animate-pulse-dot`.

#### Icon

- Added `info` icon (circle with "i") for the demo banner.

### Verification

- Worker tests: **17/17 passed**.
- Web build: clean, 62 modules, CSS 114.67 kB, JS 317.22 kB.
- No new npm dependencies added.
- `prefers-reduced-motion` respected (all animation classes clamped to 0.01ms).

### How to enable demo mode

```toml
# worker/wrangler.toml
[vars]
DEMO_MODE = "true"
```

Then restart `wrangler dev`. The client will detect it via `GET /api/demo/status`.
