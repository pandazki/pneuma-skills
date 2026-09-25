/**
 * Types for `rive.mjs` — the script stays plain ESM, the declaration keeps
 * `tsc --noEmit` honest for the TypeScript suites that import it.
 */

export declare const RIVE_STATE_MACHINE: string;
/** The number input that names the loop a character should be in. */
export declare const RIVE_MOTION_INPUT: string;

export declare function riveTriggerName(motionId: string): string;

/** What the state machine needs to know of a motion to route through it. */
export interface RiveGraphMotion {
  id: string;
  loop: boolean;
  kind?: "loop" | "sprite" | "transition";
  /** A transition's first pose: loop `from`'s frame 0. */
  from?: string;
  /** A transition's last pose: loop `to`'s frame 0. */
  to?: string;
}

export declare function riveDefaultMotion(motions: RiveGraphMotion[]): number;

/** Index of the hub loop; -1 when nothing loops. Throws on a bad `hubId`. */
export declare function riveHub(motions: RiveGraphMotion[], hubId?: string | null): number;

export interface RiveExit {
  to: string;
  /** The `motion` value this exit needs; null for none. Every exit waits
   *  for 100 % exit time. */
  when: number | null;
}

export type RiveRouteStep = { transition: string } | { cut: { from: string; to: string } };

export interface RiveNumberInput {
  name: string;
  default: number;
  values: Array<{ value: number; motion: string }>;
}

export interface RiveGraph {
  hub: string | null;
  entry: string;
  number: RiveNumberInput | null;
  triggers: Array<{ name: string; motion: string }>;
  any: Array<{ to: string; trigger: string }>;
  states: Array<{ motion: string; exits: RiveExit[] }>;
  routes: Array<{ from: string; to: string; steps: RiveRouteStep[] }>;
  /** Every edge whose two sides do not share a pose: `from`'s last frame
   *  against `to`'s first. `from: null` is a one-shot fired from anywhere. */
  cuts: Array<{ from: string | null; to: string }>;
}

export declare function riveStateMachine(motions: RiveGraphMotion[], options?: { hub?: string | null }): RiveGraph;

export interface RiveTimeline {
  /** The timeline's integer rate. */
  fps: number;
  /** Length in timeline frames. */
  duration: number;
  /** Timeline frame of each source frame. */
  keys: number[];
}

export declare function riveTimeline(fps: number, frameCount: number): RiveTimeline;

export interface RiveFrameSpec {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** The anchor inside this frame, in its own pixels. */
  pivot: { x: number; y: number };
  /** Where a trimmed frame's pixels sat in the full frame, and the full frame's size; `pivot` is then in full-frame pixels. */
  trim?: { x: number; y: number; width: number; height: number };
  ext?: "png" | "webp";
}

/** Another motion's embedded frame, shown again (a reverse transition). */
export interface RiveSharedFrameSpec {
  shared: { motion: string; index: number };
}

export interface RiveMotionSpec extends RiveGraphMotion {
  fps: number;
  frames: Array<RiveFrameSpec | RiveSharedFrameSpec>;
}

export interface RiveSpec {
  artboard: { name: string; width: number; height: number };
  /** Where every frame's pivot lands on the artboard. */
  anchor: { x: number; y: number };
  motions: RiveMotionSpec[];
  /** The loop routes pass through; the looping idle by default. */
  hub?: string | null;
}

export type RiveInput =
  | { name: string; type: "number"; default: number; values: Array<{ value: number; motion: string }> }
  | { name: string; type: "trigger"; motion: string };

export interface RiveWritten {
  bytes: Buffer;
  inexactPlacements: number;
  animations: Array<{ motion: string; fps: number; duration: number; loop: boolean; seconds: number }>;
  stateMachine: {
    name: string;
    hub: string | null;
    defaultMotion: string;
    inputs: RiveInput[];
    routes: Array<{ from: string; to: string; steps: RiveRouteStep[]; seconds: number }>;
    cuts: Array<{ from: string | null; to: string }>;
    /** Each loop's worst-case wait before it leaves: its cycle. */
    waits: Array<{ motion: string; seconds: number }>;
  };
}

export declare function writeRiv(spec: RiveSpec): RiveWritten;
export declare function riveTrimRect(
  rgba: Uint8Array,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null;
export declare function riveTrimmedPosition(anchor: number, pivot: number, fullSize: number, offset: number): { position: number; exact: boolean };
