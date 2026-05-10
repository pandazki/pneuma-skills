/**
 * ClipCraft on-disk project schema, hydration command builder, and inverse
 * serializer. Parsing turns project.json into a sequence of craft
 * CommandEnvelopes (hydration-via-events) so the store rebuilds itself from
 * disk without bypassing the event log; serializeProject walks the live
 * store back to a ProjectFile byte-for-byte equivalent to the on-disk input.
 */

import type {
  Actor,
  AssetStatus,
  AssetType,
  CommandEnvelope,
  CoreCommand,
  Operation,
  PneumaCraftCoreState,
} from "@pneuma-craft/core";
import type { Composition, CompositionCommand } from "@pneuma-craft/timeline";

// ── On-disk types ────────────────────────────────────────────────────────

export interface ProjectAsset {
  id: string;
  type: AssetType;
  uri: string;
  name: string;
  metadata: Record<string, number | string | undefined>;
  createdAt: number;
  tags?: string[];
  status?: AssetStatus;
}

export interface ProjectClip {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  text?: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface ProjectPreviewFrame {
  id: string;
  trackId: string;
  time: number;
  assetId: string;
}

export type ProjectTrackType = "video" | "audio" | "subtitle";

export interface ProjectTrack {
  id: string;
  type: ProjectTrackType;
  name: string;
  muted: boolean;
  volume: number;
  locked: boolean;
  visible: boolean;
  clips: ProjectClip[];
  previewFrames?: ProjectPreviewFrame[];
}

export interface ProjectTransition {
  id: string;
  type: "cut" | "crossfade" | "fade-to-black";
  duration: number;
  fromClipId: string;
  toClipId: string;
}

export interface ProjectComposition {
  settings: {
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
    sampleRate?: number;
  };
  tracks: ProjectTrack[];
  transitions: ProjectTransition[];
}

export interface ProjectProvenanceEdge {
  toAssetId: string;
  fromAssetId: string | null;
  operation: Operation;
}

// ── Scene (mode-local logical grouping) ──────────────────────────────────
//
// A Scene is a view over existing craft clips — it does not partition
// the composition. A clip can belong to 0 or 1 scenes. Scenes survive
// round-trip but are never dispatched as craft commands: they live only
// in the mode's React context tree.
export interface ProjectScene {
  id: string;
  order: number;
  title: string;
  prompt?: string;
  memberClipIds: string[];
  memberAssetIds: string[];
}

/**
 * Caption overlay styling — mode-local sidecar. Rasterized onto the craft
 * preview and export canvases by
 * modes/clipcraft/viewer/preview/subtitleRenderer.ts, which is wired into
 * PneumaCraftProvider so preview and export stay pixel-identical. All
 * fields optional so legacy project files remain valid.
 */
export interface CaptionStyle {
  fontSize?: number;       // px, default 16
  color?: string;          // default "#ffffff"
  background?: string;     // default "rgba(0,0,0,0.65)"
  bottomPercent?: number;  // 0..1, default 0.08
  fontWeight?: number;     // default 400
  maxWidthPercent?: number; // default 0.9
}

export interface ProjectFile {
  $schema: "pneuma-craft/project/v1";
  title: string;
  composition: ProjectComposition;
  assets: ProjectAsset[];
  provenance: ProjectProvenanceEdge[];
  /** Mode-local scene grouping — optional; not part of craft state. */
  scenes?: ProjectScene[];
  /** Mode-local caption overlay styling — see Task 3. */
  captionStyle?: CaptionStyle;
}

// ── Parse + validate ─────────────────────────────────────────────────────

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseProjectFile(raw: string): ParseResult<ProjectFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
  }
  return validateProjectFile(parsed);
}

function validateProjectFile(value: unknown): ParseResult<ProjectFile> {
  if (!isObject(value)) return { ok: false, error: "Root must be an object" };
  if (value.$schema !== "pneuma-craft/project/v1") {
    return { ok: false, error: `Unsupported $schema: ${String(value.$schema)}` };
  }
  if (typeof value.title !== "string") return { ok: false, error: "title must be a string" };
  if (!isObject(value.composition)) return { ok: false, error: "composition is required" };
  if (!Array.isArray(value.assets)) return { ok: false, error: "assets must be an array" };
  if (!Array.isArray(value.provenance)) return { ok: false, error: "provenance must be an array" };

  // Validate tracks and their previewFrames
  if (!Array.isArray(value.composition.tracks)) {
    return { ok: false, error: "composition.tracks must be an array" };
  }
  for (let trackIdx = 0; trackIdx < value.composition.tracks.length; trackIdx++) {
    const track = value.composition.tracks[trackIdx];
    if (!isObject(track)) {
      return { ok: false, error: `composition.tracks[${trackIdx}] must be an object` };
    }
    // Validate previewFrames if present
    if (track.previewFrames !== undefined) {
      if (!Array.isArray(track.previewFrames)) {
        return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames must be an array` };
      }
      for (let pfIdx = 0; pfIdx < track.previewFrames.length; pfIdx++) {
        const pf = track.previewFrames[pfIdx];
        if (!isObject(pf)) {
          return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames[${pfIdx}] must be an object` };
        }
        if (typeof pf.id !== "string") {
          return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames[${pfIdx}].id must be a string` };
        }
        if (typeof pf.trackId !== "string") {
          return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames[${pfIdx}].trackId must be a string` };
        }
        if (typeof pf.time !== "number" || pf.time < 0) {
          return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames[${pfIdx}].time must be a non-negative number` };
        }
        if (typeof pf.assetId !== "string") {
          return { ok: false, error: `composition.tracks[${trackIdx}].previewFrames[${pfIdx}].assetId must be a string` };
        }
      }
    }
  }

  if (value.scenes !== undefined) {
    if (!Array.isArray(value.scenes)) {
      return { ok: false, error: "scenes must be an array" };
    }
    for (const s of value.scenes) {
      if (!isObject(s)) return { ok: false, error: "scene entries must be objects" };
      if (typeof s.id !== "string") return { ok: false, error: "scene.id must be a string" };
      if (typeof s.order !== "number") return { ok: false, error: "scene.order must be a number" };
      if (typeof s.title !== "string") return { ok: false, error: "scene.title must be a string" };
      if (!Array.isArray(s.memberClipIds)) return { ok: false, error: "scene.memberClipIds must be an array" };
      if (!Array.isArray(s.memberAssetIds)) return { ok: false, error: "scene.memberAssetIds must be an array" };
    }
  }
  if (value.captionStyle !== undefined && !isObject(value.captionStyle)) {
    return { ok: false, error: "captionStyle must be an object" };
  }

  // Structural checks only — individual shape errors surface downstream via
  // craft's command validation during hydration, which gives clearer errors
  // than a second-level schema check would.
  return { ok: true, value: value as unknown as ProjectFile };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Hydration: ProjectFile → CommandEnvelope[] ───────────────────────────

// Per-call counter — `projectFileToCommands` resets this to 0 at entry so each
// hydration produces deterministic envelope ids and concurrent calls don't
// interleave. Not a global sequence.
let envelopeSeq = 0;
function makeEnvelope(
  actor: Actor,
  command: CoreCommand | CompositionCommand,
  timestamp: number,
): CommandEnvelope<CoreCommand | CompositionCommand> {
  envelopeSeq += 1;
  return {
    id: `hydrate-${envelopeSeq}`,
    actor,
    timestamp,
    command,
  };
}

/**
 * Turn a validated ProjectFile into a sequence of craft commands that, when
 * dispatched in order, reproduce the on-disk state inside the craft store.
 *
 * Order: composition:create → asset:register* → provenance:* → composition:add-track*
 *        → composition:add-clip* (per track) → composition:add-preview-frame* (per track).
 *
 * Ids are preserved: asset.id, track.id, clip.id, preview-frame.id from the on-disk file are
 * passed through to craft's commands unchanged (Plan 3a). Craft rejects
 * duplicate ids at dispatch time, so the hook's try/catch will log and
 * continue if the same content is accidentally hydrated twice.
 *
 * Timestamps are preserved too (Plan 3c): asset envelopes use asset.createdAt
 * and provenance envelopes use operation.timestamp, so dispatchEnvelope
 * callers get a lossless round-trip of the on-disk file's temporal metadata.
 * Composition-related envelopes use Date.now() since the schema has no
 * meaningful timestamp for those commands.
 *
 * NOTE: scenes[] and captionStyle are deliberately ignored here. They are
 * mode-local UI state owned by the ClipCraft viewer's React tree and never
 * round-trip through the craft store. Task 2+ reads them via useScenes().
 */
export function projectFileToCommands(
  file: ProjectFile,
): CommandEnvelope<CoreCommand | CompositionCommand>[] {
  envelopeSeq = 0;
  const ts = Date.now();
  const cmds: CommandEnvelope<CoreCommand | CompositionCommand>[] = [];

  // 1. Create the composition shell
  cmds.push(makeEnvelope("human", {
    type: "composition:create",
    settings: file.composition.settings,
  } as CompositionCommand, ts));

  // 2. Register every asset. ID is preserved (Plan 3a). Timestamp derived
  //    from the on-disk createdAt so round-tripping through dispatchEnvelope
  //    preserves it (Plan 3c).
  for (const asset of file.assets) {
    cmds.push(makeEnvelope("human", {
      type: "asset:register",
      asset: {
        id: asset.id,
        type: asset.type,
        uri: asset.uri,
        name: asset.name,
        metadata: asset.metadata as never,
        ...(asset.tags ? { tags: asset.tags } : {}),
        ...(asset.status ? { status: asset.status } : {}),
      },
    } as CoreCommand, asset.createdAt));
  }

  // 3. Provenance edges. Timestamp derived from operation.timestamp so
  //    round-tripping through dispatchEnvelope preserves it.
  for (const edge of file.provenance) {
    if (edge.fromAssetId === null) {
      cmds.push(makeEnvelope("human", {
        type: "provenance:set-root",
        assetId: edge.toAssetId,
        operation: edge.operation,
      } as CoreCommand, edge.operation.timestamp));
    } else {
      cmds.push(makeEnvelope("human", {
        type: "provenance:link",
        fromAssetId: edge.fromAssetId,
        toAssetId: edge.toAssetId,
        operation: edge.operation,
      } as CoreCommand, edge.operation.timestamp));
    }
  }

  // 4. Tracks and clips.
  for (const track of file.composition.tracks) {
    cmds.push(makeEnvelope("human", {
      type: "composition:add-track",
      track: {
        id: track.id,
        type: track.type,
        name: track.name,
        clips: [],
        muted: track.muted,
        volume: track.volume,
        locked: track.locked,
        visible: track.visible,
      },
    } as CompositionCommand, ts));

    for (const clip of track.clips) {
      cmds.push(makeEnvelope("human", {
        type: "composition:add-clip",
        trackId: track.id,
        clip: {
          id: clip.id,
          assetId: clip.assetId,
          startTime: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          ...(clip.text !== undefined ? { text: clip.text } : {}),
          ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
          ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
          ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
        },
      } as CompositionCommand, ts));
    }

    // 4b. Preview frames — emitted after all clips for this track so the
    //     track exists in craft state. Preserves id so locator-card references
    //     survive hydration.
    if (track.previewFrames) {
      for (const pf of track.previewFrames) {
        cmds.push(makeEnvelope("human", {
          type: "composition:add-preview-frame",
          trackId: pf.trackId,
          time: pf.time,
          assetId: pf.assetId,
          id: pf.id,
        } as CompositionCommand, ts));
      }
    }
  }

  return cmds;
}

// ── Serialize: TimelineCore state → ProjectFile ───────────────────────────

// Default settings used when the core has no composition yet. Matches the
// seed project.json so a fresh load produces a stable, recognizable shape.
const DEFAULT_SETTINGS: ProjectComposition["settings"] = {
  width: 1920,
  height: 1080,
  fps: 30,
  aspectRatio: "16:9",
};

/**
 * Serialize craft state to a ProjectFile. Inverse of projectFileToCommands.
 *
 * Relies on Plan 3a's id stability: every asset/track/clip in the core state
 * carries the on-disk id that was dispatched, so serialization is a direct
 * field rename + array walk. Field order matches projectFileToCommands's
 * dispatch order so a round-trip through parse → hydrate → serialize produces
 * byte-equal output given identical input.
 *
 * The `title` argument is a side-channel: craft's domain model has no concept
 * of a project title, so callers must thread it through manually (the viewer
 * keeps it in `currentTitleRef` between hydrate and serialize).
 */
export function serializeProject(
  coreState: PneumaCraftCoreState,
  composition: Composition | null,
  title: string = "Untitled",
  scenes: ProjectScene[] = [],
  captionStyle: CaptionStyle | undefined = undefined,
): ProjectFile {
  // 1. Settings (fall back to defaults when composition is null)
  const settings: ProjectComposition["settings"] = composition
    ? {
        width: composition.settings.width,
        height: composition.settings.height,
        fps: composition.settings.fps,
        aspectRatio: composition.settings.aspectRatio,
        ...(composition.settings.sampleRate !== undefined
          ? { sampleRate: composition.settings.sampleRate }
          : {}),
      }
    : { ...DEFAULT_SETTINGS };

  // 2. Assets — iterate registry in insertion order (Map preserves it)
  const assets: ProjectAsset[] = [];
  for (const asset of coreState.registry.values()) {
    assets.push({
      id: asset.id,
      type: asset.type,
      uri: asset.uri,
      name: asset.name,
      metadata: asset.metadata as Record<string, number | string | undefined>,
      createdAt: asset.createdAt,
      ...(asset.status ? { status: asset.status } : {}),
      ...(asset.tags ? { tags: [...asset.tags] } : {}),
    });
  }

  // 3. Provenance edges — iterate edges Map
  const provenance: ProjectProvenanceEdge[] = [];
  for (const edge of coreState.provenance.edges.values()) {
    provenance.push({
      toAssetId: edge.toAssetId,
      fromAssetId: edge.fromAssetId,
      // Field order matches the seed project.json so a clean round-trip is
      // byte-equal: type, actor, agentId?, timestamp, label?, params?.
      operation: {
        type: edge.operation.type,
        actor: edge.operation.actor,
        ...(edge.operation.agentId !== undefined
          ? { agentId: edge.operation.agentId }
          : {}),
        timestamp: edge.operation.timestamp,
        ...(edge.operation.label !== undefined
          ? { label: edge.operation.label }
          : {}),
        ...(edge.operation.params !== undefined
          ? { params: { ...edge.operation.params } }
          : {}),
      },
    });
  }

  // 4. Tracks + clips + previewFrames.
  //
  // Field order on each track mirrors the on-disk seed shape:
  //   id, type, name, muted, volume, locked, visible, clips, previewFrames?
  //
  // previewFrames is only emitted when the track has at least one frame —
  // legacy project.json files (pre-storyboard) had no field, and we want
  // them to round-trip byte-identically. This mirrors how scenes/captionStyle
  // are conditionally emitted at the top level.
  const tracks: ProjectTrack[] = composition
    ? composition.tracks.map((track) => {
        const previewFrames: ProjectPreviewFrame[] = track.previewFrames.map((pf) => ({
          id: pf.id,
          trackId: pf.trackId,
          time: pf.time,
          assetId: pf.assetId,
        }));
        return {
          id: track.id,
          type: track.type,
          name: track.name,
          muted: track.muted,
          volume: track.volume,
          locked: track.locked,
          visible: track.visible,
          clips: track.clips.map((clip) => ({
            id: clip.id,
            assetId: clip.assetId,
            startTime: clip.startTime,
            duration: clip.duration,
            inPoint: clip.inPoint,
            outPoint: clip.outPoint,
            ...(clip.text !== undefined ? { text: clip.text } : {}),
            ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
            ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
            ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
          })),
          ...(previewFrames.length > 0 ? { previewFrames } : {}),
        };
      })
    : [];

  // 5. Transitions — pass through (currently unused)
  const transitions: ProjectTransition[] = composition
    ? [...composition.transitions]
    : [];

  return {
    $schema: "pneuma-craft/project/v1",
    title,
    composition: { settings, tracks, transitions },
    assets,
    provenance,
    ...(scenes.length > 0 ? { scenes } : {}),
    ...(captionStyle !== undefined ? { captionStyle } : {}),
  };
}

/**
 * Format a ProjectFile as JSON for disk. 2-space indent + trailing newline.
 * Kept separate from serializeProject so tests can assert structure without
 * being brittle about whitespace.
 */
export function formatProjectJson(file: ProjectFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}
