import { useCallback, useEffect, useState } from "react";
import type { FsEntry } from "./reconcile.js";

interface Response {
  entries: FsEntry[];
}

interface State {
  entries: FsEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the `/api/assets/fs-listing` route and exposes the result
 * as React state. Callers should call `refetch()` after any action
 * that is likely to change the filesystem (upload success, orphan
 * import, etc.). No polling — users who need instant reflection of
 * direct-to-disk writes can trigger a refetch via the panel's
 * refresh button.
 */
export function useAssetFsListing(): State & { refetch: () => void } {
  const [state, setState] = useState<State>({
    entries: [],
    loading: true,
    error: null,
  });

  const refetch = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetch("/api/assets/fs-listing")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Response>;
      })
      .then((data) => {
        setState({ entries: data.entries ?? [], loading: false, error: null });
      })
      .catch((err) => {
        setState({
          entries: [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ...state, refetch };
}
