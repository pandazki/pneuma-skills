import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Packaged resources with a built skeleton page, and a user who chose the light theme.
const root = mkdtempSync(join(tmpdir(), "pneuma-window-probe-"));
const skeletonPage = join(root, "resources", "pneuma", "dist", "launcher-skeleton.html");
mkdirSync(join(root, "resources", "pneuma", "dist"), { recursive: true });
writeFileSync(skeletonPage, "<!doctype html>");
mkdirSync(join(root, "home"));
writeFileSync(join(root, "home", "settings.json"), JSON.stringify({ theme: "light" }));
Object.defineProperty(process, "resourcesPath", { value: join(root, "resources") });
process.env.PNEUMA_HOME = join(root, "home");
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

const windows: FakeWindow[] = [];
const errors: string[] = [];
class FakeWindow extends EventEmitter {
  destroyed = false;
  visible = false;
  minimized = false;
  restores = 0;
  focused = 0;
  urls: string[] = [];
  files: Array<[string, unknown]> = [];
  failNext = false;
  webContents = Object.assign(new EventEmitter(), {
    getURL: () => this.urls.at(-1) || "about:blank",
    setWindowOpenHandler: () => {},
  });
  constructor(public options: { show: boolean; backgroundColor: string }) { super(); windows.push(this); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible && !this.minimized; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; this.visible = true; this.restores++; }
  focus() { this.focused++; }
  show() { this.visible = true; this.emit("show"); }
  destroy() { this.destroyed = true; this.emit("closed"); }
  loadURL(url: string) {
    this.urls.push(url);
    if (this.failNext) { this.failNext = false; return Promise.reject(new Error("connection refused")); }
    return Promise.resolve();
  }
  loadFile(file: string, options: { query?: Record<string, string> }) {
    this.files.push([file, options]);
    this.urls.push(`${pathToFileURL(file).href}?${new URLSearchParams(options.query)}`);
    return Promise.resolve();
  }
}
mock.module("electron", () => ({
  app: { isPackaged: true }, BrowserWindow: FakeWindow,
  nativeTheme: { shouldUseDarkColors: true },
  shell: { openExternal: async () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }) },
  dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) },
}));
const { prepareLauncherWindow, createLauncherWindow, getLauncherWindow, showLauncherSkeleton } = await import("../../src/main/window-manager.js");
const prepared = prepareLauncherWindow() as unknown as FakeWindow;
assert.equal(windows.length, 1);
assert.equal(prepared.options.show, false);
assert.equal(prepared.options.backgroundColor, "#fbf6f1", "The window paints the saved light theme's background");
assert.deepEqual(prepared.urls, []);
prepared.emit("ready-to-show");
assert.equal(prepared.visible, false);
assert.equal(createLauncherWindow("http://localhost:3000"), prepared);
assert.deepEqual(prepared.urls, ["http://localhost:3000"]);
assert.equal(prepared.visible, false);
assert.equal(prepared.focused, 0);
assert.equal(prepared.restores, 0);
prepared.emit("ready-to-show");
assert.equal(prepared.visible, true);
createLauncherWindow("http://localhost:3000");
assert.equal(windows.length, 1);
assert.equal(prepared.urls.length, 1);
assert.equal(prepared.focused, 1);
prepared.minimized = true;
assert.equal(prepared.isVisible(), false);
createLauncherWindow("http://localhost:3000");
assert.equal(prepared.minimized, false);
assert.equal(prepared.restores, 1);
assert.equal(prepared.focused, 2);
assert.equal(prepared.urls.length, 1);
prepared.minimized = true;
createLauncherWindow("http://localhost:3000?importUrl=example", { navigate: true });
assert.equal(prepared.urls.at(-1), "http://localhost:3000?importUrl=example");
assert.equal(prepared.minimized, false);
assert.equal(prepared.restores, 2);
assert.equal(prepared.focused, 3);
prepared.destroy();
assert.equal(getLauncherWindow(), null);

const next = prepareLauncherWindow() as unknown as FakeWindow;
next.failNext = true;
createLauncherWindow("http://localhost:3001");
await Promise.resolve();
assert.equal(next.destroyed, true);
assert.equal(getLauncherWindow(), null);
assert.deepEqual(errors, ["connection refused"]);

// An older navigation failure must not destroy a replacement deep-link load.
const replacement = prepareLauncherWindow() as unknown as FakeWindow;
replacement.failNext = true;
createLauncherWindow("http://localhost:3002");
createLauncherWindow("http://localhost:3002?installModeUrl=example", { navigate: true });
await Promise.resolve();
assert.equal(replacement.destroyed, false);
replacement.emit("ready-to-show");
assert.equal(replacement.visible, true);
replacement.destroy();

// Startup: the window opens on the built skeleton page in the saved theme,
// and the service URL later loads into that same visible window.
const startup = prepareLauncherWindow() as unknown as FakeWindow;
showLauncherSkeleton();
assert.deepEqual(startup.files, [[skeletonPage, { query: { theme: "light" } }]]);
assert.equal(startup.visible, false, "Revealed on the skeleton's first paint, not before");
startup.emit("ready-to-show");
assert.equal(startup.visible, true);
showLauncherSkeleton();
assert.equal(startup.files.length, 1, "The skeleton is requested once");
assert.equal(createLauncherWindow("http://localhost:3003"), startup);
assert.equal(startup.urls.at(-1), "http://localhost:3003");
assert.equal(windows.filter((win) => !win.destroyed).length, 1);
showLauncherSkeleton();
assert.equal(startup.files.length, 1, "A navigated launcher never returns to the skeleton");
startup.destroy();

// A service that answers before the skeleton paints: the launcher's own first paint reveals the window.
const fast = prepareLauncherWindow() as unknown as FakeWindow;
showLauncherSkeleton();
createLauncherWindow("http://localhost:3004");
fast.emit("ready-to-show");
assert.equal(fast.visible, true);
fast.destroy();

// Without a production build there is no skeleton page; the themed window opens at once.
rmSync(skeletonPage);
const unbuilt = prepareLauncherWindow() as unknown as FakeWindow;
showLauncherSkeleton();
assert.deepEqual(unbuilt.files, []);
assert.equal(unbuilt.visible, true);
