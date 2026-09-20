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
      {/* Clock SVG — simple, clean, matches the ledger theme */}
      <div className={phase === "logo" ? "animate-scale-in" : ""}>
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="3" className="text-base-content" />
          <circle cx="40" cy="40" r="3" fill="currentColor" className="text-accent" />
          {/* Hour hand */}
          <line x1="40" y1="40" x2="40" y2="22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-base-content" />
          {/* Minute hand */}
          <line x1="40" y1="40" x2="54" y2="40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-accent" />
          {/* Hour marks */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
            <line
              key={deg}
              x1="40"
              y1="8"
              x2="40"
              y2={deg % 90 === 0 ? "14" : "11"}
              stroke="currentColor"
              strokeWidth={deg % 90 === 0 ? "2" : "1.5"}
              strokeLinecap="round"
              className="text-base-content"
              transform={`rotate(${deg} 40 40)`}
            />
          ))}
        </svg>
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
