import { useEffect, useMemo, useState } from "react";
import ManagePanel from "../components/ManagePanel.jsx";
import {
  API_BASE,
  archiveActivity,
  archiveCustomer,
  archiveProject,
  restoreActivity,
  restoreCustomer,
  restoreProject,
  syncSheets,
  updateActivity,
  updateCustomer,
  updateProject,
} from "../lib/api.js";
import { utcMonth } from "../lib/format.js";
import { applyTheme, THEME_OPTIONS } from "../lib/theme.js";
import { useTracker } from "../lib/useTracker.js";
import Icon from "../components/Icon.jsx";

const GAS_URL_KEY = "cf-timetracker:gasWebhookUrl";

const THEME_LABELS = { system: "Match my system", light: "Light", dark: "Dark" };

function themeIcon(option) {
  if (option === "light") return "sun";
  if (option === "dark") return "moon";
  return "system";
}

function Section({ title, description, children, className = "" }) {
  return (
    <section className={`rule py-8 ${className}`.trim()}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="ink-muted mt-1 max-w-[70ch] text-sm">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function SettingsPage({ themePreference, onThemeChange, demoMode = false, onResetDemo, demoResetting = false }) {
  const {
    status,
    loadError,
    actionError,
    notice,
    busy,
    retry,
    runAction,
    entries,
    customers,
    projects,
    activities,
    archivedCustomers,
    archivedProjects,
    archivedActivities,
  } = useTracker();

  const [gasUrl, setGasUrl] = useState(() => localStorage.getItem(GAS_URL_KEY) || "");
  const [syncPeriod, setSyncPeriod] = useState("all");

  const periods = useMemo(() => [...new Set(entries.map((e) => utcMonth(e.start_time)))].sort().reverse(), [entries]);

  useEffect(() => {
    document.title = "Settings · Timetracker";
    return () => {
      document.title = "Timetracker";
    };
  }, []);

  return (
    <div>
      <header className="pb-6 pt-8">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="ink-muted mt-1 max-w-[70ch] text-sm">
          Appearance is saved in this browser. Everything else changes the shared database.
        </p>
      </header>

      <div className="messages space-y-2 empty:hidden">
        {actionError ? (
          <p className="band band-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {notice ? <p className="band band-notice" role="status" aria-live="polite">{notice}</p> : null}
      </div>

      <Section title="Appearance">
        <div className="join">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option}
              className={`btn join-item ${option === themePreference ? "btn-primary" : "btn-ghost ring-1 ring-inset ring-base-300"}`}
              onClick={() => {
                applyTheme(option);
                onThemeChange(option);
              }}
            >
              <Icon name={themeIcon(option)} size={16} />
              {THEME_LABELS[option]}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Google Sheets"
        description="Sends closed entries to an Apps Script web app. It matches on entry ID, so sending the same period twice adds no duplicates."
      >
        <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div className="min-w-[20rem] flex-1">
            <label className="field-label" htmlFor="gas-url">Web app URL</label>
            <input id="gas-url" className="input w-full" value={gasUrl}
              placeholder="https://script.google.com/macros/s/…/exec"
              onChange={(e) => { setGasUrl(e.target.value); localStorage.setItem(GAS_URL_KEY, e.target.value); }} />
          </div>
          <div>
            <label className="field-label" htmlFor="sync-period">Period to send</label>
            <select id="sync-period" className="select" value={syncPeriod} onChange={(e) => setSyncPeriod(e.target.value)}>
              <option value="all">All months</option>
              {periods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !gasUrl} aria-busy={busy}
            onClick={() =>
              runAction(
                () => syncSheets({ gasWebhookUrl: gasUrl, filterMonth: syncPeriod === "all" ? undefined : syncPeriod }),
                (r) => {
                  const sent = r.gasResult?.count ?? 0;
                  const skipped = r.gasResult?.skipped ?? 0;
                  return sent === 0 && skipped > 0
                    ? `${skipped} entries were already in the sheet, so nothing was added.`
                    : `${sent} entries sent to Google Sheets.`;
                }
              )
            }>
            <Icon name="upload" size={16} />
            {busy ? "Sending…" : "Send to Google Sheets"}
          </button>
        </div>
        <p className="ink-muted mt-3 text-sm">
          If the receiver rejects the request, its error message appears above rather than the button spinning.
        </p>
      </Section>

      {status === "loading" ? (
        <Section title="Clients and rates">
          <p className="ink-muted">
            <span className="loading loading-spinner loading-sm" /> Loading…
          </p>
        </Section>
      ) : status === "error" ? (
        <Section title="Clients and rates">
          <p className="ink-muted max-w-[55ch]">Workspace data could not load. Check the connection, then try again.</p>
          <p className="figure mt-2 text-sm text-accent">{loadError}</p>
          <button className="btn btn-primary mt-4" onClick={retry}>Try again</button>
        </Section>
      ) : (
        <Section
          title="Clients and rates"
          description="A client's hourly rate is the fallback. A rate on the project overrides it. Archive old records to keep them out of new timers without removing history."
        >
          <ManagePanel
            className="manage-panel"
            customers={customers}
            projects={projects}
            activities={activities}
            archivedCustomers={archivedCustomers}
            archivedProjects={archivedProjects}
            archivedActivities={archivedActivities}
            busy={busy}
            onCreate={runAction}
            onSaveCustomer={(id, patch) => runAction(() => updateCustomer(id, patch), "Client updated.")}
            onSaveProject={(id, patch) => runAction(() => updateProject(id, patch), "Project updated.")}
            onSaveActivity={(id, patch) => runAction(() => updateActivity(id, patch), "Activity updated.")}
            onArchiveCustomer={(id) => runAction(() => archiveCustomer(id), "Client archived.")}
            onArchiveProject={(id) => runAction(() => archiveProject(id), "Project archived.")}
            onArchiveActivity={(id) => runAction(() => archiveActivity(id), "Activity archived.")}
            onRestoreCustomer={(id) => runAction(() => restoreCustomer(id), "Client restored.")}
            onRestoreProject={(id) => runAction(() => restoreProject(id), "Project restored.")}
            onRestoreActivity={(id) => runAction(() => restoreActivity(id), "Activity restored.")}
          />
        </Section>
      )}

      {demoMode ? (
        <Section
          title="Demo mode"
          description="This is a demo deployment with sample data. You can reset it to the default dataset at any time."
        >
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="btn btn-accent"
              disabled={demoResetting}
              onClick={onResetDemo}
            >
              <Icon name="restore" size={16} />
              {demoResetting ? "Resetting…" : "Reset demo data"}
            </button>
            <p className="ink-muted text-sm">Restores 2 clients, 3 projects, 4 activities, and 5 sample entries.</p>
          </div>
        </Section>
      ) : null}

      <Section title="Connection">
        <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {[
            ["API base", <span className="figure text-sm">{API_BASE}</span>],
            [
              "Worker",
              status === "ready" ? "Reachable" : status === "loading" ? "Checking…" : "Unreachable",
            ],
            ["Records", `${customers.length} clients, ${projects.length} projects, ${activities.length} activities`],
            ["Override", <span className="figure text-sm">VITE_API_BASE</span>],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="field-label">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <button className="btn btn-ghost btn-sm mt-5 ring-1 ring-inset ring-base-300" disabled={busy} onClick={retry}>
          <Icon name="refresh" size={16} />
          Check connection again
        </button>
      </Section>
    </div>
  );
}
