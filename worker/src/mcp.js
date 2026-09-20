// MCP server (JSON-RPC 2.0 over POST /mcp) — tasks T-M1..T-M4.
//
// Transport decision (T-M4): a plain JSON-RPC POST is sufficient for v1. The Streamable
// HTTP transport spec allows a server to answer a POST with a single `application/json`
// response (no SSE), which is what we do — no session id, no server-initiated messages.
// Every tool is request/response, so SSE adds machinery with no capability gain. Revisit
// only if a client demands `text/event-stream` or long-lived sessions.

import { getActiveTimer, monthRange, isValidMonth, querySummary, startTimer, stopTimer } from "./core.js";

export const PROTOCOL_VERSION = "2025-06-18";

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

async function callTool(env, name, args = {}) {
  switch (name) {
    case "get_active_timer": {
      const timer = await getActiveTimer(env);
      return timer ? { timer } : { status: "idle" };
    }
    case "start_timer": {
      const res = await startTimer(env, args);
      if (res.status === "ok") return { success: true, timer: res.timer };
      // JSON-RPC has no HTTP status to carry, so the conflict travels as `code`
      // ("timer_running") inside an isError tool result — MCP's transport-neutral
      // equivalent of the REST 409.
      return { error: res.error, ...(res.code ? { code: res.code } : {}), _isError: true };
    }
    case "stop_timer": {
      const res = await stopTimer(env);
      if (res.status === "ok") return { success: true, timer: res.timer };
      return { error: res.error, ...(res.code ? { code: res.code } : {}), _isError: true };
    }
    case "query_summary": {
      const res = await querySummary(env, args);
      if (res.status === "ok") return { range: res.range, totals: res.totals, rows: res.rows };
      return { error: res.error, _isError: true };
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

      const payload = await callTool(env, name, params.arguments ?? {});
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

/** Handle one POST /mcp body containing a single JSON-RPC message. */
export async function handleMcp(request, env) {
  let msg;
  try {
    msg = await request.json();
  } catch {
    return mcpResponse(rpcError(null, ERR.PARSE, "Parse error: body is not valid JSON"));
  }

  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return mcpResponse(rpcError(msg?.id, ERR.INVALID_REQUEST, "Invalid Request: jsonrpc must be \"2.0\" with a method"));
  }

  // Notifications (no id) get no JSON-RPC response — 202 with an empty body.
  if (msg.id === undefined) return mcpResponse(null, 202);

  try {
    return mcpResponse(await dispatch(env, msg));
  } catch (err) {
    return mcpResponse(rpcError(msg.id, ERR.INTERNAL, err.message));
  }
}
