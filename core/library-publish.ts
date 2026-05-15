/**
 * Library publish — author-side operations for a multi-mode library.
 *
 * The consume side (clone, detect, link, sync) lives in `library-registry.ts`.
 * This module covers the inverse flow: scaffold a brand-new library, copy a
 * mode into an existing one, push to its GitHub remote.
 *
 * Each operation is single-step and reversible by the user. We deliberately
 * do not chain "init + commit + push" by default — the user reviews what
 * landed locally before going public.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, basename, isAbsolute, normalize, sep, resolve } from "node:path";
import {
  detectRepoShape,
  getLibrariesDir,
  getLibraryDir,
  getLibrarySidecarPath,
  linkLibrary,
  syncLibrary,
  readLibrary,
  writeLibrary,
  type RepoShape,
} from "./library-registry.js";
import type { InstalledLibrary, LibraryManifest } from "./types/library.js";

const GIT_TIMEOUT_MS = 30_000;

/** Initial scaffolding planted by `pneuma library init`. */
const STARTER_README = (name: string) => `# ${name}

A [Pneuma](https://github.com/pandazki/pneuma-skills) mode library.

Install it from any Pneuma session with:

\`\`\`
pneuma mode add github:<your-user>/<your-repo>
\`\`\`

## Modes

Add modes via \`pneuma library publish <mode-name>\` from any local mode.
This file is regenerated as you publish — feel free to edit freely below.
`;

const STARTER_GITIGNORE = `# Pneuma library sidecar
.library.json

# Local-only artifacts
.DS_Store
node_modules
`;

// ── Init ────────────────────────────────────────────────────────────────────

export interface InitLocalLibraryOptions {
  /** Library slug — also the directory name under ~/.pneuma/libraries/. */
  name: string;
  /** Display name shown in the launcher card. Defaults to `name`. */
  displayName?: string;
  /** One-line description for the launcher card. */
  description?: string;
  /** Optional author handle (display only). */
  author?: string;
}

/**
 * Scaffold a brand-new local library and write its `.library.json` sidecar.
 *
 * The result is a working library directory ready for `git remote add` +
 * `git push`. We deliberately leave remote wiring to the user (or to the
 * `--github` flag in the CLI, which uses `gh repo create --source --push`
 * for a one-shot init + remote + push).
 */
export function initLocalLibrary(opts: InitLocalLibraryOptions): InstalledLibrary {
  const id = opts.name;
  validateLibraryId(id);
  const dir = getLibraryDir(id);
  if (existsSync(dir)) {
    throw new Error(
      `[library-publish] ${dir} already exists. Pick a different name or unlink the existing library first.`,
    );
  }
  mkdirSync(dir, { recursive: true });

  // Write the repo-side manifest. Authors expand it later (description,
  // explicit modes list) — we ship a minimal stub.
  const repoManifest: LibraryManifest = {
    version: 1,
    name: id,
    ...(opts.displayName ? { displayName: opts.displayName } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.author ? { author: opts.author } : {}),
    modes: [],
  };
  writeFileSync(
    join(dir, "pneuma.library.json"),
    JSON.stringify(repoManifest, null, 2),
    "utf-8",
  );
  writeFileSync(join(dir, "README.md"), STARTER_README(opts.displayName || id), "utf-8");
  writeFileSync(join(dir, ".gitignore"), STARTER_GITIGNORE, "utf-8");

  // Init the git repo. We don't fail the whole init if git is missing —
  // libraries can be useful locally; the user just can't push.
  try {
    runGitSync(["init", "-b", "main"], dir);
    runGitSync(["add", "."], dir);
    runGitSync(
      ["commit", "-m", `Initial commit: ${id} library scaffold`],
      dir,
    );
  } catch (err) {
    console.warn(
      `[library-publish] git init failed (continuing without git): ${String(err)}`,
    );
  }

  // Write the consume-side sidecar. The library starts empty until the
  // first publish.
  const shape: Extract<RepoShape, { kind: "library" }> = {
    kind: "library",
    manifest: repoManifest,
    modes: [],
  };
  const report = linkLibrary(
    id,
    dir,
    shape,
    { type: "local", path: dir },
    readGitShaSync(dir),
  );
  return report.library;
}

// ── Publish ─────────────────────────────────────────────────────────────────

export interface PublishOptions {
  /** Absolute path to the mode dir being published (must have manifest.ts). */
  sourceModeDir: string;
  /** Target library id (= dir name under ~/.pneuma/libraries/). */
  libraryId: string;
  /**
   * Optional override for the mode's name inside the library. Defaults to
   * the source dir basename, which the resolver then surfaces verbatim.
   */
  name?: string;
  /**
   * When true, push to the library's git remote after committing. Off by
   * default — most flows want the user to inspect locally first.
   */
  push?: boolean;
}

export interface PublishResult {
  /** Path the mode landed at inside the library. */
  destDir: string;
  /** Updated library state after sync. */
  library: InstalledLibrary;
  /** True when the mode was added; false when it was already present and got rewritten. */
  added: boolean;
  /** True when a git commit was created. False when the working tree was already clean. */
  committed: boolean;
  /** True when `push: true` was requested AND the push succeeded. */
  pushed: boolean;
}

/**
 * Copy a mode directory into a linked library, update the repo's
 * `pneuma.library.json` (when present) to include the new mode, sync the
 * sidecar, and optionally push.
 *
 * The source is copied **into** the library — we don't move or symlink.
 * That keeps the original (typically `~/.pneuma/modes/<x>/` or a project
 * session dir) intact, which is what users expect.
 */
export function publishModeToLibrary(opts: PublishOptions): PublishResult {
  const lib = readLibrary(opts.libraryId);
  if (!lib) {
    throw new Error(`[library-publish] Library "${opts.libraryId}" is not linked.`);
  }
  const libDir = getLibraryDir(opts.libraryId);
  if (!existsSync(opts.sourceModeDir)) {
    throw new Error(`[library-publish] Source mode dir not found: ${opts.sourceModeDir}`);
  }
  if (!hasManifest(opts.sourceModeDir)) {
    throw new Error(
      `[library-publish] ${opts.sourceModeDir} is not a mode package (no manifest.ts).`,
    );
  }

  const modeName = (opts.name || basename(opts.sourceModeDir)).trim();
  if (!modeName) {
    throw new Error(`[library-publish] Could not derive a mode name; pass --as <name>.`);
  }
  validateLibraryId(modeName); // mode names share the same slug rules

  const destDir = join(libDir, modeName);
  const safe = safeSubpath(libDir, modeName);
  if (!safe || safe !== destDir) {
    throw new Error(`[library-publish] Mode name "${modeName}" escapes the library root`);
  }

  const wasPresent = existsSync(destDir);
  if (wasPresent) {
    rmSync(destDir, { recursive: true, force: true });
  }
  cpSync(opts.sourceModeDir, destDir, { recursive: true });

  // Update the repo-side index, if one exists. Auto-scan libraries don't
  // strictly need an entry, but a maintained `pneuma.library.json` lets
  // authors curate display order and intentionally omit WIP dirs.
  upsertRepoManifestEntry(libDir, modeName);

  // Reconcile the consume-side sidecar.
  const shape = detectRepoShape(libDir, lib.name);
  if (shape.kind !== "library") {
    throw new Error(
      `[library-publish] Library ${opts.libraryId} no longer looks like a library after publish — aborting`,
    );
  }
  const sha = readGitShaSync(libDir);
  const reconciled = syncLibrary(opts.libraryId, shape, sha);

  // Stage + commit. We tolerate "nothing to commit" because rewriting an
  // already-current mode is a valid no-op publish (e.g. user clicked the
  // button twice).
  let committed = false;
  try {
    runGitSync(["add", "-A"], libDir);
    if (hasStagedChanges(libDir)) {
      const verb = wasPresent ? "update" : "add";
      runGitSync(
        [
          "commit",
          "-m",
          `library: ${verb} ${modeName}`,
        ],
        libDir,
      );
      committed = true;
    }
  } catch (err) {
    console.warn(`[library-publish] git commit failed: ${String(err)}`);
  }

  // After commit, the sha may have moved — re-record so the sidecar
  // matches HEAD.
  if (committed) {
    const newSha = readGitShaSync(libDir);
    const refreshed = readLibrary(opts.libraryId);
    if (refreshed) {
      writeLibrary({ ...refreshed, sha: newSha, lastSync: Date.now() });
    }
  }

  let pushed = false;
  if (opts.push) {
    try {
      pushLibrary(opts.libraryId);
      pushed = true;
    } catch (err) {
      // Bubble up — push failure is the most common author-side error
      // and the user needs to see it explicitly.
      throw new Error(
        `Published locally but push failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Fix git credentials (try \`gh auth login\`) and run \`pneuma library push ${opts.libraryId}\`.`,
      );
    }
  }

  return {
    destDir,
    library: reconciled.library,
    added: !wasPresent,
    committed,
    pushed,
  };
}

/**
 * Push the library's local clone to its `origin` remote. Used by both the
 * CLI (`pneuma library push`) and the publish `--push` flag.
 */
export function pushLibrary(libraryId: string): void {
  const dir = getLibraryDir(libraryId);
  if (!existsSync(dir)) {
    throw new Error(`Library "${libraryId}" is not linked locally.`);
  }
  if (!existsSync(join(dir, ".git"))) {
    throw new Error(
      `Library "${libraryId}" has no git repo. Run \`git init\` + \`git remote add origin …\` first, ` +
        `or re-create with \`pneuma library init\`.`,
    );
  }
  runGitSync(["push", "origin", "HEAD"], dir);
}

/**
 * Idempotent insert/update of one entry in the repo-side
 * `pneuma.library.json`. When the file is absent we leave it that way —
 * the resolver's auto-scan path picks up the mode on next install.
 */
function upsertRepoManifestEntry(libDir: string, modeName: string): void {
  const path = join(libDir, "pneuma.library.json");
  if (!existsSync(path)) return;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  let parsed: LibraryManifest;
  try {
    parsed = JSON.parse(raw) as LibraryManifest;
  } catch {
    return;
  }
  const entries = parsed.modes ?? [];
  if (entries.some((e) => (e.name ?? basename(e.path)) === modeName)) {
    return; // already listed
  }
  entries.push({ path: modeName });
  parsed.modes = entries;
  writeFileSync(path, JSON.stringify(parsed, null, 2), "utf-8");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasManifest(dir: string): boolean {
  return (
    existsSync(join(dir, "manifest.ts")) ||
    existsSync(join(dir, "manifest.js"))
  );
}

/**
 * Library + mode slug rules: alphanumerics, dash, underscore, dot. Same
 * restrictions on both because mode dir names sit inside library dirs.
 * Reject control characters and path separators outright.
 */
function validateLibraryId(id: string): void {
  if (!id || id.length > 80) {
    throw new Error(`Invalid library/mode name: must be 1–80 chars`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(
      `Invalid library/mode name "${id}": use only letters, digits, dot, dash, underscore`,
    );
  }
  if (id.startsWith(".") || id.startsWith("-")) {
    throw new Error(`Library/mode name must not start with "." or "-"`);
  }
}

function safeSubpath(root: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const resolved = normalize(join(root, rel));
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}

function runGitSync(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // Bun.spawnSync doesn't honor a timeout option, but `git` operations
    // here are local-only except `push` — keep the helper simple.
  });
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr).trim();
    throw new Error(`git ${args[0]} failed (code ${proc.exitCode}): ${stderr}`);
  }
  return new TextDecoder().decode(proc.stdout);
}

function readGitShaSync(cwd: string): string | null {
  try {
    const out = runGitSync(["rev-parse", "HEAD"], cwd);
    const sha = out.trim();
    return sha || null;
  } catch {
    return null;
  }
}

function hasStagedChanges(cwd: string): boolean {
  try {
    const proc = Bun.spawnSync(["git", "diff", "--cached", "--quiet"], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc.exitCode !== 0;
  } catch {
    return false;
  }
}

// Re-export for callers that compose with library-registry without
// pulling that module directly.
export { getLibrariesDir, getLibraryDir, getLibrarySidecarPath };

// Silence the "unused" lint for `resolve` / `statSync` / `dirname` —
// kept for future helpers (path-normalization, conflict-resolution).
void resolve;
void statSync;
void dirname;
