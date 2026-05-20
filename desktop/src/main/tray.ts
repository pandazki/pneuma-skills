import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { getLauncherUrl } from "./bun-process.js";
import { showLogWindow } from "./log-window.js";

let tray: Tray | null = null;

export interface BackgroundSessionView {
  /** Stable id used to reveal this session (see onRevealBackgroundSession). */
  id: string;
  /** Human label, e.g. "webcraft · make a finance dashboard". */
  label: string;
  status: "running" | "done";
}

interface TrayCallbacks {
  onShowLauncher: () => void;
  onFocusSession: (pid: number, url?: string) => void;
  onCheckUpdates: () => void;
  onQuit: () => void;
  onRevealBackgroundSession: (id: string) => void;
}

let callbacks: TrayCallbacks;

let bgSessions: BackgroundSessionView[] = [];

// Animated "working" indicator for the tray title. A static glyph doesn't
// read as activity — a cycling braille spinner makes a background session
// visibly in-progress. The timer runs only while ≥1 session is working.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;
let spinnerTimer: NodeJS.Timeout | null = null;
let spinnerFrame = 0;

export function createTray(cbs: TrayCallbacks) {
  callbacks = cbs;

  // Use template image on macOS for automatic dark/light mode support
  const iconName =
    process.platform === "darwin"
      ? "tray-iconTemplate.png"
      : "tray-icon.png";

  let iconPath: string;
  if (app.isPackaged) {
    iconPath = path.join(process.resourcesPath, iconName);
  } else {
    iconPath = path.join(__dirname, "..", "..", "resources", iconName);
  }

  // Create a simple 22x22 icon if the file doesn't exist
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error("empty");
  } catch {
    // Fallback: create a simple orange dot icon
    icon = createFallbackIcon();
  }

  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("Pneuma Skills");

  // Both left-click and right-click show the menu
  tray.on("click", () => showTrayMenu());
  tray.on("right-click", () => showTrayMenu());
}

async function showTrayMenu() {
  if (!tray || !callbacks) return;
  const menu = await buildTrayMenu();
  tray.popUpContextMenu(menu);
}

async function fetchRunningSessions(): Promise<
  Array<{ pid: number; specifier: string; workspace: string; url: string }>
> {
  try {
    const launcherUrl = getLauncherUrl();
    if (!launcherUrl) return [];
    const origin = new URL(launcherUrl).origin;
    const res = await fetch(`${origin}/api/processes/children`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      processes: Array<{ pid: number; specifier: string; workspace: string; url: string }>;
    };
    return data.processes || [];
  } catch {
    return [];
  }
}

async function buildTrayMenu(): Promise<Electron.Menu> {
  const sessions = await fetchRunningSessions();

  const backgroundItems: Electron.MenuItemConstructorOptions[] =
    bgSessions.length > 0
      ? [
          { type: "separator" },
          { label: "Background Sessions", enabled: false },
          ...bgSessions.map((s) => ({
            label:
              s.status === "running"
                ? `${s.label} — working…`
                : `${s.label} — ready`,
            click: () => callbacks.onRevealBackgroundSession(s.id),
          })),
        ]
      : [];

  const sessionItems: Electron.MenuItemConstructorOptions[] =
    sessions.length > 0
      ? [
          { type: "separator" },
          { label: "Running Sessions", enabled: false },
          ...sessions.map((s) => ({
            label: `${s.specifier} — ${path.basename(s.workspace)}`,
            click: () => callbacks.onFocusSession(s.pid, s.url),
          })),
        ]
      : [];

  return Menu.buildFromTemplate([
    {
      label: "Open Launcher",
      click: () => callbacks.onShowLauncher(),
    },
    ...backgroundItems,
    ...sessionItems,
    { type: "separator" },
    {
      label: "Show Logs…",
      click: () => showLogWindow(),
    },
    {
      label: "Check for Updates…",
      click: () => callbacks.onCheckUpdates(),
    },
    { type: "separator" },
    {
      label: "Quit Pneuma Skills",
      click: () => callbacks.onQuit(),
    },
  ]);
}

export function updateTrayMenu() {
  // No-op — menu is built on demand when clicked
}

export function setBackgroundSessions(sessions: BackgroundSessionView[]): void {
  bgSessions = sessions;
  renderTrayStatus();
}

/**
 * Reflects background-session activity onto the tray title + tooltip. While
 * any session is working the title runs an animated spinner; otherwise it
 * shows a static ✓ (ready to view) or clears. Only invoked by
 * setBackgroundSessions — the raw setTrayTitle/setTrayTooltip remain
 * available for the auto-updater's download-progress display.
 */
function renderTrayStatus(): void {
  if (!tray) return;
  const running = bgSessions.filter((s) => s.status === "running").length;
  const done = bgSessions.filter((s) => s.status === "done").length;

  if (running > 0) {
    tray.setToolTip(
      `Pneuma Skills — ${running} session${running > 1 ? "s" : ""} working…`,
    );
    startSpinner();
  } else {
    stopSpinner();
    if (done > 0) {
      tray.setTitle("✓");
      tray.setToolTip(
        `Pneuma Skills — ${done} session${done > 1 ? "s" : ""} ready to view`,
      );
    } else {
      tray.setTitle("");
      tray.setToolTip("Pneuma Skills");
    }
  }
}

/** Begin animating the tray title; no-op if the spinner is already running. */
function startSpinner(): void {
  if (spinnerTimer) return;
  // Paint the first frame at once so there's no blank gap before the first tick.
  if (tray) tray.setTitle(SPINNER_FRAMES[spinnerFrame]);
  spinnerTimer = setInterval(() => {
    if (!tray) return;
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    tray.setTitle(SPINNER_FRAMES[spinnerFrame]);
  }, SPINNER_INTERVAL_MS);
}

/** Stop the title animation and reset to the first frame. */
function stopSpinner(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
  spinnerFrame = 0;
}

export function setTrayTitle(title: string) {
  if (tray) tray.setTitle(title);
}

export function setTrayTooltip(tooltip: string) {
  if (tray) tray.setToolTip(tooltip);
}

function createFallbackIcon(): Electron.NativeImage {
  const size = 22;
  const canvas = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = size / 2;
      const cy = size / 2;
      const r = 7;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist < r) {
        canvas[idx] = 249;
        canvas[idx + 1] = 115;
        canvas[idx + 2] = 22;
        canvas[idx + 3] = 255;
      } else if (dist < r + 1) {
        const alpha = Math.max(0, Math.round(255 * (1 - (dist - r))));
        canvas[idx] = 249;
        canvas[idx + 1] = 115;
        canvas[idx + 2] = 22;
        canvas[idx + 3] = alpha;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
    scaleFactor: 1,
  });
}
