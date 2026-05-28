/**
 * Mode Resolver — resolve mode sources and ensure local availability.
 *
 * Supports three mode sources:
 * - builtin: "doc", "slide" — built-in modes, loaded from the modes/ directory
 * - local: "/abs/path" or "./rel/path" — local filesystem path
 * - github: "github:user/repo" or "github:user/repo#branch" — GitHub repository
 *
 * GitHub repositories are cloned to the ~/.pneuma/modes/{user}-{repo}/ cache directory.
 *
 * Multi-mode repos ("libraries") are detected at install time and routed
 * to `~/.pneuma/libraries/<id>/` instead, with a `.library.json` sidecar
 * tracking per-mode activation + last-synced git sha. See
 * `core/library-registry.ts` for the shape rules.
 */

import { resolve, join, basename } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  detectRepoShape,
  getLibrariesDir,
  getLibraryDir,
  getLibrarySidecarPath,
  linkLibrary,
  syncLibrary,
  unlinkLibrary,
  type LibrarySyncReport,
} from "./library-registry.js";

export type ModeSourceType = "builtin" | "local" | "github" | "url";

export interface ResolvedMode {
  /** Mode source type */
  type: ModeSourceType;
  /** Mode name (for display and registration) */
  name: string;
  /** Absolute filesystem path to the mode package directory */
  path: string;
  /** Original specifier as provided by the user */
  specifier: string;
}

/** Known builtin mode names */
// Keep in sync with the builtin registry in core/mode-loader.ts. A plain name
// not in this set still resolves as builtin via the fallthrough in
// parseModeSpecifier, so a stale entry here is not load-breaking — but it must
// stay complete to remain a trustworthy catalog and to survive any future
// tightening of that fallthrough.
const BUILTIN_MODES = new Set([
  "doc",
  "slide",
  "draw",
  "diagram",
  "illustrate",
  "remotion",
  "gridboard",
  "kami",
  "clipcraft",
  "cosmos",
  "webcraft",
  "mode-maker",
  "evolve",
  "project-evolve",
  "project-onboard",
]);

/** Global cache directory for cloned GitHub modes */
const MODES_CACHE_DIR = join(homedir(), ".pneuma", "modes");

/**
 * Parse a mode specifier and determine its source type.
 *
 * @param specifier — Mode specifier string
 * @param projectRoot — Absolute path to the pneuma-skills project root
 * @returns Parsed mode source info (not yet resolved to disk)
 */
export function parseModeSpecifier(specifier: string): {
  type: ModeSourceType;
  name: string;
  /** For github: { user, repo, ref } */
  github?: { user: string; repo: string; ref: string };
  /** For local: the raw path (may be relative) */
  localPath?: string;
  /** For url: the full URL to the tar.gz archive */
  urlSpec?: { url: string };
} {
  // URL: https://...tar.gz
  if (specifier.startsWith("https://") && specifier.endsWith(".tar.gz")) {
    // Try to extract mode name from R2 key pattern: modes/{name}/{version}.tar.gz
    const urlPath = new URL(specifier).pathname;
    const modesMatch = urlPath.match(/\/modes\/([^/]+)\/[^/]+\.tar\.gz$/);
    const name = modesMatch
      ? modesMatch[1]
      : urlPath.split("/").pop()!.replace(/\.tar\.gz$/, "").replace(/[-.][\d]+/g, "") || "url-mode";
    return {
      type: "url",
      name,
      urlSpec: { url: specifier },
    };
  }

  // GitHub: "github:user/repo" or "github:user/repo#branch"
  if (specifier.startsWith("github:")) {
    const rest = specifier.slice("github:".length);
    const [repoPath, ref] = rest.split("#");
    const [user, repo] = repoPath.split("/");
    if (!user || !repo) {
      throw new Error(
        `Invalid GitHub mode specifier: "${specifier}". Expected format: github:user/repo or github:user/repo#branch`,
      );
    }
    return {
      type: "github",
      name: `${user}-${repo}`,
      github: { user, repo, ref: ref || "main" },
    };
  }

  // Local: starts with "/", "./", "../", "~", or Windows drive letter (C:\...)
  if (
    specifier.startsWith("/") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  ) {
    // Expand ~ to home directory
    const expandedPath = specifier.startsWith("~")
      ? join(homedir(), specifier.slice(1))
      : specifier;
    const absPath = resolve(expandedPath);
    // Extract mode name from directory name
    const name = basename(absPath) || "custom";
    return {
      type: "local",
      name,
      localPath: absPath,
    };
  }

  // Builtin: plain name
  if (BUILTIN_MODES.has(specifier)) {
    return { type: "builtin", name: specifier };
  }

  // Unknown — could be a builtin we don't know about, let mode-loader handle it
  return { type: "builtin", name: specifier };
}

/**
 * Result of resolving a mode source — either a single mode or a library
 * containing many modes. Single-mode resolution preserves the existing
 * `ResolvedMode` shape for legacy callers (mode launch path).
 */
export type ResolveResult =
  | { kind: "single"; resolved: ResolvedMode }
  | {
      kind: "library";
      /** Atomic state after link/sync — added/removed/updated counts. */
      report: LibrarySyncReport;
      /** Absolute path to the library's on-disk root. */
      libraryDir: string;
      /** Original specifier as provided by the user. */
      specifier: string;
    };

/**
 * Resolve a mode specifier, supporting both single-mode and multi-mode
 * (library) repos. Use this from install-aware callers (`pneuma mode add`,
 * library server routes). Launch-path callers should keep using
 * {@link resolveMode}, which throws a helpful error when the specifier
 * points at a library.
 */
export async function resolveModeOrLibrary(
  specifier: string,
  projectRoot: string,
): Promise<ResolveResult> {
  const parsed = parseModeSpecifier(specifier);

  switch (parsed.type) {
    case "builtin":
    case "local": {
      // No library possibility — these specifiers point at a single mode
      // by definition (either a builtin name or an absolute path).
      const resolved = await resolveMode(specifier, projectRoot);
      return { kind: "single", resolved };
    }

    case "github": {
      const { user, repo, ref } = parsed.github!;
      const id = `${user}-${repo}`;

      // Path A — already installed as a library. Update in-place and sync
      // the sidecar so activation flags and installedVersion carry over.
      if (existsSync(getLibrarySidecarPath(id))) {
        const libDir = getLibraryDir(id);
        await ensureGithubMode(user, repo, ref, libDir);
        const shape = detectRepoShape(libDir, id);
        if (shape.kind === "library") {
          const sha = await readGitSha(libDir);
          const report = syncLibrary(id, shape, sha);
          return { kind: "library", report, libraryDir: libDir, specifier };
        }
        // Repo morphed away from library back to single — rare, but rather
        // than leave a stale sidecar around, drop it and fall through to
        // the normal single-mode path which clones into modes/<id>/.
        unlinkLibrary(id);
      }

      // Path B — fresh install. Clone into the single-mode cache; if it
      // turns out to be a library, move into libraries/<id>/ and write a
      // fresh sidecar.
      const singleDir = join(MODES_CACHE_DIR, id);
      await ensureGithubMode(user, repo, ref, singleDir);
      const shape = detectRepoShape(singleDir, id);

      if (shape.kind === "single") {
        validateModePackage(singleDir);
        return {
          kind: "single",
          resolved: { type: "github", name: id, path: singleDir, specifier },
        };
      }

      const libDir = getLibraryDir(id);
      mkdirSync(getLibrariesDir(), { recursive: true });
      if (existsSync(libDir)) {
        rmSync(libDir, { recursive: true, force: true });
      }
      renameSync(singleDir, libDir);
      const sha = await readGitSha(libDir);
      const report = linkLibrary(
        id,
        libDir,
        shape,
        { type: "github", url: specifier, ref },
        sha,
      );
      return { kind: "library", report, libraryDir: libDir, specifier };
    }

    case "url": {
      const { url } = parsed.urlSpec!;
      const id = parsed.name;

      // Path A — already a library. Re-extract in-place (URL tarballs
      // have no incremental update story), then reconcile sidecar.
      if (existsSync(getLibrarySidecarPath(id))) {
        const libDir = getLibraryDir(id);
        await ensureUrlMode(url, libDir);
        const shape = detectRepoShape(libDir, id);
        if (shape.kind === "library") {
          const report = syncLibrary(id, shape, null);
          return { kind: "library", report, libraryDir: libDir, specifier };
        }
        unlinkLibrary(id);
      }

      // Path B — fresh extract to the single-mode cache, then maybe move.
      const singleDir = join(MODES_CACHE_DIR, id);
      await ensureUrlMode(url, singleDir);
      const shape = detectRepoShape(singleDir, id);

      if (shape.kind === "single") {
        validateModePackage(singleDir);
        return {
          kind: "single",
          resolved: { type: "url", name: id, path: singleDir, specifier },
        };
      }

      const libDir = getLibraryDir(id);
      mkdirSync(getLibrariesDir(), { recursive: true });
      if (existsSync(libDir)) {
        rmSync(libDir, { recursive: true, force: true });
      }
      renameSync(singleDir, libDir);
      const report = linkLibrary(
        id,
        libDir,
        shape,
        { type: "url", url },
        null,
      );
      return { kind: "library", report, libraryDir: libDir, specifier };
    }
  }
}

/**
 * Resolve a mode specifier to a local directory path.
 * For GitHub modes, this clones/updates the repository.
 *
 * When the specifier points at a multi-mode repo (library), this throws
 * with a message directing the caller to {@link resolveModeOrLibrary} or
 * to the `pneuma mode add` CLI. The launch path should never receive a
 * library specifier directly — library modes are launched by their
 * resolved on-disk path after `mode add`.
 *
 * @param specifier — Mode specifier string (e.g. "doc", "./my-mode", "github:user/repo")
 * @param projectRoot — Absolute path to the pneuma-skills project root
 * @returns Resolved mode with absolute path
 */
export async function resolveMode(
  specifier: string,
  projectRoot: string,
): Promise<ResolvedMode> {
  const parsed = parseModeSpecifier(specifier);

  switch (parsed.type) {
    case "builtin": {
      return {
        type: "builtin",
        name: parsed.name,
        path: join(projectRoot, "modes", parsed.name),
        specifier,
      };
    }

    case "local": {
      const absPath = parsed.localPath!;
      if (!existsSync(absPath)) {
        throw new Error(`Local mode directory not found: ${absPath}`);
      }
      // Validate that it looks like a mode package
      validateModePackage(absPath);
      return {
        type: "local",
        name: parsed.name,
        path: absPath,
        specifier,
      };
    }

    case "github":
    case "url": {
      // Delegate to library-aware resolver so a library specifier produces
      // a single, helpful error instead of failing the "missing manifest.ts"
      // check on the cloned repo root.
      const r = await resolveModeOrLibrary(specifier, projectRoot);
      if (r.kind === "library") {
        const names = r.report.library.modes.map((m) => m.name).join(", ");
        throw new Error(
          `"${specifier}" is a mode library with ${r.report.library.modes.length} mode(s). ` +
            `Run \`pneuma mode add ${specifier}\` first, then launch one of: ${names}.`,
        );
      }
      return r.resolved;
    }
  }
}

/**
 * Validate that a directory looks like a pneuma mode package.
 * Must contain either manifest.ts or manifest.js.
 */
function validateModePackage(dir: string): void {
  const hasManifestTs = existsSync(join(dir, "manifest.ts"));
  const hasManifestJs = existsSync(join(dir, "manifest.js"));
  if (!hasManifestTs && !hasManifestJs) {
    throw new Error(
      `Invalid mode package at ${dir}: missing manifest.ts or manifest.js. ` +
        `A pneuma mode must export a ModeManifest from manifest.ts`,
    );
  }
}

/**
 * Clone or update a GitHub repository into the cache directory.
 */
async function ensureGithubMode(
  user: string,
  repo: string,
  ref: string,
  cacheDir: string,
): Promise<void> {
  mkdirSync(MODES_CACHE_DIR, { recursive: true });

  const repoUrl = `https://github.com/${user}/${repo}.git`;

  if (existsSync(join(cacheDir, ".git"))) {
    // Already cloned — fetch and checkout the ref
    console.log(`[mode-resolver] Updating ${user}/${repo}#${ref}...`);
    try {
      await runGit(["fetch", "origin", ref], cacheDir);
      await runGit(["checkout", `origin/${ref}`, "--force"], cacheDir);
      console.log(`[mode-resolver] Updated to latest ${ref}`);
    } catch (err) {
      console.warn(`[mode-resolver] Failed to update, using cached version:`, err);
    }
  } else {
    // Fresh clone
    console.log(`[mode-resolver] Cloning ${user}/${repo}#${ref}...`);
    await runGit(
      ["clone", "--depth", "1", "--branch", ref, repoUrl, cacheDir],
      MODES_CACHE_DIR,
    );
    console.log(`[mode-resolver] Cloned to ${cacheDir}`);
  }
}

/**
 * Download a tar.gz URL and extract into the cache directory.
 * Always re-downloads for a fresh extract each run.
 */
async function ensureUrlMode(url: string, cacheDir: string): Promise<void> {
  const { rmSync } = await import("node:fs");
  mkdirSync(MODES_CACHE_DIR, { recursive: true });

  // Clean previous extract
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
  mkdirSync(cacheDir, { recursive: true });

  console.log(`[mode-resolver] Downloading ${url}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Save to temp file, then extract
    const tempPath = join(MODES_CACHE_DIR, `_download_${Date.now()}.tar.gz`);
    const body = await response.arrayBuffer();
    await Bun.write(tempPath, body);

    const proc = Bun.spawn(["tar", "xzf", tempPath, "-C", cacheDir], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // Cleanup temp file
    try { rmSync(tempPath); } catch {}

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tar extract failed (exit ${exitCode}): ${stderr}`);
    }

    console.log(`[mode-resolver] Extracted to ${cacheDir}`);
    patchViteEnvTokens(cacheDir);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Post-extract rewrite for published-mode bundles built before 2.35.1:
 * those Bun.build outputs contain literal `import.meta.env.DEV` reads
 * because the build step didn't substitute them, and the host runtime
 * can't polyfill `import.meta` after the fact. Walk the extracted
 * `.build/` directory (where published bundles live) and substitute
 * the Vite env tokens with the same static values the new Bun.build
 * `define` would have produced. This is a one-time cost at install
 * and gets old modes working without forcing every publisher to
 * re-bundle.
 */
function patchViteEnvTokens(cacheDir: string): void {
  const buildDir = join(cacheDir, ".build");
  if (!existsSync(buildDir)) return;

  const substitutions: Array<[RegExp, string]> = [
    [/import\.meta\.env\.DEV/g, "false"],
    [/import\.meta\.env\.PROD/g, "true"],
    [/import\.meta\.env\.MODE/g, '"production"'],
    [/import\.meta\.env\.VITE_API_PORT/g, "undefined"],
    [/import\.meta\.env\.VITE_MODE_MAKER_WORKSPACE/g, "undefined"],
  ];

  let patched = 0;
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(m?js|cjs)$/.test(entry.name)) continue;
      try {
        const src = readFileSync(full, "utf-8");
        if (!src.includes("import.meta.env")) continue;
        let out = src;
        for (const [pat, val] of substitutions) out = out.replace(pat, val);
        if (out !== src) {
          writeFileSync(full, out, "utf-8");
          patched++;
        }
      } catch { /* best-effort */ }
    }
  }

  try {
    if (statSync(buildDir).isDirectory()) walk(buildDir);
    if (patched > 0) {
      console.log(`[mode-resolver] Patched import.meta.env tokens in ${patched} bundle file(s) under .build/`);
    }
  } catch { /* .build/ access failed, skip */ }
}

/**
 * Read the HEAD sha of a clone. Returns null when the directory isn't a
 * git repo (e.g. URL-tarball extracts) or when `git` itself fails — both
 * are non-fatal: callers persist the null and the library still works,
 * just without sha-based "no updates" short-circuit.
 */
async function readGitSha(cacheDir: string): Promise<string | null> {
  try {
    const out = await runGit(["rev-parse", "HEAD"], cacheDir);
    const sha = out.trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Run a git command and return the result.
 */
const GIT_TIMEOUT_MS = 30_000;

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => {
      proc.kill();
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
  });

  const exitCode = await Promise.race([proc.exited, timeout]);
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (code ${exitCode}): ${stderr}`);
  }
  return stdout;
}

/**
 * Check if a mode specifier refers to a non-builtin (external) mode.
 */
export function isExternalMode(specifier: string): boolean {
  const parsed = parseModeSpecifier(specifier);
  return parsed.type !== "builtin";
}
