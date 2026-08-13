/**
 * The narration plan — what the `narrate` action answers (T10).
 *
 * The agent cannot compute step hashes (an installed skill script cannot
 * import the engine), so the VIEWER derives the plan from the live lecture
 * and hands every fact the agent needs: which steps want a voice, the
 * exact cache key per step, the suggested spoken text and clip path, and
 * which manifest entries are already fresh. Freshness is pure hash
 * membership — editing one sentence changes exactly one hash, so exactly
 * one entry flips to "needs-audio" and nothing else re-synthesizes.
 */

import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import type { Lecture, StepRef } from "../engine/types.js";
import type { NarrationManifest } from "./types.js";

export interface NarrationPlanEntry {
  ref: StepRef;
  /** The clip cache key — `stepContentHash(step, lecture.source)`. */
  hash: string;
  /**
   * Suggested spoken text (the step's plain board text). Empty for steps
   * whose voice the agent must write by hand — a formula contributes zero
   * characters yet is hand-voiceable, so it appears with an empty line
   * and status "silent" (see below).
   */
  text: string;
  /** Clip file relative to the content set — existing, or the suggestion. */
  file: string;
  /**
   * "ready" = fresh clip on disk; "needs-audio" = a clip is owed (prose
   * without one, or a recorded clip whose file is confirmed missing);
   * "silent" = a formula with no clip — not owed one, never counted as
   * needs-audio noise, listed so the agent can take its cache key when it
   * chooses to voice it by hand (M5: the key must be obtainable BEFORE
   * the first clip exists, or the workflow is circular).
   */
  status: "ready" | "needs-audio" | "silent";
}

export interface NarrationPlan {
  entries: NarrationPlanEntry[];
  /** Manifest hashes matching no current step — safe to delete. */
  orphans: string[];
}

export function buildNarrationPlan(
  lecture: Lecture,
  manifest: NarrationManifest | null,
  /**
   * Hashes whose clip file is CONFIRMED absent on disk (the runner's
   * async `/api/file` probe — see `probeMissingClips`). A recorded entry
   * with no file must not report ready: it would "play" silence while its
   * `seconds` still paces the writing. Flipping it back to needs-audio is
   * what routes the agent to re-synthesize to the same path.
   */
  missingClips: ReadonlySet<string> = new Set(),
): NarrationPlan {
  const clips = manifest?.clips ?? {};
  const entries: NarrationPlanEntry[] = [];
  const liveHashes = new Set<string>();

  for (const { ref, step } of flattenSteps(lecture)) {
    const hash = stepContentHash(step, lecture.source);
    liveHashes.add(hash);
    const clip = clips[hash];
    const text = stepPlainText(step).trim();
    // Narratable = has prose to speak, already hand-voiced, or a formula
    // (zero characters to the board, yet hand-voiceable — its cache key
    // must be obtainable from THIS plan before any clip exists). Waits,
    // rules, charts and structure stay out instead of being listed as
    // forever-"needs-audio" noise; they speak through the pen.
    if (text === "" && !clip && step.kind !== "math") continue;
    entries.push({
      ref,
      hash,
      text,
      // `.mp3` because the board's voice is Seed-Speech, which returns mp3
      // or opus and no WAV at all. A clip ALREADY recorded keeps whatever
      // path its manifest entry names — a lecture voiced before this change
      // keeps its `.wav` files and plays exactly as it did; only clips not
      // yet synthesized are proposed under the new extension.
      file: clip?.file ?? `narration/${hash}.mp3`,
      status: clip
        ? missingClips.has(hash)
          ? "needs-audio"
          : "ready"
        : text === ""
          ? "silent"
          : "needs-audio",
    });
  }

  return {
    entries,
    orphans: Object.keys(clips).filter((hash) => !liveHashes.has(hash)),
  };
}
