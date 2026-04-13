/**
 * ClipCraft on-disk project schema + hydration command builder.
 *
 * Plan 2 scope: read-only. Converts a parsed ProjectFile into a sequence of
 * craft CommandEnvelopes (hydration-via-events) so the craft store rebuilds
 * itself from disk without bypassing the event log. Writes come in Plan 3.
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

export interface ProjectFile {
  $schema: "pneuma-craft/project/v1";
  title: string;
  composition: ProjectComposition;
  assets: ProjectAsset[];
  provenance: ProjectProvenanceEdge[];
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
 *        → composition:add-clip* (per track).
 *
 * Ids are preserved: asset.id, track.id, clip.id from the on-disk file are
 * passed through to craft's commands unchanged (Plan 3a). Craft rejects
 * duplicate ids at dispatch time, so the hook's try/catch will log and
 * continue if the same content is accidentally hydrated twice.
 *
 * Timestamps are preserved too (Plan 3c): asset envelopes use asset.createdAt
 * and provenance envelopes use operation.timestamp, so dispatchEnvelope
 * callers get a lossless round-trip of the on-disk file's temporal metadata.
 * Composition-related envelopes use Date.now() since the schema has no
 * meaningful timestamp for those commands.
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

  // 4. Tracks + clips
  const tracks: ProjectTrack[] = composition
    ? composition.tracks.map((track) => ({
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
      }))
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
