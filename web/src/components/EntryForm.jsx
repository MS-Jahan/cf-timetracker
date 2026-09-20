import { useEffect, useMemo, useState } from "react";
import { currencySymbol } from "../lib/currencies.js";
import { formatMoney } from "../lib/format.js";
import VoiceTaskCapture from "./VoiceTaskCapture.jsx";
import Icon from "./Icon.jsx";

/**
 * A form line, not a card: the fields sit on one ruled row the way you'd fill a paper
 * slip, and the action anchors to the end of that row. Locked while the clock runs, so
 * the running entry can't drift under the timer that owns it.
 */
export default function EntryForm({ customers, projects, activities, projectTasks = [], activeTimer, prefill, busy, onStart }) {
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  const running = Boolean(activeTimer);

  // Prefill from the running entry, or from the first available values.
  useEffect(() => {
    if (activeTimer) {
      setCustomerId(activeTimer.customer_id);
      setProjectId(activeTimer.project_id);
      setActivityId(activeTimer.activity_id);
      setDescription(activeTimer.description || "");
      setTags(activeTimer.tags || "");
      return;
    }
    setCustomerId((v) => v || customers[0]?.id || "");
    setActivityId((v) => v || activities[0]?.id || "");
  }, [activeTimer, customers, activities]);

  // "Use last entry" from the punch band re-uses the exact same selections.
  useEffect(() => {
    if (!prefill || running) return;
    setCustomerId(prefill.customerId);
    setProjectId(prefill.projectId);
    setActivityId(prefill.activityId);
    setDescription(prefill.description || "");
    setTags(prefill.tags || "");
  }, [prefill, running]);

  const customerProjects = useMemo(() => projects.filter((p) => p.customer_id === customerId), [projects, customerId]);

  useEffect(() => {
    setProjectId((v) => (customerProjects.some((p) => p.id === v) ? v : customerProjects[0]?.id || ""));
  }, [customerProjects]);

  // The task list is the selected project's own tasks; projects without a curated
  // list fall back to every shared activity so the form is never a dead end.
  const availableTasks = useMemo(() => {
    const linked = projectTasks.filter((task) => task.project_id === projectId);
    return linked.length ? linked : activities;
  }, [projectTasks, projectId, activities]);

  useEffect(() => {
    setActivityId((v) => (availableTasks.some((task) => task.activity_id === v || task.id === v) ? v : availableTasks[0]?.activity_id || availableTasks[0]?.id || ""));
  }, [availableTasks]);

  const selectedProject = customerProjects.find((p) => p.id === projectId);
  const client = customers.find((c) => c.id === customerId);

  let billing = "";
  if (selectedProject && client) {
    const currency = client.currency || "USD";
    billing =
      selectedProject.rate > 0
        ? `Bills at ${formatMoney(selectedProject.rate, currency)}/h from the project rate.`
        : `Bills at ${formatMoney(client.hourly_rate, currency)}/h: ${selectedProject.name} has no rate of its own, so ${client.name}'s client rate applies.`;
  }
  const billingCurrencySymbol = currencySymbol(client?.currency || "USD");

  const canStart = Boolean(customerId && projectId && activityId) && !busy && !running;

  return (
    <section className="rule py-5" aria-label="Start a timer">
      <div className="mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Start a timer</h2>
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-accent">Your next action</span>
        </div>
        <p className="ink-muted mt-1 max-w-[62ch] text-sm">Choose a client, project, and activity, then start the clock. Add a note if you want an easier way to find this work later.</p>
        {!running ? <VoiceTaskCapture disabled={busy} onDraft={(draft) => {
          const match = (items, value) => items.find((item) => item.name?.trim().toLowerCase() === String(value || "").trim().toLowerCase());
          const nextCustomer = match(customers, draft.client);
          const nextProject = match(projects.filter((item) => !nextCustomer || item.customer_id === nextCustomer.id), draft.project);
          const nextActivity = match(activities.filter((item) => !nextProject || !item.project_id || item.project_id === nextProject.id), draft.activity);
          if (nextCustomer) setCustomerId(nextCustomer.id);
          if (nextProject) setProjectId(nextProject.id);
          if (nextActivity) setActivityId(nextActivity.id);
          if (draft.description) setDescription(draft.description);
          if (draft.tags?.length) setTags(draft.tags.join(", "));
        }} /> : null}
      </div>
      <div className="grid grid-cols-1 items-end gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1fr)_auto]" aria-describedby="timer-form-help">
        <div>
          <label className="field-label" htmlFor="customer">
            Client
          </label>
          <select
            id="customer"
            className="select select-sm w-full"
            value={customerId}
            disabled={running}
            required
            aria-required="true"
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">{customers.length ? "Choose…" : "Add a client in Settings"}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="project">
            Project
          </label>
          <select
            id="project"
            className="select select-sm w-full"
            value={projectId}
            disabled={running}
            required
            aria-required="true"
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">{customerProjects.length ? "Choose…" : "Choose a client first"}</option>
            {customerProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="activity">
            Task
          </label>
          <select
            id="activity"
            className="select select-sm w-full"
            value={activityId}
            disabled={running}
            required
            aria-required="true"
            onChange={(e) => setActivityId(e.target.value)}
          >
            <option value="">{availableTasks.length ? "Choose…" : "Add a task on the project page"}</option>
            {availableTasks.map((task) => (
              <option key={task.activity_id || task.id} value={task.activity_id || task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-1 sm:col-span-2 lg:col-span-1">
          <label className="field-label" htmlFor="description">
            Note
          </label>
          <input
            id="description"
            className="input input-sm w-full"
            value={description}
            disabled={running}
            placeholder="Landing page build"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="tags">
            Tags
          </label>
          <input
            id="tags"
            className="input input-sm w-full"
            value={tags}
            disabled={running}
            placeholder="design, qa"
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        {!running ? (
          <button
            className="btn btn-primary min-h-11 col-span-1 justify-self-start sm:col-span-2 lg:col-span-1"
            disabled={!canStart}
            type="button"
            onClick={() => onStart({ customerId, projectId, activityId, description, tags })}
          >
            {busy ? "Starting…" : "Start timer"}
          </button>
        ) : null}
      </div>

      <p id="timer-form-help" className="ink-muted mt-3 text-sm">
        {running ? "The current timer is locked. Stop it from the top bar before starting another entry." : "Client, project, and task are required. New projects start with General and Meeting; manage a project's task list from its detail page."}
      </p>

      {billing && !running ? (
        <p className="ink-muted mt-3 text-sm">
          {billing}
          {billingCurrencySymbol && client ? <span className="ml-2">Amounts for {client.name} show as {billingCurrencySymbol}.</span> : null}
        </p>
      ) : null}
    </section>
  );
}
