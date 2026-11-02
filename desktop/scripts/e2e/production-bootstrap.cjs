// Test-only host: exercise packaged paths against an existing production build.
// This does not emulate signing, ASAR, install, or the operating system cache.
const { app, shell, net, Notification } = require("electron");
const path = require("node:path");
const { appendFileSync } = require("node:fs");

const fixture = JSON.parse(process.env.PNEUMA_E2E_FIXTURE);
Object.defineProperty(app, "isPackaged", { value: true });
Object.defineProperty(process, "resourcesPath", { value: fixture.resources });
app.setPath("appData", fixture.appData);
app.setPath("home", fixture.home);
app.setPath("userData", path.join(fixture.appData, "profile"));

const events = [];
global.__pneumaE2E = { events, externalUrls: [] };
const mark = (stage, details = {}) => {
  if (details.url?.startsWith("data:")) details.url = "data:[splash/setup]";
  const event = { stage, at: Date.now(), ...details };
  events.push(event);
  appendFileSync(fixture.eventsFile, JSON.stringify(event) + "\n");
};
app.on("before-quit", () => mark("app-before-quit"));
app.on("will-quit", () => mark("app-will-quit"));
app.on("quit", (_event, exitCode) => mark("app-quit", { exitCode }));
process.on("exit", (exitCode) => mark("main-process-exit", { exitCode }));
app.setAsDefaultProtocolClient = () => {
  throw new Error("E2E refuses protocol registration: rebuild with PNEUMA_DESKTOP_PREVIEW=1");
};
shell.openExternal = async (url) => { global.__pneumaE2E.externalUrls.push(url); };
app.on("browser-window-created", (_event, win) => {
  const id = win.id;
  mark("window-created", { id: win.id });
  win.on("close", () => mark("window-close-requested", { id }));
  win.on("closed", () => mark("window-closed", { id }));
  win.on("ready-to-show", () => mark("window-ready-to-show", { id, url: win.webContents.getURL() }));
  win.on("show", () => mark("window-shown", { id: win.id, url: win.webContents.getURL() }));
  win.webContents.on("did-finish-load", () => mark("window-loaded", { id: win.id, url: win.webContents.getURL() }));
});
if (fixture.config.background) {
  const fetch = net.fetch.bind(net);
  net.fetch = async (input, init) => {
    if (new URL(String(input)).pathname === "/api/handoffs/external") {
      mark("handoff-request", { body: JSON.parse(init.body) });
      return Response.json({ url: fixture.backgroundUrl });
    }
    return fetch(input, init);
  };
  Notification.prototype.show = function() { mark("notification"); };
}
mark("bootstrap-start");
require(path.join(fixture.project, "desktop/dist-electron/main/index.js"));
if (fixture.config.background) {
  app.emit("open-url", { preventDefault() {} }, "pneuma://handoff?mode=doc&intent=E2E+fixture");
}
