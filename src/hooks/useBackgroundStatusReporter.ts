/**
 * useBackgroundStatusReporter — relays this session's turn status to the
 * Electron main process so a hidden background window can drive tray status
 * and fire a completion notification when the agent finishes.
 *
 * One-way renderer → main over `window.pneumaDesktop.reportSessionStatus`.
 * Self-gates on the bridge: in the browser (web / non-Electron) the API is
 * undefined and the hook no-ops, so it is safe to call unconditionally.
 */

import { useEffect } from "react";
import { useStore } from "../store.js";

// The preload bridge is not statically typed (accessed via inline casts
// elsewhere too — see native-bridge.ts / viewer-capture.ts), so reach for it
// through a narrow cast that keeps this hook compiling under TS strict.
type DesktopBridge = {
  reportSessionStatus?: (status: "running" | "idle") => void;
};

export function useBackgroundStatusReporter(): void {
  const sessionStatus = useStore((s) => s.sessionStatus);
  const turnInProgress = useStore((s) => s.turnInProgress);

  // "compacting" still counts as busy — the agent is working, just not on a turn.
  const busy =
    turnInProgress || sessionStatus === "running" || sessionStatus === "compacting";

  useEffect(() => {
    const desktop = (window as unknown as { pneumaDesktop?: DesktopBridge })
      .pneumaDesktop;
    desktop?.reportSessionStatus?.(busy ? "running" : "idle");
  }, [busy]);
}
