// MCP server (JSON-RPC 2.0 over POST /mcp) - tasks T-M1..T-M4.
// Requires Authorization: Bearer (session or API token); see docs/2026-11-12-auth-and-mcp-blueprint.md §7.
//
// Transport decision (T-M4): a plain JSON-RPC POST is sufficient for v1. The Streamable
// HTTP transport spec allows a server to answer a POST with a single `application/json`
// response (no SSE), which is what we do - no session id, no server-initiated messages.
// Every tool is request/response, so SSE adds machinery with no capability gain. Revisit
// only if a client demands `text/event-stream` or long-lived sessions.

import {
  bumpDataRev,
  createActivity,
  createCustomer,
  createProject,
  createTimeEntry,
  deleteTimeEntry,
  getActiveTimer,
  isValidMonth,
  listEntries,
  monthRange,
  querySummary,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "./core.js";

export const PROTOCOL_VERSION = "2025-06-18";

/** Time arguments accept epoch milliseconds or an ISO 8601 string with an explicit offset. */
const TIME_INPUT = {
  type: ["string", "number"],
  description: "Epoch milliseconds, or ISO 8601 with a UTC offset (e.g. 2026-11-16T09:30:00+06:00 or ...Z)",
};

/** Bad parameters (not business errors): surfaced as JSON-RPC -32602 by dispatch(). */
class McpParamError extends Error {}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;
const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/i;

/** Epoch ms (number, or digit string of >= 10 chars) or ISO 8601 with offset -> ms; otherwise null. */
export function parseTimeInput(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{10,}$/.test(text)) return Number(text);
  if (ISO_WITH_OFFSET.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function requireTime(field, value) {
  const ms = parseTimeInput(value);
  if (ms !== null) return ms;
  if (typeof value === "string" && ISO_NO_OFFSET.test(value.trim())) {
    throw new McpParamError(`${field} must include a UTC offset, e.g. +06:00 or Z (the Worker cannot know your timezone)`);
  }
  throw new McpParamError(`${field} must be epoch milliseconds or an ISO 8601 string with a UTC offset`);
}

/** Optional time: null and undefined both mean "not given". */
const optionalTime = (field, value) => (value === undefined || value === null ? undefined : requireTime(field, value));

/** Drop undefined/null so core functions see only the fields the caller actually sent. */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

export const TOOLS = [
  {
    name: "get_active_timer",
    description: "Return the currently running timer, or { status: \"idle\" } when none is running.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "start_timer",
    description:
      "Start a timer for a customer/project/activity. Fails if a timer is already running. Rate falls back to project rate then customer hourly rate.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "customers.id" },
        projectId: { type: "string", description: "projects.id" },
        activityId: { type: "string", description: "activities.id" },
        description: { type: "string" },
        tags: { type: "string", description: "Opaque string, e.g. comma-separated" },
        hourlyRate: { type: "number", description: "Override the resolved rate" },
      },
      required: ["customerId", "projectId", "activityId"],
      additionalProperties: false,
    },
  },
  {
    name: "stop_timer",
    description: "Stop the running timer and finalize duration_seconds and cost. Fails when no timer is running.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "query_summary",
    description:
      "Aggregate closed entries per customer/project over a range. Provide either `month` (YYYY-MM, UTC) or `fromMs`/`toMs`; omit both for all time.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "UTC month slice, e.g. 2025-07" },
        fromMs: { type: "number", description: "Inclusive start, Unix epoch milliseconds" },
        toMs: { type: "number", description: "Exclusive end, Unix epoch milliseconds" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_catalog",
    description:
      "List customers, projects, activities and project task links with their ids. Use these ids with start_timer, add_time_entry and update_time_entry. Active records only unless includeArchived. A project with no task links accepts any active activity.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: { type: "boolean", description: "Include archived records, marked archived: true" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_entries",
    description:
      "List time entries newest first, including the running entry. fromTime/toTime form a half-open range and must be given together. Use list_entries before update_time_entry or delete_time_entry to find an id.",
    inputSchema: {
      type: "object",
      properties: {
        fromTime: TIME_INPUT,
        toTime: TIME_INPUT,
        customerId: { type: "string" },
        projectId: { type: "string" },
        activityId: { type: "string" },
        limit: { type: "number", description: "1-100, default 20" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_time_entry",
    description:
      "Backfill a closed time entry for a forgotten timer. Give exactly one of endTime or durationMinutes. Rate falls back to project rate then customer hourly rate.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "customers.id" },
        projectId: { type: "string", description: "projects.id" },
        activityId: { type: "string", description: "activities.id" },
        startTime: TIME_INPUT,
        endTime: TIME_INPUT,
        durationMinutes: { type: "number", description: "Alternative to endTime; greater than 0" },
        description: { type: "string" },
        tags: { type: "string", description: "Opaque string, e.g. comma-separated" },
        hourlyRate: { type: "number", description: "Override the resolved rate" },
      },
      required: ["customerId", "projectId", "activityId", "startTime"],
      additionalProperties: false,
    },
  },
  {
    name: "update_time_entry",
    description:
      "Edit an entry; duration and cost are recalculated from the times and rate. Giving endTime on the running entry stops it. A stale ifVersion returns code entry_changed with the latest entry.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "time_entries.id" },
        ifVersion: { type: "string", description: "Version from list_entries; rejects the edit if the entry changed" },
        customerId: { type: "string" },
        projectId: { type: "string" },
        activityId: { type: "string" },
        description: { type: "string" },
        tags: { type: "string" },
        startTime: TIME_INPUT,
        endTime: TIME_INPUT,
        hourlyRate: { type: "number" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_time_entry",
    description: "Permanently delete a closed time entry. A running entry must be stopped first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "time_entries.id" },
        ifVersion: { type: "string", description: "Version from list_entries; rejects the delete if the entry changed" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "create_customer",
    description: "Create a customer (client). currency defaults to USD; hourlyRate is the client's default rate.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        currency: { type: "string", description: "3-letter ISO 4217 code, e.g. EUR" },
        hourlyRate: { type: "number" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description: "Create a project under a customer. Seeds the General and Meeting tasks, as the web app does.",
    inputSchema: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "customers.id" },
        name: { type: "string" },
        rate: { type: "number", description: "Project rate; overrides the customer rate" },
        budgetType: { type: "string", description: "hourly (default) or fixed" },
      },
      required: ["customerId", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "create_activity",
    description: "Create a shared activity (task). Names are unique; a duplicate name is an error.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        emoji: { type: "string", description: "Up to 8 characters" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

/** Tool-level failure: a successful JSON-RPC response carrying isError. */
function toolText(payload, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) };
}

/** Business failure as a tool result (isError); `code` and the latest `entry` pass through when core supplies them. */
function failure(res) {
  const code = res.code ?? (res.status === "conflict" ? "conflict" : undefined);
  return {
    error: res.error,
    ...(code ? { code } : {}),
    ...(res.entry ? { entry: res.entry } : {}),
    _isError: true,
  };
}

const clampLimit = (value) => {
  const n = Math.floor(Number(value ?? 20));
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 100);
};

const isoOrNull = (ms) => (ms === null || ms === undefined ? null : new Date(Number(ms)).toISOString());

function shapeEntry(e) {
  return {
    id: e.id,
    version: e.version,
    customer_id: e.customer_id,
    customer_name: e.customer_name ?? null,
    project_id: e.project_id,
    project_name: e.project_name ?? null,
    activity_id: e.activity_id,
    activity_name: e.activity_name ?? null,
    description: e.description ?? "",
    tags: e.tags ?? "",
    start_time: e.start_time,
    end_time: e.end_time ?? null,
    start_iso: isoOrNull(e.start_time),
    end_iso: isoOrNull(e.end_time),
    duration_seconds: e.duration_seconds ?? 0,
    cost: e.cost ?? 0,
    currency: e.currency ?? null,
    is_running: Boolean(e.is_running),
  };
}

async function listCatalog(env, { includeArchived }) {
  const customers = (
    await env.DB.prepare(
      `SELECT id, name, currency, hourly_rate, archived_at FROM customers ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY name`
    ).all()
  ).results;
  const projects = (
    await env.DB.prepare(
      `SELECT p.id, p.customer_id, p.name, p.rate, p.archived_at FROM projects p
       JOIN customers c ON c.id = p.customer_id
       ${includeArchived ? "" : "WHERE p.archived_at IS NULL AND c.archived_at IS NULL"} ORDER BY p.name`
    ).all()
  ).results;
  const activities = (
    await env.DB.prepare(
      `SELECT id, name, emoji, archived_at FROM activities ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY name`
    ).all()
  ).results;
  const links = (await env.DB.prepare("SELECT project_id, activity_id FROM project_tasks").all()).results;

  const projectIds = new Set(projects.map((p) => p.id));
  const activityIds = new Set(activities.map((a) => a.id));
  const projectTasks = {};
  for (const link of links) {
    if (!projectIds.has(link.project_id) || !activityIds.has(link.activity_id)) continue;
    (projectTasks[link.project_id] ??= []).push(link.activity_id);
  }

  const archived = (row) => (includeArchived ? { archived: row.archived_at !== null && row.archived_at !== undefined } : {});
  return {
    customers: customers.map((c) => ({ id: c.id, name: c.name, currency: c.currency, hourly_rate: c.hourly_rate, ...archived(c) })),
    projects: projects.map((p) => ({ id: p.id, customer_id: p.customer_id, name: p.name, rate: p.rate, ...archived(p) })),
    activities: activities.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, ...archived(a) })),
    projectTasks,
  };
}

async function listEntriesTool(env, args) {
  const hasFrom = args.fromTime !== undefined && args.fromTime !== null;
  const hasTo = args.toTime !== undefined && args.toTime !== null;
  if (hasFrom !== hasTo) throw new McpParamError("fromTime and toTime must be given together");
  const res = await listEntries(env, {
    fromMs: hasFrom ? requireTime("fromTime", args.fromTime) : undefined,
    toMs: hasTo ? requireTime("toTime", args.toTime) : undefined,
    customerId: args.customerId,
    projectId: args.projectId,
    activityId: args.activityId,
    limit: clampLimit(args.limit),
  });
  if (res.status !== "ok") return failure(res);
  return {
    entries: res.entries.map(shapeEntry),
    returned: res.paging.returned,
    has_more: res.paging.has_more,
  };
}

async function addTimeEntry(env, args) {
  const startTime = requireTime("startTime", args.startTime);
  const hasEnd = args.endTime !== undefined && args.endTime !== null;
  const hasDuration = args.durationMinutes !== undefined && args.durationMinutes !== null;
  if (hasEnd === hasDuration) throw new McpParamError("provide exactly one of endTime or durationMinutes");

  let endTime;
  if (hasEnd) {
    endTime = requireTime("endTime", args.endTime);
  } else {
    const minutes = Number(args.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new McpParamError("durationMinutes must be a number greater than 0");
    endTime = Math.round(startTime + minutes * 60000);
  }

  const res = await createTimeEntry(
    env,
    defined({
      customerId: args.customerId,
      projectId: args.projectId,
      activityId: args.activityId,
      startTime,
      endTime,
      description: args.description,
      tags: args.tags,
      hourlyRate: args.hourlyRate,
    })
  );
  if (res.status !== "ok") return failure(res);
  await bumpDataRev(env);
  return { success: true, entry: res.entry };
}

async function updateTimeEntryTool(env, args) {
  const patch = defined({
    customerId: args.customerId,
    projectId: args.projectId,
    activityId: args.activityId,
    description: args.description,
    tags: args.tags,
    hourlyRate: args.hourlyRate,
    startTime: optionalTime("startTime", args.startTime),
    endTime: optionalTime("endTime", args.endTime),
    ifVersion: args.ifVersion,
  });
  const res = await updateTimeEntry(env, args.id, patch);
  if (res.status !== "ok") return failure(res);
  await bumpDataRev(env);
  return { success: true, entry: res.entry };
}

async function deleteTimeEntryTool(env, args) {
  const res = await deleteTimeEntry(env, args.id, { ifVersion: args.ifVersion ?? undefined });
  if (res.status !== "ok") return failure(res);
  await bumpDataRev(env);
  return { success: true, id: args.id };
}

async function callTool(env, name, args = {}) {
  switch (name) {
    case "get_active_timer": {
      const timer = await getActiveTimer(env);
      return timer ? { timer } : { status: "idle" };
    }
    case "start_timer": {
      const res = await startTimer(env, args);
      if (res.status === "ok") {
        await bumpDataRev(env);
        return { success: true, timer: res.timer };
      }
      // JSON-RPC has no HTTP status to carry, so the conflict travels as `code`
      // ("timer_running") inside an isError tool result - MCP's transport-neutral
      // equivalent of the REST 409.
      return { error: res.error, ...(res.code ? { code: res.code } : {}), _isError: true };
    }
    case "stop_timer": {
      const res = await stopTimer(env);
      if (res.status === "ok") {
        await bumpDataRev(env);
        return { success: true, timer: res.timer };
      }
      return { error: res.error, ...(res.code ? { code: res.code } : {}), _isError: true };
    }
    case "query_summary": {
      const res = await querySummary(env, args);
      if (res.status === "ok") return { range: res.range, totals: res.totals, rows: res.rows };
      return { error: res.error, _isError: true };
    }
    case "list_catalog":
      return listCatalog(env, { includeArchived: args.includeArchived === true });
    case "list_entries":
      return listEntriesTool(env, args);
    case "add_time_entry":
      return addTimeEntry(env, args);
    case "update_time_entry":
      return updateTimeEntryTool(env, args);
    case "delete_time_entry":
      return deleteTimeEntryTool(env, args);
    case "create_customer": {
      const res = await createCustomer(env, defined({ name: args.name, currency: args.currency, hourlyRate: args.hourlyRate }));
      if (res.status !== "ok") return failure(res);
      await bumpDataRev(env);
      return { success: true, customer: res.customer };
    }
    case "create_project": {
      const res = await createProject(
        env,
        defined({ customerId: args.customerId, name: args.name, rate: args.rate, budgetType: args.budgetType })
      );
      if (res.status !== "ok") return failure(res);
      await bumpDataRev(env);
      return { success: true, project: res.project, tasks: res.tasks };
    }
    case "create_activity": {
      const res = await createActivity(env, defined({ name: args.name, emoji: args.emoji }));
      if (res.status !== "ok") return failure(res);
      await bumpDataRev(env);
      return { success: true, activity: res.activity };
    }
    default:
      return null; // unknown tool → -32601
  }
}

/** Validate arguments against the tool's inputSchema (required, types, additionalProperties). */
function validateArgs(tool, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return "arguments must be an object";

  const schema = tool.inputSchema;
  for (const key of schema.required || []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return `${key} is required`;
    }
  }
  const props = schema.properties || {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (!(key in props)) {
      if (schema.additionalProperties === false) return `unexpected property: ${key}`;
      continue;
    }
    const expected = props[key].type;
    if (expected === "string" && typeof value !== "string") return `${key} must be a string`;
    if (expected === "number" && !Number.isFinite(Number(value))) return `${key} must be a number`;
    if (props[key].pattern && !new RegExp(props[key].pattern).test(value)) {
      return `${key} must match ${props[key].pattern}`;
    }
  }
  return null;
}

async function dispatch(env, msg) {
  const { id, method, params } = msg || {};

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cf-timetracker", version: "1.0.0" },
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      if (!name || typeof name !== "string") return rpcError(id, ERR.INVALID_PARAMS, "params.name is required");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, ERR.METHOD_NOT_FOUND, `Unknown tool: ${name}`);

      const invalid = validateArgs(tool, params.arguments);
      if (invalid) return rpcError(id, ERR.INVALID_PARAMS, invalid, { tool: name });

      let payload;
      try {
        payload = await callTool(env, name, params.arguments ?? {});
      } catch (err) {
        if (err instanceof McpParamError) return rpcError(id, ERR.INVALID_PARAMS, err.message, { tool: name });
        throw err;
      }
      const { _isError, ...rest } = payload;
      return rpcResult(id, toolText(_isError ? rest : payload, Boolean(_isError)));
    }

    default:
      return rpcError(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

export function mcpResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Handle one POST /mcp body containing a single JSON-RPC message. `auth` is resolved by index.js (unused by tools today). */
export async function handleMcp(request, env, auth = null) {
  let msg;
  try {
    msg = await request.json();
  } catch {
    return mcpResponse(rpcError(null, ERR.PARSE, "Parse error: body is not valid JSON"));
  }

  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return mcpResponse(rpcError(msg?.id, ERR.INVALID_REQUEST, "Invalid Request: jsonrpc must be \"2.0\" with a method"));
  }

  // Notifications (no id) get no JSON-RPC response - 202 with an empty body.
  if (msg.id === undefined) return mcpResponse(null, 202);

  try {
    return mcpResponse(await dispatch(env, msg));
  } catch (err) {
    return mcpResponse(rpcError(msg.id, ERR.INTERNAL, err.message));
  }
}
