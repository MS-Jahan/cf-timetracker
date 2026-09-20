import IdentityMark from "./IdentityMark.jsx";
import { formatDuration, formatMoney } from "../lib/format.js";

/**
 * Horizontal ranked bars for a "where did the time/money go" breakdown. Rows may link
 * somewhere (a detail page) via `linkRows`; `barClass` lets a caller keep its accent
 * (the dashboard's activity chart stays red). Figures are right-aligned mono.
 */
export default function RankedBars({ rows, valueKey, money = false, linkRows = null, barClass = "bg-base-content/70" }) {
  const max = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1);
  if (!rows.length) return <p className="ink-muted">No recorded time in this period.</p>;
  return (
    <div className="space-y-4">
      {rows.slice(0, 8).map((row) => {
        const value = Number(row[valueKey] || 0);
        const label = (
          <span className="truncate">
            {row.name || "Unnamed"}
            {row.customer ? <span className="ink-muted"> · {row.customer}</span> : null}
          </span>
        );
        return (
          <div key={`${row.name}-${row.customer || ""}`}>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <IdentityMark name={row.name} imageUrl={row.image_url} emoji={row.emoji} />
                {linkRows ? (
                  <button type="button" className="link link-hover truncate text-left" onClick={() => linkRows(row)}>{label}</button>
                ) : label}
              </span>
              <span className="figure shrink-0">{money ? formatMoney(value, row.currency) : formatDuration(row.total_seconds)}</span>
            </div>
            <div className="mt-1 h-2 bg-base-200">
              <div className={`h-full ${barClass}`} style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
