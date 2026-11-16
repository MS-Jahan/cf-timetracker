import { useEffect, useMemo, useState } from "react";
import { currencySymbol } from "../lib/currencies.js";
import { formatDuration, formatMoney } from "../lib/format.js";
import { dateTextToIso, dateTimeHint, formatClockOf, formatDate, getDateFormat, parseDateTimeParts } from "../lib/dateFormat.js";
import { getDefaultTimezone, offsetLabel, timezoneOptions } from "../lib/time.js";
import { getTimeFormat, parseClockText } from "../lib/timeFormat.js";
import DateField from "./DateField.jsx";
import TimeField from "./TimeField.jsx";

// An instant as the two typed parts (date text and clock text) in the chosen zone.
function splitInstant(ms, format, zone) {
  return { date: formatDate(ms, format, zone), clock: formatClockOf(ms, zone) };
}

// The start and end text are read and written in the entry's zone (its own zone when it has
// one, otherwise the workspace default). Create mode always uses the default zone.
function draftFrom(entry, format, creating) {
  const zone = creating ? getDefaultTimezone() : entry.timezone || getDefaultTimezone();
  const start = splitInstant(entry.start_time, format, zone);
  // A running entry has no end yet; blank end date and clock mean "keep recording".
  const end = entry.is_running
    ? { date: "", clock: "" }
    : splitInstant(entry.end_time || entry.start_time + 3600000, format, zone);
  return {
    customerId: entry.customer_id,
    projectId: entry.project_id,
    activityId: entry.activity_id,
    description: entry.description || "",
    tags: entry.tags || "",
    timezone: zone,
    startDate: start.date,
    startClock: start.clock,
    endDate: end.date,
    endClock: end.clock,
    hourlyRate: String(entry.rate_applied ?? 0),
  };
}

/**
 * mode "edit" (default) changes an existing entry. mode "create" fills in a blank closed entry:
 * `entry` is then a draft row (customer_id, project_id, activity_id, start_time, end_time,
 * rate_applied) and onSave receives a createTimeEntry payload instead of a patch.
 */
export default function EntryEditor({ entry, mode = "edit", customers, projects, activities, busy, onClose, onSave }) {
  const creating = mode === "create";
  const format = getDateFormat("edit");
  const timeFormat = getTimeFormat();
  const [draft, setDraft] = useState(() => draftFrom(entry, format, creating));
  const customerProjects = useMemo(
    () => projects.filter((project) => project.customer_id === draft.customerId),
    [projects, draft.customerId]
  );

  useEffect(() => {
    setDraft(draftFrom(entry, format, creating));
  }, [entry, format, creating]);

  // Changing the zone keeps the instants: the typed start and end are re-read in the old zone
  // and written back in the new one. Parts that do not parse are left as typed.
  const changeZone = (nextZone) => {
    setDraft((current) => {
      const next = { ...current, timezone: nextZone };
      const startInstant = parseDateTimeParts(current.startDate, current.startClock, format, current.timezone);
      const endInstant = parseDateTimeParts(current.endDate, current.endClock, format, current.timezone);
      if (Number.isFinite(startInstant)) {
        const parts = splitInstant(startInstant, format, nextZone);
        Object.assign(next, { startDate: parts.date, startClock: parts.clock });
      }
      if (Number.isFinite(endInstant)) {
        const parts = splitInstant(endInstant, format, nextZone);
        Object.assign(next, { endDate: parts.date, endClock: parts.clock });
      }
      return next;
    });
  };

  useEffect(() => {
    if (!customerProjects.some((project) => project.id === draft.projectId)) {
      setDraft((current) => ({ ...current, projectId: customerProjects[0]?.id || "" }));
    }
  }, [customerProjects, draft.projectId]);

  const running = !creating && Boolean(entry.is_running);
  const startMs = parseDateTimeParts(draft.startDate, draft.startClock, format, draft.timezone);
  const endMs = parseDateTimeParts(draft.endDate, draft.endClock, format, draft.timezone);
  const endBlank = draft.endDate.trim() === "" && draft.endClock.trim() === "";
  const keepsRunning = running && endBlank;
  const startDateInvalid = draft.startDate.trim() !== "" && dateTextToIso(draft.startDate, format) === null;
  const startClockInvalid = draft.startClock.trim() !== "" && parseClockText(draft.startClock) === null;
  const endDateInvalid = !endBlank && dateTextToIso(draft.endDate, format) === null;
  const endClockInvalid = !endBlank && parseClockText(draft.endClock) === null;
  const previewSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? Math.max(1, Math.round((endMs - startMs) / 1000))
    : 0;
  const currency = customers.find((c) => c.id === draft.customerId)?.currency || "USD";
  const symbol = currencySymbol(currency);
  const basicsOk = draft.customerId && draft.projectId && draft.activityId && Number.isFinite(startMs);
  const canSave = keepsRunning ? Boolean(basicsOk) : basicsOk && previewSeconds > 0;

  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const save = () => {
    if (creating) {
      onSave({
        customerId: draft.customerId,
        projectId: draft.projectId,
        activityId: draft.activityId,
        description: draft.description,
        tags: draft.tags,
        startTime: startMs,
        endTime: endMs,
        hourlyRate: Number(draft.hourlyRate),
        timezone: draft.timezone,
      });
      return;
    }
    const patch = {
      customerId: draft.customerId,
      projectId: draft.projectId,
      activityId: draft.activityId,
      description: draft.description,
      tags: draft.tags,
      startTime: startMs,
      hourlyRate: Number(draft.hourlyRate),
      timezone: draft.timezone,
    };
    // Only apply the edit if nobody changed this entry since it was loaded.
    if (entry.version) patch.ifVersion = entry.version;
    // A blank end (date and clock) on a running entry keeps the clock running; a filled one stops it.
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
            <p className="field-label">{creating ? "New closed entry" : running ? "Edit running entry" : "Edit closed entry"}</p>
            <h2 id="entry-editor-title" className="text-xl font-semibold">
              {creating ? "Add time entry" : running ? "Change the work in progress" : "Change the recorded work"}
            </h2>
            <p className="ink-muted mt-1 text-sm">
              {creating
                ? "Record work you already did. The duration and amount calculate from the times and rate."
                : running
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

          {creating ? null : (
            <label className="field-label sm:col-span-2">
              Time zone
              <select className="select mt-1 w-full" value={draft.timezone} onChange={(event) => changeZone(event.target.value)}>
                {timezoneOptions(draft.timezone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
              <span className="ink-muted mt-1 block text-xs font-normal normal-case">
                {offsetLabel(draft.timezone, Number.isFinite(startMs) ? startMs : Date.now())}. The start and end below are read in this zone.
              </span>
            </label>
          )}

          <div>
            <label className="field-label" htmlFor="entry-start-date">Started</label>
            <div className="mt-1 flex gap-2">
              <DateField id="entry-start-date" ariaLabel="Started date" className="min-w-0 flex-1" format={format}
                value={draft.startDate} invalid={startDateInvalid} onChange={(text) => set("startDate", text)} />
              <TimeField ariaLabel="Started time" className="w-36 shrink-0" fmt={timeFormat} zone={draft.timezone}
                value={draft.startClock} invalid={startClockInvalid} onChange={(text) => set("startClock", text)} />
            </div>
            <span className="ink-muted mt-1 block text-xs font-normal normal-case">{dateTimeHint(format, timeFormat)}</span>
          </div>

          <div>
            <label className="field-label" htmlFor="entry-end-date">Ended</label>
            <div className="mt-1 flex gap-2">
              <DateField id="entry-end-date" ariaLabel="Ended date" className="min-w-0 flex-1" format={format}
                value={draft.endDate} invalid={endDateInvalid} onChange={(text) => set("endDate", text)} />
              <TimeField ariaLabel="Ended time" className="w-36 shrink-0" fmt={timeFormat} zone={draft.timezone}
                value={draft.endClock} invalid={endClockInvalid} onChange={(text) => set("endClock", text)} />
            </div>
            <span className="ink-muted mt-1 block text-xs font-normal normal-case">
              {running
                ? `Leave both empty to keep recording; fill in ${dateTimeHint(format, timeFormat)} to stop the timer.`
                : dateTimeHint(format, timeFormat)}
            </span>
          </div>

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
              {creating ? "Add entry" : keepsRunning ? "Save changes" : running ? "Save & stop timer" : "Save entry"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
