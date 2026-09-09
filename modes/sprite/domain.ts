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

export interface SpriteCharacter {
  name: string;
  /** One paragraph the agent keeps current. */
  description: string;
  /** The style anchor sentence that opens every sheet prompt. */
  style: string;
  /** Default frame cell in px. */
  cell: { width: number; height: number };
  facing?: "left" | "right";
}

export type SpriteRefRole = "turnaround" | "portrait" | "expression" | "custom";

export interface SpriteRef {
  /** The `ref` address key, e.g. `"turnaround"`. */
  id: string;
  /** Asset id, e.g. `"ref-turnaround"`. */
  asset: string;
  role: SpriteRefRole;
  label: string;
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

export type VideoModel = "seedance-2.5" | "h3-max";

export type VideoMode = "i2v" | "first-last" | "r2v";

export interface MotionVideo {
  id: string;
  /** Asset id, e.g. `"attack-video-1"`. */
  asset: string;
  model: VideoModel;
  mode: VideoMode;
  prompt: string;
  status: "generating" | "ready" | "failed";
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
  /** Std-dev in px of the anchor point across frames. */
  anchorDrift: { x: number; y: number };
  /** Largest anchor displacement between consecutive frames. */
  maxJump: number;
  /** (max bbox height − min bbox height) / mean. */
  scaleDrift: number;
  emptyFrames: number[];
  /** Human sentences, e.g. "frame 09 is empty". */
  warnings: string[];
}

export interface Motion {
  id: string;
  label: string;
  /** The sheet prompt actually sent. */
  prompt: string;
  grid: { rows: number; cols: number };
  fps: number;
  loop: boolean;
  anchor: "bottom" | "center";
  status: MotionStatus;
  /** Failure reason or agent remarks. */
  notes?: string;
  sheetRaw?: string;
  sheetAlpha?: string;
  sheet?: string;
  atlas?: string;
  /** Asset ids in playback order. */
  frames: string[];
  gif?: string;
  webp?: string;
  videos: MotionVideo[];
  inspect?: InspectSummary;
}

export interface SpriteSidecar {
  version: 1;
  character: SpriteCharacter;
  refs: SpriteRef[];
  motions: Motion[];
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

function parseInspect(value: unknown): InspectSummary | undefined {
  if (!isRecord(value)) return undefined;
  const cell = isRecord(value.cell) ? value.cell : {};
  const drift = isRecord(value.anchorDrift) ? value.anchorDrift : {};
  const anchorPoint = parsePoint(value.anchorPoint);
  return {
    frameCount: num(value.frameCount, 0),
    cell: { width: num(cell.width, 0), height: num(cell.height, 0) },
    ...(anchorPoint ? { anchorPoint } : {}),
    anchorDrift: { x: num(drift.x, 0), y: num(drift.y, 0) },
    maxJump: num(value.maxJump, 0),
    scaleDrift: num(value.scaleDrift, 0),
    emptyFrames: arr(value.emptyFrames).filter(
      (n): n is number => typeof n === "number",
    ),
    warnings: arr(value.warnings).filter(
      (w): w is string => typeof w === "string",
    ),
  };
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

function parseMotion(value: unknown): Motion | null {
  if (!isRecord(value)) return null;
  const id = optionalStr(value.id);
  if (!id) return null;
  const grid = isRecord(value.grid) ? value.grid : {};
  const inspect = parseInspect(value.inspect);
  return {
    id,
    label: str(value.label, id),
    prompt: str(value.prompt),
    grid: { rows: num(grid.rows, 1), cols: num(grid.cols, 1) },
    fps: num(value.fps, 8),
    loop: value.loop !== false,
    anchor: value.anchor === "center" ? "center" : "bottom",
    status: parseMotionStatus(value.status),
    ...(optionalStr(value.notes) ? { notes: value.notes as string } : {}),
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
    videos: arr(value.videos)
      .map((v): MotionVideo | null => {
        if (!isRecord(v)) return null;
        const vid = optionalStr(v.id);
        if (!vid) return null;
        return {
          id: vid,
          asset: str(v.asset),
          model: v.model === "h3-max" ? "h3-max" : "seedance-2.5",
          mode:
            v.mode === "first-last" || v.mode === "r2v"
              ? (v.mode as VideoMode)
              : "i2v",
          prompt: str(v.prompt),
          status:
            v.status === "ready" || v.status === "failed"
              ? (v.status as MotionVideo["status"])
              : "generating",
        };
      })
      .filter((v): v is MotionVideo => v !== null),
    ...(inspect ? { inspect } : {}),
  };
}

function parseSidecar(value: unknown): SpriteSidecar | null {
  if (!isRecord(value)) return null;
  const character = isRecord(value.character) ? value.character : null;
  if (!character) return null;
  const cell = isRecord(character.cell) ? character.cell : {};
  const facing = character.facing;
  return {
    version: 1,
    character: {
      name: str(character.name, "Untitled"),
      description: str(character.description),
      style: str(character.style),
      cell: { width: num(cell.width, 256), height: num(cell.height, 256) },
      ...(facing === "left" || facing === "right" ? { facing } : {}),
    },
    refs: arr(value.refs)
      .map((r): SpriteRef | null => {
        if (!isRecord(r)) return null;
        const id = optionalStr(r.id);
        if (!id) return null;
        const role = r.role;
        return {
          id,
          asset: str(r.asset, `ref-${id}`),
          role:
            role === "turnaround" ||
            role === "portrait" ||
            role === "expression" ||
            role === "custom"
              ? role
              : "custom",
          label: str(r.label, id),
        };
      })
      .filter((r): r is SpriteRef => r !== null),
    // Declared order IS playback / rail order — never sort here.
    motions: arr(value.motions)
      .map(parseMotion)
      .filter((m): m is Motion => m !== null),
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
