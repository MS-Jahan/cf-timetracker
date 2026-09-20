# Frontend Design Pass — timesheet as a ledger

**Date:** 2026-09-19
**Method:** `frontend-design` skill (anthropics/claude-code) — plan against the brief, critique against generic defaults, build, screenshot, revise.
**Applies to:** `web/` presentation layer only. No API, worker or data-model changes.

## 1. The brief

**Subject:** a billable-hours tracker for a small studio, running on Cloudflare behind Zero Trust, with an optional export to a Google Sheet.

**Audience:** the person billing the hours — someone who works in it for ten seconds at a time, all day, and then once a month sends a timesheet to a client.

**Primary job:** start and stop a timer without thinking, and trust the numbers enough to invoice from them.

**Vernacular available to draw on:** ledgers, ruled sheets, punch clocks, the billable hour, red-pen corrections, double-rule totals, column alignment. A timesheet is a form that becomes an invoice.

## 2. Critique of the current UI (before touching anything)

Checked against the skill's list of AI-generated defaults:

| Default it warns about | Present? | Evidence in our own CSS/JSX |
|---|---|---|
| SaaS-card kit: identical rounded cards, one radius, same soft shadow, gradient washes | **Yes, fully** | every section is `card` + `shadow-sm`; body has two radial gradient washes; the wordmark is `bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text` |
| ALL-CAPS eyebrow above every heading | **Yes** | `.section-title` uppercase on Client, Project, Activity, Elapsed, Month, Period, Currency, Rate/hour, API base… |
| Meta strings joined with middle dots | **Yes** | "2 entries · $0.50", "7 entries · $610.50", "6.5 h · $610.00" |
| Monospace for small data labels | Partly | elapsed/durations use `font-mono` — defensible for figures, but it was applied as a texture, not a discipline |
| `WORD — fragment` labels | **Yes** | "Clients — set the per-hour rate used when a project has none" |
| Big number + small label + supporting stats as the hero | **Yes, exactly** | the four stat cards *are* the hero treatment the skill calls the default |
| `→` appended to actions | No | we use ▶/■/⤓/🖨/⇪ glyphs instead (also noise) |

So: the previous pass was the default kit with a gradient on top. The redesign has to earn its look from the subject instead.

## 3. Design plan

### Colour — 4 core values, one accent

| Token | Light | Dark | Role |
|---|---|---|---|
| paper | `#EFF2F5` | `#14181F` | the desk the sheet sits on |
| sheet | `#FFFFFF` | `#1B2029` | the ruled sheet itself |
| ink | `#16233D` | `#E7EBF1` | blue-black ledger ink; all text and rules derive from it |
| rule | `#C9D0D9` / `#94A0AE` | `#2C3440` / `#455063` | hairline and strong rules |
| **red pen** | `#C22B21` | `#E4594C` | **the one bold place:** recording state and totals owed. Corrections are made in red ink on a ledger, so red is spent on "this is live" and "this is the money" |

Deliberately not: cream + terracotta (tell #1), near-black + acid accent (tell #2). The base is *cool* paper, not warm.

### Type — one superfamily, two widths

IBM Plex **Sans** for UI, IBM Plex **Mono** for every figure (durations, rates, totals, clock). Plex was drawn for technical documentation and forms; the mono isn't a decorative texture here — it's what keeps a column of durations aligned when you scan for the wrong one. Benefits: one superfamily, distinct widths, no external font request (self-hosted via `@fontsource`, so Zero Trust and CSP stay intact).

Scale (1.200 minor third, body 15px): `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 2.75rem`. Weights: 400 body, 500 labels, 600 headings. No uppercase anywhere; labels are sentence case at 0.8125rem in ink at 55%.

### Layout — one sheet, ruled

```
masthead   Timetracker ······························  Track  Settings
═══════════════════════════════════════════════════════════════════════
punch      ● Recording   00:14:22                        [ Stop timer ]
           Acme Corp / Website Redesign
           ── form line: Client │ Project │ Activity │ Note │ Tags ──

week       Mo ▁ Tu ▃ We ▅ Th ▂ Fr ▇ Sa · Su ·      12h 45m · $1,690.00
═══════════════════════════════════════════════════════════════════════
ledger     Date      Client    Project   Activity  Duration    Rate  Total
           2025-08-18 Beta LLC API Int.  Testing    01:00:00  $95.00 $95.00
           ...
           ═══════════════════════════════════════════ 06:30:15  $610.00
```

- **Left-aligned, single column, max width 64rem** (a sheet, not a dashboard).
- **Rules do the separating, not containers.** Hairline above each row, strong rule under the header, **double rule above the totals** — the accounting convention for a closed sum.
- **No border radius (0), no shadows, no gradients.** Structure is drawn with lines, so the page reads as a form.
- Numbers **right-aligned in mono**, money to 2 decimals always, durations always `HH:MM:SS`.
- Nav is two underlined words, not pills.

### Principles

1. **One bold place:** the running clock line, in red pen. Everything else is ink on paper.
2. **The sheet is the product:** the ledger table is the page's centre of gravity, not a card at the bottom.
3. **Numbers are the design.** Tabular alignment over decoration; every figure same width, same decimals.
4. **Signal, not texture:** mono = figures only; red = live and owed; no colour is spent on client identity.
5. **It should look like it prints.** The aesthetic's end state is the printed timesheet, so the same rules and columns appear in the PDF.

### What gets cut (the "remove one accessory" pass)

Per-client colour dots, uppercase micro-labels, middle-dot meta strings, the four identical stat cards, gradient wordmark, card shadows, the `▶/■/⤓/🖨/⇪` glyphs, `rounded-2xl` on everything, "Track time"/"Filter & export" section titles that only restate their contents.

## 4. Copy pass (skill §writing)

| Before | After |
|---|---|
| "Track time" / "Filter & export" | (removed — the form and the ledger say what they are) |
| "Start" / "Stop" | "Start timer" / "Stop timer" |
| "Export CSV" / "Print / PDF" | "Download CSV" / "Print timesheet" |
| "Sync now" / "Sync Sheets" | "Send to Google Sheets" |
| "2 entries · $0.50" | "2 entries, $0.50" (comma, not a middle dot) |
| "Could not load from the API" | "Could not reach the API at `<base>`. Check that the worker is running, then try again." |
| "No entries match the current filters." | "No entries in this period. Start a timer, or widen the filters." |
| "Clients — set the per-hour rate…" | "Clients and rates" |

Errors state what happened and what to do; notices reuse the action's own verb ("Timer started", "Timer stopped", "12 entries sent to Google Sheets").

## 5. Build order

1. `main.jsx` — import Plex Sans 400/500/600 + Plex Mono 400/500.
2. `index.css` — two custom daisyUI themes (`ledger`, `ledger-dark`) carrying the tokens above, `--radius-*: 0`, `--depth: 0`; utilities for `.figure` (tabular mono) and `.rule`.
3. `theme.js` — map preference → `data-theme` = `ledger` / `ledger-dark`; `system` removes the attribute and lets `--prefersdark` choose.
4. `App.jsx` — masthead: wordmark in Plex Sans 600, underlined nav, no gradient.
5. `PunchClock.jsx` (new) — the hero: clock, context, start/stop, and the week strip.
6. `WeekStrip.jsx` (new) — last 7 days as a ruled tally, from bootstrap entries.
7. `EntryForm.jsx` (was `TrackerBar`) — one form line with rules between fields.
8. `Ledger.jsx` (was `EntriesTable`) — ruled rows, right-aligned figures, double-rule totals; filters move into the ledger header.
9. `SettingsPage` / `ManagePanel` — form sheet, ruled lists.
10. `print.css` — rules and columns survive; drop the daisyUI colour overrides that are no longer needed.

## 6. Verify

Build; screenshot light and dark at `/` and `/settings`; critique the screenshots against §2 (does anything still read as the default kit?); one full timer cycle; routing; print rules present in built CSS; worker tests untouched.

## 7. What actually happened

Implemented the pass without changing the worker or data model. The product now reads as a timesheet rather than a generic dashboard:

- `IBM Plex Sans` carries the interface and `IBM Plex Mono` carries figures only. The cool paper/ink/red-pen palette remains shared by light and dark themes.
- The shell is a full-height ruled sheet. The masthead is quiet, with only the product name, two route links, and the theme control; the previous strapline and decorative gradient are gone.
- The punch band is the single bold moment. Red means recording or money owed; idle state explains what is true and offers a useful “Use last entry” action.
- The entry form is an aligned responsive grid with sentence-case labels, an explicit billing explanation, and a single anchored start action. On small screens it becomes a readable one-column form rather than a squeezed desktop row.
- The week view is a baseline tally with readable per-day hours and selectable days. Selecting a day filters the ledger and exposes a clear action to return to the period.
- The ledger is the page's centre of gravity: ruled rows, stable mono figures, explicit rate and total columns, a double-rule close, and red only on the amount owed.
- Error and success copy now sits in restrained message bands; lighter text tones were consolidated into `ink-muted` so secondary copy stays legible in both themes.

The implementation also respects reduced-motion preferences. Temporary screenshot-review artifacts were not retained in the app bundle. Build verification remains intentionally lightweight: `cd web && npm run build` is the relevant check for this presentation-only pass.
