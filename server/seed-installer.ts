/**
 * Seed installer — copies a single seed entry from a mode package into
 * the workspace.
 *
 * Before 3.14.0 this logic lived inline in `bin/pneuma.ts` and ran
 * automatically on empty workspaces (one entry per `init.seedFiles`
 * pair). Auto-copy is removed; the empty-state gallery now invokes
 * this helper per user click, scoped to one `seedFiles` entry at a
 * time.
 *
 * Locale resolution, template substitution, and directory-vs-file
 * branching are preserved verbatim — only the "loop over all entries"
 * framing changed. Binary detection now lives in `isBinarySeedFile`,
 * the single authority shared with the `_`-prefixed re-sync loop in
 * `bin/pneuma.ts`.
 */

import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { applyTemplateParams } from "./skill-installer.js";
import { isContained } from "./utils.js";
import type { SeedDescriptor } from "../core/types/mode-manifest.js";

/**
 * Known-binary extensions — a fast path that avoids touching the disk.
 * Not an exhaustive list, and deliberately not the only test: an unknown
 * extension falls through to the content sniff below.
 */
const BINARY_EXT_RE =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|flac|webm|mov|glb|blend|bin|wasm|zip|gz|tar|7z|pdf)$/i;

/** How much of an unknown-extension file we read before deciding. */
const SNIFF_BYTES = 8192;

/**
 * Is this seed file binary — i.e. must it be copied byte-for-byte instead
 * of being read as UTF-8, template-substituted, and written back?
 *
 * Two tests, in order:
 *  1. `BINARY_EXT_RE` — a cheap allowlist of extensions we already know.
 *  2. A content sniff: the first {@link SNIFF_BYTES} bytes contain a NUL.
 *     Text never contains NUL; every binary container we ship (glTF, PNG,
 *     zip, .blend, wasm, …) has one inside its header. This is the safety
 *     net that makes "unknown extension" default to *preserve the bytes*
 *     rather than to "mangle them into U+FFFD" — the previous behavior,
 *     which silently corrupted `backlot`'s `scene.glb`.
 *
 * `path` should point at an existing, readable file; the sniff is skipped
 * when it cannot be opened (the caller's own read/copy reports that
 * failure), leaving the extension verdict.
 */
export function isBinarySeedFile(path: string): boolean {
  if (BINARY_EXT_RE.test(path)) return true;
  return hasNulByte(path);
}

function hasNulByte(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.allocUnsafe(SNIFF_BYTES);
    const read = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, read).includes(0);
  } catch {
    // Unreadable or missing: nothing to sniff. The copy that follows
    // surfaces the real error.
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface SeedCopyOptions {
  /** Workspace root (destination prefix). */
  workspace: string;
  /** Mode-package root for external modes, project root for builtins (source prefix). */
  seedBase: string;
  /** Source path from a `seedFiles` key — may contain `{{_locale}}` and `{{param}}` tokens. */
  src: string;
  /** Destination path from a `seedFiles` value, relative to workspace. */
  dst: string;
  /** Resolved template params (including any derived params). */
  params: Record<string, string | number>;
  /** User's locale for `{{_locale}}` resolution. Falls back to "en" when the localized variant is absent. */
  locale: string;
}

export interface SeedCopyResult {
  /** Workspace-relative paths actually written, in copy order. */
  files: string[];
  /** True iff a root-level `package.json` was among the written files. */
  seededRootPackageJson: boolean;
}

function resolveLocaleSrc(src: string, seedBase: string, locale: string): string | null {
  if (!src.includes("{{_locale}}")) return src;
  const candidate = src.replaceAll("{{_locale}}", locale);
  if (existsSync(join(seedBase, candidate))) return candidate;
  const fallback = src.replaceAll("{{_locale}}", "en");
  if (existsSync(join(seedBase, fallback))) return fallback;
  return null;
}

/**
 * A seed copy that would read from outside the seed base or write outside
 * the workspace — `..` in a destination, or a destination (or source) that
 * is or passes through a symlink whose target is outside. Thrown before the
 * first write: a refused seed writes none of its files.
 */
export class SeedContainmentError extends Error {
  constructor(readonly path: string, readonly side: "source" | "destination") {
    super(`seed ${side} escapes its root: ${path}`);
    this.name = "SeedContainmentError";
  }
}

/** One seed entry resolved into file copies, every one of them checked. */
export interface SeedCopyPlan {
  workspace: string;
  params: Record<string, string | number>;
  steps: { src: string; dst: string; dstRel: string }[];
}

/**
 * Resolve a single seed entry into the copies it would make, without writing.
 * Returns `null` when the source path can't be resolved (missing locale
 * variant + no `en` fallback, or the resolved file doesn't exist on disk).
 *
 * Every source must stay inside `seedBase` and every destination inside
 * `workspace` (see `isContained`); a violation throws
 * {@link SeedContainmentError}. Callers applying several entries plan all of
 * them before applying any.
 */
export function planSeedEntry(opts: SeedCopyOptions): SeedCopyPlan | null {
  const localeResolved = resolveLocaleSrc(opts.src, opts.seedBase, opts.locale);
  if (localeResolved === null) return null;

  const hasParams = Object.keys(opts.params).length > 0;
  const resolvedSrc = hasParams ? applyTemplateParams(localeResolved, opts.params) : localeResolved;
  const srcPath = join(opts.seedBase, resolvedSrc);
  if (!existsSync(srcPath)) return null;
  if (!isContained(srcPath, opts.seedBase)) throw new SeedContainmentError(resolvedSrc, "source");

  const steps: SeedCopyPlan["steps"] = [];
  if (resolvedSrc.endsWith("/") && statSync(srcPath).isDirectory()) {
    const glob = new Bun.Glob("**/*");
    for (const relFile of glob.scanSync({ cwd: srcPath, absolute: false })) {
      const fileSrc = join(srcPath, relFile);
      if (statSync(fileSrc).isDirectory()) continue;
      const dstRel = join(opts.dst, relFile);
      steps.push({ src: fileSrc, dst: join(opts.workspace, dstRel), dstRel });
    }
  } else {
    steps.push({ src: srcPath, dst: join(opts.workspace, opts.dst), dstRel: opts.dst });
  }
  for (const step of steps) {
    if (!isContained(step.src, opts.seedBase)) throw new SeedContainmentError(step.src, "source");
    if (!isContained(step.dst, opts.workspace)) throw new SeedContainmentError(step.dstRel, "destination");
  }
  return { workspace: opts.workspace, params: opts.params, steps };
}

/** Perform a plan from {@link planSeedEntry}. */
export function applySeedPlan(plan: SeedCopyPlan): SeedCopyResult {
  const hasParams = Object.keys(plan.params).length > 0;
  const files: string[] = [];
  let seededRootPackageJson = false;
  for (const step of plan.steps) {
    mkdirSync(dirname(step.dst), { recursive: true });
    const isBinary = isBinarySeedFile(step.src);
    if (hasParams && !isBinary) {
      const content = applyTemplateParams(readFileSync(step.src, "utf-8"), plan.params);
      writeFileSync(step.dst, content, "utf-8");
    } else {
      copyFileSync(step.src, step.dst);
    }
    files.push(step.dstRel);
    if (step.dstRel === "package.json") seededRootPackageJson = true;
  }
  return { files, seededRootPackageJson };
}

/**
 * Copy a single seed entry into the workspace: {@link planSeedEntry}, then
 * {@link applySeedPlan}. A refused entry writes none of its files.
 */
export function copySeedEntry(opts: SeedCopyOptions): SeedCopyResult | null {
  const plan = planSeedEntry(opts);
  return plan ? applySeedPlan(plan) : null;
}

/**
 * Resolve the user-facing seed catalog for a mode. When the manifest
 * declares `init.seeds` explicitly, those are returned (filtered to
 * descriptors whose `sourceKey` is present in `seedFiles`). When
 * `init.seeds` is absent, derive one descriptor per `seedFiles` entry
 * — skipping `_`-prefixed destinations, which are framework-managed
 * design-system bundles, not user content.
 */
export function resolveSeedCatalog(
  seedFiles: Record<string, string> | undefined,
  declared: SeedDescriptor[] | undefined,
): SeedDescriptor[] {
  if (!seedFiles) return [];

  if (declared && declared.length > 0) {
    return declared.filter((d) => {
      const keys = Array.isArray(d.sourceKey) ? d.sourceKey : [d.sourceKey];
      return keys.length > 0 && keys.every((k) => k in seedFiles);
    });
  }

  return Object.entries(seedFiles)
    .filter(([src, dst]) => {
      if (dst.startsWith("_")) return false;
      // Auto-derive only from directory-shaped seeds. The convention is
      // that a user-pickable template is a self-contained directory
      // (e.g. `slide/seed/en-dark/`, `webcraft/seed/pneuma/`). Single-
      // file entries like `seed/profile.json` are almost always
      // framework setup that the mode copies in alongside a real
      // template — surfacing them as gallery cards offers the user a
      // meaningless pick. Modes that genuinely want a single-file
      // template as a gallery card must declare it explicitly via
      // `init.seeds`.
      return src.endsWith("/") || dst.endsWith("/") || dst === "./" || dst === "";
    })
    .map(([src, dst]) => {
      // Picking a human-ish name for an undeclared seed:
      // 1. Try the destination, minus a trailing slash and a leading "./"
      //    (single-workspace seeds frequently dst="./").
      // 2. If the dst boils down to nothing (".") or to "" — fall back
      //    to the last meaningful segment of the source path.
      const dstTrim = dst.replace(/\/$/, "").replace(/^\.\//, "");
      const srcBase = basename(src.replace(/\/$/, ""));
      const segment = dstTrim && dstTrim !== "." ? dstTrim : srcBase || src;
      const slug = segment.replace(/[^\w.-]/g, "-") || src.replace(/[^\w.-]/g, "-");
      return {
        id: slug,
        sourceKey: src,
        displayName: humanizePathSegment(segment),
      };
    });
}

function humanizePathSegment(seg: string): string {
  const cleaned = seg
    .replace(/[/.]/g, " ")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return cleaned || seg;
}

/**
 * Run `bun install` in the workspace iff a root-level `package.json`
 * exists. The gallery seed-apply endpoint calls this after any copy
 * that introduced or replaced `package.json`.
 */
export async function runPostSeedInstall(workspace: string): Promise<void> {
  if (!existsSync(join(workspace, "package.json"))) return;
  const proc = Bun.spawn(["bun", "install"], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}
