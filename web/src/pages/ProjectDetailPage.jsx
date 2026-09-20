import { useEffect, useState } from "react";
import DetailPager from "../components/DetailPager.jsx";
import IdentityMark from "../components/IdentityMark.jsx";
import Ledger from "../components/Ledger.jsx";
import RankedBars from "../components/RankedBars.jsx";
import { addProjectTask, getProject, removeProjectTask } from "../lib/api.js";
import { formatDuration, formatMoney } from "../lib/format.js";
import { Link, useParams } from "../lib/router.jsx";
import { useDetailPage } from "../lib/useDetailPage.js";

const PAGE = 50;

export default function ProjectDetailPage() {
  const match = useParams("/projects/:id");
  const id = match?.params.id;
  const { data, error, loading, offset, setOffset, reload } = useDetailPage(getProject, id, { limit: PAGE });
  const [taskName, setTaskName] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [taskNotice, setTaskNotice] = useState("");

  useEffect(() => {
    document.title = "Project · Timetracker";
    return () => {
      document.title = "Timetracker";
    };
  }, []);

  if (error) {
    return (
      <section className="py-16">
        <h1 className="text-xl font-semibold">Project unavailable</h1>
        <p className="ink-muted mt-2 max-w-[55ch]">The project record could not be loaded.</p>
        <p className="figure mt-2 text-sm text-accent">{error}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={reload}>Try again</button>
          <Link className="btn btn-ghost ring-1 ring-inset ring-base-300" to="/settings">Open settings</Link>
        </div>
      </section>
    );
  }

  const project = data?.project;
  const currency = project?.currency || project?.customer_currency || "USD";
  const rateLine =
    project?.rate > 0
      ? `${formatMoney(project.rate, currency)}/h`
      : project
        ? `No project rate set, so every entry inherits the client rate: ${formatMoney(project.customer_rate || 0, currency)}/h (${project.customer_name || "client"}).`
        : "—";

  return (
    <div>
      <nav className="no-print pt-8 text-sm" aria-label="Breadcrumb">
        <Link className="ink-muted link" to="/settings">Settings</Link>
        <span className="ink-muted mx-2">/</span>
        {project ? <Link className="ink-muted link" to={`/clients/${project.customer_id}`}>{project.customer_name}</Link> : <span>Client</span>}
      </nav>

      <header className="rule flex flex-wrap items-end justify-between gap-x-10 gap-y-4 py-6">
        <div className="flex items-center gap-3">
          <IdentityMark name={project?.name} imageUrl={project?.image_url} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold">{project ? project.name : "Project"}</h1>
          <p className="ink-muted mt-1 text-sm">
            {project ? rateLine : "Loading…"}
            {project?.archived_at ? <span className="ml-2 badge badge-ghost badge-sm">Archived</span> : null}
          </p>
          </div>
        </div>
        <dl className="flex items-end gap-8">
          <div>
            <dt className="field-label">Closed entries</dt>
            <dd className="figure text-xl font-medium leading-none">{project ? data.totals.entry_count : "—"}</dd>
          </div>
          <div>
            <dt className="field-label">Hours</dt>
            <dd className="figure text-xl font-medium leading-none">{project ? formatDuration(data.totals.total_seconds) : "—"}</dd>
          </div>
          <div>
            <dt className="field-label">Billed</dt>
            <dd className="figure text-accent text-xl font-medium leading-none">
              {project ? formatMoney(data.totals.total_cost, currency) : "—"}
            </dd>
          </div>
        </dl>
      </header>

      {!data ? (
        <p className="ink-muted py-16"><span className="loading loading-spinner loading-sm" /> Loading project…</p>
      ) : (
        <>
          <section className="rule py-7">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Project tasks</h2>
                <p className="ink-muted mt-1 text-sm">General and Meeting are added by default. Add or remove tasks without changing historical entries.</p>
              </div>
              <form className="flex gap-2" onSubmit={async (event) => {
                event.preventDefault();
                if (!taskName.trim()) return;
                setTaskBusy(true);
                setTaskError("");
                setTaskNotice("");
                try {
                  await addProjectTask(id, { name: taskName.trim() });
                  setTaskName("");
                  setTaskNotice("Task added. Refresh the page to use it in the timer.");
                  reload();
                } catch (err) {
                  setTaskError(err.message);
                } finally {
                  setTaskBusy(false);
                }
              }}>
                <input className="input input-sm w-40" value={taskName} onChange={(event) => setTaskName(event.target.value)} placeholder="New task" aria-label="New project task" />
                <button className="btn btn-primary btn-sm" disabled={taskBusy || !taskName.trim()} type="submit">{taskBusy ? "Adding…" : "Add task"}</button>
              </form>
            </div>
            {taskError ? <p className="mt-3 text-sm text-accent" role="alert">{taskError}</p> : null}
            {taskNotice ? <p className="mt-3 text-sm text-success" role="status">{taskNotice}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {(data.tasks || []).map((task) => <span key={task.id} className="badge badge-outline gap-2 py-3">{task.emoji || "•"} {task.name}{task.is_default ? <span className="text-xs opacity-60">default</span> : null}<button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${task.name}`} disabled={taskBusy} onClick={async () => { setTaskBusy(true); setTaskError(""); try { await removeProjectTask(id, task.id); reload(); } catch (err) { setTaskError(err.message); } finally { setTaskBusy(false); } }}>×</button></span>)}
              {!data.tasks?.length ? <span className="ink-muted text-sm">No curated tasks yet; the timer shows shared activities.</span> : null}
            </div>
          </section>

          <section className="rule py-7">
            <h2 className="text-lg font-semibold">Where the time went</h2>
            <p className="ink-muted mt-1 text-sm">By activity, in this project's billing currency.</p>
            <div className="mt-5 max-w-2xl">
              <RankedBars rows={data.by_activity} valueKey="total_cost" money />
            </div>
          </section>

          <section className="pb-10">
            <h2 className="text-lg font-semibold">Time history</h2>
            <p className="ink-muted mt-1 text-sm">
              This project's recorded entries{data.paging.returned < data.totals.entry_count ? " (newest first)" : ""}.
            </p>
            <div className="mt-4">
              <Ledger entries={data.entries} scopeLabel={`Project: ${project?.name ?? ""}`} />
            </div>
            <DetailPager
              shown={data.entries.length}
              total={data.totals.entry_count}
              offset={offset}
              limit={PAGE}
              loading={loading}
              onNewer={() => setOffset(Math.max(0, offset - PAGE))}
              onOlder={() => setOffset(offset + PAGE)}
            />
          </section>
        </>
      )}
    </div>
  );
}
