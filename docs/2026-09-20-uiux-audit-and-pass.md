# UI/UX audit and implementation pass

**Date:** 2026-09-20
**Inputs:** `docs/uiux-doc.md`, `docs/uiux-meeting.md`
**Scope:** practical UI/UX improvements to the existing Timetracker interface; no new product scope.

## 1. Design principles applied

The supplied session emphasizes:

- **Expectation → interaction → outcome:** a user should know what page they are on, what action is primary, and what result occurred.
- **Hick's Law:** reduce competing actions and group secondary controls.
- **Fitts's Law:** make the frequent timer action and touch targets easy to reach.
- **Visual hierarchy:** one primary CTA, secondary actions visually quieter, destructive/archive actions distinct.
- **WCAG AA:** target at least 4.5:1 text contrast, visible keyboard focus, semantic labels and live feedback.
- **60/30/10 color balance:** paper/background dominates, ink provides structure, red/blue status accents remain reserved for meaning.
- **Design-system consistency:** reuse daisyUI controls and existing `band`, `field-label`, `rule`, and `ink-muted` tokens instead of adding ad-hoc component styles.

## 2. Audit findings

### A. App shell and navigation

**Strengths:** the left navigation is already responsive, the global timer is always available, theme controls are centralized, and the route structure is clear.

**Friction found:**

- There is no skip link for keyboard users.
- The content region has no explicit `main` landmark/id for assistive technology.
- The compact mobile nav is visually usable but its touch targets and active state need a stronger semantic cue.
- The timer's live elapsed value is visible but the running state can be clearer to screen-reader users.

**Plan:** add a skip link, a named main landmark, robust `aria-current`/labels, touch-friendly nav sizing, and a concise timer live/status description without making the timer itself noisy.

### B. Timesheet / timer flow

**Strengths:** the first-run prompt, client → project cascade, loading/error states, and explicit “Start timer” language are good foundations.

**Friction found:**

- The form's three required selections are not explicitly marked as required to the browser or assistive technology.
- Once filters are changed, there is no single “Clear filters” affordance; users must reset each select manually.
- The filter controls and export actions sit in one visual group despite having different jobs.
- The empty ledger message does not reflect whether filters are active.

**Plan:** mark required fields, add a clear-filters action only when needed, separate filter context from export actions, and make the empty state contextual.

### C. Dashboard

**Strengths:** period selection, configurable sections, empty state, and linked ranked bars provide useful orientation.

**Friction found:**

- The dashboard has a clear heading but the customization panel is visually equal to the reporting content when open.
- The SVG chart has a label/title but no equivalent structured data for keyboard and screen-reader users.
- The page uses loading text but no explicit status semantics.

**Plan:** add clearer customization semantics, a visible chart caption and screen-reader data summary, and loading status semantics. Keep the graph visual unchanged.

### D. Settings and manage panel

**Strengths:** settings is correctly separated from tracking, archive behavior is explained, and forms use shared controls.

**Friction found:**

- The three “new record” areas are visually similar but their purpose is only clear from small labels.
- Save/archive/restore actions lack explicit button types and some destructive archive actions do not explain their consequence at the point of action.
- Sync feedback exists, but the sync control does not communicate its current busy state in its label.

**Plan:** improve section labels and descriptions, add accessible status/busy semantics, and make archive consequences explicit without adding confirmation dialogs that slow routine work.

## 3. Implementation checklist

1. Shell: skip link, landmarks, navigation/timer semantics and touch targets.
2. Timesheet: required inputs, active-filter reset, contextual ledger empty state, grouped controls.
3. Dashboard: accessible daily chart summary, status semantics, customization grouping.
4. Settings/manage: clearer create sections, archive action context, sync busy state.
5. Build verification and result log.

## 4. Before and after comparison

This section records the product situation **before reading/applying the UX documents** and the resulting situation **after this implementation pass**. It is intentionally concrete so future UI work can be compared against the same baseline.

| Area | Before reading the UX guidance / before this pass | After applying the guidance and implementing the pass | User outcome |
|---|---|---|---|
| App shell | Keyboard users had to tab through the sidebar and header before reaching page content; the content region had no direct landmark target. Mobile links worked but were compact, and the running timer was mostly visual. | A visible-on-focus **Skip to main content** link jumps to `#main-content`; the content section is a named focusable landmark; mobile nav links have a larger minimum height; the timer is exposed as a status with an accessible elapsed-time label. | Faster keyboard navigation, clearer orientation, and a timer state that is understandable without relying only on color or sight. |
| Timer setup | Client, project, and activity were visually required but not programmatically marked required. Running-state guidance was spread across the UI. | The three selects use `required` and `aria-required`; the form includes a persistent explanation of required fields and the locked-running-timer rule. | Fewer ambiguous form states and better browser/assistive-technology guidance before the primary action. |
| Ledger filters | Users could change month/client/project filters but had to reset each control manually. Empty results used generic copy even when filters caused the empty state. | A **Clear filters** action appears only when needed; filter/export controls have a group label; empty copy distinguishes “no records” from “no records match these filters.” | Lower recovery cost and clearer cause-and-effect when the list changes. |
| Dashboard chart | The daily SVG chart had a visual label/title but no structured equivalent for users who cannot inspect the graph visually. Loading was plain text without status semantics; customization controls were an ungrouped set of checkboxes. | The graph is a labelled `figure` with a caption and screen-reader-readable daily values; loading is a polite status; customization is a fieldset with a legend. | The same report is more findable and usable with keyboard navigation and assistive technology without changing the visual chart. |
| Settings actions | Save, archive, restore, and create controls were visually consistent but some labels were ambiguous or lacked explicit button semantics. Sync feedback existed but the button did not say it was working. | Save now says **Save changes**; archive explains that history remains; buttons have explicit types; archived toggle exposes `aria-expanded`; create/sync actions say **Adding…** or **Sending…** and expose busy state. | Clearer action outcomes, fewer accidental submissions, and better confidence around reversible/destructive-looking actions. |
| Visual system | The project already had the ledger palette, IBM Plex typography, daisyUI components, focus styling, and reduced-motion support from prior work. | Those foundations were preserved rather than replaced. The pass adds hierarchy and semantics without introducing a second palette, new card language, or decorative motion. | More consistent product behavior and lower visual debt. |
| Responsive behavior | Existing responsive layout rules were present, but the pass had not recorded mobile touch-target and keyboard considerations explicitly. | Navigation targets, form controls, filter recovery, and status messaging were adjusted with narrow layouts in mind; a full device screenshot sweep remains explicitly open. | Better baseline behavior on small screens, with the remaining validation work visible rather than implied. |

## 4.1 Before/after acceptance checklist

- **Expectation:** Before, the active page and timer state were visually clear but less explicit to keyboard and screen-reader users. After, skip navigation, landmarks, `aria-current`, required fields, and status semantics make the expected path explicit.
- **Interaction:** Before, filter recovery and busy actions required interpretation. After, Clear filters, `Adding…`, `Sending…`, `Save changes`, and archive guidance make the next action and current state explicit.
- **Outcome:** Before, empty filtered results and chart-only information could leave some users unsure what happened. After, contextual empty-state copy and an accessible chart data summary explain the result and recovery path.
- **Contrast and hierarchy:** Before, the existing palette was already designed around accessible ink and restrained accent use. After, no competing colors were introduced; semantic states continue to use the existing tokens.
- **Keyboard/accessibility:** Before, no skip link or direct main-content target existed. After, keyboard users can bypass navigation, focus the main content, use labelled controls, and receive polite status feedback.

## 5. Deliberate non-changes

- No new routing, data model, or API behavior.
- No new color system: existing ledger themes and daisyUI tokens remain the source of truth.
- No decorative animation added; reduced-motion support already exists and the product benefits more from clarity than motion.
- No confirmation modal for archive: the existing restore view makes the action reversible and avoids an extra step.

## 6. What actually happened

Implemented the planned pass across four areas without changing the API, schema, routing model, or visual theme.

### Shell and navigation

- Added a keyboard-visible **Skip to main content** link.
- Added `id="main-content"` and `tabIndex="-1"` to the content landmark so keyboard users can move directly past navigation.
- Increased compact navigation link height to a touch-friendly minimum and retained route `aria-current` behavior.
- Marked the running timer as a status region, added a concise accessible elapsed-time label, and preserved the always-available Stop action.

### Timesheet and timer flow

- Marked Client, Project, and Activity selects as required with `aria-required`.
- Added a persistent helper line explaining required fields and the locked-running-timer state.
- Added a contextual **Clear filters** action that appears only when filters are active.
- Added a filter/export group label so assistive technology can distinguish ledger controls.
- Improved the empty ledger message: filtered views now say that no entries match and tell the user how to recover.
- Added explicit `type="button"` to the timer action to avoid accidental form submission behavior.

### Dashboard

- Converted the daily chart wrapper to a labelled figure with a caption describing the date range and total hours.
- Added a screen-reader-only daily data summary, while keeping the visual SVG graph unchanged.
- Marked dashboard loading as a polite live status.
- Changed the customization controls into a fieldset with a legend, clarifying that the checkboxes control dashboard visibility.

### Settings and management

- Added explicit button types to Save, Archive, Restore, and create actions.
- Changed Save copy from the ambiguous `Save` to `Save changes` and retained `Saved` when clean.
- Added archive consequence text through the button title: archive hides a record from new timers while preserving history.
- Added `aria-expanded` to the archived-record toggle.
- Added `aria-busy` and a `Sending…` label while Sheets sync is running.
- Marked settings notices as polite status messages.
- Create actions acknowledge work with `Adding…` while busy.

### Verification

```bash
cd web && npm run build
```

Result: clean Vite build, 57 modules transformed, CSS 96.29 kB, JavaScript 294.22 kB.

## 7. Remaining UX opportunities

These were intentionally not added in this proportionate pass:

- Add a real mobile screenshot/accessibility sweep with a browser session for every route; the code is responsive, but device testing is still valuable.
- Add a visible data-table alternative for the daily graph rather than keeping the accessible values visually hidden.
- Add inline field-level validation for the three master-data create forms.
- Add an explicit sync connection test before sending a full Sheets payload.
- Consider a small persistent “last entry” shortcut on the timesheet once user behavior confirms it is frequently needed.

