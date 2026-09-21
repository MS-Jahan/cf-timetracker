import { useEffect, useMemo, useState } from "react";
import { currencySymbol } from "../lib/currencies.js";
import { formatDateTimeLocal, formatDuration, formatMoney, parseDateTimeLocal } from "../lib/format.js";

function draftFrom(entry) {
  return {
    customerId: entry.customer_id,
    projectId: entry.project_id,
    activityId: entry.activity_id,
    description: entry.description || "",
    tags: entry.tags || "",
    startTime: formatDateTimeLocal(entry.start_time),
    // A running entry has no end yet; an empty field means "keep recording".
    endTime: entry.is_running ? "" : formatDateTimeLocal(entry.end_time || entry.start_time + 3600000),
    hourlyRate: String(entry.rate_applied ?? 0),
  };
}

export default function EntryEditor({ entry, customers, projects, activities, busy, onClose, onSave }) {
  const [draft, setDraft] = useState(() => draftFrom(entry));
  const customerProjects = useMemo(
    () => projects.filter((project) => project.customer_id === draft.customerId),
    [projects, draft.customerId]
  );

  useEffect(() => {
    setDraft(draftFrom(entry));
  }, [entry]);

  useEffect(() => {
    if (!customerProjects.some((project) => project.id === draft.projectId)) {
      setDraft((current) => ({ ...current, projectId: customerProjects[0]?.id || "" }));
    }
  }, [customerProjects, draft.projectId]);

  const running = Boolean(entry.is_running);
  const startMs = parseDateTimeLocal(draft.startTime);
  const endMs = parseDateTimeLocal(draft.endTime);
  const keepsRunning = running && draft.endTime === "";
  const previewSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? Math.max(1, Math.round((endMs - startMs) / 1000))
    : 0;
  const currency = customers.find((c) => c.id === draft.customerId)?.currency || "USD";
  const symbol = currencySymbol(currency);
  const basicsOk = draft.customerId && draft.projectId && draft.activityId && Number.isFinite(startMs);
  const canSave = keepsRunning ? Boolean(basicsOk) : basicsOk && previewSeconds > 0;

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const save = () => {
    const patch = {
      customerId: draft.customerId,
      projectId: draft.projectId,
      activityId: draft.activityId,
      description: draft.description,
      tags: draft.tags,
      startTime: startMs,
      hourlyRate: Number(draft.hourlyRate),
    };
    // Blank end on a running entry keeps the clock running; a filled one stops it.
    if (!keepsRunning) patch.endTime = endMs;
    onSave(patch);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-base-content/35 p-4 sm:p-8" role="presentation">
      <section
        className="w-full max-w-2xl border border-base-300 bg-base-100 p-5 shadow-xl sm:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-editor-title"
      >
        <header className="flex items-start justify-between gap-6 border-b border-base-300 pb-4">
          <div>
            <p className="field-label">{running ? "Edit running entry" : "Edit closed entry"}</p>
            <h2 id="entry-editor-title" className="text-xl font-semibold">
              {running ? "Change the work in progress" : "Change the recorded work"}
            </h2>
            <p className="ink-muted mt-1 text-sm">
              {running
                ? "The clock keeps running. Fill in an end time to stop it and record the duration."
                : "The duration and amount recalculate from the times and rate."}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} aria-label="Close editor">
            Close
          </button>
        </header>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="field-label">
            Client
            <select className="select mt-1 w-full" value={draft.customerId} onChange={(event) => set("customerId", event.target.value)}>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </label>

          <label className="field-label">
            Project
            <select className="select mt-1 w-full" value={draft.projectId} onChange={(event) => set("projectId", event.target.value)}>
              {customerProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>

          <label className="field-label">
            Activity
            <select className="select mt-1 w-full" value={draft.activityId} onChange={(event) => set("activityId", event.target.value)}>
              {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
            </select>
          </label>

          <label className="field-label">
            Rate applied per hour{symbol ? <span className="ink-muted font-normal normal-case"> ({symbol})</span> : null}
            <input className="input figure mt-1 w-full" type="number" min="0" step="0.01" value={draft.hourlyRate}
              onChange={(event) => set("hourlyRate", event.target.value)} />
          </label>

          <label className="field-label">
            Started
            <input className="input figure mt-1 w-full" type="datetime-local" value={draft.startTime}
              onChange={(event) => set("startTime", event.target.value)} />
          </label>

          <label className="field-label">
            Ended
            <input
              className="input figure mt-1 w-full"
              type="datetime-local"
              value={draft.endTime}
              placeholder={running ? "Still recording" : undefined}
              onChange={(event) => set("endTime", event.target.value)}
            />
            {running ? <span className="ink-muted mt-1 block text-xs font-normal normal-case">Leave empty to keep recording; fill in to stop the timer.</span> : null}
          </label>

          <label className="field-label sm:col-span-2">
            Note
            <input className="input mt-1 w-full" value={draft.description} placeholder="What was done?"
              onChange={(event) => set("description", event.target.value)} />
          </label>

          <label className="field-label sm:col-span-2">
            Tags
            <input className="input mt-1 w-full" value={draft.tags} placeholder="design, qa"
              onChange={(event) => set("tags", event.target.value)} />
          </label>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-base-300 pt-5">
          <p className="ink-muted text-sm">
            {keepsRunning ? (
              "Still recording."
            ) : (
              <>
                New duration: <span className="figure font-medium text-base-content">{formatDuration(previewSeconds)}</span>
                {previewSeconds ? (
                  <>
                    {" · New amount:"} <span className="figure font-medium text-base-content">{formatMoney((previewSeconds / 3600) * Number(draft.hourlyRate || 0), currency)}</span>
                  </>
                ) : null}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="button" disabled={busy || !canSave} onClick={save}>
              {keepsRunning ? "Save changes" : running ? "Save & stop timer" : "Save entry"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
