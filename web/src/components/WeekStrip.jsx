import { formatDuration, formatMoney, toHours } from "../lib/format.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekday = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }).slice(0, 2);
const dayNumber = (ms) => new Date(ms).toISOString().slice(8, 10);

/**
 * The week as a ruled tally: one column per day, height proportional to recorded time,
 * a mono figure under each so a short bar is still a number you can read, and all of it
 * anchored to one baseline. This is the honest answer to "where did the hours go",
 * where another summary number would just be another number.
 *
 * Days are UTC, matching the ledger's dates and the server's own day arithmetic.
 */
export default function WeekStrip({ entries, activeDay, onPickDay }) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const ms = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (6 - index) * DAY_MS;
    return { ms, key: dayKey(ms), isToday: index === 6 };
  });

  const closed = entries.filter((e) => !e.is_running);
  const perDay = days.map((day) => {
    const mine = closed.filter((e) => dayKey(e.start_time) === day.key);
    return {
      seconds: mine.reduce((sum, e) => sum + (e.duration_seconds || 0), 0),
      cost: mine.reduce((sum, e) => sum + Number(e.cost || 0), 0),
    };
  });

  const weekSeconds = perDay.reduce((sum, d) => sum + d.seconds, 0);
  const weekCost = perDay.reduce((sum, d) => sum + d.cost, 0);
  const peak = Math.max(...perDay.map((d) => d.seconds), 1);
  // Billed is shown in the currency with the most billed value this week; entries keep
  // their own currency on the ledger rows themselves.
  const costByCurrency = {};
  for (const e of closed) costByCurrency[e.currency || "?"] = (costByCurrency[e.currency || "?"] || 0) + Number(e.cost || 0);
  const currency = Object.entries(costByCurrency).sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";

  return (
    <section className="rule flex flex-wrap items-end justify-between gap-x-10 gap-y-5 py-5">
      <div>
        <h2 className="field-label">Last 7 days</h2>
        <div className="flex items-end gap-3" role="group" aria-label="Hours per day over the last 7 days">
          {days.map((day, i) => {
            const { seconds, cost } = perDay[i];
            const picked = activeDay === day.key;
            return (
              <button
                key={day.key}
                type="button"
                className="group flex w-9 flex-col items-center gap-1"
                aria-pressed={picked}
                title={`${day.key}: ${formatDuration(seconds)}, ${formatMoney(cost, currency)}`}
                onClick={() => onPickDay?.(picked ? null : day.key)}
              >
                {/* The bar sits in a fixed-height slot and grows up from the baseline, so
                    a light day and an empty one sit on the same axis. */}
                <span className="flex h-11 w-5 items-end">
                  <span
                    className={`w-full ${
                      picked ? "bg-base-content" : seconds > 0 ? "bg-base-content/70" : "bg-base-300"
                    }`}
                    style={{ height: `${seconds > 0 ? Math.max(4, Math.round((seconds / peak) * 40)) : 2}px` }}
                  />
                </span>
                <span className={`figure w-full text-center text-xs ${picked ? "font-semibold" : "ink-muted"}`}>
                  {seconds > 0 ? toHours(seconds) : "—"}
                </span>
                <span
                  className={`ink-muted w-full pt-1 text-center text-xs ${
                    picked
                      ? "border-t-2 border-base-content font-medium"
                      : "border-t border-base-300"
                  }`}
                >
                  <span className={day.isToday ? "font-medium" : ""}>{weekday(day.ms)}</span>
                  <span className="sr-only"> {dayNumber(day.ms)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <dl className="flex items-end gap-8">
        <div>
          <dt className="field-label">Hours</dt>
          <dd className="figure text-xl font-medium leading-none">{formatDuration(weekSeconds)}</dd>
        </div>
        <div>
          <dt className="field-label">Billed</dt>
          <dd className="figure text-xl font-medium leading-none">{formatMoney(weekCost, currency)}</dd>
        </div>
      </dl>
    </section>
  );
}
