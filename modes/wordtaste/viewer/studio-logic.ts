/**
 * studio-logic — pure, framework-free helpers for the WordtastePreview studio.
 *
 * Everything here is deterministic and React-free so the fiddly studio logic
 * (the rung dial's human-temperature labels, the span-address builder, the
 * dense-block readability guard, the default direction chips, the active
 * content-set draft/taste derivation) can be unit-tested without mounting a
 * component or driving a browser. The viewer composes these into UI; the tests
 * pin the behavior that catches real regressions (brief §13 step 6).
 */

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  loadDraft,
  loadTaste,
  loadAnnotations,
  type Draft,
  type TasteProfile,
  type DraftAnnotations,
} from "../domain.js";

// ── The disruption ladder (human temperature, never "rung N") ────────────────

/** Rungs run 0–5. The user never sees the number — only the temperature word. */
export const MIN_RUNG = 0;
export const MAX_RUNG = 5;

/**
 * Human-facing labels for each rung. The source experiment's hard rule: do NOT
 * explain rungs to the user — speak in felt temperature ("gentler … bolder"),
 * not in mechanism. Index = rung.
 */
const RUNG_LABELS = [
  "Faithful", // 0 — barely touch it
  "Gentle", // 1
  "Loosened", // 2
  "Spirited", // 3
  "Bold", // 4
  "Unleashed", // 5 — break the cage
] as const;

/** The temperature word for a rung (clamped). */
export function rungLabel(rung: number): string {
  return RUNG_LABELS[clampRung(rung)];
}

/** A one-line caption for the whole dial extremes — the human framing. */
export const RUNG_SCALE_CAPTION = "gentler · bolder";

/** Keep a rung in [0,5] and integer. */
export function clampRung(rung: number): number {
  if (!Number.isFinite(rung)) return MIN_RUNG;
  return Math.max(MIN_RUNG, Math.min(MAX_RUNG, Math.round(rung)));
}

/**
 * Apply a `set-ladder` action payload to the current rung. Absolute `rung`
 * wins; otherwise a relative `delta` is added. Mirrors the action contract
 * (brief §4.1: `{ rung?, delta? }`). Returns the clamped next rung.
 */
export function applyLadder(
  current: number,
  payload: { rung?: number; delta?: number },
): number {
  if (typeof payload.rung === "number") return clampRung(payload.rung);
  if (typeof payload.delta === "number") return clampRung(current + payload.delta);
  return clampRung(current);
}

// ── Default direction chips (the zero-latency popup) ─────────────────────────

/** One rewrite direction chip. `symptom` ties it to a rubric id when known. */
export interface DirectionChip {
  /** The direction the agent rewrites toward, sent verbatim as `direction`. */
  label: string;
  /** Optional rubric symptom id this chip targets (for the poke path). */
  symptom?: string;
}

/**
 * The canonical static default set shown INSTANTLY when a span is selected,
 * before the agent's taste-aware `propose-directions` lands (brief §4.1
 * fast-path: canonical symptoms S2/S4/S5/S7 + "tighten"). These are phrased as
 * imperatives the agent can act on directly.
 */
export const DEFAULT_DIRECTIONS: DirectionChip[] = [
  { label: "Cut the AI metaphor", symptom: "S7" },
  { label: "Break the marching skeleton", symptom: "S2" },
  { label: "Land one punch", symptom: "S4" },
  { label: "Drop the definition couplet", symptom: "S5" },
  { label: "Tighten" },
];

/**
 * Normalize the agent's `propose-directions` payload (an opaque object) into a
 * chip list. Accepts either `{ directions: string[] }`, `{ directions:
 * DirectionChip[] }`, or a bare array — tolerant because the agent authors the
 * payload. Falls back to the static defaults when nothing usable is present.
 */
export function chipsFromProposal(directions: unknown): DirectionChip[] {
  const raw = Array.isArray(directions)
    ? directions
    : isRecord(directions) && Array.isArray(directions.directions)
      ? directions.directions
      : null;
  if (!raw) return DEFAULT_DIRECTIONS;
  const chips: DirectionChip[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) {
      chips.push({ label: entry.trim() });
    } else if (isRecord(entry) && typeof entry.label === "string" && entry.label.trim()) {
      chips.push({
        label: entry.label.trim(),
        ...(typeof entry.symptom === "string" ? { symptom: entry.symptom } : {}),
      });
    }
  }
  return chips.length > 0 ? chips : DEFAULT_DIRECTIONS;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ── Span address building (select → ViewerAddress) ───────────────────────────

/** The fine span handle within a block's source text (brief §3.1). */
export interface SpanHandle {
  start: number;
  end: number;
  quote: string;
}

/**
 * Extends the framework's `ViewerAddress` (a `Record<string, unknown>`) so a
 * WordtasteAddress is assignable wherever an address is expected, while still
 * naming wordtaste's keys for the viewer's own type-safety.
 */
export interface WordtasteAddress extends Record<string, unknown> {
  contentSet?: string;
  block: string;
  span?: SpanHandle;
  frozen?: boolean;
  rung?: number;
  symptoms?: string[];
}

/**
 * Build a `span` handle by locating `quote` inside the block's source markdown.
 * The offsets are the fast path; `quote` is the self-healing re-anchor (brief
 * §3.1). Returns null when the quote is empty or cannot be found in the block
 * (e.g. the selection spanned rendered chrome, not source text) — the caller
 * then falls back to a block-only (coarse) address.
 *
 * `hintStart` biases `indexOf` so a quote that appears more than once in the
 * block resolves near where the user actually dragged (the rendered position
 * maps roughly to source position for prose).
 */
export function buildSpanHandle(
  blockMarkdown: string,
  quote: string,
  hintStart = 0,
): SpanHandle | null {
  const q = quote.trim();
  if (!q) return null;
  let idx = blockMarkdown.indexOf(q, Math.max(0, hintStart));
  if (idx < 0) idx = blockMarkdown.indexOf(q);
  if (idx < 0) return null;
  return { start: idx, end: idx + q.length, quote: q };
}

/**
 * Assemble the full wordtaste ViewerAddress for a selection (brief §5.1). A coarse
 * block selection omits `span`; a fine text-range selection carries it. The
 * decorations (`frozen`, `rung`, `symptoms`) ride along so `extractContext`
 * can surface them and the agent feeds the address straight back into
 * `rewrite-span`.
 */
export function buildAddress(args: {
  contentSet: string;
  block: string;
  span?: SpanHandle | null;
  frozen: boolean;
  rung: number;
  symptoms?: string[];
}): WordtasteAddress {
  const address: WordtasteAddress = {
    block: args.block,
    frozen: args.frozen,
    rung: clampRung(args.rung),
  };
  if (args.contentSet) address.contentSet = args.contentSet;
  if (args.span) address.span = args.span;
  if (args.symptoms && args.symptoms.length > 0) address.symptoms = args.symptoms;
  return address;
}

// ── Readability guard (the orthogonal axis) ──────────────────────────────────

/**
 * A block is "dense" when its source markdown exceeds the monster-paragraph cap
 * (brief §5.5 — readability is orthogonal to AI-ness). Measured on the source
 * length so a single runaway paragraph trips it regardless of rendered wrapping.
 * Headings, code fences and short lists never trip it.
 */
export const DENSE_BLOCK_CHARS = 600;

export function isDenseBlock(markdown: string): boolean {
  const text = markdown.trim();
  if (text.startsWith("#")) return false; // a heading is never "dense"
  if (text.startsWith("```")) return false; // code blocks are exempt
  return text.length > DENSE_BLOCK_CHARS;
}

/**
 * The set of dense block ids in a draft — drives the readability flag chrome
 * and the one-shot `readability-check` notification (brief §5.5).
 */
export function denseBlockIds(draft: Draft | null): string[] {
  if (!draft) return [];
  return draft.blocks.filter((b) => isDenseBlock(b.markdown)).map((b) => b.id);
}

// ── Active content-set derivation (the source is root-only) ───────────────────

/**
 * The framework's aggregate-file source calls `loadDraft(files)` with NO
 * content-set arg, so `sources.draft` only ever yields the ROOT draft. A
 * wordtaste workspace, however, is one content-set directory per writing project
 * (a seed lands at `worked-example/draft.md`). The viewer therefore derives the
 * Draft for the *active* content set directly from the raw file snapshot —
 * `loadDraft` is a pure function and re-exported here so the viewer has one
 * import surface. The source subscription is still what drives re-render +
 * origin tagging; this is the content extraction.
 */
export function deriveDraft(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): Draft | null {
  return loadDraft(files, contentSet);
}

export function deriveTaste(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): TasteProfile | null {
  return loadTaste(files, contentSet);
}

/**
 * Derive the per-block revision notes for the active content set from the raw
 * file snapshot (the aggregate-file source is root-only, same reason as
 * deriveDraft). Drives the block-aligned annotation column; returns null when
 * the active project has no annotations file, so the column stays hidden and
 * the article reads full-width.
 */
export function deriveAnnotations(
  files: ReadonlyArray<ViewerFileContent>,
  contentSet: string,
): DraftAnnotations | null {
  return loadAnnotations(files, contentSet);
}

// ── Annotation column layout (block-aligned margin notes, no overlap) ─────────

/** One annotation group to place: anchored at its block's top, with a height. */
export interface AnnotationLayoutItem {
  id: string;
  /** The vertical offset of the anchored block's top, in the column's space. */
  anchorTop: number;
  /** The measured height of the group's card stack. */
  height: number;
}

/** The resolved vertical offset for an annotation group. */
export interface AnnotationLayoutResult {
  id: string;
  top: number;
}

/**
 * Resolve vertical collisions in the block-aligned annotation column — the
 * standard margin-notes layout. Each group prefers to sit at its anchor block's
 * top (`anchorTop`), but is pushed down just enough to clear the previous
 * group's bottom plus `gap`, so cards never cover each other's text.
 *
 * The walk is the classic non-overlap pass: sort by `anchorTop`, then for each
 * group set `top = max(anchorTop, previousResolvedBottom + gap)` where
 * `bottom = top + height`. A group with a clear run before the next anchor stays
 * exactly at its block; a dense cluster cascades downward. Pure and
 * deterministic — heights/tops are measured by the viewer and fed in here so the
 * collision math is unit-testable without a browser.
 *
 * Returns one result per input id, ordered by resolved `anchorTop`.
 */
export function layoutAnnotations(
  items: ReadonlyArray<AnnotationLayoutItem>,
  gap: number,
): AnnotationLayoutResult[] {
  const sorted = [...items].sort((a, b) => a.anchorTop - b.anchorTop);
  const out: AnnotationLayoutResult[] = [];
  let prevBottom = -Infinity;
  for (const item of sorted) {
    const top = Math.max(item.anchorTop, prevBottom + gap);
    out.push({ id: item.id, top });
    prevBottom = top + Math.max(0, item.height);
  }
  return out;
}
