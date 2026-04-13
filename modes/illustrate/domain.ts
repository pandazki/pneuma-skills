/**
 * Illustrate domain types + aggregate-file load/save functions.
 *
 * A `Studio` is the full collection of every content set the user has in
 * their workspace, each represented by its `manifest.json`. The viewer
 * picks the active content set at render time based on the Zustand
 * workspace slice's `activeContentSet`.
 *
 * `saveStudio` is currently a stub — the illustrate viewer is read-only
 * from the UI side (the agent owns writes via the image generation
 * scripts + Edit tool). When editing lands, swap the throw for a real
 * decomposer that turns a Studio back into per-file writes.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types (must match the viewer's internal shape) ─────────────────────────

export interface ManifestItem {
  file: string;
  title: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  style?: string;
  tags?: string[];
  createdAt?: string;
  status?: "generating" | "ready";
}

export interface ManifestRow {
  id: string;
  label: string;
  items: ManifestItem[];
}

export interface IllustrateManifest {
  title: string;
  description?: string;
  rows: ManifestRow[];
}

/**
 * The whole illustrate workspace — every manifest.json found under any
 * content set directory, keyed by the directory prefix. An empty-string
 * key `""` represents a root-level `manifest.json` (workspace with no
 * content-set subdirectory).
 */
export interface Studio {
  byContentSet: Record<string, IllustrateManifest>;
}

// ── loadStudio ──────────────────────────────────────────────────────────────

/**
 * Build a Studio from the raw file snapshot. Matches every `manifest.json`
 * found at any depth and parses each one into an IllustrateManifest keyed
 * by the directory prefix (everything before `/manifest.json`). Returns
 * null when no manifest.json exists yet — the source stays in "no initial"
 * state and a later file change can produce a valid Studio.
 *
 * Parse errors throw; the aggregate-file provider catches the throw and
 * emits an error event while keeping the source alive.
 */
export function loadStudio(
  files: ReadonlyArray<ViewerFileContent>,
): Studio | null {
  const manifests = files.filter(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (manifests.length === 0) return null;

  const byContentSet: Record<string, IllustrateManifest> = {};
  for (const mf of manifests) {
    const prefix =
      mf.path === "manifest.json"
        ? ""
        : mf.path.slice(0, -"/manifest.json".length);
    // Let JSON.parse throw — aggregate-file catches and emits an error.
    byContentSet[prefix] = JSON.parse(mf.content) as IllustrateManifest;
  }

  return { byContentSet };
}

// ── saveStudio ──────────────────────────────────────────────────────────────

export function saveStudio(
  _next: Studio,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  throw new Error("illustrate viewer is read-only; editing not yet supported");
}
