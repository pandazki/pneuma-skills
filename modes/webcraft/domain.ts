/**
 * Webcraft domain types + aggregate-file load/save functions.
 *
 * A `Site` is the full collection of every content set in the workspace,
 * each represented by its `manifest.json` (or, as a fallback, by the
 * .html files found at the content-set root). The viewer picks the
 * active content set at render time via the Zustand workspace slice's
 * `activeContentSet`.
 *
 * Content-set prefix convention (matches illustrate/slide):
 *   ""          → root-level manifest.json / root-level html files
 *   "pneuma"    → pneuma/manifest.json   / pneuma/*.html
 *
 * `saveSite` is a stub. Webcraft HTML edits flow through
 * `fileChannel.write()` directly (the UI never restructures manifests),
 * so the Site-level write path has nothing to emit. Future UI-level
 * page add/remove/reorder would extend this to rewrite manifest.json.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PageEntry {
  /** Path relative to the content-set prefix (e.g. "index.html"). */
  file: string;
  title: string;
}

export interface SiteManifest {
  pages: PageEntry[];
}

/**
 * The whole webcraft workspace — every site's page list keyed by
 * content-set prefix. `""` represents a root-level site.
 */
export interface Site {
  byContentSet: Record<string, SiteManifest>;
}

// ── loadSite ────────────────────────────────────────────────────────────────

/**
 * Build a Site from the raw file snapshot.
 *
 * First pass: match every `manifest.json` at any depth and parse each one
 * into a SiteManifest keyed by the directory prefix (everything before
 * `/manifest.json`). Accepts both `{ pages: [...] }` and the legacy
 * `{ files: [...] }` format. Parse errors throw; the aggregate-file
 * provider catches and emits an error event while keeping the source
 * alive.
 *
 * Second pass (fallback): for content-set prefixes that have .html files
 * at their root but no manifest.json, synthesize a minimal manifest
 * listing those .html files in alphabetical order. Preserves the old
 * "auto-discover pages from html glob" behavior the viewer relied on.
 *
 * Returns null when the snapshot is empty — the source stays in
 * "no initial" state and a later file change can produce a valid Site.
 */
export function loadSite(
  files: ReadonlyArray<ViewerFileContent>,
): Site | null {
  if (files.length === 0) return null;

  const byContentSet: Record<string, SiteManifest> = {};

  // ── First pass: parse every manifest.json ────────────────────────────────
  for (const file of files) {
    const isRootManifest = file.path === "manifest.json";
    const isNestedManifest = file.path.endsWith("/manifest.json");
    if (!isRootManifest && !isNestedManifest) continue;

    const prefix = isRootManifest
      ? ""
      : file.path.slice(0, -"/manifest.json".length);

    // Let JSON.parse throw — aggregate-file catches and emits an error.
    const parsed = JSON.parse(file.content);
    const entries: unknown = parsed.pages ?? parsed.files;
    if (!Array.isArray(entries) || entries.length === 0) continue;

    const pages: PageEntry[] = entries
      .map((p: { file?: string; path?: string; title?: string }) => {
        const f = p.file || p.path || "";
        return {
          file: f,
          title:
            p.title ||
            f.replace(/\.html$/i, "").replace(/^.*\//, ""),
        };
      })
      .filter((p) => p.file.length > 0);

    if (pages.length > 0) {
      byContentSet[prefix] = { pages };
    }
  }

  // ── Second pass: html-glob fallback for prefixes without a manifest ──────
  // Content sets are top-level directories in webcraft. Group html files by
  // their immediate parent directory (first path component). Nested html
  // files deeper inside a content set are ignored by the fallback — the
  // manifest.json is the only way to register non-root pages.
  const htmlByPrefix = new Map<string, ViewerFileContent[]>();
  for (const file of files) {
    if (!/\.html$/i.test(file.path)) continue;
    const firstSlash = file.path.indexOf("/");
    let prefix: string;
    if (firstSlash < 0) {
      // Root-level html (e.g. "index.html").
      prefix = "";
    } else {
      // First directory component is the content-set prefix.
      // Only count html files that live DIRECTLY under that directory —
      // deeper paths (e.g. "pneuma/sub/page.html") don't belong to the
      // simple page list.
      const rest = file.path.slice(firstSlash + 1);
      if (rest.includes("/")) continue;
      prefix = file.path.slice(0, firstSlash);
    }
    const bucket = htmlByPrefix.get(prefix);
    if (bucket) bucket.push(file);
    else htmlByPrefix.set(prefix, [file]);
  }

  for (const [prefix, htmlFiles] of htmlByPrefix) {
    if (byContentSet[prefix]) continue; // manifest already covers this prefix
    const sorted = [...htmlFiles].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    byContentSet[prefix] = {
      pages: sorted.map((f) => {
        const rel = prefix === "" ? f.path : f.path.slice(prefix.length + 1);
        return {
          file: rel,
          title: rel.replace(/\.html$/i, "").replace(/^.*\//, ""),
        };
      }),
    };
  }

  if (Object.keys(byContentSet).length === 0) return null;
  return { byContentSet };
}

// ── saveSite ────────────────────────────────────────────────────────────────

/**
 * Stub: webcraft's viewer does not currently restructure the Site from
 * the UI. All content edits (HTML text-edit events) route through
 * `fileChannel.write()` directly. When UI-level page add/remove/reorder
 * lands, this function should diff `next.byContentSet` against `current`
 * and emit manifest.json rewrites + any orphaned-file deletes.
 */
export function saveSite(
  _next: Site,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}
