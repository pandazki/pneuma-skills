import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "../utils/api.js";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getInitialTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem("pneuma-launcher-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch { /* localStorage unavailable */ }
  return "system";
}

export interface AppTheme {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  cycle: () => void;
  set: (next: ThemePreference) => void;
}

/**
 * Pneuma's user-controlled theme. The single source of truth is
 * `~/.pneuma/settings.json` (served via `/api/user-theme`). localStorage is
 * only an instant-render fallback while the GET round-trip is in flight.
 *
 * All consumers (Launcher, session shell, viewers via useSystemPreferences)
 * share this hook so a `pneuma:theme-changed` dispatch from any of them
 * fans out to the rest within one tick.
 */
export function useAppTheme(): AppTheme {
  const [preference, setPreferenceState] = useState<ThemePreference>(getInitialTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(
    () => preference === "system" ? getSystemTheme() : preference,
  );
  const lastBroadcastRef = useRef<ThemePreference>(preference);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/api/user-theme`)
      .then((r) => r.json())
      .then((data: { theme: string | null }) => {
        if (cancelled) return;
        const remote = data.theme === "light" || data.theme === "dark" || data.theme === "system"
          ? (data.theme as ThemePreference)
          : null;
        if (remote && remote !== preference) {
          lastBroadcastRef.current = remote;
          setPreferenceState(remote);
        }
      })
      .catch(() => { /* server unreachable — keep localStorage value */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const next = preference === "system" ? getSystemTheme() : preference;
    setResolved(next);
    try { localStorage.setItem("pneuma-launcher-theme", preference); } catch { /* noop */ }
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => setResolved(getSystemTheme());
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ theme?: ThemePreference }>).detail;
      if (!detail?.theme) return;
      if (detail.theme === lastBroadcastRef.current) return;
      lastBroadcastRef.current = detail.theme;
      setPreferenceState(detail.theme);
    };
    window.addEventListener("pneuma:theme-changed", handler);
    return () => window.removeEventListener("pneuma:theme-changed", handler);
  }, []);

  const set = useCallback((next: ThemePreference | ((prev: ThemePreference) => ThemePreference)) => {
    setPreferenceState((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      if (resolved === prev) return prev;
      lastBroadcastRef.current = resolved;
      void fetch(`${getApiBase()}/api/user-theme`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: resolved }),
      }).catch(() => { /* offline-safe */ });
      window.dispatchEvent(new CustomEvent("pneuma:theme-changed", { detail: { theme: resolved } }));
      return resolved;
    });
  }, []);

  const cycle = useCallback(() => {
    set((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  }, [set]);

  return { preference, resolved, cycle, set };
}
