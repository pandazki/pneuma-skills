#!/usr/bin/env bun
/**
 * publish-modes — build, pack and upload every catalog mode for one core release.
 *
 *   bun scripts/publish-modes.ts --version 3.52.0
 *   bun scripts/publish-modes.ts --version 3.52.0 --dry-run --out /tmp/pub
 *   bun scripts/publish-modes.ts --version 3.52.0 --only backlot,doc
 *
 * A *catalog* mode is any `modes/<name>/` with a `manifest.ts` that
 * `modes/distribution.json` does not list as bundled. It leaves only its
 * `showcase/` images in the npm package; the mode itself is downloaded from
 * the CDN on first use. Because a published viewer bundle inlines this
 * core's `src/`/`core/` helpers and depends on the host's React, store and
 * Tailwind build, a bundle is only valid on the release that produced it —
 * so every release republishes every catalog mode under its own version
 * prefix and pins the result by SHA-256 (D3/D9 of
 * docs/proposals/2026-09-22-mode-distribution.md).
 *
 * Keys (immutable once `pneuma-skills@<version>` is on npm):
 *   official/v<version>/<name>-<modeVersion>.tar.gz
 *   official/v<version>/catalog.json
 *
 * The generated `modes/catalog.json` is what the package ships; it is never
 * hand-edited and never committed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createModeArchive } from "../snapshot/archive.js";
import { buildModeForPublish, cleanModeBuild } from "../snapshot/mode-build.js";
import { loadCredentials, checkR2KeyExists, uploadToR2, uploadJsonToR2 } from "../snapshot/r2.js";
import type { R2Credentials } from "../snapshot/types.js";
import { parseManifestTs } from "../core/utils/manifest-parser.js";
import { SUPPORTED_LOCALES } from "../core/locale.js";
import type { LocalizedString } from "../core/types/mode-manifest.js";
import {
  MODE_CATALOG_FILE,
  MODE_CATALOG_FORMAT,
  MODE_PACKAGE_STAMP,
  type ModeCatalog,
  type ModeCatalogEntry,
  type ModePackageStamp,
} from "../core/types/mode-catalog.js";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Public CDN in front of the R2 bucket. Overridable for tests and forks. */
export const DEFAULT_PUBLIC_BASE_URL = "https://pneuma-storage.vibecoding.icu";

/** Key prefix that keeps first-party archives apart from mode-maker publishes. */
export const OFFICIAL_PREFIX = "official";

/** npm package whose version seals a release's keys. */
export const NPM_PACKAGE = "pneuma-skills";

/**
 * Directories that never travel in an archive.
 * `showcase/` and `harness/` are top-level only: `showcase/` stays in the npm
 * package (it is what the launcher card shows before a download) and a nested
 * `showcase` could be seed content. `__tests__/` and `node_modules/` are
 * dropped at any depth — the latter because a dev `bun install` inside a mode
 * leaves one behind and it would double the archive.
 */
const TOP_LEVEL_EXCLUDES = new Set(["showcase", "harness"]);
const ANY_DEPTH_EXCLUDES = new Set(["__tests__", "node_modules", ".git", ".pneuma", ".claude", ".DS_Store"]);

/**
 * Fixed mtime for every staged file, so an archive's bytes depend on the
 * mode's content and nothing else. Without it, `tar` records the copy time
 * and two archives of identical content would not compare equal.
 */
const STAGED_MTIME = new Date("2020-01-01T00:00:00.000Z");

export interface PublishedModeResult {
  entry: ModeCatalogEntry;
  /** R2 key the archive belongs at. */
  key: string;
  /** Where the archive was written locally. */
  archivePath: string;
  /** What the upload pass did (`"skipped"` = the key already held these bytes). */
  upload: "uploaded" | "skipped" | "dry-run";
}

export interface PublishModesResult {
  catalog: ModeCatalog;
  modes: PublishedModeResult[];
  /** Where `catalog.json` was written locally. */
  catalogPath: string;
}

/** Where archives and the catalog live remotely. Injectable so tests never touch R2. */
export interface ArchiveStore {
  /** Base URL the catalog's pinned archive URLs are built from. */
  readonly publicUrl: string;
  /** SHA-256 of the bytes currently readable at `key`, or `null` when there are none. */
  readSha256(key: string): Promise<string | null>;
  /** Parsed JSON currently readable at `key`, or `null`. */
  readJson(key: string): Promise<unknown | null>;
  putFile(key: string, filePath: string): Promise<string>;
  putJson(key: string, value: unknown): Promise<string>;
}

export interface PublishModesOptions {
  /** Core release these archives belong to. */
  version: string;
  /** Build and pack, but never upload. Writes everything under `outDir`. */
  dryRun: boolean;
  /** Staging directory for archives and the catalog copy. */
  outDir: string;
  /** Restrict the run to these mode names (still validated against the catalog set). */
  only?: string[];
  /** Root holding the mode directories and `distribution.json`. */
  modesDir?: string;
  /** Where the shipped catalog is written on a real run. Defaults to `<modesDir>/catalog.json`. */
  catalogPath?: string;
  /** Base URL for the pinned archive URLs. Defaults to the store's, then the CDN. */
  baseUrl?: string;
  /** Stamped into every archive. One value per run; injectable so a test can compare bytes. */
  builtAt?: string;
  /** Remote side. Required unless `dryRun`. */
  store?: ArchiveStore;
  /** Whether `pneuma-skills@<version>` is already on npm — the seal on a release's keys. */
  isVersionOnNpm?: (version: string) => Promise<boolean>;
  log?: (line: string) => void;
}

/** Thrown instead of overwriting an archive belonging to a release that is already on npm. */
export class PublishRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefusedError";
  }
}

// ── Distribution set ─────────────────────────────────────────────────────────

export interface Distribution {
  bundled: string[];
}

export function readDistribution(modesDir: string): Distribution {
  const raw = readFileSync(join(modesDir, "distribution.json"), "utf-8");
  const parsed = JSON.parse(raw) as Partial<Distribution>;
  if (!Array.isArray(parsed.bundled)) {
    throw new Error(`${join(modesDir, "distribution.json")}: "bundled" must be an array`);
  }
  return { bundled: parsed.bundled };
}

/** Every directory under `modesDir` that declares a mode. */
export function modeDirNames(modesDir: string): string[] {
  return readdirSync(modesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(modesDir, e.name, "manifest.ts")))
    .map((e) => e.name)
    .sort();
}

/**
 * The catalog set: every mode directory `distribution.json` does not bundle.
 * Sorted, which is also the catalog's entry order — a release must produce the
 * same catalog from the same commit.
 */
export function catalogModeNames(modesDir: string): string[] {
  const { bundled } = readDistribution(modesDir);
  return modeDirNames(modesDir).filter((name) => !bundled.includes(name));
}

export function archiveKey(version: string, name: string, modeVersion: string): string {
  return `${OFFICIAL_PREFIX}/v${version}/${name}-${modeVersion}.tar.gz`;
}

export function catalogKey(version: string): string {
  return `${OFFICIAL_PREFIX}/v${version}/${MODE_CATALOG_FILE}`;
}

// ── Manifest metadata ────────────────────────────────────────────────────────

/**
 * Read a LocalizedString field out of manifest source. `parseManifestTs`
 * resolves one locale per pass, so the map is rebuilt by asking for each
 * supported locale and keeping the values that actually differ from `en`
 * (a missing locale falls back to `en` inside the parser).
 */
function localizedField(source: string, field: "displayName" | "description"): LocalizedString | undefined {
  const en = parseManifestTs(source, "en")[field];
  if (!en) return undefined;
  const map: Record<string, string> = { en };
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === "en") continue;
    const value = parseManifestTs(source, locale)[field];
    if (value && value !== en) map[locale] = value;
  }
  return Object.keys(map).length === 1 ? en : (map as LocalizedString);
}

interface ModeMetadata {
  name: string;
  version: string;
  displayName: LocalizedString;
  description?: LocalizedString;
  icon?: string;
}

export function readModeMetadata(modeDir: string, name: string): ModeMetadata {
  const source = readFileSync(join(modeDir, "manifest.ts"), "utf-8");
  const parsed = parseManifestTs(source);
  if (!parsed.version) throw new Error(`${name}: manifest.ts has no version`);
  const displayName = localizedField(source, "displayName");
  if (!displayName) throw new Error(`${name}: manifest.ts has no displayName`);
  return {
    name: parsed.name ?? name,
    version: parsed.version,
    displayName,
    description: localizedField(source, "description"),
    icon: parsed.icon,
  };
}

// ── Staging ──────────────────────────────────────────────────────────────────

/**
 * Copy `src` into `dst`, dropping the excluded directories and returning the
 * number of bytes written. Copying rather than archiving in place is what lets
 * the stamp and the `.build/` bundle sit beside the source without touching
 * the repository, and it is where `unpackedSize` is measured.
 */
function stageTree(src: string, dst: string, depth = 0): number {
  mkdirSync(dst, { recursive: true });
  let bytes = 0;
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (ANY_DEPTH_EXCLUDES.has(entry.name)) continue;
    if (depth === 0 && TOP_LEVEL_EXCLUDES.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      bytes += stageTree(from, to, depth + 1);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      bytes += statSync(to).size;
      utimesSync(to, STAGED_MTIME, STAGED_MTIME);
    }
    // Symlinks and sockets are not part of a mode package; skipping them
    // keeps the archive a plain file tree on every platform.
  }
  return bytes;
}

/** Second pass: directory mtimes settle only after their children are written. */
function normalizeDirTimes(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) normalizeDirTimes(join(dir, entry.name));
  }
  utimesSync(dir, STAGED_MTIME, STAGED_MTIME);
}

/**
 * Zero the gzip header's MTIME field (RFC 1952 bytes 4..7, "no timestamp").
 * `tar czf` writes the current clock there, which would make two archives of
 * identical content differ — and the catalog's `sha256` is supposed to be an
 * identity for the bytes, not for the moment they were packed.
 */
function clearGzipTimestamp(path: string): void {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length < 8 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error(`${path}: not a gzip stream`);
  }
  bytes[4] = 0; bytes[5] = 0; bytes[6] = 0; bytes[7] = 0;
  writeFileSync(path, bytes);
}

async function sha256OfFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

// ── Build + pack one mode ────────────────────────────────────────────────────

interface PackedMode {
  meta: ModeMetadata;
  archivePath: string;
  size: number;
  sha256: string;
  unpackedSize: number;
}

async function packMode(
  modeDir: string,
  name: string,
  outDir: string,
  stageRoot: string,
  coreVersion: string,
  builtAt: string,
): Promise<PackedMode> {
  const meta = readModeMetadata(modeDir, name);

  // Build IN the repository, then stage — never stage first and build the
  // copy. A mode's dependencies resolve against the repository's
  // node_modules, and some of them only resolve from inside it:
  // `modes/draw` imports `@excalidraw/excalidraw/index.css`, a conditional
  // `exports` alias `Bun.resolveSync` cannot follow from an outside path.
  const built = await buildModeForPublish(modeDir);
  if (!built.success) {
    throw new Error(`${name}: viewer build failed\n  ${built.errors.join("\n  ")}`);
  }

  const stage = join(stageRoot, name);
  rmSync(stage, { recursive: true, force: true });
  try {
    let unpackedSize = stageTree(modeDir, stage);

    const stamp: ModePackageStamp = {
      formatVersion: MODE_CATALOG_FORMAT,
      name: meta.name,
      version: meta.version,
      coreVersion,
      builtAt,
    };
    const stampPath = join(stage, MODE_PACKAGE_STAMP);
    const stampText = JSON.stringify(stamp, null, 2) + "\n";
    writeFileSync(stampPath, stampText);
    unpackedSize += Buffer.byteLength(stampText);
    utimesSync(stampPath, STAGED_MTIME, STAGED_MTIME);
    normalizeDirTimes(stage);

    const archivePath = join(outDir, `${name}-${meta.version}.tar.gz`);
    await createModeArchive(stage, archivePath);
    clearGzipTimestamp(archivePath);

    return {
      meta,
      archivePath,
      size: statSync(archivePath).size,
      sha256: await sha256OfFile(archivePath),
      unpackedSize,
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
    // Leave the repository as it was found: an in-tree `.build/` changes how
    // `bin/pneuma.ts` serves an external mode.
    cleanModeBuild(modeDir);
  }
}

// ── Publish ──────────────────────────────────────────────────────────────────

/** Two catalogs describe the same release when everything but the clock matches. */
export function catalogsEquivalent(a: ModeCatalog, b: ModeCatalog): boolean {
  const strip = ({ generatedAt: _ignored, ...rest }: ModeCatalog) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export async function publishModes(options: PublishModesOptions): Promise<PublishModesResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const modesDir = options.modesDir ?? join(PROJECT_ROOT, "modes");
  const version = options.version;
  const builtAt = options.builtAt ?? new Date().toISOString();

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`--version must be a semver release, got "${version}"`);
  }
  if (!options.dryRun && !options.store) {
    throw new Error("an ArchiveStore is required unless --dry-run is set");
  }

  const all = catalogModeNames(modesDir);
  let names = all;
  if (options.only?.length) {
    const unknown = options.only.filter((n) => !all.includes(n));
    if (unknown.length > 0) {
      throw new Error(`--only names that are not catalog modes: ${unknown.join(", ")} (catalog: ${all.join(", ")})`);
    }
    names = all.filter((n) => options.only!.includes(n));
  }
  if (names.length === 0) throw new Error(`no catalog modes found under ${modesDir}`);

  const baseUrl = (options.baseUrl ?? options.store?.publicUrl ?? DEFAULT_PUBLIC_BASE_URL).replace(/\/$/, "");
  mkdirSync(options.outDir, { recursive: true });
  const stageRoot = join(options.outDir, ".stage");

  const packed: Array<{ packed: PackedMode; key: string; entry: ModeCatalogEntry }> = [];
  for (const name of names) {
    log(`[publish-modes] ${name}: building`);
    const result = await packMode(join(modesDir, name), name, options.outDir, stageRoot, version, builtAt);
    const key = archiveKey(version, name, result.meta.version);
    const entry: ModeCatalogEntry = {
      name: result.meta.name,
      version: result.meta.version,
      displayName: result.meta.displayName,
      ...(result.meta.description ? { description: result.meta.description } : {}),
      ...(result.meta.icon ? { icon: result.meta.icon } : {}),
      archive: { url: `${baseUrl}/${key}`, size: result.size, sha256: result.sha256 },
      unpackedSize: result.unpackedSize,
    };
    packed.push({ packed: result, key, entry });
    log(
      `[publish-modes] ${name}@${result.meta.version}: ${formatBytes(result.size)} archive, ` +
        `${formatBytes(result.unpackedSize)} unpacked, sha256 ${result.sha256.slice(0, 12)}…`,
    );
  }
  rmSync(stageRoot, { recursive: true, force: true });

  const catalog: ModeCatalog = {
    formatVersion: MODE_CATALOG_FORMAT,
    coreVersion: version,
    generatedAt: builtAt,
    modes: packed.map((p) => p.entry),
  };

  const stagedCatalogPath = join(options.outDir, MODE_CATALOG_FILE);
  const catalogText = JSON.stringify(catalog, null, 2) + "\n";
  writeFileSync(stagedCatalogPath, catalogText);

  const results: PublishedModeResult[] = packed.map((p) => ({
    entry: p.entry,
    key: p.key,
    archivePath: p.packed.archivePath,
    upload: "dry-run" as const,
  }));

  if (options.dryRun) {
    log(`[publish-modes] dry run — nothing uploaded. Archives and ${MODE_CATALOG_FILE} in ${options.outDir}`);
    return { catalog, modes: results, catalogPath: stagedCatalogPath };
  }

  const store = options.store!;
  const isVersionOnNpm = options.isVersionOnNpm ?? npmVersionExists;
  let sealed: boolean | null = null;
  const sealCheck = async (): Promise<boolean> => {
    if (sealed === null) sealed = await isVersionOnNpm(version);
    return sealed;
  };

  // Decide everything before writing anything: a refusal must not leave half a
  // release on the CDN.
  const plan: Array<{ key: string; action: "upload" | "skip"; archivePath: string; name: string }> = [];
  for (const { packed: p, key, entry } of packed) {
    const remote = await store.readSha256(key);
    if (remote === null) {
      plan.push({ key, action: "upload", archivePath: p.archivePath, name: entry.name });
      continue;
    }
    if (remote === p.sha256) {
      plan.push({ key, action: "skip", archivePath: p.archivePath, name: entry.name });
      continue;
    }
    if (await sealCheck()) {
      throw new PublishRefusedError(
        `${key} already holds different bytes and ${NPM_PACKAGE}@${version} is published on npm.\n` +
          `  remote sha256 ${remote}\n  local  sha256 ${p.sha256}\n` +
          `A published release is sealed — its users resolve these exact URLs. Bump the version and publish again.`,
      );
    }
    plan.push({ key, action: "upload", archivePath: p.archivePath, name: entry.name });
  }

  const remoteCatalog = (await store.readJson(catalogKey(version))) as ModeCatalog | null;
  if (remoteCatalog && !catalogsEquivalent(remoteCatalog, catalog) && (await sealCheck())) {
    throw new PublishRefusedError(
      `${catalogKey(version)} differs from the catalog this commit produces and ${NPM_PACKAGE}@${version} is ` +
        `published on npm. A published release is sealed — bump the version and publish again.`,
    );
  }

  for (const step of plan) {
    const result = results.find((r) => r.key === step.key)!;
    if (step.action === "skip") {
      result.upload = "skipped";
      log(`[publish-modes] ${step.name}: already at ${step.key} with the same bytes — skipped`);
      continue;
    }
    const url = await store.putFile(step.key, step.archivePath);
    result.upload = "uploaded";
    log(`[publish-modes] ${step.name}: uploaded ${url}`);
  }

  await store.putJson(catalogKey(version), catalog);
  log(`[publish-modes] uploaded ${store.publicUrl}/${catalogKey(version)}`);

  const catalogPath = options.catalogPath ?? join(modesDir, MODE_CATALOG_FILE);
  writeFileSync(catalogPath, catalogText);
  log(`[publish-modes] wrote ${catalogPath} — this is what the package ships`);

  return { catalog, modes: results, catalogPath };
}

// ── Real-world seams ─────────────────────────────────────────────────────────

/**
 * Whether the registry already serves this version. Failing loudly on an
 * unexpected status is deliberate: the answer only matters when an overwrite
 * is pending, and guessing "not published" there could rewrite a live release.
 */
export async function npmVersionExists(version: string): Promise<boolean> {
  const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/${version}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`npm registry check for ${NPM_PACKAGE}@${version} failed with ${res.status}`);
}

/**
 * R2 through the helpers in `snapshot/r2.ts`. Existence is answered by the
 * bucket; the bytes are read back through the public URL, because that is the
 * copy a user's install will actually download.
 */
export function createR2Store(creds: R2Credentials): ArchiveStore {
  const publicUrl = creds.publicUrl.replace(/\/$/, "");
  return {
    publicUrl,
    async readSha256(key) {
      if (!(await checkR2KeyExists(key, creds))) return null;
      const res = await fetch(`${publicUrl}/${key}`, { cache: "no-store" });
      if (!res.ok) return null;
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(await res.arrayBuffer());
      return hasher.digest("hex");
    },
    async readJson(key) {
      if (!(await checkR2KeyExists(key, creds))) return null;
      const res = await fetch(`${publicUrl}/${key}`, { cache: "no-store" });
      if (!res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    },
    putFile: (key, filePath) => uploadToR2(filePath, key, creds),
    putJson: (key, value) => uploadJsonToR2(value, key, creds),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface CliArgs {
  version?: string;
  dryRun: boolean;
  out?: string;
  only?: string[];
  baseUrl?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--version": args.version = next(); break;
      case "--dry-run": args.dryRun = true; break;
      case "--out": args.out = next(); break;
      case "--only": args.only = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--base-url": args.baseUrl = next(); break;
      case "--help":
      case "-h": args.version = undefined; return args;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `Usage: bun scripts/publish-modes.ts --version <X.Y.Z> [options]

  --version <X.Y.Z>   core release the archives belong to (required)
  --dry-run           build and pack, upload nothing
  --out <dir>         staging dir for archives + catalog.json
                      (default .publish/v<version>)
  --only <a,b>        restrict the run to these catalog modes
  --base-url <url>    CDN base for the pinned URLs (default the R2 public URL)

Uploads need ~/.pneuma/r2.json. A key belonging to a version already on npm
is never overwritten with different bytes.`;

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[publish-modes] ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (!args.version) {
    console.error(USAGE);
    return 2;
  }

  const outDir = args.out ?? join(PROJECT_ROOT, ".publish", `v${args.version}`);
  let store: ArchiveStore | undefined;
  if (!args.dryRun) {
    const creds = loadCredentials();
    if (!creds) {
      console.error(
        "[publish-modes] no R2 credentials at ~/.pneuma/r2.json — run a snapshot publish once to create them, or use --dry-run",
      );
      return 2;
    }
    store = createR2Store(creds);
  }

  try {
    const result = await publishModes({
      version: args.version,
      dryRun: args.dryRun,
      outDir,
      only: args.only,
      baseUrl: args.baseUrl,
      store,
    });
    const total = result.modes.reduce((sum, m) => sum + m.entry.archive.size, 0);
    console.log(
      `[publish-modes] ${result.modes.length} catalog modes, ${formatBytes(total)} of archives, ` +
        `catalog at ${result.catalogPath}`,
    );
    return 0;
  } catch (error) {
    console.error(`[publish-modes] ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
