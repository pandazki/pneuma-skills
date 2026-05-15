/**
 * Tests for `core/library-registry.ts`.
 *
 * Isolation strategy: the registry calls `homedir()` from `node:os`. Bun caches
 * `os.homedir()` at process start (it does NOT re-read `$HOME` at call time),
 * so we use `bun:test`'s `mock.module` to swap the function for one that reads
 * a mutable variable. Each test sets up its own tmpdir and points the
 * mocked-out `homedir` at it.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Home directory mock ─────────────────────────────────────────────────────
//
// `mock.module` is process-global and registered once. We thread the actual
// tmp dir through a mutable closure variable so each test can rotate the home
// root without re-registering the mock.
let currentHome = tmpdir();
mock.module("node:os", () => {
  const real = require("node:os");
  return {
    ...real,
    homedir: () => currentHome,
    default: { ...real, homedir: () => currentHome },
  };
});

// Import AFTER mock registration so the module's top-level `homedir` reference
// resolves to the mocked binding. (Static imports below this point are fine —
// they still go through the mocked `node:os`.)
import {
  detectRepoShape,
  linkLibrary,
  syncLibrary,
  setModeActivated,
  acceptModeUpdate,
  listLibraries,
  unlinkLibrary,
  getLibraryModePath,
  getLibrariesDir,
  getLibraryDir,
  getLibrarySidecarPath,
  readLibrary,
  writeLibrary,
  type RepoShape,
} from "../library-registry.js";
import type { InstalledLibrary } from "../types/library.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeMode(dir: string, name: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.ts"),
    `export const manifest = { name: "${name}", version: "${version}" };\n`,
    "utf-8",
  );
}

function makeRepoRootMode(repoDir: string, name: string, version: string): void {
  makeMode(repoDir, name, version);
}

function makeLibraryJson(repoDir: string, body: unknown): void {
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    join(repoDir, "pneuma.library.json"),
    typeof body === "string" ? body : JSON.stringify(body, null, 2),
    "utf-8",
  );
}

/** Create an empty library dir under the mocked home and return its path. */
function setupLibraryDir(id: string): string {
  const dir = getLibraryDir(id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "libreg-"));
  currentHome = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── detectRepoShape ─────────────────────────────────────────────────────────

describe("detectRepoShape", () => {
  test("single-mode repo (root manifest.ts) → kind: single", () => {
    const repo = join(tmp, "repo");
    makeRepoRootMode(repo, "doc", "1.0.0");

    const shape = detectRepoShape(repo, "default-name");
    expect(shape.kind).toBe("single");
  });

  test("explicit library via pneuma.library.json", () => {
    const repo = join(tmp, "explicit-lib");
    makeMode(join(repo, "modes", "alpha"), "alpha", "0.2.1");
    makeMode(join(repo, "modes", "beta"), "beta", "1.4.0");
    makeLibraryJson(repo, {
      version: 1,
      name: "explicit-lib",
      displayName: "Explicit Library",
      description: "two modes",
      author: "ada",
      modes: [
        { path: "modes/alpha" },
        { path: "modes/beta", name: "beta-renamed" },
      ],
    });

    const shape = detectRepoShape(repo, "fallback-name");
    expect(shape.kind).toBe("library");
    if (shape.kind !== "library") throw new Error("type narrow");
    expect(shape.manifest.name).toBe("explicit-lib");
    expect(shape.manifest.displayName).toBe("Explicit Library");
    expect(shape.manifest.author).toBe("ada");

    expect(shape.modes).toHaveLength(2);
    const alpha = shape.modes.find((m) => m.name === "alpha");
    const beta = shape.modes.find((m) => m.name === "beta-renamed");
    expect(alpha).toBeDefined();
    expect(alpha!.relPath).toBe("modes/alpha");
    expect(alpha!.manifestVersion).toBe("0.2.1");
    expect(beta).toBeDefined();
    expect(beta!.relPath).toBe("modes/beta");
    expect(beta!.manifestVersion).toBe("1.4.0");
  });

  test("implicit library (no root manifest, subdirs with manifest) → library, sorted", () => {
    const repo = join(tmp, "implicit-lib");
    makeMode(join(repo, "zulu"), "zulu", "0.1.0");
    makeMode(join(repo, "alpha"), "alpha", "0.2.0");
    makeMode(join(repo, "mike"), "mike", "0.3.0");
    // A non-mode subdir should be ignored.
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "README.md"), "no manifest here");
    // A dot-dir should be skipped.
    mkdirSync(join(repo, ".git"), { recursive: true });
    writeFileSync(join(repo, ".git", "manifest.ts"), "noise");

    const shape = detectRepoShape(repo, "implicit-lib");
    expect(shape.kind).toBe("library");
    if (shape.kind !== "library") throw new Error("type narrow");
    expect(shape.manifest.name).toBe("implicit-lib");
    expect(shape.modes.map((m) => m.name)).toEqual(["alpha", "mike", "zulu"]);
    expect(shape.modes.map((m) => m.manifestVersion)).toEqual([
      "0.2.0",
      "0.3.0",
      "0.1.0",
    ]);
  });

  test("malformed pneuma.library.json throws", () => {
    const repo = join(tmp, "bad-json");
    makeMode(join(repo, "alpha"), "alpha", "0.1.0");
    makeLibraryJson(repo, "not json {[");

    expect(() => detectRepoShape(repo, "bad")).toThrow(/not valid JSON/);
  });

  test("pneuma.library.json with unsupported version throws", () => {
    const repo = join(tmp, "bad-version");
    makeMode(join(repo, "alpha"), "alpha", "0.1.0");
    makeLibraryJson(repo, { version: 2, name: "x" });

    expect(() => detectRepoShape(repo, "x")).toThrow(/unsupported version/);
  });

  test("explicit entry pointing at a missing path throws", () => {
    const repo = join(tmp, "missing-entry");
    makeLibraryJson(repo, {
      version: 1,
      name: "missing-entry",
      modes: [{ path: "modes/nope" }],
    });

    expect(() => detectRepoShape(repo, "missing-entry")).toThrow(
      /has no manifest\.ts/,
    );
  });

  test("explicit entry with ../escape path throws", () => {
    const repo = join(tmp, "escape");
    makeLibraryJson(repo, {
      version: 1,
      name: "escape",
      modes: [{ path: "../escape-target" }],
    });
    // Target exists outside the repo — the safeSubpath check must still reject.
    makeMode(join(tmp, "escape-target"), "escape-target", "0.0.1");

    expect(() => detectRepoShape(repo, "escape")).toThrow(/escapes the repo root/);
  });

  test("empty repo (no root manifest, no subdir manifests) returns kind: single", () => {
    const repo = join(tmp, "empty");
    mkdirSync(repo, { recursive: true });

    const shape = detectRepoShape(repo, "empty");
    expect(shape.kind).toBe("single");
  });
});

// ── linkLibrary ─────────────────────────────────────────────────────────────

describe("linkLibrary", () => {
  test("writes sidecar, defaults activated: true, returns report with all modes in added", () => {
    const id = "user-repo";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    makeMode(join(repoDir, "beta"), "beta", "0.2.0");

    const shape = detectRepoShape(repoDir, id);
    expect(shape.kind).toBe("library");
    if (shape.kind !== "library") throw new Error("type narrow");

    const report = linkLibrary(
      id,
      repoDir,
      shape,
      { type: "github", url: "github:user/repo", ref: "main" },
      "deadbeef",
    );

    expect(report.added.sort()).toEqual(["alpha", "beta"]);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.noop).toBe(false);

    // Sidecar exists with expected shape.
    const sidecarPath = getLibrarySidecarPath(id);
    expect(existsSync(sidecarPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(sidecarPath, "utf-8")) as InstalledLibrary;
    expect(persisted.id).toBe(id);
    expect(persisted.sha).toBe("deadbeef");
    expect(persisted.source).toEqual({
      type: "github",
      url: "github:user/repo",
      ref: "main",
    });
    expect(persisted.modes).toHaveLength(2);
    for (const m of persisted.modes) {
      expect(m.activated).toBe(true);
      expect(m.installedVersion).toBe(m.manifestVersion);
    }
  });

  test("refuses repoDir that doesn't match expected library dir", () => {
    const id = "user-repo";
    setupLibraryDir(id); // create the real dir so resolveExplicitEntries paths exist
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    try {
      makeMode(join(elsewhere, "alpha"), "alpha", "0.1.0");
      const shape = detectRepoShape(elsewhere, id);
      if (shape.kind !== "library") throw new Error("expected library shape");

      expect(() =>
        linkLibrary(
          id,
          elsewhere,
          shape,
          { type: "github", url: "x", ref: "main" },
          null,
        ),
      ).toThrow(/does not match expected/);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

// ── syncLibrary ─────────────────────────────────────────────────────────────

describe("syncLibrary", () => {
  function initialLink(id: string, modes: { name: string; version: string }[], sha: string | null) {
    const repoDir = setupLibraryDir(id);
    for (const m of modes) makeMode(join(repoDir, m.name), m.name, m.version);
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, sha);
    return repoDir;
  }

  test("no changes + same sha → noop: true, all diff arrays empty", () => {
    const id = "noop-lib";
    initialLink(id, [{ name: "alpha", version: "0.1.0" }], "sha-1");

    const shape = detectRepoShape(getLibraryDir(id), id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    const report = syncLibrary(id, shape, "sha-1");

    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.noop).toBe(true);
  });

  test("new mode appears → added, defaults to activated: true", () => {
    const id = "add-lib";
    const repoDir = initialLink(id, [{ name: "alpha", version: "0.1.0" }], "sha-1");

    // Add a new mode to the repo on disk, advance sha.
    makeMode(join(repoDir, "beta"), "beta", "0.2.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    const report = syncLibrary(id, shape, "sha-2");

    expect(report.added).toEqual(["beta"]);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(report.noop).toBe(false);

    const lib = readLibrary(id)!;
    const beta = lib.modes.find((m) => m.name === "beta")!;
    expect(beta.activated).toBe(true);
    expect(beta.installedVersion).toBe("0.2.0");
  });

  test("mode disappears from shape → removed", () => {
    const id = "remove-lib";
    const repoDir = initialLink(
      id,
      [
        { name: "alpha", version: "0.1.0" },
        { name: "beta", version: "0.2.0" },
      ],
      "sha-1",
    );

    // Physically remove the beta dir.
    rmSync(join(repoDir, "beta"), { recursive: true, force: true });
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    const report = syncLibrary(id, shape, "sha-2");

    expect(report.added).toEqual([]);
    expect(report.removed).toEqual(["beta"]);
    expect(report.updated).toEqual([]);

    const lib = readLibrary(id)!;
    expect(lib.modes.map((m) => m.name)).toEqual(["alpha"]);
  });

  test("manifest version bump → updated entry, installedVersion NOT bumped", () => {
    const id = "update-lib";
    const repoDir = initialLink(id, [{ name: "alpha", version: "0.1.0" }], "sha-1");

    // Bump the on-disk manifest.
    makeMode(join(repoDir, "alpha"), "alpha", "0.2.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    const report = syncLibrary(id, shape, "sha-2");

    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.updated).toEqual([{ name: "alpha", from: "0.1.0", to: "0.2.0" }]);

    const lib = readLibrary(id)!;
    const alpha = lib.modes.find((m) => m.name === "alpha")!;
    expect(alpha.manifestVersion).toBe("0.2.0");
    // Accept-explicitly contract: installedVersion stays at the previously accepted value.
    expect(alpha.installedVersion).toBe("0.1.0");
  });

  test("activated flag is preserved across syncs", () => {
    const id = "preserve-lib";
    const repoDir = initialLink(
      id,
      [
        { name: "alpha", version: "0.1.0" },
        { name: "beta", version: "0.2.0" },
      ],
      "sha-1",
    );

    // User deactivates alpha.
    setModeActivated(id, "alpha", false);
    expect(readLibrary(id)!.modes.find((m) => m.name === "alpha")!.activated).toBe(false);

    // Sync (no shape changes, just a new sha).
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    syncLibrary(id, shape, "sha-2");

    const lib = readLibrary(id)!;
    expect(lib.modes.find((m) => m.name === "alpha")!.activated).toBe(false);
    expect(lib.modes.find((m) => m.name === "beta")!.activated).toBe(true);
  });

  test("syncLibrary without prior sidecar throws", () => {
    const id = "no-prior";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");

    expect(() => syncLibrary(id, shape, "sha-1")).toThrow(/no sidecar/);
  });
});

// ── setModeActivated ────────────────────────────────────────────────────────

describe("setModeActivated", () => {
  function setup(id: string) {
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");
  }

  test("flips activated flag atomically and persists", () => {
    setup("flip-lib");

    setModeActivated("flip-lib", "alpha", false);
    expect(readLibrary("flip-lib")!.modes[0].activated).toBe(false);

    setModeActivated("flip-lib", "alpha", true);
    expect(readLibrary("flip-lib")!.modes[0].activated).toBe(true);
  });

  test("idempotent when value already matches (returns prev, no churn)", () => {
    setup("idem-lib");

    const before = readLibrary("idem-lib")!;
    const after = setModeActivated("idem-lib", "alpha", true); // already true after link
    expect(after.modes[0].activated).toBe(true);
    // Should return the same library shape — lastSync etc. unchanged.
    expect(after.lastSync).toBe(before.lastSync);
  });

  test("throws when library unknown", () => {
    expect(() => setModeActivated("nope", "alpha", false)).toThrow(/Library nope not found/);
  });

  test("throws when mode unknown", () => {
    setup("unknown-mode-lib");
    expect(() => setModeActivated("unknown-mode-lib", "ghost", false)).toThrow(
      /Mode ghost not found/,
    );
  });
});

// ── acceptModeUpdate ────────────────────────────────────────────────────────

describe("acceptModeUpdate", () => {
  test("sets installedVersion = manifestVersion", () => {
    const id = "accept-lib";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");

    // Bump manifest + sync (creates an update-available state).
    makeMode(join(repoDir, "alpha"), "alpha", "0.3.0");
    const shape2 = detectRepoShape(repoDir, id);
    if (shape2.kind !== "library") throw new Error("expected library shape");
    syncLibrary(id, shape2, "sha-2");
    expect(readLibrary(id)!.modes[0].installedVersion).toBe("0.1.0");
    expect(readLibrary(id)!.modes[0].manifestVersion).toBe("0.3.0");

    acceptModeUpdate(id, "alpha");
    const lib = readLibrary(id)!;
    expect(lib.modes[0].installedVersion).toBe("0.3.0");
    expect(lib.modes[0].manifestVersion).toBe("0.3.0");
  });

  test("idempotent when already up to date", () => {
    const id = "accept-idem";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");

    const before = readLibrary(id)!;
    const after = acceptModeUpdate(id, "alpha");
    expect(after.modes[0].installedVersion).toBe("0.1.0");
    expect(after.lastSync).toBe(before.lastSync);
  });

  test("throws when library or mode unknown", () => {
    expect(() => acceptModeUpdate("nope", "alpha")).toThrow(/Library nope not found/);

    const id = "exists";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, null);

    expect(() => acceptModeUpdate(id, "ghost")).toThrow(/Mode ghost not found/);
  });
});

// ── listLibraries ───────────────────────────────────────────────────────────

describe("listLibraries", () => {
  test("returns [] when libraries root is missing", () => {
    expect(listLibraries()).toEqual([]);
  });

  test("enumerates installed libraries, sorted by lastSync desc", () => {
    const ids = ["lib-a", "lib-b", "lib-c"];
    for (const id of ids) {
      const repoDir = setupLibraryDir(id);
      makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
      const shape = detectRepoShape(repoDir, id);
      if (shape.kind !== "library") throw new Error("expected library shape");
      linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");
    }

    // Stomp lastSync values to deterministic timestamps so the sort order is testable.
    const libA = readLibrary("lib-a")!;
    const libB = readLibrary("lib-b")!;
    const libC = readLibrary("lib-c")!;
    writeLibrary({ ...libA, lastSync: 100 });
    writeLibrary({ ...libB, lastSync: 300 });
    writeLibrary({ ...libC, lastSync: 200 });

    const list = listLibraries();
    expect(list.map((l) => l.id)).toEqual(["lib-b", "lib-c", "lib-a"]);
  });

  test("skips corrupt sidecars without throwing", () => {
    // Good library.
    const goodId = "good-lib";
    const repoDir = setupLibraryDir(goodId);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, goodId);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(goodId, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");

    // Corrupt sidecar.
    const corruptId = "corrupt-lib";
    const corruptDir = setupLibraryDir(corruptId);
    writeFileSync(join(corruptDir, ".library.json"), "{{ not json", "utf-8");

    // Dir with no sidecar (treated as in-flight — readLibrary returns null).
    setupLibraryDir("no-sidecar");

    const list = listLibraries();
    expect(list.map((l) => l.id)).toEqual([goodId]);
  });
});

// ── unlinkLibrary ───────────────────────────────────────────────────────────

describe("unlinkLibrary", () => {
  test("removes the on-disk dir and returns true", () => {
    const id = "rm-lib";
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");
    expect(existsSync(getLibraryDir(id))).toBe(true);

    expect(unlinkLibrary(id)).toBe(true);
    expect(existsSync(getLibraryDir(id))).toBe(false);
  });

  test("returns false when nothing to remove", () => {
    expect(unlinkLibrary("ghost-lib")).toBe(false);
  });
});

// ── getLibraryModePath ──────────────────────────────────────────────────────

describe("getLibraryModePath", () => {
  function setup(id: string) {
    const repoDir = setupLibraryDir(id);
    makeMode(join(repoDir, "alpha"), "alpha", "0.1.0");
    const shape = detectRepoShape(repoDir, id);
    if (shape.kind !== "library") throw new Error("expected library shape");
    linkLibrary(id, repoDir, shape, { type: "github", url: "x", ref: "main" }, "sha-1");
    return repoDir;
  }

  test("returns absolute path when mode exists on disk", () => {
    const repoDir = setup("path-lib");
    const resolved = getLibraryModePath("path-lib", "alpha");
    expect(resolved).toBe(join(repoDir, "alpha"));
  });

  test("returns null when library unknown", () => {
    expect(getLibraryModePath("ghost", "alpha")).toBeNull();
  });

  test("returns null when mode unknown", () => {
    setup("known-lib");
    expect(getLibraryModePath("known-lib", "ghost")).toBeNull();
  });

  test("returns null when on-disk path no longer has a manifest.ts", () => {
    const repoDir = setup("stale-lib");
    rmSync(join(repoDir, "alpha", "manifest.ts"), { force: true });
    expect(getLibraryModePath("stale-lib", "alpha")).toBeNull();
  });

  test("returns null when on-disk path is gone entirely", () => {
    const repoDir = setup("gone-lib");
    rmSync(join(repoDir, "alpha"), { recursive: true, force: true });
    expect(getLibraryModePath("gone-lib", "alpha")).toBeNull();
  });
});

// ── getLibrariesDir / getLibraryDir sanity ──────────────────────────────────

describe("path helpers honor mocked home", () => {
  test("getLibrariesDir resolves under tmp home", () => {
    expect(getLibrariesDir()).toBe(join(tmp, ".pneuma", "libraries"));
  });

  test("getLibraryDir composes id into libraries root", () => {
    expect(getLibraryDir("foo")).toBe(join(tmp, ".pneuma", "libraries", "foo"));
  });

  test("getLibrarySidecarPath points at .library.json under the library dir", () => {
    expect(getLibrarySidecarPath("foo")).toBe(
      join(tmp, ".pneuma", "libraries", "foo", ".library.json"),
    );
  });
});
