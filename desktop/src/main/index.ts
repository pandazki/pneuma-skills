import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from "electron";
import { net } from "electron";
import path from "node:path";
import { createTray } from "./tray.js";
import {
  createLauncherWindow,
  prepareLauncherWindow,
  createModeWindow,
  getLauncherWindow,
  getAllModeWindows,
} from "./window-manager.js";
import {
  spawnLauncherProcess,
  killAllProcesses,
  getLauncherUrl,
} from "./bun-process.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { initLogger } from "./logger.js";
import { showLogWindow, revealLogFile } from "./log-window.js";
import { initBackgroundSessions, startBackgroundSession, revealBackgroundSession } from "./background-sessions.js";
import { initAutoUpdater, checkForUpdatesManual, restartToInstall } from "./updater.js";
import { desktopBuildPolicy } from "./build-policy.js";
import { markBoot } from "./boot-profile.js";

// ── App name (fixes "Electron" in macOS menu bar) ────────────────────────────
app.setName(desktopBuildPolicy.appName);
if (desktopBuildPolicy.isolatedUserDataName) {
  // Set the profile before logging or acquiring the single-instance lock.
  app.setPath("userData", path.join(app.getPath("appData"), desktopBuildPolicy.isolatedUserDataName));
}

// Initialize the logger before anything else writes to console — this patches
// console.{log,warn,error,info} so every subsequent log also lands in
// `<userData>/logs/pneuma-<date>.log` and in the in-memory ring for the
// Show Logs window. The original console output is preserved.
initLogger();
markBoot("main-loaded");

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ── Custom protocol handler (pneuma://) ──────────────────────────────────────
if (desktopBuildPolicy.registerProtocol && process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('pneuma', process.execPath, [path.resolve(process.argv[1])]);
  }
} else if (desktopBuildPolicy.registerProtocol) {
  app.setAsDefaultProtocolClient('pneuma');
}

let startupComplete = false;
let isQuitting = false;

app.on("second-instance", (_event, argv) => {
  // Check for pneuma:// URL in args (Windows/Linux deep link)
  const url = argv.find(arg => arg.startsWith('pneuma://'));
  if (url) {
    if (startupComplete) handlePneumaUrl(url);
    else pendingPneumaUrl = url;
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
let pendingPneumaUrl: string | null = process.argv.find((arg) => arg.startsWith("pneuma://")) ?? null;

function handlePneumaUrl(url: string) {
  if (isQuitting) return;
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
      case 'mode': {
        // pneuma://mode/{encodedUrl} — mode tar.gz URL or github:user/repo
        const modeUrl = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
        if (modeUrl) {
          showLauncherWithInstallMode(modeUrl);
        } else {
          showLauncher();
        }
        break;
      }
      case 'handoff': {
        // pneuma://handoff?intent=...&mode=...&cwd=...&init-project=<0|1>
        //                 &source-agent=...&summary=...&files=a,b,c
        //                 &source-transcript=...
        //
        // The /handoff-pneuma slash command emits this when the user has
        // no `pneuma` CLI on PATH but does have the desktop app. The
        // optional context fields (summary/files/source-transcript) are
        // critical for non-trivial intents like "做个工作汇报" where the
        // target needs to know what just happened in the source agent.
        const params = parsed.searchParams;
        const intent = params.get('intent');
        const mode = params.get('mode');
        if (!intent || !mode) {
          showLauncher();
          break;
        }
        const initProjectRaw = params.get('init-project') ?? params.get('init_project');
        const initProject = initProjectRaw !== '0' && initProjectRaw !== 'false';
        const body: Record<string, unknown> = { intent, mode, initProject };
        const cwd = params.get('cwd');
        if (cwd) body.cwd = cwd;
        const sourceAgent = params.get('source-agent') ?? params.get('source_agent');
        if (sourceAgent) body.sourceAgent = sourceAgent;
        const displayName = params.get('display-name') ?? params.get('display_name');
        if (displayName) body.displayName = displayName;
        const summary = params.get('summary');
        if (summary) body.summary = summary;
        const filesParam = params.get('files');
        if (filesParam) {
          const files = filesParam.split(',').map((s) => s.trim()).filter(Boolean);
          if (files.length > 0) body.suggestedFiles = files;
        }
        const sourceTranscript = params.get('source-transcript') ?? params.get('source_transcript');
        if (sourceTranscript) body.sourceTranscript = sourceTranscript;
        const language = params.get('language');
        if (language) body.language = language;
        // Background mode is the default — only an explicit 0/false opts out.
        // This is a desktop-side concern, so it rides the second argument
        // rather than the request body sent to the launcher.
        const backgroundRaw = params.get('background');
        const background = backgroundRaw !== '0' && backgroundRaw !== 'false';
        void handleHandoffUrl(body, { background });
        break;
      }
      default:
        showLauncher();
    }
  } catch {
    showLauncher();
  }
}

/**
 * True for a `pneuma://handoff` URL that should run in background mode
 * (the default). Used on cold start to suppress the splash + launcher window
 * so a handoff-triggered launch is invisible until the session finishes.
 */
function isBackgroundHandoffUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "handoff") return false;
    const bg = parsed.searchParams.get("background");
    return bg !== "0" && bg !== "false";
  } catch {
    return false;
  }
}

/**
 * POST to the launcher's `/api/handoffs/external` route and surface the
 * resulting Pneuma session. In background mode (the default) the session
 * runs in a hidden window — invisible until it completes, then a
 * notification invites the user to open it. With `background: false` the
 * session opens immediately as a foreground Mode window. Errors surface as
 * a native dialog so the user (whose terminal-level slash command just
 * emitted a URL) isn't left wondering what happened.
 */
async function handleHandoffUrl(body: Record<string, unknown>, opts?: { background?: boolean }) {
  const background = opts?.background !== false;
  // The launcher process is normally up by the time a URL arrives, but a
  // cold-launch via pneuma:// fires the event before `spawnLauncherProcess`
  // resolves. Poll for up to ~6s before giving up.
  let launcherUrl = getLauncherUrl();
  if (!launcherUrl) {
    for (let i = 0; i < 30 && !launcherUrl; i++) {
      await new Promise((r) => setTimeout(r, 200));
      launcherUrl = getLauncherUrl();
    }
  }
  if (!launcherUrl) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Pneuma launcher not ready',
      message: 'The Pneuma launcher process did not finish starting in time.',
      detail: 'Try again from your agent in a moment.',
      buttons: ['OK'],
    });
    return;
  }

  try {
    const res = await net.fetch(`${launcherUrl}/api/handoffs/external`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      await dialog.showMessageBox({
        type: 'error',
        title: 'Pneuma handoff failed',
        message: errBody.error ?? `Server returned ${res.status}`,
        buttons: ['OK'],
      });
      return;
    }
    const result = (await res.json()) as { url?: string };
    if (!result.url) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Pneuma handoff returned no URL',
        message: 'The server accepted the handoff but did not return a session URL.',
        buttons: ['OK'],
      });
      return;
    }
    if (isQuitting) return;
    if (background) {
      // Background mode: run the session in a hidden window. The user sees
      // nothing until it finishes — then a notification invites them to open it.
      startBackgroundSession({
        url: result.url,
        mode: String(body.mode ?? ""),
        intent: typeof body.intent === "string" ? body.intent : undefined,
      });
    } else {
      if (process.platform === "darwin") await app.dock?.show();
      if (!isQuitting) createModeWindow(result.url);
    }
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Pneuma handoff failed',
      message: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  }
}

async function showLauncherWithImport(shareUrl: string) {
  return showLauncherWithQuery("importUrl", shareUrl);
}

async function showLauncherWithInstallMode(modeUrl: string) {
  return showLauncherWithQuery("installModeUrl", modeUrl);
}

async function showLauncherWithQuery(paramName: string, value: string) {
  if (isQuitting) return;
  const launcherUrl = getLauncherUrl();
  if (!launcherUrl) {
    console.error("Launcher process not ready");
    return;
  }

  if (process.platform === "darwin") {
    await app.dock?.show();
  }

  if (isQuitting) return;
  const urlWithQuery = `${launcherUrl}?${paramName}=${encodeURIComponent(value)}`;
  createLauncherWindow(urlWithQuery, { navigate: true });
}

// macOS: open-url fires before app.whenReady() on cold launch
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (startupComplete) {
    handlePneumaUrl(url);
  } else {
    pendingPneumaUrl = url;
  }
});

function launcherNavigationRequestedBy(url: string): boolean {
  try { return ["open", "import", "mode"].includes(new URL(url).hostname); }
  catch { return false; }
}

async function showLauncher() {
  if (isQuitting) return;
  if (process.platform === "darwin") {
    await app.dock?.show();
  }

  const launcherUrl = getLauncherUrl();
  if (!launcherUrl) {
    console.error("Launcher process not ready");
    return;
  }

  if (!isQuitting) createLauncherWindow(launcherUrl);
}

app.whenReady().then(async () => {
  markBoot("electron-ready");
  if (!gotLock || isQuitting) return;
  // A pending background-handoff cold start must stay invisible: no splash,
  // no launcher window, no dock icon — only the hidden background session.
  const bgColdStart = pendingPneumaUrl ? isBackgroundHandoffUrl(pendingPneumaUrl) : false;

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
              enabled: desktopBuildPolicy.updatesEnabled,
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
            {
              label: "Show Logs",
              accelerator: "CmdOrCtrl+Alt+L",
              click: () => showLogWindow(),
            },
            {
              label: "Reveal Log File",
              click: () => revealLogFile(),
            },
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
  initBackgroundSessions();

  if (process.platform === "darwin") {
    // A background-handoff cold start must not pop a dock icon.
    if (bgColdStart) {
      app.dock?.hide();
    } else {
      await app.dock?.show();
    }
  }

  if (isQuitting) return;
  // Show splash screen while loading (skipped for a background cold start)
  const splash = bgColdStart ? null : createSplashWindow();
  const preparedLauncher = bgColdStart ? null : prepareLauncherWindow();
  const closeSplash = () => { if (splash && !splash.isDestroyed()) splash.destroy(); };
  // Preserve visible feedback until Chromium actually reveals the launcher.
  preparedLauncher?.once("show", closeSplash);
  preparedLauncher?.once("closed", closeSplash);

  // Start Bun while the hidden launcher window prepares its renderer.
  try {
    await spawnLauncherProcess();
  } catch (err) {
    console.error("Failed to start launcher process:", err);
    closeSplash();
    if (preparedLauncher && !preparedLauncher.isDestroyed()) preparedLauncher.destroy();
    if (!isQuitting) app.quit();
    return;
  }
  if (isQuitting) return;

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
    onRestartToUpdate: () => restartToInstall(),
    onRevealBackgroundSession: revealBackgroundSession,
    onQuit: () => app.quit(),
  });

  // Backend availability belongs to the launcher API. A missing Claude CLI
  // must not prevent a user from opening local work or choosing another backend.
  startupComplete = true;
  const pendingUrl = pendingPneumaUrl;
  pendingPneumaUrl = null;
  const pendingBackgroundHandoff = pendingUrl ? isBackgroundHandoffUrl(pendingUrl) : bgColdStart;
  if (pendingBackgroundHandoff) {
    // Also cover a cold-launch URL delivered while the asynchronous shell runs.
    if (preparedLauncher && !preparedLauncher.isDestroyed()) preparedLauncher.destroy();
    closeSplash();
    if (process.platform === "darwin") app.dock?.hide();
  }
  if (pendingUrl) {
    handlePneumaUrl(pendingUrl);
    // Foreground handoffs open a session, while the normal launcher remains
    // available just as it does for an already-running desktop.
    if (!pendingBackgroundHandoff && !launcherNavigationRequestedBy(pendingUrl)) void showLauncher();
  } else if (!bgColdStart) {
    void showLauncher();
  }

  // Auto-update: silent periodic checks + silent download. The user only
  // hears about it once the installer is on disk (badge / tray / notification).
  initAutoUpdater();
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
  isQuitting = true;
  killAllProcesses();
  const launcher = getLauncherWindow();
  if (launcher && !launcher.isVisible()) launcher.destroy();
});

// Retain the existing explicit diagnostic IPC; startup availability is backend-neutral.
ipcMain.handle("pneuma:recheck-claude", async () => {
  const { detectClaude } = await import("./claude-detector.js");
  return detectClaude();
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
