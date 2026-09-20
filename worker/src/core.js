// Shared D1 operations. REST handlers (src/index.js) and MCP tools (src/mcp.js)
// both call these so validation, rate math and single-timer guarding cannot drift.

/** Machine-readable reason codes, surfaced to REST (HTTP status) and MCP (payload). */
export const ERROR_CODES = {
  TIMER_RUNNING: "timer_running",
  NO_ACTIVE_TIMER: "no_active_timer",
};

const TIMER_RUNNING_MESSAGE = "A timer is already active.";
const NO_TIMER_MESSAGE = "No active timer found.";

export async function getActiveTimer(env) {
  return env.DB.prepare("SELECT * FROM time_entries WHERE is_running = 1 LIMIT 1").first();
}

/**
 * D1/SQLite phrase for our partial unique index (idx_entries_single_running):
 * "UNIQUE constraint failed: time_entries.is_running".
 */
function isUniqueViolation(err) {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(err?.message || ""));
}

/** Rate fallback: explicit hourlyRate ?? project.rate ?? customer.hourly_rate ?? 0 */
export async function resolveRate(env, projectId, customerId, hourlyRate) {
  if (hourlyRate !== undefined && hourlyRate !== null && hourlyRate !== "") return Number(hourlyRate);
  const proj = await env.DB.prepare("SELECT rate FROM projects WHERE id = ?").bind(projectId).first();
  if (proj && proj.rate) return proj.rate;
  const cust = await env.DB.prepare("SELECT hourly_rate FROM customers WHERE id = ?").bind(customerId).first();
  return cust?.hourly_rate ?? 0;
}

/** Returns the list of FK names that don't exist. */
export async function validateRefs(env, customerId, projectId, activityId) {
  const [cust, proj, act] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM customers WHERE id = ? AND archived_at IS NULL").bind(customerId).first(),
    env.DB.prepare(`
      SELECT 1 FROM projects p
      JOIN customers c ON c.id = p.customer_id
      WHERE p.id = ? AND p.archived_at IS NULL AND c.archived_at IS NULL
    `).bind(projectId).first(),
    env.DB.prepare("SELECT 1 FROM activities WHERE id = ? AND archived_at IS NULL").bind(activityId).first(),
  ]);
  const missing = [];
  if (!cust) missing.push("customerId");
  if (!proj) missing.push("projectId");
  if (!act) missing.push("activityId");
  return missing;
}

/**
 * If a project has a curated task list, only linked tasks may be used for new
 * timers. Projects created before project_tasks existed remain compatible and
 * continue to use the shared activity list until curated.
 */
export async function validateTaskForProject(env, projectId, activityId) {
  const [configured, linked] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM project_tasks WHERE project_id = ?").bind(projectId).first(),
    env.DB.prepare("SELECT 1 FROM project_tasks WHERE project_id = ? AND activity_id = ?").bind(projectId, activityId).first(),
  ]);
  return Number(configured?.total || 0) === 0 || Boolean(linked);
}

/**
 * Start a timer. Returns { status: "ok", timer } or { status: "invalid"|"conflict", error, code }.
 * `invalid` maps to HTTP 400 / JSON-RPC -32602; `conflict` maps to HTTP 409 and, in MCP,
 * a tool-level isError carrying `code: "timer_running"`.
 *
 * The pre-check is a fast path only. Correctness comes from the partial unique index
 * on time_entries(is_running) WHERE is_running = 1: if a concurrent request slipped in
 * between the check and the insert, the insert fails and we return the same conflict.
 */
export async function startTimer(env, { customerId, projectId, activityId, description, tags, hourlyRate }) {
  if (!customerId || !projectId || !activityId) {
    return { status: "invalid", error: "customerId, projectId and activityId are required" };
  }
  const missing = await validateRefs(env, customerId, projectId, activityId);
  if (missing.length) return { status: "invalid", error: `Unknown ids: ${missing.join(", ")}` };
  if (!(await validateTaskForProject(env, projectId, activityId))) {
    return { status: "invalid", error: "activityId is not enabled as a task for this project" };
  }

  if (await getActiveTimer(env)) {
    return { status: "conflict", error: TIMER_RUNNING_MESSAGE, code: ERROR_CODES.TIMER_RUNNING };
  }

  const id = crypto.randomUUID();
  const startTime = Date.now();
  const rate = await resolveRate(env, projectId, customerId, hourlyRate);

  try {
    await env.DB.prepare(`
      INSERT INTO time_entries (id, customer_id, project_id, activity_id, description, tags, start_time, rate_applied, is_running)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(id, customerId, projectId, activityId, description || "", tags || "", startTime, rate).run();
  } catch (err) {
    // Lost the race: another request inserted a running row first.
    if (isUniqueViolation(err)) {
      return { status: "conflict", error: TIMER_RUNNING_MESSAGE, code: ERROR_CODES.TIMER_RUNNING };
    }
    throw err;
  }

  const timer = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  return { status: "ok", timer };
}

/**
 * Stop the running timer. Returns { status: "ok", timer } or { status: "not_found", error, code }.
 * duration = max(1, round((end - start)/1000))s; cost = duration/3600 * rate_applied.
 *
 * The UPDATE is conditional on is_running = 1 and checks the affected row count, so two
 * concurrent stops cannot both report success (and cannot double-apply a duration).
 */
export async function stopTimer(env) {
  const active = await getActiveTimer(env);
  if (!active) return { status: "not_found", error: NO_TIMER_MESSAGE, code: ERROR_CODES.NO_ACTIVE_TIMER };

  const endTime = Date.now();
  const durationSeconds = Math.max(1, Math.round((endTime - active.start_time) / 1000));
  const cost = (durationSeconds / 3600) * (active.rate_applied || 0);

  const { meta } = await env.DB.prepare(`
    UPDATE time_entries SET end_time = ?, duration_seconds = ?, cost = ?, is_running = 0
    WHERE id = ? AND is_running = 1
  `).bind(endTime, durationSeconds, cost, active.id).run();

  if (!meta?.changes) {
    return { status: "not_found", error: NO_TIMER_MESSAGE, code: ERROR_CODES.NO_ACTIVE_TIMER };
  }

  const timer = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(active.id).first();
  return { status: "ok", timer };
}

/** Half-open UTC [monthStart, nextMonthStart) for a "YYYY-MM" key. */
export function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    startMs: Date.UTC(y, m - 1, 1),
    endMs: Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1),
  };
}

export const isValidMonth = (value) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value);

/**
 * Aggregate closed entries per customer/project.
 * Returns { status, rows?, totals, range } or { status: "invalid", error }.
 */
export async function querySummary(env, { fromMs, toMs, month } = {}) {
  let start = null;
  let end = null;
  let rangeLabel = "all time";

  if (month !== undefined && month !== null && month !== "") {
    if (!isValidMonth(month)) return { status: "invalid", error: "month must be YYYY-MM" };
    ({ startMs: start, endMs: end } = monthRange(month));
    rangeLabel = month;
  } else if (fromMs !== undefined || toMs !== undefined) {
    if (!Number.isFinite(Number(fromMs)) || !Number.isFinite(Number(toMs))) {
      return { status: "invalid", error: "fromMs and toMs must both be numbers" };
    }
    start = Number(fromMs);
    end = Number(toMs);
    if (start > end) return { status: "invalid", error: "fromMs must be <= toMs" };
    rangeLabel = `${new Date(start).toISOString()} → ${new Date(end).toISOString()}`;
  }

  let where = "te.is_running = 0";
  const bind = [];
  if (start !== null && end !== null) {
    where += " AND te.start_time >= ? AND te.start_time < ?";
    bind.push(start, end);
  }

  const { results } = await env.DB.prepare(`
    SELECT c.name AS customer, p.name AS project,
           MIN(c.currency) AS currency,
           SUM(te.duration_seconds) AS total_seconds,
           SUM(te.cost)             AS total_cost,
           COUNT(*)                 AS entry_count
    FROM time_entries te
    LEFT JOIN customers c ON te.customer_id = c.id
    LEFT JOIN projects  p ON te.project_id = p.id
    WHERE ${where}
    GROUP BY te.customer_id, te.project_id
    ORDER BY total_seconds DESC
  `).bind(...bind).all();

  const rows = (results || []).map((r) => ({
    customer: r.customer ?? "—",
    project: r.project ?? "—",
    ...(r.currency ? { currency: r.currency } : {}),
    total_seconds: Math.round(r.total_seconds || 0),
    total_hours: Number(((r.total_seconds || 0) / 3600).toFixed(2)),
    total_cost: Number((r.total_cost || 0).toFixed(2)),
    entry_count: r.entry_count,
  }));

  const totals = {
    total_seconds: rows.reduce((s, r) => s + r.total_seconds, 0),
    total_cost: Number(rows.reduce((s, r) => s + r.total_cost, 0).toFixed(2)),
    entry_count: rows.reduce((s, r) => s + r.entry_count, 0),
  };
  totals.total_hours = Number((totals.total_seconds / 3600).toFixed(2));

  return { status: "ok", rows, totals, range: rangeLabel };
}

/** Detailed dashboard aggregates, kept separate from the 50-row bootstrap feed. */
export async function queryDashboard(env, { fromMs, toMs, month } = {}) {
  let start = null;
  let end = null;
  let rangeLabel = "all time";

  if (month !== undefined && month !== null && month !== "") {
    if (!isValidMonth(month)) return { status: "invalid", error: "month must be YYYY-MM" };
    ({ startMs: start, endMs: end } = monthRange(month));
    rangeLabel = month;
  } else if (fromMs !== undefined || toMs !== undefined) {
    if (!Number.isFinite(Number(fromMs)) || !Number.isFinite(Number(toMs))) {
      return { status: "invalid", error: "fromMs and toMs must both be numbers" };
    }
    start = Number(fromMs);
    end = Number(toMs);
    if (start > end) return { status: "invalid", error: "fromMs must be <= toMs" };
    rangeLabel = `${new Date(start).toISOString()} → ${new Date(end).toISOString()}`;
  }

  const filters = ["te.is_running = 0"];
  const bind = [];
  if (start !== null && end !== null) {
    filters.push("te.start_time >= ?", "te.start_time < ?");
    bind.push(start, end);
  }
  const where = filters.join(" AND ");

  const [summary, daily, customers, projects, activities] = await Promise.all([
    querySummary(env, { fromMs: start ?? undefined, toMs: end ?? undefined }),
    env.DB.prepare(`
      SELECT date(te.start_time / 1000, 'unixepoch') AS day,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost,
             COUNT(*) AS entry_count
      FROM time_entries te
      WHERE ${where}
      GROUP BY day
      ORDER BY day ASC
    `).bind(...bind).all(),
    env.DB.prepare(`
      SELECT c.id AS customer_id, c.name AS name, c.image_url, MIN(c.currency) AS currency, SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost, COUNT(*) AS entry_count
      FROM time_entries te LEFT JOIN customers c ON te.customer_id = c.id
      WHERE ${where}
      GROUP BY te.customer_id ORDER BY total_cost DESC
    `).bind(...bind).all(),
    env.DB.prepare(`
      SELECT p.id AS project_id, p.name AS name, p.image_url, c.name AS customer, MIN(c.currency) AS currency,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost, COUNT(*) AS entry_count
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN customers c ON te.customer_id = c.id
      WHERE ${where}
      GROUP BY te.project_id ORDER BY total_seconds DESC
    `).bind(...bind).all(),
    env.DB.prepare(`
      SELECT a.id AS activity_id, a.name AS name, a.emoji, a.image_url, MIN(c.currency) AS currency,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost, COUNT(*) AS entry_count
      FROM time_entries te
      LEFT JOIN activities a ON te.activity_id = a.id
      LEFT JOIN customers c ON te.customer_id = c.id
      WHERE ${where}
      GROUP BY te.activity_id ORDER BY total_seconds DESC
    `).bind(...bind).all(),
  ]);

  const mapRows = (results) => (results || []).map((row) => ({
    ...(row.currency ? { currency: row.currency } : {}),
    ...row,
    total_seconds: Math.round(row.total_seconds || 0),
    total_hours: Number(((row.total_seconds || 0) / 3600).toFixed(2)),
    total_cost: Number((row.total_cost || 0).toFixed(2)),
    entry_count: Number(row.entry_count || 0),
  }));

  const totalSeconds = summary.totals.total_seconds;
  const totalCost = summary.totals.total_cost;
  // Dominant currency for the headline totals: the one the most billed value is in.
  const currencyCounts = {};
  for (const row of summary.rows) {
    if (row.currency) currencyCounts[row.currency] = (currencyCounts[row.currency] || 0) + row.total_cost;
  }
  const dominantCurrency = Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    status: "ok",
    range: rangeLabel,
    ...(dominantCurrency ? { currency: dominantCurrency } : {}),
    totals: {
      ...summary.totals,
      average_rate: totalSeconds ? Number((totalCost / (totalSeconds / 3600)).toFixed(2)) : 0,
      average_duration: summary.totals.entry_count ? Math.round(totalSeconds / summary.totals.entry_count) : 0,
    },
    by_day: mapRows(daily.results),
    by_customer: mapRows(customers.results),
    by_project: mapRows(projects.results),
    by_activity: mapRows(activities.results),
  };
}

// ---------------------------------------------------------------------------
// Master data (customers / projects / activities). Used by the REST CRUD routes
// and, in future, by MCP admin tools. Validation lives here so both stay honest.
// ---------------------------------------------------------------------------

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const asRate = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));

function optionalImageDataUrl(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || String(value).trim() === "") return { value: null };
  const dataUrl = String(value).trim();
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    return { error: "image must be a resized JPEG, PNG, or WebP data URL" };
  }
  if (dataUrl.length > 180_000) return { error: "image must be 180 KB or smaller after compression" };
  return { value: dataUrl };
}

function optionalEmoji(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || String(value).trim() === "") return { value: null };

  const emoji = String(value).trim();
  if ([...emoji].length > 8) return { error: "emoji must be 8 characters or fewer" };
  return { value: emoji };
}

function badRate(rate) {
  return !Number.isFinite(rate) || rate < 0 ? "rate must be a number >= 0" : null;
}

/** customers: name (required), currency (3 letters), hourly_rate — the client's default rate. */
export async function createCustomer(env, { name, currency, hourlyRate, imageUrl } = {}) {
  if (isBlank(name)) return { status: "invalid", error: "name is required" };
  const code = isBlank(currency) ? "USD" : String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { status: "invalid", error: "currency must be a 3-letter code, e.g. USD" };
  const rate = asRate(hourlyRate);
  const rateError = badRate(rate);
  if (rateError) return { status: "invalid", error: rateError };
  const image = optionalImageDataUrl(imageUrl);
  if (image.error) return { status: "invalid", error: image.error };

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO customers (id, name, currency, hourly_rate, image_url) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, String(name).trim(), code, rate, image.value ?? null)
    .run();
  return { status: "ok", customer: await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first() };
}

export async function updateCustomer(env, id, patch = {}) {
  const sets = [];
  const bind = [];
  if (patch.name !== undefined) {
    if (isBlank(patch.name)) return { status: "invalid", error: "name cannot be empty" };
    sets.push("name = ?");
    bind.push(String(patch.name).trim());
  }
  if (patch.currency !== undefined) {
    const code = String(patch.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return { status: "invalid", error: "currency must be a 3-letter code, e.g. USD" };
    sets.push("currency = ?");
    bind.push(code);
  }
  if (patch.hourlyRate !== undefined) {
    const rate = asRate(patch.hourlyRate);
    const rateError = badRate(rate);
    if (rateError) return { status: "invalid", error: rateError };
    sets.push("hourly_rate = ?");
    bind.push(rate);
  }
  if (patch.imageUrl !== undefined) {
    const image = optionalImageDataUrl(patch.imageUrl);
    if (image.error) return { status: "invalid", error: image.error };
    sets.push("image_url = ?");
    bind.push(image.value);
  }
  if (!sets.length) return { status: "invalid", error: "no updatable fields provided (name, currency, hourlyRate, imageUrl)" };

  const existing = await env.DB.prepare("SELECT id FROM customers WHERE id = ?").bind(id).first();
  if (!existing) return { status: "not_found", error: "Customer not found" };

  await env.DB.prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`).bind(...bind, id).run();
  return { status: "ok", customer: await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first() };
}

/** projects: customer_id FK, name, budget_type (hourly|fixed), rate — overrides the customer rate.
 *  `defaultTasks` names are linked per project (created globally on demand); the
 *  default when omitted is ["General", "Meeting"], and `[]` opts out entirely. */
export async function createProject(env, { customerId, name, budgetType, rate, currency, imageUrl, defaultTasks } = {}) {
  if (isBlank(customerId)) return { status: "invalid", error: "customerId is required" };
  if (isBlank(name)) return { status: "invalid", error: "name is required" };
  const budget = isBlank(budgetType) ? "hourly" : String(budgetType).trim();
  if (!["hourly", "fixed"].includes(budget)) return { status: "invalid", error: "budgetType must be hourly or fixed" };
  const value = asRate(rate);
  const rateError = badRate(value);
  if (rateError) return { status: "invalid", error: rateError };
  // Optional project currency; blank/absent inherits the client's.
  let projectCurrency = null;
  if (!isBlank(currency)) {
    projectCurrency = String(currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(projectCurrency)) return { status: "invalid", error: "currency must be a 3-letter code, e.g. USD" };
  }
  const image = optionalImageDataUrl(imageUrl);
  if (image.error) return { status: "invalid", error: image.error };

  const customer = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND archived_at IS NULL").bind(customerId).first();
  if (!customer) return { status: "invalid", error: "Unknown customerId" };

  let taskNames = ["General", "Meeting"];
  if (defaultTasks !== undefined) {
    if (!Array.isArray(defaultTasks)) return { status: "invalid", error: "defaultTasks must be an array of task names" };
    taskNames = defaultTasks;
  }
  const seen = new Set();
  const uniqueNames = [];
  for (const value of taskNames) {
    const trimmed = String(value ?? "").trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      uniqueNames.push(trimmed);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO projects (id, customer_id, name, budget_type, rate, currency, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, customerId, String(name).trim(), budget, value, projectCurrency, image.value ?? null)
    .run();

  const tasks = [];
  for (const taskName of uniqueNames) {
    const activity = await findOrCreateActivity(env, taskName);
    if (!activity) continue;
    try {
      await env.DB.prepare(
        "INSERT INTO project_tasks (id, project_id, activity_id, is_default) VALUES (?, ?, ?, 1)"
      ).bind(crypto.randomUUID(), id, activity.id).run();
      tasks.push(activity);
    } catch {
      // Duplicate link (task already linked): skip rather than fail the create.
    }
  }

  return { status: "ok", project: await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first(), tasks };
}

export async function updateProject(env, id, patch = {}) {
  const sets = [];
  const bind = [];
  if (patch.name !== undefined) {
    if (isBlank(patch.name)) return { status: "invalid", error: "name cannot be empty" };
    sets.push("name = ?");
    bind.push(String(patch.name).trim());
  }
  if (patch.budgetType !== undefined) {
    const budget = String(patch.budgetType).trim();
    if (!["hourly", "fixed"].includes(budget)) return { status: "invalid", error: "budgetType must be hourly or fixed" };
    sets.push("budget_type = ?");
    bind.push(budget);
  }
  if (patch.rate !== undefined) {
    const value = asRate(patch.rate);
    const rateError = badRate(value);
    if (rateError) return { status: "invalid", error: rateError };
    sets.push("rate = ?");
    bind.push(value);
  }
  if (patch.currency !== undefined) {
    // Blank clears the override (inherit the client's currency).
    if (isBlank(patch.currency)) {
      sets.push("currency = NULL");
    } else {
      const code = String(patch.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return { status: "invalid", error: "currency must be a 3-letter code, e.g. USD" };
      sets.push("currency = ?");
      bind.push(code);
    }
  }
  if (patch.customerId !== undefined) {
    const customer = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND archived_at IS NULL").bind(patch.customerId).first();
    if (!customer) return { status: "invalid", error: "Unknown or archived customerId" };
    sets.push("customer_id = ?");
    bind.push(patch.customerId);
  }
  if (patch.imageUrl !== undefined) {
    const image = optionalImageDataUrl(patch.imageUrl);
    if (image.error) return { status: "invalid", error: image.error };
    sets.push("image_url = ?");
    bind.push(image.value);
  }
  if (!sets.length) return { status: "invalid", error: "no updatable fields provided (name, customerId, budgetType, rate, imageUrl)" };

  const existing = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
  if (!existing) return { status: "not_found", error: "Project not found" };

  await env.DB.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).bind(...bind, id).run();
  return { status: "ok", project: await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first() };
}

/** activities: name is UNIQUE in the schema; duplicates surface as 409. */
export async function createActivity(env, { name, emoji, imageUrl } = {}) {
  if (isBlank(name)) return { status: "invalid", error: "name is required" };
  const icon = optionalEmoji(emoji);
  if (icon.error) return { status: "invalid", error: icon.error };
  const image = optionalImageDataUrl(imageUrl);
  if (image.error) return { status: "invalid", error: image.error };
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO activities (id, name, emoji, image_url) VALUES (?, ?, ?, ?)").bind(id, String(name).trim(), icon.value ?? null, image.value ?? null).run();
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return { status: "conflict", error: `Activity "${String(name).trim()}" already exists` };
    throw err;
  }
  return { status: "ok", activity: await env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first() };
}

export async function updateActivity(env, id, patch = {}) {
  if (patch.name === undefined && patch.emoji === undefined && patch.imageUrl === undefined) return { status: "invalid", error: "no updatable fields provided (name, emoji, imageUrl)" };
  if (patch.name !== undefined && isBlank(patch.name)) return { status: "invalid", error: "name cannot be empty" };
  const sets = [];
  const bind = [];
  if (patch.name !== undefined) { sets.push("name = ?"); bind.push(String(patch.name).trim()); }
  if (patch.emoji !== undefined) {
    const icon = optionalEmoji(patch.emoji);
    if (icon.error) return { status: "invalid", error: icon.error };
    sets.push("emoji = ?"); bind.push(icon.value);
  }
  if (patch.imageUrl !== undefined) {
    const image = optionalImageDataUrl(patch.imageUrl);
    if (image.error) return { status: "invalid", error: image.error };
    sets.push("image_url = ?"); bind.push(image.value);
  }

  const existing = await env.DB.prepare("SELECT id FROM activities WHERE id = ?").bind(id).first();
  if (!existing) return { status: "not_found", error: "Activity not found" };

  try {
    await env.DB.prepare(`UPDATE activities SET ${sets.join(", ")} WHERE id = ?`).bind(...bind, id).run();
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return { status: "conflict", error: "Another activity already uses that name" };
    throw err;
  }
  return { status: "ok", activity: await env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first() };
}

const ARCHIVE_TABLES = {
  customers: "customers",
  projects: "projects",
  activities: "activities",
};

/** Soft archive or restore a master-data record; historical foreign keys remain valid. */
/**
 * Everything a client detail screen needs in one round trip: the client, their active
 * projects, and their closed time history (most recent first, id-ordered so the
 * limit/offset pages are stable when two entries share a timestamp).
 */
export async function getClientDetail(env, id, { limit = 50, offset = 0 } = {}) {
  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first();
  if (!customer) return { status: "not_found", error: "Client not found" };

  const [projects, entries, totals] = await Promise.all([
    env.DB.prepare("SELECT * FROM projects WHERE customer_id = ? ORDER BY name ASC").bind(id).all(),
    env.DB.prepare(`
      SELECT te.*, c.name AS customer_name, p.name AS project_name, a.name AS activity_name
      FROM time_entries te
      LEFT JOIN customers c ON te.customer_id = c.id
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN activities a ON te.activity_id = a.id
      WHERE te.customer_id = ?
      ORDER BY te.start_time DESC, te.id DESC
      LIMIT ? OFFSET ?
    `).bind(id, maxLimit, safeOffset).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS entry_count,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost
      FROM time_entries te
      WHERE te.customer_id = ? AND te.is_running = 0
    `).bind(id).first(),
  ]);

  return {
    status: "ok",
    customer,
    projects: projects.results || [],
    entries: entries.results || [],
    totals: {
      entry_count: totals?.entry_count || 0,
      total_seconds: Math.round(totals?.total_seconds || 0),
      total_cost: Number((totals?.total_cost || 0).toFixed(2)),
    },
    paging: { limit: maxLimit, offset: safeOffset, returned: (entries.results || []).length },
  };
}

/** Shared shaping for the per-entity breakdown rows (same fields as the dashboard). */
function shapeBreakdown(results) {
  return (results || []).map((row) => ({
    ...(row.currency ? { currency: row.currency } : {}),
    ...row,
    total_seconds: Math.round(row.total_seconds || 0),
    total_hours: Number(((row.total_seconds || 0) / 3600).toFixed(2)),
    total_cost: Number((row.total_cost || 0).toFixed(2)),
    entry_count: Number(row.entry_count || 0),
  }));
}

/**
 * Everything the /projects/:id page needs in one round trip: the project with its
 * client context (name, currency, fallback rate), an activity breakdown of where the
 * project's time went, and its closed time history (most recent first, id-ordered so
 * limit/offset pages stay stable).
 */
export async function getProjectDetail(env, id, { limit = 50, offset = 0 } = {}) {
  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const project = await env.DB.prepare(`
    SELECT p.*, c.name AS customer_name, c.currency AS customer_currency, c.hourly_rate AS customer_rate,
           COALESCE(p.currency, c.currency) AS currency
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.id = ?
  `).bind(id).first();
  if (!project) return { status: "not_found", error: "Project not found" };

  const [entries, totals, byActivity, tasks] = await Promise.all([
    env.DB.prepare(`
      SELECT te.*, c.name AS customer_name, c.currency AS currency, a.name AS activity_name
      FROM time_entries te
      LEFT JOIN customers c ON te.customer_id = c.id
      LEFT JOIN activities a ON te.activity_id = a.id
      WHERE te.project_id = ?
      ORDER BY te.start_time DESC, te.id DESC
      LIMIT ? OFFSET ?
    `).bind(id, maxLimit, safeOffset).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS entry_count,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost
      FROM time_entries te
      WHERE te.project_id = ? AND te.is_running = 0
    `).bind(id).first(),
    env.DB.prepare(`
      SELECT a.id AS activity_id, a.name AS name, a.emoji, a.image_url,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost,
             COUNT(*) AS entry_count
      FROM time_entries te
      LEFT JOIN activities a ON a.id = te.activity_id
      WHERE te.project_id = ? AND te.is_running = 0
      GROUP BY te.activity_id
      ORDER BY total_seconds DESC
    `).bind(id).all(),
    listProjectTasks(env, id),
  ]);

  return {
    status: "ok",
    project,
    entries: entries.results || [],
    totals: {
      entry_count: totals?.entry_count || 0,
      total_seconds: Math.round(totals?.total_seconds || 0),
      total_cost: Number((totals?.total_cost || 0).toFixed(2)),
    },
    by_activity: shapeBreakdown(byActivity.results),
    tasks,
    paging: { limit: maxLimit, offset: safeOffset, returned: (entries.results || []).length },
  };
}

/**
 * Everything the /activities/:id page needs: the activity, a client breakdown of who
 * its time bills (each client in their own currency), and the cross-client time
 * history for this activity, paginated the same way as the client and project pages.
 */
export async function getActivityDetail(env, id, { limit = 50, offset = 0 } = {}) {
  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const activity = await env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first();
  if (!activity) return { status: "not_found", error: "Activity not found" };

  const [entries, totals, byClient] = await Promise.all([
    env.DB.prepare(`
      SELECT te.*, c.name AS customer_name, c.currency AS currency, p.name AS project_name
      FROM time_entries te
      LEFT JOIN customers c ON te.customer_id = c.id
      LEFT JOIN projects p ON te.project_id = p.id
      WHERE te.activity_id = ?
      ORDER BY te.start_time DESC, te.id DESC
      LIMIT ? OFFSET ?
    `).bind(id, maxLimit, safeOffset).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS entry_count,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost
      FROM time_entries te
      WHERE te.activity_id = ? AND te.is_running = 0
    `).bind(id).first(),
    env.DB.prepare(`
      SELECT c.id AS customer_id, c.name AS name, c.image_url, MIN(c.currency) AS currency,
             SUM(te.duration_seconds) AS total_seconds,
             SUM(te.cost) AS total_cost,
             COUNT(*) AS entry_count
      FROM time_entries te
      LEFT JOIN customers c ON te.customer_id = c.id
      WHERE te.activity_id = ? AND te.is_running = 0
      GROUP BY te.customer_id
      ORDER BY total_seconds DESC
    `).bind(id).all(),
  ]);

  return {
    status: "ok",
    activity,
    entries: entries.results || [],
    totals: {
      entry_count: totals?.entry_count || 0,
      total_seconds: Math.round(totals?.total_seconds || 0),
      total_cost: Number((totals?.total_cost || 0).toFixed(2)),
    },
    by_client: shapeBreakdown(byClient.results),
    paging: { limit: maxLimit, offset: safeOffset, returned: (entries.results || []).length },
  };
}

export async function setArchived(env, type, id, archived) {
  const table = ARCHIVE_TABLES[type];
  if (!table) return { status: "invalid", error: "Unknown archive type" };

  const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!existing) return { status: "not_found", error: `${type.slice(0, -1)} not found` };

  await env.DB.prepare(`UPDATE ${table} SET archived_at = ${archived ? "CURRENT_TIMESTAMP" : "NULL"} WHERE id = ?`)
    .bind(id)
    .run();

  return {
    status: "ok",
    record: await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first(),
  };
}

// ---------------------------------------------------------------------------
// Time-entry editing. Closed entries are fully editable; duration and cost are
// derived from the edited times and rate so historical rows remain consistent.
// ---------------------------------------------------------------------------

const ENTRY_FIELDS = new Set([
  "customerId",
  "projectId",
  "activityId",
  "description",
  "tags",
  "startTime",
  "endTime",
  "hourlyRate",
]);

function asTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

/** Update a closed entry. Times are epoch milliseconds; duration is never hand-edited. */
/**
 * Find a non-archived shared activity by name (case-insensitive), creating it when
 * missing. Used by project default-task seeding so "General"/"Meeting" are single
 * shared rows reused by every project (activities.name is UNIQUE).
 */
async function findOrCreateActivity(env, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;  const existing = await env.DB.prepare("SELECT * FROM activities WHERE lower(name) = lower(?)")
    .bind(trimmed).first();
  if (existing) {
    if (existing.archived_at) {
      await env.DB.prepare("UPDATE activities SET archived_at = NULL WHERE id = ?").bind(existing.id).run();
    }
    return { ...existing, archived_at: null };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO activities (id, name) VALUES (?, ?)").bind(id, trimmed).run();
  return env.DB.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first();
}

/** The task list of one project: linked activities with their default flag. */
export async function listProjectTasks(env, projectId) {
  const { results } = await env.DB.prepare(`
    SELECT pt.id, pt.project_id, pt.activity_id, pt.is_default, pt.created_at,
           a.name, a.emoji, a.image_url, a.archived_at
    FROM project_tasks pt
    JOIN activities a ON a.id = pt.activity_id
    WHERE pt.project_id = ?
    ORDER BY pt.is_default DESC, a.name ASC
  `).bind(projectId).all();
  return results || [];
}

/**
 * Link a task to a project. `name` finds-or-creates a shared activity;
 * `activityId` links an existing one. Duplicate links surface as conflict.
 */
export async function addProjectTask(env, projectId, { name, activityId, isDefault = false } = {}) {
  const project = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
  if (!project) return { status: "not_found", error: "Project not found" };

  let activity;
  if (activityId !== undefined && activityId !== null && activityId !== "") {
    activity = await env.DB.prepare("SELECT * FROM activities WHERE id = ? AND archived_at IS NULL").bind(activityId).first();
    if (!activity) return { status: "invalid", error: "Unknown activityId" };
  } else {
    if (isBlank(name)) return { status: "invalid", error: "name is required" };
    activity = await findOrCreateActivity(env, name);
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO project_tasks (id, project_id, activity_id, is_default) VALUES (?, ?, ?, ?)"
    ).bind(id, projectId, activity.id, isDefault ? 1 : 0).run();
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) {
      return { status: "conflict", error: `Task "${activity.name}" is already on this project` };
    }
    throw err;
  }
  return { status: "ok", task: (await listProjectTasks(env, projectId)).find((task) => task.id === id) };
}

/** Unlink a task from a project; the shared activity itself is untouched. */
export async function removeProjectTask(env, projectId, taskId) {
  const { meta } = await env.DB.prepare("DELETE FROM project_tasks WHERE id = ? AND project_id = ?")
    .bind(taskId, projectId)
    .run();
  if (!meta?.changes) return { status: "not_found", error: "Task link not found" };
  return { status: "ok" };
}

/**
 * Paginated time history in a half-open [fromMs, toMs) range (both optional).
 * Closed and running entries, newest first, id-ordered for stable pages.
 */
export async function listEntries(env, { fromMs, toMs, limit = 50, offset = 0 } = {}) {
  const maxLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  let start = null;
  let end = null;
  if (fromMs !== undefined || toMs !== undefined) {
    if (!Number.isFinite(Number(fromMs)) || !Number.isFinite(Number(toMs))) {
      return { status: "invalid", error: "fromMs and toMs must both be numbers" };
    }
    start = Number(fromMs);
    end = Number(toMs);
    if (start > end) return { status: "invalid", error: "fromMs must be <= toMs" };
  }

  const filters = [];
  const bind = [];
  if (start !== null) {
    filters.push("te.start_time >= ?", "te.start_time < ?");
    bind.push(start, end);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const [entries, count] = await Promise.all([
    env.DB.prepare(`
      SELECT te.*, c.name AS customer_name, c.currency, p.name AS project_name, a.name AS activity_name
      FROM time_entries te
      LEFT JOIN customers c ON te.customer_id = c.id
      LEFT JOIN projects p ON te.project_id = p.id
      LEFT JOIN activities a ON te.activity_id = a.id
      ${where}
      ORDER BY te.start_time DESC, te.id DESC
      LIMIT ? OFFSET ?
    `).bind(...bind, maxLimit, safeOffset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM time_entries te ${where}`).bind(...bind).first(),
  ]);

  return {
    status: "ok",
    entries: entries.results || [],
    paging: { limit: maxLimit, offset: safeOffset, returned: (entries.results || []).length, total: count?.total || 0 },
  };
}

/**
 * Ask Gemini to turn a short recording into a reviewable timer draft.
 * The API key stays in the Worker environment; audio/transcript are not persisted.
 */
export async function resetDemoData(env) {
  await env.DB.prepare("DELETE FROM time_entries").run();
  // Re-seed with the standard demo data
  const customers = [
    { id: "c1111111-1111-4111-8111-111111111111", name: "Acme Corp", currency: "USD", hourly_rate: 120.0 },
    { id: "c2222222-2222-4222-8222-222222222222", name: "Beta LLC", currency: "USD", hourly_rate: 90.0 },
  ];
  const projects = [
    { id: "p1111111-1111-4111-8111-111111111111", customer_id: "c1111111-1111-4111-8111-111111111111", name: "Website Redesign", budget_type: "hourly", rate: 130.0 },
    { id: "p2222222-2222-4222-8222-222222222222", customer_id: "c1111111-1111-4111-8111-111111111111", name: "Mobile App", budget_type: "fixed", rate: 0.0 },
    { id: "p3333333-3333-4333-8333-333333333333", customer_id: "c2222222-2222-4222-8222-222222222222", name: "API Integration", budget_type: "hourly", rate: 95.0 },
  ];
  const activities = [
    { id: "a1111111-1111-4111-8111-111111111111", name: "Development" },
    { id: "a2222222-2222-4222-8222-222222222222", name: "Meeting" },
    { id: "a3333333-3333-4333-8333-333333333333", name: "Design" },
    { id: "a4444444-4444-4444-8444-444444444444", name: "Testing" },
  ];
  const entries = [
    { id: "e1111111-1111-4111-8111-111111111111", customer_id: "c1111111-1111-4111-8111-111111111111", project_id: "p1111111-1111-4111-8111-111111111111", activity_id: "a1111111-1111-4111-8111-111111111111", description: "Landing page build", tags: "frontend,react", start_time: 1752643200000, end_time: 1752646800000, duration_seconds: 3600, rate_applied: 130.0, cost: 130.0 },
    { id: "e2222222-2222-4222-8222-222222222222", customer_id: "c1111111-1111-4111-8111-111111111111", project_id: "p1111111-1111-4111-8111-111111111111", activity_id: "a3333333-3333-4333-8333-333333333333", description: "Mockup review", tags: "design", start_time: 1752729600000, end_time: 1752735000000, duration_seconds: 5400, rate_applied: 130.0, cost: 195.0 },
    { id: "e3333333-3333-4333-8333-333333333333", customer_id: "c1111111-1111-4111-8111-111111111111", project_id: "p2222222-2222-4222-8222-222222222222", activity_id: "a2222222-2222-4222-8222-222222222222", description: "Sprint planning", tags: "meeting", start_time: 1755318000000, end_time: 1755321600000, duration_seconds: 3600, rate_applied: 0.0, cost: 0.0 },
    { id: "e4444444-4444-4444-8444-444444444444", customer_id: "c2222222-2222-4222-8222-222222222222", project_id: "p3333333-3333-4333-8333-333333333333", activity_id: "a1111111-1111-4111-8111-111111111111", description: "Webhook endpoint", tags: "backend", start_time: 1755404400000, end_time: 1755411600000, duration_seconds: 7200, rate_applied: 95.0, cost: 190.0 },
    { id: "e5555555-5555-4555-8555-555555555555", customer_id: "c2222222-2222-4222-8222-222222222222", project_id: "p3333333-3333-4333-8333-333333333333", activity_id: "a4444444-4444-4444-8444-444444444444", description: "Regression pass", tags: "qa", start_time: 1755490800000, end_time: 1755494400000, duration_seconds: 3600, rate_applied: 95.0, cost: 95.0 },
  ];

  // Ensure customers, projects, activities exist (upsert-style: ignore on conflict),
  // then resolve the ids actually stored — a name may already exist under a different
  // id (activities.name is UNIQUE; default "General"/"Meeting" rows pre-date the demo
  // seed), so entries must reference the resolved ids, not the literal demo ones.
  const cid = {};
  for (const c of customers) {
    await env.DB.prepare("INSERT OR IGNORE INTO customers (id, name, currency, hourly_rate) VALUES (?, ?, ?, ?)").bind(c.id, c.name, c.currency, c.hourly_rate).run();
    cid[c.id] = (await env.DB.prepare("SELECT id FROM customers WHERE id = ? OR name = ?").bind(c.id, c.name).first()).id;
  }
  const pid = {};
  for (const p of projects) {
    await env.DB.prepare("INSERT OR IGNORE INTO projects (id, customer_id, name, budget_type, rate) VALUES (?, ?, ?, ?, ?)").bind(p.id, cid[p.customer_id], p.name, p.budget_type, p.rate).run();
    pid[p.id] = (await env.DB.prepare("SELECT id FROM projects WHERE id = ? OR (customer_id = ? AND name = ?)").bind(p.id, cid[p.customer_id], p.name).first()).id;
  }
  const aid = {};
  for (const a of activities) {
    await env.DB.prepare("INSERT OR IGNORE INTO activities (id, name) VALUES (?, ?)").bind(a.id, a.name).run();
    aid[a.id] = (await env.DB.prepare("SELECT id FROM activities WHERE id = ? OR lower(name) = lower(?)").bind(a.id, a.name).first()).id;
  }
  for (const e of entries) {
    await env.DB.prepare(
      "INSERT INTO time_entries (id, customer_id, project_id, activity_id, description, tags, start_time, end_time, duration_seconds, rate_applied, cost, is_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
    ).bind(e.id, cid[e.customer_id], pid[e.project_id], aid[e.activity_id], e.description, e.tags, e.start_time, e.end_time, e.duration_seconds, e.rate_applied, e.cost).run();
  }
  return { status: "ok" };
}

export async function parseVoiceTask(env, { audioBase64, mimeType = "audio/webm" } = {}) {
  if (!env.GEMINI_API_KEY) return { status: "unavailable", error: "Voice capture is not configured. Add GEMINI_API_KEY to the Worker secrets." };
  if (typeof audioBase64 !== "string" || audioBase64.length < 100) return { status: "invalid", error: "audioBase64 is required" };
  if (audioBase64.length > 12_000_000) return { status: "invalid", error: "Audio must be 9 MB or smaller" };
  if (!/^audio\/[a-z0-9.+-]+$/i.test(mimeType)) return { status: "invalid", error: "mimeType must be an audio MIME type" };

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const prompt = [
    "Convert this time-tracking voice note into JSON only.",
    "Do not invent IDs, clients, projects, or activities.",
    "Return exactly these keys: description (string), tags (array of strings), client (string), project (string), activity (string), hourlyRate (number or null).",
    "Use empty strings when a name is not spoken. Keep description concise. Tags should be lowercase and contain at most 8 items.",
  ].join(" ");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: audioBase64 } }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              description: { type: "STRING" },
              tags: { type: "ARRAY", items: { type: "STRING" } },
              client: { type: "STRING" },
              project: { type: "STRING" },
              activity: { type: "STRING" },
              hourlyRate: { type: "NUMBER", nullable: true },
            },
            required: ["description", "tags", "client", "project", "activity", "hourlyRate"],
          },
        },
      }),
    });
  } catch (error) {
    return { status: "upstream_error", error: `Gemini request failed: ${error.message}` };
  }

  const raw = await response.text();
  if (!response.ok) return { status: "upstream_error", error: `Gemini returned ${response.status}`, excerpt: raw.slice(0, 300) };
  let payload;
  try { payload = JSON.parse(raw); } catch { return { status: "upstream_error", error: "Gemini returned invalid JSON" }; }
  const text = payload?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) return { status: "upstream_error", error: "Gemini returned no task draft" };

  let draft;
  try { draft = JSON.parse(text); } catch { return { status: "upstream_error", error: "Gemini returned a non-JSON task draft" }; }
  const tags = Array.isArray(draft.tags) ? draft.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
  const hourlyRate = draft.hourlyRate === null || draft.hourlyRate === undefined || draft.hourlyRate === "" ? null : Number(draft.hourlyRate);
  if (hourlyRate !== null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) return { status: "upstream_error", error: "Gemini returned an invalid hourly rate" };
  return {
    status: "ok",
    draft: {
      description: String(draft.description || "").slice(0, 500),
      tags,
      client: String(draft.client || "").slice(0, 200),
      project: String(draft.project || "").slice(0, 200),
      activity: String(draft.activity || "").slice(0, 200),
      hourlyRate,
    },
  };
}

/**
 * Create a closed entry directly — imports only (CSV/Kimai), never the timer path.
 * Times are epoch milliseconds; duration and cost are derived, never trusted from input.
 */
export async function createTimeEntry(env, body = {}) {
  const customerId = body.customerId;
  const projectId = body.projectId;
  const activityId = body.activityId;
  if (isBlank(customerId) || isBlank(projectId) || isBlank(activityId)) {
    return { status: "invalid", error: "customerId, projectId and activityId are required" };
  }

  const missing = await validateRefs(env, customerId, projectId, activityId);
  if (missing.length) return { status: "invalid", error: `Unknown ids: ${missing.join(", ")}` };
  if (!(await validateTaskForProject(env, projectId, activityId))) {
    return { status: "invalid", error: "activityId is not enabled as a task for this project" };
  }

  const project = await env.DB.prepare("SELECT customer_id FROM projects WHERE id = ?").bind(projectId).first();
  if (project.customer_id !== customerId) {
    return { status: "invalid", error: "projectId does not belong to customerId" };
  }

  const startTime = asTimestamp(body.startTime);
  const endTime = asTimestamp(body.endTime);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return { status: "invalid", error: "startTime and endTime must be timestamps in milliseconds" };
  }
  if (endTime <= startTime) return { status: "invalid", error: "endTime must be after startTime" };

  let applied;
  if (body.hourlyRate === undefined) {
    applied = await resolveRate(env, projectId, customerId, null);
  } else {
    const rate = asRate(body.hourlyRate);
    const rateError = badRate(rate);
    if (rateError) return { status: "invalid", error: `hourlyRate ${rateError}` };
    applied = rate;
  }

  const durationSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));
  const cost = (durationSeconds / 3600) * (applied || 0);
  const id = crypto.randomUUID();
  const description = String(body.description ?? "");
  const tags = String(body.tags ?? "");

  await env.DB.prepare(`
    INSERT INTO time_entries
      (id, customer_id, project_id, activity_id, description, tags, start_time, end_time, duration_seconds, rate_applied, cost, is_running)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(id, customerId, projectId, activityId, description, tags, startTime, endTime, durationSeconds, applied, cost).run();

  const entry = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  return { status: "ok", entry };
}

export async function updateTimeEntry(env, id, patch = {}) {
  const unknown = Object.keys(patch).filter((key) => !ENTRY_FIELDS.has(key));
  if (unknown.length) return { status: "invalid", error: `Unknown fields: ${unknown.join(", ")}` };

  const current = await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first();
  if (!current) return { status: "not_found", error: "Time entry not found" };
  if (current.is_running) return { status: "conflict", error: "Stop the timer before editing this entry" };
  if (!Object.keys(patch).length) return { status: "invalid", error: "No updatable fields provided" };

  const customerId = patch.customerId ?? current.customer_id;
  const projectId = patch.projectId ?? current.project_id;
  const activityId = patch.activityId ?? current.activity_id;
  if (isBlank(customerId) || isBlank(projectId) || isBlank(activityId)) {
    return { status: "invalid", error: "customerId, projectId and activityId are required" };
  }

  const refsChanged = patch.customerId !== undefined || patch.projectId !== undefined || patch.activityId !== undefined;
  const missing = refsChanged
    ? await validateRefs(env, customerId, projectId, activityId)
    : await (async () => {
        const [customer, projectRef, activity] = await Promise.all([
          env.DB.prepare("SELECT 1 FROM customers WHERE id = ?").bind(customerId).first(),
          env.DB.prepare("SELECT 1 FROM projects WHERE id = ?").bind(projectId).first(),
          env.DB.prepare("SELECT 1 FROM activities WHERE id = ?").bind(activityId).first(),
        ]);
        return [!customer && "customerId", !projectRef && "projectId", !activity && "activityId"].filter(Boolean);
      })();
  if (missing.length) return { status: "invalid", error: `Unknown ids: ${missing.join(", ")}` };
  if (refsChanged && !(await validateTaskForProject(env, projectId, activityId))) {
    return { status: "invalid", error: "activityId is not enabled as a task for this project" };
  }

  const project = await env.DB.prepare("SELECT customer_id FROM projects WHERE id = ?").bind(projectId).first();
  if (project.customer_id !== customerId) {
    return { status: "invalid", error: "projectId does not belong to customerId" };
  }

  const startTime = asTimestamp(patch.startTime ?? current.start_time);
  const endTime = asTimestamp(patch.endTime ?? current.end_time);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return { status: "invalid", error: "startTime and endTime must be timestamps in milliseconds" };
  }
  if (endTime <= startTime) return { status: "invalid", error: "endTime must be after startTime" };

  const rate = patch.hourlyRate === undefined ? Number(current.rate_applied || 0) : asRate(patch.hourlyRate);
  const rateError = badRate(rate);
  if (rateError) return { status: "invalid", error: `hourlyRate ${rateError}` };

  const durationSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));
  const cost = (durationSeconds / 3600) * rate;
  const description = patch.description === undefined ? current.description || "" : String(patch.description ?? "");
  const tags = patch.tags === undefined ? current.tags || "" : String(patch.tags ?? "");

  await env.DB.prepare(`
    UPDATE time_entries
    SET customer_id = ?, project_id = ?, activity_id = ?, description = ?, tags = ?,
        start_time = ?, end_time = ?, duration_seconds = ?, rate_applied = ?, cost = ?
    WHERE id = ? AND is_running = 0
  `)
    .bind(customerId, projectId, activityId, description, tags, startTime, endTime, durationSeconds, rate, cost, id)
    .run();

  return {
    status: "ok",
    entry: await env.DB.prepare("SELECT * FROM time_entries WHERE id = ?").bind(id).first(),
  };
}

/* ------------------------------------------------------------------ imports */

const IMPORT_MAX_ENTRIES = 1000;

/**
 * Batched CSV import (Kimai export format is canonical — see
 * docs/2026-09-20-csv-import-plan.md). One request carries the masters plus up
 * to IMPORT_MAX_ENTRIES rows, each entry referencing masters by NAME. The
 * server match-or-creates the masters, dedupes rows against existing entries
 * on (projectId, activityId, startTime), derives duration/cost server-side,
 * and inserts every valid row in one D1 batch (atomic). Nothing is updated or
 * deleted — import only adds.
 *
 * payload: { dryRun, customers: [{name, currency?, hourlyRate?}],
 *            projects: [{customer, name}], activities: [name],
 *            entries: [{customer, project, activity, startTime, endTime,
 *                       description?, tags?, hourlyRate?}] }
 * Returns { status, created, imported, skipped, dryRun } (or "invalid").
 */
export async function importCsvBatch(env, payload = {}) {
  const dryRun = Boolean(payload.dryRun);
  const customersIn = Array.isArray(payload.customers) ? payload.customers : [];
  const projectsIn = Array.isArray(payload.projects) ? payload.projects : [];
  const activitiesIn = Array.isArray(payload.activities) ? payload.activities : [];
  const entriesIn = Array.isArray(payload.entries) ? payload.entries : [];
  if (!entriesIn.length) return { status: "invalid", error: "entries[] is required" };
  if (entriesIn.length > IMPORT_MAX_ENTRIES) {
    return { status: "invalid", error: `entries[] is limited to ${IMPORT_MAX_ENTRIES} rows per request` };
  }

  // Masters — match by exact trimmed name, create when missing.
  const customerId = new Map();
  const created = { customers: 0, projects: 0, activities: 0 };
  const skips = [];
  for (const c of customersIn) {
    const name = String(c?.name ?? "").trim();
    if (!name) return { status: "invalid", error: "every customers[] row needs a name" };
    const hit = await env.DB.prepare("SELECT id FROM customers WHERE name = ?").bind(name).first();
    if (hit) { customerId.set(name, hit.id); continue; }
    if (dryRun) continue;
    const result = await createCustomer(env, { name, currency: c.currency, hourlyRate: c.hourlyRate });
    if (result.status !== "ok") return { status: "invalid", error: `customer "${name}": ${result.error}` };
    customerId.set(name, result.customer.id);
    created.customers++;
  }

  const projectId = new Map();
  for (const p of projectsIn) {
    const name = String(p?.name ?? "").trim();
    const customerName = String(p?.customer ?? "").trim();
    if (!name || !customerName) return { status: "invalid", error: "every projects[] row needs name and customer" };
    const key = `${customerName}\u0000${name}`;
    const hit = await env.DB.prepare(
      "SELECT p.id FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.name = ? AND c.name = ?"
    ).bind(name, customerName).first();
    if (hit) { projectId.set(key, hit.id); continue; }
    if (dryRun) continue;
    const result = await createProject(env, { customerId: customerId.get(customerName), name, budgetType: "hourly", rate: 0 });
    if (result.status !== "ok") return { status: "invalid", error: `project "${name}": ${result.error}` };
    projectId.set(key, result.project.id);
    created.projects++;
  }

  for (const rawName of activitiesIn) {
    const name = String(rawName ?? "").trim();
    if (!name) return { status: "invalid", error: "activities[] rows must be names" };
    const hit = await env.DB.prepare("SELECT id FROM activities WHERE name = ?").bind(name).first();
    if (hit) continue;
    if (dryRun) continue;
    const result = await createActivity(env, { name });
    if (result.status !== "ok") return { status: "invalid", error: `activity "${name}": ${result.error}` };
    created.activities++;
  }

  // Existing-entry dedupe keys: (project, activity, start).
  const existing = new Set();
  if (!dryRun) {
    const { results } = await env.DB.prepare("SELECT project_id, activity_id, start_time FROM time_entries").all();
    for (const row of results) existing.add(`${row.project_id}|${row.activity_id}|${row.start_time}`);
  }

  // Validate every row first; only clean rows reach the batch.
  const inserts = [];
  for (let i = 0; i < entriesIn.length; i++) {
    const row = entriesIn[i];
    const fail = (reason) => skips.push({ row: i, reason });
    const rowCustomer = String(row?.customer ?? "").trim();
    const rowProject = String(row?.project ?? "").trim();
    // Dry run never creates masters, so the id maps are empty — validate the
    // name references without resolving them.
    const customerIdValue = dryRun ? rowCustomer : customerId.get(rowCustomer);
    const projectIdValue = dryRun ? `${rowCustomer}\u0000${rowProject}` : projectId.get(`${rowCustomer}\u0000${rowProject}`);
    const activityIdValue = dryRun
      ? String(row?.activity ?? "").trim()
      : (await env.DB.prepare("SELECT id FROM activities WHERE name = ?").bind(String(row?.activity ?? "").trim()).first())?.id;
    if (!customerIdValue || !projectIdValue || !activityIdValue) { fail("unknown customer/project/activity"); continue; }

    const startTime = asTimestamp(row.startTime);
    const endTime = asTimestamp(row.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) { fail("startTime/endTime must be epoch ms"); continue; }
    if (endTime <= startTime) { fail("endTime must be after startTime"); continue; }

    const rate = asRate(row.hourlyRate);
    const rateError = badRate(rate);
    if (rateError) { fail(rateError); continue; }

    const key = `${projectIdValue}|${activityIdValue}|${startTime}`;
    if (existing.has(key)) { fail("already imported"); continue; }
    existing.add(key);

    const durationSeconds = Math.max(1, Math.round((endTime - startTime) / 1000));
    const cost = (durationSeconds / 3600) * (rate || 0);
    inserts.push(
      env.DB.prepare(
        "INSERT INTO time_entries (id, customer_id, project_id, activity_id, description, tags, start_time, end_time, duration_seconds, rate_applied, cost, is_running) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
      ).bind(
        crypto.randomUUID(), customerIdValue, projectIdValue, activityIdValue,
        String(row.description ?? ""), String(row.tags ?? ""),
        startTime, endTime, durationSeconds, rate, cost
      )
    );
  }

  if (!dryRun && inserts.length) await env.DB.batch(inserts);

  return {
    status: "ok",
    dryRun,
    created: dryRun ? { customers: 0, projects: 0, activities: 0 } : created,
    imported: inserts.length,
    skipped: skips,
    received: entriesIn.length,
  };
}
