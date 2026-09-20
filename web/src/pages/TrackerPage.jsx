import { useCallback, useEffect, useMemo, useState } from "react";
import EntryEditor from "../components/EntryEditor.jsx";
import EntryForm from "../components/EntryForm.jsx";
import Ledger from "../components/Ledger.jsx";
import { API_BASE, fetchAllEntries, startTimer, stopTimer, updateTimeEntry } from "../lib/api.js";
import { buildCsv, downloadCsv, utcMonth } from "../lib/format.js";
import { Link } from "../lib/router.jsx";
import Icon from "../components/Icon.jsx";

const PERIOD_KEY = "cf-tt-ledger-period";
const readPeriod = () => {
  try { return localStorage.getItem(PERIOD_KEY) || "all"; } catch { return "all"; }
};

export default function TrackerPage({ tracker }) {
  const {
    status,
    loadError,
    actionError,
    notice,
    busy,
    retry,
    load,
    addNotice,
    runAction,
    entries,
    customers,
    projects,
    activities,
    projectTasks,
    activeTimer,
  } = tracker;
  const [period, setPeriod] = useState(readPeriod);
  const [clientFilter, setClientFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [editingEntry, setEditingEntry] = useState(null);
  // Bootstrap only carries the last 50 entries, so the ledger fetches the full
  // history itself; `entries` is the instant first paint, `history` the truth.
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const reloadHistory = useCallback(() => {
    fetchAllEntries().then((rows) => {
      setHistory(rows);
      setHistoryError("");
    }).catch((err) => setHistoryError(err.message));
  }, []);
  useEffect(() => { reloadHistory(); }, [reloadHistory, tracker.entries]);

  const selectPeriod = (value) => {
    setPeriod(value);
    try { localStorage.setItem(PERIOD_KEY, value); } catch {}
  };

  /**
   * Losing the single-timer race (another tab started first) isn't a failure: reload so
   * the clock shows the timer that actually won, and say so.
   */
  const handleStart = async (payload) => {
    const result = await runAction(() => startTimer(payload), "Timer started.");
    if (!result.ok && result.code === "timer_running") {
      await load();
      addNotice(
        "Another tab already had a timer running, so this one wasn't started. The running timer is shown above."
      );
    }
  };

  const ledgerEntries = history ?? entries;
  const periods = useMemo(() => [...new Set(ledgerEntries.map((e) => utcMonth(e.start_time)))].sort().reverse(), [ledgerEntries]);

  const filtered = useMemo(
    () =>
      ledgerEntries.filter((e) => {
        if (period !== "all" && utcMonth(e.start_time) !== period) return false;
        if (clientFilter !== "all" && e.customer_id !== clientFilter) return false;
        if (projectFilter !== "all" && e.project_id !== projectFilter) return false;
        return true;
      }),
    [ledgerEntries, period, clientFilter, projectFilter]
  );

  if (status === "loading") {
    return (
      <section className="ink-muted py-16">
        <span className="loading loading-spinner loading-sm" /> Loading the ledger…
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="py-16">
        <h1 className="text-xl font-semibold">Could not reach the API</h1>
        <p className="ink-muted mt-2 max-w-[60ch]">
          Nothing loaded from <span className="figure">{API_BASE}</span>. Check that the worker is running, then try
          again.
        </p>
        <p className="figure text-accent mt-2 text-sm">{loadError}</p>
        <button className="btn btn-primary mt-5" onClick={retry}>
          Try again
        </button>
      </section>
    );
  }

  const filterProjects = clientFilter === "all" ? projects : projects.filter((p) => p.customer_id === clientFilter);

  const hasFilters = period !== "all" || clientFilter !== "all" || projectFilter !== "all";
  const ledgerSummary = filtered.length === ledgerEntries.length && !hasFilters
    ? `All ${ledgerEntries.length} entries.`
    : `${filtered.length} of ${ledgerEntries.length} entries match the filters.`;

  const clearFilters = () => {
    setPeriod("all");
    setClientFilter("all");
    setProjectFilter("all");
  };

  const saveEntry = async (patch) => {
    const result = await runAction(() => updateTimeEntry(editingEntry.id, patch), "Entry updated.");
    if (result.ok) setEditingEntry(null);
  };

  return (
    <div>
      <div className="messages space-y-2 empty:hidden">
        {actionError ? (
          <p className="band band-error" role="alert">
            <strong>Could not complete that action.</strong> {actionError}
          </p>
        ) : null}
        {notice ? <p className="band band-notice" role="status">{notice}</p> : null}
        {historyError ? (
          <p className="band band-error" role="alert">
            <strong>Could not load the full history.</strong> Showing the most recent entries only.{" "}
            <button type="button" className="link" onClick={reloadHistory}>Retry</button>
          </p>
        ) : null}
      </div>

      {customers.length === 0 || projects.length === 0 || activities.length === 0 ? (
        <section className="mt-6 border-l-2 border-info bg-info/5 p-4" role="status">
          <h1 className="text-lg font-semibold">Set up your workspace first</h1>
          <p className="ink-muted mt-1 max-w-[58ch] text-sm">
            Add a client, project, and activity in Settings. Once those are ready, starting a timer takes one click.
          </p>
          <Link className="btn btn-primary btn-sm mt-3" to="/settings">Open settings</Link>
        </section>
      ) : !entries.length ? (
        <section className="mt-6 border-l-2 border-info bg-info/5 p-4" role="status">
          <h1 className="text-lg font-semibold">Your first entry is ready to start</h1>
          <p className="ink-muted mt-1 max-w-[58ch] text-sm">
            Choose a client, project, and activity below. Add a note if it helps, then start the timer. You can edit the entry later.
          </p>
        </section>
      ) : null}

      <EntryForm
        customers={customers}
        projects={projects}
        activities={activities}
        projectTasks={projectTasks}
        activeTimer={activeTimer}
        busy={busy}
        onStart={handleStart}
      />

      <section className="pt-8">
        <div className="filters no-print mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h2 className="text-lg font-semibold">Ledger</h2>
            <p className="ink-muted text-sm">{ledgerSummary}</p>
          </div>

          <div className="flex flex-wrap items-end gap-x-5 gap-y-3" aria-label="Ledger filters and exports">
            <div>
              <label className="field-label" htmlFor="f-period">
                Period
              </label>
              <select
                id="f-period"
                className="select select-sm"
                value={period}
                onChange={(e) => selectPeriod(e.target.value)}
              >
                <option value="all">All months</option>
                {periods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="f-client">
                Client
              </label>
              <select
                id="f-client"
                className="select select-sm"
                value={clientFilter}
                onChange={(e) => {
                  setClientFilter(e.target.value);
                  setProjectFilter("all");
                }}
              >
                <option value="all">All clients</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="f-project">
                Project
              </label>
              <select
                id="f-project"
                className="select select-sm"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="all">All projects</option>
                {filterProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2 pb-0.5">
              {hasFilters ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                  <Icon name="clear" size={15} />
                  Clear filters
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300"
                disabled={busy || filtered.length === 0}
                onClick={() => downloadCsv(`timesheet-${period === "all" ? "all" : period}.csv`, buildCsv(filtered))}
              >
                <Icon name="download" size={15} />
                Download CSV
              </button>
              <button type="button" className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" onClick={() => window.print()}>
                <Icon name="print" size={15} />
                Print timesheet
              </button>
            </div>
          </div>
        </div>

        <Ledger
          entries={filtered}
          scopeLabel={period === "all" ? "" : period}
          onEdit={setEditingEntry}
          emptyMessage={hasFilters ? "No entries match these filters. Clear them or choose a wider period." : undefined}
        />
      </section>

      {editingEntry ? (
        <EntryEditor
          entry={editingEntry}
          customers={customers}
          projects={projects}
          activities={activities}
          busy={busy}
          onClose={() => setEditingEntry(null)}
          onSave={saveEntry}
        />
      ) : null}
    </div>
  );
}
