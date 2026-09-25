/**
 * Which deliverable tab is worth showing — the decidable half of the panel.
 *
 * `navigate-to` moves the STAGE, and for two rounds that was all it moved:
 * an agent that had just finished a motion said "switched the stage to GIF"
 * while the panel sat on a Video tab with no clips in it, showing an empty
 * state for the thing it had just made. The agent was not lying about its
 * intent — it had no way to do what it said. So a navigation now carries the
 * panel with it, but only when the current tab has NOTHING for the motion
 * being shown: a user who deliberately opened Atlas keeps Atlas as long as
 * there is an atlas to see.
 *
 * A loop motion is a different set of deliverables from the same character —
 * no GIF, no atlas, four frontend exports instead — so it has a different
 * first tab. `panelTabs` is the one place that says which tabs a motion HAS,
 * and both the tab strip and the fallback read it, so the panel can never
 * render a tab it would refuse to select.
 */

import type { ViewerNotification } from "../../../core/types/viewer-contract.js";
import type { CharacterProject, ExportFormat, Motion, SpriteAsset } from "../domain.js";
import {
  RIVE_DECODE_LIMIT_BYTES,
  RIVE_LOOP_FPS,
  RIVE_LOOP_MAX_SIZE,
  riveMB,
  riveDefaultFilter,
  riveDefaultImages,
  rivePlan,
  riveReverseIsCurrent,
  type RivePlan,
  type RivePlanInput,
} from "../skill/scripts/rive-plan.mjs";
import type { RiveMachineRecord } from "./rive-preview.js";

export type PanelTab = "gif" | "loop" | "video" | "atlas" | "export";

/** The formats a loop is delivered in, in the order the panel lists them. */
export type LoopFormat = "webp" | "apng" | "webm" | "lottie";

const LOOP_FORMATS: LoopFormat[] = ["webp", "apng", "webm", "lottie"];

/**
 * The tabs this motion has, in order. The first one is its default.
 *
 * Export is there only for a READY motion: the scripts refuse to export
 * anything else, and a tab of "not yet" rows would offer a matrix of buttons
 * that cannot do anything.
 */
export function panelTabs(motion: Motion | null): PanelTab[] {
  if (motion?.kind === "transition") {
    // A transition is its take and its frames: no GIF, no loop files, no
    // atlas. A reverse was never shot — it is its source played backwards —
    // so a ready one has nothing but its exports.
    if (motion.reverseOf && motion.status === "ready") return ["export"];
    return motion.status === "ready" ? ["video", "export"] : ["video"];
  }
  const tabs: PanelTab[] = motion?.kind === "loop"
    ? ["loop", "video", "atlas"]
    : ["gif", "video", "atlas"];
  return motion?.status === "ready" ? [...tabs, "export"] : tabs;
}

/**
 * The tab a motion falls back to.
 *
 * It is the artefact that motion IS — the GIF for a sprite sheet, the WebP
 * loop for a loop — which is what an agent means by "look at what I made".
 * Falling back to it when it is empty too is deliberate: its empty state is
 * the true answer, and hunting for some other tab with content would move the
 * panel somewhere nobody asked for.
 */
export function defaultTab(motion: Motion | null): PanelTab {
  if (motion?.kind === "transition") return panelTabs(motion)[0];
  return motion?.kind === "loop" ? "loop" : "gif";
}

/**
 * What a motion is called on the stage. A transition is named by the two
 * loops it joins — "待机 → 喝咖啡" — from their labels as they are now, so a
 * renamed loop renames its transitions; its own label (written when it was
 * made) is the fallback when a loop is gone.
 */
export function motionLabel(project: CharacterProject, motion: Motion): string {
  if (motion.kind !== "transition") return motion.label;
  const label = (id: string | undefined) => project.sprite.motions.find((m) => m.id === id)?.label;
  const from = label(motion.from);
  const to = label(motion.to);
  return from && to ? `${from} → ${to}` : motion.label;
}

/**
 * The rail's two motion lists, each in declared order: what the character
 * does, then the transitions between its loops. Their own group rather than
 * after the loop each lands on: a transition only reads as a pair of loops,
 * and grouped by target every exit back to the hub would pile up under it
 * while its entry sat under another loop.
 */
export function railGroups(project: CharacterProject): { motions: Motion[]; transitions: Motion[] } {
  const all = project.sprite.motions;
  return {
    motions: all.filter((m) => m.kind !== "transition"),
    transitions: all.filter((m) => m.kind === "transition"),
  };
}

/** Does this tab have anything of this motion's to render? */
export function tabHasContent(motion: Motion | null, tab: PanelTab): boolean {
  if (!motion) return false;
  switch (tab) {
    case "video":
      return motion.videos.length > 0;
    case "atlas":
      return !!motion.sheet;
    case "loop":
      return !!(motion.webp ?? motion.exports);
    case "export":
      // Every row of the matrix is something — a download, a button or a
      // reason — so the tab is never empty while it exists.
      return motion.status === "ready";
    default:
      return !!(motion.gif ?? motion.webp);
  }
}

/** The tab to show after a navigation put `motion` on the stage. */
export function tabAfterNavigate(tab: PanelTab, motion: Motion | null): PanelTab {
  if (!motion) return tab;
  // A tab this motion does not have at all cannot be kept, whatever is in it:
  // a loop has no GIF tab to sit on, and a sprite motion no Loop tab.
  if (!panelTabs(motion).includes(tab)) return defaultTab(motion);
  return tabHasContent(motion, tab) ? tab : defaultTab(motion);
}

/** One downloadable loop export. */
export interface LoopExport {
  format: LoopFormat;
  assetId: string;
  /** Size in bytes as `register-run` measured it; null when unrecorded. */
  size: number | null;
}

/**
 * The exports a loop motion can be downloaded as, in list order.
 *
 * The size comes off `metadata.size`, which `register-run` reads from the file
 * itself — the panel prints it beside the link, and the viewer never fetches
 * an asset to describe it. An export whose asset the project no longer carries
 * is left out rather than offered as a broken link.
 */
export function loopExports(
  project: CharacterProject,
  motion: Motion,
): LoopExport[] {
  const ids: Record<LoopFormat, string | undefined> = {
    webp: motion.webp,
    apng: motion.exports?.apng,
    webm: motion.exports?.webm,
    lottie: motion.exports?.lottie,
  };
  const out: LoopExport[] = [];
  for (const format of LOOP_FORMATS) {
    const assetId = ids[format];
    if (!assetId) continue;
    const asset = project.assetsById.get(assetId);
    if (!asset) continue;
    const size = asset.metadata.size;
    out.push({
      format,
      assetId,
      size: typeof size === "number" && Number.isFinite(size) ? size : null,
    });
  }
  return out;
}

// ── The Export tab ─────────────────────────────────────────────────────────

/** The three sections of the tab, in order. */
export type ExportFamily = "video" | "frames" | "rive";

/**
 * Every format the tab lists. The first six are what `sprite-sheet.mjs
 * export` writes on demand (`ExportFormat`); `gif`, `webp` and `sheet` are
 * made by every run of a motion, and `riv` belongs to the whole character.
 */
export type ExportRowFormat = ExportFormat | "gif" | "webp" | "sheet" | "riv";

/** Why a format is not offered, said to the user as a sentence (strings.ts). */
export type ExportNotOffered =
  /** GIF has 1-bit alpha and a loop has hundreds of frames. */
  | "loop-gif"
  /** A loop is never packed; its frames are a sequence. */
  | "loop-atlas"
  /** GIF has 1-bit alpha; a transition is cut from a matted clip. */
  | "transition-gif"
  /** A transition is never packed either. */
  | "transition-atlas"
  /** The .riv the defaults would make is past what a runtime can open. */
  | "too-heavy"
  /** The scripts export a ready motion and nothing else. */
  | "not-ready"
  /** A file every run makes, and this run did not (a `--no-webp` run). */
  | "not-in-run";

/** One file a ready row offers for download. */
export interface ExportFile {
  assetId: string;
  /** The file name on disk — what the download is saved as. */
  name: string;
  /** Relative to the character directory. */
  uri: string;
  /** Bytes, as registration measured it; null when unrecorded. */
  size: number | null;
  /** When it was registered — the cache-buster for its url, and what tells
   *  a regenerated file from the one it replaced under the same id. */
  createdAt: number;
}

export type ExportState =
  | { kind: "ready"; files: ExportFile[] }
  | { kind: "missing" }
  | { kind: "not-offered"; reason: ExportNotOffered };

/** How many times a video export plays, and for how long. */
export interface ExportRepeat {
  repeat: number;
  seconds: number;
  /** True when the number is the script's default rather than a choice. */
  defaulted: boolean;
}

export interface ExportRow {
  family: ExportFamily;
  format: ExportRowFormat;
  /** What a request for this row is remembered under (see `exportKey`). */
  key: string;
  state: ExportState;
  /** Made by the motion's own run — offered, never generated from here. */
  builtIn: boolean;
  /** A Generate (or Regenerate) is offered. */
  canGenerate: boolean;
  /** Asked for, and no newer file has landed since. */
  requested: boolean;
  /** Video rows: the plays and length — the file's own once it exists, the
   *  script's default before. */
  video?: ExportRepeat;
  /** MP4 once made: the colour it was flattened onto. */
  background?: string;
  /** The .riv: see `RiveRowFacts`. */
  rive?: RiveRowFacts;
}

/**
 * What the agent is asked for, remembered until it lands: row key → the
 * `createdAt` of the file that existed when the request was made (null when
 * there was none). A request is answered when the row's file is newer than
 * that — which is the only way to tell a regenerated `.riv` from the old one,
 * since it keeps its asset id.
 */
export type ExportRequests = ReadonlyMap<string, number | null>;

export interface ExportRowOptions {
  /** An agent is there to ask. False in the hosted player and read-only
   *  sessions: only ready downloads are listed, and nothing offers to make
   *  anything. */
  canRequest: boolean;
  requests: ExportRequests;
}

/**
 * What the Rive row knows about the character's `.riv`.
 *
 * Before the file exists these are the PLAN — `rive-plan.mjs`, the module the
 * script follows — for every ready motion, loops at the defaults: what a
 * Generate would make. Once it exists they are what the file recorded, read
 * off its asset and provenance, so a ready row never quotes a plan the file
 * was not made with.
 */
export interface RiveRowFacts {
  /** The motions it holds, or would hold — loops and sprite motions. */
  motions: string[];
  /** The transitions between its loops, counted apart. */
  transitions: string[];
  /** A registered file's record of what drives it (see `RiveMachineRecord`);
   *  absent before the file exists, or for a file registered without one. */
  machine?: RiveMachineRecord;
  /** Ready motions a ready file does not hold (made before they were). */
  missing: string[];
  /** Memory the runtime decodes it into on load; absent when unknown. */
  decodeBytes?: number;
  /** The rate and the largest size its loops play at; null with no loops. */
  loops: { fps: number; width: number; height: number } | null;
  /** A (re)generation at the defaults would be past the limit. */
  tooHeavy: boolean;
}

/** A looping motion's video repeats until it lasts at least this long. */
const EXPORT_MIN_SECONDS = 3;

/** Swatches beside the hex field. White first: it is the script's default.
 *  Each one a person can tell from the others at chip size — the stage's
 *  own #09090b beside #000000, and #f4f4f5 beside white, were not; any
 *  other colour is one hex field away. */
export const EXPORT_SWATCHES: readonly string[] = [
  "#ffffff",
  "#000000",
  "#00ff00",
  "#0000ff",
];

/**
 * Whether anything on the stage may ask the agent for work — the command bar
 * and the Export tab's Generate, Regenerate and MP4 colour alike.
 *
 * `editing` is the session's creating-vs-consuming flag as the shell hands it
 * to the viewer: false in a `--viewing` session (no agent was started) and in
 * the hosted player. `readonly` is a replay. Without an agent to receive it,
 * a request would sit in the queue until whichever agent started next.
 */
export function canAskAgent(flags: {
  editing: boolean | undefined;
  readonly: boolean | undefined;
  staticPlayer: boolean;
  canNotify: boolean;
}): boolean {
  return flags.editing !== false && !flags.readonly && !flags.staticPlayer && flags.canNotify;
}

/**
 * The plays and the length a video export gets when `--repeat` is not given —
 * the same rule as `sprite-sheet.mjs export`: a looping motion repeats until
 * the clip lasts 3 s, a one-shot plays once.
 */
export function defaultExportRepeat(
  frames: number,
  fps: number,
  loop: boolean,
): { repeat: number; seconds: number } {
  const once = fps > 0 ? frames / fps : 0;
  const repeat = loop && once > 0 ? Math.max(1, Math.ceil(EXPORT_MIN_SECONDS / once - 1e-9)) : 1;
  return { repeat, seconds: Number((once * repeat).toFixed(3)) };
}

/**
 * The key a request is remembered under: per character, per motion, per
 * format — the `.riv` is per character only.
 */
export function exportKey(
  project: CharacterProject,
  motion: Motion | null,
  format: ExportRowFormat,
): string {
  const character = project.contentSet || ".";
  return format === "riv" ? `${character}::riv` : `${character}::${motion?.id ?? ""}:${format}`;
}

/** `#1a2b3c`, from what a person types: `#1A2B3C`, `1a2b3c`, `#fff`. Null for
 *  anything else — the script refuses anything but `#rrggbb`. */
export function normalizeExportColor(input: string): string | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`;
  return null;
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function fileOf(asset: SpriteAsset): ExportFile {
  return {
    assetId: asset.id,
    name: asset.uri.split("/").pop() || asset.uri,
    uri: asset.uri,
    size: finiteOrNull(asset.metadata.size),
    createdAt: asset.createdAt,
  };
}

/** The assets behind these ids, or null when any of them is gone — an export
 *  whose file the project no longer carries is not a download link. */
function readyFiles(project: CharacterProject, ids: Array<string | undefined>): ExportFile[] | null {
  const files: ExportFile[] = [];
  for (const id of ids) {
    const asset = id ? project.assetsById.get(id) : undefined;
    if (!asset || !asset.uri) return null;
    files.push(fileOf(asset));
  }
  return files.length > 0 ? files : null;
}

/** The registered `.riv`'s record, read off its provenance edge: the motions
 *  it holds, and each one as the file plays it (`params.sampled`). */
function rivRecord(project: CharacterProject, assetId: string) {
  const params = project.provenance.find((e) => e.toAssetId === assetId)?.operation.params;
  const motions = Array.isArray(params?.motions)
    ? params.motions.filter((m): m is string => typeof m === "string")
    : [];
  const sampled = (Array.isArray(params?.sampled) ? params.sampled : [])
    .map((entry: unknown) => {
      const e = entry as Record<string, unknown>;
      const fps = finiteOrNull(e?.fps);
      const width = finiteOrNull(e?.width);
      const height = finiteOrNull(e?.height);
      return typeof e?.motion === "string" && fps !== null && width !== null && height !== null
        ? { motion: e.motion, fps, width, height }
        : null;
    })
    .filter((e): e is { motion: string; fps: number; width: number; height: number } => e !== null);
  return { motions, sampled, machine: rivMachine(params?.stateMachine) };
}

/** The `stateMachine` record on a registered `.riv`'s edge, checked field by
 *  field; null for an older file whose edge names only the machine. */
function rivMachine(value: unknown): RiveMachineRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  const number = v.number as Record<string, unknown> | null | undefined;
  const values = Array.isArray(number?.values)
    ? number.values
      .map((entry: unknown) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry?.motion === "string" && finiteOrNull(entry.value) !== null)
      .map((entry) => ({ value: entry.value as number, motion: entry.motion as string }))
    : [];
  return {
    name: v.name,
    hub: typeof v.hub === "string" ? v.hub : null,
    number: number && typeof number.name === "string"
      ? { name: number.name, default: finiteOrNull(number.default) ?? 0, values }
      : null,
    triggers: (Array.isArray(v.triggers) ? v.triggers : [])
      .map((entry: unknown) => entry as Record<string, unknown>)
      .filter((entry) => typeof entry?.name === "string" && typeof entry?.motion === "string")
      .map((entry) => ({ name: entry.name as string, motion: entry.motion as string })),
  };
}

/** The frame size a motion was registered at: its first frame's measured
 *  metadata, else the inspect cell. Null when neither was recorded. */
function frameSize(project: CharacterProject, motion: Motion): { width: number; height: number } | null {
  const metadata = motion.frames[0] ? project.assetsById.get(motion.frames[0])?.metadata : undefined;
  const width = finiteOrNull(metadata?.width);
  const height = finiteOrNull(metadata?.height);
  if (width && height) return { width, height };
  const cell = motion.inspect?.cell;
  return cell && cell.width > 0 && cell.height > 0 ? { width: cell.width, height: cell.height } : null;
}

/** The rate and the largest size a set of loops plays at. */
function loopSummary(entries: Array<{ fps: number; width: number; height: number }>): RiveRowFacts["loops"] {
  if (!entries.length) return null;
  return {
    fps: Math.max(...entries.map((e) => e.fps)),
    width: Math.max(...entries.map((e) => e.width)),
    height: Math.max(...entries.map((e) => e.height)),
  };
}

const VIDEO_FORMATS: ReadonlySet<ExportRowFormat> = new Set(["mp4", "mov", "webm"]);

/**
 * What a request for a row is remembered against: the newest `createdAt` of
 * its ready files, or null when there are none. `exportRows` compares the
 * same stamp, so the shell and the rows cannot disagree about "landed".
 */
export function exportStamp(state: ExportState): number | null {
  return state.kind === "ready" ? Math.max(...state.files.map((f) => f.createdAt)) : null;
}

/**
 * What a Generate of the character's `.riv` holds — `rive --include-loops`:
 * every ready motion, except a transition whose two loops are not both in.
 */
export function riveMotions(project: CharacterProject): Motion[] {
  const ready = project.sprite.motions.filter((m) => m.status === "ready");
  const loops = new Set(ready.filter((m) => m.kind === "loop").map((m) => m.id));
  return ready.filter((m) => m.kind !== "transition" || (loops.has(m.from ?? "") && loops.has(m.to ?? "")));
}

/**
 * The plan a Generate of the character's `.riv` would follow — the motions
 * `riveMotions` names, loops and transitions at the defaults and brought back
 * to their clips' scale — or null when a motion's frame size is not on
 * record. The same `rivePlan` the script calls, fed the same numbers: a
 * loop's or transition's scale against its clip is its recorded
 * `inspect.scale`, else (a loop) what an earlier export measured
 * (`motion.clip`, written by `register-export`); a loop with neither is
 * quoted as cut until its first export measures it. Each motion is quoted
 * trimmed once an export has measured its frames (`motion.riveTrim`), at
 * full size until then. A reverse shares its
 * source's images when `riveReverseIsCurrent` says so — the script's own
 * test.
 */
export function rivePlanFor(project: CharacterProject): RivePlan | null {
  const motions = riveMotions(project);
  const byId = new Map(motions.map((m) => [m.id, m]));
  const edges = new Map(project.provenance.map((e) => [e.toAssetId, e]));
  const lookup = {
    edgeOf: (id: string) => edges.get(id),
    createdAt: (id: string) => project.assetsById.get(id)?.createdAt,
  };
  const inputs = motions.map((m): RivePlanInput | null => {
    const size = frameSize(project, m);
    const clipScale = m.kind === "loop"
      ? (m.inspect?.scale ?? m.clip?.scale)
      : m.kind === "transition" ? m.inspect?.scale : undefined;
    const source = m.kind === "transition" && m.reverseOf ? byId.get(m.reverseOf) : undefined;
    const shares = source && riveReverseIsCurrent(m, source, lookup) ? source.id : undefined;
    return size
      ? {
        id: m.id,
        kind: m.kind === "loop" || m.kind === "transition" ? m.kind : "sprite",
        loop: m.kind === "transition" ? false : m.loop,
        fps: m.fps,
        frames: m.frames.length,
        ...size,
        ...(clipScale ? { clipScale } : {}),
        ...(shares ? { reverseOf: shares } : {}),
        ...(m.riveTrim ? { trim: m.riveTrim } : {}),
      }
      : null;
  });
  return inputs.every((input) => input !== null) && inputs.length > 0
    ? rivePlan(inputs as RivePlanInput[], { filter: riveDefaultFilter(project.sprite.character.style) })
    : null;
}

/**
 * The Export tab's rows for one motion, in display order.
 *
 * Pure: the tab renders exactly this, the tests pin exactly this, and the
 * matrix is the same one the scripts enforce — a loop never offers a GIF or
 * an atlas (the export command refuses both), a run's own files are ready and
 * never regenerated, and the character's `.riv` is offered from every ready
 * motion's tab, holding every ready motion — loops at the plan's defaults,
 * and refused, like the script refuses it, past what a runtime can open.
 */
export function exportRows(
  project: CharacterProject,
  motion: Motion,
  options: ExportRowOptions,
): ExportRow[] {
  const loop = motion.kind === "loop";
  const transition = motion.kind === "transition";
  const ready = motion.status === "ready";
  const frames = motion.frames.length || motion.inspect?.frameCount || 0;
  const rows: ExportRow[] = [];

  const push = (
    family: ExportFamily,
    format: ExportRowFormat,
    state: ExportState,
    builtIn: boolean,
    extra: Partial<ExportRow> = {},
  ) => {
    const key = exportKey(project, format === "riv" ? null : motion, format);
    const current = exportStamp(state);
    const requested =
      options.requests.has(key) && options.requests.get(key) === current && state.kind !== "not-offered";
    rows.push({
      family,
      format,
      key,
      state,
      builtIn,
      canGenerate: options.canRequest && !builtIn && state.kind !== "not-offered",
      requested,
      ...extra,
    });
  };

  const notOffered = (reason: ExportNotOffered): ExportState => ({ kind: "not-offered", reason });

  /** A run's own file: ready when it is there, a reason when it is not. */
  const builtInRow = (family: ExportFamily, format: ExportRowFormat, ids: Array<string | undefined>) => {
    const files = ids.every(Boolean) ? readyFiles(project, ids) : null;
    push(family, format, files ? { kind: "ready", files } : notOffered("not-in-run"), true);
  };

  /** An export made on demand: `<motion>-export-<format>` — or, for a loop's
   *  APNG / WebM / Lottie, the file its own run made (`<motion>-<format>`). */
  const onDemandRow = (family: ExportFamily, format: ExportFormat) => {
    const id = motion.exports?.[format];
    const own = loop && id === `${motion.id}-${format}`;
    const files = id ? readyFiles(project, [id]) : null;
    const state: ExportState = files
      ? { kind: "ready", files }
      : ready
        ? { kind: "missing" }
        : notOffered("not-ready");
    const extra: Partial<ExportRow> = {};
    if (VIDEO_FORMATS.has(format)) {
      const asset = files ? project.assetsById.get(files[0].assetId) : undefined;
      const repeat = finiteOrNull(asset?.metadata.repeat);
      const duration = finiteOrNull(asset?.metadata.duration);
      if (asset && !own && repeat !== null && duration !== null) {
        extra.video = { repeat, seconds: duration, defaulted: false };
      } else if (!files) {
        extra.video = { ...defaultExportRepeat(frames, motion.fps, motion.loop && !transition), defaulted: true };
      }
      const background = asset?.metadata.background;
      if (format === "mp4" && typeof background === "string") extra.background = background;
    }
    push(family, format, state, own, extra);
  };

  // Video
  onDemandRow("video", "mp4");
  onDemandRow("video", "mov");
  onDemandRow("video", "webm");

  // Frame animation. A transition is a one-shot cut from a matted clip: the
  // formats that play once are offered; GIF and an atlas are not, and it has
  // no run-made WebP to list.
  if (loop) push("frames", "gif", notOffered("loop-gif"), false);
  else if (transition) push("frames", "gif", notOffered("transition-gif"), false);
  else builtInRow("frames", "gif", [motion.gif]);
  if (!transition) builtInRow("frames", "webp", [motion.webp]);
  onDemandRow("frames", "apng");
  onDemandRow("frames", "lottie");
  onDemandRow("frames", "png-seq");
  if (loop) push("frames", "sheet", notOffered("loop-atlas"), false);
  else if (transition) push("frames", "sheet", notOffered("transition-atlas"), false);
  else builtInRow("frames", "sheet", [motion.sheet, motion.atlas]);

  // Rive — the whole character: every motion `riveMotions` names, as
  // `rivePlanFor` plans it; transitions counted apart from the motions.
  const holdable = riveMotions(project);
  const isTransition = new Set(project.sprite.motions.filter((m) => m.kind === "transition").map((m) => m.id));
  const split = (ids: string[]) => ({
    motions: ids.filter((id) => !isTransition.has(id)),
    transitions: ids.filter((id) => isTransition.has(id)),
  });
  const plan = rivePlanFor(project);
  const tooHeavy = !!plan && plan.decodeBytes > RIVE_DECODE_LIMIT_BYTES;
  const rivId = project.sprite.exports?.riv;
  const rivFiles = rivId ? readyFiles(project, [rivId]) : null;
  if (rivFiles && rivId) {
    const record = rivRecord(project, rivId);
    const decodeBytes = finiteOrNull(project.assetsById.get(rivId)?.metadata.estimatedDecodeBytes);
    const loopIds = new Set(holdable.filter((m) => m.kind === "loop").map((m) => m.id));
    push("rive", "riv", { kind: "ready", files: rivFiles }, false, {
      canGenerate: options.canRequest && !tooHeavy,
      rive: {
        ...split(record.motions),
        missing: holdable.map((m) => m.id).filter((id) => !record.motions.includes(id)),
        ...(decodeBytes === null ? {} : { decodeBytes }),
        loops: loopSummary(record.sampled.filter((e) => loopIds.has(e.motion))),
        tooHeavy,
        ...(record.machine ? { machine: record.machine } : {}),
      },
    });
  } else {
    push("rive", "riv", !ready ? notOffered("not-ready") : tooHeavy ? notOffered("too-heavy") : { kind: "missing" }, false, {
      rive: {
        ...split(holdable.map((m) => m.id)),
        missing: [],
        ...(plan ? { decodeBytes: plan.decodeBytes } : {}),
        loops: loopSummary(plan ? plan.motions.filter((m) => m.kind === "loop") : []),
        tooHeavy,
      },
    });
  }

  // Without an agent to ask, a row that is not a download is noise.
  return options.canRequest ? rows : rows.filter((row) => row.state.kind === "ready");
}

/**
 * The notification a Generate button sends: the `export` command, naming the
 * character, the motion (not for the `.riv`, which is the whole character),
 * the format and — for MP4, the one format flattened onto a colour — the
 * background the user chose. The agent's briefing for it is the skill's
 * Commands and Exporting sections; nothing here is an instruction beyond
 * "do it and register it".
 */
export function exportRequestNotification(request: {
  project: CharacterProject;
  motion: Motion | null;
  format: ExportRowFormat;
  background: string | null;
  /** The command's label, as the manifest declares it. */
  label: string;
  /** The Rive row's facts: the motions to put in, and the plan for loops. */
  rive?: RiveRowFacts;
}): ViewerNotification {
  const { project, motion, format, background, label, rive } = request;
  const riv = format === "riv";
  const facts = [
    "command: export",
    `character: ${project.contentSet || "."}`,
    !riv && motion ? `motion: ${motion.id}` : null,
    `format: ${format}`,
    format === "mp4" && background ? `background: ${background}` : null,
    // Named rather than left to the script's default, so the agent sees what
    // the button asked for.
    riv ? `images: ${riveDefaultImages(project.sprite.character.style)}` : null,
    riv && rive?.motions.length ? `motions: ${rive.motions.join(",")}` : null,
    riv && rive?.transitions.length ? `transitions: ${rive.transitions.join(",")}` : null,
    // The settings a Generate asks for — the defaults — not what any one
    // loop ends up at (a 12 fps loop keeps its own rate).
    riv && rive?.loops ? `loops: ${RIVE_LOOP_FPS} fps, longest edge ${RIVE_LOOP_MAX_SIZE} px` : null,
    riv && rive?.loops && rive.decodeBytes !== undefined ? `estimate: ${riveMB(rive.decodeBytes)} MB` : null,
  ].filter(Boolean);
  return {
    type: "sprite-command:export",
    severity: "warning",
    summary: `/export · ${riv || !motion ? project.sprite.character.name : motion.label} · ${format}`,
    message: [
      `The user pressed "${label}" on the sprite stage's Export tab.`,
      facts.join(" · "),
      "Export it and register it, as the skill's Exporting section says.",
    ].join("\n"),
  };
}
