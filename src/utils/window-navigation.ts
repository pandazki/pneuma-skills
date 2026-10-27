import type { AppWindowRequest, DesktopWindowBridge } from "../../core/types/desktop-window.js";

declare global {
  interface Window {
    pneumaDesktop?: DesktopWindowBridge;
  }
}

export async function openAppWindow(request: AppWindowRequest): Promise<void> {
  const resolved = { ...request, url: new URL(request.url, window.location.href).href };
  if (window.pneumaDesktop) {
    await window.pneumaDesktop.openAppWindow(resolved);
    return;
  }
  window.open(resolved.url, "_blank", "noopener,noreferrer");
}
