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

  // Mode windows open maximized for a full-app experience
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  win.loadURL(url);

  // Intercept child window.open (mode pages might open sub-windows)
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (openUrl.startsWith("http://localhost:") || openUrl.startsWith("http://127.0.0.1:")) {
      createModeWindow(openUrl);
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

  modeWindows.add(win);
  win.on("closed", () => {
    modeWindows.delete(win);
    const winUrl = (win as any).__url as string | undefined;
    if (winUrl) urlToWindow.delete(winUrl);

    // Kill the session process via launcher API
    killSessionByUrl(winUrl);
  });

  return win;
}

/**
 * When a mode window is closed, kill the corresponding session process
 * by calling the launcher server's API.
 */
async function killSessionByUrl(url?: string) {
  if (!url) return;
  try {
    const launcherUrl = getLauncherUrl();
    if (!launcherUrl) return;
    const launcherOrigin = new URL(launcherUrl).origin;

    const res = await fetch(`${launcherOrigin}/api/processes/children`);
    if (!res.ok) return;
    const data = await res.json() as { processes: Array<{ pid: number; url: string }> };

    // Match by port (each session server has a unique port)
    const targetPort = new URL(url).port;
    for (const proc of data.processes) {
      try {
        if (new URL(proc.url).port === targetPort) {
          await fetch(`${launcherOrigin}/api/processes/children/${proc.pid}/kill`, {
            method: "POST",
          });
          break;
        }
      } catch {}
    }
  } catch (err) {
    console.error("[window-manager] Failed to kill session:", err);
  }
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
