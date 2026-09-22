/**
 * The stage's decidable half — no React, no DOM, no canvas.
 *
 * Four questions live here, and each of them can be answered wrongly in a way
 * that still looks right on screen, which is why they are pure and pinned by
 * `modes/sprite/__tests__/viewer-logic.test.ts`:
 *
 *   1. WHICH CHARACTER  — `selectActiveCharacter`.
 *   2. WHAT PLAYS       — `resolveFrameSource`: aligned frames, else the raw
 *      sheet sliced client-side, else nothing. A stage that quietly plays the
 *      unprocessed sheet as if it were the finished motion is the failure this
 *      ordering exists to make visible; the source is reported by name in
 *      `get-playback-state` for exactly that reason.
 *   3. WHEN IT MOVES    — `advance`: an accumulator against `1000 / fps`, so
 *      playback runs at the motion's own fps regardless of the display's
 *      refresh rate, and a one-shot stops on its last frame instead of
 *      wrapping. `transportIntent` / `typingTarget` are the same question
 *      asked of the keyboard: which key moves the stage, and when does a key
 *      belong to whatever the user is typing into instead.
 *   4. WHERE AN ADDRESS POINTS — `resolveAddress`, shared by the `navigate-to`
 *      action, the `capture` pre-navigation, and a `<viewer-locator>` click,
 *      so all three land in the same place or refuse for the same reason.
 *
 * A note on the frames array: an id the project no longer carries keeps its
 * SLOT (`null`) rather than being filtered out. Dropping it would renumber
 * every later frame, and then `frame: 7` would silently mean frame 6 — the
 * exact class of wrongness a screenshot cannot catch.
 */

import type {
  CharacterProject,
  Motion,
  Roster,
} from "../domain.js";
import { resolveAssetUri } from "../domain.js";
import { contentUrl } from "./urls.js";

// ── Which character ────────────────────────────────────────────────────────

/**
 * The character the stage shows.
 *
 * `activeContentSet` is the framework's answer when the workspace has
 * switchable sets, but `createDirectoryContentSetResolver()` deliberately
 * surfaces none for a single directory — so a one-character workspace always
 * arrives with `null` here and must still render. Falling back to the first
 * character by name is what keeps that workspace from looking empty.
 */
export function selectActiveCharacter(
  roster: Roster | null,
  activeContentSet: string | null | undefined,
): CharacterProject | null {
  if (!roster) return null;
  if (activeContentSet != null && roster.byContentSet[activeContentSet]) {
    return roster.byContentSet[activeContentSet];
  }
  const first = Object.keys(roster.byContentSet).sort()[0];
  return first === undefined ? null : roster.byContentSet[first];
}

// ── What plays ─────────────────────────────────────────────────────────────

/** Aligned frames — the finished motion. A `null` slot is a missing asset. */
export interface FramesSource {
  kind: "frames";
  frames: ReadonlyArray<string | null>;
  count: number;
  /** How many declared frames have no asset behind them. */
  missing: number;
}

/**
 * One image, sliced in the browser: the instant preview that exists between
 * "the image landed" and "the pipeline ran".
 *
 * Two pictures arrive as this shape. A sprite motion's generated SHEET, cut
 * `cols x rows`; and a loop motion's KEYFRAME, which is one cell — the single
 * image its clip starts and ends on, and the only thing there is to look at
 * while the clip renders. They are told apart by the motion (`kind: "loop"`),
 * not by the geometry: a 1x1 sheet is a legal sprite motion.
 */
export interface SheetSource {
  kind: "raw-sheet";
  url: string;
  cols: number;
  rows: number;
  count: number;
  /** True when this is the background-keyed image rather than the raw one. */
  alpha: boolean;
}

export interface NoSource {
  kind: "none";
}

export type FrameSource = FramesSource | SheetSource | NoSource;

/**
 * What the stage can actually draw for this motion, in precedence order.
 * `imageVersion` rides into every URL (see `urls.ts`).
 */
export function resolveFrameSource(
  project: CharacterProject | null,
  motion: Motion | null,
  imageVersion: number,
): FrameSource {
  if (!project || !motion) return { kind: "none" };

  if (motion.frames.length > 0) {
    let missing = 0;
    const frames = motion.frames.map((assetId) => {
      const uri = resolveAssetUri(project, assetId);
      if (!uri) {
        missing += 1;
        return null;
      }
      return contentUrl(project.contentSet, uri, imageVersion);
    });
    // Every id dangling means the run's assets are gone, not that the motion
    // has a hundred blank frames — fall through to whatever sheet exists.
    if (missing < frames.length) {
      return { kind: "frames", frames, count: frames.length, missing };
    }
  }

  // A loop has no sheet — it has a keyframe, the image its clip opens and
  // closes on. Until the clip comes back and `loop` cuts it, that image IS
  // the motion as far as anyone can see, so it goes on the stage as a
  // one-cell source and `stageWarnings` says what it is. The cut-out wins
  // when it exists, for the same reason the keyed sheet does below.
  if (motion.kind === "loop") {
    const keyId = motion.keyframeAlpha ?? motion.keyframe;
    const keyUri = keyId ? resolveAssetUri(project, keyId) : undefined;
    if (keyUri) {
      return {
        kind: "raw-sheet",
        url: contentUrl(project.contentSet, keyUri, imageVersion),
        cols: 1,
        rows: 1,
        count: 1,
        alpha: motion.keyframeAlpha !== undefined,
      };
    }
  }

  // The keyed sheet is the better preview when it exists: it is the one the
  // slicer will cut, background already removed.
  const sheetId = motion.sheetAlpha ?? motion.sheetRaw;
  const sheetUri = sheetId ? resolveAssetUri(project, sheetId) : undefined;
  const cols = Math.max(1, Math.floor(motion.grid.cols));
  const rows = Math.max(1, Math.floor(motion.grid.rows));
  if (sheetUri) {
    return {
      kind: "raw-sheet",
      url: contentUrl(project.contentSet, sheetUri, imageVersion),
      cols,
      rows,
      count: cols * rows,
      alpha: motion.sheetAlpha !== undefined,
    };
  }

  return { kind: "none" };
}

/** How many frames the stage can step through. */
export function frameCountOf(source: FrameSource): number {
  return source.kind === "none" ? 0 : source.count;
}

// ── What the strip shows ───────────────────────────────────────────────────

/**
 * The most thumbnails the strip will mount.
 *
 * Every thumbnail is a real picture the browser has to fetch, decode and keep
 * a layout box for. A 355-frame 532x460 loop mounted one `<img>` per frame and
 * took the renderer down with it: the tab stopped answering CDP, the launcher
 * logged the browser disconnecting, and only killing the render process got it
 * back (2026-09-22, the Kiki trial). Video-model loops made this a normal size
 * rather than an extreme one — 7 s at 48 fps is 355 frames — so the strip
 * cannot keep promising one thumbnail per frame.
 *
 * 96 is chosen to stay above what any pane can show at once (a 46 px thumb in
 * a 1600 px strip is ~34 of them) so scrubbing still has somewhere to go, and
 * far below the count where the mount itself is the problem.
 */
export const STRIP_MAX_THUMBS = 96;

/**
 * Which frames the strip draws, in order.
 *
 * Short motions are shown whole — the sprite sheets this mode started with
 * are 8 to 40 frames and every one of them is worth a thumbnail. A long
 * motion is sampled at an EVEN stride, and the two ends are always in it:
 * frame 0 and the last frame are the two sides of a loop's seam, which is the
 * one comparison a user opens the strip to make.
 *
 * This is a DISPLAY sample and nothing else. The stage still plays every
 * frame, `navigate-to` still addresses every frame, and a thumbnail still
 * carries its own true index — so clicking the one labelled 213 seeks to 213,
 * not to "the 57th thumbnail".
 */
export function stripFrames(
  count: number,
  max: number = STRIP_MAX_THUMBS,
): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const total = Math.floor(count);
  if (total <= max || max < 2) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const last = total - 1;
  const out: number[] = [];
  for (let i = 0; i < max; i += 1) {
    const index = Math.round((i * last) / (max - 1));
    if (out[out.length - 1] !== index) out.push(index);
  }
  return out;
}

/**
 * The thumbnail the playhead sits on — the nearest SHOWN frame.
 *
 * On a sampled strip the playhead is usually between two thumbnails, and the
 * strip has to mark one of them or the row loses its playhead entirely while
 * the motion runs. Marking the nearest is the honest answer because the
 * thumbnail keeps its own number: the mark says "you are around here", and the
 * exact frame is the counter above it. Ties go to the earlier frame so the
 * mark never runs ahead of the stage.
 */
export function nearestStripFrame(
  shown: ReadonlyArray<number>,
  frame: number,
): number | null {
  if (shown.length === 0) return null;
  let best = shown[0] as number;
  let bestDistance = Math.abs(best - frame);
  for (const index of shown) {
    const distance = Math.abs(index - frame);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

// ── When it moves ──────────────────────────────────────────────────────────

export interface PlaybackState {
  /** 0-based index into the frame source. */
  frame: number;
  /** Milliseconds carried over toward the next frame. */
  acc: number;
  playing: boolean;
}

export interface PlaybackOptions {
  frameCount: number;
  fps: number;
  loop: boolean;
}

/**
 * A backgrounded tab hands back one enormous delta on its first frame after
 * being revealed (rAF is suspended while the window is occluded — see the
 * frontend rules). Playing that back honestly would spin the motion through
 * however many frames elapsed while nobody was watching; clamping resumes
 * roughly where the user left it. One second is deliberately generous — it
 * still absorbs a slow render at any fps this mode uses, and only a real
 * suspension exceeds it.
 */
const MAX_DELTA_MS = 1000;

/** The slowest fps we will honour — a `0` in the file must not divide by zero. */
const MIN_FPS = 0.1;

/**
 * Advance the scheduler by `deltaMs`. Pure: same inputs, same output — the
 * rAF loop only supplies the clock.
 */
export function advance(
  state: PlaybackState,
  deltaMs: number,
  opts: PlaybackOptions,
): PlaybackState {
  const count = Math.floor(opts.frameCount);
  if (count <= 0) return { frame: 0, acc: 0, playing: false };
  if (!state.playing) return state;
  if (count === 1) return { ...state, frame: 0, acc: 0 };

  const step = 1000 / Math.max(opts.fps, MIN_FPS);
  const delta = Math.min(Math.max(deltaMs, 0), MAX_DELTA_MS);
  const acc = state.acc + delta;
  const advanced = Math.floor(acc / step);
  if (advanced <= 0) return { ...state, acc };

  const remainder = acc - advanced * step;
  const target = state.frame + advanced;

  if (opts.loop) {
    return { frame: target % count, acc: remainder, playing: true };
  }
  if (target >= count - 1) {
    return { frame: count - 1, acc: 0, playing: false };
  }
  return { frame: target, acc: remainder, playing: true };
}

/** Step one frame by hand (transport buttons, arrow keys). Always wraps —
 *  a user pressing "next" on the last frame means "show me the first". */
export function stepFrame(frame: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return ((frame + delta) % count + count) % count;
}

/** Keep a frame index inside a source that may have shrunk under it. */
export function clampFrame(frame: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(Math.floor(frame), 0), count - 1);
}

// ── Which key moves it ─────────────────────────────────────────────────────

/** What a transport key asks for; each maps onto a transport button. */
export type TransportIntent =
  | "toggle-play"
  | "step-back"
  | "step-forward"
  | "first-frame"
  | "last-frame";

/** The half of a `KeyboardEvent` this decision is made of. */
export interface TransportKeyEvent {
  key: string;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Space plays, arrows step — the keyboard half of the transport.
 *
 * Only a BARE key counts: `Cmd+ArrowLeft` is the browser's history gesture and
 * `Shift+Space` scrolls a page, and stealing either of them from a user who
 * meant it is worse than making them reach for the mouse. A held Space is
 * dropped too — key repeat would toggle play dozens of times a second, which
 * reads as the stage stuttering rather than as a shortcut working.
 */
export function transportIntent(event: TransportKeyEvent): TransportIntent | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case " ":
    // Older engines (and some remotes) still report the legacy name.
    case "Spacebar":
      return event.repeat ? null : "toggle-play";
    case "ArrowLeft":
      return "step-back";
    case "ArrowRight":
      return "step-forward";
    case "Home":
      return "first-frame";
    case "End":
      return "last-frame";
    default:
      return null;
  }
}

/** The part of an event target that decides whether a key was meant for it. */
export interface TransportKeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * True when the key belongs to whatever the user is typing into.
 *
 * The stage listens on the document — it has no focus of its own to hold — so
 * every keystroke in the chat composer, in a command popover's note field or
 * in any other editable surface passes through this listener first. A space
 * swallowed out of a sentence is the loudest bug a shortcut can have.
 */
export function typingTarget(
  target: TransportKeyTarget | null | undefined,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION";
}

// ── Where an address points ────────────────────────────────────────────────

/**
 * Sprite's ViewerAddress vocabulary: `contentSet` (framework-reserved) names
 * the character, `motion` / `ref` are the coarse halves — a thing to put on
 * the stage — and `frame` is the fine half, an index inside the motion.
 */
export interface SpriteAddress {
  contentSet?: string;
  motion?: string;
  ref?: string;
  frame?: number;
}

/**
 * Read an agent-supplied address leniently — this is an input boundary. A
 * frame written as `"3"` is what a hand-written JSON payload looks like; a
 * frame written as `"later"` is not a frame and is dropped rather than
 * becoming `NaN` three layers down.
 */
export function parseAddress(raw: unknown): SpriteAddress {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const address: SpriteAddress = {};

  for (const key of ["contentSet", "motion", "ref"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      address[key] = value.trim();
    }
  }

  const frame = record.frame;
  const asNumber =
    typeof frame === "number"
      ? frame
      : typeof frame === "string" && frame.trim() !== ""
        ? Number(frame)
        : NaN;
  if (Number.isInteger(asNumber) && asNumber >= 0) address.frame = asNumber;

  return address;
}

export type AddressTarget =
  | { kind: "motion"; motionId: string; frame: number | null }
  | { kind: "ref"; refId: string }
  | { kind: "character" };

export interface AddressResolution {
  /** Maps straight onto `ViewerActionResult.success`. */
  ok: boolean;
  /** Where to move, even when `ok` is false — an out-of-range frame still
   *  lands on the motion, because arriving nowhere is worse than arriving
   *  close and being told so. */
  target: AddressTarget | null;
  message?: string;
}

/** Content-set keys are directories; an agent copying one out of a seed
 *  catalogue writes the trailing slash, so both sides are trimmed. */
const trimKey = (key: string): string => key.replace(/^\/+|\/+$/g, "");

/**
 * Refuse an address that names a character this stage is not showing.
 *
 * The framework switches content sets before an address reaches a viewer
 * (`src/store/navigate-plan.ts`); an action dispatched straight from the agent
 * has had no such pass, and answering about the character on stage while the
 * agent asked about another one is the failure that looks exactly like
 * success. Every action that takes an address goes through here, so
 * `navigate-to` and `get-playback-state` refuse for the same reason in the
 * same words.
 *
 * @returns the refusal sentence, or null when the address is about this stage.
 */
export function contentSetMismatch(
  project: CharacterProject | null,
  contentSet: string | undefined,
): string | null {
  if (!project || contentSet === undefined) return null;
  const named = trimKey(contentSet);
  const here = trimKey(project.contentSet);
  if (named === here) return null;
  return `This stage is showing "${here || "the root character"}", not "${named}". Switch the content set first.`;
}

/**
 * Resolve an address against the character on stage.
 *
 * `currentMotionId` is what a bare `{ frame }` applies to — the motion the
 * user is already looking at.
 */
export function resolveAddress(
  project: CharacterProject | null,
  address: SpriteAddress,
  currentMotionId: string | null,
): AddressResolution {
  if (!project) {
    return { ok: false, target: null, message: "No character is loaded." };
  }

  const mismatch = contentSetMismatch(project, address.contentSet);
  if (mismatch) return { ok: false, target: null, message: mismatch };

  let note: string | undefined;
  if (address.motion && address.ref) {
    note = `Both "motion" and "ref" were given; they are mutually exclusive, so the ref "${address.ref}" was ignored.`;
  }

  if (!address.motion && address.ref) {
    const ref = project.sprite.refs.find((r) => r.id === address.ref);
    if (!ref) {
      const known = project.sprite.refs.map((r) => r.id).join(", ") || "none";
      return {
        ok: false,
        target: null,
        message: `Reference "${address.ref}" is not in this character (has: ${known}).`,
      };
    }
    return { ok: true, target: { kind: "ref", refId: ref.id } };
  }

  const motionId = address.motion ?? (address.frame !== undefined ? currentMotionId : null);
  if (!motionId) {
    if (address.frame !== undefined) {
      return {
        ok: false,
        target: null,
        message: "A frame was given but no motion is on stage — name the motion too.",
      };
    }
    return { ok: true, target: { kind: "character" }, ...(note ? { message: note } : {}) };
  }

  const motion = project.sprite.motions.find((m) => m.id === motionId);
  if (!motion) {
    const known = project.sprite.motions.map((m) => m.id).join(", ") || "none";
    return {
      ok: false,
      target: null,
      message: `Motion "${motionId}" is not in this character (has: ${known}).`,
    };
  }

  if (address.frame === undefined) {
    return {
      ok: true,
      target: { kind: "motion", motionId: motion.id, frame: null },
      ...(note ? { message: note } : {}),
    };
  }

  // The frame count here is the declared one — the number of frames the
  // motion HAS, not what happens to be decoded on screen.
  const count = declaredFrameCount(motion);
  if (address.frame >= count) {
    return {
      ok: false,
      target: {
        kind: "motion",
        motionId: motion.id,
        frame: count > 0 ? count - 1 : 0,
      },
      message: `Motion "${motion.id}" has ${count} frame${count === 1 ? "" : "s"} (0-${Math.max(count - 1, 0)}); frame ${address.frame} does not exist. Stopped on the last one.`,
    };
  }

  return {
    ok: true,
    target: { kind: "motion", motionId: motion.id, frame: address.frame },
    ...(note ? { message: note } : {}),
  };
}

/** Frames a motion claims to have, sheet- and keyframe-preview included. */
export function declaredFrameCount(motion: Motion): number {
  if (motion.frames.length > 0) return motion.frames.length;
  // The keyframe is one frame, and an address that names frame 0 of a loop
  // still being shot has to land on it rather than be refused.
  if (motion.kind === "loop" && (motion.keyframeAlpha ?? motion.keyframe)) return 1;
  if (motion.sheet ?? motion.sheetAlpha ?? motion.sheetRaw) {
    return Math.max(1, Math.floor(motion.grid.cols)) *
      Math.max(1, Math.floor(motion.grid.rows));
  }
  return 0;
}

// ── What the agent reads back ──────────────────────────────────────────────

export interface PlaybackStateData {
  contentSet: string | null;
  motion: string | null;
  /** Present only for a loop motion — absent is "a sprite motion", the same
   *  way the sidecar says it. */
  kind?: "loop";
  frame: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  playing: boolean;
  /**
   * What the stage is really drawing. `"keyframe"` is a loop's one-image
   * stand-in: it arrives as a `raw-sheet` source because that is how a single
   * image is drawn, but reporting it under that name would tell the agent a
   * sheet exists for a motion that will never have one.
   */
  source: FrameSource["kind"] | "keyframe";
  warnings: string[];
  [key: string]: unknown;
}

/**
 * Everything wrong with what is on stage, in sentences.
 *
 * The deterministic half comes from `motion.inspect` — the sidecar summary
 * `register-run` copied out of the last inspect report (never `inspect.json`
 * on disk; the viewer does not read that file). The rest is what the VIEWER
 * knows and the report cannot: assets the project references but no longer
 * carries, and the fact that a "preview" is the unprocessed sheet.
 */
export function stageWarnings(
  motion: Motion | null,
  source: FrameSource,
): string[] {
  const warnings: string[] = [];
  if (motion?.inspect) warnings.push(...motion.inspect.warnings);
  if (source.kind === "frames" && source.missing > 0) {
    warnings.push(
      `${source.missing} of ${source.count} frames have no asset in project.json — those frames render blank.`,
    );
  }
  if (source.kind === "raw-sheet") {
    warnings.push(
      motion?.kind === "loop"
        ? "No frames yet — the stage shows the keyframe; the clip is rendering or `sprite-sheet.mjs loop` has not run."
        : `No aligned frames yet — the stage is slicing the ${source.alpha ? "keyed" : "raw"} sheet ${source.cols}x${source.rows} client-side. Run sprite-sheet.mjs to align and pack.`,
    );
  }
  if (motion && motion.status === "failed" && motion.notes) {
    warnings.push(`Motion failed: ${motion.notes}`);
  }
  return warnings;
}

/** The `get-playback-state` payload — the stage described in facts. */
export function playbackStateData(input: {
  project: CharacterProject | null;
  motion: Motion | null;
  source: FrameSource;
  frame: number;
  playing: boolean;
  fps: number;
  loop: boolean;
}): PlaybackStateData {
  const count = frameCountOf(input.source);
  const loopMotion = input.motion?.kind === "loop";
  return {
    contentSet: input.project ? input.project.contentSet : null,
    motion: input.motion ? input.motion.id : null,
    ...(loopMotion ? { kind: "loop" as const } : {}),
    frame: count > 0 ? clampFrame(input.frame, count) : 0,
    frameCount: count,
    fps: input.fps,
    loop: input.loop,
    playing: input.playing,
    source: input.source.kind === "raw-sheet" && loopMotion
      ? "keyframe"
      : input.source.kind,
    warnings: stageWarnings(input.motion, input.source),
  };
}
