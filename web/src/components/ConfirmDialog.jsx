/**
 * Small destructive-action confirmation. Renders a modal with a neutral cancel and a
 * danger confirm; `busy` disables both while the action runs so a double click cannot
 * fire it twice.
 */
export default function ConfirmDialog({ open, title, message, confirmLabel = "Delete", busy = false, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base-content/35 p-4" role="presentation">
      <section
        className="w-full max-w-md border border-base-300 bg-base-100 p-5 shadow-xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold">{title}</h2>
        <p className="ink-muted mt-2 text-sm">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-error" type="button" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
