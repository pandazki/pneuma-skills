import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pneumaDesktop", {
  getVersion: () => ipcRenderer.invoke("pneuma:get-app-version"),
  getPlatform: () => ipcRenderer.invoke("pneuma:get-platform"),
  openExternal: (url: string) => ipcRenderer.invoke("pneuma:open-external", url),
  recheckClaude: () => ipcRenderer.invoke("pneuma:recheck-claude"),
  showOpenDialog: (options: { title?: string; defaultPath?: string; buttonLabel?: string }) =>
    ipcRenderer.invoke("pneuma:show-open-dialog", options),
  closeModeWindow: (url: string) => ipcRenderer.invoke("pneuma:close-mode-window", url),
  setEditing: (editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) =>
    ipcRenderer.invoke("pneuma:set-editing", editing, opts),
  invoke: (capability: string, method: string, ...args: unknown[]) =>
    ipcRenderer.invoke("pneuma:native", capability, method, ...args),
  capabilities: () => ipcRenderer.invoke("pneuma:native:capabilities"),
});

// ── Log bridge ───────────────────────────────────────────────────────────────
// Exposes the centralized log stream to any renderer. The log-viewer window
// consumes { tail, onAppend, currentFile, reveal, open }; every other window
// uses the auto-forwarding side effect below to sink its console output.

contextBridge.exposeInMainWorld("pneumaLogs", {
  tail: (n?: number) => ipcRenderer.invoke("pneuma:log:tail", n),
  currentFile: () => ipcRenderer.invoke("pneuma:log:current-file"),
  reveal: () => ipcRenderer.invoke("pneuma:log:reveal"),
  open: () => ipcRenderer.invoke("pneuma:log:open"),
  write: (level: string, source: string, msg: string) =>
    ipcRenderer.send("pneuma:log:write", level, source, msg),
  onAppend: (cb: (entry: { ts: number; level: string; source: string; msg: string }) => void) => {
    const handler = (_: unknown, entry: any) => cb(entry);
    ipcRenderer.on("log:append", handler);
    return () => ipcRenderer.off("log:append", handler);
  },
});

// ── Auto-forward renderer console + errors to main log sink ──────────────────
// Patched at preload time so every window (launcher, mode sessions, setup
// wizard) reports its console output and unhandled errors to the same place
// the main process logs land. Originals are preserved so DevTools still works.

const rendererSource = (() => {
  try {
    const url = typeof location !== "undefined" ? location.href : "unknown";
    const port = url.match(/:(\d+)/)?.[1] || "?";
    const pathSlug = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/^\//, "") || "/";
    return `renderer:${port}/${pathSlug}`.slice(0, 80);
  } catch {
    return "renderer";
  }
})();

function fmtArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(" ");
}

function forward(level: string, args: unknown[]) {
  try {
    ipcRenderer.send("pneuma:log:write", level, rendererSource, fmtArgs(args));
  } catch {}
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);
const origInfo = console.info.bind(console);

console.log = (...args: unknown[]) => { origLog(...args); forward("info", args); };
console.info = (...args: unknown[]) => { origInfo(...args); forward("info", args); };
console.warn = (...args: unknown[]) => { origWarn(...args); forward("warn", args); };
console.error = (...args: unknown[]) => { origError(...args); forward("error", args); };

window.addEventListener("error", (event) => {
  forward("error", [`uncaught: ${event.message}`, event.error?.stack || ""]);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  forward("error", [`unhandledRejection: ${msg}`]);
});
