import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../src/main");
const scenario = process.env.TEST_SCENARIO;
const windows: FakeWindow[] = [];
const requests: Array<{ intent: string }> = [];
const backgroundSessions: string[] = [];
const foregroundSessions: string[] = [];
const launcherNavigations: string[] = [];
class FakeWindow extends EventEmitter {
  destroyed = false;
  visible: boolean;
  constructor(options: { show?: boolean } = {}) {
    super();
    this.visible = options.show !== false;
    windows.push(this);
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  destroy() { this.destroyed = true; this.emit("closed"); }
  loadURL() { return Promise.resolve(); }
  show() { this.visible = true; this.emit("show"); }
}

let electronReady = false;
let finishElectron!: () => void;
let finishLauncher!: () => void;
let launcherStarted!: () => void;
let launcherReady = false;
const electronStartup = new Promise<void>((resolve) => { finishElectron = () => { electronReady = true; resolve(); }; });
const launcherStartup = new Promise<void>((resolve) => { finishLauncher = () => { launcherReady = true; resolve(); }; });
const started = new Promise<void>((resolve) => { launcherStarted = resolve; });
const app = Object.assign(new EventEmitter(), {
  setName() {}, requestSingleInstanceLock: () => true, quit() {}, isPackaged: false,
  whenReady: () => electronStartup, isReady: () => electronReady,
  dock: { show: async () => {}, hide() {} },
});
mock.module("electron", () => ({
  app, BrowserWindow: FakeWindow, ipcMain: { handle() {} }, shell: {},
  Menu: { setApplicationMenu() {}, buildFromTemplate: (template: unknown) => template },
  dialog: { showMessageBox: async () => { throw new Error("Unexpected startup error dialog"); } },
  net: { fetch: async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return Response.json({ url: `http://localhost:4567/?intent=${body.intent}` });
  } },
}));
mock.module(resolve(root, "bun-process.js"), () => ({
  spawnLauncherProcess: () => { launcherStarted(); return launcherStartup; },
  getLauncherUrl: () => launcherReady ? "http://localhost:1234" : null, killAllProcesses() {},
}));
let launcher: FakeWindow | undefined;
const prepareLauncher = () => {
  if (!launcher || launcher.isDestroyed()) launcher = new FakeWindow({ show: false });
  return launcher;
};
mock.module(resolve(root, "window-manager.js"), () => ({
  prepareLauncherWindow: prepareLauncher,
  createLauncherWindow: (url: string) => { launcherNavigations.push(url); prepareLauncher().show(); },
  getLauncherWindow: () => launcher?.isDestroyed() ? null : launcher,
  createModeWindow: (url: string) => foregroundSessions.push(url), getAllModeWindows: () => [],
}));
mock.module(resolve(root, "tray.js"), () => ({ createTray() {} }));
mock.module(resolve(root, "ipc-handlers.js"), () => ({ registerIpcHandlers() {} }));
mock.module(resolve(root, "logger.js"), () => ({ initLogger() {} }));
mock.module(resolve(root, "log-window.js"), () => ({ showLogWindow() {}, revealLogFile() {} }));
mock.module(resolve(root, "background-sessions.js"), () => ({
  initBackgroundSessions() {}, revealBackgroundSession() {},
  startBackgroundSession: ({ url }: { url: string }) => backgroundSessions.push(url),
}));
mock.module(resolve(root, "updater.js"), () => ({ initAutoUpdater() {}, checkForUpdatesManual() {}, restartToInstall() {} }));
mock.module(resolve(root, "build-policy.js"), () => ({
  desktopBuildPolicy: { appName: "Startup fixture", registerProtocol: false, updatesEnabled: false },
}));

const handoff = (intent: string) => `pneuma://handoff?mode=doc&intent=${intent}`;
const openUrl = (url: string) => app.emit("open-url", { preventDefault() {} }, url);
const secondInstance = (url: string) => app.emit("second-instance", {}, ["pneuma", url]);
process.argv.push(handoff("initial"));
await import(resolve(root, "index.ts"));
finishElectron();
await started;
assert.equal(app.isReady(), true);
assert.equal(windows.length, 0, "A background cold start must create neither splash nor launcher");
openUrl(handoff("second"));
if (scenario === "mixed-open") openUrl("pneuma://open");
if (scenario === "mixed-handoff") openUrl(`${handoff("foreground")}&background=0`);
secondInstance(handoff("third"));
assert.deepEqual(requests, [], "Protocol requests must wait for launcher readiness");
finishLauncher();
// Response.json and dock.show complete asynchronously after protocol dispatch.
await Bun.sleep(0);
const expectedIntents = scenario === "mixed-handoff"
  ? ["initial", "second", "foreground", "third"] : ["initial", "second", "third"];
assert.deepEqual(requests.map(({ intent }) => intent), expectedIntents);
assert.equal(backgroundSessions.length, 3);
assert.equal(foregroundSessions.length, scenario === "mixed-handoff" ? 1 : 0);
assert.equal(launcherNavigations.length, scenario === "background" ? 0 : 1);
if (scenario === "background") assert.equal(windows.length, 0, "Draining background requests must remain invisible");
else assert.equal(launcher?.isVisible(), true, "A queued foreground intent must reveal the launcher");

// Requests received after startup keep the immediate dispatch behavior on both platforms.
openUrl(handoff("after-ready-macos"));
secondInstance(handoff("after-ready-windows"));
assert.deepEqual(requests.map(({ intent }) => intent), [...expectedIntents, "after-ready-macos", "after-ready-windows"]);
await Bun.sleep(0);
assert.equal(backgroundSessions.length, 5);
