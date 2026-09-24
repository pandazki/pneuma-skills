/**
 * Watcher contract suite — every past watcher incident as a regression case,
 * run against every backend (`server/watch/`).
 *
 * The platform default (native on macOS, chokidar on Linux and Windows) is
 * the one that ships; the other backend runs too, because it is the rollback
 * (`PNEUMA_WATCHER`) and the fallback. Where a backend has a KNOWN gap on this
 * platform the case is skipped with the reason, never weakened:
 *
 * - chokidar on macOS opens one `fs.watch` per path. Under Bun every
 *   `fs.watch` shares one FSEventStream that is rebuilt on each add/close
 *   (events in the gap are lost), and registration is superlinear (17.7 s
 *   for 1,200 files). The large-tree and rename-over-with-churn cases are
 *   exactly that failure, so they are skipped for chokidar on macOS.
 *
 * Each session serves the cold-start snapshot (`readFileSnapshot`, what
 * `GET /api/files` returns) right after the watcher is created, as a browser
 * loading the page does, unless a case opts out (`snapshot: false`). A delete
 * is sent for a path the layer knew (indexed at creation or reported since)
 * or one a browser may hold.
 *
 * Every timing-sensitive wait is bounded and names what it waited for. A
 * "nothing arrived" assertion is closed by a sentinel write that must arrive,
 * not by a fixed sleep. Each registration is proven live before its case
 * runs (`provenLive`): two Bun defects below the layer can otherwise eat the
 * first write of a case, and a re-registration is logged when one does.
 */

import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import fs, {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewerConfig } from "../../core/types/mode-manifest.js";
import type { WatcherBackendKind } from "../../core/types/workspace-watcher.js";
import {
  createSessionWatcher,
  readFileSnapshot,
  registerSelfDelete,
  registerSelfWrite,
  startFileWatcher,
  startProxyWatcher,
  type FileUpdate,
} from "../file-watcher.js";
import { chokidarBackend } from "../watch/chokidar.js";
import { createWorkspaceWatcher, resolveWatcherBackend, type WatchEvent, type WorkspaceWatcher } from "../watch/index.js";
import { nativeBackend } from "../watch/native.js";
import type { WatchBackend, WatchSink } from "../watch/types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const PLATFORM_DEFAULT = resolveWatcherBackend({}, process.platform).kind;
const BACKENDS: WatcherBackendKind[] = ["native", "chokidar"];
const IMPLS: Record<WatcherBackendKind, WatchBackend> = { native: nativeBackend, chokidar: chokidarBackend };

/** Everything is watched, so only the ignore rules can keep a path quiet. */
const ALL_VIEWER: ViewerConfig = { watchPatterns: ["**/*"], ignorePatterns: [], serveDir: "." };
const SLIDE_VIEWER: ViewerConfig = {
  watchPatterns: ["**/slides/*.html", "**/manifest.json", "**/theme.css", "**/assets/**/*"],
  ignorePatterns: [],
  serveDir: ".",
};
const JSON_VIEWER: ViewerConfig = { watchPatterns: ["**/*.json"], ignorePatterns: [], serveDir: "." };
/** doc mode's shape: the patterns name Markdown only, and pages display images beside them. */
const DOC_VIEWER: ViewerConfig = { watchPatterns: ["**/*.md"], ignorePatterns: [], serveDir: "." };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Headroom after a sentinel arrives, before asserting that nothing else did. */
const GRACE_MS = 150;

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  setSystemTime();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function waitFor<T>(
  what: string,
  probe: () => T | undefined | null | false,
  timeoutMs: number,
  seen?: () => unknown,
): Promise<T> {
  const start = performance.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (performance.now() - start > timeoutMs) {
      throw new Error(
        `timed out after ${timeoutMs} ms waiting for ${what}` +
          (seen ? `; saw ${JSON.stringify(seen()).slice(0, 2_000)}` : ""),
      );
    }
    await Bun.sleep(10);
  }
}

interface Session {
  ws: string;
  events: FileUpdate[];
  watcher: WorkspaceWatcher;
  /** Watchers the harness had to register before one was proven live (normally 1). */
  registrations: number;
  /** `ready` time of the live registration. */
  readyMs: number;
}

async function openSession(
  backend: WatcherBackendKind | WatchBackend,
  viewer: ViewerConfig,
  prepare?: (ws: string) => void,
  options: { snapshot?: boolean } = {},
): Promise<Session> {
  const ws = tempDir("pneuma-watch-contract-");
  prepare?.(ws);
  const stateDir = join(ws, ".pneuma");
  const events: FileUpdate[] = [];
  for (let registrations = 1; ; registrations++) {
    const t0 = performance.now();
    const watcher = createSessionWatcher(ws, viewer, { stateDir, backend });
    const files = startFileWatcher(ws, viewer, (batch) => events.push(...batch), { stateDir, watcher });
    cleanup.push(() => watcher.close());
    cleanup.push(() => files.close());
    if (options.snapshot !== false) readFileSnapshot(ws, viewer.watchPatterns);
    await watcher.ready;
    const readyMs = performance.now() - t0;
    if (await provenLive(watcher, ws)) return { ws, events, watcher, registrations, readyMs };
    if (registrations >= 3) {
      throw new Error(`${watcher.kind} watcher on ${ws} heard nothing after ${registrations} registrations`);
    }
    console.warn(
      `[watch-contract] ${watcher.kind}: Bun delivered no events to a fresh watch on ${ws}; re-registering`,
    );
    await files.close();
    await watcher.close();
  }
}

/**
 * Two Bun 1.4.0 macOS defects sit below the layer, and the cases here test
 * the layer, so each registration is proven live before a case runs:
 *
 * - chokidar opens one `fs.watch` per path; a write made while any watch in
 *   the process is added or closed can be lost (why it is not the macOS
 *   default). Rewriting the probe gets through.
 * - After add/close churn in the process, a fresh recursive `fs.watch` has
 *   come up receiving NO callbacks (0 raw events for 3 s, while a fresh watch
 *   on the same root heard). Rewriting does not help; the caller re-registers.
 *   Production registers each root once and never churns (see the rules).
 *
 * The probe is any notice: `lastEventAt` moves before write stability.
 */
async function provenLive(watcher: WorkspaceWatcher, ws: string): Promise<boolean> {
  const before = watcher.health().lastEventAt;
  const heard = () => watcher.health().lastEventAt !== before;
  for (let attempt = 1; attempt <= 3 && !heard(); attempt++) {
    writeFileSync(join(ws, "watch-liveness.probe"), String(attempt));
    const t0 = performance.now();
    while (!heard() && performance.now() - t0 < 400) await Bun.sleep(5);
  }
  return heard();
}

function updateFor(s: Session, path: string, content?: string): FileUpdate | undefined {
  return s.events.find((e) => e.path === path && !e.deleted && (content === undefined || e.content === content));
}

function deleteFor(s: Session, path: string): FileUpdate | undefined {
  return s.events.find((e) => e.path === path && e.deleted);
}

async function expectUpdate(s: Session, path: string, content?: string, timeoutMs = 3_000): Promise<FileUpdate> {
  return waitFor(`an update for ${path}${content === undefined ? "" : ` with ${JSON.stringify(content)}`}`,
    () => updateFor(s, path, content), timeoutMs, () => s.events);
}

async function expectDelete(s: Session, path: string, timeoutMs = 3_000): Promise<FileUpdate> {
  return waitFor(`a delete for ${path}`, () => deleteFor(s, path), timeoutMs, () => s.events);
}

/** Write a watched sentinel, wait until it arrives, then allow a short grace. */
async function settleOn(s: Session, rel: string, content: string): Promise<void> {
  mkdirSync(join(s.ws, rel, ".."), { recursive: true });
  writeFileSync(join(s.ws, rel), content);
  await expectUpdate(s, rel, content);
  await Bun.sleep(GRACE_MS);
}

/**
 * Build `rel` (a directory) outside the workspace, then rename it in. FSEvents
 * can echo writes made just before a watch registers, and an echoed file is
 * reported (so a browser holds it); files created elsewhere and moved in have
 * no creation events under the root, so they are known to the layer only
 * through its index.
 */
function moveIn(ws: string, rel: string, files: Record<string, string>): void {
  const staging = tempDir("pneuma-watch-staging-");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(staging, "dir", name, ".."), { recursive: true });
    writeFileSync(join(staging, "dir", name), content);
  }
  mkdirSync(join(ws, rel, ".."), { recursive: true });
  renameSync(join(staging, "dir"), join(ws, rel));
}

/** `writeJsonAtomic` as mode scripts do it: temp file beside the target, then rename over. */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

/** 400 directories two levels deep, `filesPerDir` JSON files in each. */
function makeTree(root: string, dirs: number, filesPerDir: number): void {
  const side = Math.ceil(Math.sqrt(dirs));
  let made = 0;
  for (let i = 0; i < side && made < dirs; i++) {
    for (let j = 0; j < side && made < dirs; j++, made++) {
      const leaf = join(root, `d${i}`, `s${j}`);
      mkdirSync(leaf, { recursive: true });
      for (let k = 0; k < filesPerDir; k++) writeFileSync(join(leaf, `f${k}.json`), `{"i":${k}}`);
    }
  }
}

/** Is the temp volume case-insensitive (APFS and NTFS defaults)? */
const CASE_INSENSITIVE_TMP = (() => {
  const dir = mkdtempSync(join(tmpdir(), "pneuma-case-probe-"));
  writeFileSync(join(dir, "probe"), "");
  const insensitive = existsSync(join(dir, "PROBE"));
  rmSync(dir, { recursive: true, force: true });
  return insensitive;
})();

/**
 * A real backend whose notices can be dropped (`blackout`) and which can
 * report an OS overflow on demand — the shape of Linux IN_Q_OVERFLOW and
 * Windows buffer overflow, which reach Bun's `fs.watch` as a null filename.
 */
function lossy(kind: WatcherBackendKind) {
  const control = { blackout: false, overflow: () => {}, dropped: [] as string[] };
  const backend: WatchBackend = (opts, sink) => {
    control.overflow = () => sink.overflow();
    return IMPLS[kind](opts, {
      notice: (rel) => {
        if (control.blackout) control.dropped.push(rel.replaceAll("\\", "/"));
        else sink.notice(rel);
      },
      overflow: () => sink.overflow(),
      error: (err) => sink.error(err),
    });
  };
  return { backend, control };
}

function knownGap(kind: WatcherBackendKind, gaps: Partial<Record<NodeJS.Platform, WatcherBackendKind[]>>): boolean {
  return (gaps[process.platform] ?? []).includes(kind);
}

// ── Backend selection ───────────────────────────────────────────────────────

describe("backend selection", () => {
  test("platform defaults: native on macOS, chokidar on Linux and Windows", () => {
    expect(resolveWatcherBackend({}, "darwin")).toEqual({ kind: "native", source: "default" });
    expect(resolveWatcherBackend({}, "linux")).toEqual({ kind: "chokidar", source: "default" });
    expect(resolveWatcherBackend({}, "win32")).toEqual({ kind: "chokidar", source: "default" });
  });

  test("PNEUMA_WATCHER overrides the default on any platform", () => {
    expect(resolveWatcherBackend({ PNEUMA_WATCHER: "chokidar" }, "darwin")).toEqual({ kind: "chokidar", source: "env" });
    expect(resolveWatcherBackend({ PNEUMA_WATCHER: "native" }, "linux")).toEqual({ kind: "native", source: "env" });
  });

  test("an unknown PNEUMA_WATCHER value keeps the default and is reported", () => {
    expect(resolveWatcherBackend({ PNEUMA_WATCHER: "polling" }, "darwin")).toEqual({
      kind: "native",
      source: "default",
      invalid: "polling",
    });
  });
});

// ── The contract, per backend ───────────────────────────────────────────────
//
// Order matters under Bun on macOS: every `fs.watch` shares one FSEventStream,
// and after heavy add/close churn a NEW recursive watch has been observed to
// receive no callbacks at all (0 raw events for 3 s while a fresh watch on the
// same root heard). chokidar's per-path watches are that churn, so the native
// cases (and the one-watch spy) run before any chokidar case. Production never
// churns: it registers each root once.

function contractCases(kind: WatcherBackendKind): void {
  // Incident: chokidar v4+ compares string `ignored` entries by equality, so
  // the DEFAULT_IGNORE globs matched nothing and session state looped back as
  // image updates (the viewer flicker).
  test("dead ignores: session state, VCS and dependency writes emit nothing", async () => {
    const s = await openSession(kind, ALL_VIEWER, (ws) => {
      mkdirSync(join(ws, ".pneuma"), { recursive: true });
      mkdirSync(join(ws, ".git", "objects"), { recursive: true });
      mkdirSync(join(ws, "node_modules", "p"), { recursive: true });
    });
    writeFileSync(join(s.ws, ".pneuma", "thumbnail.png"), PNG);
    writeFileSync(join(s.ws, ".pneuma", "history.json"), "[1]");
    writeFileSync(join(s.ws, ".git", "objects", "x"), "blob");
    writeFileSync(join(s.ws, "node_modules", "p", "i.js"), "module.exports = 1");
    mkdirSync(join(s.ws, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(s.ws, ".git", "refs", "heads", "main"), "abc");
    await settleOn(s, "content/page.md", "# still flows");
    expect(s.events.filter((e) => /^(\.pneuma|\.git|node_modules)\//.test(e.path))).toEqual([]);
  }, 10_000);

  // Incident: a grounding agent built a 12,704-file virtualenv inside a course
  // directory; the watcher swallowed the flood and went silent for good.
  test("virtualenv flood: 5,000 writes under .venv do not silence or stall the watcher", async () => {
    const s = await openSession(kind, ALL_VIEWER, (ws) => mkdirSync(join(ws, "bayes", "evidence"), { recursive: true }));
    const venv = join(s.ws, "bayes", "evidence", ".venv", "lib", "python3.14", "site-packages");
    const cpu0 = process.cpuUsage();
    const flood = Bun.spawn([process.execPath, "-e", `
      const { mkdirSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      const base = ${JSON.stringify(venv)};
      for (let p = 0; p < 50; p++) mkdirSync(join(base, "pkg" + p), { recursive: true });
      for (let i = 0; i < 5000; i++) writeFileSync(join(base, "pkg" + (i % 50), "m" + i + ".py"), "x = " + i);
    `], { stdout: "ignore", stderr: "inherit" });
    expect(await flood.exited).toBe(0);

    writeFileSync(join(s.ws, "bayes", "course.json"), `{"n":1}`);
    await expectUpdate(s, "bayes/course.json", `{"n":1}`, 2_000);
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1_000;
    console.log(`[watch-contract] ${kind}: absorbing the 5,000-write flood cost ${cpuMs.toFixed(0)} ms CPU`);

    // Not dead: a later write still arrives.
    await Bun.sleep(300);
    writeFileSync(join(s.ws, "bayes", "course.json"), `{"n":2}`);
    await expectUpdate(s, "bayes/course.json", `{"n":2}`, 2_000);

    expect(s.events.filter((e) => e.path.includes(".venv/"))).toEqual([]);
    // The writes happen in a child process; this is the watcher's own cost of
    // absorbing (native: receiving and filtering) 5,000+ events. Measured on
    // macOS arm64, Bun 1.4.0, 2026-09-24: native 20-22 ms, chokidar 13-14 ms.
    // The budget leaves ~30x for slow CI runners and still catches a per-event
    // stat or a per-path registration.
    expect(cpuMs).toBeLessThan(750);
    expect(s.watcher.health().degraded).toBe(false);
  }, 20_000);

  // Incident: registration cost. chokidar under Bun on macOS registers one
  // `fs.watch` per path, superlinearly (17.7 s for 1,200 files), on the main
  // thread; a sprite workspace answered no request for 25-40 s.
  test.skipIf(knownGap(kind, { darwin: ["chokidar"] }))(
    "large-tree start: 400 dirs / 1,200 files ready within 1 s; a write 100 ms after ready arrives",
    async () => {
      const s = await openSession(kind, JSON_VIEWER, (ws) => makeTree(ws, 400, 3));
      expect(s.readyMs).toBeLessThan(1_000);

      await Bun.sleep(100);
      writeFileSync(join(s.ws, "d7", "s3", "f1.json"), `{"late":true}`);
      await expectUpdate(s, "d7/s3/f1.json", `{"late":true}`);
      const health = s.watcher.health();
      expect(health).toMatchObject({ backend: kind, ready: true, degraded: false });
      expect(typeof health.lastEventAt).toBe("number");
    },
    15_000,
  );

  // Incident: "replacements lost" — backlot's `cut --finish` rename-over of
  // cut/edl.json went unreported on a 391-directory project because every
  // chokidar add/close rebuilt Bun's FSEventStream and dropped the events in
  // flight. The churn around each replacement is that shape.
  test.skipIf(knownGap(kind, { darwin: ["chokidar"] }))(
    "rename-over with churn: three writeJsonAtomic replacements in a 400-dir tree each arrive with their content",
    async () => {
      const s = await openSession(kind, JSON_VIEWER, (ws) => {
        makeTree(ws, 400, 1);
        mkdirSync(join(ws, "film", "cut"), { recursive: true });
        writeFileSync(join(ws, "film", "cut", "edl.json"), `{"v":0}`);
      });
      const target = join(s.ws, "film", "cut", "edl.json");
      for (let i = 1; i <= 3; i++) {
        // A scratch file and a `.work/` segment appear and vanish around the
        // replacement, as `cut --final` / `--finish` do.
        writeFileSync(join(s.ws, "d3", "s2", `scratch-${i}.json`), "{}");
        mkdirSync(join(s.ws, "film", ".work", `seg-${i}`), { recursive: true });
        writeFileSync(join(s.ws, "film", ".work", `seg-${i}`, "part.json"), "{}");
        atomicWrite(target, `{"v":${i}}`);
        rmSync(join(s.ws, "d3", "s2", `scratch-${i}.json`));
        rmSync(join(s.ws, "film", ".work"), { recursive: true });
        await expectUpdate(s, "film/cut/edl.json", `{"v":${i}}`);
      }
    },
    20_000,
  );

  test("late add: a directory created after start and a file inside it arrive", async () => {
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => mkdirSync(join(ws, "slides"), { recursive: true }));
    mkdirSync(join(s.ws, "deck", "slides"), { recursive: true });
    writeFileSync(join(s.ws, "deck", "slides", "late.html"), "<p>late</p>");
    await expectUpdate(s, "deck/slides/late.html", "<p>late</p>");
  }, 10_000);

  // A directory renamed into or out of the tree is ONE event on a recursive
  // native watch (FSEvents / inotify never list its children). Mode scripts
  // assemble output in a staging directory and move it into place.
  test("a directory moved in reports its files; moved out reports them deleted", async () => {
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => mkdirSync(join(ws, "slides"), { recursive: true }));
    const stage = tempDir("pneuma-watch-stage-");
    mkdirSync(join(stage, "pack", "slides"), { recursive: true });
    writeFileSync(join(stage, "pack", "slides", "a.html"), "<p>a</p>");
    writeFileSync(join(stage, "pack", "slides", "b.html"), "<p>b</p>");

    renameSync(join(stage, "pack"), join(s.ws, "pack"));
    await expectUpdate(s, "pack/slides/a.html", "<p>a</p>");
    await expectUpdate(s, "pack/slides/b.html", "<p>b</p>");

    renameSync(join(s.ws, "pack"), join(stage, "pack-out"));
    await expectDelete(s, "pack/slides/a.html");
    await expectDelete(s, "pack/slides/b.html");
  }, 10_000);

  // F12: proxy.json hot-reloads from the same root watcher, including a file
  // created after start — even when a mode's ignore patterns would hide it.
  test("proxy.json created after start hot-loads; removal clears it", async () => {
    const ignoringJson: ViewerConfig = { ...SLIDE_VIEWER, ignorePatterns: ["*.json"] };
    const s = await openSession(kind, ignoringJson);
    const configs: (Record<string, unknown> | null)[] = [];
    const stop = startProxyWatcher(s.watcher, (config) => configs.push(config));
    cleanup.push(stop);

    writeFileSync(join(s.ws, "proxy.json"), JSON.stringify({ api: { target: "https://example.com" } }));
    await waitFor("proxy.json load", () => configs.find((c) => c && "api" in c), 3_000, () => configs);
    unlinkSync(join(s.ws, "proxy.json"));
    await waitFor("proxy.json clear", () => configs.includes(null), 3_000, () => configs);
    // The content watcher still honours the mode's ignore for proxy.json.
    expect(s.events.filter((e) => e.path === "proxy.json")).toEqual([]);
  }, 10_000);

  // Finding 19 of the 2026-09-23 review: changes reached through a symlink to
  // outside the workspace must never be read or sent.
  test("symlinks: outside targets are never read or sent; an in-root link reports the real path only", async () => {
    const outside = realpathSync(tempDir("pneuma-watch-outside-"));
    writeFileSync(join(outside, "theme.css"), "/* before */");
    mkdirSync(join(outside, "dir"), { recursive: true });
    writeFileSync(join(outside, "dir", "leak.html"), "before");
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      mkdirSync(join(ws, "real", "slides"), { recursive: true });
      writeFileSync(join(ws, "real", "slides", "a.html"), "<p>v0</p>");
      symlinkSync(join(outside, "theme.css"), join(ws, "theme.css"));
      symlinkSync(join(outside, "dir"), join(ws, "slides", "ext"));
      symlinkSync(join(ws, "real"), join(ws, "alias"));
    });

    writeFileSync(join(outside, "theme.css"), "/* OUTSIDE-WATCHER-SENTINEL */");
    writeFileSync(join(outside, "dir", "leak.html"), "OUTSIDE-WATCHER-SENTINEL");
    writeFileSync(join(outside, "dir", "new.html"), "OUTSIDE-WATCHER-SENTINEL");
    // The in-root write is the sentinel: written last, it must arrive.
    writeFileSync(join(s.ws, "real", "slides", "a.html"), "<p>v1</p>");
    await expectUpdate(s, "real/slides/a.html", "<p>v1</p>");
    await Bun.sleep(GRACE_MS);

    expect(s.events.filter((e) => e.content.includes("OUTSIDE-WATCHER-SENTINEL"))).toEqual([]);
    expect(s.events.filter((e) => e.path.startsWith("slides/ext/"))).toEqual([]);
    expect(s.events.filter((e) => e.path.startsWith("alias/"))).toEqual([]);
  }, 10_000);

  // F7: the ONLY place viewer-origin writes are identified. No test drove it
  // through the real watcher before this suite.
  test("self-echo: registered writes and deletes echo as origin self; others as external", async () => {
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      writeFileSync(join(ws, "slides", `gone-${kind}.html`), "<p>bye</p>");
    });
    const rel = (name: string) => `slides/${name}-${kind}.html`;

    registerSelfWrite(rel("mine"), "<p>mine</p>");
    writeFileSync(join(s.ws, rel("mine")), "<p>mine</p>");
    registerSelfWrite(rel("other"), "<p>registered</p>");
    writeFileSync(join(s.ws, rel("other")), "<p>different</p>");
    registerSelfDelete(rel("gone"));
    unlinkSync(join(s.ws, rel("gone")));
    expect((await expectUpdate(s, rel("mine"), "<p>mine</p>")).origin).toBe("self");
    expect((await expectUpdate(s, rel("other"), "<p>different</p>")).origin).toBe("external");
    expect((await expectDelete(s, rel("gone"))).origin).toBe("self");

    // A registration older than its 5 s TTL must not claim a later edit.
    // (Last: the mocked clock would expire the registrations above too.)
    registerSelfWrite(rel("late"), "<p>late</p>");
    setSystemTime(new Date(Date.now() + 6_000));
    writeFileSync(join(s.ws, rel("late")), "<p>late</p>");
    expect((await expectUpdate(s, rel("late"), "<p>late</p>")).origin).toBe("external");
    setSystemTime();
  }, 15_000);

  // F6: deletes are immediate (not behind the 300 ms text debounce), survive
  // `rm -r`, and reach images, which bypass the extension filter.
  test("delete: immediate, per file under rm -r, and for images", async () => {
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      // In the snapshot (`**/slides/*.html`), so a browser holds them.
      mkdirSync(join(ws, "deck", "slides"), { recursive: true });
      mkdirSync(join(ws, "assets"), { recursive: true });
      writeFileSync(join(ws, "slides", "keep.html"), "<p>v0</p>");
      writeFileSync(join(ws, "slides", "gone.html"), "<p>gone</p>");
      writeFileSync(join(ws, "deck", "slides", "a.html"), "a");
      writeFileSync(join(ws, "deck", "slides", "b.html"), "b");
      writeFileSync(join(ws, "assets", "logo.png"), PNG);
    });

    // Issued together: the delete must not wait for the text update's debounce.
    writeFileSync(join(s.ws, "slides", "keep.html"), "<p>v1</p>");
    unlinkSync(join(s.ws, "slides", "gone.html"));
    await expectUpdate(s, "slides/keep.html", "<p>v1</p>");
    const deleted = await expectDelete(s, "slides/gone.html");
    expect(deleted.content).toBe("");
    expect(s.events.indexOf(deleted)).toBeLessThan(s.events.indexOf(updateFor(s, "slides/keep.html", "<p>v1</p>")!));

    rmSync(join(s.ws, "deck"), { recursive: true });
    await expectDelete(s, "deck/slides/a.html");
    await expectDelete(s, "deck/slides/b.html");

    unlinkSync(join(s.ws, "assets", "logo.png"));
    await expectDelete(s, "assets/logo.png");
  }, 10_000);

  // F4: chokidar's awaitWriteFinish moved into the layer. A chunked write must
  // never be read half-written, and an image must not be signalled before its
  // last chunk (with ~11 ms native latency a browser would refetch it early).
  test("stability: a chunked text write is one full update; a chunked PNG is one signal after its last chunk", async () => {
    const s = await openSession(kind, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      mkdirSync(join(ws, "assets"), { recursive: true });
    });

    const text = openSync(join(s.ws, "slides", "chunked.html"), "w");
    writeSync(text, "part1-");
    await Bun.sleep(120);
    writeSync(text, "part2-");
    await Bun.sleep(120);
    writeSync(text, "part3");
    closeSync(text);

    const png = openSync(join(s.ws, "assets", "pic.png"), "w");
    writeSync(png, PNG.subarray(0, 4));
    await Bun.sleep(100);
    const lastChunkAt = s.events.length;
    writeSync(png, PNG.subarray(4));
    closeSync(png);

    await expectUpdate(s, "slides/chunked.html", "part1-part2-part3");
    await expectUpdate(s, "assets/pic.png");
    await settleOn(s, "slides/sentinel.html", "<p>after</p>");

    expect(s.events.filter((e) => e.path === "slides/chunked.html")).toHaveLength(1);
    const images = s.events.filter((e) => e.path === "assets/pic.png");
    expect(images).toHaveLength(1);
    expect(s.events.indexOf(images[0])).toBeGreaterThanOrEqual(lastChunkAt);
  }, 10_000);

  // Linux IN_Q_OVERFLOW / Windows ReadDirectoryChangesW overflow reach Bun's
  // `fs.watch` as a null filename: the OS lost events. The layer rescans.
  test("overflow: a rescan recovers a change and a delete the notices never carried", async () => {
    const { backend, control } = lossy(kind);
    const s = await openSession(backend, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      writeFileSync(join(ws, "slides", "seen.html"), "<p>seen</p>");
    });

    // Nothing may be waiting for stability when the blackout starts: the
    // layer's own stability poll would see a pending file vanish without any
    // notice (correct, but not what this case measures). FSEvents can echo
    // writes made just before registration, so settle first.
    await settleOn(s, "slides/sentinel.html", "<p>settled</p>");
    const blackoutStart = s.events.length;
    control.blackout = true;
    writeFileSync(join(s.ws, "slides", "lost.html"), "<p>lost</p>");
    unlinkSync(join(s.ws, "slides", "seen.html"));
    await Bun.sleep(250); // let the backend deliver the notices this backend drops
    expect(s.events.slice(blackoutStart)).toEqual([]);

    control.blackout = false;
    control.overflow();
    await expectUpdate(s, "slides/lost.html", "<p>lost</p>");
    await expectDelete(s, "slides/seen.html");
  }, 10_000);

  // Review finding (2026-09-24): an overflow rescan tested existence only,
  // so a file replaced by a directory kept its stale file entry and only the
  // directory's children were reported.
  test("overflow: a file replaced by a directory is reported deleted, and its children arrive", async () => {
    const { backend, control } = lossy(kind);
    const s = await openSession(backend, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      writeFileSync(join(ws, "slides", "page.html"), "<p>file</p>");
    });
    await settleOn(s, "slides/sentinel.html", "<p>settled</p>");
    control.blackout = true;
    unlinkSync(join(s.ws, "slides", "page.html"));
    mkdirSync(join(s.ws, "slides", "page.html"));
    writeFileSync(join(s.ws, "slides", "page.html", "child.html"), "<p>child</p>");
    await Bun.sleep(250); // let the backend deliver the notices this backend drops
    control.blackout = false;
    control.overflow();
    await expectUpdate(s, "slides/page.html/child.html", "<p>child</p>");
    await expectDelete(s, "slides/page.html");
  }, 10_000);

  // Review finding (2026-09-24): on a case-insensitive volume `lstat` of the
  // old spelling still succeeds after a case-only rename, so `page.html` was
  // tracked as a live file beside `Page.html` — two entries in the viewer —
  // and no rescan ever removed it.
  test.skipIf(!CASE_INSENSITIVE_TMP)(
    "case-only rename: the old spelling is deleted, with no snapshot fetched, and no rescan resurrects it",
    async () => {
      const { backend, control } = lossy(kind);
      // No snapshot: the old spelling was indexed at creation, which alone
      // makes its delete worth sending (round-3 finding, 2026-09-24).
      const s = await openSession(
        backend,
        SLIDE_VIEWER,
        (ws) => moveIn(ws, "slides", { "page.html": "<p>same</p>" }),
        { snapshot: false },
      );
      await settleOn(s, "slides/sentinel.html", "<p>settled</p>");
      expect(updateFor(s, "slides/page.html")).toBeUndefined(); // never sent: only the index knows it
      const renamedAt = s.events.length;
      renameSync(join(s.ws, "slides", "page.html"), join(s.ws, "slides", "Page.html"));
      await expectUpdate(s, "slides/Page.html", "<p>same</p>");
      await expectDelete(s, "slides/page.html");

      const rescannedAt = s.events.length;
      control.overflow();
      await settleOn(s, "slides/sentinel.html", "<p>after rescan</p>");
      const oldSpelling = (e: FileUpdate) => e.path === "slides/page.html" && !e.deleted;
      expect(s.events.slice(renamedAt).filter(oldSpelling)).toEqual([]);
      expect(s.events.slice(rescannedAt).filter((e) => e.path === "slides/page.html")).toEqual([]);
    },
    10_000,
  );

  // Round-2 finding 1 (2026-09-24): chokidar's `ignoreInitial` hides what
  // changes while it is still registering, and the index was built after its
  // ready from the already-changed tree, so the change was never reported
  // (an edit 610 ms after the session's ready line, chokidar ready at 2.3 s).
  test("registration window: a change, a creation and a delete right after creation all arrive", async () => {
    const ws = tempDir("pneuma-watch-registering-");
    mkdirSync(join(ws, "slides"), { recursive: true });
    writeFileSync(join(ws, "slides", "edited.html"), "<p>before</p>");
    writeFileSync(join(ws, "slides", "removed.html"), "<p>doomed</p>");
    const stateDir = join(ws, ".pneuma");
    const events: FileUpdate[] = [];
    const watcher = createSessionWatcher(ws, SLIDE_VIEWER, { stateDir, backend: kind });
    const files = startFileWatcher(ws, SLIDE_VIEWER, (batch) => events.push(...batch), { stateDir, watcher });
    cleanup.push(() => watcher.close());
    cleanup.push(() => files.close());
    readFileSnapshot(ws, SLIDE_VIEWER.watchPatterns);
    atomicWrite(join(ws, "slides", "edited.html"), "<p>after</p>");
    writeFileSync(join(ws, "slides", "created.html"), "<p>new</p>");
    unlinkSync(join(ws, "slides", "removed.html"));
    await watcher.ready;
    const s: Session = { ws, events, watcher, registrations: 1, readyMs: 0 };
    await expectUpdate(s, "slides/edited.html", "<p>after</p>");
    await expectUpdate(s, "slides/created.html", "<p>new</p>");
    await expectDelete(s, "slides/removed.html");
  }, 10_000);

  // Round-3 finding (2026-09-24): the round-2 delete filter sent a delete only
  // for paths a snapshot listed or an update carried. An image outside the
  // patterns that did not change is neither, so in doc mode deleting the
  // `img/pic.png` a page displays sent nothing and the viewer kept showing it
  // (on main the delete arrived in 113 ms). The layer indexed it at creation.
  test("an image outside the patterns that existed at start is reported deleted", async () => {
    const s = await openSession(kind, DOC_VIEWER, (ws) => {
      mkdirSync(join(ws, "img"), { recursive: true });
      writeFileSync(join(ws, "README.md"), "![pic](img/pic.png)");
      writeFileSync(join(ws, "img", "pic.png"), PNG);
    });
    unlinkSync(join(s.ws, "img", "pic.png"));
    const deleted = await expectDelete(s, "img/pic.png");
    expect(deleted.content).toBe("");
  }, 10_000);

  // Round-2 finding 3 (2026-09-24): 300 scratch files created and renamed
  // away in ~50 ms produced 300 delete frames for paths no browser was ever
  // shown, and filled the 600-event replay buffer.
  test.skipIf(knownGap(kind, { darwin: ["chokidar"] }))(
    "transient files no browser was shown are not reported deleted",
    async () => {
      const s = await openSession(kind, JSON_VIEWER);
      await settleOn(s, "sentinel.json", '{"n":0}');
      const from = s.events.length;
      mkdirSync(join(s.ws, "work"));
      for (let i = 0; i < 100; i++) {
        const f = join(s.ws, "work", `clip-${i}.json`);
        writeFileSync(f, JSON.stringify({ i }));
        renameSync(f, `${f}.done`);
      }
      rmSync(join(s.ws, "work"), { recursive: true, force: true });
      await settleOn(s, "sentinel.json", '{"n":1}');
      expect(s.events.slice(from).filter((e) => e.path.startsWith("work/"))).toEqual([]);
    },
    10_000,
  );

  // The other side of finding 3, and the race the departure "deleted for any
  // vanished path" fixed: a consumer that read the disk itself must not keep
  // a ghost. A page (re)load can list a file the layer has not reported yet.
  test.skipIf(knownGap(kind, { darwin: ["chokidar"] }))(
    "a path a snapshot served is reported deleted, even if it vanished before it was stable",
    async () => {
      const s = await openSession(kind, JSON_VIEWER);
      await settleOn(s, "sentinel.json", '{"n":0}');
      writeFileSync(join(s.ws, "brief.json"), '{"brief":1}');
      readFileSnapshot(s.ws, JSON_VIEWER.watchPatterns);
      unlinkSync(join(s.ws, "brief.json"));
      await expectDelete(s, "brief.json");
    },
    10_000,
  );
}

describe("watcher contract — native backend", () => contractCases("native"));

// ── The macOS churn rule ────────────────────────────────────────────────────

// Under Bun on macOS every `fs.watch` add or close rebuilds the one
// FSEventStream and loses events in flight. The native backend therefore
// opens exactly one `fs.watch` per root and never another at runtime.
describe("one fs.watch per root", () => {
  test("native: one call at start, none for renames, new directories, deletes or chunked writes", async () => {
    const watchSpy = spyOn(fs, "watch");
    cleanup.push(() => watchSpy.mockRestore());
    const s = await openSession("native", JSON_VIEWER, (ws) => {
      makeTree(ws, 20, 2);
      writeFileSync(join(ws, "edl.json"), `{"v":0}`);
    });
    // One call per registration (the harness re-registers only if Bun
    // delivered nothing to a fresh watch; normally once).
    expect(watchSpy).toHaveBeenCalledTimes(s.registrations);

    atomicWrite(join(s.ws, "edl.json"), `{"v":1}`);
    await expectUpdate(s, "edl.json", `{"v":1}`);
    mkdirSync(join(s.ws, "late", "deeper"), { recursive: true });
    writeFileSync(join(s.ws, "late", "deeper", "n.json"), `{"n":1}`);
    await expectUpdate(s, "late/deeper/n.json", `{"n":1}`);
    rmSync(join(s.ws, "late"), { recursive: true });
    await expectDelete(s, "late/deeper/n.json");
    const fd = openSync(join(s.ws, "d0", "s0", "f0.json"), "w");
    writeSync(fd, `{"chunk":`);
    await Bun.sleep(80);
    writeSync(fd, `1}`);
    closeSync(fd);
    await expectUpdate(s, "d0/s0/f0.json", `{"chunk":1}`);

    expect(watchSpy).toHaveBeenCalledTimes(s.registrations);
  }, 15_000);
});

describe("watcher contract — chokidar backend", () => contractCases("chokidar"));

// ── Fallback ────────────────────────────────────────────────────────────────

// Round-2 finding 2 (2026-09-24): under Bun on macOS every `fs.watch` in the
// process shares one FSEventStream, rebuilt from "now" on each add or close.
// In the real session 6 of 29 edits made while projects-cache primed its
// watches were lost. The rebuild's gap is made deterministic here by dropping
// the change's notice; what is under test is that a registration or close
// anywhere in the layer makes every other live watcher reconcile.
describe.skipIf(process.platform !== "darwin")("one FSEventStream per process (macOS)", () => {
  test("a watch registered or closed elsewhere: live watchers recover what the rebuild dropped", async () => {
    const { backend, control } = lossy("native");
    const s = await openSession(backend, SLIDE_VIEWER, (ws) => {
      mkdirSync(join(ws, "slides"), { recursive: true });
      writeFileSync(join(ws, "slides", "page.html"), "<p>v1</p>");
    });
    await settleOn(s, "slides/sentinel.html", "<p>settled</p>");
    const dropped = (rel: string) => waitFor(`the dropped notice for ${rel}`, () => control.dropped.includes(rel), 3_000);

    control.blackout = true;
    atomicWrite(join(s.ws, "slides", "page.html"), "<p>v2</p>");
    await dropped("slides/page.html");
    control.blackout = false;
    const other = createWorkspaceWatcher({ root: tempDir("pneuma-watch-other-"), ignore: () => false, backend: "native" });
    await expectUpdate(s, "slides/page.html", "<p>v2</p>");

    control.dropped.length = 0;
    control.blackout = true;
    unlinkSync(join(s.ws, "slides", "page.html"));
    await dropped("slides/page.html");
    control.blackout = false;
    await other.close();
    await expectDelete(s, "slides/page.html");
  }, 10_000);
});

const enospc = () =>
  Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), { code: "ENOSPC" });

describe("fallback to chokidar", () => {

  test("a native registration failure comes up on chokidar with one warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    const failing: WatchBackend = () => { throw enospc(); };
    const s = await openSession(failing, SLIDE_VIEWER, (ws) => mkdirSync(join(ws, "slides"), { recursive: true }));

    expect(s.watcher.kind).toBe("chokidar");
    expect(s.watcher.health()).toMatchObject({ backend: "chokidar", ready: true, degraded: true });
    const fallbackWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("falling back to chokidar"));
    expect(fallbackWarnings).toHaveLength(1);
    expect(String(fallbackWarnings[0][0])).toContain("ENOSPC");

    writeFileSync(join(s.ws, "slides", "after.html"), "<p>after</p>");
    await expectUpdate(s, "slides/after.html", "<p>after</p>");
  }, 10_000);

  test("partial coverage reported after start (Linux watch limit) also moves to chokidar", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    let closed = 0;
    const partial: WatchBackend = (_opts, sink) => {
      setTimeout(() => sink.error(enospc()), 0);
      return { kind: "native", ready: Promise.resolve(), close: async () => { closed++; } };
    };
    const s = await openSession(partial, SLIDE_VIEWER, (ws) => mkdirSync(join(ws, "slides"), { recursive: true }));
    await waitFor("the switch to chokidar", () => s.watcher.kind === "chokidar", 3_000);
    await s.watcher.ready;
    expect(closed).toBe(1);

    writeFileSync(join(s.ws, "slides", "after.html"), "<p>after</p>");
    await expectUpdate(s, "slides/after.html", "<p>after</p>");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("falling back to chokidar"))).toHaveLength(1);
  }, 10_000);

  // Review finding (2026-09-24): a fallback while the initial walk runs used
  // to leave `ready` resolving before chokidar was listening. chokidar's
  // `ignoreInitial` then swallowed files created during the switch, and the
  // walk had already listed their directory, so they were never known.
  test("a fallback during the initial walk: ready waits for chokidar and the switch loses nothing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    cleanup.push(() => warn.mockRestore());
    const ws = tempDir("pneuma-watch-midwalk-");
    mkdirSync(join(ws, "slides"), { recursive: true });
    writeFileSync(join(ws, "slides", "a.html"), "a");
    let sink: WatchSink | null = null;
    const partial: WatchBackend = (_opts, s) => {
      sink = s;
      return { kind: "native", ready: Promise.resolve(), close: async () => {} };
    };
    let tripped = false;
    // The walk asks the ignore about `slides/a.html` right after listing
    // `slides/`: report the watch limit there, and create a file the listing
    // did not include.
    const ignore = (rel: string) => {
      if (!tripped && rel === "slides/a.html" && sink) {
        tripped = true;
        sink.error(enospc());
        writeFileSync(join(ws, "slides", "during-switch.html"), "during");
      }
      return false;
    };
    const watcher = createWorkspaceWatcher({ root: ws, ignore, backend: partial });
    cleanup.push(() => watcher.close());
    const events: WatchEvent[] = [];
    watcher.subscribe(() => true, (e) => events.push(e));
    await watcher.ready;
    expect(tripped).toBe(true);
    expect(watcher.kind).toBe("chokidar");

    writeFileSync(join(ws, "slides", "after-ready.html"), "after");
    for (const rel of ["slides/during-switch.html", "slides/after-ready.html"]) {
      await waitFor(`a stable event for ${rel}`, () => events.find((e) => e.rel === rel && e.kind === "stable"), 3_000, () => events);
    }
  }, 10_000);

  // Review finding (2026-09-24): a non-ENOENT `lstat` failure during the
  // initial walk became "no such file": an empty index, no warning, and
  // `{ ready: true, degraded: false }`.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "an unreadable entry during the initial scan is logged and reported as degraded",
    async () => {
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      cleanup.push(() => warn.mockRestore());
      const ws = tempDir("pneuma-watch-eacces-");
      mkdirSync(join(ws, "locked"));
      writeFileSync(join(ws, "locked", "f.html"), "x");
      chmodSync(join(ws, "locked"), 0o444); // listable, not searchable: lstat of entries fails EACCES
      cleanup.push(() => chmodSync(join(ws, "locked"), 0o755));
      const watcher = createWorkspaceWatcher({ root: ws, ignore: () => false, backend: PLATFORM_DEFAULT });
      cleanup.push(() => watcher.close());
      await watcher.ready;
      expect(watcher.health()).toMatchObject({ ready: true, degraded: true });
      const warned = warn.mock.calls.map((c) => String(c[0]));
      expect(warned.some((m) => m.includes("locked/f.html") && m.includes("EACCES"))).toBe(true);
    },
  );

  // The one authority for "did the layer know this path": `deleted.known`,
  // true for a path indexed at creation or reported stable since.
  test("deleted events say whether the layer knew the path", async () => {
    const ws = tempDir("pneuma-watch-known-");
    writeFileSync(join(ws, "indexed.md"), "at creation");
    const events: WatchEvent[] = [];
    // Proven live first, as `openSession` does (a fresh watch can come up deaf).
    for (let registrations = 1; ; registrations++) {
      const watcher = createWorkspaceWatcher({ root: ws, ignore: () => false, backend: PLATFORM_DEFAULT });
      cleanup.push(() => watcher.close());
      const unsubscribe = watcher.subscribe(() => true, (e) => events.push(e));
      await watcher.ready;
      if (await provenLive(watcher, ws)) break;
      if (registrations >= 3) throw new Error(`${watcher.kind} watcher on ${ws} heard nothing after ${registrations} registrations`);
      unsubscribe();
      await watcher.close();
    }
    const find = (rel: string, kind: WatchEvent["kind"]) => () => events.find((e) => e.rel === rel && e.kind === kind);

    writeFileSync(join(ws, "reported.md"), "later");
    await waitFor("reported.md to be stable", find("reported.md", "stable"), 3_000, () => events);
    unlinkSync(join(ws, "indexed.md"));
    unlinkSync(join(ws, "reported.md"));
    for (let i = 0; i < 20; i++) {
      const f = join(ws, `scratch-${i}.md`);
      writeFileSync(f, "x");
      renameSync(f, `${f}.done`);
    }
    writeFileSync(join(ws, "sentinel.md"), "s");
    await waitFor("the sentinel", find("sentinel.md", "stable"), 3_000, () => events);

    expect(events.find((e) => e.rel === "indexed.md" && e.kind === "deleted")).toEqual({ kind: "deleted", rel: "indexed.md", known: true });
    expect(events.find((e) => e.rel === "reported.md" && e.kind === "deleted")).toEqual({ kind: "deleted", rel: "reported.md", known: true });
    const scratch = events.filter((e) => e.rel.startsWith("scratch-") && e.kind === "deleted");
    expect(scratch.every((e) => e.kind === "deleted" && e.known === false)).toBe(true);
  }, 10_000);

  test("a missing root is refused at the boundary, not watched", () => {
    expect(() => createWorkspaceWatcher({ root: join(tmpdir(), "pneuma-no-such-root-xyz"), ignore: () => false }))
      .toThrow(/not a directory|ENOENT/);
  });
});

// Keep the default visible in the run log: the blocking backend on this host.
test(`platform default on ${process.platform} is ${PLATFORM_DEFAULT}`, () => {
  expect(BACKENDS).toContain(PLATFORM_DEFAULT);
});
