/**
 * Illustration contracts (I1) — the drawn-figure layer over the lecture.
 *
 * Layering: this directory is host-agnostic pure TS (no React, no DOM, no
 * engine imports beyond `engine/types.js`), exactly like `narration/`. The
 * ENGINE stays sidecar-free: a figure's declared shape reaches the factory
 * through the one `MeasureContext.illustration` seam, and everything here
 * is the host-side policy that feeds it.
 *
 * WHY A SIDECAR AT ALL. A figure needs a HEIGHT before it can be drawn:
 * the fold charges its box against the board's remaining depth, and
 * `check-board` reports what runs past the edge. The obvious source —
 * asking the loaded image for `naturalWidth`/`naturalHeight` — is the one
 * source we may not use: it arrives asynchronously (so the same lecture
 * would fold differently depending on when the file landed), and it is a
 * measurement, which makes the compiled timeline a function of pixels
 * rather than of the document (R8). So the shape is DECLARED, in
 * `<content-set>/illustrations/manifest.json`, one entry per asset — the
 * same shape and the same reasoning as the narration manifest's `seconds`.
 *
 * The on-disk truth is written by the AGENT (the generator script knows
 * the size it asked for); the board only ever reads it.
 */

import { flattenSteps } from "../engine/inference.js";
import type {
  IllustrationSpec,
  ImageStep,
  Lecture,
  StepRef,
} from "../engine/types.js";

// ── Manifest (on-disk contract, agent-written) ──────────────────────────────

/** One drawn figure, keyed in the manifest by the `src` the lecture writes. */
export interface IllustrationEntry {
  /**
   * The figure's DECLARED aspect: width ÷ height. Positive and finite.
   *
   * A figure always fills the width of the space it is placed in, so this
   * is the whole of its geometry — the board reads height off it and never
   * off the file (see the module header).
   */
  aspect: number;
}

export interface IllustrationManifest {
  figures: Record<string, IllustrationEntry>;
}

export interface IllustrationManifestRead {
  manifest: IllustrationManifest | null;
  /**
   * null when the manifest is absent OR fully valid. A MISSING manifest is
   * the documented "this lecture draws no figures" state; a MALFORMED one
   * must not hide behind that silence, so the reason rides along and
   * reaches the agent through `check-board`.
   */
  issue: string | null;
}

/** `./a/b.png` and `a/b.png` name the same file — one spelling wins. */
export function normalizeIllustrationSrc(src: string): string {
  let out = src.trim();
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/**
 * Tolerant manifest reader — the narration reader's twin. `undefined`/empty
 * means "no manifest"; anything unreadable degrades to the same state but
 * CARRIES the reason, and individually broken entries are dropped one by
 * one so one typo never blanks every figure on the board.
 *
 * Two spellings of the same declaration are accepted, because both are
 * things the writer already has: `aspect` (width ÷ height) outright, or
 * `width` + `height` in whatever unit the generator used — the ratio is
 * all the board reads, so the numbers may be pixels, millimetres or
 * anything else proportional.
 */
export function readIllustrationManifest(
  raw: string | null | undefined,
): IllustrationManifestRead {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { manifest: null, issue: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      manifest: null,
      issue: `illustrations/manifest.json is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      manifest: null,
      issue: "illustrations/manifest.json must be a JSON object",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const figuresRaw = obj.figures;
  if (
    figuresRaw === undefined ||
    typeof figuresRaw !== "object" ||
    figuresRaw === null ||
    Array.isArray(figuresRaw)
  ) {
    return {
      manifest: null,
      issue:
        'illustrations/manifest.json needs a "figures" object (picture path → its aspect)',
    };
  }
  const figures: Record<string, IllustrationEntry> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(figuresRaw)) {
    const aspect = readAspect(value);
    if (aspect === undefined) {
      dropped.push(key);
      continue;
    }
    figures[normalizeIllustrationSrc(key)] = { aspect };
  }
  return {
    manifest: { figures },
    issue:
      dropped.length > 0
        ? `illustrations/manifest.json has ${dropped.length} unusable entr${
            dropped.length === 1 ? "y" : "ies"
          } (need a positive aspect, or width and height): ${dropped.join(", ")}`
        : null,
  };
}

/** One entry's declared aspect, in either accepted spelling. */
function readAspect(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const direct = entry.aspect;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const w = entry.width;
  const h = entry.height;
  if (
    typeof w === "number" &&
    typeof h === "number" &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    return w / h;
  }
  return undefined;
}

// ── Resolution (the one verdict both the board and `check-board` read) ──────

/** Why a picture named in the lecture cannot be drawn. */
export type IllustrationRefusal = "unsafePath" | "noEntry" | "fileMissing";

/** A picture the board could not draw, addressed and quoted. */
export interface UndrawnIllustration {
  ref: StepRef;
  /** The path as the lecture wrote it — what the agent has to fix. */
  src: string;
  reason: IllustrationRefusal;
}

/**
 * A picture path is a path INSIDE the lecture's own folder. Anything else
 * is refused rather than passed on:
 *
 *  - an absolute path or a web address would leave the workspace, and the
 *    file route refuses it anyway (the traversal guard);
 *  - `../` climbs out of the content set, same objection;
 *  - and both would ALSO be a different origin as far as the board's paint
 *    is concerned, where the failure mode is total and completely silent
 *    (`.claude/rules/frontend.md` — a mask reads pixels, so the browser
 *    refuses a cross-origin source while every diagnostic still says the
 *    picture loaded fine). Refusing here is what keeps that trap out of
 *    the product.
 */
export function isSafeIllustrationSrc(src: string): boolean {
  const path = normalizeIllustrationSrc(src);
  if (path === "") return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false; // http:, data:, file:
  return !path.split("/").includes("..");
}

/**
 * The verdict for ONE picture: `null` when the board can draw it, a refusal
 * otherwise. The single place both surfaces read — the seam that builds the
 * figure and the `check-board` inventory — so the board can never draw
 * something the report calls missing, or the other way round.
 *
 * `absentFiles` holds paths a host probe CONFIRMED are not on disk
 * (workspace-relative, the narration probe's shape). An unanswerable probe
 * contributes nothing: unknown is never an accusation.
 */
export function illustrationRefusal(
  src: string,
  manifest: IllustrationManifest | null,
  absentFiles?: ReadonlySet<string>,
): IllustrationRefusal | null {
  const path = normalizeIllustrationSrc(src);
  if (!isSafeIllustrationSrc(path)) return "unsafePath";
  if (absentFiles?.has(path)) return "fileMissing";
  if (manifest?.figures[path] === undefined) return "noEntry";
  return null;
}

/** The declared aspect for a drawable picture, or `undefined` if refused. */
export function illustrationAspect(
  src: string,
  manifest: IllustrationManifest | null,
  absentFiles?: ReadonlySet<string>,
): number | undefined {
  if (illustrationRefusal(src, manifest, absentFiles) !== null) return undefined;
  return manifest?.figures[normalizeIllustrationSrc(src)]?.aspect;
}

/**
 * Every picture this lecture names that the board cannot draw, in document
 * order — the `check-board` input. Pure over (lecture, manifest, confirmed
 * absences), so it is pinned without a browser.
 */
export function undrawnIllustrations(
  lecture: Lecture,
  manifest: IllustrationManifest | null,
  absentFiles?: ReadonlySet<string>,
): UndrawnIllustration[] {
  const out: UndrawnIllustration[] = [];
  for (const { ref, step } of flattenSteps(lecture)) {
    if (step.kind !== "image") continue;
    const reason = illustrationRefusal(step.src, manifest, absentFiles);
    if (reason !== null) out.push({ ref, src: step.src, reason });
  }
  return out;
}

/** Every picture this lecture names, safe paths only, deduplicated. */
export function illustrationSources(lecture: Lecture): string[] {
  const seen = new Set<string>();
  for (const { step } of flattenSteps(lecture)) {
    if (step.kind !== "image") continue;
    const path = normalizeIllustrationSrc((step as ImageStep).src);
    if (isSafeIllustrationSrc(path)) seen.add(path);
  }
  return [...seen].sort();
}

// ── The host seam's own shape ───────────────────────────────────────────────

/**
 * What a host hands the board so it can draw the pictures a lecture names.
 *
 * `resolve` is the whole answer: a spec, or `undefined` for every refusal
 * (`illustrationRefusal` decides which). `identity` is what the board keys
 * its rebuilds on — a figure's node is a function of the sidecar and of the
 * host's on-disk probe, and NEITHER is a byte of `board.md`, so the content
 * hash structurally cannot see them change (`viewer/reconcile.ts`).
 */
export interface IllustrationSource {
  resolve(src: string): IllustrationSpec | undefined;
  identity: string;
}

/**
 * The one `IllustrationSource` this mode builds — pure, so the URL rule and
 * the refusal rule are pinned without a browser.
 *
 * `toUrl` receives a WORKSPACE-relative path (content set prefixed) and
 * owes a SAME-ORIGIN URL back. That is not a preference: a mask reads
 * pixels, so a cross-origin source is refused by the browser with no
 * output and no diagnostic (`.claude/rules/frontend.md`) — which is why
 * this seam takes a path and never a base URL.
 */
export function illustrationSource(
  manifest: IllustrationManifest | null,
  contentSet: string,
  toUrl: (workspacePath: string) => string,
  absentFiles?: ReadonlySet<string>,
): IllustrationSource {
  const prefix = contentSet === "" ? "" : `${contentSet}/`;
  const figures = manifest?.figures ?? {};
  return {
    identity: [
      contentSet,
      ...Object.keys(figures)
        .sort()
        .map((key) => `${key}=${figures[key]!.aspect}`),
      ...[...(absentFiles ?? [])].sort().map((path) => `-${path}`),
    ].join("|"),
    resolve: (src) => {
      const path = normalizeIllustrationSrc(src);
      if (illustrationRefusal(path, manifest, absentFiles) !== null) {
        return undefined;
      }
      const aspect = figures[path]?.aspect;
      if (aspect === undefined) return undefined;
      return { aspect, url: toUrl(`${prefix}${path}`) };
    },
  };
}
