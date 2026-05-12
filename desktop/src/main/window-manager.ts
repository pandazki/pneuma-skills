import { BrowserWindow, shell, screen } from "electron";
import path from "node:path";
import { getLauncherUrl } from "./bun-process.js";

let launcherWindow: BrowserWindow | null = null;
const modeWindows: Set<BrowserWindow> = new Set();

// Track URL → window for reuse, and window → URL for cleanup
const urlToWindow = new Map<string, BrowserWindow>();

const PRELOAD_PATH = path.join(__dirname, "..", "preload", "index.js");

// ── Launcher Window ──────────────────────────────────────────────────────────

export function createLauncherWindow(url: string): BrowserWindow {
  // Singleton: if already exists, focus it
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.focus();
    return launcherWindow;
  }

  // Use 80% of screen size for a generous default
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(Math.round(screenW * 0.8), 1600);
  const height = Math.min(Math.round(screenH * 0.8), 1000);

  launcherWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#09090b",
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Smooth show after content loads
  launcherWindow.once("ready-to-show", () => {
    launcherWindow?.show();
  });

  launcherWindow.loadURL(url);

  // External links → system browser
  launcherWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl !== url && !navUrl.startsWith("http://localhost:") && !navUrl.startsWith("http://127.0.0.1:")) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  launcherWindow.on("closed", () => {
    launcherWindow = null;
  });

  return launcherWindow;
}

export function getLauncherWindow(): BrowserWindow | null {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow;
  return null;
}

// ── Mode Session Windows ─────────────────────────────────────────────────────

// Debounce to prevent rapid double-opens
let lastOpenUrl = "";
let lastOpenTime = 0;

export function createModeWindow(
  url: string,
  options?: { pid?: number; title?: string }
): BrowserWindow {
  // Debounce: ignore same URL within 2s
  const now = Date.now();
  if (url === lastOpenUrl && now - lastOpenTime < 2000) {
    const existing = urlToWindow.get(url);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }
  }
  lastOpenUrl = url;
  lastOpenTime = now;

  // Reuse existing window for the exact same URL (same session)
  const existingWin = urlToWindow.get(url);
  if (existingWin && !existingWin.isDestroyed()) {
    if (existingWin.isMinimized()) existingWin.restore();
    existingWin.focus();
    return existingWin;
  }

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Store PID and URL references
  if (options?.pid) {
    (win as any).__pid = options.pid;
  }
  (win as any).__url = url;
  urlToWindow.set(url, win);

  // Every URL this window navigates to. A project shell window bounces
  // through `?project=…` → `?session=onboard` → `?session=webcraft` (handoff);
  // each session server is a separate process the launcher can't reliably tear
  // down on its own (the handoff target is spawned by *another* session server
  // and may end up reparented to init). On close we kill all of them.
  const visitedUrls = new Set<string>([url]);

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.loadURL(url);

  // Intercept child window.open (mode pages might open sub-windows)
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (openUrl.startsWith("http://localhost:") || openUrl.startsWith("http://127.0.0.1:")) {
      // Export/utility pages served by the same session server should open
      // in a lightweight window WITHOUT the kill-on-close behavior.
      const urlPath = new URL(openUrl).pathname;
      if (urlPath.startsWith("/export/")) {
        openExportWindow(openUrl);
      } else {
        createModeWindow(openUrl);
      }
      return { action: "deny" };
    }
    shell.openExternal(openUrl);
    return { action: "deny" };
  });

  // External links → system browser
  win.webContents.on("will-navigate", (event, navUrl) => {
    if (!navUrl.startsWith("http://localhost:") && !navUrl.startsWith("http://127.0.0.1:")) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  // Track in-app navigations (the project shell → session, handoff → next
  // session) so close-on-window tears down whatever session(s) this window
  // ended up hosting — and keep `__url` / `urlToWindow` pointing at the
  // current page.
  win.webContents.on("did-navigate", (_event, navUrl) => {
    if (!navUrl.startsWith("http://localhost:") && !navUrl.startsWith("http://127.0.0.1:")) return;
    visitedUrls.add(navUrl);
    const prev = (win as any).__url as string | undefined;
    if (prev && prev !== navUrl) urlToWindow.delete(prev);
    (win as any).__url = navUrl;
    urlToWindow.set(navUrl, win);
  });

  modeWindows.add(win);
  win.on("closed", () => {
    modeWindows.delete(win);
    const winUrl = (win as any).__url as string | undefined;
    if (winUrl) urlToWindow.delete(winUrl);

    // Tear down every session server this window hosted.
    void killSessionsByUrls(visitedUrls);
  });

  return win;
}

/**
 * When a mode window closes, kill the session process(es) it hosted by asking
 * the launcher server. Sessions are matched by port (each session server has
 * its own). Queries the system-wide running registry first so sessions
 * spawned by *other* servers (handoff targets) are covered; falls back to the
 * launcher's own children. The kill endpoint escalates SIGTERM→SIGKILL, so a
 * wedged session still goes down.
 */
async function killSessionsByUrls(urls: Iterable<string>) {
  const ports = new Set<string>();
  for (const u of urls) {
    try { const p = new URL(u).port; if (p) ports.add(p); } catch {}
  }
  if (ports.size === 0) return;
  try {
    const launcherUrl = getLauncherUrl();
    if (!launcherUrl) return;
    const launcherOrigin = new URL(launcherUrl).origin;

    let procs: Array<{ pid: number; url: string }> = [];
    try {
      const r = await fetch(`${launcherOrigin}/api/running`);
      if (r.ok) procs = (await r.json() as { processes?: Array<{ pid: number; url: string }> }).processes ?? [];
    } catch {}
    if (procs.length === 0) {
      try {
        const r = await fetch(`${launcherOrigin}/api/processes/children`);
        if (r.ok) procs = (await r.json() as { processes?: Array<{ pid: number; url: string }> }).processes ?? [];
      } catch {}
    }

    for (const proc of procs) {
      let procPort = "";
      try { procPort = new URL(proc.url).port; } catch {}
      if (procPort && ports.has(procPort)) {
        try { await fetch(`${launcherOrigin}/api/processes/children/${proc.pid}/kill`, { method: "POST" }); } catch {}
      }
    }
  } catch (err) {
    console.error("[window-manager] Failed to kill session(s):", err);
  }
}

/**
 * Open an export/utility page in a lightweight window that does NOT
 * kill the session process when closed.
 */
function openExportWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.loadURL(url);

  // External links → system browser
  win.webContents.on("will-navigate", (event, navUrl) => {
    if (!navUrl.startsWith("http://localhost:") && !navUrl.startsWith("http://127.0.0.1:")) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  return win;
}

export function getAllModeWindows(): BrowserWindow[] {
  return Array.from(modeWindows).filter((w) => !w.isDestroyed());
}

export function focusModeWindowByPid(pid: number): boolean {
  for (const win of modeWindows) {
    if (!win.isDestroyed() && (win as any).__pid === pid) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return true;
    }
  }
  return false;
}

export function closeModeWindowByUrl(url: string): void {
  try {
    const targetPort = new URL(url).port;
    for (const win of modeWindows) {
      if (win.isDestroyed()) continue;
      const winUrl = (win as any).__url as string | undefined;
      if (winUrl && new URL(winUrl).port === targetPort) {
        win.close();
      }
    }
  } catch {}
}
