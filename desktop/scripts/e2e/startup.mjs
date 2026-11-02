#!/usr/bin/env node
/**
 * Production-content Electron startup benchmark and launcher smoke checks.
 * Build first: bun run build; cd desktop; PNEUMA_DESKTOP_PREVIEW=1 npm run build:main
 * Run: npm run test:startup -- --out /tmp/pneuma-startup --samples 5
 * Compare another checkout with --project /absolute/path (its builds must exist).
 * Fixtures intercept only the external registry and optional /api/backends faults.
 * All local API assembly, Bun startup, Electron windows, and React rendering run.
 */
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir, cpus, release, platform, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const project = resolve(option("project", join(here, "../../..")));
const out = resolve(option("out", join(tmpdir(), `pneuma-startup-${Date.now()}`)));
const sampleCount = Number(option("samples", "5"));
const scenarioNames = option("scenarios", "fresh,warm,slow-shell,slow-cli-version,slow-registry,slow-backends").split(",");
const runE2E = args.includes("--e2e");
const label = option("label", "candidate");
const bun = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
assert(existsSync(join(project, "dist/index.html")), "Build production frontend first");
assert(existsSync(join(project, "desktop/dist-electron/main/index.js")), "Build preview desktop first");
assert(Number.isInteger(sampleCount) && sampleCount >= 1, "--samples must be a positive integer");
await mkdir(out, { recursive: true });

const scenarios = {
  fresh: {},
  warm: { warm: true },
  "slow-shell": { shellDelay: 2 },
  "slow-cli-version": { cliDelay: 2 },
  "slow-registry": { registryDelay: 4000 },
  "failed-registry": { registryFailure: true },
  "slow-backends": { backendDelay: 4000 },
  "failed-backends": { backendFailure: true },
  "no-backend": { noBackend: true },
};
for (const name of scenarioNames) assert(name in scenarios, `Unknown scenario: ${name}`);
const metadata = {
  label, project, revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim(),
  startedAt: new Date().toISOString(), platform: platform(), arch: arch(), osRelease: release(),
  cpu: cpus()[0]?.model, cores: cpus().length,
  bun: execFileSync(bun, ["--version"], { encoding: "utf8" }).trim(),
  electron: require("electron/package.json").version, playwright: require("playwright/package.json").version,
  sampleCount, scenarioNames, harness: "unsigned Electron host; packaged paths + production dist; no Vite; source symlink; no ASAR/signing/installer",
  timing: "spawn request to native HTTP launcher show and DOM local content readiness; parent wall clock; same observer on both revisions",
  readiness: "visible Create New section with populated All Modes button, successful sessions/projects responses, two animation frames",
  fixtures: "isolated HOME/appData; fake Claude version probe only; external registry deterministic empty result; Bun.serve wrapper delays/fails /api/backends; no-backend forces all availability false",
  cache: "fresh resets application profile each sample; warm primes and reuses profile; OS disk cache is not flushed; registry server cache is process-local",
  buildHashes: Object.fromEntries(await Promise.all(["desktop/dist-electron/main/index.js", "desktop/dist-electron/preload/index.js", "dist/index.html"].map(async (file) => [file, createHash("sha256").update(await readFile(join(project, file))).digest("hex")]))),
};
await writeFile(join(out, "metadata.json"), JSON.stringify(metadata, null, 2));

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function fixtureFor(name, config) {
  const root = await mkdtemp(join(tmpdir(), "pneuma-electron-e2e-"));
  const home = join(root, "home");
  const appData = join(root, "app-data");
  const resources = join(root, "resources");
  const bin = join(root, "bin");
  for (const dir of [home, appData, resources, bin, join(resources, "bun"), join(home, ".pneuma")]) await mkdir(dir, { recursive: true });
  await symlink(project, join(resources, "pneuma"));
  for (const name of ["tray-iconTemplate.png", "tray-iconTemplate@2x.png", "tray-icon.png", "tray-icon@2x.png"]) {
    await symlink(join(project, "desktop/resources", name), join(resources, name));
  }
  await writeFile(join(home, ".pneuma/settings.json"), JSON.stringify({ locale: "en" }));
  const fixture = { root, home, appData, resources, bin, project, eventsFile: join(root, "events.jsonl"), pidsFile: join(root, "pids"), config };
  const shell = join(bin, "fixture-shell");
  // The shell accepts the same -ilc/-lic form as the real login shell, without reading personal startup files.
  await writeFile(shell, `#!/bin/sh\n/bin/sleep ${config.shellDelay ?? 0}\nexport PATH=${quote(`${bin}:/usr/bin:/bin:/usr/sbin:/sbin`)}\nfor arg do script="$arg"; done\nexec /bin/sh -c "$script"\n`);
  await chmod(shell, 0o755);
  if (!config.noBackend) {
    await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1" = "--version" ]; then /bin/sleep ${config.cliDelay ?? 0}; echo "2.0.0 (Claude Code test fixture)"; exit 0; fi\necho "E2E refuses agent execution" >&2\nexit 70\n`);
    await chmod(join(bin, "claude"), 0o755);
  }
  const preload = join(root, "registry-preload.ts");
  await writeFile(preload, `const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://pneuma-storage.vibecoding.icu/registry/index.json") {
    ${config.trackRegistry ? `const startedAt = Date.now();
    await Bun.write(${JSON.stringify(join(root, "registry-request.json"))}, JSON.stringify({ startedAt }));` : ""}
    await new Promise(r => setTimeout(r, ${config.registryDelay ?? 0}));
    ${config.trackRegistry ? `await Bun.write(${JSON.stringify(join(root, "registry-request.json"))}, JSON.stringify({ startedAt, completedAt: Date.now() }));` : ""}
    return ${config.registryFailure ? 'new Response("Registry fixture unavailable", {status:503})' : 'Response.json({ modes: [] })'};
  }
  return originalFetch(input, init);
};
const originalServe = Bun.serve.bind(Bun);
Bun.serve = function(options) {
  const fetch = options.fetch;
  return originalServe({ ...options, async fetch(request, server) {
    ${config.blockImport ? `if (new URL(request.url).pathname === "/api/import") {
      const body = await request.json();
      await Bun.write(${JSON.stringify(join(root, "import-request.json"))}, JSON.stringify(body));
      return Response.json({error:"Intentional import fixture; no files imported"}, {status:503});
    }` : ""}
    if (new URL(request.url).pathname === "/api/backends") {
      await new Promise(r => setTimeout(r, ${config.backendDelay ?? 0}));
      ${config.backendFailure ? 'return Response.json({error:"Backend fixture unavailable"}, {status:503});' : ""}
    }
    const response = await fetch(request, server);
    ${config.noBackend ? `if (new URL(request.url).pathname === "/api/backends") {
      const data = await response.json();
      return Response.json({ ...data, backends: data.backends.map(backend => ({ ...backend, available: false, reason: "No backend installed (E2E fixture)" })) });
    }` : ""}
    return response;
  }});
};
`);
  await writeFile(join(resources, "bun/bun"), `#!/bin/sh\necho $$ >> ${quote(fixture.pidsFile)}\nexec ${quote(bun)} --preload ${quote(preload)} "$@"\n`);
  await chmod(join(resources, "bun/bun"), 0o755);
  const result = { ...fixture, shell };
  if (config.background) {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><html><body><h1>Background handoff fixture</h1></body></html>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    result.backgroundUrl = `http://127.0.0.1:${server.address().port}/?mode=doc`;
    Object.defineProperty(result, "server", { value: server });
  }
  return result;
}

async function removeFixture(fixture) {
  if (fixture.server) await new Promise((resolve) => fixture.server.close(resolve));
  await rm(fixture.root, { recursive: true, force: true });
}

async function launch(fixture, sampleName) {
  const logs = [];
  const errors = [];
  const responseEvents = [];
  const previousPids = existsSync(fixture.pidsFile) ? (await readFile(fixture.pidsFile, "utf8")).trim().split("\n").filter(Boolean).length : 0;
  const start = Date.now();
  const app = await electron.launch({
    args: [join(here, "production-bootstrap.cjs")], timeout: 30_000,
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, XDG_CONFIG_HOME: fixture.appData,
      PATH: `${fixture.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: fixture.shell,
      PNEUMA_E2E_FIXTURE: JSON.stringify(fixture), PNEUMA_BOOT_PROFILE: "1", LANG: "en_US.UTF-8",
      CLAUDECODE: "", CLAUDE_CONFIG_DIR: join(fixture.home, ".claude"), CODEX_HOME: join(fixture.home, ".codex") },
  });
  const child = app.process();
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  const context = app.context();
  context.setDefaultTimeout(10_000);
  const observedPages = new Set();
  const observe = (page) => {
    if (observedPages.has(page)) return;
    observedPages.add(page);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/api/")) responseEvents.push({ path: pathname, status: response.status(), at: Date.now() });
    });
  };
  context.on("page", observe);
  for (const page of context.pages()) observe(page);
  let page;
  try {
    page = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error("No HTTP launcher window within 30 seconds")); }, 30_000);
      const pending = new Set();
      const cleanup = () => { clearTimeout(timeout); app.off("window", consider); };
      const consider = (win) => {
        if (pending.has(win)) return;
        pending.add(win);
        observe(win);
        win.waitForURL(/^http:\/\/(localhost|127\.0\.0\.1):/, { timeout: 30_000 })
          .then(() => { cleanup(); resolve(win); }).catch(() => {});
      };
      app.on("window", consider);
      for (const win of app.windows()) consider(win);
    });
    if (fixture.config.background) {
      await page.getByRole("heading", { name: "Background handoff fixture" }).waitFor();
      const state = await app.evaluate(({ BrowserWindow }) => ({
        events: global.__pneumaE2E.events,
        windows: BrowserWindow.getAllWindows().map((win) => ({ visible: win.isVisible(), url: win.webContents.getURL() })),
      }));
      assert.equal(state.windows.length, 1, "Cold background handoff must not create a launcher or splash");
      assert.equal(state.windows[0].visible, false, "Background handoff window must remain hidden");
      assert(!state.events.some((event) => event.stage === "window-shown"), "Cold background handoff flashed a window");
      const shown = app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Background completion did not reveal window")), 5000);
        BrowserWindow.getAllWindows()[0].once("show", () => { clearTimeout(timeout); resolve(true); });
      }));
      await page.evaluate(() => {
        window.pneumaDesktop.reportSessionStatus("running");
        window.pneumaDesktop.reportSessionStatus("idle");
      });
      assert.equal(await shown, true);
      await page.screenshot({ path: join(out, "background-handoff-complete.png") });
      return { app, page, logs, errors, fixture, previousPids, result: { checks: ["cold handoff created only one hidden session window", "running to idle IPC revealed the finished session"], events: state.events } };
    }
    // Cross-version predicate: the candidate-only data attribute is deliberately not used.
    await page.waitForFunction(() => {
      const main = document.querySelector("main");
      if (!main || !Array.from(main.querySelectorAll("h2")).some((el) => el.textContent === "Create New")) return false;
      return Array.from(main.querySelectorAll("button")).some((el) => /All Modes \([1-9]\d*\)/.test(el.textContent ?? ""));
    }, null, { timeout: 25_000 });
    const localResponsesLoaded = () => ["/api/sessions", "/api/projects"].every((path) => responseEvents.some((event) => event.path === path && event.status === 200));
    const localDeadline = Date.now() + 25_000;
    while (!localResponsesLoaded() && Date.now() < localDeadline) await new Promise((resolve) => setTimeout(resolve, 16));
    assert(localResponsesLoaded(), "Local sessions/projects did not load");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const localReadyAt = Date.now();
    const mainState = await app.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(), userData: app.getPath("userData"), events: global.__pneumaE2E.events,
      windows: BrowserWindow.getAllWindows().map((win) => ({ id: win.id, visible: win.isVisible(), url: win.webContents.getURL() })),
    }));
    assert.equal(mainState.name, "Pneuma Skills Preview", "Preview policy must disable updates and protocol registration");
    assert(mainState.userData.startsWith(fixture.appData), "Application profile escaped isolated directory");
    const shown = mainState.events.find((event) => event.stage === "window-shown" && /^http:\/\//.test(event.url));
    assert(shown, "Real HTTP launcher window was never shown");
    const result = { sample: sampleName, shownMs: shown.at - start, localReadyMs: localReadyAt - start, start,
      localReadyAt, events: mainState.events, responseEvents, errors };
    return { app, page, result, logs, errors, fixture, previousPids };
  } catch (error) {
    await writeFile(join(out, `${sampleName}-failure.log`), logs.join(""));
    await writeFile(join(out, `${sampleName}-failure.json`), JSON.stringify({ error: String(error), responseEvents, errors }, null, 2));
    if (existsSync(fixture.eventsFile)) await writeFile(join(out, `${sampleName}-native-events.jsonl`), await readFile(fixture.eventsFile));
    for (const [index, win] of app.windows().entries()) await win.screenshot({ path: join(out, `${sampleName}-failure-${index}.png`), timeout: 5000 }).catch(() => {});
    try { await close({ app, logs, fixture, previousPids }, sampleName); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Launch failed and cleanup required intervention"); }
    throw error;
  }
}

async function close(run, sampleName) {
  let closeTimedOut = false;
  let closeError;
  let survivors = [];
  let remaining = [];
  const timeout = setTimeout(() => { closeTimedOut = true; run.app.process().kill("SIGKILL"); }, 5000);
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitForExit = async (pids, attempts) => {
    for (let attempt = 0; attempt < attempts && pids.some(alive); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
  };
  try { await run.app.close(); }
  catch (error) { closeError = error; }
  finally {
    clearTimeout(timeout);
    // Cleanup runs even if Electron close rejects. Only PIDs written by this
    // launch's bundled-Bun wrapper belong to this run; earlier warm launches
    // are excluded so a recycled PID can never target another process.
    const pids = existsSync(run.fixture.pidsFile)
      ? (await readFile(run.fixture.pidsFile, "utf8")).trim().split("\n").filter(Boolean).slice(run.previousPids).map(Number).filter((pid) => Number.isInteger(pid) && pid > 1)
      : [];
    await waitForExit(pids, 40);
    survivors = pids.filter(alive);
    for (const pid of survivors) { try { process.kill(pid, "SIGTERM"); } catch {} }
    await waitForExit(survivors, 20);
    for (const pid of survivors.filter(alive)) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await waitForExit(survivors, 20);
    remaining = survivors.filter(alive);
    await writeFile(join(out, `${sampleName}.log`), run.logs.join(""));
  }
  assert.deepEqual(remaining, [], "Fixture launcher survived bounded SIGTERM/SIGKILL cleanup");
  if (closeError) throw closeError;
  assert.deepEqual(survivors, [], "App quit left a launcher process alive; harness terminated it");
  assert.equal(closeTimedOut, false, "Application quit exceeded five seconds");
  // Let Chromium helpers release the reusable profile before the next launch.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function smoke(run, scenario) {
  const { app, page, fixture } = run;
  const checks = [];
  await page.getByRole("button", { name: /^All Modes \(/ }).click();
  await page.getByText("Mode Gallery", { exact: true }).waitFor({ timeout: 5000 });
  checks.push("All Modes opens gallery through trusted click");
  if (scenario === "failed-registry") {
    const notice = page.getByRole("dialog", { name: "Mode Gallery" }).locator('[data-launcher-resource="published"]');
    await notice.getByRole("button", { name: "Retry" }).waitFor();
    await notice.scrollIntoViewIfNeeded();
    checks.push("community registry error and Retry remain visible inside gallery");
  }
  await page.screenshot({ path: join(out, `${scenario}-gallery.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByText("Mode Gallery", { exact: true }).waitFor({ state: "hidden" });
  // Closing/reopening the launcher must preserve the Bun service and remain singleton.
  const url = page.url();
  await app.evaluate(({ app }) => { app.emit("open-url", { preventDefault() {} }, "pneuma://open"); });
  let state = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((win) => /^http:\/\//.test(win.webContents.getURL())).map((win) => win.id));
  assert.equal(state.length, 1);
  checks.push("pneuma://open reuses one launcher window");
  assert.equal((await page.request.get(`${new URL(url).origin}/api/running`)).status(), 200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(out, `${scenario}-launcher.png`) });
  if (scenario === "no-backend") {
    const backends = await (await page.request.get(`${new URL(url).origin}/api/backends`)).json();
    assert(backends.backends.every((backend) => !backend.available), "No-backend response fixture was not applied");
    await page.getByRole("button", { name: "Launch", exact: true }).first().click();
    await page.getByRole("status").filter({ hasText: "No backend installed (E2E fixture)" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Launch", exact: true }).last().isDisabled(), true);
    checks.push("all-backends-unavailable API fixture leaves launcher browsable; no fake Claude executable is installed");
    checks.push("launch dialog explains unavailable backend and disables Launch");
  }
  if (scenario === "slow-backends") {
    assert(!run.result.responseEvents.some((event) => event.path === "/api/backends" && event.at <= run.result.localReadyAt), "Local content waited for delayed backend response");
    checks.push("local content and gallery usable before the delayed backend response");
  }
  if (scenario === "slow-registry") {
    let request;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (existsSync(join(fixture.root, "registry-request.json"))) request = JSON.parse(await readFile(join(fixture.root, "registry-request.json"), "utf8"));
      if (request?.completedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(request?.completedAt, "Remote registry fixture never completed");
    assert(run.result.localReadyAt < request.completedAt, "Local content waited for the delayed remote registry");
    checks.push("local content became usable before the recorded remote registry completion");
  }
  if (scenario === "failed-backends") {
    await page.locator('[data-launcher-resource="backends"]').getByRole("button", { name: "Retry" }).waitFor();
    checks.push("failed backend request exposes Retry while local gallery remains usable");
  }
  if (scenario === "failed-registry") {
    await page.locator('[data-launcher-resource="published"]').getByRole("button", { name: "Retry" }).waitFor();
    checks.push("failed remote registry exposes Retry while local gallery remains usable");
  }
  if (scenario === "fresh") {
    const realShown = run.result.events.find((event) => event.stage === "window-shown" && event.url?.startsWith("http:"));
    const splashShown = run.result.events.find((event) => event.stage === "window-shown" && event.id !== realShown.id);
    const splashClosed = run.result.events.find((event) => event.stage === "window-closed" && event.id === splashShown?.id);
    assert(splashClosed && splashClosed.at >= realShown.at, "Splash was destroyed before the real launcher was shown");
    checks.push("splash remains until real launcher show");
    await page.getByTitle("Settings", { exact: true }).click();
    await page.getByRole("dialog", { name: "Settings" }).waitFor();
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close", exact: true }).click();
    checks.push("Settings opens and closes through trusted clicks");
    const minimize = () => app.evaluate(({ BrowserWindow }) => new Promise((resolve, reject) => {
      const win = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("http:"));
      const timeout = setTimeout(() => reject(new Error("Native minimize event timed out")), 5000);
      win.once("minimize", () => { clearTimeout(timeout); resolve(true); });
      win.minimize();
    }));
    const openAndRestore = (url) => app.evaluate(({ app, BrowserWindow }, url) => new Promise((resolve, reject) => {
      const win = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("http:"));
      const timeout = setTimeout(() => reject(new Error("Native restore event timed out")), 5000);
      win.once("restore", () => { clearTimeout(timeout); resolve(true); });
      app.emit("open-url", { preventDefault() {} }, url);
    }), url);
    await minimize();
    await openAndRestore("pneuma://open");
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((win) => win.isMinimized())), false);
    checks.push("minimized launcher restores through pneuma://open");
    const importUrl = "https://example.invalid/e2e-import.pneuma";
    await minimize();
    await openAndRestore(`pneuma://import/${encodeURIComponent(importUrl)}`);
    await page.getByText("Intentional import fixture; no files imported", { exact: true }).waitFor();
    const imported = JSON.parse(await readFile(join(fixture.root, "import-request.json"), "utf8"));
    assert.equal(imported.url, importUrl);
    state = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.id));
    assert.equal(state.length, 1);
    checks.push("import deep link restores/reuses minimized launcher and preserves decoded query payload (import API safely stubbed)");
    const pidsBefore = await readFile(fixture.pidsFile, "utf8");
    await page.close();
    const reopenedPromise = app.waitForEvent("window");
    await app.evaluate(({ app }) => app.emit("open-url", { preventDefault() {} }, "pneuma://open"));
    const reopened = await reopenedPromise;
    await reopened.getByRole("button", { name: /^All Modes \(/ }).waitFor();
    assert.equal(await readFile(fixture.pidsFile, "utf8"), pidsBefore, "Reopening launcher spawned an extra service");
    checks.push("closing/reopening launcher preserves Bun service and restores usable content");
  }
  assert.equal(run.errors.length, 0, "Unexpected renderer errors");
  return { scenario, checks, home: fixture.home };
}

const samples = [];
const e2e = [];
for (const name of scenarioNames) {
  const config = { ...scenarios[name], blockImport: runE2E, trackRegistry: runE2E && name === "slow-registry" };
  const warmFixture = config.warm ? await fixtureFor(name, config) : null;
  try {
    if (warmFixture) {
      const prime = await launch(warmFixture, `${name}-prime`);
      await close(prime, `${name}-prime`);
    }
    for (let index = 0; index < sampleCount; index++) {
      const fixture = warmFixture ?? await fixtureFor(name, config);
      const sampleName = `${label}-${name}-${index + 1}`;
      try {
        const run = await launch(fixture, sampleName);
        samples.push({ scenario: name, ...run.result });
        await appendFile(join(out, "samples.jsonl"), JSON.stringify({ scenario: name, ...run.result }) + "\n");
        console.log(`${sampleName}: shown=${run.result.shownMs}ms local=${run.result.localReadyMs}ms`);
        try {
          if (runE2E && index === 0) e2e.push(await smoke(run, name));
        } catch (error) {
          for (const [index, page] of run.app.windows().entries()) await page.screenshot({ path: join(out, `${sampleName}-smoke-failure-${index}.png`), timeout: 5000 }).catch(() => {});
          await writeFile(join(out, `${sampleName}-smoke-failure.json`), JSON.stringify({ error: String(error), events: run.result.events, responses: run.result.responseEvents }, null, 2));
          throw error;
        } finally { await close(run, sampleName); }
      } finally { if (!warmFixture) await removeFixture(fixture); }
    }
  } finally { if (warmFixture) await removeFixture(warmFixture); }
}
if (runE2E) {
  const fixture = await fixtureFor("background", { background: true });
  try {
    const run = await launch(fixture, "background-handoff");
    e2e.push({ scenario: "background-handoff", ...run.result });
    await close(run, "background-handoff");
  } finally { await removeFixture(fixture); }
}
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summary = Object.fromEntries(scenarioNames.map((scenario) => {
  const rows = samples.filter((row) => row.scenario === scenario);
  return [scenario, Object.fromEntries(["shownMs", "localReadyMs"].map((key) => [key, {
    median: percentile(rows.map((row) => row[key]), .5), p90: percentile(rows.map((row) => row[key]), .9),
    min: Math.min(...rows.map((row) => row[key])), max: Math.max(...rows.map((row) => row[key])),
  }]))];
}));
await writeFile(join(out, "summary.json"), JSON.stringify({ metadata, summary, e2e }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Evidence: ${out}`);
