import { formatDuration, utcDate } from "../lib/format.js";

/**
 * The punch band, and the one bold place on the page: while a timer runs, the clock
 * and the red pen mark are the only colour on the sheet, so red always means "time is
 * being recorded right now". Idle, the band says what is true and offers the one thing
 * worth offering from a previous entry: picking it up again.
 */
export default function PunchClock({
  activeTimer,
  elapsedSeconds,
  clientName,
  projectName,
  lastEntry,
  busy,
  onStop,
  onResume,
}) {
  const running = Boolean(activeTimer);

  const lastLabel = lastEntry
    ? `${lastEntry.customer_name || "no client"} / ${lastEntry.project_name || "no project"}`
    : "";

  return (
    <section
      className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-l-[3px] py-5 ${
        running ? "border-accent bg-accent/[0.04] pl-4 pr-4" : "border-transparent pl-0"
      }`}
      aria-label={running ? "Recording time" : "Not recording time"}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${running ? "text-accent" : "ink-muted"}`}>
          {running ? (
            <>
              <span className="mr-2 inline-block size-2.5 translate-y-px rounded-full bg-accent" aria-hidden="true" />
              Recording
            </>
          ) : (
            "Not on the clock"
          )}
        </p>

        {running ? (
          <p className="mt-1 truncate text-lg">
            <span className="font-medium">{clientName}</span>
            <span className="ink-muted"> / </span>
            {projectName}
            {activeTimer.description ? (
              <>
                <span className="ink-muted"> / </span>
                {activeTimer.description}
              </>
            ) : null}
          </p>
        ) : (
          <p className="ink-muted mt-1 text-sm">
            {lastEntry ? (
              <>
                Last entry: {lastLabel}, {utcDate(lastEntry.end_time || lastEntry.start_time)}.
              </>
            ) : (
              "Fill in the line below to start the first entry."
            )}
          </p>
        )}
      </div>

      <div className="flex items-center gap-5">
        {running ? (
          <p className="figure text-accent text-4xl font-medium leading-none sm:text-5xl" aria-live="off">
            {formatDuration(elapsedSeconds)}
          </p>
        ) : lastEntry ? (
          <button className="btn btn-ghost btn-sm ring-1 ring-inset ring-base-300" disabled={busy} onClick={onResume}>
            Use last entry
          </button>
        ) : null}

        {running ? (
          <button className="btn btn-accent" disabled={busy} onClick={onStop}>
            Stop timer
          </button>
        ) : null}
      </div>
    </section>
  );
}
