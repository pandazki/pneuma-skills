/**
 * Mode Resolver tests
 *
 * Validates mode source resolution:
 * - Built-in mode name recognition
 * - Local path resolution (absolute paths, relative paths, ~ expansion)
 * - GitHub format parsing
 * - Error handling
 */

import { afterAll, beforeAll, describe, test, expect } from "bun:test";
import { isSafeGitRef, parseModeSpecifier, isExternalMode, resolveMode } from "../mode-resolver.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { buildModeArchive, sha256Hex } from "./fixtures/catalog-archive.js";
import { MODE_CATALOG_FORMAT, type ModeCatalog } from "../types/mode-catalog.js";

describe("parseModeSpecifier", () => {
  // ── Builtin modes ──────────────────────────────────────────────────

  test("recognizes a bundled mode: slide", () => {
    const result = parseModeSpecifier("slide");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("slide");
  });

  test("recognizes a bundled mode: webcraft", () => {
    const result = parseModeSpecifier("webcraft");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("webcraft");
  });

  // `doc` is a catalog mode: listed by every release, shipped by none.
  // In this repo its source is in-tree, which is why resolution below
  // finds it without a download.
  test("recognizes a catalog mode: doc", () => {
    const result = parseModeSpecifier("doc");
    expect(result.type).toBe("catalog");
    expect(result.name).toBe("doc");
  });

  test("unknown plain name falls back to builtin (let mode-loader handle it)", () => {
    const result = parseModeSpecifier("mindmap");
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("mindmap");
  });

  // ── Local paths ────────────────────────────────────────────────────

  test("parses absolute path as local mode", () => {
    const result = parseModeSpecifier("/home/user/my-mode");
    expect(result.type).toBe("local");
    expect(result.name).toBe("my-mode");
    expect(result.localPath).toBe("/home/user/my-mode");
  });

  test("parses relative path with ./ as local mode", () => {
    const result = parseModeSpecifier("./modes/custom");
    expect(result.type).toBe("local");
    expect(result.name).toBe("custom");
    expect(result.localPath).toBeTruthy();
  });

  test("parses relative path with ../ as local mode", () => {
    const result = parseModeSpecifier("../other-project/my-mode");
    expect(result.type).toBe("local");
    expect(result.name).toBe("my-mode");
    expect(result.localPath).toBeTruthy();
  });

  test("expands ~ to home directory", () => {
    const result = parseModeSpecifier("~/my-modes/custom");
    expect(result.type).toBe("local");
    expect(result.name).toBe("custom");
    expect(result.localPath).toStartWith(homedir());
  });

  // ── GitHub specifiers ──────────────────────────────────────────────

  test("parses github:user/repo", () => {
    const result = parseModeSpecifier("github:pandazki/pneuma-mode-canvas");
    expect(result.type).toBe("github");
    expect(result.name).toBe("pandazki-pneuma-mode-canvas");
    expect(result.github).toEqual({
      user: "pandazki",
      repo: "pneuma-mode-canvas",
      ref: "main",
    });
  });

  test("parses github:user/repo#branch", () => {
    const result = parseModeSpecifier("github:pandazki/my-mode#develop");
    expect(result.type).toBe("github");
    expect(result.name).toBe("pandazki-my-mode");
    expect(result.github).toEqual({
      user: "pandazki",
      repo: "my-mode",
      ref: "develop",
    });
  });

  test("parses github:user/repo#tag", () => {
    const result = parseModeSpecifier("github:user/repo#v1.0.0");
    expect(result.type).toBe("github");
    expect(result.github?.ref).toBe("v1.0.0");
  });

  test("throws for invalid github specifier (no repo)", () => {
    expect(() => parseModeSpecifier("github:user")).toThrow("Invalid GitHub mode specifier");
  });

  test("throws for invalid github specifier (empty user)", () => {
    expect(() => parseModeSpecifier("github:/repo")).toThrow("Invalid GitHub mode specifier");
  });

  // ── URL specifiers ─────────────────────────────────────────────────

  test("parses R2-style modes/<name>/<version>.tar.gz URL", () => {
    const result = parseModeSpecifier("https://r2.example.com/modes/foo/1.0.tar.gz");
    expect(result.type).toBe("url");
    expect(result.name).toBe("foo");
    expect(result.urlSpec?.url).toBe("https://r2.example.com/modes/foo/1.0.tar.gz");
  });

  test("parses a non-R2 tar.gz URL by falling back to filename stem", () => {
    // No `modes/<name>/<version>.tar.gz` shape — fall back to the filename
    // with version-like trailing tokens stripped.
    const result = parseModeSpecifier("https://example.com/downloads/widget-1.2.3.tar.gz");
    expect(result.type).toBe("url");
    expect(result.urlSpec?.url).toBe("https://example.com/downloads/widget-1.2.3.tar.gz");
    expect(result.name.length).toBeGreaterThan(0);
  });
});

// ── resolveMode integration tests ─────────────────────────────────────

const PROJECT_ROOT = resolve(dirname(import.meta.path), "../..");

describe("resolveMode", () => {
  test("resolves builtin mode to modes/ directory", async () => {
    const result = await resolveMode("slide", PROJECT_ROOT);
    expect(result.type).toBe("builtin");
    expect(result.name).toBe("slide");
    expect(result.path).toBe(join(PROJECT_ROOT, "modes", "slide"));
  });

  test("resolves a catalog mode to in-tree source in a repo checkout", async () => {
    // No network: the source is in the tree, so the catalog installer is
    // never consulted. This is the invariant that keeps development and CI
    // working offline for modes the package does not ship.
    const result = await resolveMode("doc", PROJECT_ROOT);
    expect(result.type).toBe("catalog");
    expect(result.name).toBe("doc");
    expect(result.path).toBe(join(PROJECT_ROOT, "modes", "doc"));
    // Seed keys in first-party manifests are package-relative
    // ("modes/doc/seed/README.md"), so the seed root is the package root.
    expect(result.seedBase).toBe(PROJECT_ROOT);
  });

  test("resolves local path to absolute directory", async () => {
    const testModePath = resolve(dirname(import.meta.path), "fixtures/test-mode");
    const result = await resolveMode(testModePath, PROJECT_ROOT);
    expect(result.type).toBe("local");
    expect(result.name).toBe("test-mode");
    expect(result.path).toBe(testModePath);
  });

  test("throws for non-existent local path", async () => {
    await expect(resolveMode("/nonexistent/path/to/mode", PROJECT_ROOT)).rejects.toThrow(
      "Local mode directory not found",
    );
  });

  test("throws for local path without manifest", async () => {
    // Use a directory that exists but has no manifest.ts
    const tmpDir = resolve(dirname(import.meta.path), "fixtures");
    await expect(resolveMode(tmpDir, PROJECT_ROOT)).rejects.toThrow(
      "missing manifest.ts",
    );
  });
});

describe("isExternalMode", () => {
  test("bundled modes are not external", () => {
    expect(isExternalMode("slide")).toBe(false);
    expect(isExternalMode("webcraft")).toBe(false);
  });

  test("catalog modes are external — they load from an absolute path", () => {
    expect(isExternalMode("doc")).toBe(true);
    expect(isExternalMode("sprite")).toBe(true);
  });

  test("local paths are external", () => {
    expect(isExternalMode("/path/to/mode")).toBe(true);
    expect(isExternalMode("./my-mode")).toBe(true);
  });

  test("github specifiers are external", () => {
    expect(isExternalMode("github:user/repo")).toBe(true);
  });
});

/**
 * The released shape: a catalog mode whose source is NOT in the package.
 * `resolveMode` is the one seam every launch path goes through — CLI,
 * session resume, handoff/borrow target, launcher — so the install has to
 * happen here, or a handoff into a mode the user never opened would fail
 * with "missing manifest.ts" instead of downloading it.
 */
describe("resolveMode — catalog mode that is not in the package", () => {
  const MODE = "demo";
  const VERSION = "2.0.0";
  const CORE = "9.9.9";

  let archive: Uint8Array<ArrayBuffer>;
  let server: ReturnType<typeof Bun.serve>;
  let pkgRoot: string;
  let tmpHome: string;
  let realHome: string | undefined;

  beforeAll(() => {
    archive = buildModeArchive({ name: MODE, version: VERSION, coreVersion: CORE });
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(new Blob([archive])),
    });

    pkgRoot = mkdtempSync(join(tmpdir(), "pneuma-resolver-pkg-"));
    tmpHome = mkdtempSync(join(tmpdir(), "pneuma-resolver-home-"));
    mkdirSync(join(pkgRoot, "modes"), { recursive: true });
    writeFileSync(
      join(pkgRoot, "modes", "distribution.json"),
      JSON.stringify({ bundled: ["_shared", "slide"] }),
    );
    const catalog: ModeCatalog = {
      formatVersion: MODE_CATALOG_FORMAT,
      coreVersion: CORE,
      generatedAt: "2026-09-22T00:00:00.000Z",
      modes: [
        {
          name: MODE,
          version: VERSION,
          displayName: { en: "Demo" },
          archive: {
            url: `http://127.0.0.1:${server.port}/official/v${CORE}/${MODE}-${VERSION}.tar.gz`,
            size: archive.length,
            sha256: sha256Hex(archive),
          },
          unpackedSize: 4096,
        },
      ],
    };
    writeFileSync(join(pkgRoot, "modes", "catalog.json"), JSON.stringify(catalog));

    // The installer resolves `~` from the environment (Bun caches
    // `os.homedir()` at boot), so this is what redirects the install.
    realHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterAll(() => {
    if (realHome === undefined) delete process.env.HOME;
    else process.env.HOME = realHome;
    server.stop(true);
    rmSync(pkgRoot, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
  });

  test("installs on resolve and points at the installed mode directory", async () => {
    const result = await resolveMode(MODE, pkgRoot);
    expect(result.type).toBe("catalog");
    expect(result.name).toBe(MODE);

    const installRoot = join(tmpHome, ".pneuma", "catalog", MODE);
    expect(result.path).toBe(join(installRoot, "modes", MODE));
    expect(existsSync(join(result.path, "manifest.ts"))).toBe(true);
    // Package-relative seed keys ("modes/demo/seed/README.md") resolve
    // against the install root exactly as they do against the package root.
    expect(result.seedBase).toBe(installRoot);
    expect(
      readFileSync(join(result.seedBase!, "modes", MODE, "seed", "README.md"), "utf-8"),
    ).toContain(VERSION);
    // The install never lands in `~/.pneuma/modes/`, which belongs to
    // user-installed and evolved modes.
    expect(existsSync(join(tmpHome, ".pneuma", "modes", MODE))).toBe(false);
  });
});

describe("GitHub refs reach git only when they are branch or tag names", () => {
  test("isSafeGitRef", () => {
    expect(isSafeGitRef("main")).toBe(true);
    expect(isSafeGitRef("release/3.52")).toBe(true);
    expect(isSafeGitRef("v1.2.3")).toBe(true);
    expect(isSafeGitRef("--upload-pack=touch /tmp/x")).toBe(false);
    expect(isSafeGitRef("-b")).toBe(false);
    expect(isSafeGitRef("a..b")).toBe(false);
    expect(isSafeGitRef("a b")).toBe(false);
  });
  test("parseModeSpecifier refuses an option-shaped ref", () => {
    expect(() => parseModeSpecifier("github:user/repo#--upload-pack=touch x")).toThrow("not a branch or tag name");
    expect(parseModeSpecifier("github:user/repo#dev").github?.ref).toBe("dev");
  });
});
