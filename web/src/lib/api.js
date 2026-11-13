const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8787").replace(/\/$/, "");

/**
 * "cookie" (default, same-site API): the HttpOnly session cookie rides along.
 * "bearer" (demo build, pages.dev vs workers.dev are different sites): the session token
 * from login is kept in localStorage and sent as `Authorization: Bearer`.
 */
export const AUTH_TRANSPORT = import.meta.env.VITE_AUTH_TRANSPORT === "bearer" ? "bearer" : "cookie";
/** Dispatched on window when the API answers 401 to a credentialed request. */
export const UNAUTHORIZED_EVENT = "tt:unauthorized";
/** Streamable HTTP MCP endpoint (for copy-paste client configs in Settings). */
export const MCP_URL = new URL("/mcp", API_BASE || window.location.origin).href;

const TOKEN_KEY = "cf-tt-session";

// Storage can be blocked (private mode, disabled site data): every access is best-effort.
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore: the request still goes out, the user just has to sign in again later.
  }
}

/** Keeps the token returned by login/setup (token transport only). */
function keepToken(data) {
  if (data && typeof data.token === "string") writeToken(data.token);
  return data;
}

async function request(path, options = {}) {
  // `auth: false` skips the 401 side effect (sign-out broadcast). It does not drop the
  // credential: logout and password change need it on the wire.
  const { auth = true, headers: extraHeaders, ...rest } = options;
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  const init = { ...rest, headers };

  if (AUTH_TRANSPORT === "bearer") {
    init.credentials = "omit";
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  } else {
    init.credentials = "include";
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    throw new Error(`Cannot reach API at ${API_BASE} (${err.message})`);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`API returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const detail = data.excerpt ? ` - ${data.excerpt}` : "";
    const error = new Error((data.error || `Request failed (${res.status})`) + detail);
    error.status = res.status;
    // Machine-readable reason from the worker, e.g. "timer_running" / "no_active_timer".
    if (data.code) error.code = data.code;
    // On `entry_changed` the worker returns the latest stored entry for a quick re-review.
    if (data.entry) error.entry = data.entry;
    // Seconds until a 429 may be retried (rate limit / login throttle).
    error.retryAfter = Number(res.headers.get("Retry-After")) || null;
    if (res.status === 401 && auth) {
      writeToken(null);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw error;
  }
  return data;
}

/** Auth status without a session: `{ configured, setupRequired }`. */
export const getAuthStatus = () => request("/api/auth/status", { auth: false });

/** Current user for the stored credential: `{ user, auth }`. Throws 401 when signed out. */
export const getMe = () => request("/api/auth/me");

export const login = (username, password) =>
  request("/api/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ username, password, transport: AUTH_TRANSPORT === "bearer" ? "token" : "cookie" }),
  }).then(keepToken);

/** First-run only: creates the sole account, guarded by the setup token. */
export const setupFirstUser = ({ setupToken, username, password }) =>
  request("/api/auth/setup", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ setupToken, username, password, transport: AUTH_TRANSPORT === "bearer" ? "token" : "cookie" }),
  }).then(keepToken);

/** Revokes the presented session server-side. The local token is dropped even if the call fails. */
export const logout = async () => {
  try {
    return await request("/api/auth/logout", { method: "POST", auth: false });
  } finally {
    writeToken(null);
  }
};

/** Changes the password and signs out other sessions. A wrong current password is a plain 401 (no sign-out). */
export const changePassword = (currentPassword, newPassword) =>
  request("/api/auth/password", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ currentPassword, newPassword }),
  });

export const listApiTokens = () => request("/api/auth/tokens");

/** Returns `{ token, apiToken }`. `token` is shown once; the caller must not persist it. */
export const createApiToken = ({ name, scope = "mcp", expiresInDays = null }) =>
  request("/api/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ name, scope, expiresInDays }),
  });

export const revokeApiToken = (id) =>
  request(`/api/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getBootstrap = () => request("/api/bootstrap");

/** One-row change check: compare with `dataRev` from bootstrap to see if another device wrote. */
export const getRev = () => request("/api/rev");

/** Client detail: profile, projects, paginated time history, and totals. */
export const getClient = (id, { limit = 50, offset = 0 } = {}) =>
  request(`/api/clients/${encodeURIComponent(id)}?limit=${limit}&offset=${offset}`);

/** Project detail: profile with client context, activity breakdown, paginated history. */
export const getProject = (id, { limit = 50, offset = 0 } = {}) =>
  request(`/api/projects/${encodeURIComponent(id)}?limit=${limit}&offset=${offset}`);

/** Activity detail: profile, client breakdown, paginated history. */
export const getActivity = (id, { limit = 50, offset = 0 } = {}) =>
  request(`/api/activities/${encodeURIComponent(id)}?limit=${limit}&offset=${offset}`);

export const getSummary = (month) =>
  request(`/api/summary${month && month !== "all" ? `?month=${encodeURIComponent(month)}` : ""}`);

/** Rolling window aggregate, e.g. the last 7 days. */
export const getSummaryRange = (fromMs, toMs) =>
  request(`/api/summary?fromMs=${encodeURIComponent(fromMs)}&toMs=${encodeURIComponent(toMs)}`);

export const getDashboard = ({ month, fromMs, toMs } = {}) => {
  const params = new URLSearchParams();
  if (month && month !== "all") params.set("month", month);
  if (fromMs !== undefined && toMs !== undefined) {
    params.set("fromMs", fromMs);
    params.set("toMs", toMs);
  }
  const query = params.toString();
  return request(`/api/dashboard${query ? `?${query}` : ""}`);
};

export const createCustomer = (payload) =>
  request("/api/customers", { method: "POST", body: JSON.stringify(payload) });

export const updateCustomer = (id, payload) =>
  request(`/api/customers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });

export const createProject = (payload) =>
  request("/api/projects", { method: "POST", body: JSON.stringify(payload) });

export const updateProject = (id, payload) =>
  request(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });

export const createActivity = (payload) =>
  request("/api/activities", { method: "POST", body: JSON.stringify(payload) });

export const updateActivity = (id, payload) =>
  request(`/api/activities/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });

const setArchived = (type, id, action) =>
  request(`/api/${type}/${encodeURIComponent(id)}/${action}`, { method: "POST" });

export const archiveCustomer = (id) => setArchived("customers", id, "archive");
export const restoreCustomer = (id) => setArchived("customers", id, "restore");
export const archiveProject = (id) => setArchived("projects", id, "archive");
export const restoreProject = (id) => setArchived("projects", id, "restore");
export const archiveActivity = (id) => setArchived("activities", id, "archive");
export const restoreActivity = (id) => setArchived("activities", id, "restore");

export const parseVoiceTask = ({ audioBase64, mimeType }) =>
  request("/api/voice/parse", { method: "POST", body: JSON.stringify({ audioBase64, mimeType }) });

export const startTimer = (payload) =>
  request("/api/timer/start", { method: "POST", body: JSON.stringify(payload) });

export const stopTimer = () => request("/api/timer/stop", { method: "POST" });

export const updateTimeEntry = (id, payload) =>
  request(`/api/entries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

/** Closed-entry create (duplicate, import follow-ups). Timer starts go through startTimer. */
export const createTimeEntry = (payload) =>
  request("/api/entries", { method: "POST", body: JSON.stringify(payload) });

export const deleteTimeEntry = (id, ifVersion) =>
  request(`/api/entries/${encodeURIComponent(id)}${ifVersion ? `?ifVersion=${encodeURIComponent(ifVersion)}` : ""}`, { method: "DELETE" });

/**
 * One page of history. Optional: half-open [fromMs, toMs) range, client/project/activity
 * filters, keyset cursor `before` (preferred over offset), `lean` (ids only, no name joins).
 */
export const listEntries = ({ fromMs, toMs, limit = 50, offset = 0, customerId, projectId, activityId, before, lean } = {}) => {
  const params = new URLSearchParams({ limit });
  if (before) params.set("before", before);
  else params.set("offset", offset);
  if (fromMs !== undefined && toMs !== undefined) {
    params.set("fromMs", fromMs);
    params.set("toMs", toMs);
  }
  if (customerId) params.set("customerId", customerId);
  if (projectId) params.set("projectId", projectId);
  if (activityId) params.set("activityId", activityId);
  if (lean) params.set("lean", "1");
  return request(`/api/entries?${params.toString()}`);
};

/** Earliest/latest entry start (null/null when empty): cheap input for the period picker. */
export const getEntryBounds = () => request("/api/entries/bounds");

/**
 * Every entry matching the filters, following the keyset cursor to the end. Meant for a
 * bounded selection (one month, one client); an unbounded call pages through all history.
 */
export const fetchEntries = async ({ limit = 200, ...filters } = {}) => {
  const out = [];
  let before;
  let offset = 0;
  for (;;) {
    const page = await listEntries({ ...filters, limit, before, offset });
    out.push(...page.entries);
    if (page.paging?.has_more === false || page.entries.length < limit) return out;
    // Older workers have no cursor: fall back to offset paging.
    if (page.paging?.next) before = page.paging.next;
    else offset += page.entries.length;
  }
};

/** The task list of one project (linked shared activities with default flags). */
export const getProjectTasks = (projectId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/tasks`);

export const addProjectTask = (projectId, payload) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const removeProjectTask = (projectId, taskId) =>
  request(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });

export const syncSheets = ({ gasWebhookUrl, filterMonth }) =>
  request("/api/sync/google-sheets", {
    method: "POST",
    body: JSON.stringify({ gasWebhookUrl, filterMonth: filterMonth || undefined }),
  });

/** Demo mode: check status and reset data. */
export const getDemoStatus = () => request("/api/demo/status");
export const resetDemoData = () => request("/api/demo/reset", { method: "POST" });

export { API_BASE };
