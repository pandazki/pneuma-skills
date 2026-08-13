/**
 * `frame-board` (canvas pivot design §6) — the IMAGINING organ, and the
 * pure half of it.
 *
 * Three organs, one nervous system (§6.4): `glance-board` answers what the
 * wall IS, `check-board` answers what is WRONG, and this one answers *what
 * my declaration would cover*. It exists to serve step 3 of the owner's
 * authoring rhythm — imagine the region before writing it.
 *
 * WHAT MAKES IT HONEST (§6.3, and the reason the 2026-05 "dry-run is
 * permanently rejected" ruling could be partly overturned): it draws
 * DECLARATIONS, never predictions. On a canvas the position is *said*, so
 * a preview is rectangle arithmetic over words the author already wrote —
 * not a simulation of a layout engine. Concretely, this module never:
 *
 *   - simulates candidate content (no fake text, no predicted height, no
 *     predicted wrapping);
 *   - infers "where the fold would put it" (the canvas model has no such
 *     inference — the word IS the place);
 *   - suggests a position (the room stopped choosing; a mirror is not a
 *     shop assistant);
 *   - nudges, shrinks or reflows a frame to dodge a collision (what is
 *     drawn is exactly what was declared);
 *   - draws what would be erased (nothing gets erased on its own any more).
 *
 * Those five are pinned as NEGATIVE tests in `__tests__/board-frame.test.ts`.
 * A preview that quietly helps is a preview that lies.
 *
 * TWO "NOW"s, AND THE GAP IS STATED RATHER THAN PAPERED OVER (§6.2). Reveal
 * is paint-level — a step occupies its box the moment it mounts, and the
 * wipe/fade only decides when the ink shows — so layout geometry is ALWAYS
 * the truth at the document end, and the collision arithmetic below is
 * exact at any playhead. The image, by contrast, shows the paint the user
 * is looking at right now. `BASELINE_TAIL` and the performed watermark say
 * so out loud instead of pretending the two agree.
 *
 * The parser is the fold's parser (`engine/regions.ts`), imported, never
 * re-implemented — §14 pins "解析器与折叠同源" as a MECHANICAL fact, which
 * is why this module has no region table of its own to drift.
 */

import {
  collide,
  intersection,
  regionWordsFor,
  resolveRegionRect,
  type Rect,
  type RegionFacet,
  type StandingBox,
} from "../engine/regions.js";
import { parseStepKey } from "./address.js";

// ── Input ──────────────────────────────────────────────────────────────────

/**
 * One candidate declaration, in the DIALECT'S OWN WORDS (§6.1: the action's
 * parameter vocabulary IS the region vocabulary — one word list, two
 * mouths). `at` is what would follow `@at`; `anchor` is the quoted anchor of
 * an anchored placement; `label` is the author's own name for the candidate,
 * used only to caption it.
 */
export interface FrameCandidate {
  at: string;
  anchor?: string;
  label?: string;
}

/** The most candidates one call may frame (§6.1). */
export const MAX_CANDIDATES = 8;

/**
 * The board geometry the frames resolve against — all of it read from the
 * live fold, none of it invented here.
 */
export interface FrameGeometry {
  /** The pen's board, 0-based; frames land on the face the pen faces. */
  panel: number;
  /** Total boards; 1 means the long strip. */
  boards: number;
  /** Content-face width, board px. */
  faceW: number;
  /** Content-face height; `Infinity` on the strip. */
  faceH: number;
  /**
   * Strip only: the write front — the depth a NEW placement starts at
   * (design §3.6, the fold's verdict, not the word's).
   */
  front: number;
  /** Strip only: the whole strip's current depth, for the crop line. */
  stripDepth?: number;
}

/**
 * The playhead watermark for the baseline line (§6.2). `where` is a
 * human-facing address of the last step actually performed this session,
 * `null` when nothing has played yet.
 */
export interface FramePerformed {
  where: string | null;
  pending: number;
}

export interface FrameInput {
  candidates: readonly FrameCandidate[];
  geometry: FrameGeometry;
  /** Standing boxes as the collision pass sees them (§5.1), any board. */
  standing: readonly StandingBox[];
  performed: FramePerformed;
  /**
   * Resolved anchor depths, face-relative, keyed by the anchor text the
   * candidate quoted. A candidate whose anchor is absent from this map is
   * reported as unresolved — the frame is NOT quietly re-based to the front
   * (that would draw a rectangle nobody declared).
   */
  anchors?: ReadonlyMap<string, number>;
}

// ── Output ─────────────────────────────────────────────────────────────────

/** One standing region a candidate frame lands on. */
export interface FrameHit {
  /** Region key as the fold names it (`right`, `left#2`, …). */
  region: string;
  /** User-facing step labels of the boxes hit, document order. */
  steps: string[];
  overlap: Rect;
  /** Overlap area over the SMALLER area — §5.2's own quotient. */
  fraction: number;
}

export type FrameVerdict =
  | {
      ok: true;
      /** A/B/C…, or the author's `label`. */
      tag: string;
      word: string;
      anchor?: string;
      rect: Rect;
      /**
       * The strip's frames have no declared depth — the word says how wide
       * and which edge, and the writing decides how far down. `open` frames
       * are drawn with no bottom edge and reported as such.
       */
      open: boolean;
      hits: FrameHit[];
    }
  | { ok: false; tag: string; word: string; message: string };

export interface FrameReport {
  panel: number;
  facet: RegionFacet;
  verdicts: FrameVerdict[];
  /** Standing boxes on the pen's board — the annotation layer's subjects. */
  standing: StandingBox[];
  /** Strip only: the vertical band the image covers, face coordinates. */
  window: { from: number; to: number } | null;
  message: string;
}

// ── Wording (pinned character-for-character by the tests) ───────────────────

/**
 * §6.2's closing sentence, verbatim. The claim it makes is the narrow one
 * the design allows: the frame is a declaration; whether the CONTENT fills
 * it is answered afterwards, by looking.
 */
export const BASELINE_TAIL =
  "Frames are declarations, not predictions — whether content FILLS its frame is answered after you write, by glance and capture.";

/**
 * §5.4's claim-vs-ink honesty, in this organ's voice. A `full` prose box
 * CLAIMS the whole board width even where its last line stops short, so an
 * overlap reported against the flow is a claim overlap and may not be an ink
 * one. Saying so is the difference between a report and an accusation — and
 * it is the same admission `board-check.ts::CLAIM_VS_INK_NOTE` makes; the
 * two sentences differ only in what they point at next, because a preview
 * cannot honestly tell you to go look at the preview.
 */
export const FRAME_CLAIM_VS_INK_NOTE =
  "The flow's box claims the full width even where its last line stops short, so an overlap with it may be a claim overlap and not an ink one — capture after you write to see the ink.";

/** The empty-candidate call's own first line (§6.4: the annotate mode). */
export const ANNOTATE_LINE =
  "No candidates — this is the wall's structure annotated: every standing box outlined, nothing proposed.";

const CANDIDATE_TAGS = "ABCDEFGH";

const round = (n: number): number => Math.round(n);
const pct = (fraction: number): number => Math.round(fraction * 100);

/** How a hit names the region it landed on — `board-check.ts`'s spelling. */
function regionWord(region: string): string {
  const [word = region, episode] = region.split("#");
  return episode ? `${word} (placement ${episode})` : word;
}

/** `§2 step 5` — the user-facing address of a standing box's step key. */
function stepLabel(key: string): string {
  const ref = parseStepKey(key);
  if (!ref) return key;
  return ref.step < 0
    ? `§${ref.section} title`
    : `§${ref.section} step ${ref.step + 1}`;
}

/** "§2 step 4, §2 step 5" — capped so one crowded region cannot flood. */
function stepsText(steps: readonly string[]): string {
  if (steps.length <= 3) return steps.join(", ");
  return `${steps.slice(0, 3).join(", ")} and ${steps.length - 3} more`;
}

/** The performed watermark, `null`-safe (§6.2 + §10.1's honesty qualifier). */
export function performedText(performed: FramePerformed): string {
  const played =
    performed.where === null
      ? "nothing performed yet this session"
      : `played through ${performed.where} this session`;
  const pending =
    performed.pending === 1
      ? "1 step still to perform"
      : `${performed.pending} steps still to perform`;
  return `${played}; ${pending}`;
}

// ── The resolution (all arithmetic, zero prediction) ───────────────────────

/**
 * The image's vertical band on the strip (§6.1-3): the bounding box of the
 * candidate frames and the write front, opened one notch, capped at two
 * viewport heights. Bounded boards have no window — the whole face fits.
 */
export function stripWindow(
  frames: readonly Rect[],
  front: number,
  viewportH: number,
  depth: number,
): { from: number; to: number } {
  const pad = Math.max(80, viewportH * 0.25);
  let lo = front;
  let hi = front;
  for (const f of frames) {
    lo = Math.min(lo, f.y);
    if (Number.isFinite(f.h)) {
      hi = Math.max(hi, f.y + f.h);
    } else {
      // An open frame declares no depth, so the CROP has to choose one.
      // It chooses a screenful and SAYS the range in the report's first
      // line — a stated crop is not a predicted height (§6.3): the number
      // describes the picture, never the content.
      hi = Math.max(hi, f.y + viewportH);
    }
  }
  let from = Math.max(0, lo - pad);
  let to = Math.max(hi + pad, Math.min(depth, hi + pad));
  const cap = viewportH * 2;
  if (to - from > cap) to = from + cap;
  return { from: round(from), to: round(to) };
}

/**
 * Resolve every candidate and render the report. Total: a candidate that
 * cannot be resolved is reported IN PLACE and the others still answer
 * (§14's "错词/坏锚逐条回报不挂起").
 */
export function resolveFrames(input: FrameInput): FrameReport {
  const { geometry, performed } = input;
  const facet: RegionFacet = Number.isFinite(geometry.faceH)
    ? "bounded"
    : "strip";
  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  const standing = input.standing.filter((b) => b.panel === geometry.panel);

  const verdicts: FrameVerdict[] = candidates.map((candidate, i) => {
    const tag = candidate.label?.trim() || CANDIDATE_TAGS[i] || `#${i + 1}`;
    const word = String(candidate.at ?? "").trim();
    const verdict = resolveRegionRect(word, geometry.faceW, geometry.faceH);
    if (!verdict.ok) {
      return { ok: false, tag, word, message: verdict.message };
    }

    // Where this frame's top sits. On a bounded board the word says it
    // outright. On the strip the word says only x/w, and the depth comes
    // from the fold: the write front, or the anchor the author quoted.
    let top = verdict.rect.y;
    let anchorNote: string | undefined;
    if (facet === "strip") {
      if (candidate.anchor) {
        const resolved = input.anchors?.get(candidate.anchor);
        if (resolved === undefined) {
          return {
            ok: false,
            tag,
            word,
            message: `nothing on the board answers to "${candidate.anchor}" — the frame is not drawn rather than quietly re-based to the write front.`,
          };
        }
        top = resolved;
        anchorNote = candidate.anchor;
      } else {
        top = geometry.front;
      }
    } else if (candidate.anchor) {
      const resolved = input.anchors?.get(candidate.anchor);
      if (resolved === undefined) {
        return {
          ok: false,
          tag,
          word,
          message: `nothing on the board answers to "${candidate.anchor}" — the frame is not drawn rather than quietly re-based to the top of its region.`,
        };
      }
      top = resolved;
      anchorNote = candidate.anchor;
    }

    const rect: Rect = { ...verdict.rect, y: top };
    const open = !Number.isFinite(rect.h);

    // The hits — §5.2's predicate, imported, on the same boxes check-board
    // uses. An open frame's Infinity height is not a guess: `@at` declares
    // that everything after it lands in this column from here down, so the
    // whole column below the origin IS the declaration.
    const byRegion = new Map<string, FrameHit>();
    for (const box of standing) {
      // SAME REGION IS NOT A COLLISION — the same exclusion
      // `detectCollisions` makes, and for the same reason: re-entering a
      // region continues its standing run BELOW what is already in it, so
      // reporting a candidate against its own region would warn about an
      // overlap the fold will never produce. The candidate's word is
      // compared against the region's base word, so `right` and a later
      // `right#2` episode of it are the same region here.
      if (box.region.split("#")[0] === word) continue;
      if (!collide(rect, box.rect)) continue;
      const overlap = intersection(rect, box.rect);
      const areaBox = Math.max(0, box.rect.w) * Math.max(0, box.rect.h);
      const areaOverlap = Math.max(0, overlap.w) * Math.max(0, overlap.h);
      const fraction = areaBox > 0 ? Math.min(1, areaOverlap / areaBox) : 0;
      const existing = byRegion.get(box.region);
      if (existing) {
        existing.steps.push(stepLabel(box.key));
        existing.fraction = Math.max(existing.fraction, fraction);
        existing.overlap = {
          x: Math.min(existing.overlap.x, overlap.x),
          y: Math.min(existing.overlap.y, overlap.y),
          w: Math.max(existing.overlap.w, overlap.w),
          h: Math.max(existing.overlap.h, overlap.h),
        };
      } else {
        byRegion.set(box.region, {
          region: box.region,
          steps: [stepLabel(box.key)],
          overlap,
          fraction,
        });
      }
    }

    return {
      ok: true,
      tag,
      word,
      ...(anchorNote ? { anchor: anchorNote } : {}),
      rect,
      open,
      hits: [...byRegion.values()],
    };
  });

  const drawn = verdicts.filter((v): v is Extract<FrameVerdict, { ok: true }> => v.ok);
  const window =
    facet === "strip"
      ? stripWindow(
          drawn.map((v) => v.rect),
          geometry.front,
          Number.isFinite(geometry.faceW) ? geometry.faceW * 0.7 : 800,
          geometry.stripDepth ?? geometry.front,
        )
      : null;

  return {
    panel: geometry.panel,
    facet,
    verdicts,
    standing,
    window,
    message: renderFrameReport({
      panel: geometry.panel,
      facet,
      verdicts,
      standing,
      window,
      geometry,
      performed,
      hadCandidates: candidates.length > 0,
      dropped: input.candidates.length - candidates.length,
    }),
  };
}

// ── The render (design §6.1-4; the tests pin every sentence) ───────────────

interface RenderInput {
  panel: number;
  facet: RegionFacet;
  verdicts: readonly FrameVerdict[];
  standing: readonly StandingBox[];
  window: { from: number; to: number } | null;
  geometry: FrameGeometry;
  performed: FramePerformed;
  hadCandidates: boolean;
  dropped: number;
}

function renderFrameReport(input: RenderInput): string {
  const lines: string[] = [];
  const { facet, geometry, window } = input;
  const face = `board ${input.panel + 1}`;

  // 1 — the strip's crop, stated first and honestly (§6.1-3).
  if (window) {
    lines.push(
      // HONESTY DEBT, stated rather than hidden: §6.1-3 specifies that the
      // IMAGE is cropped to this band. The crop is not implemented — the
      // capture is the whole panels element — so this line says where to
      // LOOK in the picture instead of claiming a range the picture does
      // not have. The moment the crop lands, this becomes "showing …".
      `Your frames sit between ${window.from} and ${window.to} board px down the strip; the write front stands at ${round(geometry.front)}. The picture is the whole strip — the design's crop to that band is not built yet, so scroll to it.`,
    );
  }

  // 2 — what is standing, so a free frame means something.
  const regions = [...new Set(input.standing.map((b) => b.region))];
  lines.push(
    input.standing.length === 0
      ? `Nothing stands on ${face} — it is ${geometry.faceW} px wide${
          facet === "bounded" ? ` and ${round(geometry.faceH)} px tall` : " and open-ended"
        }.`
      : `On ${face} (${geometry.faceW} px wide${
          facet === "bounded" ? `, ${round(geometry.faceH)} px tall` : ", open-ended"
        }), ${input.standing.length} ${
          input.standing.length === 1 ? "box stands" : "boxes stand"
        } in ${regions.length} ${regions.length === 1 ? "region" : "regions"}: ${regions
          .map(regionWord)
          .join(", ")}.`,
  );

  // 3 — one line per candidate.
  if (!input.hadCandidates) {
    lines.push(ANNOTATE_LINE);
  } else {
    for (const v of input.verdicts) {
      if (!v.ok) {
        lines.push(`${v.tag} "@at ${v.word}" — not drawn: ${v.message}`);
        continue;
      }
      const geo = v.open
        ? `${round(v.rect.w)} px wide at x ${round(v.rect.x)}, running down from ${round(v.rect.y)} — depth undeclared`
        : `${round(v.rect.w)} × ${round(v.rect.h)} px at (${round(v.rect.x)}, ${round(v.rect.y)})`;
      const said = `@at ${v.word}${v.anchor ? ` "${v.anchor}"` : ""}`;
      const anchored = v.anchor ? `, anchored to "${v.anchor}"` : "";
      const landing =
        v.hits.length === 0
          ? "Free — nothing standing under it."
          : `Lands on ${v.hits
              .map(
                (h) =>
                  `${regionWord(h.region)} (${stepsText(h.steps)}), covering ${pct(h.fraction)}% of it`,
              )
              .join("; ")}.`;
      lines.push(`${v.tag} "${said}" — ${geo}${anchored}. ${landing}`);
    }
  }

  // 3b — the claim-vs-ink admission, once, when the flow is a party to any
  // reported overlap (§5.4's discipline, this organ's wording).
  const touchesFlow = input.verdicts.some(
    (v) => v.ok && v.hits.some((h) => h.region.split("#")[0] === "full"),
  );
  if (touchesFlow) lines.push(FRAME_CLAIM_VS_INK_NOTE);

  if (input.dropped > 0) {
    lines.push(
      `${input.dropped} further ${input.dropped === 1 ? "candidate was" : "candidates were"} not framed — ${MAX_CANDIDATES} is the most one look holds.`,
    );
  }

  // 4 — the honest baseline (§6.2): the image is the playhead's truth, the
  // arithmetic above is the document end's.
  lines.push(
    `The image shows the wall as the user sees it now (${performedText(input.performed)}). ${BASELINE_TAIL}`,
  );

  return lines.join("\n");
}

/** The region words this facet accepts — the action's own error surface. */
export function frameVocabulary(facet: RegionFacet): readonly string[] {
  return regionWordsFor(facet);
}
