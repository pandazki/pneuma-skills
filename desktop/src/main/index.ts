import { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme } from "electron";
import { autoUpdater } from "electron-updater";
import { net } from "electron";
import path from "node:path";
import { createTray, updateTrayMenu, setTrayTitle, setTrayTooltip } from "./tray.js";
import {
  createLauncherWindow,
  createModeWindow,
  getLauncherWindow,
  getAllModeWindows,
} from "./window-manager.js";
import {
  spawnLauncherProcess,
  killAllProcesses,
  getLauncherUrl,
} from "./bun-process.js";
import { detectClaude, getClaudeInstallInstructions } from "./claude-detector.js";
import { registerIpcHandlers } from "./ipc-handlers.js";

// ── App name (fixes "Electron" in macOS menu bar) ────────────────────────────
app.setName("Pneuma Skills");

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Custom protocol handler (pneuma://) ──────────────────────────────────────
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pneuma', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('pneuma');
}

// Keep reference to prevent GC
let setupWindow: BrowserWindow | null = null;

app.on("second-instance", (_event, argv) => {
  // Check for pneuma:// URL in args (Windows/Linux deep link)
  const url = argv.find(arg => arg.startsWith('pneuma://'));
  if (url) {
    handlePneumaUrl(url);
    return;
  }

  // Default: focus launcher
  const launcher = getLauncherWindow();
  if (launcher) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.focus();
  } else {
    showLauncher();
  }
});

// macOS: dock icon is shown by default, hidden when all windows close

// ── URL scheme handler ────────────────────────────────────────────────────────
let pendingPneumaUrl: string | null = null;

function handlePneumaUrl(url: string) {
  try {
    const parsed = new URL(url);
    switch (parsed.hostname) {
      case 'open': {
        showLauncher();
        break;
      }
      case 'import': {
        // pneuma://import/{encodedUrl} — share URL is encodeURIComponent'd
        const shareUrl = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
        if (shareUrl) {
          showLauncherWithImport(shareUrl);
        } else {
          showLauncher();
        }
        break;
      }
      default:
        showLauncher();
    }
  } catch {
    showLauncher();
  }
}

async function showLauncherWithImport(shareUrl: string) {
  const launcherUrl = getLauncherUrl();
  if (!launcherUrl) {
    console.error("Launcher process not ready");
    return;
  }

  if (process.platform === "darwin") {
    await app.dock?.show();
  }

  const urlWithImport = `${launcherUrl}?importUrl=${encodeURIComponent(shareUrl)}`;
  const existing = getLauncherWindow();

  if (existing) {
    // Launcher already open — navigate to the import URL instead of just focusing
    existing.loadURL(urlWithImport);
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  } else {
    const win = createLauncherWindow(urlWithImport);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
        createModeWindow(url);
        return { action: "deny" };
      }
      shell.openExternal(url);
      return { action: "deny" };
    });
  }
}

// macOS: open-url fires before app.whenReady() on cold launch
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handlePneumaUrl(url);
  } else {
    pendingPneumaUrl = url;
  }
});

async function showLauncher() {
  if (process.platform === "darwin") {
    await app.dock?.show();
  }

  const launcherUrl = getLauncherUrl();
  if (!launcherUrl) {
    console.error("Launcher process not ready");
    return;
  }

  const win = createLauncherWindow(launcherUrl);

  // Intercept window.open() from launcher to create mode windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
      createModeWindow(url);
      return { action: "deny" };
    }
    // External URLs → system browser
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    // Dock stays visible — managed by window-all-closed handler
  });
}

function showSetupWizard() {
  if (process.platform === "darwin") {
    app.dock?.show();
  }

  setupWindow = new BrowserWindow({
    width: 720,
    height: 600,
    resizable: false,
    maximizable: false,
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const instructions = getClaudeInstallInstructions();
  const setupHtml = generateSetupHtml(instructions);
  setupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(setupHtml)}`);

  setupWindow.on("closed", () => {
    setupWindow = null;
  });
}

app.whenReady().then(async () => {
  // macOS application menu (replaces "Electron" in menu bar)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            {
              label: `About ${app.name}`,
              click: async () => {
                const { response } = await dialog.showMessageBox({
                  type: "info",
                  title: `About ${app.name}`,
                  message: app.name,
                  detail: `Version ${app.getVersion()}\n\nCo-creation infrastructure for humans and code agents.\n\nhttps://github.com/pandazki/pneuma-skills`,
                  buttons: ["OK", "GitHub"],
                  defaultId: 0,
                });
                if (response === 1) {
                  shell.openExternal("https://github.com/pandazki/pneuma-skills");
                }
              },
            },
            { type: "separator" },
            {
              label: "Check for Updates…",
              click: () => checkForUpdatesManual(),
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
      ])
    );
  }

  registerIpcHandlers();

  if (process.platform === "darwin") {
    await app.dock?.show();
  }

  // Show splash screen while loading
  const splash = createSplashWindow();

  // Start the launcher Bun process first
  try {
    await spawnLauncherProcess();
  } catch (err) {
    console.error("Failed to start launcher process:", err);
    splash.destroy();
    app.quit();
    return;
  }

  // Detect Claude CLI
  const claude = await detectClaude();

  // Create tray
  createTray({
    onShowLauncher: showLauncher,
    onFocusSession: async (_pid: number, url?: string) => {
      if (process.platform === "darwin") {
        await app.dock?.show();
      }
      app.focus({ steal: true });

      if (url) {
        // Match by port (each session has a unique port)
        try {
          const targetPort = new URL(url).port;
          const windows = getAllModeWindows();
          for (const w of windows) {
            if (w.isDestroyed()) continue;
            const winUrl = (w as any).__url as string | undefined;
            if (winUrl && new URL(winUrl).port === targetPort) {
              if (w.isMinimized()) w.restore();
              w.show();
              w.focus();
              return;
            }
          }
        } catch {}
      }

      // Fallback: focus first mode window
      const windows = getAllModeWindows();
      if (windows.length > 0) {
        const w = windows[0];
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
    },
    onCheckUpdates: () => checkForUpdatesManual(),
    onQuit: () => app.quit(),
  });

  // Show the real window BEFORE destroying splash to avoid
  // window-all-closed → dock.hide() race condition
  if (!claude.found) {
    showSetupWizard();
  } else {
    showLauncher();
  }

  // Destroy splash after the new window exists
  splash.destroy();

  // Process any URL that arrived before app was ready (macOS cold launch)
  if (pendingPneumaUrl) {
    handlePneumaUrl(pendingPneumaUrl);
    pendingPneumaUrl = null;
  }

  // Auto-update: silent check on startup (skip if platform asset not yet uploaded)
  setupAutoUpdater();
  isPlatformAssetReady().then((ready) => {
    if (ready) autoUpdater.checkForUpdates().catch(() => {});
  });
});

// Stay alive in tray when all windows close
app.on("window-all-closed", () => {
  // Don't quit — stay in tray. Dock stays visible.
});

app.on("activate", () => {
  // macOS dock click
  if (!getLauncherWindow()) {
    showLauncher();
  }
});

app.on("before-quit", () => {
  killAllProcesses();
});

// IPC: re-check Claude CLI from setup wizard
ipcMain.handle("pneuma:recheck-claude", async () => {
  const result = await detectClaude();
  if (result.found && setupWindow) {
    setupWindow.close();
    showLauncher();
  }
  return result;
});

// ── Splash screen ───────────────────────────────────────────────────────────

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 280,
    height: 280,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    backgroundColor: "#09090b",
    roundedCorners: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; background: #09090b; -webkit-app-region: drag;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .logo {
    width: 64px; height: 64px; border-radius: 16px;
    animation: breathe 2s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { filter: brightness(1); transform: scale(1); }
    50% { filter: brightness(1.1); transform: scale(1.03); }
  }
  .text {
    margin-top: 20px;
    color: #a1a1aa; font-size: 13px; font-weight: 500; letter-spacing: 0.02em;
  }
  .dots { display: inline-flex; gap: 4px; margin-left: 4px; }
  .dots span {
    width: 3px; height: 3px; border-radius: 50%; background: #f97316;
    animation: dot 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes dot {
    0%, 60%, 100% { opacity: 0.3; transform: scale(1); }
    30% { opacity: 1; transform: scale(1.3); }
  }
</style></head>
<body>
  <img class="logo" src="data:image/png;base64,${getSplashLogoBase64()}" />
  <div class="text">Loading<span class="dots"><span></span><span></span><span></span></span></div>
</body></html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}

function getSplashLogoBase64(): string {
  try {
    const logoPath = app.isPackaged
      ? path.join(process.resourcesPath, "pneuma", "dist", "logo.png")
      : path.join(__dirname, "..", "..", "..", "public", "logo.png");
    const fs = require("node:fs");
    return fs.readFileSync(logoPath).toString("base64");
  } catch {
    return ""; // Fallback: empty image
  }
}

// ── Auto-updater with dialog UI ──────────────────────────────────────────────

let isCheckingForUpdates = false;

/**
 * Show a dialog attached to a visible window to avoid macOS app-modal freeze.
 * On macOS, dialog.showMessageBox() without a parent window creates an
 * app-modal dialog that freezes the entire process when no window is focused.
 * As a last resort we create a tiny off-screen window as the dialog parent.
 */
function showUpdateDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const launcher = getLauncherWindow();
  if (launcher && !launcher.isDestroyed()) {
    if (!launcher.isVisible()) launcher.show();
    return dialog.showMessageBox(launcher, options);
  }
  // Fallback: find any visible window
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible());
  if (win) return dialog.showMessageBox(win, options);

  // Last resort: create a temporary hidden window as dialog parent to prevent
  // macOS app-modal freeze when no windows exist
  const tmp = new BrowserWindow({ width: 1, height: 1, show: false, skipTaskbar: true });
  return dialog.showMessageBox(tmp, options).finally(() => {
    if (!tmp.isDestroyed()) tmp.destroy();
  });
}

function setupAutoUpdater() {
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    const currentVersion = app.getVersion();
    showUpdateDialog({
      type: "info",
      title: "Update Available",
      message: `New version available: v${info.version}`,
      detail: `Current version: v${currentVersion}\n\nWould you like to download the update now?`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        // Keep isCheckingForUpdates true during download so errors are shown
        autoUpdater.downloadUpdate().catch((err) => {
          console.error("[auto-updater] Download failed:", err.message);
          showUpdateDialog({
            type: "error",
            title: "Download Failed",
            message: "Failed to download update",
            detail: err.message,
            buttons: ["OK"],
          });
          isCheckingForUpdates = false;
        });
      } else {
        isCheckingForUpdates = false;
      }
    });
  });

  autoUpdater.on("update-not-available", () => {
    if (isCheckingForUpdates) {
      showUpdateDialog({
        type: "info",
        title: "No Updates",
        message: "You're up to date!",
        detail: `Current version: v${app.getVersion()}`,
        buttons: ["OK"],
      });
      isCheckingForUpdates = false;
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    setTrayTitle(`↓ ${pct}%`);
    setTrayTooltip(`Pneuma Skills — Downloading update: ${pct}%`);
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    isCheckingForUpdates = false;
    setTrayTitle("");
    setTrayTooltip(`Pneuma Skills — Update v${info.version} ready`);
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setProgressBar(-1); // Remove progress bar
    }

    showUpdateDialog({
      type: "info",
      title: "Update Ready",
      message: `v${info.version} has been downloaded`,
      detail: "The update will be installed when you restart the app.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on("error", (err) => {
    setTrayTitle("");
    setTrayTooltip("Pneuma Skills");
    if (isCheckingForUpdates) {
      showUpdateDialog({
        type: "error",
        title: "Update Error",
        message: "Failed to check for updates",
        detail: err.message,
        buttons: ["OK"],
      });
      isCheckingForUpdates = false;
    } else {
      console.error("[auto-updater] Error:", err.message);
    }
  });
}

/**
 * Check if the platform-specific update metadata file exists on the latest release.
 * CI builds each platform artifact separately, so the release tag may exist
 * before the current platform's asset is uploaded (10+ min window).
 * Returns true if the asset is reachable, false otherwise.
 */
async function isPlatformAssetReady(): Promise<boolean> {
  const metaFile =
    process.platform === "darwin"
      ? "latest-mac.yml"
      : process.platform === "win32"
        ? "latest.yml"
        : "latest-linux.yml";
  const url = `https://github.com/pandazki/pneuma-skills/releases/latest/download/${metaFile}`;
  try {
    const resp = await net.fetch(url, { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

function checkForUpdatesManual() {
  isCheckingForUpdates = true;
  isPlatformAssetReady().then((ready) => {
    if (!ready) {
      showUpdateDialog({
        type: "info",
        title: "No Updates",
        message: "You're up to date!",
        detail: `Current version: v${app.getVersion()}\n\n(A new release may be building — check back in a few minutes.)`,
        buttons: ["OK"],
      });
      isCheckingForUpdates = false;
      return;
    }
    autoUpdater.checkForUpdates().catch((err) => {
      showUpdateDialog({
        type: "error",
        title: "Update Error",
        message: "Failed to check for updates",
        detail: err.message,
        buttons: ["OK"],
      });
      isCheckingForUpdates = false;
    });
  });
}

// ── Setup wizard HTML ──────────────────────────────────────────────────────

function generateSetupHtml(instructions: {
  title: string;
  steps: string[];
  links: { label: string; url: string }[];
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pneuma Skills — Setup</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #09090b;
    --surface: #18181b;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --primary: #f97316;
    --primary-hover: #fdba74;
    --border: rgba(255, 255, 255, 0.08);
    --glow: rgba(249, 115, 22, 0.15);
  }

  body {
    font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--fg);
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 40px;
    user-select: none;
    overflow: hidden;
  }

  .logo {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--primary), #ea580c);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    margin-bottom: 24px;
    box-shadow: 0 0 32px var(--glow), 0 8px 32px rgba(0,0,0,0.4);
    animation: breathe 4s ease-in-out infinite;
  }

  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 32px var(--glow), 0 8px 32px rgba(0,0,0,0.4); }
    50% { box-shadow: 0 0 48px rgba(249,115,22,0.25), 0 8px 32px rgba(0,0,0,0.4); }
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 32px;
    line-height: 1.5;
    text-align: center;
  }

  .steps {
    width: 100%;
    max-width: 400px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 32px;
  }

  .step {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.5;
  }

  .step-num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: rgba(249, 115, 22, 0.12);
    color: var(--primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }

  .step code {
    background: rgba(0,0,0,0.4);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    color: var(--primary-hover);
    user-select: text;
  }

  .links {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
  }

  .links a {
    color: var(--muted);
    font-size: 12px;
    text-decoration: none;
    transition: color 0.15s;
    cursor: pointer;
  }

  .links a:hover { color: var(--primary); }

  .check-btn {
    padding: 10px 28px;
    border: none;
    border-radius: 8px;
    background: var(--primary);
    color: #fff;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
    letter-spacing: -0.01em;
  }

  .check-btn:hover {
    background: #ea580c;
    transform: translateY(-1px);
    box-shadow: 0 4px 16px var(--glow);
  }

  .check-btn:active {
    transform: translateY(0);
  }

  .check-btn.checking {
    opacity: 0.7;
    pointer-events: none;
  }

  .status {
    margin-top: 12px;
    font-size: 12px;
    color: var(--muted);
    min-height: 18px;
  }

  .status.error { color: #f87171; }
  .status.success { color: #4ade80; }
</style>
</head>
<body>
  <div class="logo">⚡</div>
  <h1>${instructions.title}</h1>
  <p class="subtitle">Pneuma Skills requires the Claude Code CLI to connect with your AI agent.</p>

  <div class="steps">
    ${instructions.steps.map((step, i) => `
      <div class="step">
        <span class="step-num">${i + 1}</span>
        <span>${step}</span>
      </div>
    `).join("")}
  </div>

  <div class="links">
    ${instructions.links.map((l) => `<a onclick="window.pneumaDesktop?.openExternal('${l.url}')">${l.label}</a>`).join("")}
  </div>

  <button class="check-btn" onclick="recheckClaude()">Check Installation</button>
  <div class="status" id="status"></div>

  <script>
    async function recheckClaude() {
      const btn = document.querySelector('.check-btn');
      const status = document.getElementById('status');
      btn.classList.add('checking');
      btn.textContent = 'Checking…';
      status.textContent = '';
      status.className = 'status';

      try {
        const result = await window.pneumaDesktop.recheckClaude();
        if (result.found) {
          status.textContent = 'Claude CLI found! Starting Pneuma…';
          status.className = 'status success';
        } else {
          status.textContent = 'Claude CLI not found. Please install and try again.';
          status.className = 'status error';
          btn.classList.remove('checking');
          btn.textContent = 'Check Installation';
        }
      } catch {
        status.textContent = 'Check failed. Please try again.';
        status.className = 'status error';
        btn.classList.remove('checking');
        btn.textContent = 'Check Installation';
      }
    }
  </script>
</body>
</html>`;
}
