/**
 * What a wait on the stage means, derived from course.json — so the
 * screen says what is actually happening (写稿中 / 拍摄中 / 质检中, and for
 * how long) and can give up: a producer that died without writing
 * `failed`, or a director that never answered, leaves a node
 * `generating` forever, and a spinner that cannot fail is a lie.
 *
 * It also owns the other thing the stage derives from a scene while it
 * plays: which narration line the playhead is on (`lineAt` / `captionAt`).
 */

import type { Clip, CourseNode, ProductionPhase } from "../domain.js";

/** A scene in production for longer than this is presumed stuck. A scene
 * is one to three montage clips, each a minute or so to shoot with its
 * check — so the line sits well past one clip and short of a forgotten
 * process. */
export const PRODUCTION_STALE_MS = 8 * 60_000;
/** A finished clip whose continuations have not appeared for this long. */
export const PREPARING_STALE_MS = 3 * 60_000;
/** The manager's heartbeat (`play.updatedAt`) older than this while work
 * is pending means the process is gone. It writes on every state change
 * and at least once a clip; two minutes of silence is not a slow clip. */
export const MANAGER_SILENT_MS = 2 * 60_000;

/** Statuses that mean the manager is (or should be) working on the node. */
export const IN_PRODUCTION = new Set<CourseNode["status"]>(["scripting", "queued", "generating"]);

export type ProductionState =
  | { kind: "idle" }
  | { kind: "running"; phase: ProductionPhase | undefined; elapsedMs: number | null; stale: boolean }
  | { kind: "failed"; error: string | undefined };

/**
 * `requestedAt` is the viewer's own memory of when the learner asked for
 * a segment that was not in course.json yet; the producer's `startedAt`
 * wins once it exists.
 */
export function productionState(
  node: Pick<CourseNode, "status" | "startedAt" | "phase" | "error">,
  requestedAt: number | null,
  now: number,
  staleMs: number = PRODUCTION_STALE_MS,
): ProductionState {
  if (node.status === "failed") return { kind: "failed", error: node.error };
  if (IN_PRODUCTION.has(node.status) || requestedAt != null) {
    const started = node.startedAt ? Date.parse(node.startedAt) : NaN;
    const since = Number.isFinite(started) ? started : requestedAt;
    const elapsedMs = since != null ? Math.max(0, now - since) : null;
    return { kind: "running", phase: node.phase, elapsedMs, stale: elapsedMs != null && elapsedMs > staleMs };
  }
  return { kind: "idle" };
}

export function waitState(sinceMs: number, now: number, staleMs: number = PREPARING_STALE_MS): { elapsedMs: number; stale: boolean } {
  const elapsedMs = Math.max(0, now - sinceMs);
  return { elapsedMs, stale: elapsedMs > staleMs };
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PHASE_LABEL: Record<ProductionPhase, string> = {
  script: "写稿中",
  shoot: "拍摄中",
  qa: "质检中",
};

export function phaseLabel(phase: ProductionPhase | undefined): string {
  return phase ? PHASE_LABEL[phase] : "拍摄中";
}

/**
 * What a card or the placeholder says about a scene in production:
 * "排队中" before its slot, "写稿中" for a detour being written, and
 * "拍摄中 2/3" / "质检中 2/3" while its montage clips are made. A scene
 * that is one clip reads without the fraction.
 *
 * The fraction carries no unit on purpose: everywhere else in this
 * viewer 段 means the SCENE the learner is watching ("这一段没拍成"), and
 * labelling clips with the same word inside a scene card would make two
 * different things share one noun.
 */
export function productionLabel(
  node: Pick<CourseNode, "status" | "phase" | "clipIndex" | "clipCount">,
): string {
  if (node.status === "queued") return "排队中";
  if (node.status === "scripting") return PHASE_LABEL.script;
  const base = phaseLabel(node.phase);
  if (node.phase !== "script" && node.clipIndex && node.clipCount && node.clipCount > 1) {
    return `${base} ${node.clipIndex}/${node.clipCount}`;
  }
  return base;
}

/**
 * Whether the manager has gone silent: something is pending — a scene in
 * production, or the one the learner is waiting for not ready — and the
 * snapshot has not moved for `silentMs`. A course with no snapshot at
 * all has no manager yet (the director is still preparing), which is
 * not silence.
 */
export function managerSilent(
  play: { updatedAt?: string } | undefined,
  pending: boolean,
  now: number,
  silentMs: number = MANAGER_SILENT_MS,
): { silent: boolean; sinceMs: number | null } {
  const at = play?.updatedAt ? Date.parse(play.updatedAt) : NaN;
  if (!Number.isFinite(at)) return { silent: false, sinceMs: null };
  const sinceMs = Math.max(0, now - at);
  return { silent: pending && sinceMs > silentMs, sinceMs };
}

// ── The caption's lookup ────────────────────────────────────────────────

/** Where in a scene the playhead is: which montage clip, and which of
 * that clip's narration lines. */
export interface LinePosition {
  clip: number;
  line: number;
}

/** All the caption needs of a clip: how long it runs and what it says. */
type ClipTiming = Pick<Clip, "duration" | "video" | "narration">;

/** What a clip is worth on the stage's timeline: what was measured once
 * it was shot, else what was planned. */
const clipSeconds = (c: Pick<Clip, "duration" | "video">): number => c.video?.duration || c.duration || 0;

/**
 * The line being spoken at `seconds` into a clip: the one whose
 * `[from, to)` contains the playhead, and between two lines (or past the
 * last one) the last line that was spoken — a caption that blinks off
 * mid-scene reads as a bug, and the last thing said is still the truest
 * thing on screen. A clip that says nothing is line 0.
 */
function lineIndexAt(lines: ReadonlyArray<{ from: number; to: number }>, seconds: number): number {
  let best = 0;
  let bestFrom = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (seconds >= l.from && seconds < l.to) return i;
    if (l.from <= seconds && l.from > bestFrom) {
      best = i;
      bestFrom = l.from;
    }
  }
  return best;
}

/**
 * Where the playhead is in a scene, resolved to one narration line.
 *
 * The scene's video is its clips concatenated, so a position inside it is
 * only meaningful once the clips before the current one are subtracted:
 * `seconds - sum(earlier clip lengths)` is the offset inside the clip,
 * and that is what the clip's narration windows are written against.
 * Past the end of the scene the last clip's last line stays up.
 */
export function lineAt(clips: ReadonlyArray<ClipTiming>, seconds: number): LinePosition {
  if (clips.length === 0) return { clip: 0, line: 0 };
  let offset = 0;
  let clip = 0;
  for (let i = 0; i < clips.length; i++) {
    clip = i;
    const span = clipSeconds(clips[i]);
    if (seconds < offset + span) break;
    // Past every clip: stay on the last one, at its own offset.
    if (i < clips.length - 1) offset += span;
  }
  return { clip, line: lineIndexAt(clips[clip].narration, seconds - offset) };
}

/**
 * The caption under the stage at `seconds` into the scene: the narration
 * line being spoken, or the scene's whole text when it has no timed
 * narration (a scene written before 0.6 whose script.md is all there is).
 */
export function captionAt(node: Pick<CourseNode, "clips" | "script">, seconds: number): string {
  const at = lineAt(node.clips, seconds);
  return node.clips[at.clip]?.narration[at.line]?.text || node.script;
}
