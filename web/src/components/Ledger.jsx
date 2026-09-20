import { formatDuration, formatMoney, toHours, utcDate } from "../lib/format.js";
import { Link } from "../lib/router.jsx";

/**
 * Build a summary of hours and cost grouped by client+project.
 * Returns an array of { client, project, currency, total_seconds, total_hours, total_cost, entry_count }.
 */
function buildSummary(entries) {
  const closed = entries.filter((e) => !e.is_running);
  const map = new Map();
  for (const e of closed) {
    const key = `${e.customer_id || "?"}|${e.project_id || "?"}`;
    if (!map.has(key)) {
      map.set(key, {
        client: e.customer_name || "—",
        project: e.project_name || "—",
        currency: e.currency || "USD",
        total_seconds: 0,
        total_cost: 0,
        entry_count: 0,
      });
    }
    const row = map.get(key);
    row.total_seconds += e.duration_seconds || 0;
    row.total_cost += Number(e.cost || 0);
    row.entry_count += 1;
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, total_hours: Number((r.total_seconds / 3600).toFixed(2)) }))
    .sort((a, b) => b.total_cost - a.total_cost);
}

/**
 * The currency with the most billed value in the selection — the one the printed
 * timesheet's headline total should carry. Individual rows always show their own
 * entry currency.
 */
function currencyFor(entries) {
  const totals = {};
  for (const e of entries) totals[e.currency || "?"] = (totals[e.currency || "?"] || 0) + Number(e.cost || 0);
  const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best && best !== "?" ? best : "USD";
}

function TagList({ value }) {
  const tags = String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.length) return null;
  return <span className="ink-muted ml-2 text-xs">{tags.join(", ")}</span>;
}

/**
 * The centre of gravity: a timesheet, ruled. Rules separate rows instead of cards,
 * every figure is right-aligned in mono so a wrong one is visible at a glance, and the
 * period closes with the double rule an accountant would draw under a sum. The amount
 * owed carries the red pen, the same pen the running clock uses.
 */
export default function Ledger({ entries, scopeLabel, onEdit, emptyMessage }) {
  const closed = entries.filter((e) => !e.is_running);
  const totalSeconds = closed.reduce((sum, e) => sum + (e.duration_seconds || 0), 0);
  const totalCost = closed.reduce((sum, e) => sum + Number(e.cost || 0), 0);
  const currency = currencyFor(closed);
  const mixedCurrencies = new Set(closed.map((e) => e.currency || "?")).size > 1;
  const summary = buildSummary(entries);

  const period =
    scopeLabel ||
    (closed.length
      ? `${utcDate(Math.min(...closed.map((e) => e.start_time)))} to ${utcDate(
          Math.max(...closed.map((e) => e.start_time))
        )}`
      : "no entries");

  const now = new Date();
  const generatedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <section>
      {/* Print-only header: CF Time Tracker branding + period info */}
      <header className="print-header">
        <div style={{ display: "flex", alignItems: "center", gap: "4mm" }}>
          <div className="print-logo">LOGO</div>
          <div>
            <h1>CF Time Tracker</h1>
            <p className="print-meta">
              Billable hours report{mixedCurrencies ? " (mixed currencies)" : ""}
            </p>
          </div>
        </div>
        <p className="print-period">
          Period: {period}<br />
          Printed: {generatedDate}<br />
          Entries: {closed.length} | Total: {toHours(totalSeconds)} hours | Amount: {formatMoney(totalCost, currency)}
        </p>
      </header>

      {/* Print-only summary table */}
      {summary.length > 0 && (
        <div className="print-summary">
          <h2 style={{ fontSize: "12pt", fontWeight: 600, margin: "0 0 2mm 0" }}>Summary by Client & Project</h2>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Project</th>
                <th className="text-right">Hours</th>
                <th className="text-right">Entries</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => (
                <tr key={i}>
                  <td>{row.client}</td>
                  <td>{row.project}</td>
                  <td className="text-right" style={{ fontFamily: "monospace" }}>{row.total_hours.toFixed(2)}</td>
                  <td className="text-right" style={{ fontFamily: "monospace" }}>{row.entry_count}</td>
                  <td className="text-right" style={{ fontFamily: "monospace" }}>{formatMoney(row.total_cost, row.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="text-right" style={{ fontFamily: "monospace" }}>{toHours(totalSeconds)}</td>
                <td className="text-right" style={{ fontFamily: "monospace" }}>{closed.length}</td>
                <td className="text-right" style={{ fontFamily: "monospace" }}>{formatMoney(totalCost, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Screen: min-width keeps columns from wrapping; narrow screens scroll. */}
      <div className="overflow-x-auto">
        <table className="table table-sm min-w-[52rem] print-entries-table">
          <colgroup className="no-print">
            <col />
            <col />
            <col />
            <col />
            <col />
            <col className="hidden lg:table-column" />
            <col />
            <col />
            <col className="no-print" />
          </colgroup>
          <thead>
            <tr className="rule-strong border-b-0">
              <th className="ink-muted text-left font-medium">Date</th>
              <th className="ink-muted text-left font-medium">Client</th>
              <th className="ink-muted text-left font-medium">Project</th>
              <th className="ink-muted text-left font-medium">Task</th>
              <th className="ink-muted text-right font-medium">Duration</th>
              <th className="ink-muted hidden text-right font-medium lg:table-cell">Rate</th>
              <th className="ink-muted text-right font-medium">Total</th>
              <th className="ink-muted text-left font-medium">Note</th>
              <th className="no-print text-right font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr className="border-t border-base-300">
                <td colSpan={9} className="ink-muted whitespace-nowrap py-8">
                  {emptyMessage || "No entries in this period. Start a timer above, or choose a wider period."}
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr
                  key={e.id}
                  className={`whitespace-nowrap border-t border-base-300 ${
                    e.is_running ? "text-accent" : "hover:bg-base-200/70"
                  }`}
                >
                  <td className="figure ink-muted text-left">{utcDate(e.start_time)}</td>
                  <td className="text-left">
                    {e.customer_id ? <Link className="link link-hover" to={`/clients/${e.customer_id}`}>{e.customer_name || "—"}</Link> : (e.customer_name || "—")}
                  </td>
                  <td className="text-left">
                    {e.project_id ? <Link className="link link-hover" to={`/projects/${e.project_id}`}>{e.project_name || "—"}</Link> : (e.project_name || "—")}
                  </td>
                  <td className="text-left">
                    {e.activity_id ? <Link className="link link-hover" to={`/activities/${e.activity_id}`}>{e.activity_name || "—"}</Link> : (e.activity_name || "—")}
                  </td>
                  <td className="figure text-right">{e.is_running ? "recording" : formatDuration(e.duration_seconds)}</td>
                  <td className="figure ink-muted hidden text-right lg:table-cell">
                    {formatMoney(e.rate_applied, e.currency || currency)}
                  </td>
                  <td className="figure text-right font-medium">
                    {e.is_running ? "—" : formatMoney(e.cost, e.currency || currency)}
                  </td>
                  <td className="max-w-[20rem] truncate text-left">
                    {e.description || ""}
                    <TagList value={e.tags} />
                  </td>
                  <td className="no-print text-right">
                    {!e.is_running ? (
                      <button className="btn btn-ghost btn-xs" type="button" onClick={() => onEdit?.(e)}>
                        Edit
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="rule-double whitespace-nowrap">
              <td colSpan={4} className="ink-muted text-left">
                {closed.length} closed {closed.length === 1 ? "entry" : "entries"}
                {mixedCurrencies ? <span className="no-print"> · total in {currency}</span> : null}
              </td>
              <td className="figure text-right font-semibold">{formatDuration(totalSeconds)}</td>
              <td className="hidden lg:table-cell" />
              <td className="figure text-accent text-right text-base font-semibold">
                {formatMoney(totalCost, currency)}
              </td>
              <td />
              <td className="no-print" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Print-only footer */}
      <div className="print-footer">
        CF Time Tracker — Timesheet printed on {generatedDate} — {closed.length} entries, {toHours(totalSeconds)} hours
      </div>
    </section>
  );
}
