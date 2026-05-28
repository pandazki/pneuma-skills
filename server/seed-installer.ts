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
 * Locale resolution, template substitution, binary detection, and
 * directory-vs-file branching are preserved verbatim — only the
 * "loop over all entries" framing changed.
 */

import { existsSync, statSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { applyTemplateParams } from "./skill-installer.js";
import type { SeedDescriptor } from "../core/types/mode-manifest.js";

const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp[34]|wav|ogg|zip|gz|tar|pdf)$/i;

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
 * Copy a single seed entry into the workspace. Returns `null` when the
 * source path can't be resolved (missing locale variant + no `en`
 * fallback, or the resolved file doesn't exist on disk).
 */
export function copySeedEntry(opts: SeedCopyOptions): SeedCopyResult | null {
  const localeResolved = resolveLocaleSrc(opts.src, opts.seedBase, opts.locale);
  if (localeResolved === null) return null;

  const hasParams = Object.keys(opts.params).length > 0;
  const resolvedSrc = hasParams ? applyTemplateParams(localeResolved, opts.params) : localeResolved;
  const srcPath = join(opts.seedBase, resolvedSrc);
  if (!existsSync(srcPath)) return null;

  const files: string[] = [];
  let seededRootPackageJson = false;

  if (resolvedSrc.endsWith("/") && statSync(srcPath).isDirectory()) {
    const glob = new Bun.Glob("**/*");
    for (const relFile of glob.scanSync({ cwd: srcPath, absolute: false })) {
      const fileSrc = join(srcPath, relFile);
      if (statSync(fileSrc).isDirectory()) continue;
      const dstRel = join(opts.dst, relFile);
      const fileDst = join(opts.workspace, dstRel);
      mkdirSync(dirname(fileDst), { recursive: true });
      const isBinary = BINARY_EXT_RE.test(relFile);
      if (hasParams && !isBinary) {
        const content = applyTemplateParams(readFileSync(fileSrc, "utf-8"), opts.params);
        writeFileSync(fileDst, content, "utf-8");
      } else {
        copyFileSync(fileSrc, fileDst);
      }
      files.push(dstRel);
      if (dstRel === "package.json") seededRootPackageJson = true;
    }
  } else {
    const dstPath = join(opts.workspace, opts.dst);
    mkdirSync(dirname(dstPath), { recursive: true });
    const isBinary = BINARY_EXT_RE.test(resolvedSrc);
    if (hasParams && !isBinary) {
      const content = applyTemplateParams(readFileSync(srcPath, "utf-8"), opts.params);
      writeFileSync(dstPath, content, "utf-8");
    } else {
      copyFileSync(srcPath, dstPath);
    }
    files.push(opts.dst);
    if (opts.dst === "package.json") seededRootPackageJson = true;
  }

  return { files, seededRootPackageJson };
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
