import { useEffect, useState } from "react";
import { Link } from "../lib/router.jsx";
import { formatDuration } from "../lib/format.js";
import Icon from "./Icon.jsx";

export default function TopTimerBar({ activeTimer, customers, projects, busy, onStop }) {
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(activeTimer);

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running]);

  if (!running) {
    return (
      <Link className="btn btn-primary btn-sm" to="/timesheet">
        <Icon name="play" size={16} />
        Start timer
      </Link>
    );
  }

  const client = customers.find((item) => item.id === activeTimer.customer_id);
  const project = projects.find((item) => item.id === activeTimer.project_id);
  const elapsed = Math.max(0, Math.floor((now - activeTimer.start_time) / 1000));

  return (
    <div className="flex min-h-11 items-center gap-3 border-l-2 border-accent pl-3" aria-label="Timer currently running" role="status">
      <span className="size-2 rounded-full bg-accent animate-pulse-dot" aria-hidden="true" />
      <span className="hidden max-w-32 truncate text-sm sm:inline">
        {client?.name || "Client"} / {project?.name || "Project"}
      </span>
      <span className="sr-only">Timer running for </span>
      <span className="figure text-base font-medium text-accent" aria-live="polite" aria-label={`Elapsed time ${formatDuration(elapsed)}`}>
        {formatDuration(elapsed)}
      </span>
      <button className="btn btn-accent btn-sm" type="button" disabled={busy} onClick={onStop}>
        <Icon name="stop" size={16} />
        {busy ? "Stopping…" : "Stop timer"}
      </button>
    </div>
  );
}
