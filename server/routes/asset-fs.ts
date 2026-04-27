/**
 * Asset filesystem routes.
 *
 * Registered for clipcraft-style modes.
 *
 * - GET  /api/assets/fs-listing: flat listing of media files under
 *   `<workspace>/assets/**` with size + mtime. Pure filesystem scan —
 *   no project.json parsing, no reconciliation. The client does the
 *   diff against its in-memory asset registry.
 *
 * - POST /api/assets/trash: moves one or more workspace-relative files
 *   to the OS trash via the `trash` npm package. Path-scoped to the
 *   workspace's `assets/` tree — absolute paths and `..` escapes are
 *   rejected before touching disk. Returns `{ trashed, failed }`.
 */

import type { Hono } from "hono";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import trash from "trash";

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

  app.post("/api/assets/trash", async (c) => {
    let body: { uris?: string[] };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const uris = Array.isArray(body.uris) ? body.uris : [];
    if (uris.length === 0) {
      return c.json({ trashed: [], failed: [] });
    }

    const trashed: string[] = [];
    const failed: Array<{ uri: string; error: string }> = [];
    const absPaths: string[] = [];

    for (const uri of uris) {
      if (typeof uri !== "string" || uri.length === 0) {
        failed.push({ uri: String(uri), error: "invalid uri" });
        continue;
      }
      // Security: reject absolute paths and `..` escapes. Require the
      // URI to start with "assets/" so we never touch anything outside
      // the workspace's asset tree.
      if (uri.startsWith("/") || uri.includes("..") || !uri.startsWith("assets/")) {
        failed.push({ uri, error: "path out of scope" });
        continue;
      }
      const abs = join(workspace, uri);
      if (!existsSync(abs)) {
        failed.push({ uri, error: "not found" });
        continue;
      }
      absPaths.push(abs);
    }

    try {
      if (absPaths.length > 0) {
        await trash(absPaths); // one call, batched
      }
      for (const uri of uris) {
        if (!failed.find((f) => f.uri === uri)) trashed.push(uri);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // On batch failure, mark every uri that was attempted as failed
      // with the same message (trash package throws on first failure).
      for (const uri of uris) {
        if (!failed.find((f) => f.uri === uri)) {
          failed.push({ uri, error: message });
        }
      }
      return c.json({ trashed, failed }, 500);
    }

    return c.json({ trashed, failed });
  });
}
