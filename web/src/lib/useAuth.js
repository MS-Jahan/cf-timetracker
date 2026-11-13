import { useCallback, useEffect, useState } from "react";
import {
  getAuthStatus,
  getMe,
  login,
  logout,
  setupFirstUser,
  UNAUTHORIZED_EVENT,
} from "./api.js";

const INITIAL = { status: "loading", user: null, setupRequired: false, configured: true, error: null };

/** Reads /api/auth/status without touching the signed-in state; never throws. */
async function readStatus() {
  try {
    const s = await getAuthStatus();
    return { setupRequired: !!s.setupRequired, configured: s.configured !== false };
  } catch {
    return null;
  }
}

/**
 * Session state for the whole app. `status` is loading | authenticated | anonymous | error.
 * Only App.jsx mounts this; pages never call the auth wrappers directly.
 */
export function useAuth() {
  const [state, setState] = useState(INITIAL);

  const showAnonymous = useCallback(async (extra = {}) => {
    setState({ ...INITIAL, status: "anonymous", ...extra });
    const status = await readStatus();
    if (status) setState((prev) => (prev.status === "anonymous" ? { ...prev, ...status } : prev));
  }, []);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      const { user } = await getMe();
      setState({ ...INITIAL, status: "authenticated", user, configured: true });
    } catch (err) {
      const status = await readStatus();
      if (status && !status.configured) {
        setState({ ...INITIAL, status: "anonymous", ...status });
      } else if (err.status === 401 && status) {
        setState({ ...INITIAL, status: "anonymous", ...status });
      } else {
        setState({ ...INITIAL, status: "error", error: err.message });
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Any credentialed call that gets a 401 lands here. showAnonymous (not refresh) so a
  // 401 from the status probe cannot loop back into this listener.
  useEffect(() => {
    const onUnauthorized = () => showAnonymous();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [showAnonymous]);

  const signIn = useCallback(async (username, password) => {
    const data = await login(username, password);
    setState({ ...INITIAL, status: "authenticated", user: data.user, configured: true });
    return data;
  }, []);

  const setup = useCallback(async (fields) => {
    const data = await setupFirstUser(fields);
    setState({ ...INITIAL, status: "authenticated", user: data.user, configured: true });
    return data;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Local credential is already cleared by logout(); the screen change below is what matters.
    }
    await showAnonymous();
  }, [showAnonymous]);

  return { ...state, refresh, signIn, setup, signOut };
}
