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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";

export interface AssetFsOptions {
  workspace: string;
}

const MEDIA_EXTS = new Set([
  // video
  ".mp4", ".mov", ".webm", ".mkv", ".m4v",
  // image
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  // audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".opus",
]);

interface FsEntry {
  uri: string;
  size: number;
  mtime: number;
}

function walk(root: string, out: FsEntry[]) {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue; // skip dotfiles / dotdirs
    const abs = join(root, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) continue;
      out.push({ abs, size: st.size, mtime: Math.floor(st.mtimeMs) } as unknown as FsEntry);
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
    const absEntries: Array<{ abs: string; size: number; mtime: number }> = [];
    walk(assetsDir, absEntries as unknown as FsEntry[]);
    const entries: FsEntry[] = absEntries.map((e) => ({
      uri: relative(workspace, e.abs).split(sep).join("/"),
      size: e.size,
      mtime: e.mtime,
    }));
    entries.sort((a, b) => a.uri.localeCompare(b.uri));
    return c.json({ entries });
  });
}
