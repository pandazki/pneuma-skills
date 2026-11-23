import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentBackendType, BackendOptions } from "../../core/types/agent-backend.js";
import { getApiBase } from "../utils/api.js";

export function enabledBackendsPath(preferred?: AgentBackendType) {
  return "/api/backends?scope=enabled" + (preferred ? `&preferred=${encodeURIComponent(preferred)}` : "");
}
export const savedBackendPath = (type?: string) => `/api/backends?type=${encodeURIComponent(type ?? "default")}`;

export async function readBackendOptions(path: string, signal = AbortSignal.timeout(30_000)): Promise<BackendOptions> {
  const response = await fetch(getApiBase() + path, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json() as BackendOptions;
  if (!Array.isArray(result?.backends)) throw new Error("Invalid backend availability response");
  return result;
}

export function newSessionBackend(result: BackendOptions, preferred?: AgentBackendType) {
  const enabled = result.backends.filter(b => !b.disabled);
  const available = enabled.filter(b => b.implemented && b.available === true);
  return enabled.find(b => b.type === preferred)
    ?? available.find(b => b.type === result.defaultBackendType)
    ?? available[0]
    ?? enabled.find(b => b.type === result.defaultBackendType)
    ?? enabled[0];
}

export async function verifySavedBackend(type: string | undefined, unavailable: string) {
  const result = await readBackendOptions(savedBackendPath(type));
  const choice = result.backends.find(b => b.type === (type ?? result.defaultBackendType));
  if (!choice?.implemented || choice.available !== true) throw new Error(choice?.reason || unavailable);
}

/** Only mounted consumers recheck on focus. A focus/visibility pair shares its request. */
export function useBackendOptions(path: string | null) {
  const [read, setRead] = useState<{ path: string; result?: BackendOptions; failed?: boolean; checking?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) {
      setRead(null);
      return;
    }
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      setRead(previous => previous?.result ? { ...previous, checking: true } : null);
      try {
        const result = await readBackendOptions(path, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
        if (!controller.signal.aborted) setRead({ path, result });
      } catch {
        if (!controller.signal.aborted) setRead({ path, failed: true });
      } finally {
        pending = false;
      }
    };
    const onReturn = () => { if (document.visibilityState === "visible") void refresh(); };
    const invalidate = () => {
      setRead(null);
      setAttempt(value => value + 1);
    };
    void refresh();
    window.addEventListener("pneuma:backend-preferences-changed", invalidate);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      controller.abort();
      window.removeEventListener("pneuma:backend-preferences-changed", invalidate);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [path, attempt]);

  const current = read?.path === path ? read : null;
  const result = current?.checking ? undefined : current?.result;
  return {
    result,
    failed: current?.failed === true,
    previous: read?.result,
    previousPath: read?.path,
    retry: () => { setRead(null); setAttempt(value => value + 1); },
  };
}

export function useBackendPicker(active: boolean, preferred?: AgentBackendType, locked?: AgentBackendType) {
  const { t } = useTranslation("launcher");
  const path = active ? (locked ? savedBackendPath(locked) : enabledBackendsPath(preferred)) : null;
  const { result, failed, previous, previousPath, retry } = useBackendOptions(path);
  // Keep the buttons visible while verifying a new selection. Only a response
  // for the current selection can enable Launch.
  const options = result?.backends ?? (active && !locked && previousPath?.startsWith(enabledBackendsPath()) ? previous?.backends : undefined);
  const choice = result && (locked
    ? result.backends.find(b => b.type === locked)
    : newSessionBackend(result, preferred));
  const error = failed ? t("startup.backends_failed")
    : !result ? t("startup.backends_loading")
    : !choice?.implemented || choice.available !== true ? choice?.reason || t("launch_dialog.agent_unavailable")
    : undefined;
  return {
    options: options?.filter(b => !b.disabled || b.type === locked) ?? [],
    choice, error, pending: !result && !failed, retry,
  };
}
