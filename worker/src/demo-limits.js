// Abuse limits for the open demo (DEMO_MODE="true"). The demo API is public, so anyone can
// write; these keep it from being filled up between the daily resets:
//   1. per-IP rate limit on every mutating request (fixed window, shared auth_throttle table)
//   2. a much stricter per-IP limit on the public reset endpoint
//   3. global row caps on the tables a visitor can grow
// Limits never apply outside DEMO_MODE (index.js only calls them for the demo).

import { chargeThrottle, clientIp } from "./auth.js";

const WRITE_WINDOW_MS = 10 * 60_000;
const RESET_WINDOW_MS = 60 * 60_000;

/** Global row caps, checked only when a request would create a row. */
export const DEMO_ROW_CAPS = Object.freeze({ time_entries: 300, customers: 30, projects: 60, activities: 30 });

const intVar = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

/** POST routes that add rows (timer/start adds the running entry; tasks only link existing rows). */
const CREATING_POSTS = new Set(["/api/timer/start", "/api/entries", "/api/customers", "/api/projects", "/api/activities"]);
/** Which cap(s) a creating route is checked against. */
const CAP_TABLES = {
  "/api/timer/start": ["time_entries"],
  "/api/entries": ["time_entries"],
  "/api/customers": ["customers"],
  "/api/projects": ["projects"],
  "/api/activities": ["activities"],
};

const tooMany = (retryAfter, message) =>
  ({ status: 429, body: { error: message, code: "demo_rate_limited", retryAfter }, headers: { "Retry-After": String(retryAfter) } });

/**
 * Returns null when the request may proceed, else { status, body, headers } to send.
 * Fails open if the throttle table is unreadable: a broken limiter must not take the demo down.
 */
export async function demoGate(request, env, pathname, method) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const ip = clientIp(request);
  try {
    if (method === "POST" && pathname === "/api/demo/reset") {
      const r = await chargeThrottle(env, `demo-reset:${ip}`, { limit: intVar(env.DEMO_RESET_LIMIT, 3), windowMs: RESET_WINDOW_MS });
      return r.allowed ? null : tooMany(r.retryAfter, "Too many demo resets from this address. Try again later.");
    }

    const w = await chargeThrottle(env, `demo-write:${ip}`, { limit: intVar(env.DEMO_WRITE_LIMIT, 60), windowMs: WRITE_WINDOW_MS });
    if (!w.allowed) return tooMany(w.retryAfter, "Too many changes from this address. Try again in a few minutes.");

    if (method === "POST" && CREATING_POSTS.has(pathname)) {
      const row = await env.DB.prepare(
        "SELECT (SELECT COUNT(*) FROM time_entries) AS time_entries, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM activities) AS activities"
      ).first();
      for (const table of CAP_TABLES[pathname]) {
        if ((row?.[table] ?? 0) >= DEMO_ROW_CAPS[table]) {
          return {
            status: 409,
            body: { error: `The demo is full (${DEMO_ROW_CAPS[table]} ${table.replace("_", " ")} max). It resets daily, or use "Reset demo".`, code: "demo_limit_reached" },
            headers: {},
          };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}
