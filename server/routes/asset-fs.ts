/**
 * Asset filesystem listing route.
 *
 * Registered for clipcraft-style modes. Returns a flat listing of
 * media files under `<workspace>/assets/**` with size + mtime. Pure
 * filesystem scan — no project.json parsing, no reconciliation. The
 * client does the diff against its in-memory asset registry.
 *
 * Includes: GET /api/assets/fs-listing.
 */

import type { Hono } from "hono";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

export interface AssetFsOptions {
  workspace: string;
}

const MEDIA_EXTS = new Set([
  // video
  ".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi", ".mpeg", ".mpg",
  // image
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  ".avif", ".heic", ".heif", ".tif", ".tiff",
  // audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".opus",
  ".aif", ".aiff",
]);

interface AbsEntry {
  abs: string;
  size: number;
  mtime: number;
}

interface FsEntry {
  uri: string;
  size: number;
  mtime: number;
}

/** Recursive directory walk. Skips symlinks entirely — `lstatSync`
 *  reports the link node itself, not the target, so any symlink
 *  (file or dir) is ignored before we'd recurse into it. Prevents
 *  both cross-workspace path leaks and cyclic-symlink infinite
 *  recursion. Non-media files and dotfiles are filtered out. */
function walk(root: string, out: AbsEntry[]) {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue; // skip dotfiles / dotdirs
    const abs = join(root, name);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) continue;
      out.push({ abs, size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
  }
}

export function registerAssetFsRoutes(app: Hono, options: AssetFsOptions) {
  const { workspace } = options;

  app.get("/api/assets/fs-listing", (c) => {
    const assetsDir = join(workspace, "assets");
    if (!existsSync(assetsDir)) {
      return c.json({ entries: [] });
    }
    const absEntries: AbsEntry[] = [];
    walk(assetsDir, absEntries);
    const entries: FsEntry[] = absEntries.map((e) => ({
      uri: relative(workspace, e.abs).split(sep).join("/"),
      size: e.size,
      mtime: e.mtime,
    }));
    entries.sort((a, b) => a.uri.localeCompare(b.uri));
    return c.json({ entries });
  });
}
