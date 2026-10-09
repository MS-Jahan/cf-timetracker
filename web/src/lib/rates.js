// Rows for the printed "Hourly rates" table, derived from each closed entry's
// stored rate_applied. Rules: docs/2026-10-09-print-hourly-rates.md
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cents = (rate) => Math.round(Number(rate || 0) * 100);

/** Consecutive same-rate stretches of time-ordered entries. */
function runsOf(entries) {
  const runs = [];
  for (const e of entries) {
    const rate = cents(e.rate_applied);
    const currency = e.currency || "USD";
    const last = runs[runs.length - 1];
    if (last && last.rate === rate && last.currency === currency) last.to = e.start_time;
    else runs.push({ rate, currency, from: e.start_time, to: e.start_time });
  }
  return runs;
}

const byName = (a, b) => String(a).localeCompare(String(b));

/**
 * @returns {{ rows: Array<{client, project, currency, rate, from, to}>, showProject: boolean, showDates: boolean }}
 * `project` is null for client-level rows; `rate` is a number (2 decimals).
 */
export function buildRateRows(entries) {
  const closed = entries.filter((e) => !e.is_running).sort((a, b) => a.start_time - b.start_time);
  const clients = new Map();
  for (const e of closed) {
    const key = e.customer_id || e.customer_name || "?";
    if (!clients.has(key)) clients.set(key, { name: e.customer_name || "-", entries: [] });
    clients.get(key).entries.push(e);
  }

  const groups = [];
  for (const client of [...clients.values()].sort((a, b) => byName(a.name, b.name))) {
    const projects = new Map();
    for (const e of client.entries) {
      const key = e.project_id || e.project_name || "?";
      if (!projects.has(key)) projects.set(key, { name: e.project_name || "-", entries: [] });
      projects.get(key).entries.push(e);
    }
    const clientRuns = runsOf(client.entries);
    const projectGroups = [...projects.values()]
      .sort((a, b) => byName(a.name, b.name))
      .map((p) => ({ project: p.name, runs: runsOf(p.entries) }));
    const projectRunCount = projectGroups.reduce((n, g) => n + g.runs.length, 0);
    const clientLevel = clientRuns.length === 1 || projects.size === 1 || clientRuns.length < projectRunCount;
    const parts = clientLevel ? [{ project: null, runs: clientRuns }] : projectGroups;
    for (const part of parts) groups.push({ client, ...part });
  }

  const rows = groups.flatMap((g) =>
    g.runs.map((r) => ({ client: g.client.name, project: g.project, currency: r.currency, rate: r.rate / 100, from: r.from, to: r.to }))
  );
  return {
    rows,
    showProject: groups.some((g) => g.project !== null),
    showDates: groups.some((g) => g.runs.length > 1),
  };
}

/** Short local range: "5 Sep", "1 – 14 Sep", "28 Sep – 4 Oct"; adds years when withYear. */
export function shortRange(fromMs, toMs, withYear) {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  const day = (d, year) => `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ""}`;
  const sameDay = a.toDateString() === b.toDateString();
  if (sameDay) return day(a, withYear);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${a.getDate()} – ${day(b, withYear)}`;
  }
  return `${day(a, withYear)} – ${day(b, withYear)}`;
}
