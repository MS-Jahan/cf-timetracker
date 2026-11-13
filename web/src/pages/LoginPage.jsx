import { useEffect, useState } from "react";

const MIN_PASSWORD = 12;

function errorMessage(err) {
  if (err.status === 429) {
    const minutes = err.retryAfter ? Math.ceil(err.retryAfter / 60) : null;
    return minutes ? `Too many attempts. Try again in ${minutes} min.` : "Too many attempts. Try again later.";
  }
  return err.message;
}

/** Sign-in screen, or first-account setup when the server has no users yet. */
export default function LoginPage({ auth }) {
  const { setupRequired, configured, signIn, setup } = auth;
  const [setupToken, setSetupToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const previous = document.title;
    document.title = "Sign in · Timetracker";
    return () => {
      document.title = previous;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (setupRequired) {
      if (password.length < MIN_PASSWORD) {
        setError(`Use at least ${MIN_PASSWORD} characters for the password.`);
        return;
      }
      if (password !== confirm) {
        setError("The passwords do not match.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (setupRequired) await setup({ setupToken, username, password });
      else await signIn(username, password);
      // On success App swaps this screen out, so busy is left set.
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const title = setupRequired ? "Create the first account" : "Sign in";

  return (
    <main className="grid min-h-dvh place-items-center bg-base-200 px-4 py-10">
      <section className="card card-border w-full max-w-sm bg-base-100">
        <div className="card-body gap-5">
          <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/10">
              <img src="/logo-mark.png" alt="" className="h-7 w-7" />
            </span>
            Timetracker
          </div>

          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            {setupRequired && (
              <p className="ink-muted mt-1 text-sm">
                This server has no accounts yet. Enter the setup token from your deployment settings.
              </p>
            )}
          </div>

          {!configured && (
            <div role="alert" className="alert alert-warning">
              <span>Server authentication is not configured (AUTH_PEPPER).</span>
            </div>
          )}
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}

          <form className="grid gap-4" onSubmit={handleSubmit}>
            {setupRequired && (
              <label className="grid gap-1.5">
                <span className="field-label">Setup token</span>
                <input
                  className="input w-full"
                  type="password"
                  autoComplete="off"
                  required
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                />
              </label>
            )}
            <label className="grid gap-1.5">
              <span className="field-label">Username</span>
              <input
                className="input w-full"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="field-label">Password</span>
              <input
                className="input w-full"
                type="password"
                name="password"
                autoComplete={setupRequired ? "new-password" : "current-password"}
                minLength={setupRequired ? MIN_PASSWORD : undefined}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {setupRequired && (
              <label className="grid gap-1.5">
                <span className="field-label">Confirm password</span>
                <input
                  className="input w-full"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
            )}
            <button type="submit" className="btn btn-primary w-full" disabled={busy || !configured}>
              {busy ? <span className="loading loading-spinner loading-sm" /> : null}
              {setupRequired ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
