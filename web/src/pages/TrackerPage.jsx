import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EntryEditor from "../components/EntryEditor.jsx";
import EntryForm from "../components/EntryForm.jsx";
import Ledger from "../components/Ledger.jsx";
import { API_BASE, createTimeEntry, deleteTimeEntry, fetchEntries, getEntryBounds, startTimer, stopTimer, updateTimeEntry } from "../lib/api.js";
import { buildMasterLookup, enrichEntries } from "../lib/enrich.js";
import { buildCsv, downloadCsv, formatDuration, longMonth } from "../lib/format.js";
import { currentMonth, monthOptions, monthRange } from "../lib/periods.js";
import { Link, navigate } from "../lib/router.jsx";
import Icon from "../components/Icon.jsx";

// v2: the default moved from "all months" to the current month (the ledger now loads
// only the selected period from the server; see docs/2026-10-09-read-scaling-plan.md).
const PERIOD_KEY = "cf-tt-ledger-period-v2";
const readPeriod = () => {
  try { return localStorage.getItem(PERIOD_KEY) || currentMonth(); } catch { return currentMonth(); }
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
    archivedCustomers,
    archivedProjects,
    archivedActivities,
  } = tracker;
  const [period, setPeriod] = useState(readPeriod);
  const [clientFilter, setClientFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [editingEntry, setEditingEntry] = useState(null);
  const [deletingEntry, setDeletingEntry] = useState(null);
  // The ledger loads only the selected period (and client/project) from the server,
  // as lean rows whose names are resolved here from the masters we already hold.
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [bounds, setBounds] = useState(null);
  const lookup = useMemo(
    () => buildMasterLookup({ customers, projects, activities, archivedCustomers, archivedProjects, archivedActivities }),
    [customers, projects, activities, archivedCustomers, archivedProjects, archivedActivities]
  );
  const [reloadTick, setReloadTick] = useState(0);
  const reloadHistory = useCallback(() => setReloadTick((tick) => tick + 1), []);
  // Reload when the server data revision moves (own changes and other devices' both bump
  // it) or the selection changes. Older backends without a revision fall back to
  // "any bootstrap change".
  const revKey = tracker.dataRev ?? tracker.entries;
  useEffect(() => {
    let cancelled = false;
    const range = monthRange(period);
    setHistoryLoading(true);
    fetchEntries({
      ...(range || {}),
      customerId: clientFilter === "all" ? undefined : clientFilter,
      projectId: projectFilter === "all" ? undefined : projectFilter,
      lean: true,
    })
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);
        setHistoryError("");
      })
      .catch((err) => !cancelled && setHistoryError(err.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    getEntryBounds().then((b) => !cancelled && setBounds(b)).catch(() => {});
    return () => { cancelled = true; };
  }, [period, clientFilter, projectFilter, revKey, reloadTick]);

  const selectPeriod = (value) => {
    setPeriod(value);
    try { localStorage.setItem(PERIOD_KEY, value); } catch {}
  };

  /**
   * Losing the single-timer race (another tab started first) isn't a failure: reload so
   * the clock shows the timer that actually won, and say so.
   */
  const handleStart = async (payload, successMessage = "Timer started.") => {
    const result = await runAction(() => startTimer(payload), successMessage);
    if (!result.ok && result.code === "timer_running") {
      await load();
      addNotice(
        "Another tab already had a timer running, so this one wasn't started. The running timer is shown above."
      );
    }
  };

  /** Restart a closed ledger entry as a running timer with the same client, project, task, and note. */
  const handleContinue = (entry) =>
    handleStart(
      {
        customerId: entry.customer_id,
        projectId: entry.project_id,
        activityId: entry.activity_id,
        description: entry.description || "",
        tags: entry.tags || "",
        hourlyRate: entry.rate_applied,
      },
      "Continued this task — the timer is running."
    );

  /** Instant closed copy of a ledger row: same masters, note, tags, rate, and times. */
  const handleDuplicate = (entry) =>
    runAction(
      () =>
        createTimeEntry({
          customerId: entry.customer_id,
          projectId: entry.project_id,
          activityId: entry.activity_id,
          description: entry.description || "",
          tags: entry.tags || "",
          startTime: entry.start_time,
          endTime: entry.end_time,
          hourlyRate: entry.rate_applied,
        }),
      "Entry duplicated."
    );

  /**
   * Another device changed (or deleted) this entry after it was loaded: reload and, when the
   * worker returned the latest version, reopen the editor on it so nothing is overwritten blindly.
   */
  const handleEntryConflict = async (result, reopen) => {
    await load();
    reloadHistory();
    if (reopen && result.entry) setEditingEntry(enrichEntries([result.entry], lookup)[0]);
    else setEditingEntry(null);
    addNotice(
      reopen && result.entry
        ? "This entry was changed on another device. The latest version is loaded - review it and save again."
        : "This entry was changed on another device, so nothing was deleted. The list is up to date; try again if you still want to."
    );
  };

  const saveEntry = async (patch) => {
    const result = await runAction(() => updateTimeEntry(editingEntry.id, patch), editingEntry.is_running && patch.endTime === undefined ? "Running entry updated." : "Entry updated.");
    if (result.ok) setEditingEntry(null);
    else if (result.code === "entry_changed") await handleEntryConflict(result, true);
  };

  const confirmDelete = async () => {
    const result = await runAction(() => deleteTimeEntry(deletingEntry.id, deletingEntry.version), "Entry deleted.");
    if (result.ok) setDeletingEntry(null);
    else if (result.code === "entry_changed") {
      setDeletingEntry(null);
      await handleEntryConflict(result, false);
    }
  };

  const filtered = useMemo(() => (history ? enrichEntries(history, lookup) : []), [history, lookup]);
  const periods = useMemo(
    () => monthOptions(bounds?.minStart, bounds?.maxStart, [period]),
    [bounds, period]
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

  // "Filters" = anything narrower than the default view (current month, everyone).
  const hasFilters = period !== currentMonth() || clientFilter !== "all" || projectFilter !== "all";
  const ledgerSummary = historyLoading && !history
    ? "Loading entries…"
    : `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}${period === "all" ? "" : ` in ${longMonth(period)}`}${clientFilter !== "all" || projectFilter !== "all" ? " for this selection" : ""}.`;

  const clearFilters = () => {
    selectPeriod(currentMonth());
    setClientFilter("all");
    setProjectFilter("all");
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
            <strong>Could not load these entries.</strong>{" "}
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
                    {longMonth(m)}
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
              <button
                type="button"
                className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300"
                onClick={() => navigate(`/print?month=${encodeURIComponent(period)}&client=${encodeURIComponent(clientFilter)}&project=${encodeURIComponent(projectFilter)}`)}
              >
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
          onContinue={handleContinue}
          onDuplicate={handleDuplicate}
          onDelete={setDeletingEntry}
          canContinue={!activeTimer}
          emptyMessage={historyLoading && !history ? "Loading entries…" : hasFilters ? "No entries match these filters. Clear them or choose a wider period." : "No entries this month yet. Start a timer above, or choose another month."}
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

      <ConfirmDialog
        open={Boolean(deletingEntry)}
        title="Delete this entry?"
        message={
          deletingEntry
            ? `${deletingEntry.customer_name || "-"} · ${deletingEntry.project_name || "-"} · ${deletingEntry.activity_name || "-"} (${formatDuration(deletingEntry.duration_seconds)}). This permanently removes the entry and cannot be undone.`
            : ""
        }
        confirmLabel="Delete entry"
        busy={busy}
        onCancel={() => setDeletingEntry(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
