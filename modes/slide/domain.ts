/**
 * Slide domain types + aggregate-file load/save.
 *
 * A `Deck` is the entire slide workspace: every `manifest.json` found
 * under any content set directory (keyed by the directory prefix, where
 * an empty-string key `""` means a root-level manifest). Mirrors the
 * illustrate `Studio` pattern — the viewer picks the active content
 * set at render time via the Zustand workspace slice's
 * `activeContentSet`.
 *
 * The viewer drives three write paths (reorder, delete, debounced
 * text edit). All three collapse into `writeDeck(nextDeck)`; the
 * `saveDeck` decomposer diffs against the current file snapshot and
 * emits the minimal {writes, deletes} that the aggregate-file provider
 * applies to disk.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** One slide entry as stored in manifest.json and rendered by the viewer. */
export interface SlideEntry {
  file: string; // relative path within the content set, e.g. "slides/slide-01.html"
  title: string;
}

/** The manifest for a single content set. */
export interface DeckManifest {
  title: string;
  slides: SlideEntry[];
}

/**
 * The whole slide workspace — every `manifest.json` found under any
 * content set, keyed by directory prefix (everything before
 * `/manifest.json`). A root-level manifest uses key `""`.
 */
export interface Deck {
  byContentSet: Record<string, DeckManifest>;
}

// ── loadDeck ────────────────────────────────────────────────────────────────

/**
 * Build a Deck from the raw file snapshot. Every `manifest.json` at
 * any depth is parsed into a DeckManifest keyed by its prefix. Returns
 * null when no manifest exists yet — the source stays in "no initial"
 * state and a later file change can produce a valid Deck.
 *
 * JSON parse errors throw; the aggregate-file provider catches and
 * emits an error event while keeping the source alive.
 */
export function loadDeck(
  files: ReadonlyArray<ViewerFileContent>,
): Deck | null {
  const manifests = files.filter(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (manifests.length === 0) return null;

  const byContentSet: Record<string, DeckManifest> = {};
  for (const mf of manifests) {
    const prefix =
      mf.path === "manifest.json"
        ? ""
        : mf.path.slice(0, -"/manifest.json".length);
    const parsed = JSON.parse(mf.content) as Partial<DeckManifest>;
    byContentSet[prefix] = {
      title: typeof parsed.title === "string" ? parsed.title : "Untitled",
      slides: Array.isArray(parsed.slides)
        ? parsed.slides.map((s) => ({
            file: String(s.file ?? ""),
            title: String(s.title ?? ""),
          }))
        : [],
    };
  }

  return { byContentSet };
}

// ── saveDeck ────────────────────────────────────────────────────────────────

/**
 * Decompose a next-state Deck into the minimum file operations that
 * make disk match. Handles all three slide write paths:
 *
 *  - **Reorder**: manifest.slides order changed → one manifest.json write.
 *  - **Delete**:  a slide entry removed → manifest.json write + the
 *                 orphaned `slides/*.html` file is queued for delete
 *                 (only if it's no longer referenced by any content set
 *                 under the same prefix).
 *  - **Text edit**: a virtual `__edits` map on a DeckManifest contributes
 *                 per-file HTML writes (see `writeDeckEdits` helper).
 *
 * For a minimum viable decomposer we compare against `current` — any
 * content-set prefix whose manifest bytes differ from the freshly
 * serialized next state gets a manifest write. Per-slide HTML writes
 * are carried on an optional `__edits: Record<path, html>` field that
 * the viewer sets on the next Deck before calling `write`. That field
 * is stripped before serializing the manifest.
 */
export function saveDeck(
  next: Deck,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const writes: Array<{ path: string; content: string }> = [];
  const deletes: string[] = [];

  // Collect all per-slide HTML edits carried on the next Deck (if any)
  // and strip them from the serialized manifest.
  for (const [prefix, manifest] of Object.entries(next.byContentSet)) {
    const edits = (manifest as DeckManifest & {
      __edits?: Record<string, string>;
    }).__edits;
    if (edits) {
      for (const [relPath, html] of Object.entries(edits)) {
        const fullPath = prefix === "" ? relPath : `${prefix}/${relPath}`;
        writes.push({ path: fullPath, content: html + "\n" });
      }
    }

    // Serialize manifest (without __edits)
    const clean: DeckManifest = {
      title: manifest.title,
      slides: manifest.slides.map((s) => ({ file: s.file, title: s.title })),
    };
    const serialized = JSON.stringify(clean, null, 2) + "\n";
    const manifestPath = prefix === "" ? "manifest.json" : `${prefix}/manifest.json`;
    const existing = current.find((f) => f.path === manifestPath);
    if (existing?.content !== serialized) {
      writes.push({ path: manifestPath, content: serialized });
    }
  }

  // Delete orphaned slide HTML files: a slides/*.html file that was
  // referenced by the old manifest but no longer appears in the new
  // manifest for the same prefix.
  for (const [prefix, manifest] of Object.entries(next.byContentSet)) {
    const manifestPath = prefix === "" ? "manifest.json" : `${prefix}/manifest.json`;
    const oldManifestFile = current.find((f) => f.path === manifestPath);
    if (!oldManifestFile) continue;
    let oldManifest: DeckManifest;
    try {
      oldManifest = JSON.parse(oldManifestFile.content) as DeckManifest;
    } catch {
      continue;
    }
    const nextFiles = new Set(manifest.slides.map((s) => s.file));
    const oldFiles = Array.isArray(oldManifest.slides)
      ? oldManifest.slides.map((s) => s.file)
      : [];
    for (const f of oldFiles) {
      if (!nextFiles.has(f)) {
        const fullPath = prefix === "" ? f : `${prefix}/${f}`;
        // Only delete if the file actually exists in the snapshot.
        if (current.some((cf) => cf.path === fullPath)) {
          deletes.push(fullPath);
        }
      }
    }
  }

  return { writes, deletes };
}
