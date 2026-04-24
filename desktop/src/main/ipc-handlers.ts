import { ipcMain, app, shell, dialog, BrowserWindow } from "electron";
import { closeModeWindowByUrl } from "./window-manager.js";
import { handleNativeInvoke, listCapabilities } from "./native-bridge.js";
import { logEntry, tail, getCurrentLogFile, type LogLevel } from "./logger.js";
import { showLogWindow, revealLogFile } from "./log-window.js";

export function registerIpcHandlers() {
  ipcMain.handle("pneuma:get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("pneuma:get-platform", () => {
    return process.platform;
  });

  ipcMain.handle("pneuma:open-external", (_event, url: string) => {
    return shell.openExternal(url);
  });

  ipcMain.handle("pneuma:close-mode-window", (_event, url: string) => {
    closeModeWindowByUrl(url);
  });

  ipcMain.handle("pneuma:set-editing", (_event, editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) => {
    const win = BrowserWindow.fromWebContents(_event.sender);
    if (!win) return;
    if (editing) {
      win.setResizable(true);
      win.maximize();
    } else {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      const w = opts?.width;
      const h = opts?.height;
      if (w && h) win.setSize(w, h, true);
      win.setResizable(opts?.resizable ?? false);
      win.center();
    }
  });

  ipcMain.handle(
    "pneuma:show-open-dialog",
    async (event, options: { title?: string; defaultPath?: string; buttonLabel?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(win!, {
        title: options.title || "Select Workspace",
        defaultPath: options.defaultPath,
        buttonLabel: options.buttonLabel || "Select",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  ipcMain.handle("pneuma:native", async (_event, capability: string, method: string, ...args: unknown[]) => {
    try {
      const result = await handleNativeInvoke(capability, method, ...args);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("pneuma:native:capabilities", () => {
    return listCapabilities();
  });

  // ── Log bridge ─────────────────────────────────────────────────────────────
  const ALLOWED_LEVELS: ReadonlySet<LogLevel> = new Set(["debug", "info", "warn", "error"]);

  ipcMain.on("pneuma:log:write", (_event, level: string, source: string, msg: string) => {
    const normalized = ALLOWED_LEVELS.has(level as LogLevel) ? (level as LogLevel) : "info";
    const safeSource = typeof source === "string" && source ? source.slice(0, 120) : "renderer";
    const safeMsg = typeof msg === "string" ? msg.slice(0, 8000) : String(msg);
    logEntry(normalized, safeSource, safeMsg);
  });

  ipcMain.handle("pneuma:log:tail", (_event, n?: number) => tail(typeof n === "number" ? n : 2000));
  ipcMain.handle("pneuma:log:current-file", () => getCurrentLogFile());
  ipcMain.handle("pneuma:log:reveal", () => revealLogFile());
  ipcMain.handle("pneuma:log:open", () => { showLogWindow(); });
}
