import { useEffect, useState } from "react";
import RankedBars from "../components/RankedBars.jsx";
import { getDashboard } from "../lib/api.js";
import { Link, navigate } from "../lib/router.jsx";
import { formatDuration, formatMoney } from "../lib/format.js";

const LAYOUT_KEY = "cf-timetracker:dashboard-layout";
const DEFAULT_LAYOUT = {
  hours: true,
  billed: true,
  average: true,
  clientCount: true,
  daily: true,
  byClient: true,
  byProject: true,
  byActivity: true,
};
const SECTION_LABELS = {
  hours: "Billable hours",
  billed: "Billed total",
  average: "Average entry",
  clientCount: "Active clients",
  daily: "Daily activity graph",
  byClient: "Client graph",
  byProject: "Project graph",
  byActivity: "Activity graph",
};

function readLayout() {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function periodRange(period) {
  if (period === "all") return {};
  if (period === "month") return { month: new Date().toISOString().slice(0, 7) };
  const end = Date.now();
  return { fromMs: end - 30 * 24 * 60 * 60 * 1000, toMs: end };
}

function Stat({ label, value, detail, accent = false }) {
  return (
    <div className={`border-l-2 py-2 pl-4 ${accent ? "border-accent" : "border-base-300"}`}>
      <dt className="field-label">{label}</dt>
      <dd className={`figure text-2xl font-medium ${accent ? "text-accent" : ""}`}>{value}</dd>
      {detail ? <p className="ink-muted mt-1 text-sm">{detail}</p> : null}
    </div>
  );
}

function DailyChart({ rows }) {
  const points = rows.slice(-31);
  const max = Math.max(...points.map((row) => row.total_seconds), 1);
  const width = 760;
  const height = 220;
  const left = 10;
  const bottom = 34;
  const chartHeight = height - bottom;
  const slot = width / Math.max(points.length, 1);
  const barWidth = Math.max(3, Math.min(22, slot * 0.62));

  const totalHours = points.reduce((sum, row) => sum + Number(row.total_seconds || 0), 0) / 3600;

  return (
    <figure className="overflow-x-auto" aria-labelledby="daily-activity-caption">
      <figcaption id="daily-activity-caption" className="sr-only">
        Daily billable hours chart for {points.length} days, totaling {totalHours.toFixed(2)} hours. Each bar has a text label with its date, duration, and billed amount.
      </figcaption>
      <svg className="min-w-[42rem]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Billable hours by day">
        <line x1="0" y1={chartHeight} x2={width} y2={chartHeight} stroke="currentColor" opacity=".35" />
        <line x1="0" y1={chartHeight / 2} x2={width} y2={chartHeight / 2} stroke="currentColor" opacity=".12" strokeDasharray="3 5" />
        {points.map((row, index) => {
          const barHeight = (row.total_seconds / max) * (chartHeight - 18);
          const x = index * slot + (slot - barWidth) / 2;
          const y = chartHeight - barHeight;
          const label = row.day.slice(5);
          return (
            <g key={row.day}>
              <title>{`${row.day}: ${formatDuration(row.total_seconds)}, ${formatMoney(row.total_cost)}`}</title>
              <rect x={x} y={y} width={barWidth} height={Math.max(2, barHeight)} fill="currentColor" opacity=".78" />
              {(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) ? (
                <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="currentColor" opacity=".68">{label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="sr-only" aria-label="Daily activity data">
        {points.map((row) => <span key={row.day}>{row.day}: {formatDuration(row.total_seconds)}, {formatMoney(row.total_cost)}</span>)}
      </div>
    </figure>
  );
}

function DashboardSection({ title, note, children, className = "" }) {
  return (
    <section className={`rule py-7 ${className}`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {note ? <p className="ink-muted mt-1 text-sm">{note}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState("all");
  const [layout, setLayout] = useState(readLayout);
  const [customizing, setCustomizing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    document.title = "Dashboard · Timetracker";
    return () => { document.title = "Timetracker"; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    getDashboard(periodRange(period)).then((payload) => {
      if (!cancelled) setData(payload);
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, [period, reloadKey]);

  const totals = data?.totals;
  const dashboardCurrency = data?.currency || "USD";

  const toggle = (key) => setLayout((current) => {
    const next = { ...current, [key]: !current[key] };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    return next;
  });

  if (error) {
    return (
      <section className="py-16">
        <h1 className="text-xl font-semibold">Dashboard unavailable</h1>
        <p className="ink-muted mt-2 max-w-[55ch]">The report could not load. Check the connection, then try again.</p>
        <p className="figure mt-2 text-sm text-accent">{error}</p>
        <button className="btn btn-primary mt-5" onClick={() => { setData(null); setReloadKey((value) => value + 1); }}>Try again</button>
      </section>
    );
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-5 pb-6 pt-8">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="ink-muted mt-1">A clear view of time, work, and billed value.</p>
        </div>
        <div className="no-print flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label" htmlFor="dashboard-period">Period</label>
            <select id="dashboard-period" className="select select-sm" value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="all">All time</option>
              <option value="month">This month</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <button className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" onClick={() => setCustomizing((value) => !value)}>
            {customizing ? "Done" : "Customize dashboard"}
          </button>
        </div>
      </header>

      {customizing ? (
        <fieldset className="no-print mb-2 border border-base-300 bg-base-200 p-4">
          <legend className="px-1 text-sm font-medium">Show on this dashboard</legend>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
            {Object.keys(SECTION_LABELS).map((key) => (
              <label key={key} className="label cursor-pointer gap-2 py-0">
                <input type="checkbox" className="checkbox checkbox-sm" checked={layout[key]} onChange={() => toggle(key)} />
                <span>{SECTION_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {!data ? <p className="ink-muted py-16" role="status" aria-live="polite"><span className="loading loading-spinner loading-sm" /> Loading dashboard…</p> : (
        <>
          {totals.entry_count === 0 ? (
            <section className="border-l-2 border-info bg-info/5 py-5 pl-4 pr-4">
              <h2 className="text-lg font-semibold">Your dashboard will fill up here</h2>
              <p className="ink-muted mt-1 max-w-[58ch] text-sm">Start with one entry on the Time entries page. This report will then show hours, billed value, and where your time is going.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link className="btn btn-primary btn-sm" to="/timesheet">Record your first entry</Link>
                <span className="text-sm ink-muted">It only takes a client, project, and activity.</span>
              </div>
            </section>
          ) : null}

          {(layout.hours || layout.billed || layout.average || layout.clientCount) ? (
            <DashboardSection title="At a glance">
              <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {layout.hours ? <Stat label="Billable hours" value={formatDuration(totals.total_seconds)} detail={`${totals.entry_count} closed entries`} /> : null}
                {layout.billed ? <Stat label="Billed" value={formatMoney(totals.total_cost, dashboardCurrency)} detail={`Average ${formatMoney(totals.average_rate, dashboardCurrency)}/h`} accent /> : null}
                {layout.average ? <Stat label="Average entry" value={formatDuration(totals.average_duration)} detail="Across closed entries" /> : null}
                {layout.clientCount ? <Stat label="Active clients" value={data.by_customer.length} detail={`${data.by_project.length} projects represented`} /> : null}
              </dl>
            </DashboardSection>
          ) : null}

          {layout.daily ? (
            <DashboardSection title="Daily activity" className="no-break">
              <p className="ink-muted mb-4 text-sm">Recorded hours by day. Hover a bar for hours and billed value.</p>
              {data.by_day.length ? <DailyChart rows={data.by_day} /> : <p className="ink-muted py-8">No recorded time in this period.</p>}
            </DashboardSection>
          ) : null}

          <div className="grid gap-x-10 lg:grid-cols-2">
            {layout.byClient ? (
            <DashboardSection title="By client" note="Amounts in each client's own currency. Click a client for their detail page.">
              <RankedBars
                rows={data.by_customer}
                valueKey="total_cost"
                money
                linkRows={(row) => row.customer_id && navigate(`/clients/${row.customer_id}`)}
              />
            </DashboardSection>
          ) : null}
            {layout.byProject ? (
              <DashboardSection title="By project" note="Click a project for its detail page.">
                <RankedBars rows={data.by_project} valueKey="total_seconds" linkRows={(row) => row.project_id && navigate(`/projects/${row.project_id}`)} />
              </DashboardSection>
            ) : null}
          </div>

          {layout.byActivity ? (
            <DashboardSection title="By activity" note="Click an activity for its detail page.">
              <RankedBars
                rows={data.by_activity}
                valueKey="total_cost"
                money
                barClass="bg-accent"
                linkRows={(row) => row.activity_id && navigate(`/activities/${row.activity_id}`)}
              />
            </DashboardSection>
          ) : null}
        </>
      )}
    </div>
  );
}
