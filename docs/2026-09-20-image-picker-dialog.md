# Image picker: inline avatar with edit dialog

**Date:** 2026-09-20  
**Scope:** replace the separate image-upload section in Settings with an avatar control adjacent to each client/project/activity name.

## Before

- Every client, project, and activity row and create form rendered a separate image section: a small avatar, an explicit "Add/Replace … image" button, a "Remove" button, and a helper line about resizing.
- The control sat away from the name (in the rate column or on its own line), so the connection between the image and the record was easy to miss and the rows were visually noisy.

## After

- The image control is a single round avatar rendered **directly next to the name input** of every client, project, and activity row and create form.
- **Default state:** when no image is stored, the avatar shows one or two capital letters (initials of the name), or the activity's emoji when one is set. For a not-yet-named record it shows "?".
- **Edit affordance:** hovering the avatar (or focusing it with the keyboard) reveals a dark overlay with a pencil/edit icon; the whole avatar is one accessible button labelled e.g. "Edit client image".
- **Popup dialog:** activating the avatar opens a modal dialog containing:
  - a **drag & drop** zone that highlights while an image is dragged over it;
  - **clipboard paste**, accepted anywhere while the dialog is open (document-level listener, so the paste target does not matter);
  - a dedicated **Choose a file** upload button;
  - a live preview with "New image — not saved until you confirm" and a **Use this image** confirmation step;
  - **Remove image** for records that already have one;
  - Cancel, backdrop click, and Esc all close without applying.
- Chosen/dropped/pasted images are still processed locally: resized to ≤256×256, compressed to JPEG, rejected above the 180 KB data-URL bound, and stored as a base64 data URL in D1. The Worker validation contract is unchanged.

## Implementation

- `web/src/components/ImagePicker.jsx` — rebuilt as avatar trigger + native `<dialog class="modal">` (daisyUI 5 modal). Exported behavior: drag-drop, paste (document-level while open), file input, pending preview → confirm, remove, busy ("Resizing…") and error states with recovery copy. Keyboard: focus-visible shows the overlay; Esc closes; the trigger is a real button with `aria-haspopup="dialog"`.
- `web/src/components/IdentityMark.jsx` — extracted `initialsOf(name)` so the picker placeholder and the read-only identity marks share one initials rule.
- `web/src/components/Icon.jsx` — added the `edit` (pencil) stroke icon to the shared icon language.
- `web/src/components/ManagePanel.jsx` — every client/project/activity row and the three create forms now place the picker beside the name input; the separate image sections and buttons are gone. `IdentityMark` remains in use only on read-only surfaces (dashboard ranking rows, detail pages).

## Deliberate non-changes

- No API, schema, validation, or storage change; the D1 data-URL contract and Worker checks are untouched.
- Read-only identity marks on dashboard/detail pages keep their current appearance.
- No new dependency; the dialog uses the existing daisyUI modal styles.

## Verification

- `cd web && npm run build` — clean (61 modules transformed).
- Usage audit: `ImagePicker` is now referenced only from the Settings manage panel (six placements); `IdentityMark` remains on the four read-only surfaces.
