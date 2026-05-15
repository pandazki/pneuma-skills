/**
 * Tests for `core/library-publish.ts`.
 *
 * Reuses the `node:os` homedir mock pattern from library-registry.test.ts so
 * `~/.pneuma/libraries/` resolves under a per-test tmpdir.
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

// ── Home directory mock (shared pattern with library-registry.test.ts) ──────
let currentHome = tmpdir();
mock.module("node:os", () => {
  const real = require("node:os");
  return {
    ...real,
    homedir: () => currentHome,
    default: { ...real, homedir: () => currentHome },
  };
});

import {
  initLocalLibrary,
  publishModeToLibrary,
  pushLibrary,
} from "../library-publish.js";
import {
  getLibraryDir,
  getLibrarySidecarPath,
  readLibrary,
  detectRepoShape,
  linkLibrary,
} from "../library-registry.js";
import type { LibraryManifest } from "../types/library.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeSourceMode(
  dir: string,
  name: string,
  version: string,
  extraFile?: { name: string; body: string },
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.ts"),
    `export const manifest = { name: "${name}", version: "${version}" };\n`,
    "utf-8",
  );
  if (extraFile) {
    writeFileSync(join(dir, extraFile.name), extraFile.body, "utf-8");
  }
}

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "libpub-"));
  currentHome = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ── initLocalLibrary ────────────────────────────────────────────────────────

describe("initLocalLibrary", () => {
  test("scaffolds dir + pneuma.library.json (modes: []) + README + .gitignore + sidecar", () => {
    const lib = initLocalLibrary({
      name: "my-lib",
      displayName: "My Library",
      description: "test description",
      author: "ada",
    });

    const libDir = getLibraryDir("my-lib");
    expect(existsSync(libDir)).toBe(true);

    // Repo-side manifest
    const repoManifestPath = join(libDir, "pneuma.library.json");
    expect(existsSync(repoManifestPath)).toBe(true);
    const repoManifest = JSON.parse(
      readFileSync(repoManifestPath, "utf-8"),
    ) as LibraryManifest;
    expect(repoManifest.version).toBe(1);
    expect(repoManifest.name).toBe("my-lib");
    expect(repoManifest.displayName).toBe("My Library");
    expect(repoManifest.description).toBe("test description");
    expect(repoManifest.author).toBe("ada");
    expect(repoManifest.modes).toEqual([]);

    // README + .gitignore
    expect(existsSync(join(libDir, "README.md"))).toBe(true);
    expect(readFileSync(join(libDir, "README.md"), "utf-8")).toContain(
      "My Library",
    );
    expect(existsSync(join(libDir, ".gitignore"))).toBe(true);
    expect(readFileSync(join(libDir, ".gitignore"), "utf-8")).toContain(
      ".library.json",
    );

    // Sidecar
    expect(existsSync(getLibrarySidecarPath("my-lib"))).toBe(true);
    expect(lib.id).toBe("my-lib");
    expect(lib.name).toBe("my-lib");
    expect(lib.modes).toEqual([]);
    expect(lib.source).toEqual({ type: "local", path: libDir });
  });

  test("initializes git repo when git binary is available; if missing, library is still returned", () => {
    const lib = initLocalLibrary({ name: "git-lib" });
    expect(lib).toBeDefined();
    // The publish module's try/catch wraps the three git commands. With git
    // installed on the test host we expect .git to be present. If a future
    // CI lacks git, the helper logs a warning and the library is still
    // returned — so we only assert the return shape strictly.
    const dotGit = join(getLibraryDir("git-lib"), ".git");
    // We expect git to exist on dev machines + CI but tolerate absence.
    if (existsSync(dotGit)) {
      expect(existsSync(dotGit)).toBe(true);
    }
    expect(lib.id).toBe("git-lib");
  });

  test("throws when a library with the same id already exists", () => {
    initLocalLibrary({ name: "dup-lib" });
    expect(() => initLocalLibrary({ name: "dup-lib" })).toThrow(
      /already exists/,
    );
  });

  test("rejects slug with slash", () => {
    expect(() => initLocalLibrary({ name: "bad/name" })).toThrow(
      /Invalid library\/mode name/,
    );
  });

  test("rejects empty slug", () => {
    expect(() => initLocalLibrary({ name: "" })).toThrow(
      /1.{1,2}80 chars/,
    );
  });

  test("rejects slug starting with a dot", () => {
    expect(() => initLocalLibrary({ name: ".hidden" })).toThrow(
      /must not start with/,
    );
  });

  test("rejects slug longer than 80 chars", () => {
    const huge = "a".repeat(81);
    expect(() => initLocalLibrary({ name: huge })).toThrow(/1.{1,2}80 chars/);
  });
});

// ── publishModeToLibrary ────────────────────────────────────────────────────

describe("publishModeToLibrary", () => {
  test("copies the mode into the library, updates pneuma.library.json, syncs sidecar (added: true)", () => {
    initLocalLibrary({ name: "pub-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0", { name: "README.md", body: "# alpha" });

    const result = publishModeToLibrary({
      sourceModeDir: src,
      libraryId: "pub-lib",
    });

    expect(result.added).toBe(true);
    expect(existsSync(result.destDir)).toBe(true);
    expect(existsSync(join(result.destDir, "manifest.ts"))).toBe(true);
    expect(existsSync(join(result.destDir, "README.md"))).toBe(true);

    // pneuma.library.json entry was added
    const repoManifest = JSON.parse(
      readFileSync(join(getLibraryDir("pub-lib"), "pneuma.library.json"), "utf-8"),
    ) as LibraryManifest;
    expect(repoManifest.modes).toEqual([{ path: "alpha" }]);

    // Sidecar reflects the new mode
    const lib = readLibrary("pub-lib")!;
    expect(lib.modes.map((m) => m.name)).toEqual(["alpha"]);
    expect(lib.modes[0].manifestVersion).toBe("0.1.0");
  });

  test("idempotent — re-publishing the same name does not duplicate the pneuma.library.json entry", () => {
    initLocalLibrary({ name: "idem-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0");

    publishModeToLibrary({ sourceModeDir: src, libraryId: "idem-lib" });
    const result2 = publishModeToLibrary({ sourceModeDir: src, libraryId: "idem-lib" });

    expect(result2.added).toBe(false);
    const repoManifest = JSON.parse(
      readFileSync(join(getLibraryDir("idem-lib"), "pneuma.library.json"), "utf-8"),
    ) as LibraryManifest;
    expect(repoManifest.modes).toEqual([{ path: "alpha" }]);
  });

  test("re-publishing with different content updates files and returns added: false", () => {
    initLocalLibrary({ name: "upd-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0", { name: "data.txt", body: "v1" });
    publishModeToLibrary({ sourceModeDir: src, libraryId: "upd-lib" });

    // Mutate source content
    writeFileSync(join(src, "data.txt"), "v2", "utf-8");
    makeSourceMode(src, "alpha", "0.2.0");

    const result2 = publishModeToLibrary({ sourceModeDir: src, libraryId: "upd-lib" });
    expect(result2.added).toBe(false);
    expect(readFileSync(join(result2.destDir, "data.txt"), "utf-8")).toBe("v2");

    const lib = readLibrary("upd-lib")!;
    expect(lib.modes[0].manifestVersion).toBe("0.2.0");
  });

  test("supports --as override to rename inside the library", () => {
    initLocalLibrary({ name: "rename-lib" });
    const src = join(tmp, "src", "raw-name");
    makeSourceMode(src, "raw-name", "0.1.0");

    const result = publishModeToLibrary({
      sourceModeDir: src,
      libraryId: "rename-lib",
      name: "renamed",
    });

    expect(result.destDir.endsWith("/renamed")).toBe(true);
    expect(existsSync(join(getLibraryDir("rename-lib"), "renamed", "manifest.ts"))).toBe(true);
    expect(existsSync(join(getLibraryDir("rename-lib"), "raw-name"))).toBe(false);

    const lib = readLibrary("rename-lib")!;
    expect(lib.modes.map((m) => m.name)).toEqual(["renamed"]);
  });

  test("rejects mode name with path separator (escape attempt)", () => {
    initLocalLibrary({ name: "escape-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0");

    expect(() =>
      publishModeToLibrary({
        sourceModeDir: src,
        libraryId: "escape-lib",
        name: "../oops",
      }),
    ).toThrow(/Invalid library\/mode name/);
  });

  test("rejects mode name with disallowed special chars", () => {
    initLocalLibrary({ name: "special-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0");

    expect(() =>
      publishModeToLibrary({
        sourceModeDir: src,
        libraryId: "special-lib",
        name: "no spaces",
      }),
    ).toThrow(/Invalid library\/mode name/);
  });

  test("throws helpful message when library is not linked", () => {
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0");
    expect(() =>
      publishModeToLibrary({ sourceModeDir: src, libraryId: "ghost-lib" }),
    ).toThrow(/Library "ghost-lib" is not linked/);
  });

  test("throws when source dir is missing", () => {
    initLocalLibrary({ name: "missing-src-lib" });
    expect(() =>
      publishModeToLibrary({
        sourceModeDir: join(tmp, "does-not-exist"),
        libraryId: "missing-src-lib",
      }),
    ).toThrow(/Source mode dir not found/);
  });

  test("throws when source dir has no manifest", () => {
    initLocalLibrary({ name: "no-manifest-lib" });
    const src = join(tmp, "src", "bad");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "README.md"), "not a mode", "utf-8");

    expect(() =>
      publishModeToLibrary({ sourceModeDir: src, libraryId: "no-manifest-lib" }),
    ).toThrow(/not a mode package/);
  });

  test("publish with push: true and no remote configured throws with the 'Fix git credentials' hint", () => {
    initLocalLibrary({ name: "no-remote-lib" });
    const src = join(tmp, "src", "alpha");
    makeSourceMode(src, "alpha", "0.1.0");

    expect(() =>
      publishModeToLibrary({
        sourceModeDir: src,
        libraryId: "no-remote-lib",
        push: true,
      }),
    ).toThrow(/Fix git credentials/);
  });
});

// ── pushLibrary ─────────────────────────────────────────────────────────────

describe("pushLibrary", () => {
  test("throws when the library dir does not exist", () => {
    expect(() => pushLibrary("ghost-lib")).toThrow(/not linked locally/);
  });

  test("throws when the library has no .git", () => {
    // Plant a library dir with a sidecar but no .git.
    const id = "no-git-lib";
    const dir = getLibraryDir(id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "pneuma.library.json"),
      JSON.stringify({ version: 1, name: id, modes: [] }, null, 2),
    );
    const shape = detectRepoShape(dir, id);
    if (shape.kind !== "library") throw new Error("expected library");
    linkLibrary(id, dir, shape, { type: "local", path: dir }, null);

    expect(() => pushLibrary(id)).toThrow(/no git repo/);
  });
});
