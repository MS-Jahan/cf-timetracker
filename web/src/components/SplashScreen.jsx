import { useEffect, useState } from "react";

/**
 * Full-screen splash for demo mode: an SVG clock logo scales in,
 * then a progress bar fills, then the whole thing fades out.
 * Total visible time ≈ 1.6s (400ms logo + 1200ms bar).
 * Calls `onDone()` when the splash completes so the app can render.
 */
export default function SplashScreen({ onDone }) {
  const [phase, setPhase] = useState("logo"); // logo → bar → fade → done

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("bar"), 400);
    const t2 = setTimeout(() => setPhase("fade"), 1600);
    const t3 = setTimeout(() => { setPhase("done"); onDone?.(); }, 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-base-100 ${phase === "fade" ? "animate-fade-out" : ""}`}
      role="alert"
      aria-busy="true"
      aria-label="Loading application"
    >
      {/* Brand mark (web/public/logo-mark.png, transparent) */}
      <div className={phase === "logo" ? "animate-scale-in" : ""}>
        <img src="/logo-mark.png" alt="CF Time Tracker" width="96" height="88" />
      </div>

      <p className="mt-4 text-lg font-semibold tracking-tight text-base-content">
        Timetracker
      </p>
      <p className="mt-1 text-sm ink-muted">
        Billable hours, clearly kept.
      </p>

      {/* Progress bar */}
      {(phase === "bar" || phase === "fade") && (
        <div className="mt-6 h-1 w-48 overflow-hidden rounded-full bg-base-300">
          <div className="h-full bg-accent animate-progress rounded-full" />
        </div>
      )}
    </div>
  );
}
