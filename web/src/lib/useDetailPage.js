import { useEffect, useState } from "react";

/**
 * Shared fetch/paginate state for the entity detail pages (client, project, activity).
 * `fetcher(id, { limit, offset })` is one of the lib/api.js detail getters; the payload
 * shape is up to the page. Reloading on id change resets to the first page, so a
 * client→project→client navigation never lands on a stale offset.
 */
export function useDetailPage(fetcher, id, { limit = 50 } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetcher(id, { limit, offset })
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, offset, reloadKey, limit, fetcher]);

  return {
    data,
    error,
    loading,
    offset,
    setOffset,
    reload: () => {
      setData(null);
      setOffset(0);
      setReloadKey((value) => value + 1);
    },
  };
}
