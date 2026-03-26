import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pneumaDesktop", {
  getVersion: () => ipcRenderer.invoke("pneuma:get-app-version"),
  getPlatform: () => ipcRenderer.invoke("pneuma:get-platform"),
  openExternal: (url: string) => ipcRenderer.invoke("pneuma:open-external", url),
  recheckClaude: () => ipcRenderer.invoke("pneuma:recheck-claude"),
  showOpenDialog: (options: { title?: string; defaultPath?: string; buttonLabel?: string }) =>
    ipcRenderer.invoke("pneuma:show-open-dialog", options),
  closeModeWindow: (url: string) => ipcRenderer.invoke("pneuma:close-mode-window", url),
  setEditing: (editing: boolean, opts?: { width?: number; height?: number; resizable?: boolean }) =>
    ipcRenderer.invoke("pneuma:set-editing", editing, opts),
  invoke: (capability: string, method: string, ...args: unknown[]) =>
    ipcRenderer.invoke("pneuma:native", capability, method, ...args),
  capabilities: () => ipcRenderer.invoke("pneuma:native:capabilities"),
});
