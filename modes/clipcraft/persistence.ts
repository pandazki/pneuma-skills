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
} from "@pneuma-craft/core";
import type { CompositionCommand } from "@pneuma-craft/timeline";

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

  // 2. Register every asset. The on-disk `id` is preserved and passed through
  //    to craft so disk↔memory references stay stable across hydration.
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
    } as CoreCommand, ts));
  }

  // 3. Provenance edges. fromAssetId === null → set-root; otherwise link.
  for (const edge of file.provenance) {
    if (edge.fromAssetId === null) {
      cmds.push(makeEnvelope("human", {
        type: "provenance:set-root",
        assetId: edge.toAssetId,
        operation: edge.operation,
      } as CoreCommand, ts));
    } else {
      cmds.push(makeEnvelope("human", {
        type: "provenance:link",
        fromAssetId: edge.fromAssetId,
        toAssetId: edge.toAssetId,
        operation: edge.operation,
      } as CoreCommand, ts));
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
