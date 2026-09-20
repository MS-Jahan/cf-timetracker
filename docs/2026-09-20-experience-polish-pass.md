# Experience polish pass

**Date:** 2026-09-20  
**Scope:** finish the existing Timetracker experience without adding new product scope.

## Audit basis

This pass applies the supplied experience guidance to the current interface, especially expectation → action → outcome, visible acknowledgement, actionable empty states, recovery-oriented errors, consistent hierarchy, responsive controls, and accessible feedback.

## Before and after

| Surface | Before | After | User outcome |
|---|---|---|---|
| First timer | The form worked, but the primary next step competed with optional voice capture and the setup order was mostly inferred. | The section explicitly labels the next action, explains the three required choices, and keeps voice capture clearly optional. The primary button has a larger touch target. | A new user can understand what to do first without learning the product first. |
| Missing setup | Tracker guidance linked to Settings, but empty management tables could look unfinished and did not explain the order of setup. | Settings now shows a three-step setup guide and each empty table explains the next record to add. | Users get a concrete recovery path: client → project → activity. |
| Voice capture | Recording and errors were visible but terse; failures did not always explain how to continue. | Recording, processing, success, and error states have distinct copy. A successful parse says the draft is ready for review; errors suggest manual entry. | Voice feels safe and responsive without ever auto-starting a timer. |
| Image picker | Resize errors were visible, but successful processing was silent. | The picker acknowledges “Image ready to save” and tells users to try another image after a processing failure. | Users know whether paste/upload worked before saving a form. |
| Dashboard empty state | The empty report explained that data would appear later. | It now names the Time entries route, provides the first-entry CTA, and states the three required ingredients. | The report becomes a useful starting point instead of a dead end. |

## Implemented changes

- Added a restrained “Your next action” cue to the timer form and clarified the recommended first flow.
- Increased the primary Start timer touch target while retaining the existing daisyUI button language.
- Clarified that voice capture is optional and review-only.
- Added explicit success and recovery feedback to voice capture.
- Added image-ready feedback and actionable image-processing errors.
- Added a three-step setup guide to Settings management.
- Added useful empty states to Clients, Projects, and Activities tables.
- Improved the dashboard empty state with a direct route and setup explanation.

## Safety and behavior preserved

- Voice parsing still only fills a draft; it never starts a timer or creates records.
- Image data is still resized/compressed client-side and stored as bounded base64 data URLs.
- No API, schema, route, archive, theme, or timer behavior changed.
- Existing error, loading, keyboard-focus, and responsive patterns were retained.

## Verification

- `cd web && npm run build` passed after implementation.
- The pass stayed proportionate: no new onboarding system, modal, animation framework, or product feature was introduced.

## Remaining opportunities

- Run a dedicated mobile/tablet screenshot and keyboard sweep across all routes.
- Add field-level validation to master-data forms.
- Consider a visible compact data table beneath the daily chart for all users, not only screen readers.
