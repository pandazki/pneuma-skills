import type { AlphaImage } from "./alpha-clean.mjs";
export interface AnimationDiagnosticsOptions { durationsMs?: number[] | null; timingSource?: string; loop?: boolean | null; duplicateStep?: number }
export interface AnimationDiagnostics {
  frameCount: number; adjacentPairs: number; adjacentDistinctDrawings: number; drawingCount: number; drawingCountDefinition: string;
  differenceMethod: string; duplicateStep: number; steps: number[]; heldMs: number | null; heldFrameCount: number;
  holds: { from: number; to: number; frames: number; durationMs: number | null; certainty: string }[];
  timing: { source: string; durationsMs: number[] | null; totalMs: number | null };
  wrapStep: number | null;
  changeSpikes: { from: number; to: number; step: number; certainty: string; meaning: string }[];
  alphaMass: number[]; alphaChanges: { from: number; to: number; delta: number; certainty: string }[];
  interpretation: { applicability: string; certainty: string; reason: string }; artisticQuality: string;
}
export declare function diagnoseAnimation(frames: (AlphaImage | { thumb: ArrayLike<number>; alphaMass: number })[], options?: AnimationDiagnosticsOptions): AnimationDiagnostics;
