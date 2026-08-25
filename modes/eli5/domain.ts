/**
 * ELI5 domain types + aggregate-file load/save.
 *
 * An `Explainer` is the whole ELI5 workspace: every `manifest.json` found
 * under any content set directory, keyed by that directory prefix (an
 * empty-string key `""` means a root-level manifest). One content set is
 * one topic; its manifest lists the audiences that topic has been
 * explained to, in ladder order — simplest register first, most technical
 * last. The viewer picks the active content set at render time via the
 * Zustand workspace slice's `activeContentSet`. Same shape as slide's
 * `Deck` and illustrate's `Studio`.
 *
 * `saveExplainer` is a deliberate no-op. The ELI5 viewer is a *player*:
 * it renders the ladder and lets the user climb it, but every write —
 * manifest, pages, assets — belongs to the agent, which authors them
 * with its own tools. There is no viewer gesture that mutates the
 * explainer, so there is nothing to decompose. When audience reordering
 * lands in the viewer, replace the no-op with a real decomposer rather
 * than teaching the viewer to write files some other way.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** One rung of the audience ladder, as stored in manifest.json. */
export interface AudienceEntry {
  /** Stable id within the content set — the `audience` key of a ViewerAddress. */
  id: string;
  /** Human label shown on the rail (e.g. "Age 5", "Manager", "8 岁孩子"). */
  label: string;
  /** Page path relative to the content set, e.g. "pages/manager.html". */
  file: string;
  /** Optional register hint the agent recorded for this audience. */
  tone?: string;
}

/** The manifest for a single content set — one topic, explained N ways. */
export interface ExplainerManifest {
  title: string;
  topic?: string;
  language?: string;
  /** Ladder order: index 0 is the simplest register. */
  audiences: AudienceEntry[];
}

/**
 * The whole ELI5 workspace — every `manifest.json` at any depth, keyed by
 * the directory prefix (everything before `/manifest.json`). A root-level
 * manifest uses key `""`.
 */
export interface Explainer {
  byContentSet: Record<string, ExplainerManifest>;
}

// ── Coercion helpers ────────────────────────────────────────────────────────

/** Keep a value only if it is a genuinely present string. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Derive an audience id from its page file: "pages/manager.html" →
 * "manager". Used only when the manifest omitted the id; a fabricated id
 * must still be something the agent can predict from what it wrote.
 */
function idFromFile(file: string): string | undefined {
  const base = file.split("/").pop() ?? "";
  return optionalString(base.replace(/\.html?$/i, ""));
}

/**
 * Coerce one raw `audiences[]` entry into a renderable rung.
 *
 * Junk entries are kept rather than filtered: the rung index is what a
 * `<viewer-locator>` and the workspace item list count with, so dropping
 * a malformed entry would silently shift every audience after it away
 * from the manifest the agent wrote. A rung with an empty `file` renders
 * as an unreachable page — visible, and fixable by the agent — which is
 * the honest outcome.
 */
function coerceAudience(raw: unknown, index: number): AudienceEntry {
  const src =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const file = optionalString(src.file) ?? "";
  const fallbackId = idFromFile(file) ?? `audience-${index + 1}`;
  const id = optionalString(src.id) ?? fallbackId;
  const label = optionalString(src.label) ?? id;
  const tone = optionalString(src.tone);

  return tone ? { id, label, file, tone } : { id, label, file };
}

// ── loadExplainer ───────────────────────────────────────────────────────────

/**
 * Build an Explainer from the raw file snapshot. Every `manifest.json` at
 * any depth is parsed into an ExplainerManifest keyed by its prefix.
 * Returns null when no manifest exists yet — the source stays in "no
 * initial value" state and a later file change can still produce a valid
 * Explainer.
 *
 * JSON syntax errors throw; the aggregate-file provider catches them and
 * emits an error event while keeping the source alive. Field-level
 * malformation does NOT throw — an agent mid-edit routinely leaves a
 * field missing, and a half-written ladder should still render.
 */
export function loadExplainer(
  files: ReadonlyArray<ViewerFileContent>,
): Explainer | null {
  const manifests = files.filter(
    (f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"),
  );
  if (manifests.length === 0) return null;

  const byContentSet: Record<string, ExplainerManifest> = {};
  for (const mf of manifests) {
    const prefix =
      mf.path === "manifest.json"
        ? ""
        : mf.path.slice(0, -"/manifest.json".length);

    // Let JSON.parse throw — the provider reports it as a source error.
    const parsed = JSON.parse(mf.content) as Record<string, unknown>;

    byContentSet[prefix] = {
      title: optionalString(parsed.title) ?? "Untitled",
      topic: optionalString(parsed.topic),
      language: optionalString(parsed.language),
      audiences: Array.isArray(parsed.audiences)
        ? parsed.audiences.map(coerceAudience)
        : [],
    };
  }

  return { byContentSet };
}

// ── saveExplainer ───────────────────────────────────────────────────────────

/**
 * No-op writer. See the file header: the viewer is a player and holds no
 * gesture that mutates the explainer, so there is no next-state to
 * decompose. Returning empty ops (rather than throwing) keeps the
 * aggregate-file provider's write path well-defined if some future code
 * path calls it — nothing is written, and nothing is silently lost,
 * because nothing was ever staged.
 */
export function saveExplainer(
  _next: Explainer,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  return { writes: [], deletes: [] };
}
