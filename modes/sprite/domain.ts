/**
 * Sprite domain types + aggregate-file load/save.
 *
 * A `Roster` is the whole sprite workspace: every `project.json` found under
 * any content set directory, keyed by that directory prefix (an empty-string
 * key `""` means a root-level project). One content set is one CHARACTER —
 * there is no separate `character` address key because the character *is* the
 * content set.
 *
 * Each project file is a `pneuma-craft/project/v1` file exactly as clipcraft
 * persists it (`modes/clipcraft/persistence.ts::ProjectFile`) — an empty
 * composition, craft `assets[]` and `provenance[]` — plus a `sprite` sidecar
 * that carries everything this mode adds: the character, its references, and
 * its motions. Assets are addressed by id from the sidecar (a motion names
 * `bounce-frame-00`, not `motions/bounce/frames/00.png`), so the loader indexes
 * them once into `assetsById` and the viewer resolves uris through that map.
 *
 * Parsing is defensive on purpose. `project.json` is written by
 * `scripts/sprite-project.mjs` while the agent works, so the viewer can read it
 * mid-write or read a character whose directory was hand-created. A file that
 * fails to parse, is not a craft project, or has no `sprite` sidecar is
 * SKIPPED, never thrown on — one broken character must not blank the roster
 * for every sibling. (Contrast illustrate, whose single-shape manifest can
 * afford to let JSON.parse throw.)
 *
 * `saveRoster` throws. The v0.1 viewer is read-only: frames, atlases, previews
 * and the project file itself are written by the mode's scripts, which own the
 * asset-id and provenance bookkeeping. When viewer write-back lands (frame
 * reorder, fps edit, pivot drag), hydrate a craft store and replace the throw
 * with a real decomposer rather than teaching the viewer to write project.json
 * some other way.
 */

import type { ViewerFileContent } from "../../core/types/viewer-contract.js";

// ── Craft-owned shapes (mirrors modes/clipcraft/persistence.ts) ─────────────

export type SpriteAssetType = "image" | "video" | "text";

export type SpriteAssetStatus = "pending" | "generating" | "ready" | "failed";

/** One craft asset. `uri` is relative to the character directory. */
export interface SpriteAsset {
  id: string;
  type: SpriteAssetType;
  uri: string;
  name: string;
  metadata: Record<string, number | string | undefined>;
  createdAt: number;
  status?: SpriteAssetStatus;
  tags?: string[];
}

/** One craft provenance edge. Craft edges are single-parent; a multi-input
 *  step (pack, gif, r2v) names its first input here and lists every input in
 *  `operation.params.inputs`. */
export interface SpriteProvenanceEdge {
  toAssetId: string;
  fromAssetId: string | null;
  operation: {
    type: "generate" | "derive" | "upload" | "select";
    actor: "agent" | "human";
    params?: Record<string, unknown>;
    label?: string;
    timestamp: number;
  };
}

/** Composition settings — width/height are the character's cell size. Always
 *  present, tracks always empty (reserved for a future timeline). */
export interface SpriteComposition {
  settings: {
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
  };
  tracks: unknown[];
  transitions: unknown[];
}

// ── Sprite sidecar ─────────────────────────────────────────────────────────

/**
 * What the user is making — the route the agent took (0.5.0). Recorded so a
 * later session does not ask again, the rail's empty hint names the right
 * next ask, and the Export tab lists the families this character is for
 * first. Absent means the route was never recorded (every 0.4.x character):
 * the agent infers or asks, exactly as before.
 *
 * Sub-routes are deliberately not values here: pixel art is `character.pixel`
 * and the directions are the anchor refs.
 */
export const CHARACTER_PURPOSES = ["game", "loop", "mascot", "animate"] as const;

export type CharacterPurpose = (typeof CHARACTER_PURPOSES)[number];

/**
 * The four directions a motion or an anchor can face. Diagonals are an
 * 8-direction game's need nobody has asked for; the tuple can grow. "Side"
 * is not a direction: `character.facing` names the side that is generated,
 * and the other side is a `mirror` of it.
 */
export const DIRECTIONS = ["front", "back", "left", "right"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * The one authority for "this character is pixel art" (0.5.0). Absent means
 * it is not — older characters fall back to reading `style`
 * (`rive-plan.mjs`'s `riveIsPixelArt`).
 */
export interface PixelSpec {
  /** The character's height in logical pixels — the user's answer, which
   *  every pixel run snaps to. */
  logicalHeight: number;
  /** Asset id `<character>-palette` (text, `palette.json`), pinned by the
   *  first pixel run's `register-run`. Absent until pinned. */
  palette?: string;
  /** The palette size asked for, then the size it was pinned with. */
  colors?: number;
}

export interface SpriteCharacter {
  name: string;
  /** One paragraph the agent keeps current. */
  description: string;
  /** The style anchor sentence that opens every sheet prompt. */
  style: string;
  /** Default frame cell in px. */
  cell: { width: number; height: number };
  facing?: "left" | "right";
  /** The route this character is for; see `CharacterPurpose`. */
  purpose?: CharacterPurpose;
  /** Present only for a pixel-art character; see `PixelSpec`. */
  pixel?: PixelSpec;
  /**
   * Side-specific features that must not flip, as one sentence ("the sword
   * is always in the right hand"). It refuses `mirror` without `--force` and
   * becomes the identity guard of every built sheet prompt.
   */
  asymmetric?: string;
}

export type SpriteRefRole = "turnaround" | "portrait" | "expression" | "anchor" | "custom";

export interface SpriteRef {
  /** The `ref` address key, e.g. `"turnaround"`. */
  id: string;
  /** Asset id, e.g. `"ref-turnaround"`. */
  asset: string;
  role: SpriteRefRole;
  label: string;
  /**
   * The one direction an `anchor` faces — one single-pose image per
   * direction. Present exactly when `role === "anchor"`: an anchor without
   * one loads as `custom`, and no other role carries one.
   */
  direction?: Direction;
}

/** Declared order is the lifecycle order. The tuple is the single source of
 *  truth: the type is derived from it, so the parser's guard can never fall
 *  behind a status added to the union. */
export const MOTION_STATUSES = [
  "planned",
  "generating",
  "processing",
  "ready",
  "failed",
] as const;

export type MotionStatus = (typeof MOTION_STATUSES)[number];

/** Models that MAKE a clip out of images and a prompt. */
export type GeneratedVideoModel = "seedance-2.5" | "h3-max";

/** Models that make a clip out of ANOTHER CLIP — video matting (`veed`,
 *  `veed-gs` on its green-screen endpoint, `bria`), frame interpolation
 *  (`topaz`, `rife`) and the local reorder (`ffmpeg`, which invents no pixel
 *  at all and only replays the clip's own frames in another order). They
 *  generate nothing of their own, which is why they are a separate union: the
 *  render-video popover must not be able to offer one, and a `derived` clip
 *  must not claim a prompt. `veed-gs` is its own name rather than a flag on
 *  `veed`, and `rife` its own rather than a flag on `topaz`: each is a
 *  different endpoint with different parameters and a different price, and a
 *  clip recorded under its sibling's name is a model nobody called. */
export type DerivedVideoModel = "veed" | "veed-gs" | "bria" | "topaz" | "rife" | "ffmpeg";

export type VideoModel = GeneratedVideoModel | DerivedVideoModel;

export type GeneratedVideoMode = "i2v" | "first-last" | "r2v";

export type VideoMode = GeneratedVideoMode | "derived";

export interface MotionVideo {
  id: string;
  /** Asset id, e.g. `"attack-video-1"`. */
  asset: string;
  model: VideoModel;
  mode: VideoMode;
  prompt: string;
  status: "generating" | "ready" | "failed";
  /**
   * The clip this one was made FROM, by its sidecar id (`"video-1"`).
   *
   * Set only on a `derived` clip — a matte or an interpolation of an earlier
   * take. The provenance edge carries the same fact in asset ids; this is the
   * sidecar's own copy so the panel can say "matte of video-1" without walking
   * the graph.
   */
  derivedFrom?: string;
  /**
   * What the derivation did. Absent on a generated clip.
   *
   * `retime` replays the parent's own frames in another order (a hold cut
   * short, a repeated beat) and invents nothing; it is its own op because a
   * retime recorded as an `interpolate` claims a model ran that never did.
   */
  op?: "matte" | "interpolate" | "retime";
}

/** The latest `sprite-sheet.mjs inspect` report, copied into the motion by
 *  `sprite-project.mjs register-run`. This is the agent's cheap, deterministic
 *  diagnosis channel — it never needs a screenshot to learn a frame is empty. */
export interface InspectSummary {
  frameCount: number;
  cell: { width: number; height: number };
  /**
   * Where `align` put the anchor INSIDE that cell, in pixels — the same point
   * the atlas pivot names. With `--pad 8` on a 256px bottom-anchored cell it
   * is `{128, 248}`, not `{128, 256}`: the feet sit 8px above the cell floor.
   *
   * Absent when the frames carry no `align.json` for this anchor and cell
   * (aligned by something else, or before the pipeline recorded the point).
   * That absence is information — it is how "measured" is told apart from
   * "assumed the cell edge" — so it is an optional key, never a default.
   */
  anchorPoint?: { x: number; y: number };
  /**
   * The agent accepted the remaining warnings with a one-sentence reason
   * (round 2). The viewer dims the badge but keeps every number visible.
   */
  acknowledged?: { reason: string; at: number };
  /** Std-dev in px of the anchor point across frames — the *silhouette*. */
  anchorDrift: { x: number; y: number };
  /**
   * Std-dev in px of the feet-centre x across frames — the *body*, which is a
   * different claim from `anchorDrift`: a swinging prop moves the silhouette
   * without moving the character, and this is the number `align --x-from feet`
   * exists to keep near zero.
   *
   * Optional for the same reason `anchorPoint` is: a motion measured before
   * `inspect` reported it carries no value, and 0 would read as "the body is
   * perfectly still" — a fabricated measurement, not a missing one. Present
   * only when the report carried a finite number.
   */
  bodyDrift?: number;
  /**
   * Std-dev in px of the head-and-torso x across frames, each frame's top
   * band registered against the first frame's — a region no alignment pins.
   * `bodyDrift` is the spread of the very line `align --x-from feet` pins, so
   * it reads ~0 after that alignment whatever the body did; a walk whose
   * planted foot was pinned lurches by the stride, and this is the number
   * that shows it. Optional for `bodyDrift`'s reason.
   */
  headDrift?: number;
  /**
   * The same head-and-torso spread measured on the pre-align cells (the clip
   * as filmed, the grid as drawn) with its straight-line drift removed — the
   * sway the motion itself has. `headDrift` well past it is sway the
   * alignment added. Absent when the motion has no cells to measure.
   */
  sourceHeadDrift?: number;
  /**
   * Adjacent frames that barely differ — `[from, to]` pairs whose step (mean
   * RGBA difference at 64×64) is under 0.01: the animation holds there.
   * `[last, 0]` is the wrap of a looping motion. Absent on a report from
   * before the check existed; `[]` when it ran and found none.
   */
  nearDuplicates?: Array<[number, number]>;
  /**
   * Row boundaries of the source grid whose step jumps well past the steps
   * inside the rows — the sheet's rows drawn as separate sequences. Same
   * `[from, to]` pairs and the same absent-versus-empty rule.
   */
  rowJumps?: Array<[number, number]>;
  /** Largest anchor displacement between consecutive frames. */
  maxJump: number;
  /** (max bbox height − min bbox height) / mean. */
  scaleDrift: number;
  emptyFrames: number[];
  /** Human sentences, e.g. "frame 09 is empty". */
  warnings: string[];

  // ── Loop motions only (`kind: "loop"`) ──────────────────────────────────
  //
  // A loop is judged on whether it CLOSES, not on where its feet are, so it
  // measures three numbers the sheet pipeline never reports. All three are
  // optional for `bodyDrift`'s reason: 0 is a meaningful reading for each of
  // them (a perfect seam, a frozen motion, an empty frame), so a default of 0
  // would be indistinguishable from a measurement. Present only when the
  // report carried a finite number.

  /**
   * Distance from the last kept frame back to the first: the mean difference
   * of premultiplied RGBA thumbnails since `loop` measured colour (a blink
   * or a swapped leg at the wrap counts), silhouette distance before that.
   */
  seam?: number;
  /** Median frame-to-frame distance, in `seam`'s units — what it is judged against. */
  step?: number;
  /**
   * The bar `seam` was judged against by the run that measured it —
   * `max(2 × step, noise floor)`. Absent on a loop cut before `loop` recorded
   * it, and then the reader falls back to `2 × step`, the rule that run used.
   */
  seamLimit?: number;
  /**
   * How many in-between frames `loop --seam-fill` inserted at the wrap, after
   * which `seam` is the largest step across it. 0 means the loop closed on its
   * own — a real reading, not an absence — which is why this follows the same
   * finite-or-absent rule as its neighbours; absent means the report predates
   * the flag.
   */
  seamFill?: number;
  /** Fraction of the frame area that is opaque, averaged over the frames. */
  alphaCoverage?: number;
  /**
   * Share of the visible pixels (alpha at or above the threshold) that still
   * carry the chroma plate's hue — every keyed channel above every other by
   * more than 40 — pooled over the frames: the fringe a key left, or colour
   * the character really has. Measured by `from-video`, `loop`, `transition`,
   * `run` and `inspect` on a motion keyed off a hued plate; above 0.005 the
   * report warns. Absent when nothing was keyed or the plate had no hue
   * (white, cream, grey) — 0 is the best reading there is, so it follows the
   * finite-or-absent rule.
   */
  keyResidue?: number;
  /**
   * Transitions only: how far the first frame is from the `from` loop's
   * frame 0, and the last from the `to` loop's, as silhouette distance in
   * clip coordinates — the same units as `step`. At most 2 × `step` joins.
   */
  startGap?: number;
  endGap?: number;
  /**
   * A loop's rect in its clip, in clip pixels: the union box `loop` cut
   * every frame from. With `scale`, frame px = (clip px − crop.xy) × scale.
   * Absent on a loop cut before `loop` recorded it.
   */
  crop?: { x: number; y: number; w: number; h: number };
  /**
   * A loop's frame pixels per clip pixel. Each loop is cut to its own box
   * and scaled to one width, so the same character comes out at a different
   * scale in each; the `.riv` plan divides it back out. Absent when not
   * recorded — never a default of 1.
   */
  scale?: number;
}

/**
 * What a motion IS FOR. Absent means a sprite motion — an atlas for a game
 * engine, which is everything this mode made before loops existed.
 *
 * `"loop"` is a seamless transparent animation for a UI: every frame of one
 * closed cycle, unaligned, delivered as WebP / APNG / WebM / Lottie. It is a
 * different deliverable from the same character, not a different `source` —
 * `source` still says how the frames were obtained (`"video"` for a loop).
 */
export type MotionKind = "loop" | "transition";

/**
 * A transition's interview: how long it should PLAY (a 4 s take is retimed
 * to this) and the dollar ceiling for its take. Both answers, or none — the
 * paid clip is gated on it as a loop's is on `LoopBrief`.
 */
export interface TransitionBrief {
  duration: number;
  budgetUsd: number;
  recordedAt: string;
}

/**
 * The answers a loop's interview collected, before anything was paid for.
 *
 * A loop's first clip costs about a dollar and its size, its rate and its
 * wrap all follow from four decisions the user — not the agent — makes. They
 * are recorded here by `sprite-project.mjs set-motion --brief-…`, and the
 * scripts gate the paid call on their presence: a trial agent that skipped
 * the interview spent $2.61 on a 7.4s loop for a UI that wanted 3–4s, and no
 * amount of prose in the skill stopped it.
 *
 * `budgetUsd` is the one optional answer, because a user who named no ceiling
 * is a different state from one who named zero.
 */
export interface LoopBrief {
  /** Seconds of one cycle, as asked for. */
  duration: number;
  /** The width in px the UI renders the loop at — what `loop --width` gets. */
  width: number;
  /** Who invents the in-betweens; `"none"` is the clip's own rate, kept. */
  interpolator: "topaz" | "rife" | "ffmpeg" | "none";
  /** The ceiling the user set, in dollars. Absent when they set none. */
  budgetUsd?: number;
  /** ISO timestamp of the call that recorded it. */
  recordedAt: string;
}

/**
 * The formats `sprite-sheet.mjs export` writes for one motion, in the order
 * the Export tab lists them. The tuple is the single source of truth: the
 * type is derived from it, and the parser drops any key that is not in it.
 */
export const EXPORT_FORMATS = ["mp4", "mov", "webm", "apng", "lottie", "png-seq", "aseprite"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * A motion's exports, by format → asset id.
 *
 * A loop wrote `apng`, `webm` and `lottie` as part of its own pipeline
 * (`loop.apng`, `loop.webm`, `loop.json`, asset ids `<motion>-apng` …) — that
 * is the whole of what 0.3.x stored here, and it loads unchanged. Every other
 * entry is an on-demand export registered by `sprite-project.mjs
 * register-export` under the id `<motion>-export-<format>`. The WebP, GIF and
 * sheet stay in their own fields: they are made by every run, not exported.
 */
export type MotionExports = Partial<Record<ExportFormat, string>>;

/** The character-level exports, each asset id `<character>-export-<key>`:
 *  one `.riv` of the character's motions — loops resampled — and one
 *  Aseprite sheet of its sprite motions, a frame tag each. */
export interface CharacterExports {
  riv?: string;
  aseprite?: string;
}

/**
 * A loop's scale and place against its clip, as `sprite-sheet.mjs rive`
 * MEASURED them for a loop cut before `loop` recorded its own
 * (`inspect.crop` / `inspect.scale`, which win whenever they are there).
 * `register-export` writes it, so the Export tab quotes the same plan the
 * script follows, and a later export reuses it instead of decoding the clip
 * again. `register-run` drops it with the frames it measured.
 */
export interface LoopClip {
  /** Frame px per clip px. */
  scale: number;
  /** The frame's top-left in clip px; null when it could not be measured. */
  origin: { x: number; y: number } | null;
  from: "measured";
}

/**
 * How a motion's frames were obtained. Absent means `"sheet"` (round 2).
 *
 * `breathe` frames are warps of ONE still (`BreatheRecord`), made locally in
 * seconds; `mirror` frames are another motion's frames flipped left↔right
 * (`Motion.mirrorOf`). Neither was drawn frame by frame, which is why the
 * stage does not offer to realign them.
 */
export const MOTION_SOURCES = ["sheet", "video", "breathe", "mirror"] as const;

export type MotionSource = (typeof MOTION_SOURCES)[number];

/** What `sprite-sheet.mjs breathe` did, as `register-run` recorded it. */
export interface BreatheRecord {
  /** Asset id of the still the frames were warped from. */
  still: string;
  /** Vertical amplitude, a fraction of the figure's height. */
  depth: number;
  /** Horizontal amplitude when it differs from `depth`; 0 turns it off. */
  depthX?: number;
  /** Whole breaths in one loop of the motion. */
  breaths: number;
  /** How far the head trails the chest, as a fraction of a breath. */
  lag: number;
  /** Whole pixels (pixel art) or bilinear, premultiplied (painted art). */
  mode: "smooth" | "pixel";
  /**
   * The boundary the warp actually used, and whether it was detected or
   * given — what the agent needs to answer "the head wobbles" with
   * `--rigid-row` on the next run.
   */
  anatomy?: { rigidRow: number; axisX: number; from: "detected" | "override" };
}

/** A layout guide's geometry, as the prompt that used it described it. */
export interface PromptGuide {
  rows: number;
  cols: number;
  cell: { width: number; height: number };
  safeMargin: { x: number; y: number };
}

/**
 * How a motion's `prompt` was assembled when code built it
 * (`sprite-project.mjs sheet-prompt`). The same `builder` and parts give the
 * same text, which is what makes a guard or guide experiment reproducible.
 * Absent means the prompt was written by hand.
 */
export interface PromptParts {
  /** The code version that assembled the prompt, e.g. `"sheet-prompt/1"`. */
  builder: string;
  /** The agent's action / phase plan, verbatim. */
  action: string;
  /** Conditional clause ids included: `"state:walk"`, `"direction:left"`, `"row-continuity"`, … */
  guards: string[];
  guide?: PromptGuide;
}

export interface Motion {
  id: string;
  label: string;
  /** The sheet prompt actually sent. */
  prompt: string;
  /** Present when `prompt` was built by code; see `PromptParts`. */
  promptParts?: PromptParts;
  /** The direction this motion faces; its id is then `<state>-<direction>`. */
  direction?: Direction;
  /** Absent means a sprite motion; see `MotionKind`. */
  kind?: MotionKind;
  /** Loop and transition motions: the interview's answers, recorded before
   *  the paid clip — `LoopBrief` on a loop, `TransitionBrief` on a transition. */
  brief?: LoopBrief | TransitionBrief;
  /**
   * Transitions only: the loop it leaves and the loop it arrives at. Its
   * first frame is drawn from `from`'s frame 0 and its last lands on `to`'s,
   * in clip coordinates.
   */
  from?: string;
  to?: string;
  /** Transitions only: the transition whose frames this one plays backwards. */
  reverseOf?: string;
  grid: { rows: number; cols: number };
  fps: number;
  loop: boolean;
  anchor: "bottom" | "center";
  status: MotionStatus;
  /** Failure reason or agent remarks. */
  notes?: string;
  /** How the frames were obtained; absent means `"sheet"` (round 2). */
  source?: MotionSource;
  /** `source: "mirror"` only: the motion whose frames these flip. */
  mirrorOf?: string;
  /** `source: "breathe"` only: what the warp was made from and with. */
  breathe?: BreatheRecord;
  /** Loop motions: the generated keyframe, white plate, as it came back. */
  keyframe?: string;
  /** Loop motions: the same keyframe with its background removed. */
  keyframeAlpha?: string;
  sheetRaw?: string;
  sheetAlpha?: string;
  sheet?: string;
  atlas?: string;
  /** Asset ids in playback order. */
  frames: string[];
  gif?: string;
  webp?: string;
  /** Exports by format: a loop's own APNG / WebM / Lottie, and any format
   *  exported on demand. See `MotionExports`. */
  exports?: MotionExports;
  videos: MotionVideo[];
  inspect?: InspectSummary;
  /** Loop motions cut before `loop` recorded their crop: see `LoopClip`. */
  clip?: LoopClip;
}

export interface SpriteSidecar {
  version: 1;
  character: SpriteCharacter;
  refs: SpriteRef[];
  motions: Motion[];
  /** Absent until something was exported for the whole character. */
  exports?: CharacterExports;
}

// ── The loaded shape ───────────────────────────────────────────────────────

/**
 * One character's `project.json`, parsed. Unknown top-level fields survive in
 * `raw` so nothing the file carries is lost by round-tripping through the
 * viewer's type (the viewer never writes, but a future decomposer will).
 */
export interface CharacterProject {
  /** Directory prefix this project was found under; `""` for a root project. */
  contentSet: string;
  /** Craft title — the character name as craft sees it. */
  title: string;
  composition: SpriteComposition | null;
  assets: SpriteAsset[];
  provenance: SpriteProvenanceEdge[];
  sprite: SpriteSidecar;
  /** Every asset indexed by id — motions address assets by id, not by path. */
  assetsById: Map<string, SpriteAsset>;
}

/** The whole sprite workspace, keyed by content-set prefix. */
export interface Roster {
  byContentSet: Record<string, CharacterProject>;
}

export const CRAFT_PROJECT_SCHEMA = "pneuma-craft/project/v1";

// ── Parsing helpers (all total — they narrow, they never throw) ─────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseAsset(value: unknown): SpriteAsset | null {
  if (!isRecord(value)) return null;
  const id = optionalStr(value.id);
  if (!id) return null;
  const type = value.type;
  return {
    id,
    type: type === "video" || type === "text" ? type : "image",
    uri: str(value.uri),
    name: str(value.name, id),
    metadata: isRecord(value.metadata)
      ? (value.metadata as SpriteAsset["metadata"])
      : {},
    createdAt: num(value.createdAt, 0),
    ...(optionalStr(value.status)
      ? { status: value.status as SpriteAssetStatus }
      : {}),
    ...(Array.isArray(value.tags)
      ? { tags: value.tags.filter((t): t is string => typeof t === "string") }
      : {}),
  };
}

function parseEdge(value: unknown): SpriteProvenanceEdge | null {
  if (!isRecord(value)) return null;
  const toAssetId = optionalStr(value.toAssetId);
  if (!toAssetId) return null;
  const op = isRecord(value.operation) ? value.operation : {};
  return {
    toAssetId,
    fromAssetId: optionalStr(value.fromAssetId) ?? null,
    operation: {
      type: (op.type as SpriteProvenanceEdge["operation"]["type"]) ?? "derive",
      actor: op.actor === "human" ? "human" : "agent",
      ...(isRecord(op.params)
        ? { params: op.params as Record<string, unknown> }
        : {}),
      ...(optionalStr(op.label) ? { label: op.label as string } : {}),
      timestamp: num(op.timestamp, 0),
    },
  };
}

/**
 * A `{ x, y }` in pixels, or undefined for anything else.
 *
 * Unlike every other number in this file the anchor point has no safe
 * fallback: a half-written or hand-edited point silently defaulted to 0 would
 * put the pivot guide in the top-left corner and look like a measurement.
 * Both coordinates finite, or the point is simply not there.
 */
function parsePoint(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function parseAcknowledged(value: unknown): { reason: string; at: number } | undefined {
  if (!isRecord(value)) return undefined;
  const reason = value.reason;
  const at = value.at;
  if (typeof reason !== "string" || reason.trim() === "" || typeof at !== "number" || !Number.isFinite(at)) return undefined;
  return { reason, at };
}

/**
 * A finite number, or undefined for anything else.
 *
 * The optional inspect numbers share `anchorPoint`'s problem: `num(v, 0)`
 * would turn a missing or malformed `bodyDrift` into a confident 0 — "the body
 * never moves" — which is the one answer indistinguishable from a perfect
 * measurement. Absent is a state the viewer renders correctly; 0 is a lie.
 */
function parseFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A list of `[from, to]` frame pairs, or undefined when the key is not an
 * array at all. A malformed entry is dropped rather than the whole list, and
 * an empty list survives: "checked, found none" is not "never checked".
 */
function parseFramePairs(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const frameIndex = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return value
    .filter((pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && frameIndex(pair[0]) && frameIndex(pair[1]))
    .map(([from, to]) => [from, to] as [number, number]);
}

function parseInspect(value: unknown): InspectSummary | undefined {
  if (!isRecord(value)) return undefined;
  const cell = isRecord(value.cell) ? value.cell : {};
  const drift = isRecord(value.anchorDrift) ? value.anchorDrift : {};
  const anchorPoint = parsePoint(value.anchorPoint);
  const acknowledged = parseAcknowledged(value.acknowledged);
  const bodyDrift = parseFinite(value.bodyDrift);
  const headDrift = parseFinite(value.headDrift);
  const sourceHeadDrift = parseFinite(value.sourceHeadDrift);
  const nearDuplicates = parseFramePairs(value.nearDuplicates);
  const rowJumps = parseFramePairs(value.rowJumps);
  const seam = parseFinite(value.seam);
  const step = parseFinite(value.step);
  const seamLimit = parseFinite(value.seamLimit);
  const seamFill = parseFinite(value.seamFill);
  const alphaCoverage = parseFinite(value.alphaCoverage);
  const keyResidue = parseFinite(value.keyResidue);
  const startGap = parseFinite(value.startGap);
  const endGap = parseFinite(value.endGap);
  const crop = parseClipRect(value.crop);
  const scale = parseFinite(value.scale);
  return {
    frameCount: num(value.frameCount, 0),
    cell: { width: num(cell.width, 0), height: num(cell.height, 0) },
    ...(anchorPoint ? { anchorPoint } : {}),
    ...(acknowledged ? { acknowledged } : {}),
    anchorDrift: { x: num(drift.x, 0), y: num(drift.y, 0) },
    // `=== undefined`, never a truthiness test: 0 is the *good* body drift and
    // must survive the trip.
    ...(bodyDrift === undefined ? {} : { bodyDrift }),
    ...(headDrift === undefined ? {} : { headDrift }),
    ...(sourceHeadDrift === undefined ? {} : { sourceHeadDrift }),
    ...(nearDuplicates ? { nearDuplicates } : {}),
    ...(rowJumps ? { rowJumps } : {}),
    maxJump: num(value.maxJump, 0),
    scaleDrift: num(value.scaleDrift, 0),
    emptyFrames: arr(value.emptyFrames).filter(
      (n): n is number => typeof n === "number",
    ),
    warnings: arr(value.warnings).filter(
      (w): w is string => typeof w === "string",
    ),
    // Same `=== undefined` rule as `bodyDrift`, for the same reason: a seam of
    // 0 is a loop that closes perfectly, and dropping it would hide the best
    // result the pipeline can report.
    ...(seam === undefined ? {} : { seam }),
    ...(step === undefined ? {} : { step }),
    ...(seamLimit === undefined ? {} : { seamLimit }),
    ...(seamFill === undefined ? {} : { seamFill }),
    ...(alphaCoverage === undefined ? {} : { alphaCoverage }),
    ...(keyResidue === undefined ? {} : { keyResidue }),
    ...(startGap === undefined ? {} : { startGap }),
    ...(endGap === undefined ? {} : { endGap }),
    ...(crop ? { crop } : {}),
    ...(scale !== undefined && scale > 0 ? { scale } : {}),
  };
}

/** A whole rect with a real size, or undefined — never half of one. */
function parseClipRect(value: unknown): InspectSummary["crop"] {
  if (!isRecord(value)) return undefined;
  const [x, y, w, h] = [value.x, value.y, value.w, value.h].map(parseFinite);
  return x !== undefined && y !== undefined && w !== undefined && h !== undefined && w > 0 && h > 0
    ? { x, y, w, h }
    : undefined;
}

/**
 * A status the loader does not recognise is not a status: the stage renders a
 * chip per status and reads `ready` as "this motion is done". Letting an
 * unknown string through as if it were one of ours puts an unrenderable chip
 * on the rail and can make a half-built motion read as finished, so an
 * unknown value falls back to the safest one.
 */
function parseMotionStatus(value: unknown): MotionStatus {
  const status = optionalStr(value);
  return status && (MOTION_STATUSES as readonly string[]).includes(status)
    ? (status as MotionStatus)
    : "planned";
}

/** The exports block, with only the ids that are really there, under a format
 *  that really exists. An empty block is no block: `exports: {}` would make
 *  `motion.exports` truthy for a motion that exported nothing. */
function parseExports(value: unknown): MotionExports | undefined {
  if (!isRecord(value)) return undefined;
  const exports: MotionExports = {};
  for (const format of EXPORT_FORMATS) {
    const id = optionalStr(value[format]);
    if (id) exports[format] = id;
  }
  return Object.keys(exports).length > 0 ? exports : undefined;
}

/** The character's exports block, by the same rule. */
function parseCharacterExports(value: unknown): CharacterExports | undefined {
  if (!isRecord(value)) return undefined;
  const riv = optionalStr(value.riv);
  const aseprite = optionalStr(value.aseprite);
  const exports: CharacterExports = { ...(riv ? { riv } : {}), ...(aseprite ? { aseprite } : {}) };
  return Object.keys(exports).length > 0 ? exports : undefined;
}

const VIDEO_MODELS: readonly VideoModel[] = [
  "seedance-2.5",
  "h3-max",
  "veed",
  "veed-gs",
  "bria",
  "topaz",
  "rife",
  "ffmpeg",
];

const LOOP_INTERPOLATORS: readonly LoopBrief["interpolator"][] = [
  "topaz",
  "rife",
  "ffmpeg",
  "none",
];

/**
 * The brief, or nothing — never a half of one.
 *
 * Every other optional field here is parsed field by field, so a broken one
 * costs its own value. The brief cannot be: it is what the scripts refuse a
 * paid clip without, so a record missing its width would open that gate while
 * answering none of the question it stands for. All four required answers
 * present and usable, or the motion has no brief.
 */
function parseLoopBrief(value: unknown): LoopBrief | undefined {
  if (!isRecord(value)) return undefined;
  const duration = parseFinite(value.duration);
  const width = parseFinite(value.width);
  const recordedAt = optionalStr(value.recordedAt);
  const interpolator = LOOP_INTERPOLATORS.includes(
    value.interpolator as LoopBrief["interpolator"],
  )
    ? (value.interpolator as LoopBrief["interpolator"])
    : undefined;
  if (duration === undefined || duration <= 0) return undefined;
  if (width === undefined || width <= 0) return undefined;
  if (!interpolator || !recordedAt) return undefined;
  const budgetUsd = parseFinite(value.budgetUsd);
  return {
    duration,
    width,
    interpolator,
    ...(budgetUsd === undefined || budgetUsd < 0 ? {} : { budgetUsd }),
    recordedAt,
  };
}

const VIDEO_MODES: readonly VideoMode[] = ["i2v", "first-last", "r2v", "derived"];

/** A whole measured record or nothing: a scale without its provenance, or an
 *  origin missing a coordinate, is not a measurement anyone made. */
function parseLoopClip(value: unknown): LoopClip | undefined {
  if (!isRecord(value) || value.from !== "measured") return undefined;
  const scale = parseFinite(value.scale);
  if (scale === undefined || scale <= 0) return undefined;
  if (value.origin === null || value.origin === undefined) return { scale, origin: null, from: "measured" };
  if (!isRecord(value.origin)) return undefined;
  const x = parseFinite(value.origin.x);
  const y = parseFinite(value.origin.y);
  if (x === undefined || y === undefined) return undefined;
  return { scale, origin: { x, y }, from: "measured" };
}

/** Both answers of a transition's interview, or no brief. */
function parseTransitionBrief(value: unknown): TransitionBrief | undefined {
  if (!isRecord(value)) return undefined;
  const duration = parseFinite(value.duration);
  const budgetUsd = parseFinite(value.budgetUsd);
  const recordedAt = optionalStr(value.recordedAt);
  if (duration === undefined || duration <= 0) return undefined;
  if (budgetUsd === undefined || budgetUsd < 0 || !recordedAt) return undefined;
  return { duration, budgetUsd, recordedAt };
}

// ── 0.5.0 sidecar additions ────────────────────────────────────────────────
//
// Every one of them is optional and absent in a 0.4.x file, so nothing below
// may add a key to a record that did not carry one: an older project must
// parse to exactly what it parsed to before. A value the loader does not
// recognise is not a value — it is dropped, never defaulted.

/** A member of one of this file's tuples, or undefined for anything else. */
function member<T extends string>(tuple: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (tuple as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A whole number above zero, or undefined. */
function positiveInteger(value: unknown): number | undefined {
  const n = parseFinite(value);
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A non-blank sentence, or undefined. */
function sentence(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The pixel spec, or nothing. Its height is the answer every pixel run snaps
 * to, so a spec without one is no spec; the palette and its size are each
 * dropped on their own when malformed, the way a brief's budget is.
 */
function parsePixel(value: unknown): PixelSpec | undefined {
  if (!isRecord(value)) return undefined;
  const logicalHeight = positiveInteger(value.logicalHeight);
  if (logicalHeight === undefined) return undefined;
  const palette = optionalStr(value.palette);
  const colors = positiveInteger(value.colors);
  return {
    logicalHeight,
    ...(palette ? { palette } : {}),
    ...(colors === undefined ? {} : { colors }),
  };
}

/** The anatomy a breathe used, whole, or undefined. */
function parseAnatomy(value: unknown): BreatheRecord["anatomy"] {
  if (!isRecord(value)) return undefined;
  const rigidRow = parseFinite(value.rigidRow);
  const axisX = parseFinite(value.axisX);
  const from = value.from === "detected" || value.from === "override" ? value.from : undefined;
  return rigidRow !== undefined && axisX !== undefined && from ? { rigidRow, axisX, from } : undefined;
}

/**
 * The breathe record, or nothing — never half of one, like the brief. A
 * record missing its still cannot say what the frames were warped from, and
 * one missing a parameter cannot be re-run with one of them changed, which
 * is the whole of what it is kept for.
 */
function parseBreathe(value: unknown): BreatheRecord | undefined {
  if (!isRecord(value)) return undefined;
  const still = optionalStr(value.still);
  const depth = parseFinite(value.depth);
  const breaths = positiveInteger(value.breaths);
  const lag = parseFinite(value.lag);
  const mode = value.mode === "smooth" || value.mode === "pixel" ? value.mode : undefined;
  if (!still || depth === undefined || depth < 0 || breaths === undefined || lag === undefined || !mode) {
    return undefined;
  }
  const depthX = parseFinite(value.depthX);
  const anatomy = parseAnatomy(value.anatomy);
  return {
    still,
    depth,
    ...(depthX === undefined || depthX < 0 ? {} : { depthX }),
    breaths,
    lag,
    mode,
    ...(anatomy ? { anatomy } : {}),
  };
}

/** A layout guide's geometry, whole, or undefined. */
function parsePromptGuide(value: unknown): PromptGuide | undefined {
  if (!isRecord(value) || !isRecord(value.cell) || !isRecord(value.safeMargin)) return undefined;
  const rows = positiveInteger(value.rows);
  const cols = positiveInteger(value.cols);
  const width = positiveInteger(value.cell.width);
  const height = positiveInteger(value.cell.height);
  const x = parseFinite(value.safeMargin.x);
  const y = parseFinite(value.safeMargin.y);
  if (rows === undefined || cols === undefined || width === undefined || height === undefined) return undefined;
  if (x === undefined || x < 0 || y === undefined || y < 0) return undefined;
  return { rows, cols, cell: { width, height }, safeMargin: { x, y } };
}

/**
 * The recorded prompt parts, or nothing. A builder version without its
 * action, or guards that are not all clause ids, cannot rebuild the text they
 * claim to describe; the guide is optional and dropped on its own.
 */
function parsePromptParts(value: unknown): PromptParts | undefined {
  if (!isRecord(value)) return undefined;
  const builder = sentence(value.builder);
  const action = sentence(value.action);
  if (!builder || !action || !Array.isArray(value.guards)) return undefined;
  if (!value.guards.every((g): g is string => typeof g === "string")) return undefined;
  const guide = parsePromptGuide(value.guide);
  return { builder, action, guards: [...value.guards], ...(guide ? { guide } : {}) };
}

function parseMotion(value: unknown): Motion | null {
  if (!isRecord(value)) return null;
  const id = optionalStr(value.id);
  if (!id) return null;
  const grid = isRecord(value.grid) ? value.grid : {};
  const inspect = parseInspect(value.inspect);
  const exports = parseExports(value.exports);
  // Loop-only, like `keyframe` and `exports`: a brief describes a duration, a
  // UI width and an interpolator, and a sheet motion has none of those to
  // answer for. It is dropped rather than carried into a panel that would
  // have nowhere to put it.
  // A transition names both loops it joins, or it joins nothing and loads as
  // the sprite motion every unrecognised kind falls back to.
  const from = optionalStr(value.from);
  const to = optionalStr(value.to);
  const kind: MotionKind | undefined = value.kind === "loop"
    ? "loop"
    : value.kind === "transition" && from && to ? "transition" : undefined;
  const brief = kind === "loop"
    ? parseLoopBrief(value.brief)
    : kind === "transition" ? parseTransitionBrief(value.brief) : undefined;
  const clip = kind === "loop" ? parseLoopClip(value.clip) : undefined;
  const reverseOf = kind === "transition" ? optionalStr(value.reverseOf) : undefined;
  // Each source's own record travels only with that source, the way a brief
  // travels only with a loop: a `mirrorOf` on a sheet motion or a breathe
  // record on a video one describes frames this motion does not have.
  const source = member(MOTION_SOURCES, value.source);
  const mirrorOf = source === "mirror" ? optionalStr(value.mirrorOf) : undefined;
  const breathe = source === "breathe" ? parseBreathe(value.breathe) : undefined;
  const direction = member(DIRECTIONS, value.direction);
  const promptParts = parsePromptParts(value.promptParts);
  return {
    id,
    label: str(value.label, id),
    prompt: str(value.prompt),
    ...(promptParts ? { promptParts } : {}),
    ...(direction ? { direction } : {}),
    // An unrecognised kind is not a kind: the panel opens a different first
    // tab and the stage drops its pivot guide on the strength of this word,
    // so anything that is not "loop" reads as the sprite motion it was
    // before loops existed.
    ...(kind ? { kind } : {}),
    ...(brief ? { brief } : {}),
    ...(kind === "transition" ? { from, to } : {}),
    ...(reverseOf ? { reverseOf } : {}),
    grid: { rows: num(grid.rows, 1), cols: num(grid.cols, 1) },
    fps: num(value.fps, 8),
    loop: value.loop !== false,
    anchor: value.anchor === "center" ? "center" : "bottom",
    status: parseMotionStatus(value.status),
    ...(optionalStr(value.notes) ? { notes: value.notes as string } : {}),
    ...(source ? { source } : {}),
    ...(mirrorOf ? { mirrorOf } : {}),
    ...(breathe ? { breathe } : {}),
    ...(optionalStr(value.keyframe)
      ? { keyframe: value.keyframe as string }
      : {}),
    ...(optionalStr(value.keyframeAlpha)
      ? { keyframeAlpha: value.keyframeAlpha as string }
      : {}),
    ...(optionalStr(value.sheetRaw)
      ? { sheetRaw: value.sheetRaw as string }
      : {}),
    ...(optionalStr(value.sheetAlpha)
      ? { sheetAlpha: value.sheetAlpha as string }
      : {}),
    ...(optionalStr(value.sheet) ? { sheet: value.sheet as string } : {}),
    ...(optionalStr(value.atlas) ? { atlas: value.atlas as string } : {}),
    frames: arr(value.frames).filter((f): f is string => typeof f === "string"),
    ...(optionalStr(value.gif) ? { gif: value.gif as string } : {}),
    ...(optionalStr(value.webp) ? { webp: value.webp as string } : {}),
    ...(exports ? { exports } : {}),
    videos: arr(value.videos)
      .map((v): MotionVideo | null => {
        if (!isRecord(v)) return null;
        const vid = optionalStr(v.id);
        if (!vid) return null;
        const derivedFrom = optionalStr(v.derivedFrom);
        return {
          id: vid,
          asset: str(v.asset),
          // An unknown model falls back to the one every clip of this mode
          // started as, rather than travelling as a name nothing can render.
          model: VIDEO_MODELS.includes(v.model as VideoModel)
            ? (v.model as VideoModel)
            : "seedance-2.5",
          mode: VIDEO_MODES.includes(v.mode as VideoMode)
            ? (v.mode as VideoMode)
            : "i2v",
          prompt: str(v.prompt),
          status:
            v.status === "ready" || v.status === "failed"
              ? (v.status as MotionVideo["status"])
              : "generating",
          ...(derivedFrom ? { derivedFrom } : {}),
          ...(v.op === "matte" || v.op === "interpolate" || v.op === "retime"
            ? { op: v.op as MotionVideo["op"] }
            : {}),
        };
      })
      .filter((v): v is MotionVideo => v !== null),
    ...(inspect ? { inspect } : {}),
    ...(clip ? { clip } : {}),
  };
}

function parseSidecar(value: unknown): SpriteSidecar | null {
  if (!isRecord(value)) return null;
  const character = isRecord(value.character) ? value.character : null;
  if (!character) return null;
  const cell = isRecord(character.cell) ? character.cell : {};
  const facing = character.facing;
  const exports = parseCharacterExports(value.exports);
  const purpose = member(CHARACTER_PURPOSES, character.purpose);
  const pixel = parsePixel(character.pixel);
  const asymmetric = sentence(character.asymmetric);
  return {
    version: 1,
    character: {
      name: str(character.name, "Untitled"),
      description: str(character.description),
      style: str(character.style),
      cell: { width: num(cell.width, 256), height: num(cell.height, 256) },
      ...(facing === "left" || facing === "right" ? { facing } : {}),
      ...(purpose ? { purpose } : {}),
      ...(pixel ? { pixel } : {}),
      ...(asymmetric ? { asymmetric } : {}),
    },
    refs: arr(value.refs)
      .map((r): SpriteRef | null => {
        if (!isRecord(r)) return null;
        const id = optionalStr(r.id);
        if (!id) return null;
        // An anchor IS its direction — one pose, facing one way — so one
        // without a usable direction is just a picture: it loads as custom,
        // and no other role carries a direction at all.
        const direction = member(DIRECTIONS, r.direction);
        const named = member(
          ["turnaround", "portrait", "expression", "custom"] as const,
          r.role,
        );
        const role: SpriteRefRole =
          r.role === "anchor" && direction ? "anchor" : named ?? "custom";
        return {
          id,
          asset: str(r.asset, `ref-${id}`),
          role,
          label: str(r.label, id),
          ...(role === "anchor" ? { direction } : {}),
        };
      })
      .filter((r): r is SpriteRef => r !== null),
    // Declared order IS playback / rail order — never sort here.
    motions: arr(value.motions)
      .map(parseMotion)
      .filter((m): m is Motion => m !== null),
    ...(exports ? { exports } : {}),
  };
}

function parseComposition(value: unknown): SpriteComposition | null {
  if (!isRecord(value)) return null;
  const settings = isRecord(value.settings) ? value.settings : {};
  return {
    settings: {
      width: num(settings.width, 0),
      height: num(settings.height, 0),
      fps: num(settings.fps, 8),
      aspectRatio: str(settings.aspectRatio, "1:1"),
    },
    tracks: arr(value.tracks),
    transitions: arr(value.transitions),
  };
}

/**
 * Parse one `project.json` body. Returns null for anything that is not a
 * craft project file carrying a sprite sidecar — the caller skips it.
 */
function parseCharacterProject(
  contentSet: string,
  raw: string,
): CharacterProject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Half-written file, or a `project.json` that belongs to something else.
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.$schema !== CRAFT_PROJECT_SCHEMA) return null;

  const sprite = parseSidecar(parsed.sprite);
  if (!sprite) return null;

  const assets = arr(parsed.assets)
    .map(parseAsset)
    .filter((a): a is SpriteAsset => a !== null);

  const assetsById = new Map<string, SpriteAsset>();
  for (const asset of assets) assetsById.set(asset.id, asset);

  return {
    contentSet,
    title: str(parsed.title, sprite.character.name),
    composition: parseComposition(parsed.composition),
    assets,
    provenance: arr(parsed.provenance)
      .map(parseEdge)
      .filter((e): e is SpriteProvenanceEdge => e !== null),
    sprite,
    assetsById,
  };
}

// ── loadRoster ─────────────────────────────────────────────────────────────

/**
 * Build a Roster from the raw file snapshot. Every `project.json` at any depth
 * becomes one entry keyed by its directory prefix (`""` for a root-level file).
 * Returns null when nothing parsed — the source stays in "no initial value"
 * state and a later file change can still produce a valid Roster.
 *
 * Image entries in the snapshot arrive with empty content (they are change
 * signals only); they are simply not `project.json` and fall through.
 */
export function loadRoster(
  files: ReadonlyArray<ViewerFileContent>,
): Roster | null {
  const byContentSet: Record<string, CharacterProject> = {};

  for (const file of files) {
    if (file.path !== "project.json" && !file.path.endsWith("/project.json")) {
      continue;
    }
    const prefix =
      file.path === "project.json"
        ? ""
        : file.path.slice(0, -"/project.json".length);
    const project = parseCharacterProject(prefix, file.content);
    if (project) byContentSet[prefix] = project;
  }

  if (Object.keys(byContentSet).length === 0) return null;
  return { byContentSet };
}

// ── saveRoster ─────────────────────────────────────────────────────────────

export function saveRoster(
  _next: Roster,
  _current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  throw new Error("sprite viewer is read-only; editing not yet supported");
}

// ── Helpers the viewer and extractContext share ────────────────────────────

/**
 * Resolve an asset id to its character-relative uri. Returns undefined for an
 * id the project does not carry — a motion that names a frame asset which was
 * pruned is a real state (mid-`register-run`), not an error.
 */
export function resolveAssetUri(
  project: CharacterProject,
  assetId: string,
): string | undefined {
  const uri = project.assetsById.get(assetId)?.uri;
  return uri && uri.length > 0 ? uri : undefined;
}

/** Find a motion by id inside a character. */
export function findMotion(
  project: CharacterProject,
  motionId: string,
): Motion | undefined {
  return project.sprite.motions.find((m) => m.id === motionId);
}

/** A measured anchor point, and the cell it was measured in. */
export interface MeasuredAnchor {
  /** The point inside the cell, in cell pixels. */
  point: { x: number; y: number };
  /** The cell `inspect` measured it in. */
  cell: { width: number; height: number };
}

/**
 * The anchor point the pipeline measured for this motion, or undefined when it
 * measured none.
 *
 * The point is only meaningful together with the cell it was taken in, so the
 * two travel as one value — a caller comparing that cell against the picture
 * actually on screen is the whole reason this is not just a field read. Both
 * consumers of the measurement (the stage's pivot guide, the Atlas tab's
 * printed pivot) come through here so they can never disagree about whether
 * one exists.
 */
export function measuredAnchor(motion: Motion): MeasuredAnchor | undefined {
  const inspect = motion.inspect;
  const point = inspect?.anchorPoint;
  if (!inspect || !point) return undefined;
  // A cell of zero is what the parser leaves when `inspect.cell` was missing;
  // nothing can be normalized or matched against it.
  if (!(inspect.cell.width > 0) || !(inspect.cell.height > 0)) return undefined;
  return { point, cell: inspect.cell };
}

/** Find a reference by id inside a character. */
export function findRef(
  project: CharacterProject,
  refId: string,
): SpriteRef | undefined {
  return project.sprite.refs.find((r) => r.id === refId);
}

/**
 * A fresh `project.json` body for a new character directory.
 *
 * This is the SAME skeleton `scripts/sprite-project.mjs init` writes, kept
 * here as a pure function so `createEmpty` (viewer "new character") and the
 * script agree by construction rather than by a comment asking them to.
 * `modes/sprite/__tests__/domain.test.ts` pins the shape both sides depend on.
 */
export function createCharacterProjectFile(options: {
  name: string;
  description?: string;
  style?: string;
  cell?: { width: number; height: number };
  facing?: "left" | "right";
}): string {
  const cell = options.cell ?? { width: 256, height: 256 };
  const body = {
    $schema: CRAFT_PROJECT_SCHEMA,
    title: options.name,
    composition: {
      settings: {
        width: cell.width,
        height: cell.height,
        fps: 8,
        aspectRatio: "1:1",
      },
      tracks: [],
      transitions: [],
    },
    assets: [],
    provenance: [],
    sprite: {
      version: 1,
      character: {
        name: options.name,
        description: options.description ?? "",
        style: options.style ?? "",
        cell,
        ...(options.facing ? { facing: options.facing } : {}),
      },
      refs: [],
      motions: [],
    },
  };
  return JSON.stringify(body, null, 2) + "\n";
}
