import { mock } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const windows: FakeWindow[] = [];
const errors: string[] = [];
class FakeWindow extends EventEmitter {
  destroyed = false;
  visible = false;
  minimized = false;
  restores = 0;
  focused = 0;
  urls: string[] = [];
  failNext = false;
  webContents = Object.assign(new EventEmitter(), {
    getURL: () => this.urls.at(-1) || "about:blank",
    setWindowOpenHandler: () => {},
  });
  constructor(public options: { show: boolean }) { super(); windows.push(this); }
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
}
mock.module("electron", () => ({
  app: { isPackaged: true }, BrowserWindow: FakeWindow,
  shell: { openExternal: async () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } }) },
  dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) },
}));
const { prepareLauncherWindow, createLauncherWindow, getLauncherWindow } = await import("../../src/main/window-manager.js");
const prepared = prepareLauncherWindow() as unknown as FakeWindow;
assert.equal(windows.length, 1);
assert.equal(prepared.options.show, false);
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
