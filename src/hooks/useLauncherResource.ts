import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../utils/api.js";

/** Independent launcher reads retain their last good data and reject late responses. */
export function useLauncherResource<T extends object>(path: string, initialData: T) {
  const [state, setState] = useState({ data: initialData, loaded: false, pending: true, error: null as string | null });
  const arrayKeys = useRef(Object.entries(initialData).filter(([, value]) => Array.isArray(value)).map(([key]) => key));
  const active = useRef<AbortController | null>(null);
  const currentPath = useRef(path);
  currentPath.current = path;

  const refresh = useCallback(async (query?: Record<string, string>) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((previous) => ({ ...previous, pending: true, error: null }));
    const suffix = query ? `${path.includes("?") ? "&" : "?"}${new URLSearchParams(query)}` : "";
    try {
      const response = await fetch(`${getApiBase()}${path}${suffix}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as T;
      if (!data || typeof data !== "object" || arrayKeys.current.some((key) => !Array.isArray((data as Record<string, unknown>)[key]))) {
        throw new Error("Invalid launcher response");
      }
      if (controller.signal.aborted || currentPath.current !== path) return;
      setState({ data, loaded: true, pending: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || currentPath.current !== path) return;
      setState((previous) => ({ ...previous, pending: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    return () => active.current?.abort();
  }, [refresh]);

  return { ...state, refresh };
}
