/**
 * Library Registry — `~/.pneuma/libraries/` CRUD layer.
 *
 * One library = one cloned repo containing N modes. Each lives under
 * `~/.pneuma/libraries/<id>/` next to a `.library.json` sidecar that
 * tracks source URL, last-synced git sha, and per-mode activation.
 *
 * This module is the single source of truth for that directory tree.
 * It owns shape detection (`detectRepoShape`), the link / sync / activate
 * lifecycle, and atomic sidecar reads/writes. Higher layers (the resolver,
 * CLI, server routes) call in here — they do not touch the layout
 * directly.
 *
 * Design notes:
 * - Sync API to match the surrounding sync resolver / mode-loader code.
 *   Git invocations are spawned via `Bun.spawn` and awaited; everything
 *   else is plain fs.
 * - Writes are atomic (tmp-then-rename) so concurrent pneuma processes
 *   can't observe a torn `.library.json`.
 * - "Not found" is a `null` return, not an exception. Schema errors and
 *   filesystem failures still throw — they're bugs, not flow control.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, basename, isAbsolute, normalize, sep } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type {
  InstalledLibrary,
  InstalledLibraryMode,
  LibraryManifest,
  LibrarySource,
} from "./types/library.js";

/** Root directory for all installed libraries. */
export function getLibrariesDir(): string {
  return join(homedir(), ".pneuma", "libraries");
}

/** Absolute path to one library's directory. */
export function getLibraryDir(id: string): string {
  return join(getLibrariesDir(), id);
}

/** Absolute path to one library's sidecar. */
export function getLibrarySidecarPath(id: string): string {
  return join(getLibraryDir(id), ".library.json");
}

// ── Shape detection ─────────────────────────────────────────────────────────

/** Result of inspecting a repo on disk after clone/extract. */
export type RepoShape =
  | { kind: "single" }
  | {
      kind: "library";
      /** Resolved library manifest — derived from `pneuma.library.json` or auto-scan. */
      manifest: LibraryManifest;
      /** Per-mode entries with resolved manifest version. */
      modes: ResolvedRepoMode[];
    };

/** A mode discovered inside a library repo, with its manifest version resolved. */
export interface ResolvedRepoMode {
  /** Installed mode name (display + filesystem). */
  name: string;
  /** Path relative to the repo root, e.g. "modes/dual-reader". */
  relPath: string;
  /** Version read from the mode's manifest.ts. */
  manifestVersion: string;
}

/**
 * Inspect a freshly-cloned (or freshly-extracted) repo and classify it.
 *
 * Rules, in order:
 * 1. Root has `manifest.ts` (or `.js`) → single-mode repo (legacy path, unchanged).
 * 2. Root has `pneuma.library.json` → library, modes from explicit index.
 * 3. Otherwise scan immediate subdirs; any subdir with `manifest.ts` → library.
 *
 * Throws on malformed `pneuma.library.json` or when an explicit entry points
 * at a missing/non-mode path. A repo that matches neither pattern (no root
 * manifest, no subdir manifests, no library.json) returns `{ kind: "single" }`
 * to let the caller's existing single-mode validation throw the usual
 * "missing manifest" error — that keeps the failure message stable.
 *
 * @param repoDir Absolute path to the cloned repo root.
 * @param defaultLibraryName Library name to fall back to when the repo
 *   doesn't ship a `pneuma.library.json` (typically `<user>-<repo>`).
 */
export function detectRepoShape(
  repoDir: string,
  defaultLibraryName: string,
): RepoShape {
  if (hasManifest(repoDir)) {
    return { kind: "single" };
  }

  const libManifestPath = join(repoDir, "pneuma.library.json");
  if (existsSync(libManifestPath)) {
    const manifest = parseLibraryManifest(libManifestPath, defaultLibraryName);
    const modes = resolveExplicitEntries(repoDir, manifest);
    return { kind: "library", manifest, modes };
  }

  const scanned = autoScanModes(repoDir);
  if (scanned.length > 0) {
    const manifest: LibraryManifest = { version: 1, name: defaultLibraryName };
    return { kind: "library", manifest, modes: scanned };
  }

  // No root manifest, no library manifest, no subdir manifests. Hand back
  // `single` so the caller's existing validator surfaces the canonical
  // "missing manifest.ts" error message — we don't want to break that path.
  return { kind: "single" };
}

function hasManifest(dir: string): boolean {
  return (
    existsSync(join(dir, "manifest.ts")) ||
    existsSync(join(dir, "manifest.js"))
  );
}

function parseLibraryManifest(
  path: string,
  defaultName: string,
): LibraryManifest {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`[library-registry] Failed to read ${path}: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[library-registry] ${path} is not valid JSON: ${String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`[library-registry] ${path}: expected JSON object`);
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(
      `[library-registry] ${path}: unsupported version ${String(obj.version)} (expected 1)`,
    );
  }
  const name = typeof obj.name === "string" && obj.name ? obj.name : defaultName;
  const manifest: LibraryManifest = { version: 1, name };
  if (typeof obj.displayName === "string") manifest.displayName = obj.displayName;
  if (typeof obj.description === "string") manifest.description = obj.description;
  if (typeof obj.author === "string") manifest.author = obj.author;
  if (Array.isArray(obj.modes)) {
    manifest.modes = obj.modes.map((entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `[library-registry] ${path}: modes[${i}] must be an object`,
        );
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== "string" || !e.path) {
        throw new Error(
          `[library-registry] ${path}: modes[${i}].path is required`,
        );
      }
      return {
        path: e.path,
        ...(typeof e.name === "string" && e.name ? { name: e.name } : {}),
      };
    });
  }
  return manifest;
}

function resolveExplicitEntries(
  repoDir: string,
  manifest: LibraryManifest,
): ResolvedRepoMode[] {
  if (!manifest.modes || manifest.modes.length === 0) {
    // Explicit manifest but no entries → empty library is allowed but rare.
    return [];
  }
  const out: ResolvedRepoMode[] = [];
  for (const entry of manifest.modes) {
    const safe = safeSubpath(repoDir, entry.path);
    if (!safe) {
      throw new Error(
        `[library-registry] pneuma.library.json entry "${entry.path}" escapes the repo root`,
      );
    }
    if (!hasManifest(safe)) {
      throw new Error(
        `[library-registry] pneuma.library.json entry "${entry.path}" has no manifest.ts`,
      );
    }
    const name = entry.name ?? basename(safe);
    out.push({
      name,
      relPath: entry.path,
      manifestVersion: readManifestVersion(safe),
    });
  }
  return out;
}

function autoScanModes(repoDir: string): ResolvedRepoMode[] {
  let entries;
  try {
    entries = readdirSync(repoDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ResolvedRepoMode[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue; // skip .git, etc.
    const sub = join(repoDir, ent.name);
    if (!hasManifest(sub)) continue;
    out.push({
      name: ent.name,
      relPath: ent.name,
      manifestVersion: readManifestVersion(sub),
    });
  }
  // Stable ordering for deterministic UI / sidecar.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Pull the manifest's `version` field out without evaluating TS.
 * Mirrors the regex extraction in `core/utils/manifest-parser.ts` but
 * scoped to just the version — we don't need the rest here.
 * Falls back to "0.0.0" when missing or unreadable.
 */
function readManifestVersion(modeDir: string): string {
  for (const fname of ["manifest.ts", "manifest.js"]) {
    const full = join(modeDir, fname);
    if (!existsSync(full)) continue;
    try {
      const src = readFileSync(full, "utf-8");
      const match = src.match(/version\s*:\s*["'`]([^"'`]+)["'`]/);
      if (match) return match[1];
    } catch {
      // fall through
    }
  }
  return "0.0.0";
}

function safeSubpath(root: string, rel: string): string | null {
  if (isAbsolute(rel)) return null;
  const resolved = normalize(join(root, rel));
  // Must stay rooted under `root` (defense against "../" escapes).
  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}

// ── Sidecar I/O ─────────────────────────────────────────────────────────────

/**
 * Read a library's `.library.json`. Returns null when the file is absent
 * (which happens for first-time installs before the sidecar is written).
 * Throws on schema mismatch — that's a real bug, not a missing-file case.
 */
export function readLibrary(id: string): InstalledLibrary | null {
  const path = getLibrarySidecarPath(id);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`[library-registry] Failed to read ${path}: ${String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[library-registry] ${path} is not valid JSON: ${String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`[library-registry] ${path}: expected JSON object`);
  }
  // We trust the shape since Pneuma is the only writer. Schema migrations
  // would land here as discriminated branches.
  return parsed as InstalledLibrary;
}

/** Atomic write of `.library.json`. Creates the parent dir if needed. */
export function writeLibrary(library: InstalledLibrary): void {
  const dir = getLibraryDir(library.id);
  mkdirSync(dir, { recursive: true });
  const path = getLibrarySidecarPath(library.id);
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, JSON.stringify(library, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ── Listing ─────────────────────────────────────────────────────────────────

/**
 * Enumerate all installed libraries. Skips entries without a sidecar
 * (treated as in-flight / corrupted; callers can offer a repair).
 */
export function listLibraries(): InstalledLibrary[] {
  const root = getLibrariesDir();
  if (!existsSync(root)) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: InstalledLibrary[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    let lib: InstalledLibrary | null = null;
    try {
      lib = readLibrary(ent.name);
    } catch {
      continue; // skip corrupt sidecars; surfaced separately via repair UX
    }
    if (lib) out.push(lib);
  }
  out.sort((a, b) => b.lastSync - a.lastSync);
  return out;
}

// ── Link (first-time install) ───────────────────────────────────────────────

/** Result of a link or sync operation, suitable for CLI reporting. */
export interface LibrarySyncReport {
  library: InstalledLibrary;
  added: string[];
  removed: string[];
  updated: { name: string; from: string; to: string }[];
  /** True when the underlying git sha didn't change. */
  noop: boolean;
}

/**
 * Materialize an `InstalledLibrary` from a freshly-cloned repo + its
 * detected shape. Used by the resolver's library branch after clone.
 *
 * @param id Library id (e.g. `<user>-<repo>`).
 * @param repoDir Absolute path to the cloned repo on disk (matches `getLibraryDir(id)`).
 * @param shape Detected repo shape (must be `kind: "library"`).
 * @param source Where the library was linked from.
 * @param sha Git sha (or content hash) observed for this clone, or null when unknown.
 */
export function linkLibrary(
  id: string,
  repoDir: string,
  shape: Extract<RepoShape, { kind: "library" }>,
  source: LibrarySource,
  sha: string | null,
): LibrarySyncReport {
  // Refuse to install over an unrelated directory by accident.
  const expectedDir = getLibraryDir(id);
  if (normalize(repoDir) !== normalize(expectedDir)) {
    throw new Error(
      `[library-registry] linkLibrary: repoDir ${repoDir} does not match expected ${expectedDir}`,
    );
  }

  const modes: InstalledLibraryMode[] = shape.modes.map((m) => ({
    name: m.name,
    path: m.relPath,
    manifestVersion: m.manifestVersion,
    activated: true,
    installedVersion: m.manifestVersion,
  }));

  const library: InstalledLibrary = {
    version: 1,
    id,
    name: shape.manifest.name,
    ...(shape.manifest.displayName ? { displayName: shape.manifest.displayName } : {}),
    ...(shape.manifest.description ? { description: shape.manifest.description } : {}),
    ...(shape.manifest.author ? { author: shape.manifest.author } : {}),
    source,
    sha,
    lastSync: Date.now(),
    modes,
  };
  writeLibrary(library);
  return {
    library,
    added: modes.map((m) => m.name),
    removed: [],
    updated: [],
    noop: false,
  };
}

// ── Sync (reconcile sidecar after re-fetch) ─────────────────────────────────

/**
 * Reconcile a library's sidecar against the current state of its on-disk
 * repo. Caller is responsible for advancing the repo (git fetch + checkout
 * or re-extract) before invoking this — `syncLibrary` does not touch git.
 *
 * Diff rules:
 * - New mode (in repo, not in sidecar) → added, `activated: true` by default.
 * - Removed mode (in sidecar, not in repo) → dropped.
 * - Mode whose manifest version differs from the recorded `manifestVersion`
 *   → recorded as `updated`; `installedVersion` is NOT bumped automatically
 *   (mirrors the existing skill-update prompt — the user accepts updates
 *   explicitly via the launcher).
 * - `activated` is preserved for existing modes.
 *
 * @param id Library id.
 * @param shape Detected shape from re-running `detectRepoShape`.
 * @param newSha Git sha (or null) observed after the advance.
 */
export function syncLibrary(
  id: string,
  shape: Extract<RepoShape, { kind: "library" }>,
  newSha: string | null,
): LibrarySyncReport {
  const prev = readLibrary(id);
  if (!prev) {
    throw new Error(
      `[library-registry] syncLibrary: ${id} has no sidecar; call linkLibrary first`,
    );
  }

  const prevByName = new Map(prev.modes.map((m) => [m.name, m]));
  const nextByName = new Map(shape.modes.map((m) => [m.name, m]));

  const added: string[] = [];
  const updated: { name: string; from: string; to: string }[] = [];
  const modes: InstalledLibraryMode[] = [];

  for (const m of shape.modes) {
    const prior = prevByName.get(m.name);
    if (!prior) {
      added.push(m.name);
      modes.push({
        name: m.name,
        path: m.relPath,
        manifestVersion: m.manifestVersion,
        activated: true,
        installedVersion: m.manifestVersion,
      });
      continue;
    }
    if (prior.manifestVersion !== m.manifestVersion) {
      updated.push({
        name: m.name,
        from: prior.manifestVersion,
        to: m.manifestVersion,
      });
    }
    modes.push({
      name: m.name,
      path: m.relPath,
      manifestVersion: m.manifestVersion,
      activated: prior.activated,
      installedVersion: prior.installedVersion,
    });
  }

  const removed: string[] = [];
  for (const m of prev.modes) {
    if (!nextByName.has(m.name)) removed.push(m.name);
  }

  const noop =
    prev.sha !== null &&
    newSha !== null &&
    prev.sha === newSha &&
    added.length === 0 &&
    removed.length === 0 &&
    updated.length === 0;

  const library: InstalledLibrary = {
    ...prev,
    name: shape.manifest.name,
    ...(shape.manifest.displayName !== undefined
      ? { displayName: shape.manifest.displayName }
      : { displayName: prev.displayName }),
    ...(shape.manifest.description !== undefined
      ? { description: shape.manifest.description }
      : { description: prev.description }),
    ...(shape.manifest.author !== undefined
      ? { author: shape.manifest.author }
      : { author: prev.author }),
    sha: newSha,
    lastSync: Date.now(),
    modes,
  };
  writeLibrary(library);
  return { library, added, removed, updated, noop };
}

// ── Activation ──────────────────────────────────────────────────────────────

/**
 * Flip a mode's `activated` flag. Returns the updated library so callers
 * can broadcast a UI tick. Throws when the library or mode doesn't exist —
 * those are caller bugs (the UI shouldn't offer activation for things
 * that aren't there).
 */
export function setModeActivated(
  id: string,
  modeName: string,
  activated: boolean,
): InstalledLibrary {
  const prev = readLibrary(id);
  if (!prev) {
    throw new Error(`[library-registry] Library ${id} not found`);
  }
  const idx = prev.modes.findIndex((m) => m.name === modeName);
  if (idx === -1) {
    throw new Error(
      `[library-registry] Mode ${modeName} not found in library ${id}`,
    );
  }
  if (prev.modes[idx].activated === activated) return prev;
  const modes = prev.modes.slice();
  modes[idx] = { ...modes[idx], activated };
  const next: InstalledLibrary = { ...prev, modes };
  writeLibrary(next);
  return next;
}

/**
 * Accept the current `manifestVersion` of a mode as installed. Called by
 * the launcher's skill-update flow when the user clicks "Update". Idempotent.
 */
export function acceptModeUpdate(id: string, modeName: string): InstalledLibrary {
  const prev = readLibrary(id);
  if (!prev) {
    throw new Error(`[library-registry] Library ${id} not found`);
  }
  const idx = prev.modes.findIndex((m) => m.name === modeName);
  if (idx === -1) {
    throw new Error(
      `[library-registry] Mode ${modeName} not found in library ${id}`,
    );
  }
  const m = prev.modes[idx];
  if (m.installedVersion === m.manifestVersion) return prev;
  const modes = prev.modes.slice();
  modes[idx] = { ...m, installedVersion: m.manifestVersion };
  const next: InstalledLibrary = { ...prev, modes };
  writeLibrary(next);
  return next;
}

// ── Unlink ──────────────────────────────────────────────────────────────────

/**
 * Remove a library and its on-disk clone. Returns true when something was
 * removed, false when the library wasn't there.
 */
export function unlinkLibrary(id: string): boolean {
  const dir = getLibraryDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

// ── Resolution helpers (used by registry endpoint) ──────────────────────────

/**
 * Absolute on-disk path for a library mode. Returns `null` when either
 * the library or the mode is unknown — callers (the registry endpoint,
 * the mode loader) treat this as "not installed" rather than an error.
 */
export function getLibraryModePath(id: string, modeName: string): string | null {
  const lib = readLibrary(id);
  if (!lib) return null;
  const m = lib.modes.find((mm) => mm.name === modeName);
  if (!m) return null;
  const dir = getLibraryDir(id);
  const safe = safeSubpath(dir, m.path);
  if (!safe || !existsSync(safe)) return null;
  // Sanity check — the directory should still look like a mode package.
  if (!hasManifest(safe)) return null;
  // Confirm the resolved path is actually a directory.
  try {
    if (!statSync(safe).isDirectory()) return null;
  } catch {
    return null;
  }
  return safe;
}
