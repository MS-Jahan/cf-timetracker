// cf-timetracker Worker - REST API (spec §2, tasks T-W1..T-W4) + MCP (POST /mcp, T-M1..T-M4).
// CORS is env-driven via ALLOWED_ORIGINS (comma-separated). "*" allowed only in dev.
// Timer operations live in ./core.js so REST and MCP share one implementation.

import {
  addProjectTask,
  createActivity,
  createCustomer,
  createProject,
  getActiveTimer,
  getClientDetail,
  getProjectDetail,
  getActivityDetail,
  isValidMonth,
  listEntries,
  listProjectTasks,
  monthRange,
  parseVoiceTask,
  querySummary,
  queryDashboard,
  removeProjectTask,
  resetDemoData,
  startTimer,
  stopTimer,
  updateActivity,
  updateCustomer,
  updateProject,
  createTimeEntry,
  deleteTimeEntry,
  importCsvBatch,
  updateTimeEntry,
  setArchived,
} from "./core.js";
import { handleMcp } from "./mcp.js";

const JSON_HEADERS_BASE = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion, X-App-Token",
  "Vary": "Origin",
};

/** Maps a core.js result status onto an HTTP status code. */
const STATUS_CODES = { invalid: 400, conflict: 409, not_found: 404 };

/** Matches /api/<collection>/<id> and /api/<collection>. */
function matchCollection(pathname, collection) {
  const m = pathname.match(new RegExp(`^/api/${collection}(?:/([^/]+))?$`));
  return m ? { id: m[1] ? decodeURIComponent(m[1]) : null } : null;
}

function corsOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  if (allowed.includes("*")) return origin || "*";
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] || "";
}

function jsonResponse(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...JSON_HEADERS_BASE, "Access-Control-Allow-Origin": corsOrigin(request, env) },
  });
}

function handleCors(request, env) {
  return new Response(null, {
    status: 204,
    headers: { ...JSON_HEADERS_BASE, "Access-Control-Allow-Origin": corsOrigin(request, env) },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return handleCors(request, env);

    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // MCP endpoint: JSON-RPC responses are not CORS-wrapped (server-to-server / MCP clients).
    if (method === "POST" && pathname === "/mcp") {
      return handleMcp(request, env);
    }

    try {
      // App-token gate for native clients. When APP_TOKEN is configured, API requests
      // must carry `X-App-Token` unless they already passed Cloudflare Access (the
      // browser path). /mcp above is untouched; CORS advertises the header.
      if (env.APP_TOKEN && pathname.startsWith("/api/")) {
        const appToken = request.headers.get("X-App-Token");
        const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
        if (!accessEmail && appToken !== env.APP_TOKEN) {
          return jsonResponse(request, env, { error: "Unauthorized: missing or invalid X-App-Token" }, 401);
        }
      }

      // 1. Single-trip bootstrap
      if (method === "GET" && pathname === "/api/bootstrap") {
        const [activeTimer, recentEntries, customers, projects, activities, projectTasks, archivedCustomers, archivedProjects, archivedActivities] = await Promise.all([
          getActiveTimer(env),
          env.DB.prepare(`
            SELECT te.*, c.name AS customer_name, c.currency, p.name AS project_name, a.name AS activity_name
            FROM time_entries te
            LEFT JOIN customers c ON te.customer_id = c.id
            LEFT JOIN projects p ON te.project_id = p.id
            LEFT JOIN activities a ON te.activity_id = a.id
            ORDER BY te.start_time DESC LIMIT 50
          `).all(),
          env.DB.prepare("SELECT * FROM customers WHERE archived_at IS NULL ORDER BY name ASC").all(),
          env.DB.prepare(`
            SELECT p.* FROM projects p
            JOIN customers c ON c.id = p.customer_id
            WHERE p.archived_at IS NULL AND c.archived_at IS NULL
            ORDER BY p.name ASC
          `).all(),
          env.DB.prepare("SELECT * FROM activities WHERE archived_at IS NULL ORDER BY name ASC").all(),
          env.DB.prepare(`
            SELECT pt.id, pt.project_id, pt.activity_id, pt.is_default,
                   a.name, a.emoji, a.image_url, a.archived_at
            FROM project_tasks pt
            JOIN activities a ON a.id = pt.activity_id
            ORDER BY pt.project_id, pt.is_default DESC, a.name ASC
          `).all(),
          env.DB.prepare("SELECT * FROM customers WHERE archived_at IS NOT NULL ORDER BY name ASC").all(),
          env.DB.prepare(`
            SELECT p.*, c.name AS customer_name, c.archived_at AS customer_archived_at
            FROM projects p
            LEFT JOIN customers c ON c.id = p.customer_id
            WHERE p.archived_at IS NOT NULL OR c.archived_at IS NOT NULL
            ORDER BY p.name ASC
          `).all(),
          env.DB.prepare("SELECT * FROM activities WHERE archived_at IS NOT NULL ORDER BY name ASC").all(),
        ]);
        return jsonResponse(request, env, {
          activeTimer: activeTimer || null,
          entries: recentEntries.results || [],
          customers: customers.results || [],
          projects: projects.results || [],
          activities: activities.results || [],
          projectTasks: projectTasks.results || [],
          archivedCustomers: archivedCustomers.results || [],
          archivedProjects: archivedProjects.results || [],
          archivedActivities: archivedActivities.results || [],
        });
      }

      // 2. Start timer - 409 when a timer is already running (whether the pre-check or
      // the unique-index violation caught it), 400 for validation problems.
      if (method === "POST" && pathname === "/api/timer/start") {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await startTimer(env, body);
        if (result.status !== "ok") {
          return jsonResponse(
            request,
            env,
            { error: result.error, ...(result.code ? { code: result.code } : {}) },
            STATUS_CODES[result.status] || 400
          );
        }
        return jsonResponse(request, env, { success: true, timer: result.timer });
      }

      // 3. Stop timer
      if (method === "POST" && pathname === "/api/timer/stop") {
        const result = await stopTimer(env);
        if (result.status !== "ok") {
          return jsonResponse(
            request,
            env,
            { error: result.error, ...(result.code ? { code: result.code } : {}) },
            STATUS_CODES[result.status] || 400
          );
        }
        return jsonResponse(request, env, { success: true, timer: result.timer });
      }

      // 4. Sync to Google Sheets via GAS webhook
      if (method === "POST" && pathname === "/api/sync/google-sheets") {
        const body = await readJson(request);
        if (!body?.gasWebhookUrl) {
          return jsonResponse(request, env, { error: "Google Apps Script Web App URL is required" }, 400);
        }
        const { gasWebhookUrl, filterMonth } = body;

        let where = "te.is_running = 0";
        const bind = [];
        if (filterMonth !== undefined) {
          if (!isValidMonth(filterMonth)) {
            return jsonResponse(request, env, { error: "filterMonth must be YYYY-MM" }, 400);
          }
          const { startMs, endMs } = monthRange(filterMonth);
          where += " AND te.start_time >= ? AND te.start_time < ?";
          bind.push(startMs, endMs);
        }

        const entries = await env.DB.prepare(`
          SELECT te.id, date(te.start_time / 1000, 'unixepoch') AS log_date,
                 te.start_time, te.end_time, te.duration_seconds,
                 c.name AS customer, p.name AS project, a.name AS activity,
                 te.description, te.tags, te.cost
          FROM time_entries te
          LEFT JOIN customers c ON te.customer_id = c.id
          LEFT JOIN projects p ON te.project_id = p.id
          LEFT JOIN activities a ON te.activity_id = a.id
          WHERE ${where}
          ORDER BY te.start_time DESC
        `).bind(...bind).all();

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let gasResponse;
        try {
          gasResponse = await fetch(gasWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Gas-Secret": env.GAS_SECRET || "",
            },
            body: JSON.stringify({ entries: entries.results, secret: env.GAS_SECRET || "" }),
            signal: controller.signal,
          });
        } catch (e) {
          return jsonResponse(request, env, { success: false, error: `GAS fetch failed: ${e.message}` }, 502);
        } finally {
          clearTimeout(timeout);
        }

        if (!gasResponse.ok) {
          const excerpt = (await gasResponse.text()).slice(0, 500);
          return jsonResponse(request, env, { success: false, error: `GAS returned ${gasResponse.status}`, excerpt }, 502);
        }

        const gasResult = await gasResponse.json().catch(() => ({}));
        return jsonResponse(request, env, { success: true, gasResult });
      }

      // 4b. Voice task capture - parses audio into a reviewable draft only.
      if (method === "POST" && pathname === "/api/voice/parse") {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await parseVoiceTask(env, body);
        if (result.status !== "ok") {
          const status = result.status === "unavailable" ? 503 : result.status === "invalid" ? 400 : 502;
          return jsonResponse(request, env, { error: result.error, ...(result.excerpt ? { excerpt: result.excerpt } : {}) }, status);
        }
        return jsonResponse(request, env, { success: true, draft: result.draft });
      }

      // 5. Aggregates for the dashboard: month, or fromMs/toMs, or all time
      if (method === "GET" && pathname === "/api/summary") {
        const month = url.searchParams.get("month") || undefined;
        const fromMs = url.searchParams.get("fromMs");
        const toMs = url.searchParams.get("toMs");
        if ((fromMs === null) !== (toMs === null)) {
          return jsonResponse(request, env, { error: "fromMs and toMs must be provided together" }, 400);
        }
        const result = await querySummary(env, {
          month,
          ...(fromMs !== null ? { fromMs: Number(fromMs), toMs: Number(toMs) } : {}),
        });
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, 400);
        return jsonResponse(request, env, { range: result.range, totals: result.totals, rows: result.rows });
      }

      // 6. Detailed dashboard aggregates (not limited to bootstrap's 50 recent rows).
      if (method === "GET" && pathname === "/api/dashboard") {
        const month = url.searchParams.get("month") || undefined;
        const fromMs = url.searchParams.get("fromMs");
        const toMs = url.searchParams.get("toMs");
        if ((fromMs === null) !== (toMs === null)) {
          return jsonResponse(request, env, { error: "fromMs and toMs must be provided together" }, 400);
        }
        const result = await queryDashboard(env, {
          month,
          ...(fromMs !== null ? { fromMs: Number(fromMs), toMs: Number(toMs) } : {}),
        });
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, 400);
        return jsonResponse(request, env, result);
      }

      // 7. Soft archive / restore master data without deleting history.
      const archiveMatch = pathname.match(new RegExp("^/api/(customers|projects|activities)/([^/]+)/(archive|restore)$"));
      if (method === "POST" && archiveMatch) {
        const [, type, id, action] = archiveMatch;
        const result = await setArchived(env, type, decodeURIComponent(id), action === "archive");
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        }
        return jsonResponse(request, env, { success: true, archived: action === "archive", record: result.record });
      }

      if (method === "POST" && pathname === "/api/import/csv") {
        // Batched CSV import (Kimai export format). Masters + entries in one
        // request; see docs/2026-09-20-csv-import-plan.md for the contract.
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await importCsvBatch(env, body);
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        }
        return jsonResponse(request, env, result);
      }

      // 8. Historical entries - edit any closed entry, including its time range.
      const entryMatch = matchCollection(pathname, "entries");
      if (method === "POST" && pathname === "/api/entries") {
        // Closed-entry create: the import path (CSV/Kimai). Timer starts must go
        // through /api/timer/start so the single-running-timer rule holds.
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await createTimeEntry(env, body);
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        }
        return jsonResponse(request, env, { success: true, entry: result.entry }, 201);
      }
      if (method === "PATCH" && entryMatch?.id) {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await updateTimeEntry(env, entryMatch.id, body);
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        }
        return jsonResponse(request, env, { success: true, entry: result.entry });
      }
      if (method === "DELETE" && entryMatch?.id) {
        const result = await deleteTimeEntry(env, entryMatch.id);
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 404);
        }
        return jsonResponse(request, env, { success: true });
      }

      // 9. Client detail - profile, projects, and paginated time history.
      const clientDetailMatch = pathname.match("^/api/clients/([^/]+)$");
      if (method === "GET" && clientDetailMatch) {
        const id = decodeURIComponent(clientDetailMatch[1]);
        const limit = Number(url.searchParams.get("limit") || 50);
        const offset = Number(url.searchParams.get("offset") || 0);
        const result = await getClientDetail(env, id, { limit, offset });
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 404);
        }
        return jsonResponse(request, env, result);
      }

      // 9b. Project detail - profile with client context, activity breakdown, paginated history.
      const projectDetailMatch = pathname.match("^/api/projects/([^/]+)$");
      if (method === "GET" && projectDetailMatch) {
        const id = decodeURIComponent(projectDetailMatch[1]);
        const limit = Number(url.searchParams.get("limit") || 50);
        const offset = Number(url.searchParams.get("offset") || 0);
        const result = await getProjectDetail(env, id, { limit, offset });
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 404);
        }
        return jsonResponse(request, env, result);
      }

      // 8b. Entries by period - paginated history for app period filters
      // (last week / last month / custom range).
      if (method === "GET" && pathname === "/api/entries") {
        const fromMs = url.searchParams.get("fromMs");
        const toMs = url.searchParams.get("toMs");
        if ((fromMs === null) !== (toMs === null)) {
          return jsonResponse(request, env, { error: "fromMs and toMs must be provided together" }, 400);
        }
        const result = await listEntries(env, {
          ...(fromMs !== null ? { fromMs: Number(fromMs), toMs: Number(toMs) } : {}),
          limit: Number(url.searchParams.get("limit") || 50),
          offset: Number(url.searchParams.get("offset") || 0),
        });
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, 400);
        return jsonResponse(request, env, result);
      }

      // 8c. Project tasks - the task list of one project (with default flags).
      const projectTasksMatch = pathname.match("^/api/projects/([^/]+)/tasks$");
      if (method === "GET" && projectTasksMatch) {
        const tasks = await listProjectTasks(env, decodeURIComponent(projectTasksMatch[1]));
        return jsonResponse(request, env, { tasks });
      }

      // 8d. Add a task to a project (find-or-create a shared activity by name).
      if (method === "POST" && projectTasksMatch) {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await addProjectTask(env, decodeURIComponent(projectTasksMatch[1]), body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, task: result.task }, 201);
      }

      // 8e. Unlink a task from a project (the shared activity stays).
      const projectTaskMatch = pathname.match("^/api/projects/([^/]+)/tasks/([^/]+)$");
      if (method === "DELETE" && projectTaskMatch) {
        const result = await removeProjectTask(env, decodeURIComponent(projectTaskMatch[1]), decodeURIComponent(projectTaskMatch[2]));
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 404);
        return jsonResponse(request, env, { success: true });
      }

      // 9c. Activity detail - profile, client breakdown (per-client currency), paginated history.
      const activityDetailMatch = pathname.match("^/api/activities/([^/]+)$");
      if (method === "GET" && activityDetailMatch) {
        const id = decodeURIComponent(activityDetailMatch[1]);
        const limit = Number(url.searchParams.get("limit") || 50);
        const offset = Number(url.searchParams.get("offset") || 0);
        const result = await getActivityDetail(env, id, { limit, offset });
        if (result.status !== "ok") {
          return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 404);
        }
        return jsonResponse(request, env, result);
      }

      // 10. Master data - create / update customers, projects, activities
      if (method === "POST" && pathname === "/api/customers") {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await createCustomer(env, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, customer: result.customer }, 201);
      }

      const customerMatch = matchCollection(pathname, "customers");
      if (method === "PATCH" && customerMatch?.id) {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await updateCustomer(env, customerMatch.id, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, customer: result.customer });
      }

      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await createProject(env, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, project: result.project }, 201);
      }

      const projectMatch = matchCollection(pathname, "projects");
      if (method === "PATCH" && projectMatch?.id) {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await updateProject(env, projectMatch.id, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, project: result.project });
      }

      if (method === "POST" && pathname === "/api/activities") {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await createActivity(env, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, activity: result.activity }, 201);
      }

      const activityMatch = matchCollection(pathname, "activities");
      if (method === "PATCH" && activityMatch?.id) {
        const body = await readJson(request);
        if (!body) return jsonResponse(request, env, { error: "Invalid JSON body" }, 400);
        const result = await updateActivity(env, activityMatch.id, body);
        if (result.status !== "ok") return jsonResponse(request, env, { error: result.error }, STATUS_CODES[result.status] || 400);
        return jsonResponse(request, env, { success: true, activity: result.activity });
      }

      // Demo reset - only when DEMO_MODE env var is the exact string "true"
      // (toml vars are strings, so Boolean("false") would be a false positive).
      const demoEnabled = env.DEMO_MODE === "true";
      if (method === "POST" && pathname === "/api/demo/reset") {
        if (!demoEnabled) return jsonResponse(request, env, { error: "Demo mode is not enabled" }, 403);
        const result = await resetDemoData(env);
        return jsonResponse(request, env, { success: true });
      }

      // Demo status - lets the client know if demo mode is active.
      if (method === "GET" && pathname === "/api/demo/status") {
        return jsonResponse(request, env, { demoMode: demoEnabled });
      }

      return jsonResponse(request, env, { error: "Route not found" }, 404);
    } catch (err) {
      return jsonResponse(request, env, { error: err.message }, 500);
    }
  },
};
