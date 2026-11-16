// Shared HTTP helpers: JSON responses and credentialed CORS. See docs/2026-11-12-auth-and-mcp-blueprint.md §6.1.
// Credentials (cookies) are only allowed for an explicitly listed origin; "*" never carries credentials.

const BASE_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "ETag, Retry-After",
  "Access-Control-Max-Age": "600",
  "Vary": "Origin",
};

export const allowedOrigins = (env) => (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);

/** True only when the request Origin is explicitly listed ("*" never counts). */
export function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return Boolean(origin) && allowedOrigins(env).some((o) => o !== "*" && o === origin);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const list = allowedOrigins(env);
  if (origin && list.includes(origin)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
  }
  if (list.includes("*")) return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin || "*" }; // no credentials with "*"
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": list[0] || "" };
}

export function jsonResponse(request, env, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request, env), ...extraHeaders },
  });
}

export const handleCors = (request, env) => new Response(null, { status: 204, headers: corsHeaders(request, env) });

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
