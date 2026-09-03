/**
 * What a wait on the stage means, derived from course.json — so the
 * screen says what is actually happening (写稿中 / 拍摄中 / 质检中, and for
 * how long) and can give up: a producer that died without writing
 * `failed`, or a director that never answered, leaves a node
 * `generating` forever, and a spinner that cannot fail is a lie.
 */

import type { CourseNode, ProductionPhase, Shot } from "../domain.js";

/** A scene in production for longer than this is presumed stuck. A scene
 * is up to six shots, each a minute or so with its check — so the line
 * sits well past one shot and short of a forgotten process. */
export const PRODUCTION_STALE_MS = 8 * 60_000;
/** A finished clip whose continuations have not appeared for this long. */
export const PREPARING_STALE_MS = 3 * 60_000;
/** The manager's heartbeat (`play.updatedAt`) older than this while work
 * is pending means the process is gone. It writes on every state change
 * and at least once a shot; two minutes of silence is not a slow shot. */
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
 * "拍摄中 2/3" / "质检中 2/3" while its shots are made. A scene that is
 * one shot reads without the fraction.
 */
export function productionLabel(
  node: Pick<CourseNode, "status" | "phase" | "shotIndex" | "shotCount">,
): string {
  if (node.status === "queued") return "排队中";
  if (node.status === "scripting") return PHASE_LABEL.script;
  const base = phaseLabel(node.phase);
  if (node.phase !== "script" && node.shotIndex && node.shotCount && node.shotCount > 1) {
    return `${base} ${node.shotIndex}/${node.shotCount}`;
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

/**
 * The shot whose narration is being spoken at `seconds` into the scene's
 * clip, by the shots' actual durations (planned ones when a clip has no
 * measured length). The caption under the stage follows it.
 */
export function shotAt(shots: ReadonlyArray<Pick<Shot, "duration" | "video">>, seconds: number): number {
  let t = 0;
  for (let i = 0; i < shots.length; i++) {
    const d = shots[i].video?.duration || shots[i].duration || 0;
    t += d;
    if (seconds < t) return i;
  }
  return Math.max(0, shots.length - 1);
}
