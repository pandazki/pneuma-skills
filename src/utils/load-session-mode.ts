import { loadMode, registerExternalMode } from "../../core/mode-loader.js";
import type { ModeInfo } from "../../core/types/mode-viewer.js";
import { getApiBase } from "./api.js";

async function readModeInfo(signal: AbortSignal): Promise<ModeInfo> {
  const res = await fetch(`${getApiBase()}/api/mode-info`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load mode information (HTTP ${res.status}).`);
  return res.json();
}

function waitForBuild(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 500);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function loadStylesheets(urls: string[], signal: AbortSignal) {
  await Promise.all(urls.map((url) => new Promise<void>((resolve, reject) => {
    const href = new URL(`${getApiBase()}${url}`, location.href).href;
    const existing = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .find((link) => link.href === href);
    if (existing?.sheet) { resolve(); return; }
    existing?.remove();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = () => { cleanup(); link.remove(); reject(new Error(`Could not load viewer styles: ${url}`)); };
    const abort = () => { cleanup(); link.remove(); reject(signal.reason); };
    const timer = setTimeout(fail, 30_000);
    link.onload = () => { cleanup(); resolve(); };
    link.onerror = fail;
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    document.head.appendChild(link);
  })));
}

/** Load/recover only the viewer. Session connection and conversation stay mounted. */
export async function loadSessionMode(modeName: string, options: { retry: boolean; signal: AbortSignal }) {
  const { signal } = options;
  let info = await readModeInfo(signal);
  if (info.external && info.name === modeName) {
    if (options.retry && info.viewerBuild) {
      const res = await fetch(`${getApiBase()}/api/mode-viewer/retry`, { method: "POST", signal });
      if (!res.ok) throw new Error(`Could not retry the viewer build (HTTP ${res.status}).`);
      info = await readModeInfo(signal);
    }
    while (info.external && info.viewerBuild?.status === "building") {
      await waitForBuild(signal);
      info = await readModeInfo(signal);
    }
    if (!info.external || info.name !== modeName) throw new Error("The session mode changed while its viewer was loading.");
    if (info.viewerBuild?.status === "failed") throw new Error(info.viewerBuild.error);
    if (info.viewerBuild?.status === "ready") await loadStylesheets(info.viewerBuild.stylesheets, signal);
    signal.throwIfAborted();
    registerExternalMode(info.name, info.path, crypto.randomUUID());
  }
  const def = await loadMode(modeName);
  signal.throwIfAborted();
  return def;
}
