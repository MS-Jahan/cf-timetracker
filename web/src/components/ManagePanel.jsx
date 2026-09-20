import { useEffect, useState } from "react";
import CurrencySelect from "./CurrencySelect.jsx";
import EmojiPicker from "./EmojiPicker.jsx";
import ImagePicker from "./ImagePicker.jsx";
import Icon from "./Icon.jsx";
import { Link } from "../lib/router.jsx";
import {
  archiveActivity,
  archiveCustomer,
  archiveProject,
  createActivity,
  createCustomer,
  createProject,
  restoreActivity,
  restoreCustomer,
  restoreProject,
} from "../lib/api.js";
import { formatMoney } from "../lib/format.js";

function useDraft(initial) {
  const [draft, setDraft] = useState(initial);
  const initialKey = JSON.stringify(initial);
  const draftKey = JSON.stringify(draft);

  useEffect(() => setDraft(initial), [initialKey]);
  return [draft, setDraft, draftKey !== initialKey];
}

function SaveButton({ dirty, busy, onClick }) {
  return <button type="button" className="btn btn-primary btn-xs" disabled={!dirty || busy} onClick={onClick}><Icon name={dirty ? "save" : "check"} size={14} />{dirty ? "Save changes" : "Saved"}</button>;
}

function ArchiveButton({ busy, onClick }) {
  return <button type="button" className="btn btn-ghost btn-xs text-accent ring-1 ring-inset ring-base-300" title="Hide from new timers; history stays intact" disabled={busy} onClick={onClick}><Icon name="archive" size={14} />Archive</button>;
}

function RestoreButton({ busy, onClick }) {
  return <button type="button" className="btn btn-primary btn-xs" disabled={busy} onClick={onClick}><Icon name="restore" size={14} />Restore</button>;
}

function ListHead({ children }) {
  return <tr className="border-b border-base-300 text-left text-sm font-medium ink-muted">{children}</tr>;
}

function CustomerRow({ customer, busy, onSave, onArchive }) {
  const [draft, setDraft, dirty] = useDraft({ name: customer.name, currency: customer.currency || "USD", hourlyRate: String(customer.hourly_rate ?? 0), imageUrl: customer.image_url || "" });
  return (
    <tr className="border-b border-base-300">
      <td className="py-2"><span className="flex items-center gap-2"><ImagePicker value={draft.imageUrl} name={draft.name} label="Client image" onChange={(imageUrl) => setDraft({ ...draft, imageUrl })} /><input className="input input-sm w-full max-w-[16rem]" value={draft.name} aria-label="Client name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></span></td>
      <td className="py-2"><CurrencySelect value={draft.currency} onChange={(currency) => setDraft({ ...draft, currency: currency || "USD" })} /></td>
      <td className="py-2"><span className="flex items-center gap-2"><input type="number" min="0" step="0.01" className="input input-sm figure w-28" aria-label="Hourly rate" value={draft.hourlyRate} onChange={(e) => setDraft({ ...draft, hourlyRate: e.target.value })} /><span className="text-sm ink-muted">per hour</span></span></td>
      <td className="py-2 text-right"><div className="flex justify-end gap-2"><SaveButton dirty={dirty} busy={busy} onClick={() => onSave({ name: draft.name, currency: draft.currency, hourlyRate: Number(draft.hourlyRate), imageUrl: draft.imageUrl })} /><ArchiveButton busy={busy} onClick={onArchive} /></div></td>
    </tr>
  );
}

function ProjectRow({ project, customers, busy, onSave, onArchive }) {
  const [draft, setDraft, dirty] = useDraft({ name: project.name, budgetType: project.budget_type || "hourly", rate: String(project.rate ?? 0), customerId: project.customer_id, imageUrl: project.image_url || "" });
  const client = customers.find((c) => c.id === project.customer_id);
  const currency = client?.currency || "USD";
  return (
    <tr className="border-b border-base-300">
      <td className="py-2"><span className="flex items-center gap-2"><ImagePicker value={draft.imageUrl} name={draft.name} label="Project image" onChange={(imageUrl) => setDraft({ ...draft, imageUrl })} /><input className="input input-sm w-full max-w-[16rem]" value={draft.name} aria-label="Project name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><Link className="link link-hover text-xs ink-muted" to={`/projects/${project.id}`}>view</Link></span></td>
      <td className="py-2">
        <select className="select select-sm" value={draft.customerId} aria-label="Project client" onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {client ? <Link className="link link-hover ml-2 text-xs ink-muted" to={`/clients/${client.id}`}>client</Link> : null}
      </td>
      <td className="py-2"><span className="flex items-center gap-2"><input type="number" min="0" step="0.01" className="input input-sm figure w-28" aria-label="Project rate" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /><span className="text-sm ink-muted">per hour</span></span></td>
      <td className="py-2 text-sm ink-muted">{Number(draft.rate) === 0 ? `bills ${client ? formatMoney(client.hourly_rate, currency) : "—"}/h from ${client?.name ?? "the client"}` : `${formatMoney(draft.rate, currency)}/h`}</td>
      <td className="py-2 text-right"><div className="flex justify-end gap-2"><SaveButton dirty={dirty} busy={busy} onClick={() => onSave({ name: draft.name, customerId: draft.customerId, budgetType: draft.budgetType, rate: Number(draft.rate), imageUrl: draft.imageUrl })} /><ArchiveButton busy={busy} onClick={onArchive} /></div></td>
    </tr>
  );
}

function ActivityRow({ activity, busy, onSave, onArchive }) {
  const [draft, setDraft, dirty] = useDraft({ name: activity.name, emoji: activity.emoji || "", imageUrl: activity.image_url || "" });
  return <tr className="border-b border-base-300"><td className="py-2"><span className="flex flex-wrap items-center gap-2"><ImagePicker value={draft.imageUrl} name={draft.name} emoji={draft.emoji} label="Activity image" onChange={(imageUrl) => setDraft({ ...draft, imageUrl })} /><input className="input input-sm w-full max-w-[16rem]" value={draft.name} aria-label="Activity name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><EmojiPicker value={draft.emoji} label="Activity emoji" onChange={(emoji) => setDraft({ ...draft, emoji })} /><Link className="link link-hover text-xs ink-muted" to={`/activities/${activity.id}`}>view</Link></span></td><td className="py-2 text-right"><div className="flex justify-end gap-2"><SaveButton dirty={dirty} busy={busy} onClick={() => onSave({ name: draft.name, emoji: draft.emoji, imageUrl: draft.imageUrl })} /><ArchiveButton busy={busy} onClick={onArchive} /></div></td></tr>;
}

/* Lists page in chunks so a long roster (hundreds of clients/projects) stays usable. */
const PAGE_SIZE = 10;

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <button type="button" className="btn btn-ghost btn-xs ring-1 ring-inset ring-base-300" disabled={page === 0} onClick={() => onPage(page - 1)}>Newer</button>
      <span className="text-xs ink-muted">Page {page + 1} of {pages}</span>
      <button type="button" className="btn btn-ghost btn-xs ring-1 ring-inset ring-base-300" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Older</button>
    </div>
  );
}

function ArchivedTable({ title, children }) {
  return <div className="mt-6"><h4 className="mb-2 text-sm font-medium ink-muted">{title}</h4><div className="overflow-x-auto"><table className="table table-sm"><tbody>{children}</tbody></table></div></div>;
}

export default function ManagePanel({
  className = "",
  customers = [],
  projects = [],
  activities = [],
  archivedCustomers = [],
  archivedProjects = [],
  archivedActivities = [],
  busy,
  onCreate,
  onSaveCustomer,
  onSaveProject,
  onSaveActivity,
  onArchiveCustomer,
  onArchiveProject,
  onArchiveActivity,
  onRestoreCustomer,
  onRestoreProject,
  onRestoreActivity,
}) {
  const [customer, setCustomer] = useState({ name: "", currency: "USD", hourlyRate: "", imageUrl: "" });
  const [project, setProject] = useState({ customerId: "", name: "", rate: "", defaultTasks: "General, Meeting", imageUrl: "" });
  const [activity, setActivity] = useState({ name: "", emoji: "", imageUrl: "" });
  const [showArchived, setShowArchived] = useState(false);
  const [clientPage, setClientPage] = useState(0);
  const [projectPage, setProjectPage] = useState(0);
  const [activityPage, setActivityPage] = useState(0);

  const clientPages = Math.max(1, Math.ceil(customers.length / PAGE_SIZE));
  const projectPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  const activityPages = Math.max(1, Math.ceil(activities.length / PAGE_SIZE));
  useEffect(() => setClientPage((p) => Math.min(p, clientPages - 1)), [clientPages]);
  useEffect(() => setProjectPage((p) => Math.min(p, projectPages - 1)), [projectPages]);
  useEffect(() => setActivityPage((p) => Math.min(p, activityPages - 1)), [activityPages]);
  const clientSlice = customers.slice(clientPage * PAGE_SIZE, clientPage * PAGE_SIZE + PAGE_SIZE);
  const projectSlice = projects.slice(projectPage * PAGE_SIZE, projectPage * PAGE_SIZE + PAGE_SIZE);
  const activitySlice = activities.slice(activityPage * PAGE_SIZE, activityPage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setProject((current) => (current.customerId || !customers.length ? current : { ...current, customerId: customers[0].id }));
  }, [customers]);

  const addCustomer = () => onCreate(() => createCustomer({ name: customer.name, currency: customer.currency, hourlyRate: Number(customer.hourlyRate || 0), imageUrl: customer.imageUrl }), `Client "${customer.name}" added.`).then((result) => result.ok && setCustomer({ name: "", currency: "USD", hourlyRate: "", imageUrl: "" }));
  // Projects inherit the client's currency at render time (formatMoney via client), so
  // no currency field is needed on the project form or row.
  const addProject = () => onCreate(() => createProject({ customerId: project.customerId, name: project.name, budgetType: "hourly", rate: Number(project.rate || 0), defaultTasks: project.defaultTasks.split(",").map((task) => task.trim()).filter(Boolean), imageUrl: project.imageUrl }), `Project "${project.name}" added.`).then((result) => result.ok && setProject({ ...project, name: "", rate: "", imageUrl: "" }));
  const addActivity = () => onCreate(() => createActivity({ name: activity.name, emoji: activity.emoji, imageUrl: activity.imageUrl }), `Activity "${activity.name}" added.`).then((result) => result.ok && setActivity({ name: "", emoji: "", imageUrl: "" }));

  const archivedCount = archivedCustomers.length + archivedProjects.length + archivedActivities.length;

  return (
    <div className={className.trim()}>
      <div className="flex justify-end">
        <button type="button" className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>
          <Icon name={showArchived ? "clear" : "archive"} size={15} />{showArchived ? "Hide archived" : `Show archived${archivedCount ? ` (${archivedCount})` : ""}`}
        </button>
      </div>

      <div className="border-l-2 border-info bg-info/5 p-4">
        <p className="text-sm font-medium">Set up your timer in three steps</p>
        <p className="ink-muted mt-1 text-sm">Add a client first, then a project for that client, then the shared activities you use to describe the work.</p>
      </div>

      {/* Create forms: the identity image leads each row, then name, then the
          remaining fields — one grid so labels and inputs stay flush. */}
      <div className="mt-4 grid grid-cols-2 items-end gap-x-5 gap-y-4 bg-base-200 p-4 sm:grid-cols-[auto_1fr_auto_auto_auto]">
        <div className="flex items-end"><ImagePicker value={customer.imageUrl} name={customer.name} label="Client image" onChange={(imageUrl) => setCustomer({ ...customer, imageUrl })} /></div>
        <div className="min-w-[10rem]"><label className="field-label" htmlFor="cust-name">New client</label><input id="cust-name" className="input input-sm w-full" placeholder="Northwind" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></div>
        <div><label className="field-label" htmlFor="cust-currency">Currency</label><CurrencySelect id="cust-currency" value={customer.currency} onChange={(currency) => setCustomer({ ...customer, currency })} /></div>
        <div><label className="field-label" htmlFor="cust-rate">Rate per hour</label><input id="cust-rate" type="number" min="0" step="0.01" className="input input-sm figure w-28" placeholder="0.00" value={customer.hourlyRate} onChange={(e) => setCustomer({ ...customer, hourlyRate: e.target.value })} /></div>
        <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={busy || !customer.name.trim()} onClick={addCustomer}><Icon name="plus" size={15} />{busy ? "Adding…" : "Add client"}</button>
      </div>

      <div className="mt-3 grid grid-cols-2 items-end gap-x-5 gap-y-4 bg-base-200 p-4 sm:grid-cols-[auto_1fr_auto_auto_1fr_auto]">
        <div className="flex items-end"><ImagePicker value={project.imageUrl} name={project.name} label="Project image" onChange={(imageUrl) => setProject({ ...project, imageUrl })} /></div>
        <div className="min-w-[10rem]"><label className="field-label" htmlFor="proj-name">New project</label><input id="proj-name" className="input input-sm w-full" placeholder="Brand refresh" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></div>
        <div><label className="field-label" htmlFor="proj-customer">Client</label><select id="proj-customer" className="select select-sm max-w-44" value={project.customerId} onChange={(e) => setProject({ ...project, customerId: e.target.value })}>{customers.length === 0 ? <option value="">add a client first</option> : null}{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="field-label" htmlFor="proj-rate">Rate per hour</label><input id="proj-rate" type="number" min="0" step="0.01" className="input input-sm figure w-28" value={project.rate} onChange={(e) => setProject({ ...project, rate: e.target.value })} /></div>
        <div className="min-w-[12rem]"><label className="field-label" htmlFor="proj-default-tasks">Default tasks</label><input id="proj-default-tasks" className="input input-sm w-full" value={project.defaultTasks} onChange={(e) => setProject({ ...project, defaultTasks: e.target.value })} placeholder="General, Meeting" /><p className="mt-1 text-xs ink-muted">Comma-separated; leave blank for none.</p></div>
        <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={busy || !project.name.trim() || !project.customerId} onClick={addProject}><Icon name="plus" size={15} />{busy ? "Adding…" : "Add project"}</button>
      </div>

      <div className="mt-3 grid grid-cols-2 items-end gap-x-5 gap-y-4 bg-base-200 p-4 sm:grid-cols-[auto_1fr_auto_auto]">
        <div className="flex items-end"><ImagePicker value={activity.imageUrl} name={activity.name} emoji={activity.emoji} label="Activity image" onChange={(imageUrl) => setActivity({ ...activity, imageUrl })} /></div>
        <div className="min-w-[10rem]"><label className="field-label" htmlFor="act-name">New activity</label><input id="act-name" className="input input-sm w-full" placeholder="Code review" value={activity.name} onChange={(e) => setActivity({ ...activity, name: e.target.value })} /></div>
        <div><label className="field-label" htmlFor="act-emoji">Emoji</label><EmojiPicker value={activity.emoji} label="New activity emoji" onChange={(emoji) => setActivity({ ...activity, emoji })} /></div>
        <button type="button" className="btn btn-primary btn-sm justify-self-start" disabled={busy || !activity.name.trim()} onClick={addActivity}><Icon name="plus" size={15} />{busy ? "Adding…" : "Add activity"}</button>
        <p className="col-span-2 text-sm ink-muted sm:col-span-3 sm:col-start-2">Activities are shared — Development, Meeting, Design… Pick an emoji from the picker, or paste any emoji into its search box.</p>
      </div>

      <div className="mt-10"><h3 className="mb-2 text-base font-semibold">Clients{customers.length > PAGE_SIZE ? <span className="ml-2 text-xs ink-muted">{customers.length} total</span> : null}</h3><p className="ink-muted mb-3 text-sm">The client's currency is used for every rate and billed amount on their projects and entries.</p><div className="overflow-x-auto"><table className="table table-sm"><thead><ListHead><th>Name</th><th>Currency</th><th>Rate</th><th /></ListHead></thead><tbody>{customers.length ? clientSlice.map((customerItem) => <CustomerRow key={customerItem.id} customer={customerItem} busy={busy} onSave={(patch) => onSaveCustomer(customerItem.id, patch)} onArchive={() => onArchiveCustomer(customerItem.id)} />) : <tr><td colSpan="4" className="py-6 text-sm ink-muted">No clients yet. Add your first client above to define a currency and hourly rate.</td></tr>}</tbody></table></div><Pager page={clientPage} pages={clientPages} onPage={setClientPage} /></div>
      <div className="mt-8"><h3 className="mb-2 text-base font-semibold">Projects{projects.length > PAGE_SIZE ? <span className="ml-2 text-xs ink-muted">{projects.length} total</span> : null}</h3><div className="overflow-x-auto"><table className="table table-sm"><thead><ListHead><th>Name</th><th>Client</th><th>Rate</th><th>Bills</th><th /></ListHead></thead><tbody>{projects.length ? projectSlice.map((projectItem) => <ProjectRow key={projectItem.id} project={projectItem} customers={customers} busy={busy} onSave={(patch) => onSaveProject(projectItem.id, patch)} onArchive={() => onArchiveProject(projectItem.id)} />) : <tr><td colSpan="5" className="py-6 text-sm ink-muted">No projects yet. Add a client first, then create the project you will track time against.</td></tr>}</tbody></table></div><Pager page={projectPage} pages={projectPages} onPage={setProjectPage} /></div>
      <div className="mt-8"><h3 className="mb-2 text-base font-semibold">Activities{activities.length > PAGE_SIZE ? <span className="ml-2 text-xs ink-muted">{activities.length} total</span> : null}</h3><div className="overflow-x-auto"><table className="table table-sm"><tbody>{activities.length ? activitySlice.map((activityItem) => <ActivityRow key={activityItem.id} activity={activityItem} busy={busy} onSave={(patch) => onSaveActivity(activityItem.id, patch)} onArchive={() => onArchiveActivity(activityItem.id)} />) : <tr><td className="py-6 text-sm ink-muted">No activities yet. Add a shared activity such as Development, Design, or Meeting.</td></tr>}</tbody></table></div><Pager page={activityPage} pages={activityPages} onPage={setActivityPage} /></div>

      {showArchived ? (
        <div className="mt-10 border-t border-base-300 pt-6">
          <h3 className="text-base font-semibold">Archived records</h3>
          <p className="ink-muted mt-1 text-sm">Archived records stay attached to historical entries. Restore one to use it for new time.</p>
          {archivedCustomers.length ? <ArchivedTable title="Clients">{archivedCustomers.map((item) => <tr key={item.id} className="border-b border-base-300"><td>{item.name}</td><td className="ink-muted">{item.currency} · {formatMoney(item.hourly_rate, item.currency || "USD")}/h</td><td className="text-right"><RestoreButton busy={busy} onClick={() => onRestoreCustomer(item.id)} /></td></tr>)}</ArchivedTable> : null}
          {archivedProjects.length ? <ArchivedTable title="Projects">{archivedProjects.map((item) => <tr key={item.id} className="border-b border-base-300"><td>{item.name}</td><td className="ink-muted">{item.customer_name || "Archived client"}{item.customer_archived_at ? <span className="ml-2 text-xs text-accent">client archived</span> : null}</td><td className="text-right">{item.customer_archived_at ? <span className="text-xs ink-muted">Restore client first</span> : <RestoreButton busy={busy} onClick={() => onRestoreProject(item.id)} />}</td></tr>)}</ArchivedTable> : null}
          {archivedActivities.length ? <ArchivedTable title="Activities">{archivedActivities.map((item) => <tr key={item.id} className="border-b border-base-300"><td>{item.name}</td><td className="text-right"><RestoreButton busy={busy} onClick={() => onRestoreActivity(item.id)} /></td></tr>)}</ArchivedTable> : null}
          {!archivedCount ? <p className="ink-muted mt-5 text-sm">Nothing is archived.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
