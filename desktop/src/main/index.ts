import { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme } from "electron";
import { autoUpdater } from "electron-updater";
import path from "node:path";
import { createTray, updateTrayMenu } from "./tray.js";
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
  getRunningSessionsForTray,
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

// Keep reference to prevent GC
let setupWindow: BrowserWindow | null = null;

app.on("second-instance", () => {
  const launcher = getLauncherWindow();
  if (launcher) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.focus();
  } else {
    showLauncher();
  }
});

// macOS: hide dock icon when no windows visible
if (process.platform === "darwin") {
  app.dock?.hide();
}

async function showLauncher() {
  if (process.platform === "darwin") {
    app.dock?.show();
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
    if (getAllModeWindows().length === 0 && process.platform === "darwin") {
      app.dock?.hide();
    }
  });
}

function showSetupWizard() {
  if (process.platform === "darwin") {
    app.dock?.show();
  }

  setupWindow = new BrowserWindow({
    width: 560,
    height: 480,
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

  // Start the launcher Bun process first
  try {
    await spawnLauncherProcess();
  } catch (err) {
    console.error("Failed to start launcher process:", err);
    app.quit();
    return;
  }

  // Detect Claude CLI
  const claude = await detectClaude();

  // Create tray
  createTray({
    onShowLauncher: showLauncher,
    onGetSessions: getRunningSessionsForTray,
    onFocusSession: (pid: number) => {
      const windows = getAllModeWindows();
      const win = windows.find((w) => (w as any).__pid === pid);
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    },
    onCheckUpdates: () => checkForUpdatesManual(),
    onQuit: () => app.quit(),
  });

  if (!claude.found) {
    showSetupWizard();
  } else {
    showLauncher();
  }

  // Auto-update: silent check on startup
  setupAutoUpdater();
  autoUpdater.checkForUpdates().catch(() => {});
});

// Stay alive in tray when all windows close
app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }
  // Don't quit — stay in tray
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

// ── Auto-updater with dialog UI ──────────────────────────────────────────────

let isCheckingForUpdates = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    const currentVersion = app.getVersion();
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Available",
        message: `New version available: v${info.version}`,
        detail: `Current version: v${currentVersion}\n\nWould you like to download the update now?`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
        isCheckingForUpdates = false;
      });
  });

  autoUpdater.on("update-not-available", () => {
    if (isCheckingForUpdates) {
      dialog.showMessageBox({
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
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setProgressBar(progress.percent / 100);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    const launcher = getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setProgressBar(-1); // Remove progress bar
    }

    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `v${info.version} has been downloaded`,
        detail: "The update will be installed when you restart the app.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    if (isCheckingForUpdates) {
      dialog.showMessageBox({
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

function checkForUpdatesManual() {
  isCheckingForUpdates = true;
  autoUpdater.checkForUpdates().catch((err) => {
    dialog.showMessageBox({
      type: "error",
      title: "Update Error",
      message: "Failed to check for updates",
      detail: err.message,
      buttons: ["OK"],
    });
    isCheckingForUpdates = false;
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
