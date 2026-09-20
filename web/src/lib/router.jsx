// Minimal history-API router. Slash-based routes with optional path parameters
// (`/clients/:id`), so this still avoids pulling in a routing dependency.
// Cloudflare Pages serves the SPA fallback via web/public/_redirects
// (`/* /index.html 200`) so deep links work.

import { useEffect, useMemo, useState } from "react";

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, window.location.origin);
  if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Current pathname, re-rendered on pushState/replaceState/back/forward. */
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

/** Compiled matcher: segments starting with ":" capture one path segment. */
function compile(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^/${source}/?$`), keys };
}

/** Match a pathname against a pattern; returns params object or null. */
export function matchPath(pattern, path) {
  const { regex, keys } = compile(pattern);
  const match = path.match(regex);
  if (!match) return null;
  return Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
}

/** First matching pattern with its params, or null. Patterns are tried in order. */
export function matchRoutes(patterns, path) {
  for (const pattern of patterns) {
    const params = matchPath(pattern, path);
    if (params) return { pattern, params };
  }
  return null;
}

/** Path params for the current URL, matched against one or more patterns. */
export function useParams(patterns) {
  const path = usePath();
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return useMemo(() => matchRoutes(list, path), [path, list.join("|")]);
}

export function Link({ to, className = "", activeClassName = "", children, ...rest }) {
  const path = usePath();
  const isActive = path === to || (to !== "/" && path.startsWith(`${to}/`));
  const handleClick = (event) => {
    // Let modified clicks and middle-clicks behave like normal links.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a
      href={to}
      onClick={handleClick}
      aria-current={isActive ? "page" : undefined}
      className={[className, isActive ? activeClassName : ""].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </a>
  );
}
