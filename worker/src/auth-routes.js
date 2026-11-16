// /api/auth/* HTTP endpoints. Thin mapping from auth.js results to HTTP; all data rules live in auth.js.
// Contract: docs/2026-11-12-auth-and-mcp-blueprint.md §6.3. Every response is `Cache-Control: no-store`.
import { jsonResponse, readJson } from "./http.js";
import * as auth from "./auth.js";

const CODES = { invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429, unavailable: 503 };
const NO_STORE = { "Cache-Control": "no-store" };
const WWW_AUTHENTICATE = { "WWW-Authenticate": 'Bearer realm="cf-timetracker"' };

const json = (request, env, data, status = 200, extra = {}) => jsonResponse(request, env, data, status, { ...NO_STORE, ...extra });

function fail(request, env, result) {
  const headers = result.retryAfter ? { "Retry-After": String(result.retryAfter) } : {};
  return json(request, env, { error: result.error || result.code, code: result.code }, CODES[result.status] || 400, headers);
}

const unauthenticated = (request, env) =>
  json(request, env, { error: "Authentication required", code: "unauthenticated" }, 401, WWW_AUTHENTICATE);

function sessionResponse(request, env, result, transport, status) {
  const body = { user: result.user, expiresAt: result.expiresAt };
  const headers = {};
  if (transport === "token") body.token = result.token;
  else headers["Set-Cookie"] = auth.sessionCookie(env, result.token, result.maxAgeSec);
  return json(request, env, body, status, headers);
}

/** Matches /api/auth/tokens/<id>; returns the decoded id or null. Malformed escapes yield "" (never a match). */
function tokenIdFrom(pathname) {
  const m = pathname.match(/^\/api\/auth\/tokens\/([^/]+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return "";
  }
}

/** Returns a Response for /api/auth/* or null when the path is not an auth route. */
export async function handleAuthRoute(request, env, authContext) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/auth/")) return null;
  const method = request.method;
  const ip = auth.clientIp(request);
  const userAgent = request.headers.get("User-Agent") ?? "";

  if (method === "GET" && pathname === "/api/auth/status") {
    if (!auth.authConfigured(env)) return json(request, env, { configured: false, setupRequired: false });
    const row = await env.DB.prepare("SELECT 1 AS found FROM users LIMIT 1").first();
    return json(request, env, { configured: true, setupRequired: !row });
  }

  if (method === "POST" && pathname === "/api/auth/setup") {
    const body = await readJson(request);
    if (!body || typeof body !== "object") return json(request, env, { error: "Invalid JSON body", code: "invalid_request" }, 400);
    const result = await auth.setupFirstUser(env, { setupToken: body.setupToken, username: body.username, password: body.password, ip, userAgent });
    if (result.status !== "ok") return fail(request, env, result);
    return sessionResponse(request, env, result, body.transport === "token" ? "token" : "cookie", 201);
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    if (!body || typeof body !== "object") return json(request, env, { error: "Invalid JSON body", code: "invalid_request" }, 400);
    const result = await auth.login(env, { username: body.username, password: body.password, ip, userAgent });
    if (result.status !== "ok") return fail(request, env, result);
    return sessionResponse(request, env, result, body.transport === "token" ? "token" : "cookie", 200);
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const current = authContext ?? (await auth.authenticate(request, env));
    if (current?.kind === "session") await auth.revokeSession(env, current.sessionId);
    return json(request, env, { success: true }, 200, { "Set-Cookie": auth.clearSessionCookie(env) });
  }

  // Everything below needs a resolved credential (the middleware normally guarantees it).
  const protectedRoute =
    (method === "GET" && pathname === "/api/auth/me") ||
    (method === "POST" && pathname === "/api/auth/password") ||
    (method === "GET" && pathname === "/api/auth/tokens") ||
    (method === "POST" && pathname === "/api/auth/tokens") ||
    (method === "DELETE" && tokenIdFrom(pathname) !== null);
  if (protectedRoute && !authContext) return unauthenticated(request, env);

  if (method === "GET" && pathname === "/api/auth/me") {
    return json(request, env, {
      user: authContext.user,
      auth: { kind: authContext.kind, scope: authContext.scope, expiresAt: authContext.expiresAt ?? null },
    });
  }

  if (method === "POST" && pathname === "/api/auth/password") {
    const body = await readJson(request);
    if (!body || typeof body !== "object") return json(request, env, { error: "Invalid JSON body", code: "invalid_request" }, 400);
    const result = await auth.changePassword(env, authContext, { currentPassword: body.currentPassword, newPassword: body.newPassword });
    if (result.status !== "ok") return fail(request, env, result);
    return json(request, env, { success: true, revokedSessions: result.revokedSessions });
  }

  if (method === "GET" && pathname === "/api/auth/tokens") {
    const result = await auth.listApiTokens(env, authContext);
    if (result.status !== "ok") return fail(request, env, result);
    return json(request, env, { tokens: result.tokens });
  }

  if (method === "POST" && pathname === "/api/auth/tokens") {
    const body = await readJson(request);
    if (!body || typeof body !== "object") return json(request, env, { error: "Invalid JSON body", code: "invalid_request" }, 400);
    const result = await auth.createApiToken(env, authContext, body);
    if (result.status !== "ok") return fail(request, env, result);
    return json(request, env, { token: result.token, apiToken: result.apiToken }, 201);
  }

  if (method === "DELETE" && tokenIdFrom(pathname) !== null) {
    const id = tokenIdFrom(pathname);
    if (!id) return json(request, env, { error: "API token not found", code: "not_found" }, 404);
    const result = await auth.revokeApiToken(env, authContext, id);
    if (result.status !== "ok") return fail(request, env, result);
    return json(request, env, { success: true });
  }

  return json(request, env, { error: "Route not found", code: "not_found" }, 404);
}
