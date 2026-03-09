import { Tray, Menu, nativeImage, app } from "electron";
import path from "node:path";

let tray: Tray | null = null;

interface TrayCallbacks {
  onShowLauncher: () => void;
  onGetSessions: () => Array<{
    pid: number;
    specifier: string;
    workspace: string;
    url: string;
  }>;
  onFocusSession: (pid: number) => void;
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

  if (process.platform === "darwin") {
    // macOS: left-click opens launcher, right-click shows menu.
    // Don't use setContextMenu — it hijacks left-click too.
    tray.on("click", () => {
      callbacks.onShowLauncher();
    });
    tray.on("right-click", () => {
      tray?.popUpContextMenu(buildTrayMenu());
    });
  } else {
    // Windows/Linux: left-click opens launcher, right-click shows context menu
    tray.on("click", () => {
      callbacks.onShowLauncher();
    });
    updateTrayMenu();
  }
}

function buildTrayMenu(): Electron.Menu {
  const sessions = callbacks.onGetSessions();

  const sessionItems: Electron.MenuItemConstructorOptions[] =
    sessions.length > 0
      ? [
          { type: "separator" },
          { label: "Running Sessions", enabled: false },
          ...sessions.map((s) => ({
            label: `${s.specifier} — ${path.basename(s.workspace)}`,
            click: () => callbacks.onFocusSession(s.pid),
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
  if (!tray || !callbacks) return;
  // On macOS we use popUpContextMenu on right-click, no need to set it
  if (process.platform !== "darwin") {
    tray.setContextMenu(buildTrayMenu());
  }
}

function createFallbackIcon(): Electron.NativeImage {
  // Create a simple 22x22 PNG with an orange circle
  // This is a minimal valid PNG
  const size = 22;
  const canvas = Buffer.alloc(size * size * 4); // RGBA

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = size / 2;
      const cy = size / 2;
      const r = 7;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist < r) {
        // Orange: #f97316
        canvas[idx] = 249;     // R
        canvas[idx + 1] = 115; // G
        canvas[idx + 2] = 22;  // B
        canvas[idx + 3] = 255; // A
      } else if (dist < r + 1) {
        // Anti-aliased edge
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
