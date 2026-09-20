import { useEffect, useMemo, useState } from "react";
import Ledger from "../components/Ledger.jsx";
import Icon from "../components/Icon.jsx";
import { getBootstrap as bootstrap, fetchAllEntries } from "../lib/api.js";
import { utcMonth } from "../lib/format.js";
import { Link } from "../lib/router.jsx";

/**
 * Dedicated print view (/print?month=YYYY-MM&client=<id>&project=<id>):
 * renders ONLY the timesheet - no app chrome, no filters - so the browser's
 * print dialog never sees interactive UI. Opens the print dialog once on
 * load; the toolbar stays on screen (no-print) for retries.
 */
export default function PrintPage() {
  const [entries, setEntries] = useState(null);
  const [meta, setMeta] = useState({ customers: [], projects: [] });
  const [error, setError] = useState("");

  const query = new URLSearchParams(window.location.search);
  const month = query.get("month") || "all";
  const clientId = query.get("client") || "all";
  const projectId = query.get("project") || "all";

  useEffect(() => {
    document.title = "Print timesheet · Timetracker";
    let cancelled = false;
    Promise.all([bootstrap(), fetchAllEntries()])
      .then(([data, allEntries]) => {
        if (cancelled) return;
        setMeta({ customers: data.customers || [], projects: data.projects || [] });
        setEntries(allEntries);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (month !== "all" && utcMonth(e.start_time) !== month) return false;
      if (clientId !== "all" && e.customer_id !== clientId) return false;
      if (projectId !== "all" && e.project_id !== projectId) return false;
      return true;
    });
  }, [entries, month, clientId, projectId]);

  // One automatic print attempt once the data is on screen; the toolbar's
  // Print button covers retries and the case where the user cancelled.
  useEffect(() => {
    if (!entries) return undefined;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [entries]);

  const clientName = meta.customers.find((c) => c.id === clientId)?.name;
  const projectName = meta.projects.find((p) => p.id === projectId)?.name;
  const scopeParts = [month !== "all" ? month : "", clientName, projectName].filter(Boolean);

  if (error) {
    return (
      <section className="p-10">
        <h1 className="text-xl font-semibold">Print view unavailable</h1>
        <p className="figure mt-2 text-sm text-accent">{error}</p>
        <Link className="btn btn-primary mt-5" to="/timesheet">Back to time entries</Link>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link className="link ink-muted text-sm" to="/timesheet">← Back to time entries</Link>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!entries}
          onClick={() => window.print()}
        >
          <Icon name="print" size={15} />
          {entries ? "Print" : "Loading…"}
        </button>
      </div>

      {!entries ? (
        <p className="ink-muted py-16"><span className="loading loading-spinner loading-sm" /> Preparing the timesheet…</p>
      ) : (
        <Ledger
          entries={filtered}
          scopeLabel={scopeParts.length ? scopeParts.join(" · ") : ""}
          emptyMessage="No entries match this scope."
        />
      )}
    </div>
  );
}
