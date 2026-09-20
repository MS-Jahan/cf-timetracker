import { useCallback, useEffect, useState } from "react";
import { getBootstrap } from "./api.js";

/**
 * Bootstrap data + a uniform action wrapper. Each page mounts its own instance,
 * so a deep link straight to /settings fetches exactly what it needs.
 */
export function useTracker() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await getBootstrap();
      setData(payload);
      setStatus("ready");
      setLoadError("");
      return payload;
    } catch (err) {
      setStatus("error");
      setLoadError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Run an API action, refresh bootstrap, and surface a notice or an error.
   * Resolves to `{ ok, code, message }` so callers can react to a specific failure
   * (e.g. a lost single-timer race) instead of only showing the message.
   */
  const runAction = async (fn, successMessage) => {
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await fn();
      await load();
      if (successMessage) setNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
      return { ok: true, code: null, message: null };
    } catch (err) {
      setActionError(err.message);
      return { ok: false, code: err.code || null, message: err.message };
    } finally {
      setBusy(false);
    }
  };

  /** Show an informational notice in place of any error banner (e.g. after a handled conflict). */
  const addNotice = (message) => {
    setActionError("");
    setNotice(message);
  };

  return {
    data,
    status,
    loadError,
    actionError,
    notice,
    busy,
    load,
    addNotice,
    runAction,
    retry: () => {
      setStatus("loading");
      load();
    },
    entries: data?.entries || [],
    customers: data?.customers || [],
    projects: data?.projects || [],
    activities: data?.activities || [],
    projectTasks: data?.projectTasks || [],
    archivedCustomers: data?.archivedCustomers || [],
    archivedProjects: data?.archivedProjects || [],
    archivedActivities: data?.archivedActivities || [],
    activeTimer: data?.activeTimer || null,
  };
}
