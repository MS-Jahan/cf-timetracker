import { useCallback, useEffect, useRef, useState } from "react";
import DashboardPage from "./pages/DashboardPage.jsx";
import ClientDetailPage from "./pages/ClientDetailPage.jsx";
import ProjectDetailPage from "./pages/ProjectDetailPage.jsx";
import ActivityDetailPage from "./pages/ActivityDetailPage.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";
import Icon from "./components/Icon.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import TopTimerBar from "./components/TopTimerBar.jsx";
import TrackerPage from "./pages/TrackerPage.jsx";
import SplashScreen from "./components/SplashScreen.jsx";
import { Link, usePath } from "./lib/router.jsx";
import { stopTimer, getDemoStatus, resetDemoData as apiResetDemo } from "./lib/api.js";
import { applyTheme, resolveTheme, storedTheme } from "./lib/theme.js";
import { useTracker } from "./lib/useTracker.js";

const NAV = [
  { to: "/", label: "Dashboard", hint: "Overview and reports", icon: "dashboard" },
  { to: "/timesheet", label: "Time entries", hint: "Record and review", icon: "clock" },
  { to: "/settings", label: "Settings", hint: "Clients and preferences", icon: "settings" },
];

// Ordered route table: the first match wins. Parametric patterns like
// /clients/:id must come before any literal catch-alls.
const ROUTES = [
  { pattern: "/", page: DashboardPage, alt: "/dashboard" },
  { pattern: "/dashboard", page: DashboardPage, redirect: "/" },
  { pattern: "/timesheet", page: TrackerPage },
  { pattern: "/clients/:id", page: ClientDetailPage },
  { pattern: "/projects/:id", page: ProjectDetailPage },
  { pattern: "/activities/:id", page: ActivityDetailPage },
  { pattern: "/settings", page: SettingsPage },
];

function NotFound({ path }) {
  return (
    <section className="py-10">
      <h1 className="text-xl font-semibold">No page at {path}</h1>
      <p className="ink-muted mt-2">Use the dashboard, time entries, or settings.</p>
      <Link className="btn btn-primary mt-5" to="/">Back to dashboard</Link>
    </section>
  );
}

export default function App() {
  const path = usePath();
  const tracker = useTracker();
  const [themePreference, setThemePreference] = useState(() => storedTheme());

  // Demo mode state
  const [demoMode, setDemoMode] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    // Only show splash once per session
    try { return !sessionStorage.getItem("cf-tt-splash-seen"); } catch { return true; }
  });
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(() => {
    try { return sessionStorage.getItem("cf-tt-demo-banner-dismissed") === "1"; } catch { return false; }
  });
  const [demoResetting, setDemoResetting] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  const prevPath = useRef(path);

  // Detect demo mode on mount
  useEffect(() => {
    getDemoStatus().then((data) => setDemoMode(data.demoMode)).catch(() => {});
  }, []);

  // Page transition animation: bump key on route change
  useEffect(() => {
    if (path !== prevPath.current) {
      prevPath.current = path;
      setPageKey((k) => k + 1);
    }
  }, [path]);

  const handleSplashDone = useCallback(() => {
    try { sessionStorage.setItem("cf-tt-splash-seen", "1"); } catch {}
    setShowSplash(false);
  }, []);

  const handleDismissBanner = useCallback(() => {
    try { sessionStorage.setItem("cf-tt-demo-banner-dismissed", "1"); } catch {}
    setDemoBannerDismissed(true);
  }, []);

  const handleResetDemo = useCallback(async () => {
    if (!window.confirm("Reset all demo data to the default sample?")) return;
    setDemoResetting(true);
    try {
      await apiResetDemo();
      window.location.reload();
    } catch (err) {
      window.alert(`Reset failed: ${err.message}`);
    } finally {
      setDemoResetting(false);
    }
  }, []);

  useEffect(() => {
    applyTheme(themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (themePreference !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themePreference]);

  const effective = resolveTheme(themePreference);
  const matched = ROUTES.map((route) => {
    const segments = route.pattern.split("/").filter(Boolean);
    const literals = segments.filter((s) => !s.startsWith(":"));
    const pattern = new RegExp(
      `^/${segments.map((s) => (s.startsWith(":") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}/?$`
    );
    return { ...route, regex: pattern, literals };
  }).find((route) => route.regex.test(path));

  // Sidebar highlighting: literal prefix routes only, so /clients/:id doesn't
  // falsely activate Settings.
  const activeNav = NAV.find(
    (item) => path === item.to || (item.to !== "/" && path.startsWith(`${item.to}/`))
  )?.to;

  if (showSplash) {
    return <SplashScreen onDone={handleSplashDone} />;
  }

  return (
    <>
      <a className="sr-only fixed left-4 top-4 z-50 rounded bg-base-100 px-4 py-3 text-sm font-medium shadow focus:not-sr-only" href="#main-content">
        Skip to main content
      </a>

      {/* Demo deployment banner */}
      {demoMode && !demoBannerDismissed && (
        <div className="no-print sticky top-0 z-40 flex items-center justify-center gap-3 border-b border-accent/30 bg-accent/5 px-4 py-2 text-sm animate-slide-down">
          <Icon name="info" size={15} />
          <span>
            This is a <strong>demo deployment</strong> with sample data.{' '}
            <Link className="link link-accent font-medium" to="/settings">Manage settings</Link>{' '}
            or{' '}
            <button
              type="button"
              className="link link-accent font-medium"
              disabled={demoResetting}
              onClick={handleResetDemo}
            >
              {demoResetting ? "Resetting…" : "reset demo data"}
            </button>.
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs ml-2"
            onClick={handleDismissBanner}
            aria-label="Dismiss demo notice"
          >
            <Icon name="clear" size={14} />
          </button>
        </div>
      )}

      <main className="mx-auto flex min-h-dvh max-w-[88rem] flex-col border-x border-base-300 bg-base-100 lg:flex-row">
      <aside className="no-print border-b border-base-300 px-5 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:px-4 lg:py-8">
        <Link to="/" className="text-lg font-semibold tracking-tight">Timetracker</Link>
        <p className="ink-muted mt-1 text-sm">Billable hours, clearly kept.</p>

        <nav className="mt-6 flex flex-wrap gap-2 lg:mt-12 lg:flex-col" aria-label="Main navigation">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group min-h-11 min-w-32 border-l-2 border-transparent px-3 py-2 lg:min-w-0"
              activeClassName={activeNav === item.to ? "border-base-content bg-base-200" : ""}
            >
              <span className={`flex items-center gap-2 text-sm font-medium ${activeNav === item.to ? "text-base-content" : "ink-muted"}`}>
                <Icon name={item.icon} size={17} />
                {item.label}
              </span>
              <span className="ink-muted hidden text-xs lg:block">{item.hint}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-4 lg:mt-auto">
          <p className="field-label">Appearance</p>
          <ThemeToggle preference={themePreference} onChange={setThemePreference} effective={effective} />
        </div>
      </aside>

      <section id="main-content" className="min-w-0 flex-1 px-5 pb-16 pt-5 sm:px-8 sm:pt-7" tabIndex="-1">
        <header className="app-header no-print flex min-h-10 flex-wrap items-center justify-end gap-4 pb-4">
          <TopTimerBar
            activeTimer={tracker.activeTimer}
            customers={tracker.customers}
            projects={tracker.projects}
            busy={tracker.busy}
            onStop={() => tracker.runAction(stopTimer, "Timer stopped.")}
          />
          {demoMode && (
            <button
              type="button"
              className="btn btn-ghost btn-xs ring-1 ring-inset ring-accent/40 text-accent"
              disabled={demoResetting}
              onClick={handleResetDemo}
              title="Reset demo data to defaults"
            >
              <Icon name="restore" size={14} />
              {demoResetting ? "Resetting…" : "Reset demo"}
            </button>
          )}
        </header>

        <div className="rule-strong" />

        <div key={pageKey} className="page-enter">
          {matched ? (
            <matched.page
              tracker={matched.page === TrackerPage ? tracker : undefined}
              {...(matched.props || {})}
              {...(matched.page === SettingsPage
                ? {
                    themePreference,
                    onThemeChange: setThemePreference,
                    demoMode,
                    onResetDemo: handleResetDemo,
                    demoResetting,
                  }
                : {})}
            />
          ) : (
            <NotFound path={path} />
          )}
        </div>
      </section>
      </main>
    </>
  );
}
