/**
 * File watcher tests.
 *
 * Unit tests for the exported pure functions (extractWatchExtensions,
 * matchesWatchPatterns, buildIgnoreMatcher) plus integration tests running
 * the real chokidar watcher against a temp workspace.
 *
 * The buildIgnoreMatcher suite pins the chokidar v4+ regression fix: chokidar
 * removed glob support, so string `ignored` entries are exact-equality
 * matches — the DEFAULT_IGNORE globs silently matched nothing and session
 * state (`.pneuma/thumbnail.png`, `history.json`, …) leaked into
 * content_update broadcasts, reloading every slide iframe (viewer flicker).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FSWatcher } from "chokidar";
import {
  extractWatchExtensions,
  matchesWatchPatterns,
  buildIgnoreMatcher,
  startFileWatcher,
  type FileUpdate,
} from "../file-watcher.js";
import type { ViewerConfig } from "../../core/types/mode-manifest.js";

const SLIDE_VIEWER: ViewerConfig = {
  watchPatterns: ["**/slides/*.html", "**/manifest.json", "**/theme.css", "**/assets/**/*"],
  ignorePatterns: [],
  serveDir: ".",
};

// ── extractWatchExtensions ──────────────────────────────────────────────────

describe("extractWatchExtensions", () => {
  test("extracts .md from **/*.md", () => {
    expect(extractWatchExtensions(["**/*.md"])).toEqual(new Set([".md"]));
  });

  test("extracts .html from slides/*.html", () => {
    expect(extractWatchExtensions(["slides/*.html"])).toEqual(new Set([".html"]));
  });

  test("extracts .json from literal filename manifest.json", () => {
    expect(extractWatchExtensions(["manifest.json"])).toEqual(new Set([".json"]));
  });

  test("extracts .css from literal filename theme.css", () => {
    expect(extractWatchExtensions(["theme.css"])).toEqual(new Set([".css"]));
  });

  test("extracts multiple extensions from mixed patterns", () => {
    expect(extractWatchExtensions(["**/*.md", "slides/*.html", "theme.css"])).toEqual(
      new Set([".md", ".html", ".css"]),
    );
  });

  test("returns null for wildcard-only pattern assets/**/*", () => {
    expect(extractWatchExtensions(["assets/**/*"])).toBeNull();
  });

  test("returns null for empty array", () => {
    expect(extractWatchExtensions([])).toBeNull();
  });

  test("extracts extensions from mixed patterns with some wildcards", () => {
    expect(extractWatchExtensions(["assets/**/*", "**/*.md"])).toEqual(new Set([".md"]));
  });

  test("deduplicates same extension from multiple patterns", () => {
    const result = extractWatchExtensions(["**/*.md", "docs/*.md"]);
    expect(result).toEqual(new Set([".md"]));
    expect(result!.size).toBe(1);
  });
});

// ── matchesWatchPatterns ────────────────────────────────────────────────────

describe("matchesWatchPatterns", () => {
  test("matches .md extension", () => {
    expect(matchesWatchPatterns("README.md", new Set([".md"]))).toBe(true);
  });

  test("matches nested path with correct extension", () => {
    expect(matchesWatchPatterns("docs/guide/intro.md", new Set([".md"]))).toBe(true);
  });

  test("case-insensitive matching", () => {
    expect(matchesWatchPatterns("README.MD", new Set([".md"]))).toBe(true);
  });

  test("returns false for non-matching extension", () => {
    expect(matchesWatchPatterns("style.css", new Set([".md"]))).toBe(false);
  });

  test("returns false for file without extension", () => {
    expect(matchesWatchPatterns("Makefile", new Set([".md"]))).toBe(false);
  });

  test("returns true for any file when watchExtensions is null (watch everything)", () => {
    expect(matchesWatchPatterns("anything.xyz", null)).toBe(true);
    expect(matchesWatchPatterns("no-ext", null)).toBe(true);
  });
});

// ── buildIgnoreMatcher ──────────────────────────────────────────────────────

describe("buildIgnoreMatcher", () => {
  const ws = "/tmp/pneuma-ws";

  describe("quick-session topology (stateDir = <ws>/.pneuma)", () => {
    const ignored = buildIgnoreMatcher(ws, SLIDE_VIEWER, join(ws, ".pneuma"));

    test("ignores session state under .pneuma/ (the flicker loop)", () => {
      expect(ignored(join(ws, ".pneuma/thumbnail.png"))).toBe(true);
      expect(ignored(join(ws, ".pneuma/history.json"))).toBe(true);
      expect(ignored(join(ws, ".pneuma/captures/shot.png"))).toBe(true);
      // Bare dir itself is pruned so chokidar never descends
      expect(ignored(join(ws, ".pneuma"))).toBe(true);
    });

    test("ignores DEFAULT_IGNORE entries (globs compiled, not passed raw)", () => {
      expect(ignored(join(ws, ".git/objects/ab/cd"))).toBe(true);
      expect(ignored(join(ws, "node_modules/pkg/index.js"))).toBe(true);
      expect(ignored(join(ws, ".DS_Store"))).toBe(true);
      expect(ignored(join(ws, "sub/.DS_Store"))).toBe(true);
      expect(ignored(join(ws, "CLAUDE.md"))).toBe(true);
      expect(ignored(join(ws, ".claude/skills/x/SKILL.md"))).toBe(true);
      expect(ignored(join(ws, "debug.log"))).toBe(true);
    });

    test("keeps mode content watched", () => {
      expect(ignored(join(ws, "manifest.json"))).toBe(false);
      expect(ignored(join(ws, "slides/slide-01.html"))).toBe(false);
      expect(ignored(join(ws, "theme.css"))).toBe(false);
      expect(ignored(join(ws, "assets/img.png"))).toBe(false);
      expect(ignored(join(ws, "zh-dark/slides/slide-01.html"))).toBe(false);
    });

    test("workspace root itself is never ignored", () => {
      expect(ignored(ws)).toBe(false);
    });

    test("paths outside the workspace are never ignored", () => {
      expect(ignored("/somewhere/else/.pneuma/thumbnail.png")).toBe(false);
    });
  });

  describe("project-session topology (stateDir === workspace)", () => {
    const ignored = buildIgnoreMatcher(ws, SLIDE_VIEWER, ws);

    test("ignores root-anchored plumbing files", () => {
      expect(ignored(join(ws, "history.json"))).toBe(true);
      expect(ignored(join(ws, "session.json"))).toBe(true);
      expect(ignored(join(ws, "thumbnail.png"))).toBe(true);
      expect(ignored(join(ws, "checkpoints.jsonl"))).toBe(true);
      expect(ignored(join(ws, "shadow.git/objects/ab/cd"))).toBe(true);
      expect(ignored(join(ws, "captures/shot.png"))).toBe(true);
    });

    test("same-named files inside content subdirs stay watched", () => {
      expect(ignored(join(ws, "deck/history.json"))).toBe(false);
      expect(ignored(join(ws, "assets/thumbnail.png"))).toBe(false);
    });

    test("content at the workspace root stays watched", () => {
      expect(ignored(join(ws, "manifest.json"))).toBe(false);
      expect(ignored(join(ws, "slides/slide-01.html"))).toBe(false);
    });
  });

  test("mode ignorePatterns are compiled too (with **/ dir prefixing)", () => {
    const ignored = buildIgnoreMatcher(
      ws,
      { ...SLIDE_VIEWER, ignorePatterns: ["drafts/**", "*.tmp"] },
    );
    expect(ignored(join(ws, "drafts/a.html"))).toBe(true);
    expect(ignored(join(ws, "sub/drafts/a.html"))).toBe(true);
    expect(ignored(join(ws, "note.tmp"))).toBe(true);
    expect(ignored(join(ws, "slides/slide-01.html"))).toBe(false);
  });
});

// ── startFileWatcher integration (real chokidar, real filesystem) ───────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// awaitWriteFinish stability (200ms) + debounce (300ms) + headroom.
const EVENT_WAIT_MS = 900;

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function makeWorkspace(): string {
  // No pre-existing files: chokidar can echo a late `add` for files created
  // just before watch() (awaitWriteFinish stability tracking defeats
  // ignoreInitial), which would race the assertions below.
  const ws = mkdtempSync(join(tmpdir(), "pneuma-watcher-"));
  mkdirSync(join(ws, "slides"), { recursive: true });
  cleanup.push(() => rmSync(ws, { recursive: true, force: true }));
  return ws;
}

function collectEvents(
  ws: string,
  stateDir: string,
): { events: FileUpdate[]; watcher: FSWatcher } {
  const events: FileUpdate[] = [];
  const watcher = startFileWatcher(ws, SLIDE_VIEWER, (files) => events.push(...files), {
    stateDir,
  });
  cleanup.push(() => watcher.close());
  return { events, watcher };
}

describe("startFileWatcher (integration)", () => {
  test("quick topology: .pneuma state writes emit nothing; content writes emit", async () => {
    const ws = makeWorkspace();
    mkdirSync(join(ws, ".pneuma"), { recursive: true });
    const { events } = collectEvents(ws, join(ws, ".pneuma"));
    await sleep(400); // let the watcher settle
    // Files created just before watch() can still echo an `add` despite
    // ignoreInitial (awaitWriteFinish stability tracking) — discard them.
    events.length = 0;

    // The flicker loop's exact writes: session thumbnail + history autosave.
    writeFileSync(join(ws, ".pneuma", "thumbnail.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(ws, ".pneuma", "history.json"), JSON.stringify({ messages: [1] }));
    await sleep(EVENT_WAIT_MS);
    expect(events).toEqual([]);

    // Sanity: real content still flows.
    writeFileSync(join(ws, "slides", "slide-01.html"), "<h1>hi</h1>");
    await sleep(EVENT_WAIT_MS);
    expect(events.map((e) => e.path)).toEqual(["slides/slide-01.html"]);
  }, 15_000);

  test("project topology: root plumbing emits nothing; content and images emit", async () => {
    const ws = makeWorkspace();
    const { events } = collectEvents(ws, ws); // stateDir === workspace
    await sleep(400);
    events.length = 0; // discard startup add-echoes (see quick-topology test)

    writeFileSync(join(ws, "thumbnail.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(ws, "history.json"), JSON.stringify({ messages: [1] }));
    await sleep(EVENT_WAIT_MS);
    expect(events).toEqual([]);

    mkdirSync(join(ws, "assets"), { recursive: true });
    writeFileSync(join(ws, "assets", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(ws, "slides", "slide-01.html"), "<h1>hi</h1>");
    await sleep(EVENT_WAIT_MS);
    const paths = events.map((e) => e.path).sort();
    expect(paths).toEqual(["assets/logo.png", "slides/slide-01.html"]);
  }, 15_000);
});
