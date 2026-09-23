/**
 * Mode Catalog — the runtime side of the bundled/catalog split.
 *
 * `modes/distribution.json` says which modes ship inside the package.
 * Everything else is a *catalog* mode: the package keeps only its
 * `showcase/` images plus one entry in the generated `modes/catalog.json`,
 * and the mode itself is downloaded from the CDN the first time it is used.
 *
 * Two shapes have to behave identically, which is the whole point of this
 * module:
 *
 * - **repo checkout** — `modes/<name>/` is on disk and `modes/catalog.json`
 *   is absent. Every mode runs from source, offline, in dev and in a
 *   production build. Catalog membership then comes from
 *   `distribution.json` alone (a mode directory that is not bundled).
 * - **released package** — `modes/catalog.json` is present and a catalog
 *   mode has no source in the package. It is installed under
 *   `~/.pneuma/catalog/<name>/` and run from there.
 *
 * Install state is decided by comparing the install record's `sha256` with
 * the archive the *current* catalog pins, never by timestamps or version
 * strings: a prebuilt viewer bundle is only valid on the core release that
 * built it (see `core/types/mode-catalog.ts`), so an upgrade must re-fetch.
 *
 * On-disk layout of an install root:
 *
 *     ~/.pneuma/catalog/<name>/
 *       .pneuma-install.json        ← ModeInstallRecord, written LAST
 *       modes/<name>/               ← the mode directory (manifest, skill, seed, .build)
 *
 * The `modes/<name>/` nesting is not decoration: first-party manifests
 * address their seeds package-relative (`"modes/sprite/seed/lumi/"`), so the
 * install root has to stand in for the package root or every seed copy
 * breaks. `resolveCatalogMode()` returns both paths (`modeDir`, `seedBase`)
 * so callers never have to know the rule. An archive that unpacks flat is
 * reshaped into that layout at install time.
 *
 * An archive is untrusted input, including one served from our own CDN: the
 * SHA-256 pin proves the bytes are the ones the catalog names, not that a
 * publisher built them from this repository. So the member names are checked
 * before `tar` is allowed to act on them, the extracted tree is checked
 * before any code follows a path inside it, and the completion record is
 * created — never overwritten — by the installer.
 *
 * Design: docs/proposals/2026-09-22-mode-distribution.md (D2, D4–D6, D8)
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  MODE_CATALOG_FILE,
  MODE_CATALOG_FORMAT,
  MODE_INSTALL_RECORD,
  MODE_PACKAGE_STAMP,
  type ModeCatalog,
  type ModeCatalogEntry,
  type ModeInstallRecord,
  type ModeInstallState,
  type ModePackageStamp,
} from "./types/mode-catalog.js";

/**
 * Filesystem context. Both fields exist so tests can run against a fixture
 * package and a throwaway home without touching the developer's real one.
 * `home` is read from the environment rather than `os.homedir()` because Bun
 * caches `homedir()` at boot (see `.claude/rules/server.md`).
 */
export interface CatalogEnv {
  /** Package root — the directory containing `modes/`. */
  projectRoot?: string;
  /** Home directory owning `~/.pneuma/`. */
  home?: string;
}

/** Where a catalog mode's source was found. */
export type CatalogModeSource = "in-tree" | "installed";

export interface ResolvedCatalogMode {
  name: string;
  /** Absolute path to the mode directory (manifest.ts, skill/, seed/, .build/). */
  modeDir: string;
  /**
   * Root for resolving `init.seedFiles` keys. Package root for the
   * `modes/<name>` layout, the mode directory itself for a flat one —
   * the same distinction `bin/pneuma.ts` already draws between builtin and
   * external modes.
   */
  seedBase: string;
  source: CatalogModeSource;
}

/** Why an install could not complete. Each code names a different fix. */
export type ModeInstallErrorCode =
  /** The name is not in the packaged catalog (or there is no catalog). */
  | "unknown-mode"
  /** The request never produced a response (offline, DNS, TLS). */
  | "network"
  /** The CDN answered with a non-2xx status (404 = archive missing for this core). */
  | "http"
  /** The caller's `AbortSignal` fired. */
  | "aborted"
  /** Declared size and received bytes disagree — truncated or republished archive. */
  | "size-mismatch"
  /** The bytes arrived intact but are not the archive the catalog pins. */
  | "checksum-mismatch"
  /** `tar` refused the archive. */
  | "extract-failed"
  /**
   * The archive carries something a mode package never contains and that
   * would reach past the install root — a name that is absolute or walks up
   * with `..`, a symlink, a hard link, a device node, the installer's own
   * completion record — or an entry the installer cannot inspect. Distinct
   * from `invalid-archive`: the package is not merely wrong for this core,
   * it is not a file tree we will unpack at all.
   */
  | "unsafe-archive"
  /** Extracted, but not a mode package this core can run. */
  | "invalid-archive"
  /**
   * A valid mode package built by a different core release. Its own code
   * because the lockstep is the reason this distribution exists: the archive
   * is intact and well-formed, it just cannot run on this host's ABI.
   */
  | "core-version-mismatch"
  /**
   * Everything verified, but the completion record could not be created.
   * Nothing is marked installed, so the next launch downloads again.
   */
  | "record-write-failed";

export class ModeInstallError extends Error {
  readonly code: ModeInstallErrorCode;
  readonly mode: string;
  readonly url?: string;

  constructor(
    code: ModeInstallErrorCode,
    mode: string,
    message: string,
    url?: string,
  ) {
    super(message);
    this.name = "ModeInstallError";
    this.code = code;
    this.mode = mode;
    if (url) this.url = url;
  }
}

export interface InstallProgress {
  /** Bytes downloaded so far. */
  received: number;
  /** Total bytes, from the catalog entry (not from the response headers). */
  total: number;
}

export interface InstallOptions extends CatalogEnv {
  onProgress?: (p: InstallProgress) => void;
  signal?: AbortSignal;
}

// ── Package-level facts ──────────────────────────────────────────────────────

/** `core/` lives directly under the package root. */
const DEFAULT_PROJECT_ROOT = resolve(import.meta.dir, "..");

function projectRootOf(env?: CatalogEnv): string {
  return env?.projectRoot ?? DEFAULT_PROJECT_ROOT;
}

function homeOf(env?: CatalogEnv): string {
  return (
    env?.home ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  );
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * The bundled set, straight from `modes/distribution.json`. Includes
 * `_shared`, which is a shared asset directory rather than a mode — callers
 * that want mode names filter it out (the builtin registry does).
 */
export function bundledModeNames(env?: CatalogEnv): string[] {
  const data = readJson<{ bundled?: string[] }>(
    join(projectRootOf(env), "modes", "distribution.json"),
  );
  return Array.isArray(data?.bundled) ? data!.bundled! : [];
}

export function isBundledMode(name: string, env?: CatalogEnv): boolean {
  return bundledModeNames(env).includes(name);
}

/** The packaged catalog, or `null` in a repo checkout where it is not generated. */
export function readModeCatalog(env?: CatalogEnv): ModeCatalog | null {
  const catalog = readJson<ModeCatalog>(
    join(projectRootOf(env), "modes", MODE_CATALOG_FILE),
  );
  if (!catalog || !Array.isArray(catalog.modes)) return null;
  return catalog;
}

export function getCatalogEntry(
  name: string,
  env?: CatalogEnv,
): ModeCatalogEntry | undefined {
  return readModeCatalog(env)?.modes.find((m) => m.name === name);
}

/** Absolute path to `modes/<name>/` when the package carries its source. */
export function inTreeModeDir(name: string, env?: CatalogEnv): string | null {
  if (!isSafeModeName(name)) return null;
  const dir = join(projectRootOf(env), "modes", name);
  return hasManifest(dir) ? dir : null;
}

/**
 * Every catalog mode this core knows about: the packaged catalog's entries
 * in launcher order, plus — in a repo checkout — every non-bundled mode
 * directory on disk. The union is what makes the repo and the release agree
 * about which names are catalog modes.
 */
export function listCatalogModeNames(env?: CatalogEnv): string[] {
  const names = (readModeCatalog(env)?.modes ?? []).map((m) => m.name);
  const seen = new Set(names);
  const bundled = new Set(bundledModeNames(env));
  // Sorted so a repo checkout produces a stable list; a release keeps the
  // catalog's own order, which is the launcher's.
  for (const name of inTreeModeNames(env).sort()) {
    if (bundled.has(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Every catalog entry this release publishes, each with its local install
 * state — one call for the launcher registry and the catalog route, so the
 * two never disagree about what is installed.
 *
 * Empty in a repo checkout, where `modes/catalog.json` is not generated:
 * there the modes are in the tree and the registry lists them itself. Never
 * throws — a missing or unreadable catalog is "no catalog", not an error
 * that could blank out the launcher.
 */
export function listCatalogModes(
  env?: CatalogEnv,
): Array<ModeCatalogEntry & { state: ModeInstallState; inTree: boolean }> {
  try {
    const catalog = readModeCatalog(env);
    if (!catalog) return [];
    return catalog.modes.map((entry) => ({
      ...entry,
      state: installState(entry.name, env),
      inTree: inTreeModeDir(entry.name, env) !== null,
    }));
  } catch {
    return [];
  }
}

export function isCatalogMode(name: string, env?: CatalogEnv): boolean {
  if (!isSafeModeName(name) || isBundledMode(name, env)) return false;
  if (getCatalogEntry(name, env)) return true;
  return inTreeModeDir(name, env) !== null;
}

// ── Install locations and state ──────────────────────────────────────────────

/** `~/.pneuma/catalog/` — catalog installs only, never user modes. */
export function catalogRoot(env?: CatalogEnv): string {
  return join(homeOf(env), ".pneuma", "catalog");
}

/** `~/.pneuma/catalog/<name>/` — the install root, i.e. a package-root stand-in. */
export function catalogInstallRoot(name: string, env?: CatalogEnv): string {
  return join(catalogRoot(env), name);
}

/**
 * The record written last by a successful install. Its absence means the
 * directory is incomplete, whatever else is in there.
 */
export function readInstallRecord(
  name: string,
  env?: CatalogEnv,
): ModeInstallRecord | null {
  const record = readJson<ModeInstallRecord>(
    join(catalogInstallRoot(name, env), MODE_INSTALL_RECORD),
  );
  if (!record || typeof record.sha256 !== "string") return null;
  return record;
}

/**
 * Compare what is installed with what this core's catalog pins.
 *
 * - no record (or no mode directory behind it) → `not-installed`
 * - record's sha equals the catalog's → `installed`
 * - anything else → `stale` (built by another core release)
 *
 * A mode whose source is in the package (repo checkout) reports
 * `installed`: it needs no download. Callers that must know the difference
 * read {@link resolveCatalogMode}'s `source`.
 */
export function installState(name: string, env?: CatalogEnv): ModeInstallState {
  if (inTreeModeDir(name, env)) return "installed";
  const record = readInstallRecord(name, env);
  if (!record) return "not-installed";
  if (!installedModeDir(name, env)) return "not-installed";
  const entry = getCatalogEntry(name, env);
  // Without a catalog there is nothing to compare against; a complete
  // install is the best truth available.
  if (!entry) return "installed";
  return record.sha256 === entry.archive.sha256 ? "installed" : "stale";
}

/** The mode directory inside a *complete* install, or null. */
function installedModeDir(name: string, env?: CatalogEnv): string | null {
  const root = catalogInstallRoot(name, env);
  if (!existsSync(join(root, MODE_INSTALL_RECORD))) return null;
  const nested = join(root, "modes", name);
  if (hasManifest(nested)) return nested;
  return hasManifest(root) ? root : null;
}

/**
 * Locate a catalog mode's source without touching the network. In-tree wins
 * over an install, so a repo checkout never runs a downloaded copy of a mode
 * it has the source for.
 */
export function resolveCatalogMode(
  name: string,
  env?: CatalogEnv,
): ResolvedCatalogMode | null {
  const inTree = inTreeModeDir(name, env);
  if (inTree) {
    return {
      name,
      modeDir: inTree,
      seedBase: projectRootOf(env),
      source: "in-tree",
    };
  }
  const installed = installedModeDir(name, env);
  if (!installed) return null;
  return {
    name,
    modeDir: installed,
    // The install root plays the package root: in the normalized layout it
    // holds `modes/<name>/…` so package-relative seed keys resolve, and in a
    // flat install it *is* the mode directory, which is what a mode-relative
    // manifest expects. One value serves both.
    seedBase: catalogInstallRoot(name, env),
    source: "installed",
  };
}

// ── Install ──────────────────────────────────────────────────────────────────

/**
 * Make a catalog mode runnable, downloading it only when it has to.
 *
 * In-tree → returned as-is, offline. Installed and matching the catalog →
 * returned as-is. Otherwise the current directory (stale, or incomplete
 * because a previous install was interrupted before its record) is removed
 * and the archive is fetched again.
 */
export async function ensureCatalogMode(
  name: string,
  opts: InstallOptions = {},
): Promise<ResolvedCatalogMode> {
  const inTree = inTreeModeDir(name, opts);
  if (inTree) {
    return { name, modeDir: inTree, seedBase: projectRootOf(opts), source: "in-tree" };
  }

  if (installState(name, opts) === "installed") {
    const resolved = resolveCatalogMode(name, opts);
    if (resolved) return resolved;
  }

  await installCatalogMode(name, opts);

  const resolved = resolveCatalogMode(name, opts);
  if (!resolved) {
    // Defensive: installCatalogMode validates the extracted tree before it
    // renames, so reaching here means the install root vanished under us.
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `Installed "${name}" but its mode directory is missing under ${catalogInstallRoot(name, opts)}`,
    );
  }
  return resolved;
}

/**
 * Download → verify size and SHA-256 → screen the archive → extract →
 * screen the tree → atomic rename → record.
 *
 * Nothing partial survives a failure: the temp archive and the staging
 * directory are removed in every exit path, and the install record — the
 * only thing that marks a directory complete — is written last. An install
 * interrupted between the rename and the record is therefore re-fetched
 * rather than run.
 *
 * The two screening steps bracket `tar`, and both are needed. The names are
 * screened first because the only way to be sure a member cannot land
 * outside the staging directory is to refuse it before `tar` sees it — GNU
 * tar and bsdtar disagree about whether such a member is an error or a
 * silent rewrite, and neither behaviour is a contract this installer should
 * inherit. The tree is screened afterwards because a name says nothing
 * about a member's *type*: a symlink with a perfectly ordinary name is
 * still a path into somewhere else, and every step after extraction
 * (`hasManifest`, the layout rename, the stamp read, the record write, and
 * later the seed copier) resolves paths through whatever it finds.
 */
export async function installCatalogMode(
  name: string,
  opts: InstallOptions = {},
): Promise<ModeInstallRecord> {
  const catalog = readModeCatalog(opts);
  const entry = catalog?.modes.find((m) => m.name === name);
  if (!catalog || !entry) {
    throw new ModeInstallError(
      "unknown-mode",
      name,
      catalog
        ? `Mode "${name}" is not in this release's catalog (${catalog.modes.length} modes, core ${catalog.coreVersion}).`
        : `No mode catalog in this installation — "${name}" cannot be downloaded. A repo checkout runs modes from modes/<name>/ instead.`,
    );
  }

  const root = catalogRoot(opts);
  const staging = join(root, `.tmp-${name}-${randomToken()}`);
  const archivePath = `${staging}.tar.gz`;
  mkdirSync(root, { recursive: true });

  try {
    await downloadArchive(name, entry, archivePath, opts);

    await verifyArchiveMembers(name, archivePath, entry.archive.url);

    mkdirSync(staging, { recursive: true });
    await extractArchive(name, archivePath, staging, entry.archive.url);
    verifyExtractedTree(name, staging, entry.archive.url);

    const modeDir = normalizeInstallLayout(name, staging);
    verifyStamp(name, entry, catalog, modeDir, staging);

    const finalRoot = catalogInstallRoot(name, opts);
    rmSync(finalRoot, { recursive: true, force: true });
    renameSync(staging, finalRoot);

    const record: ModeInstallRecord = {
      name,
      version: entry.version,
      coreVersion: catalog.coreVersion,
      sha256: entry.archive.sha256,
      installedAt: new Date().toISOString(),
    };
    // Last write: everything above is invisible to `installState` until
    // this file lands. `wx` is part of that guarantee — the record is
    // *created*, so the write refuses to follow anything already sitting at
    // that path instead of silently writing through it.
    const recordPath = join(finalRoot, MODE_INSTALL_RECORD);
    try {
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf-8",
        flag: "wx",
      });
    } catch (err) {
      // Without its record the tree is not installed, so leave none: a
      // half-verified directory that a later change might learn to trust is
      // worse than another download.
      rmSync(finalRoot, { recursive: true, force: true });
      throw new ModeInstallError(
        "record-write-failed",
        name,
        `Installed "${name}" but could not create ${recordPath}: ${errText(err)}. ` +
          `The directory was removed; nothing is marked installed.`,
        entry.archive.url,
      );
    }
    return record;
  } finally {
    // Best-effort, and deliberately so: this runs on the failure path too,
    // where the tree being removed may be the hostile one that caused the
    // failure (an unreadable directory with children makes `rmSync` throw
    // even with `force`). A throw here would replace the real
    // `ModeInstallError` with a filesystem error about the cleanup, hiding
    // what actually went wrong. What is left behind is a `.tmp-*` sibling
    // inside the catalog root, which no reader ever treats as an install:
    // only `.pneuma-install.json` marks one complete.
    discard(archivePath);
    discard(staging);
  }
}

/** Remove a temp path, never letting the removal become the reported failure. */
function discard(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* see the caller: cleanup must not mask the error it runs after */
  }
}

async function downloadArchive(
  name: string,
  entry: ModeCatalogEntry,
  archivePath: string,
  opts: InstallOptions,
): Promise<void> {
  const { url, size, sha256 } = entry.archive;

  let response: Response;
  try {
    response = await fetch(url, opts.signal ? { signal: opts.signal } : {});
  } catch (err) {
    if (isAbort(err, opts.signal)) {
      throw new ModeInstallError("aborted", name, `Download of "${name}" was cancelled (${url}).`, url);
    }
    throw new ModeInstallError(
      "network",
      name,
      `Could not reach ${url} to download "${name}": ${errText(err)}`,
      url,
    );
  }

  if (!response.ok) {
    throw new ModeInstallError(
      "http",
      name,
      `${url} returned HTTP ${response.status} ${response.statusText}. ` +
        `This release's catalog pins ${name}@${entry.version}; the archive is missing or unreadable at that URL.`,
      url,
    );
  }

  // Cheapest possible mismatch check: refuse before streaming a body whose
  // declared length already disagrees with the catalog.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 0 && declared !== size) {
    throw new ModeInstallError(
      "size-mismatch",
      name,
      `${url} is ${declared} bytes but the catalog pins ${size} for ${name}@${entry.version}. ` +
        `The archive was replaced or truncated; nothing was installed.`,
      url,
    );
  }

  const hasher = new Bun.CryptoHasher("sha256");
  const writer = Bun.file(archivePath).writer();
  let received = 0;
  try {
    const body = response.body;
    if (!body) {
      throw new ModeInstallError("network", name, `${url} returned an empty body.`, url);
    }
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      hasher.update(chunk);
      received += chunk.byteLength;
      writer.write(chunk);
      opts.onProgress?.({ received, total: size });
    }
    await writer.end();
  } catch (err) {
    try {
      writer.end();
    } catch {
      /* writer already failed */
    }
    if (err instanceof ModeInstallError) throw err;
    if (isAbort(err, opts.signal)) {
      throw new ModeInstallError(
        "aborted",
        name,
        `Download of "${name}" was cancelled after ${received} of ${size} bytes (${url}). Nothing was installed.`,
        url,
      );
    }
    throw new ModeInstallError(
      "network",
      name,
      `Download of "${name}" failed after ${received} of ${size} bytes (${url}): ${errText(err)}`,
      url,
    );
  }

  if (received !== size) {
    throw new ModeInstallError(
      "size-mismatch",
      name,
      `Downloaded ${received} bytes but the catalog pins ${size} for ${name}@${entry.version} (${url}). ` +
        `The download was truncated; nothing was installed.`,
      url,
    );
  }

  const digest = hasher.digest("hex");
  if (digest !== sha256) {
    throw new ModeInstallError(
      "checksum-mismatch",
      name,
      `SHA-256 of ${url} is ${digest}, expected ${sha256} for ${name}@${entry.version}. ` +
        `The archive does not match this core release; nothing was installed.`,
      url,
    );
  }
}

/**
 * Refuse an archive whose member names would put a file anywhere but under
 * the staging directory, before `tar` is asked to act on them.
 *
 * Listing costs one decompression pass over an archive we just spent a
 * download on, which is the price of not depending on `tar`'s own opinion
 * of a hostile name. A member name that is not valid UTF-8 or that contains
 * a newline splits into extra lines here; every line is checked, so the
 * split can only add rejections, never hide one.
 *
 * Names only, deliberately: this does not cap how much the archive expands.
 * The bytes are already pinned by size and SHA-256 against the catalog that
 * ships inside the package, so an oversized archive means a publisher who
 * can put bytes on the CDN and regenerate the catalog from them — and that
 * publisher can ship a malicious `manifest.ts`, which the host runs. A disk
 * quota would not narrow that boundary, only the pinned SHA does.
 */
async function verifyArchiveMembers(
  name: string,
  archivePath: string,
  url: string,
): Promise<void> {
  const proc = Bun.spawn(["tar", "tzf", archivePath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [listing, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new ModeInstallError(
      "extract-failed",
      name,
      `tar could not read the "${name}" archive (exit ${exitCode}): ${stderr.trim() || "no output"}. Source: ${url}`,
      url,
    );
  }

  for (const line of listing.split("\n")) {
    const member = line.trim();
    if (!member) continue;
    const reason = unsafeMemberReason(member);
    if (reason) {
      throw new ModeInstallError(
        "unsafe-archive",
        name,
        `The "${name}" archive contains ${JSON.stringify(member)}, which ${reason}. ` +
          `A mode package is a plain file tree under its own root; nothing was extracted. Source: ${url}`,
        url,
      );
    }
  }
}

/** Why this member name must never be unpacked, or null when it is ordinary. */
function unsafeMemberReason(member: string): string | null {
  if (member.startsWith("/") || /^[A-Za-z]:[\\/]/.test(member)) {
    return "is an absolute path";
  }
  // Both separators, because a Windows `tar` and a hand-built archive can
  // disagree about which one a member name uses.
  const parts = member.split(/[\\/]/);
  if (parts.includes("..")) return 'walks out of the archive root with ".."';
  if (parts.includes(MODE_INSTALL_RECORD)) {
    return `is named ${MODE_INSTALL_RECORD}, the record this installer writes to mark an install complete`;
  }
  return null;
}

/**
 * Refuse an extracted tree that is anything other than plain files and
 * directories.
 *
 * The publisher stages regular files only (`scripts/publish-modes.ts`
 * skips symlinks and sockets by design), so this rejects nothing a real
 * archive contains — and it is what keeps every later step honest. A
 * symlink survives into the install root, where the seed copier reads
 * through it; a hard link ties a file in the install root to a file the
 * archive does not own. Neither has a legitimate use here, so both are
 * refused by type rather than by target: a target check would have to
 * re-derive what "outside" means at every step that resolves a path.
 */
function verifyExtractedTree(name: string, staging: string, url: string): void {
  const unsafe = (member: string, reason: string): ModeInstallError =>
    new ModeInstallError(
      "unsafe-archive",
      name,
      `The "${name}" archive unpacked ${JSON.stringify(member)}, which ${reason}. ` +
        `A mode package is plain files and directories; nothing was installed. Source: ${url}`,
      url,
    );

  const walk = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      // A directory the archive made unreadable (mode 000, say). Nothing a
      // published mode contains, and refusing beats letting a raw errno out
      // of the installer where callers only know how to read a code.
      // Untested on purpose: the condition does not exist for a root user,
      // which is how CI containers run.
      throw unsafe(prefix || ".", `cannot be inspected (${errText(err)})`);
    }
    for (const entry of entries) {
      const absolute = join(dir, entry);
      const member = prefix ? `${prefix}/${entry}` : entry;
      // lstat, not stat: the question is what the entry *is*, not what it
      // points at.
      const stats = lstatSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute, member);
        continue;
      }
      if (stats.isSymbolicLink()) throw unsafe(member, "is a symbolic link");
      if (!stats.isFile()) throw unsafe(member, describeEntryKind(stats));
      if (stats.nlink > 1) throw unsafe(member, "is a hard link to another file");
      if (entry === MODE_INSTALL_RECORD) {
        throw unsafe(member, `is named ${MODE_INSTALL_RECORD}, which only this installer writes`);
      }
    }
  };

  walk(staging, "");
}

/** Reads as the tail of "…, which <reason>". */
function describeEntryKind(stats: Stats): string {
  if (stats.isBlockDevice()) return "is a block device";
  if (stats.isCharacterDevice()) return "is a character device";
  if (stats.isFIFO()) return "is a named pipe";
  if (stats.isSocket()) return "is a socket";
  return "is not a regular file";
}

async function extractArchive(
  name: string,
  archivePath: string,
  destDir: string,
  url: string,
): Promise<void> {
  const proc = Bun.spawn(["tar", "xzf", archivePath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drained concurrently with the exit, never after it: a tar that says
  // enough on stderr to fill the pipe blocks until someone reads it, and
  // waiting for exit first is that someone never arriving. The listing pass
  // above does the same.
  const [stderrText, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const stderr = stderrText.trim();
    throw new ModeInstallError(
      "extract-failed",
      name,
      `tar could not extract the "${name}" archive (exit ${exitCode}): ${stderr || "no output"}. Source: ${url}`,
      url,
    );
  }
}

/**
 * Put the extracted tree into the `<root>/modes/<name>/` layout regardless
 * of whether the archive carries that prefix, so seed keys resolve the same
 * way they do in the package. Returns the mode directory.
 */
function normalizeInstallLayout(name: string, staging: string): string {
  const nested = join(staging, "modes", name);
  if (hasManifest(nested)) return nested;

  if (hasManifest(staging)) {
    // Flat archive. Move it aside, rebuild the staging root around it, and
    // put it back under `modes/<name>` so the tree the caller renames into
    // place is always the same shape.
    const aside = `${staging}-flat`;
    rmSync(aside, { recursive: true, force: true });
    renameSync(staging, aside);
    try {
      mkdirSync(join(staging, "modes"), { recursive: true });
      renameSync(aside, join(staging, "modes", name));
    } finally {
      rmSync(aside, { recursive: true, force: true });
    }
    return join(staging, "modes", name);
  }

  throw new ModeInstallError(
    "invalid-archive",
    name,
    `The "${name}" archive contains no manifest.ts — expected either modes/${name}/manifest.ts or manifest.ts at its root.`,
  );
}

/**
 * The archive's self-declaration. It exists so a layout change is detected
 * instead of silently patched, so an unreadable or foreign stamp is a hard
 * failure rather than a warning.
 *
 * `coreVersion` is compared against the *catalog's*, not against a version
 * read from the running package, because the catalog is this core's pin:
 * it ships inside the package, is generated by the release that built every
 * archive it lists, and `scripts/verify-mode-catalog.ts` already refuses to
 * release a package whose catalog names another release. Catalog ↔ core
 * agreement is therefore settled before shipping; what is still open at
 * install time is whether the bytes behind the URL really are that
 * release's build, and the stamp is the only place the archive says so.
 * Reading a second version at runtime would add a source of truth without
 * adding an answer.
 */
function verifyStamp(
  name: string,
  entry: ModeCatalogEntry,
  catalog: ModeCatalog,
  modeDir: string,
  staging: string,
): void {
  const stampPath = [join(modeDir, MODE_PACKAGE_STAMP), join(staging, MODE_PACKAGE_STAMP)].find(
    (p) => existsSync(p),
  );
  if (!stampPath) {
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `The "${name}" archive has no ${MODE_PACKAGE_STAMP}; it was not produced by this distribution's publisher.`,
    );
  }
  const stamp = readJson<ModePackageStamp>(stampPath);
  if (!stamp) {
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `${MODE_PACKAGE_STAMP} in the "${name}" archive is not readable JSON.`,
    );
  }
  if (stamp.formatVersion !== MODE_CATALOG_FORMAT) {
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `The "${name}" archive declares package format ${stamp.formatVersion}; this core reads format ${MODE_CATALOG_FORMAT}.`,
    );
  }
  if (stamp.name !== name) {
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `The archive pinned for "${name}" contains mode "${stamp.name}".`,
    );
  }
  // Before the mode's own version: an archive from another release usually
  // differs in both, and "built by another core" is the explanation for the
  // mismatch, not a second symptom of it.
  if (stamp.coreVersion !== catalog.coreVersion) {
    throw new ModeInstallError(
      "core-version-mismatch",
      name,
      `The "${name}" archive was built by core ${stamp.coreVersion}, but this release's catalog pins ` +
        `archives built by core ${catalog.coreVersion}. A mode's viewer bundle depends on the host it was ` +
        `built against, so it would load and then fail in the browser; nothing was installed.`,
      entry.archive.url,
    );
  }
  if (stamp.version !== entry.version) {
    throw new ModeInstallError(
      "invalid-archive",
      name,
      `The "${name}" archive is version ${stamp.version}; the catalog pins ${entry.version}.`,
    );
  }
}

// ── Small shared helpers ─────────────────────────────────────────────────────

/** Human-readable install size for a card or a CLI line. */
export function formatInstallSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function hasManifest(dir: string): boolean {
  return existsSync(join(dir, "manifest.ts")) || existsSync(join(dir, "manifest.js"));
}

/** Mode names address directories — reject anything that could escape one. */
function isSafeModeName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== "..";
}

function inTreeModeNames(env?: CatalogEnv): string[] {
  const modesDir = join(projectRootOf(env), "modes");
  try {
    return readdirSync(modesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && hasManifest(join(modesDir, e.name)))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function randomToken(): string {
  return `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.message}${causeText}`;
  }
  return String(err);
}
