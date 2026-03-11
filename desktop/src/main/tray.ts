import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";
import { getLauncherUrl } from "./bun-process.js";

let tray: Tray | null = null;

interface TrayCallbacks {
  onShowLauncher: () => void;
  onFocusSession: (pid: number, url?: string) => void;
  onCheckUpdates: () => void;
  onQuit: () => void;
}

let callbacks: TrayCallbacks;

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
    ...sessionItems,
    { type: "separator" },
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
