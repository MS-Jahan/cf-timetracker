import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDuration, formatMoney, formatPeriod, longDate, longMonth, shortDate, shortDateTime, toHours } from "../lib/format.js";
import { formatDate, getDateFormat } from "../lib/dateFormat.js";
import Icon from "./Icon.jsx";
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
        client: e.customer_name || "-",
        project: e.project_name || "-",
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
 * The currency with the most billed value in the selection - the one the printed
 * timesheet's headline total should carry. Individual rows always show their own
 * entry currency.
 */
function currencyFor(entries) {
  const totals = {};
  for (const e of entries) totals[e.currency || "?"] = (totals[e.currency || "?"] || 0) + Number(e.cost || 0);
  const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0];
  return best && best !== "?" ? best : "USD";
}

// Final entries kept on the same printed page as the total + footer.
const KEEP_TAIL = 2;

function TagList({ value }) {
  const tags = String(value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.length) return null;
  return <span className="ink-muted ml-2 text-xs">{tags.join(", ")}</span>;
}

/**
 * The row's three-dot menu. Position: fixed so the table's overflow-x-auto cannot
 * clip it (same treatment as the emoji picker); closes on outside click, Escape,
 * scroll, or picking an item.
 */
function RowMenu({ entry, actions }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 160;
    const height = actions.length * 36 + 8;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const top = rect.bottom + 4;
    setCoords({
      left,
      top: top + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : top,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-xs btn-square"
        aria-label="Row actions"
        aria-expanded={open}
        title="Row actions"
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
      >
        <Icon name="kebab" size={16} />
      </button>
      {open && coords
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[70] w-40 border border-base-300 bg-base-100 py-1 shadow-xl"
              style={{ left: coords.left, top: coords.top }}
              role="menu"
              aria-label="Row actions"
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-base-200 ${
                    action.danger ? "text-error" : ""
                  }`}
                  onClick={() => {
                    setOpen(false);
                    action.run();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/**
 * The centre of gravity: a timesheet, ruled. Rules separate rows instead of cards,
 * every figure is right-aligned in mono so a wrong one is visible at a glance, and the
 * period closes with the double rule an accountant would draw under a sum. The amount
 * owed carries the red pen, the same pen the running clock uses.
 *
 * `onContinue` opts the ledger into the hover play button that restarts a closed
 * entry as a running timer; `canContinue` gates it while a timer is already running.
 * `onEdit`/`onDuplicate`/`onContinue`/`onDelete` feed the row's three-dot menu -
 * handlers left out simply drop their menu item, so detail pages can opt in per action.
 */
export default function Ledger({ entries, scopeLabel, onEdit, onContinue, onDuplicate, onDelete, canContinue = true, emptyMessage }) {
  const closed = entries.filter((e) => !e.is_running);
  const totalSeconds = closed.reduce((sum, e) => sum + (e.duration_seconds || 0), 0);
  const totalCost = closed.reduce((sum, e) => sum + Number(e.cost || 0), 0);
  const currency = currencyFor(closed);
  const mixedCurrencies = new Set(closed.map((e) => e.currency || "?")).size > 1;
  const summary = buildSummary(entries);

  // Explicit month filter -> "October 2026"; otherwise the entries' span: a whole
  // month by name, anything else as a compact range (see docs/2026-10-09-print-period-label.md).
  const period = (() => {
    if (scopeLabel && /\b\d{4}-\d{2}\b/.test(scopeLabel)) return scopeLabel.replace(/\b(\d{4}-\d{2})\b/g, (m) => longMonth(m));
    let range = "";
    if (closed.length) {
      const first = new Date(Math.min(...closed.map((e) => e.start_time)));
      const last = new Date(Math.max(...closed.map((e) => e.start_time)));
      const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
      const lastDay = new Date(last.getFullYear(), last.getMonth() + 1, 0).getDate();
      range = sameMonth && first.getDate() === 1 && last.getDate() === lastDay
        ? longMonth(`${first.getFullYear()}-${first.getMonth() + 1}`)
        : formatPeriod(first.getTime(), last.getTime());
    }
    if (scopeLabel) return range ? `${scopeLabel} \u00b7 ${range}` : scopeLabel;
    return range || "No entries";
  })();

  const generatedDate = longDate(Date.now());
  const ledgerDateFormat = getDateFormat("ledger");

  // Browsers name the saved PDF after the page title while printing.
  useEffect(() => {
    let previous = null;
    const before = () => { previous = document.title; document.title = `${period} - cf-timetracker`; };
    const after = () => { if (previous !== null) document.title = previous; previous = null; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); after(); };
  }, [period]);

  const detailRow = (e) => (
    <tr key={e.id}>
      <td>{shortDate(e.start_time)}</td>
      <td>
        {shortDateTime(e.start_time)}
        <br />
        {e.end_time ? shortDateTime(e.end_time) : "-"}
      </td>
      <td>
        <strong>{e.project_name || "-"}</strong>
        <br />
        <span className="print-sub">
          {e.customer_name || "-"} · {e.activity_name || "-"}
        </span>
      </td>
      <td>
        {e.description || ""}
        {e.tags ? <span className="print-sub"> [{String(e.tags).split(",").map((t) => t.trim()).filter(Boolean).join(", ")}]</span> : null}
      </td>
      <td className="text-right col-nowrap">{formatDuration(e.duration_seconds)}</td>
      <td className="text-right">{formatMoney(e.cost, e.currency || currency)}</td>
    </tr>
  );

  return (
    <section>
      {/* Print-only header: CF Time Tracker branding + period info */}
      <header className="print-header">
        <div style={{ display: "flex", alignItems: "center", gap: "4mm" }}>
          <img src="/logo.png" alt="cf-timetracker" className="print-logo" />
          <div>
            <h1>
              <span className="print-brand-cf">cf</span>
              <span className="print-brand-rest">-timetracker</span>
              <small className="print-version">v{__APP_VERSION__}</small>
            </h1>
            <p className="print-meta">
              Billable hours report{mixedCurrencies ? " (mixed currencies)" : ""}
            </p>
          </div>
        </div>
        <dl className="print-stats">
          <div><dt>Period</dt><dd>{period}</dd></div>
          <div><dt>Printed</dt><dd>{generatedDate}</dd></div>
          <div><dt>Entries</dt><dd>{closed.length}</dd></div>
          <div><dt>Hours</dt><dd>{toHours(totalSeconds)}</dd></div>
          <div><dt>Amount</dt><dd>{formatMoney(totalCost, currency)}</dd></div>
        </dl>
      </header>

      {/* Print-only summary table */}
      {summary.length > 0 && (
        <div className="print-summary">
          <h2 className="print-section-title">Summary by Client & Project</h2>
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

      {/* Print-only details table: own colgroup so widths survive print. */}
      {closed.length > 0 && (
        <div className="print-details">
          <h2 className="print-section-title">Details</h2>
          <table className="print-details-table">
            <colgroup>
              <col className="col-d-date" />
              <col className="col-d-time" />
              <col className="col-d-what" />
              <col className="col-d-note" />
              <col className="col-d-dur" />
              <col className="col-d-total" />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Start / Stop</th>
                <th>Project / Task</th>
                <th>Note</th>
                <th className="text-right">Duration</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            {/* Last rows + total + footer share one non-splittable tbody so the total never lands alone on a page. */}
            <tbody>
              {closed.slice(0, -KEEP_TAIL).map(detailRow)}
            </tbody>
            <tbody className="print-tail">
              {closed.slice(-KEEP_TAIL).map(detailRow)}
              <tr className="print-total-row">
                <td colSpan={4}>Total</td>
                <td className="text-right col-nowrap">{formatDuration(totalSeconds)}</td>
                <td className="text-right">{formatMoney(totalCost, currency)}</td>
              </tr>
              {/* Inside the table so it can never be pushed alone onto a fresh page. */}
              <tr className="print-footer-row">
                <td colSpan={6}>cf-timetracker v{__APP_VERSION__} - Timesheet printed on {generatedDate}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Screen: min-width keeps columns from wrapping; narrow screens scroll. */}
      <div className="no-print overflow-x-auto">
        <table className="table table-sm min-w-[52rem]">
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
                  className={`group whitespace-nowrap border-t border-base-300 ${
                    e.is_running ? "text-accent" : "hover:bg-base-200/70"
                  }`}
                >
                  <td className="figure ink-muted text-left">
                    {onContinue && !e.is_running && e.customer_id && e.project_id && e.activity_id ? (
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs no-print mr-1 inline-flex h-6 w-6 p-0 transition-opacity ${
                          canContinue
                            ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-hover:pointer-events-auto pointer-events-none"
                            : ""
                        }`}
                        disabled={!canContinue}
                        title={canContinue ? "Continue this task" : "Stop the running timer first"}
                        aria-label={canContinue ? "Continue this task" : "Stop the running timer first"}
                        onClick={() => onContinue(e)}
                      >
                        <Icon name="play" size={14} />
                      </button>
                    ) : null}
                    {formatDate(e.start_time, ledgerDateFormat)}
                  </td>
                  <td className="text-left">
                    {e.customer_id ? <Link className="link link-hover" to={`/clients/${e.customer_id}`}>{e.customer_name || "-"}</Link> : (e.customer_name || "-")}
                  </td>
                  <td className="text-left">
                    {e.project_id ? <Link className="link link-hover" to={`/projects/${e.project_id}`}>{e.project_name || "-"}</Link> : (e.project_name || "-")}
                  </td>
                  <td className="text-left">
                    {e.activity_id ? <Link className="link link-hover" to={`/activities/${e.activity_id}`}>{e.activity_name || "-"}</Link> : (e.activity_name || "-")}
                  </td>
                  <td className="figure text-right">{e.is_running ? "recording" : formatDuration(e.duration_seconds)}</td>
                  <td className="figure ink-muted hidden text-right lg:table-cell">
                    {formatMoney(e.rate_applied, e.currency || currency)}
                  </td>
                  <td className="figure text-right font-medium">
                    {e.is_running ? "-" : formatMoney(e.cost, e.currency || currency)}
                  </td>
                  <td className="max-w-[20rem] truncate text-left">
                    {onEdit ? (
                      <button
                        type="button"
                        className="link link-hover max-w-full truncate text-left align-bottom"
                        title="View or edit this entry"
                        onClick={() => onEdit(e)}
                      >
                        {e.description || <span className="ink-muted">Add a note…</span>}
                      </button>
                    ) : (
                      e.description || ""
                    )}
                    <TagList value={e.tags} />
                  </td>
                  <td className="no-print text-right">
                    {(() => {
                      const actions = [];
                      if (onEdit) actions.push({ label: "Edit", run: () => onEdit(e) });
                      if (onDuplicate && !e.is_running) actions.push({ label: "Duplicate", run: () => onDuplicate(e) });
                      if (onContinue && !e.is_running) actions.push({ label: "Start again", run: () => onContinue(e) });
                      if (onDelete && !e.is_running) actions.push({ label: "Delete", danger: true, run: () => onDelete(e) });
                      return actions.length ? <RowMenu entry={e} actions={actions} /> : null;
                    })()}
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

    </section>
  );
}
