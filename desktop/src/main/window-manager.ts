import { BrowserWindow, shell, screen } from "electron";
import path from "node:path";

let launcherWindow: BrowserWindow | null = null;
const modeWindows: Set<BrowserWindow> = new Set();

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

export function createModeWindow(
  url: string,
  options?: { pid?: number; title?: string }
): BrowserWindow {
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

  // Store PID reference for tray menu
  if (options?.pid) {
    (win as any).__pid = options.pid;
  }

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
