/**
 * Every word the sprite viewer says, in every language it says it in.
 *
 * The mode description, the agent and the seed templates all speak the user's
 * language; the stage did not, and a tester watching a Chinese agent fill an
 * English UI called the mix jarring enough to log. So the viewer's copy lives
 * here, keyed by `props.locale`, and the components take a `SpriteStrings`
 * rather than holding literals — `modes/sprite/__tests__/viewer-logic.test.ts`
 * scans the TSX and fails on any visible literal that did not come through
 * this table.
 *
 * Three kinds of text are deliberately NOT in here:
 *
 * - CONTENT the agent wrote (motion labels, prompts, notes, inspect warnings,
 *   the acknowledgement reason). It is already in the user's language because
 *   the agent is; translating it would mean rewriting the pipeline's own
 *   sentences, and a mistranslated warning is worse than an English one.
 * - PROPER NOUNS: `GIF`, `Seedance 2.5`, `i2v`, `atlas.json`, `preview.gif`.
 *   A file name that is translated cannot be found on disk.
 * - The English command hints, which come from `manifest.viewerApi.commands`
 *   so that English has ONE source. `commandHint` covers the other locales
 *   and returns null where the manifest is already right.
 */

import type {
  GeneratedVideoMode,
  GeneratedVideoModel,
  Motion,
  MotionStatus,
  MotionVideo,
} from "../domain.js";
import type { AtlasNote } from "./atlas.js";
import type { LoopLine, SizeLine } from "./metrics.js";
import type {
  ExportFamily,
  ExportNotOffered,
  ExportRepeat,
  ExportRowFormat,
  LoopFormat,
  PanelTab,
} from "./panel.js";
import type { RiveFailureStage } from "./rive-preview.js";

export type SpriteLocale = "en" | "zh-CN";

export interface SpriteStrings {
  // ── Shell / header ──────────────────────────────────────────────────────
  railShow: string;
  railHide: string;
  noCharacterTitle: string;
  noCharacterBody: string;
  /** `declared 256 · measured 186×252 · packed ×0.5` */
  sizeLine: (line: SizeLine) => string;
  facing: (direction: "left" | "right") => string;
  refCount: (count: number) => string;
  motionCount: (count: number) => string;
  /** The header's count of transitions, beside the motions. */
  transitionCount: (count: number) => string;
  /** The header's word for a motion sampled out of a video clip. */
  fromVideo: string;
  /** The rail's chip for the same thing. */
  videoSource: string;
  videoSourceTitle: string;
  /** The rail's chip for a motion whose deliverable is a seamless UI loop. */
  loopSource: string;
  loopSourceTitle: string;
  /** The rail's chip for a clip between two loops. */
  transitionChip: string;
  transitionChipTitle: string;
  /** A transition made by playing another one backwards. */
  reverseTitle: (source: string) => string;
  /** A loop's header phrase: measured size · frames @ fps. */
  loopLine: (line: LoopLine) => string;
  renderingVideo: string;
  renderingVideoTitle: (motions: string[]) => string;
  showingReference: string;
  backToMotion: (label: string) => string;

  // ── Selection reported to the agent ──────────────────────────────────────
  selectionFrame: (motionLabel: string, frame: string) => string;
  selectionMotion: (motionLabel: string, status: MotionStatus) => string;

  // ── Stage ───────────────────────────────────────────────────────────────
  stageBackground: string;
  background: Record<"checker" | "dark" | "light", string>;
  zoom: string;
  zoomOption: Record<"fit" | "1x" | "2x", string>;
  onionTitle: string;
  pivotMeasured: (anchor: "bottom" | "center") => string;
  pivotAssumed: (anchor: "bottom" | "center") => string;
  anchor: Record<"bottom" | "center", string>;
  referenceTag: string;
  pickAMotion: string;
  drawingSheet: string;
  slicingAligning: string;
  motionFailed: string;
  plannedNoSheet: string;
  sheetPreview: string;
  sheetPreviewTitle: (keyed: boolean, cols: number, rows: number) => string;
  /** The stage chip while a loop has only its keyframe. */
  keyframePreview: string;
  keyframePreviewTitle: (keyed: boolean) => string;
  /** Why the pivot toggle is off for a loop. */
  pivotNoneForLoop: string;
  framesMissing: (count: number) => string;
  decoding: string;

  // ── Transport ───────────────────────────────────────────────────────────
  play: string;
  pause: string;
  previousFrame: string;
  nextFrame: string;
  playbackFps: string;
  slower: string;
  faster: string;
  fps: (value: number) => string;
  looping: string;
  playsOnce: string;
  loopShort: string;
  onceShort: string;
  storedPlayback: (fps: number, loop: boolean) => string;
  storedPlaybackTitle: string;
  framesList: string;
  /** The strip is showing a sample of a long motion, not every frame. */
  stripSampled: (shown: number, total: number) => string;
  stripSampledTitle: string;
  noFramesYet: string;
  frameTitle: (frame: string) => string;
  noAsset: string;

  // ── Rail ────────────────────────────────────────────────────────────────
  references: string;
  motions: string;
  /** The rail's second list: the clips between loops. */
  transitions: string;
  noReferences: string;
  noMotions: string;
  referenceTitle: (label: string, role: string) => string;
  refRole: Record<"turnaround" | "portrait" | "expression" | "custom", string>;
  missingAsset: string;
  /** The rail's second line. `cols`/`rows` are null for a loop: a loop has no
   *  grid, and the 1×1 `register-run` records is a placeholder, not a fact
   *  about the animation. */
  motionMeta: (m: {
    cols: number | null;
    rows: number | null;
    frames: number;
    fps: number;
    loop: boolean;
  }) => string;
  status: Record<MotionStatus, string>;
  acknowledgedTitle: (reason: string) => string;

  // ── Preview panel ───────────────────────────────────────────────────────
  tab: Record<PanelTab, string>;
  selectMotionForPanel: string;
  noPreviewYet: string;
  previewMeta: (m: { fps: number; loop: boolean; frames: number }) => string;
  noVideoYet: (renderCommand: string) => string;
  videoStatus: Record<"generating" | "ready" | "failed", string>;
  renderFailed: string;
  clipFileMissing: string;
  downloadClip: string;
  noAtlasYet: string;
  /** A loop has no atlas, and that is a fact about the deliverable rather
   *  than a step nobody has run yet. Before the run there is nothing to count,
   *  and the sentence says only the part it knows. */
  noAtlasForLoop: (m: { frames: number; width: number; height: number }) => string;
  atlasNote: (note: AtlasNote) => string;
  noLoopYet: string;
  /** frames · fps · duration · does it close · what it cost to close it.
   *  `seamFill` is the in-between frames `loop --seam-fill` inserted at the
   *  wrap; 0 and null both say nothing, because a flag that did not fire is
   *  not news. */
  loopMeta: (m: {
    frames: number;
    fps: number;
    duration: number | null;
    seam: "closes" | "open" | null;
    seamFill: number | null;
  }) => string;
  /** File formats are proper nouns; only the row they sit in is copy. */
  exportLabel: Record<LoopFormat, string>;
  exportLink: (label: string, size: string | null) => string;

  // ── Export tab ──────────────────────────────────────────────────────────
  exportFamily: Record<ExportFamily, string>;
  /** The row's name. Formats are proper nouns; "PNG sequence" is not. */
  exportFormatName: Record<ExportRowFormat, string>;
  /** One line on what the format is for, in the user's words. `motions` is
   *  the count a `.riv` holds; the other formats ignore it. */
  exportPurpose: (format: ExportRowFormat, m: { motions: number; transitions?: number }) => string;
  exportNotOffered: Record<ExportNotOffered, string>;
  /** How many times a video plays and for how long — stated before it is
   *  made, because the default depends on whether the motion loops. */
  exportRepeat: (video: ExportRepeat, loop: boolean) => string;
  /** The ready `.riv` lacks motions that became ready after it was made. */
  exportRiveMissing: (motions: string[]) => string;
  /** On a transition's own tab: it is not a file of its own in Rive — it is
   *  part of the character's, which holds `count` of them. */
  exportRiveTransition: (count: number) => string;
  /** The memory the runtime decodes the `.riv` into when it opens. */
  exportRiveMemory: (size: string) => string;
  /** The rate and the largest size the loops in the `.riv` play at. */
  exportRiveLoops: (m: { fps: number; width: number; height: number }) => string;
  /** The colour a made MP4 was flattened onto. */
  exportOnBackground: (hex: string) => string;
  exportBackground: string;
  exportBackgroundField: string;
  exportColorInvalid: string;
  exportBuiltInTitle: string;
  exportGenerate: string;
  exportRegenerate: string;
  exportRequested: string;
  exportUpdating: string;
  exportAskAgain: string;
  exportNothingReady: string;

  // ── Rive preview ────────────────────────────────────────────────────────
  rivePreview: string;
  riveClose: string;
  riveLoading: string;
  /** Precedes the preview's state trail; the current state follows it, never cut. */
  riveStateLabel: string;
  riveInputs: string;
  riveNoInputs: string;
  riveFire: (name: string) => string;
  /** The loop buttons' heading: they set the number input `input`. */
  riveLoopsHeading: (input: string) => string;
  /** The one-shot buttons' heading: they fire a trigger. */
  riveOneShotsHeading: string;
  /** A loop button's tooltip. */
  riveSetMotion: (input: string, value: number, label: string) => string;
  riveOn: string;
  riveOff: string;
  riveDecrease: string;
  riveIncrease: string;
  riveError: Record<RiveFailureStage, string>;
  riveRetry: string;
  /** What a derived clip is: `matte of video-1 · veed`. The op's own word is
   *  inside this phrase and nowhere else — a second table for it would be a
   *  second place the same word could be translated differently. The op union
   *  is taken from the domain rather than spelled again here, so an op the
   *  pipeline learns to record cannot reach the chip untranslated. */
  derivedClip: (
    parent: string,
    op: NonNullable<MotionVideo["op"]>,
    model: string,
  ) => string;
  factSheet: string;
  factGrid: string;
  factCell: string;
  factPivot: string;
  factScale: string;
  pivotMeasuredTitle: string;
  pivotAssumedTitle: (anchor: "bottom" | "center") => string;
  assumed: string;
  inspect: string;
  factFrames: string;
  factAnchorDrift: string;
  factMaxJump: string;
  factScaleDrift: string;
  factBodyDrift: string;
  factEmpty: string;
  factSeam: string;
  factStep: string;
  /** A transition's two joins: its first frame against the loop it leaves,
   *  its last against the loop it lands on. */
  factStartGap: string;
  factEndGap: string;
  joinVerdict: Record<"lands" | "off", string>;
  /** The rail's note on a transition whose end does not land. */
  joinOff: (end: "start" | "end") => string;
  factFps: string;
  factDuration: string;
  factAlpha: string;
  seamVerdict: Record<"closes" | "open", string>;
  none: string;
  /** The bar a value is judged against, said beside it. */
  limit: (text: string) => string;
  acknowledged: (reason: string) => string;

  // ── Commands ────────────────────────────────────────────────────────────
  /** The button's own word, when this locale has one. `null` defers to the
   *  manifest's `label`, which is the English source. */
  commandLabel: (commandId: string) => string | null;
  commandHint: (commandId: string) => string | null;
  selectMotionFirst: string;
  renderClipFor: string;
  fieldModel: string;
  fieldMode: string;
  modelHint: Record<GeneratedVideoModel, string>;
  modeHint: Record<GeneratedVideoMode, string>;
  notePlaceholder: Record<"emphasis" | "change" | "misalignment", string>;
  cancel: string;
  askTheAgent: string;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** `×0.5`, and `×2` rather than `×2.0000`. */
const scaleText = (scale: number): string =>
  `×${Number(scale.toFixed(4))}`;

const en: SpriteStrings = {
  railShow: "Show the rail",
  railHide: "Hide the rail",
  noCharacterTitle: "No character yet",
  noCharacterBody:
    "Sprite starts with a character — a name, a look, a style. Describe one in the chat and the agent will draw its references, then you can ask for motions: idle, walk, attack.",
  sizeLine: (line) =>
    [
      line.declared ? `declared ${line.declared}` : null,
      line.measured ? `measured ${line.measured}` : null,
      line.packedScale !== null ? `packed ${scaleText(line.packedScale)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  facing: (direction) => `facing ${direction}`,
  refCount: (count) => `${count} reference${count === 1 ? "" : "s"}`,
  motionCount: (count) => `${count} motion${count === 1 ? "" : "s"}`,
  transitionCount: (count) => `${count} transition${count === 1 ? "" : "s"}`,
  fromVideo: "from video",
  videoSource: "video",
  videoSourceTitle: "Frames sampled from a video clip",
  loopSource: "loop",
  loopSourceTitle: "A seamless transparent animation for a UI, not a sprite atlas",
  transitionChip: "transition",
  transitionChipTitle: "A clip from one loop's first frame to another's, so the Rive file can switch between them without a jump",
  reverseTitle: (source) => `${source} played backwards`,
  loopLine: (line) =>
    [
      line.measured,
      `${line.frames} frame${line.frames === 1 ? "" : "s"} @ ${line.fps} fps`,
    ]
      .filter(Boolean)
      .join(" · "),
  renderingVideo: "rendering video",
  renderingVideoTitle: (motions) =>
    `A video clip is still rendering: ${motions.join(", ")}`,
  showingReference: "Showing the reference",
  backToMotion: (label) => `Back to ${label}`,

  selectionFrame: (motionLabel, frame) => `${motionLabel} · frame ${frame}`,
  selectionMotion: (motionLabel, status) => `${motionLabel} · ${status}`,

  stageBackground: "Stage background",
  background: { checker: "checker", dark: "dark", light: "light" },
  zoom: "Zoom",
  zoomOption: { fit: "fit", "1x": "1x", "2x": "2x" },
  onionTitle: "Onion skin — previous frame in blue, next in red",
  anchor: { bottom: "bottom", center: "center" },
  pivotMeasured: (anchor) =>
    `Pivot guides — the anchor point the pipeline measured (${anchor})`,
  pivotAssumed: (anchor) =>
    `Pivot guides — the ${anchor} of the cell; this motion carries no measured anchor point`,
  referenceTag: "reference",
  pickAMotion: "Pick a motion on the left, or ask for a new one.",
  drawingSheet: "Drawing the sheet…",
  slicingAligning: "Slicing and aligning…",
  motionFailed: "This motion failed.",
  plannedNoSheet: "Planned — no sheet has been generated yet.",
  sheetPreview: "sheet preview",
  sheetPreviewTitle: (keyed, cols, rows) =>
    `No aligned frames yet — this is the ${keyed ? "keyed" : "raw"} sheet sliced ${cols}×${rows} in the browser.`,
  keyframePreview: "keyframe",
  keyframePreviewTitle: (keyed) =>
    `No frames yet — this is the ${keyed ? "cut-out " : ""}keyframe the loop clip starts and ends on.`,
  pivotNoneForLoop:
    "A loop has no anchor point — it is not stood on a floor, so there is nothing to guide.",
  framesMissing: (count) => `${count} frame${count === 1 ? "" : "s"} missing`,
  decoding: "decoding…",

  play: "Play",
  pause: "Pause",
  previousFrame: "Previous frame",
  nextFrame: "Next frame",
  playbackFps: "Playback fps (this session only)",
  slower: "Slower",
  faster: "Faster",
  fps: (value) => `${value} fps`,
  looping: "Looping",
  playsOnce: "Plays once",
  loopShort: "loop",
  onceShort: "once",
  storedPlayback: (fps, loop) =>
    `file: ${fps} fps · ${loop ? "loop" : "once"} — reset`,
  storedPlaybackTitle: "Playback settings differ from the motion's stored values",
  framesList: "Frames",
  stripSampled: (shown, total) => `${shown} of ${total}`,
  stripSampledTitle:
    "Too many frames to show one thumbnail each: the strip samples them evenly, first and last included. The stage still plays every frame.",
  noFramesYet: "No frames to step through yet.",
  frameTitle: (frame) => `Frame ${frame}`,
  noAsset: "no asset",

  references: "References",
  motions: "Motions",
  transitions: "Transitions",
  noReferences:
    "No identity references yet. They are what keeps every motion sheet on model.",
  noMotions: "No motions yet. Ask for one — idle, walk, attack.",
  referenceTitle: (label, role) => `${label} — ${role}`,
  refRole: {
    turnaround: "turnaround",
    portrait: "portrait",
    expression: "expression",
    custom: "custom",
  },
  missingAsset: "missing",
  motionMeta: (m) =>
    [
      m.cols === null || m.rows === null ? null : `${m.cols}×${m.rows}`,
      `${m.frames} frame${m.frames === 1 ? "" : "s"}`,
      `${m.fps} fps`,
      m.loop ? "loop" : "once",
    ]
      .filter(Boolean)
      .join(" · "),
  status: {
    planned: "planned",
    generating: "generating",
    processing: "processing",
    ready: "ready",
    failed: "failed",
  },
  acknowledgedTitle: (reason) => `Warnings accepted — ${reason}`,

  tab: { gif: "GIF", loop: "Loop", video: "Video", atlas: "Atlas", export: "Export" },
  selectMotionForPanel: "Select a motion to see what it produced.",
  noPreviewYet:
    "No preview rendered yet. The GIF and WebP land with the pipeline run.",
  previewMeta: (m) =>
    `${m.fps} fps · ${m.loop ? "loops" : "plays once"} · ${m.frames} frames`,
  noVideoYet: (renderCommand) =>
    `No video preview yet. Use “${renderCommand}” to ask for one from Seedance 2.5 or MiniMax H3 Max.`,
  videoStatus: { generating: "generating", ready: "ready", failed: "failed" },
  renderFailed: "This render failed.",
  clipFileMissing: "The clip is registered but its file is missing.",
  downloadClip: "Download clip",
  noAtlasYet: "No packed atlas yet. It lands with the pipeline's pack step.",
  noAtlasForLoop: (m) =>
    m.frames > 0 && m.width > 0
      ? `A loop has no atlas — the frames are the PNG sequence (${m.frames} frames, ${m.width}×${m.height}).`
      : "A loop has no atlas — its frames are a PNG sequence, and there are none yet.",
  noLoopYet:
    "No loop exported yet. The WebP, APNG, WebM and Lottie land when sprite-sheet.mjs loop runs.",
  loopMeta: (m) =>
    [
      `${m.frames} frame${m.frames === 1 ? "" : "s"}`,
      `${m.fps} fps`,
      m.duration === null ? null : `${m.duration.toFixed(2)} s`,
      m.seam === null ? null : m.seam === "closes" ? "closes" : "does not close",
      m.seamFill !== null && m.seamFill > 0
        ? `${m.seamFill} seam frame${m.seamFill === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  exportLabel: { webp: "WebP", apng: "APNG", webm: "WebM", lottie: "Lottie" },
  exportLink: (label, size) => (size ? `${label} · ${size}` : label),

  exportFamily: { video: "Video", frames: "Frame animation", rive: "Rive" },
  exportFormatName: {
    mp4: "MP4",
    mov: "MOV",
    webm: "WebM",
    gif: "GIF",
    webp: "WebP",
    apng: "APNG",
    lottie: "Lottie",
    "png-seq": "PNG sequence",
    sheet: "Sprite sheet + atlas",
    riv: "Rive",
  },
  exportPurpose: (format, m) => {
    switch (format) {
      case "mp4":
        return "H.264 · on a solid colour, plays anywhere";
      case "mov":
        return "ProRes 4444 · keeps transparency, for editing software";
      case "webm":
        return "VP9 · keeps transparency, for web pages";
      case "gif":
        return "on/off transparency only · for chat and quick previews";
      case "webp":
        return "animated WebP · full transparency, small, for web pages";
      case "apng":
        return "animated PNG · full transparency, lossless, larger files";
      case "lottie":
        return "Lottie JSON of raster frames · for apps that already play Lottie";
      case "png-seq":
        return "every frame plus animation.json, zipped · for game engines and editors";
      case "sheet":
        return "sheet.png + atlas.json · loads straight into Phaser or PixiJS";
      default:
        return [
          "whole character",
          `${m.motions} motion${m.motions === 1 ? "" : "s"}`,
          m.transitions ? `${m.transitions} transition${m.transitions === 1 ? "" : "s"}` : null,
          "raster frames",
        ].filter(Boolean).join(", ");
    }
  },
  exportNotOffered: {
    "loop-gif":
      "Not for a loop: GIF has only on/off transparency and a loop has hundreds of frames — use WebP or APNG.",
    "loop-atlas":
      "Not for a loop: a loop is never packed into an atlas — use the PNG sequence.",
    "transition-gif":
      "Not for a transition: GIF has only on/off transparency, and a transition is cut from a matted clip — use APNG or WebM.",
    "transition-atlas":
      "Not for a transition: a transition is never packed into an atlas — use the PNG sequence.",
    "too-heavy":
      "Even at 24 fps and 320 px, this character's motions would take more than 768 MB of memory to open — ask the agent in the chat for fewer motions or a lower frame rate.",
    "not-ready": "Available once the motion is ready.",
    "not-in-run": "Made by every run of the motion; this run was made without it.",
  },
  exportRepeat: (video, loop) => {
    const plays = video.repeat === 1 ? "plays once" : `plays ${video.repeat}×`;
    const line = `${plays} · ${video.seconds.toFixed(1)} s`;
    return video.defaulted && loop && video.repeat > 1
      ? `${line} — repeats until at least 3 s`
      : line;
  },
  exportRiveMissing: (motions) =>
    `Does not include ${motions.join(", ")} yet — regenerate to add ${motions.length === 1 ? "it" : "them"}`,
  exportRiveTransition: (count) =>
    `This transition is part of the character's .riv — ${count} transition${count === 1 ? "" : "s"} in all`,
  exportRiveMemory: (size) => `takes about ${size} of memory once opened`,
  exportRiveLoops: (m) => `loops resampled to ${m.fps} fps, up to ${m.width}×${m.height} px`,
  exportOnBackground: (hex) => `on ${hex}`,
  exportBackground: "Background",
  exportBackgroundField: "Background colour as a hex code",
  exportColorInvalid: "Write the colour like #1a2b3c",
  exportBuiltInTitle: "Made by every run of this motion",
  exportGenerate: "Generate",
  exportRegenerate: "Regenerate",
  exportRequested: "Asked the agent…",
  exportUpdating: "Asked for a new one…",
  exportAskAgain: "Ask again",
  exportNothingReady: "Nothing has been exported for this motion yet.",

  rivePreview: "Preview",
  riveClose: "Close the preview",
  riveLoading: "Loading the Rive player…",
  riveStateLabel: "state:",
  riveInputs: "Inputs",
  riveNoInputs: "This file's state machine has no inputs.",
  riveFire: (name) => `Fire ${name}`,
  riveLoopsHeading: (input) => `Loops · set ${input}`,
  riveOneShotsHeading: "One-shots · fire",
  riveSetMotion: (input, value, label) => `Set ${input} to ${value} — ${label}`,
  riveOn: "on",
  riveOff: "off",
  riveDecrease: "Decrease",
  riveIncrease: "Increase",
  riveError: {
    runtime: "The Rive player could not start.",
    file: "The .riv file could not be opened.",
    "state-machine": "The file has no state machine to play.",
  },
  riveRetry: "Try again",

  derivedClip: (parent, op, model) =>
    `${{ matte: "matte", interpolate: "interpolation", retime: "retime" }[op]} of ${parent} · ${model}`,
  atlasNote: (note) => {
    switch (note.kind) {
      case "unmeasured":
        return "sheet.png has no recorded size, so its grid cannot be checked — atlas.json has the real cells.";
      case "not-whole-cells":
        return `The packed sheet is ${note.width}×${note.height}, which is not ${note.cols}×${note.rows} whole cells — the pack chose its own columns. Read atlas.json for the layout.`;
      default:
        return `A ${note.cols}×${note.rows} grid would make ${note.cellWidth}×${note.cellHeight} cells, but the frames are ${note.frameWidth}×${note.frameHeight} — read atlas.json for the layout.`;
    }
  },
  factSheet: "Sheet",
  factGrid: "Grid",
  factCell: "Cell",
  factPivot: "Pivot",
  factScale: "Packed",
  pivotMeasuredTitle:
    "The anchor point the pipeline measured, normalized by the cell — what atlas.json declares.",
  pivotAssumedTitle: (anchor) =>
    `No measured anchor point for this motion; atlas.json falls back to the ${anchor} of the cell.`,
  assumed: "assumed",
  inspect: "Inspect",
  factFrames: "Frames",
  factAnchorDrift: "Anchor drift",
  factMaxJump: "Max jump",
  factScaleDrift: "Scale drift",
  factBodyDrift: "Body drift",
  factEmpty: "Empty",
  factSeam: "Seam",
  factStep: "Step",
  factStartGap: "Start join",
  factEndGap: "End join",
  joinVerdict: { lands: "lands", off: "does not land" },
  joinOff: (end) => (end === "start" ? "start does not land" : "end does not land"),
  factFps: "Fps",
  factDuration: "Duration",
  factAlpha: "Alpha",
  seamVerdict: { closes: "closes", open: "does not close" },
  none: "none",
  limit: (text) => `≤ ${text}`,
  acknowledged: (reason) => `Accepted — ${reason}`,

  // English comes from the manifest — label and hint both — so this table
  // has nothing to add for it.
  commandLabel: () => null,
  commandHint: () => null,
  selectMotionFirst: "Select a motion first",
  renderClipFor: "Render a clip of",
  fieldModel: "Model",
  fieldMode: "Mode",
  modelHint: {
    "seedance-2.5": "cheap and quick at 480p",
    "h3-max": "stronger motion, slower, min 5 s",
  },
  modeHint: {
    i2v: "from the first frame",
    "first-last": "from the first and last frames",
    r2v: "frames as references, new footage",
  },
  notePlaceholder: {
    emphasis: "Anything the clip should emphasise? (optional)",
    change: "Anything to change? (optional)",
    misalignment: "What looks wrong? (e.g. the feet slide on frames 3-5)",
  },
  cancel: "Cancel",
  askTheAgent: "Ask the agent",
};

/** Named apart from the table because `selectionMotion` says a status inside
 *  a phrase, and the two must not be allowed to drift into two vocabularies. */
const zhStatus: Record<MotionStatus, string> = {
  planned: "已计划",
  generating: "生成中",
  processing: "处理中",
  ready: "就绪",
  failed: "失败",
};

/** zh-CN copy for the three stage commands. English is not here: the
 *  manifest's `label`/`description` are already the user-facing pair, and
 *  copying them would give English two sources that can disagree. */
const zhCommandLabels: Record<string, string> = {
  "render-video": "渲染视频预览",
  "regenerate-motion": "重画这个动作",
  "fix-alignment": "帧对不齐",
  export: "导出",
};

const zhCommandHints: Record<string, string> = {
  "render-video": "让助手把这个动作渲成一段视频，可以挑模型和生成方式。",
  "regenerate-motion": "让助手重画这个动作的雪碧图，可以附一句要改什么。",
  "fix-alignment": "帧与帧之间人物在滑或在跳时，让助手重新对齐。",
  export: "让助手把这个动作——或整个角色——导出成视频、帧动画或 Rive 文件。",
};

const zhCN: SpriteStrings = {
  railShow: "显示侧栏",
  railHide: "收起侧栏",
  noCharacterTitle: "还没有角色",
  noCharacterBody:
    "精灵图从一个角色开始——名字、长相、画风。在对话里描述一个，助手会先画出它的参考图，之后你就可以要动作了：待机、行走、攻击。",
  sizeLine: (line) =>
    [
      line.declared ? `声明 ${line.declared}` : null,
      line.measured ? `实测 ${line.measured}` : null,
      line.packedScale !== null ? `打包 ${scaleText(line.packedScale)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  facing: (direction) => (direction === "left" ? "朝左" : "朝右"),
  refCount: (count) => `${count} 张参考图`,
  motionCount: (count) => `${count} 个动作`,
  transitionCount: (count) => `${count} 段过渡`,
  fromVideo: "来自视频",
  videoSource: "视频",
  videoSourceTitle: "帧来自一段视频",
  loopSource: "循环",
  loopSourceTitle: "做给界面用的无缝透明动画，不是游戏用的精灵图集",
  transitionChip: "过渡",
  transitionChipTitle: "从一个循环的首帧过渡到另一个循环的首帧，Rive 文件在两者之间切换时就不会跳",
  reverseTitle: (source) => `由 ${source} 倒放而来`,
  loopLine: (line) =>
    [line.measured, `${line.frames} 帧 @ ${line.fps} fps`]
      .filter(Boolean)
      .join(" · "),
  renderingVideo: "视频渲染中",
  renderingVideoTitle: (motions) => `还有视频在渲染：${motions.join("、")}`,
  showingReference: "正在看参考图",
  backToMotion: (label) => `回到 ${label}`,

  selectionFrame: (motionLabel, frame) => `${motionLabel} · 第 ${frame} 帧`,
  selectionMotion: (motionLabel, status) =>
    `${motionLabel} · ${zhStatus[status]}`,

  stageBackground: "舞台背景",
  background: { checker: "棋盘", dark: "深色", light: "浅色" },
  zoom: "缩放",
  zoomOption: { fit: "适应", "1x": "1x", "2x": "2x" },
  onionTitle: "洋葱皮——上一帧显蓝色，下一帧显红色",
  anchor: { bottom: "底边", center: "中心" },
  pivotMeasured: (anchor) =>
    `轴心参考线——流水线实测的锚点（${anchor === "bottom" ? "底边" : "中心"}）`,
  pivotAssumed: (anchor) =>
    `轴心参考线——取格子的${anchor === "bottom" ? "底边" : "中心"}；这个动作没有实测锚点`,
  referenceTag: "参考图",
  pickAMotion: "在左边挑一个动作，或者让助手做一个新的。",
  drawingSheet: "正在画雪碧图…",
  slicingAligning: "正在切帧对齐…",
  motionFailed: "这个动作失败了。",
  plannedNoSheet: "已计划——还没有生成雪碧图。",
  sheetPreview: "雪碧图预览",
  sheetPreviewTitle: (keyed, cols, rows) =>
    `还没有对齐好的帧——这是${keyed ? "抠好背景" : "原始"}的雪碧图，在浏览器里按 ${cols}×${rows} 切开的。`,
  keyframePreview: "关键帧",
  keyframePreviewTitle: (keyed) =>
    `还没有帧——这是循环片头尾共用的${keyed ? "抠好背景的" : ""}关键帧。`,
  pivotNoneForLoop: "循环动画没有锚点——它不站在地面上，没有轴心可以画。",
  framesMissing: (count) => `缺 ${count} 帧`,
  decoding: "解码中…",

  play: "播放",
  pause: "暂停",
  previousFrame: "上一帧",
  nextFrame: "下一帧",
  playbackFps: "播放帧率（只对本次会话生效）",
  slower: "调慢",
  faster: "调快",
  fps: (value) => `${value} fps`,
  looping: "循环播放",
  playsOnce: "只播一次",
  loopShort: "循环",
  onceShort: "一次",
  storedPlayback: (fps, loop) =>
    `文件里是 ${fps} fps · ${loop ? "循环" : "一次"} —— 恢复`,
  storedPlaybackTitle: "当前播放设置和动作存在文件里的值不一样",
  framesList: "帧",
  stripSampled: (shown, total) => `${total} 帧抽 ${shown} 帧`,
  stripSampledTitle:
    "帧太多，排不下每帧一张缩略图：这一条按等间隔抽样，首帧和末帧一定在里面。舞台照样逐帧播放。",
  noFramesYet: "还没有可以逐帧看的内容。",
  frameTitle: (frame) => `第 ${frame} 帧`,
  noAsset: "缺文件",

  references: "参考图",
  motions: "动作",
  transitions: "过渡",
  noReferences: "还没有身份参考图。它们是每张动作图不跑形的依据。",
  noMotions: "还没有动作。让助手做一个吧——待机、行走、攻击。",
  referenceTitle: (label, role) => `${label} — ${role}`,
  refRole: {
    turnaround: "三视图",
    portrait: "头像",
    expression: "表情",
    custom: "自定义",
  },
  missingAsset: "缺文件",
  motionMeta: (m) =>
    [
      m.cols === null || m.rows === null ? null : `${m.cols}×${m.rows}`,
      `${m.frames} 帧`,
      `${m.fps} fps`,
      m.loop ? "循环" : "一次",
    ]
      .filter(Boolean)
      .join(" · "),
  status: zhStatus,
  acknowledgedTitle: (reason) => `已确认保留 —— ${reason}`,

  tab: { gif: "GIF", loop: "循环", video: "视频", atlas: "图集", export: "导出" },
  selectMotionForPanel: "选一个动作，看它产出了什么。",
  noPreviewYet: "还没有预览。GIF 和 WebP 会随流水线一起产出。",
  previewMeta: (m) =>
    `${m.fps} fps · ${m.loop ? "循环" : "只播一次"} · ${m.frames} 帧`,
  noVideoYet: (renderCommand) =>
    `还没有视频预览。点「${renderCommand}」可以让助手用 Seedance 2.5 或 MiniMax H3 Max 渲一段。`,
  videoStatus: { generating: "渲染中", ready: "就绪", failed: "失败" },
  renderFailed: "这次渲染失败了。",
  clipFileMissing: "视频已登记，但文件不在。",
  downloadClip: "下载视频",
  noAtlasYet: "还没有打包好的图集。它会随流水线的打包步骤产出。",
  noAtlasForLoop: (m) =>
    m.frames > 0 && m.width > 0
      ? `循环动画没有图集——帧就是那一串 PNG（共 ${m.frames} 帧，${m.width}×${m.height}）。`
      : "循环动画没有图集——帧就是那一串 PNG，现在还一帧都没有。",
  noLoopYet: "还没有导出循环动画。跑 sprite-sheet.mjs loop 之后会得到 WebP、APNG、WebM 和 Lottie。",
  loopMeta: (m) =>
    [
      `${m.frames} 帧`,
      `${m.fps} fps`,
      m.duration === null ? null : `${m.duration.toFixed(2)} 秒`,
      m.seam === null ? null : m.seam === "closes" ? "接得上" : "接不上",
      m.seamFill !== null && m.seamFill > 0 ? `补了 ${m.seamFill} 帧接缝` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  exportLabel: { webp: "WebP", apng: "APNG", webm: "WebM", lottie: "Lottie" },
  exportLink: (label, size) => (size ? `${label} · ${size}` : label),

  exportFamily: { video: "视频", frames: "帧动画", rive: "Rive" },
  exportFormatName: {
    mp4: "MP4",
    mov: "MOV",
    webm: "WebM",
    gif: "GIF",
    webp: "WebP",
    apng: "APNG",
    lottie: "Lottie",
    "png-seq": "PNG 序列",
    sheet: "雪碧图 + 图集",
    riv: "Rive",
  },
  exportPurpose: (format, m) => {
    switch (format) {
      case "mp4":
        return "H.264 · 铺在纯色底上，哪儿都能播";
      case "mov":
        return "ProRes 4444 · 保留透明，给剪辑软件用";
      case "webm":
        return "VP9 · 保留透明，放网页用";
      case "gif":
        return "透明只有全透和不透 · 发聊天、快速预览";
      case "webp":
        return "动态 WebP · 完整透明、体积小，放网页用";
      case "apng":
        return "动态 PNG · 完整透明、无损，文件偏大";
      case "lottie":
        return "逐帧位图的 Lottie JSON · 给已经在播 Lottie 的 App";
      case "png-seq":
        return "每一帧加 animation.json 打成 zip · 给游戏引擎和编辑器";
      case "sheet":
        return "sheet.png + atlas.json · Phaser、PixiJS 直接读";
      default:
        return [
          "整个角色",
          `${m.motions} 个动作`,
          m.transitions ? `${m.transitions} 段过渡` : null,
          "位图帧",
        ].filter(Boolean).join(" · ");
    }
  },
  exportNotOffered: {
    "loop-gif":
      "循环动画不出 GIF：GIF 的透明只有全透和不透，循环动画又动辄几百帧——用 WebP 或 APNG。",
    "loop-atlas": "循环动画不打包成图集——要逐帧文件就用 PNG 序列。",
    "transition-gif":
      "过渡片段不出 GIF：GIF 的透明只有全透和不透，而过渡是从抠好像的视频里切出来的——用 APNG 或 WebM。",
    "transition-atlas": "过渡片段不打包成图集——要逐帧文件就用 PNG 序列。",
    "too-heavy":
      "就算降到 24 fps、320 px，这个角色的动作打开也要占 768 MB 以上内存——在对话里请助手少放几个动作，或者再降低帧率。",
    "not-ready": "动作就绪后才能导出。",
    "not-in-run": "这个文件随每次流水线产出，这一次跑的时候没有生成。",
  },
  exportRepeat: (video, loop) => {
    const line = `播 ${video.repeat} 遍 · ${video.seconds.toFixed(1)} 秒`;
    return video.defaulted && loop && video.repeat > 1
      ? `${line}——循环动作会重复到至少 3 秒`
      : line;
  },
  exportRiveMissing: (motions) => `还没有包含 ${motions.join("、")}——重新生成就会加进去`,
  exportRiveTransition: (count) => `这段过渡在角色的 .riv 里——一共 ${count} 段过渡`,
  exportRiveMemory: (size) => `打开后约占 ${size} 内存`,
  exportRiveLoops: (m) => `循环动画降到 ${m.fps} fps，最大 ${m.width}×${m.height}`,
  exportOnBackground: (hex) => `底色 ${hex}`,
  exportBackground: "底色",
  exportBackgroundField: "底色的十六进制色值",
  exportColorInvalid: "颜色要写成 #1a2b3c 这样",
  exportBuiltInTitle: "每次跑这个动作都会产出",
  exportGenerate: "生成",
  exportRegenerate: "重新生成",
  exportRequested: "已交给助手…",
  exportUpdating: "已请助手重新生成…",
  exportAskAgain: "再问一次",
  exportNothingReady: "这个动作还没有导出过文件。",

  rivePreview: "预览",
  riveClose: "关闭预览",
  riveLoading: "正在载入 Rive 播放器…",
  riveStateLabel: "当前状态：",
  riveInputs: "输入",
  riveNoInputs: "这个文件的状态机没有输入。",
  riveFire: (name) => `触发 ${name}`,
  riveLoopsHeading: (input) => `循环 · 设置 ${input}`,
  riveOneShotsHeading: "单次动作 · 触发",
  riveSetMotion: (input, value, label) => `把 ${input} 设为 ${value}（${label}）`,
  riveOn: "开",
  riveOff: "关",
  riveDecrease: "减小",
  riveIncrease: "增大",
  riveError: {
    runtime: "Rive 播放器没能启动。",
    file: ".riv 文件打不开。",
    "state-machine": "文件里没有可以播放的状态机。",
  },
  riveRetry: "重试",

  derivedClip: (parent, op, model) =>
    `${parent} 的${{ matte: "抠像", interpolate: "补帧", retime: "重剪" }[op]} · ${model}`,
  atlasNote: (note) => {
    switch (note.kind) {
      case "unmeasured":
        return "sheet.png 没有记录尺寸，网格无从校验——真正的格子以 atlas.json 为准。";
      case "not-whole-cells":
        return `打包出来的图是 ${note.width}×${note.height}，切不成 ${note.cols}×${note.rows} 个整格——打包时用的是它自己算的列数。布局以 atlas.json 为准。`;
      default:
        return `按 ${note.cols}×${note.rows} 切出来的格子是 ${note.cellWidth}×${note.cellHeight}，但帧是 ${note.frameWidth}×${note.frameHeight}——布局以 atlas.json 为准。`;
    }
  },
  factSheet: "整图",
  factGrid: "网格",
  factCell: "格子",
  factPivot: "轴心",
  factScale: "打包",
  pivotMeasuredTitle: "流水线实测的锚点，按格子归一化——也就是 atlas.json 里写的值。",
  pivotAssumedTitle: (anchor) =>
    `这个动作没有实测锚点；atlas.json 退回到格子的${anchor === "bottom" ? "底边" : "中心"}。`,
  assumed: "推定",
  inspect: "体检",
  factFrames: "帧数",
  factAnchorDrift: "锚点抖动",
  factMaxJump: "最大跳变",
  factScaleDrift: "缩放漂移",
  factBodyDrift: "身体漂移",
  factEmpty: "空帧",
  factSeam: "接缝",
  factStep: "单帧位移",
  factStartGap: "起点衔接",
  factEndGap: "终点衔接",
  joinVerdict: { lands: "接得上", off: "接不上" },
  joinOff: (end) => (end === "start" ? "起点接不上" : "终点接不上"),
  factFps: "帧率",
  factDuration: "时长",
  factAlpha: "不透明占比",
  seamVerdict: { closes: "接得上", open: "接不上" },
  none: "无",
  limit: (text) => `上限 ${text}`,
  acknowledged: (reason) => `已确认保留 —— ${reason}`,

  commandLabel: (commandId) => zhCommandLabels[commandId] ?? null,
  commandHint: (commandId) => zhCommandHints[commandId] ?? null,
  selectMotionFirst: "先选一个动作",
  renderClipFor: "渲染一段视频：",
  fieldModel: "模型",
  fieldMode: "方式",
  modelHint: {
    "seedance-2.5": "480p，便宜也快",
    "h3-max": "动作更强，更慢更贵，最短 5 秒",
  },
  modeHint: {
    i2v: "从第一帧生成",
    "first-last": "给首尾两帧，中间补出来",
    r2v: "把帧当参考，重新拍一段",
  },
  notePlaceholder: {
    emphasis: "这段视频要突出什么？（可不填）",
    change: "有什么要改的？（可不填）",
    misalignment: "哪里不对？（比如：第 3-5 帧脚在滑）",
  },
  cancel: "取消",
  askTheAgent: "交给助手",
};

const TABLES: Record<SpriteLocale, SpriteStrings> = { en, "zh-CN": zhCN };

/**
 * The table for a locale.
 *
 * `props.locale` is language-only and lowercase (`"zh"`, `"en"`, `"ja"`) —
 * the runtime folds the region out before viewers see it — so the match is on
 * the language, and a full tag (`"zh-CN"`, `"zh-Hant"`) is accepted too for
 * anyone reading `useSystemPreferences()` directly. Everything else falls
 * back to English rather than to a half-translated screen.
 */
export function resolveLocale(locale: string | undefined): SpriteLocale {
  const language = (locale ?? "").toLowerCase().split("-")[0];
  return language === "zh" ? "zh-CN" : "en";
}

export function spriteStrings(locale: string | undefined): SpriteStrings {
  return TABLES[resolveLocale(locale)];
}

export const SPRITE_STRING_TABLES = TABLES;
export { pad2 as padFrame };

/**
 * What the composer's chip says about the current selection.
 *
 * The chip is built from the selection's `content`, and `content` used to be
 * the motion's PROMPT — so clicking frame 7 of an attack put the character's
 * style paragraph in front of the user, with no mention of either the motion
 * or the frame. It names the thing now; the prompt is still one `<viewer-
 * context>` away for the agent, which is who it was ever for.
 */
export function selectionLabel(
  t: SpriteStrings,
  motion: Motion,
  frame: number | null,
): string {
  return frame === null
    ? t.selectionMotion(motion.label, motion.status)
    : t.selectionFrame(motion.label, pad2(frame));
}
