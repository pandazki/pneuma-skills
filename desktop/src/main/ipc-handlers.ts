import { ipcMain, app, shell, dialog, BrowserWindow } from "electron";

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
}
