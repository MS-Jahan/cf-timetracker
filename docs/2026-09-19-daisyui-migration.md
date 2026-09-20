# daisyUI Migration Plan — cf-timetracker web UI

**Date:** 2026-09-19
**Scope:** `web/` only. No worker, D1, MCP or API changes.
**Reference:** https://daisyui.com/components/ · https://daisyui.com/docs/install/ · https://daisyui.com/docs/themes/
**Status:** Plan of record for this migration; supersede via a new dated doc, not edits after 24h.

## 1. Goal

Replace the hand-rolled component layer in `web/src/index.css` (`.card`, `.btn-*`, `.input`, `.chip`, `.label`, `.table-cell`) with daisyUI components, so future screens get consistent controls, states and theming for free instead of growing that CSS file.

Non-goals: no new features, no layout redesign, no change to the tracker/settings split or the router. The visual language (colorful, dark-mode-capable) must survive; daisyUI themes *are* the color system now.

## 2. Why daisyUI, and what we replace

Today every control is bespoke: ~120 lines of `@apply` in `index.css` plus per-component Tailwind strings. Two costs: (a) Tailwind v4 cannot `@apply` our own classes, so variants restate their base utilities (already a maintenance trap — see the `.chip`/`.card-accent` duplication); (b) states we don't hand-build (disabled, loading, validation, alerts, empty tables) each need custom CSS.

daisyUI supplies those semantics as class names driven by CSS variables.

| Today (custom) | daisyUI | Notes |
|---|---|---|
| `.card`, `.card-accent` | `card` + `card-body` | drop our `@apply` duplication |
| `.btn`, `.btn-primary`, `.btn-success`, `.btn-danger`, `.btn-ghost` | `btn`, `btn-primary`, `btn-success`, `btn-error`, `btn-ghost` | `btn-xs/sm/lg` sizes replace `.btn-xs` |
| `.input` | `input` | `input-sm` for dense rows; `select` for dropdowns |
| `.label` | `label` + `label-text` | keep `text-xs uppercase` utilities for our micro-labels |
| `.chip`, `.chip-neutral`, `.chip-live` | `badge`, `badge-neutral`, `badge-success`, `badge-soft` | activity/tag chips |
| `.dot`, `.pulse-dot` | `status status-success status-lg` | live indicator; keep `animate-pulse` |
| Stat cards (bespoke `div`s) | `stats` + `stat` + `stat-title`/`stat-value`/`stat-desc` | real component for the 4-card row |
| Entries table | `table`, `table-zebra`, `table-pin-rows` | sticky header for free |
| Messages banner | `alert alert-error` / `alert alert-success` | replaces `.messages` |
| Loading screen | `loading loading-spinner` + `skeleton` | replaces the pulsing dot |
| Manage panel disclosure | `collapse` (or keep our button + `card`) | decide during step 5 |
| Sync/`Export` buttons | `btn btn-outline` | |
| Payload/empty states | `alert alert-info` | |

**Deliberately not migrated:** the header nav (daisyUI `tabs`/`menu` active-class names differ between v4 and v5 — our `Link` + `aria-current` styling is already correct and accessible) and the filters row (plain utilities are clearer than a `join` of selects).

## 3. Install & configuration

```bash
cd web && npm i -D daisyui@latest
```

`web/src/index.css`:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

- `--default` makes `light` the fallback theme; `--prefersdark` lets daisyUI switch to `dark` from `prefers-color-scheme` when no `data-theme` is set. That is exactly our "system" preference.
- Keep our `@custom-variant dark (&:where(.dark, .dark *))` for the handful of remaining `dark:` utilities, and keep the `.dark` class in sync with the theme (see below).

## 4. Theme strategy (the only subtle part)

daisyUI themes are selected by a `data-theme` attribute, not a class. We keep one source of truth in `web/src/lib/theme.js`:

| Preference | `data-theme` | `.dark` class | Result |
|---|---|---|---|
| `system` | *removed* | mirrors `prefers-color-scheme` | daisyUI picks light/dark itself; `dark:` utilities follow the media query |
| `light` | `light` | removed | fixed light |
| `dark` | `dark` | added | fixed dark |

`applyTheme()` sets both, so daisyUI components and any remaining `dark:` utility never disagree. The `matchMedia` listener stays for the `system` case. The Settings "Appearance" section and the header toggle keep working unchanged in behaviour.

## 5. File-by-file execution order

1. `web/package.json` — add `daisyui` devDependency.
2. `web/src/index.css` — add the plugin block; **delete** the custom component layer (`.card`, `.btn*`, `.input`, `.label`, `.chip*`, `.dot`, `.table-cell`); keep the body backdrop, `@custom-variant dark`, the `pulse-dot` keyframes, and any class still referenced.
3. `web/src/lib/theme.js` — `data-theme` + `.dark` sync as per §4.
4. `web/src/App.jsx` — shell: `navbar`/header spacing, `btn btn-ghost` for the theme toggle, `loading` for the boot state.
5. `web/src/components/TrackerBar.jsx` — `card`/`card-body`, `select`, `input`, `btn btn-success btn-lg` (start) / `btn btn-error btn-lg` (stop), `status` live dot, `badge` for the billing hint.
6. `web/src/components/StatCards.jsx` — `stats`/`stat` grid, colored via `bg-primary/10`, `text-primary` etc.
7. `web/src/components/EntriesTable.jsx` — `card` + `table table-zebra table-pin-rows`, `badge badge-soft` chips, `status` per client, `alert alert-info` empty state, totals bar on `bg-base-200`.
8. `web/src/components/ManagePanel.jsx` — `card`, `collapse`-style disclosure, `input`/`select`, `btn btn-xs`, `table`.
9. `web/src/pages/TrackerPage.jsx` / `SettingsPage.jsx` — `card`, `alert alert-error`/`alert alert-success` for action errors/notices, `btn btn-outline` for CSV/print/sync, `select` for filters.
10. `web/src/print.css` — extend the print overrides for `badge`, `status`, `stat`, `table` (daisyUI colors come from CSS variables, so force `background: #fff`/`color: #000` in print).
11. `web/src/lib/colors.js` — keep for per-client accents, but express it with daisyUI tokens (`bg-primary`, `bg-secondary`, `bg-accent`, `bg-info`, `bg-success`, `bg-warning`) instead of Tailwind palette classes, so accents follow the theme.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| daisyUI v5 renames v4 classes (`input-bordered`, `tabs-boxed`, `btn-soft`) | after install, **grep the built CSS** for every class we use before screenshotting; verify against the installed version's own CSS |
| Theme and `.dark` drifting apart | both written in one function (`applyTheme`); verified by asserting `data-theme` **and** `classList` in the browser after toggling |
| Print output turning dark | print.css forces white/black for the components we render; verified by grepping built CSS for the `@media print` overrides |
| Rounded/soft look changing the intended "colorful" feel | use `stats`, `badge-soft` and accent-colored cards rather than default grey |
| No VCS safety net (`git log` fails — the repo is not a git repository yet) | rollback is manual: remove the plugin line, `npm uninstall daisyui`, restore the deleted CSS block from this plan's §2 table. **Recommendation: `git init` before this migration.** |
| Bundle size | daisyUI adds only the components used (JIT); measure `dist/assets/*.css` before/after and record it |

## 7. Baseline to beat (measured before the migration)

- `npm run build`: 43 modules, CSS 47.59 kB, JS 260.45 kB
- Worker `npm test`: 8/8 passing (unaffected, recorded only to prove no collateral damage)

## 8. Verification (all recorded in the task list)

1. `cd web && npm run build` clean.
2. Built CSS contains the daisyUI classes actually used (greps for `btn`, `badge`, `stat`, `table-zebra`, `alert`, `status`, `loading`).
3. Browser, light **and** dark: `/` renders stats, tracker, filters, entries table; `/settings` renders appearance, Sheets, manage panel, connection.
4. `data-theme` and `.dark` assertions after each toggle step (system → light → dark).
5. Full timer cycle in the browser (start → tick → stop) and a 409 conflict path still surfaces correctly.
6. Print: built CSS still hides `.no-print`/buttons and shows `.print-header`.
7. `worker/npm test` 8/8 and `node scripts/check-single-timer.mjs` green (proves the migration touched nothing outside `web/`).

## 9. Documentation updates

- `AGENTS.md`: frontend conventions stop describing `index.css` component classes; state that UI uses daisyUI components, that new screens compose daisyUI rather than adding `@apply` classes, and that theme switching writes `data-theme` + `.dark`.
- `docs/2026-09-19-task-list.md`: verification log entry with the measurements from §7/§8.
- This doc: append what actually happened (divergences, not rewrites).

---

## 10. What actually happened (executed 2026-09-19)

Executed in the §5 order. Outcomes and divergences:

- **Version:** daisyUI **5.7.42**, installed as a devDependency; plugin config exactly as §3.
- **CSS size:** `47.59 kB → 83.36 kB` (gzip `7.49 → 13.77 kB`); JS unchanged at `260.5 kB` and still 43 modules.
- **Verified before writing any JSX:** every class name was grepped against `node_modules/daisyui/daisyui.css` — which is how the v4-only names were caught. **`select-bordered`, `input-bordered`, `label-text` and `tabs-boxed` do not exist in v5** (borders are default on `input`/`select`). Badge/status/stat/table/card/alert/join/collapse/navbar/loading all exist.
- **Divergence from §2:** the stat card row uses four `card` + `stat` blocks with `bg-primary/5`, `bg-warning/5`, `bg-info/5` tints rather than a single `stats` container, so the per-card accent colours survive. Navigation uses `tabs tabs-box` (present in v5, unlike `tabs-boxed`) + `tab-active`, which was originally listed as "not migrated".
- **Divergence:** `colors.js` dropped the Tailwind palette classes for daisyUI tokens (`status-primary`, `badge badge-soft badge-primary`, `bg-info`), so accents follow the theme — the plan's step 11.
- **Kept deliberately:** `section-title` and `live-status` as Tailwind v4 `@utility` declarations (not component classes), the `pulse-dot` keyframes, and the theme-aware body backdrop now built from `--color-primary`/`--color-accent` via `color-mix()`.
- **`print.css`:** extended to hide `badge`, `status` and `alert`, and to force white backgrounds since daisyUI colours are CSS variables rather than hard-coded values.
- **Rollback note from §6:** still no VCS; the migration is self-contained (one devDependency + `index.css`/`theme.js`/component classes), so reverting means `npm uninstall daisyui` and restoring the custom layer from §2's table.

The verification results are recorded in `docs/2026-09-19-task-list.md`.
