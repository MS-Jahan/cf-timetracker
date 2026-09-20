/**
 * The "Showing X of Y · Newer / Older" bar shared by the entity detail pages.
 * Renders nothing when the whole history fits on one page.
 */
export default function DetailPager({ shown, total, offset, limit, loading, onNewer, onOlder }) {
  if (!total || total <= shown) return null;
  return (
    <div className="no-print mt-4 flex items-center justify-between gap-4">
      <p className="ink-muted text-sm">
        Showing {shown} of {total} closed entries.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" disabled={offset === 0 || loading} onClick={onNewer}>
          Newer
        </button>
        <button className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" disabled={loading || shown < limit} onClick={onOlder}>
          Older
        </button>
      </div>
    </div>
  );
}
