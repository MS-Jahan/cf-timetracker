# Icon language pass

**Date:** 2026-09-20
**Scope:** add restrained inline icons to existing actions without changing the ledger visual identity.
**Simplification follow-up:** `code-simplifier` pass applied to the recently modified icon, image, and voice components; behavior is unchanged.

## Audit

The interface already uses strong typography, rules, and restrained color. Several controls are text-only, so frequent actions require more scanning than necessary:

- Start/stop timer
- Dashboard, time entries, and settings navigation
- Light/dark/system theme choices
- Filters, Clear filters, CSV, print, retry, and connection checks
- Save, archive, restore, add, and detail links
- Voice capture and image upload/paste

## Icon rules

- Use one small, stroke-based inline SVG component; no new dependency.
- Icons are visual reinforcement, not the only label. Text remains visible on primary actions.
- Use `aria-hidden="true"` for decorative icons and `aria-label` where an icon-only button exists.
- Keep icons at 16–18px, aligned with text, with no emoji substitution for controls.
- Preserve the current palette: primary ink for navigation/actions, accent red for running/destructive states, info for help/connection.
- Do not put icons in every table cell or decorative heading; use them where they improve recognition or status scanning.
- Respect reduced-motion and existing focus-visible styling.

## Planned surfaces

1. `Icon.jsx` reusable icon set: dashboard, clock, settings, play, stop, sun, moon, system, refresh, filter, x/clear, download, print, microphone, upload, save, archive, restore, plus, external/detail, check, alert.
2. App shell navigation and global timer.
3. Theme toggle and Settings appearance controls.
4. Timesheet filters/actions and voice capture.
5. Settings/manage CRUD and archive actions.
6. Retry/connection/detail-page actions.

## Deliberate non-changes

- No icon font, external CDN, or dependency.
- No icon-only primary actions where the text is important.
- No colorful dashboard decoration; icons remain semantic and sparse.

## What actually happened

Implemented the icon pass with one dependency-free inline SVG component: `web/src/components/Icon.jsx`.

### Updated surfaces

- Shell navigation: Dashboard, Time entries, Settings.
- Global timer: Play for Start timer, stop square for Stop timer.
- Theme controls: sun, moon, and system-display icons in the header/settings controls.
- Timesheet: microphone voice capture, stop recording, Clear filters, CSV download, and print.
- Settings: Sheets upload/send, connection refresh, and theme modes.
- Manage panel: plus for create, save/check, archive, restore, and archived toggle.
- Image picker: upload/replace and remove icons.
- Dashboard/detail ranking controls retain text labels and use the shared icon language only where it improves scanning.

### Consistency decisions

- Icons are stroke-only, 16–17px, current-color, and remain paired with text.
- No external icon dependency or CDN was introduced.
- The existing ink/accent/status palette remains unchanged.
- Icon-only controls were avoided for primary actions; labels remain visible for clarity and accessibility.
- `Icon` defaults to `aria-hidden`; a label can opt into an accessible SVG label when needed.

### Verification

```bash
cd web && npm run build
```

Result: clean Vite build, 61 modules transformed, CSS 98.74 kB, JavaScript 305.18 kB.

Worker behavior and data contracts were unchanged by this visual pass.

### Simplification follow-up

Refined recently touched code for readability without changing behavior:

- Extracted theme icon selection into a named helper instead of nested conditional expressions.
- Split voice recording MIME selection and post-recording processing into named helpers; expanded dense one-line branches.
- Split image loading from image resizing and named file/paste handlers.
- Reused explicit `initialKey`/`draftKey` values in the manage-panel draft hook.
- Renamed the Worker image validator to `optionalImageDataUrl` to reflect its actual contract.
- Removed an unnecessary mutable rate binding.

Verification after simplification: worker tests **8/8**, frontend build clean (61 modules transformed).

