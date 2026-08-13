/**
 * The narration action responses (T10) — pure builders for what `narrate`
 * and `subtitles` answer, kept out of the component so the agent-facing
 * shapes are pinned by tests instead of read off a runner nobody exercises
 * (the same split as `board-check.ts` for `check-board`).
 *
 * The one path rule both builders enforce: a manifest's `file` field is
 * relative to the CONTENT SET (`NarrationClip.file` contract), while
 * anything the agent passes to a CLI or writes with a tool is relative to
 * the WORKSPACE. The two must never be conflated — handing the agent a
 * set-prefixed string for a manifest field is how `tech-zh/tech-zh/…`
 * compounds one prefix per call — so every step answer carries BOTH,
 * under names that say which is which: `file` (manifest value, echoed
 * verbatim) and `output` (workspace path for synthesis).
 */

import type { ViewerActionResult } from "../../../core/types/viewer-contract.js";
import type { Lecture, StepSchedule } from "../engine/types.js";
import { buildNarrationPlan } from "../narration/plan.js";
import { narrationCues, toSrt, toVtt } from "../narration/subtitles.js";
import type { ClipWindow } from "../narration/timing.js";
import type {
  NarrationClip,
  NarrationManifestRead,
} from "../narration/types.js";
import { toAddress } from "./address.js";

/** Workspace-relative path for a set-relative one (`""` = the root set). */
function inSet(setKey: string, rel: string): string {
  return setKey === "" ? rel : `${setKey}/${rel}`;
}

/**
 * The file-existence channel (R2-F4 / T10-4): manifest "ready" used to be
 * pure hash membership, so an entry whose .wav was deleted or never
 * written still re-paced the writing and — once the conductor landed —
 * "played" silence. The runner probes each recorded clip's WORKSPACE path
 * before answering `narrate`; a hash lands in the returned set only on a
 * CONFIRMED miss (`missing` resolves true — in production, an `/api/file`
 * 404). A probe that cannot answer (network error, server down) accuses
 * nothing: unknown existence must not re-bill a clip that may be fine.
 */
export async function probeMissingClips(
  clips: Readonly<Record<string, NarrationClip>>,
  setKey: string,
  missing: (workspacePath: string) => Promise<boolean>,
): Promise<Set<string>> {
  const verdicts = await Promise.all(
    Object.entries(clips).map(async ([hash, clip]) => {
      try {
        return { hash, missing: await missing(inSet(setKey, clip.file)) };
      } catch {
        return { hash, missing: false }; // cannot answer ≠ missing
      }
    }),
  );
  return new Set(verdicts.filter((v) => v.missing).map((v) => v.hash));
}

/**
 * `narrate` — the voice-over plan. The agent cannot compute step cache
 * keys itself (an installed skill cannot import the engine), so the board
 * answers with everything: per step the address, the key, the suggested
 * spoken line, the manifest `file` value with its workspace `output` twin,
 * and freshness; plus orphaned clips and — crucially — a malformed
 * manifest's parse reason, which must never hide behind the "no manifest,
 * no voice" silence.
 */
export function narrateResponse(
  lecture: Lecture,
  read: NarrationManifestRead | null,
  setKey: string,
  /** Confirmed-absent clip hashes (`probeMissingClips`) — never guesses. */
  missing: ReadonlySet<string> = new Set(),
): ViewerActionResult {
  const plan = buildNarrationPlan(lecture, read?.manifest ?? null, missing);
  const needsAudio = plan.entries.filter((e) => e.status === "needs-audio");
  // Silent formulas are listed (their cache keys must be obtainable here
  // — M5) but never owed a clip, so the speakable counts exclude them.
  const silent = plan.entries.filter((e) => e.status === "silent");
  const speakable = plan.entries.length - silent.length;
  const parts = [
    `${speakable - needsAudio.length} of ${speakable} speakable steps have a fresh clip; ${needsAudio.length} need audio.`,
  ];
  if (silent.length > 0) {
    parts.push(
      `${silent.length} formula step(s) are silent by default — to voice one, write the spoken line yourself, synthesize it to that step's "output", and record it under the step's key (status "silent" in steps[]).`,
    );
  }
  const missingLive = plan.entries.filter((e) => missing.has(e.hash));
  if (missingLive.length > 0) {
    parts.push(
      `${missingLive.length} recorded clip(s) are missing on disk (the manifest entry exists but the audio file does not) — re-synthesize each to its "output" path; the manifest entry is already correct.`,
    );
  }
  if (plan.orphans.length > 0) {
    parts.push(
      `${plan.orphans.length} recorded clip(s) no longer match any step — safe to delete.`,
    );
  }
  if (read?.issue) parts.push(`Manifest problem: ${read.issue}`);
  parts.push(
    // Every field `readNarrationManifest` REQUIRES is named here. An
    // entry missing any one of them is dropped by the reader and reported
    // back as an unusable clip — so an agent that follows this sentence
    // literally must end up with a valid entry, or the instruction is the
    // bug (it named only "file", and a text-less entry silently lost its
    // voice).
    `Synthesize each needs-audio step with scripts/generate-tts.mjs --json --output <the step's "output">, then record it under "clips" in ${inSet(setKey, "narration/manifest.json")} keyed by the step's "key", with all three fields: "file" (the step's "file" verbatim — manifest paths stay relative to the content set), "seconds" (copied from the --json output), and "text" (what you actually had spoken). See references/narration.md.`,
  );
  return {
    success: true,
    message: parts.join(" "),
    data: {
      manifest: inSet(setKey, "narration/manifest.json"),
      ...(read?.manifest?.voice ? { voice: read.manifest.voice } : {}),
      ...(read?.manifest?.style ? { style: read.manifest.style } : {}),
      ...(read?.manifest?.language
        ? { language: read.manifest.language }
        : {}),
      ...(read?.issue ? { manifestIssue: read.issue } : {}),
      steps: plan.entries.map((e) => ({
        address: toAddress(e.ref),
        key: e.hash,
        text: e.text,
        /** The manifest `file` value — set-relative, use verbatim. */
        file: e.file,
        /** Where to write the audio — workspace-relative, for the CLI. */
        output: inSet(setKey, e.file),
        status: e.status,
      })),
      /** Confirmed-absent clip hashes — their steps read needs-audio above. */
      missing: missingLive.map((e) => e.hash),
      orphans: plan.orphans,
    },
  };
}

/**
 * `subtitles` — the lecture as finished SRT / VTT text, so the agent saves
 * it verbatim and never computes a cue time itself. `narration` is the
 * compile's applied clip windows (`CompiledBoard.narration`): a voiced
 * cue spans its clip's audio window, an unvoiced cue its schedule window
 * (see `narrationCues`). Needs no narration manifest: cue text falls back
 * to each step's written words, and every cue is then a pen window.
 */
export function subtitlesResponse(
  lecture: Lecture,
  schedule: readonly StepSchedule[],
  read: NarrationManifestRead | null,
  setKey: string,
  narration: readonly ClipWindow[] = [],
): ViewerActionResult {
  const cues = narrationCues(
    lecture,
    schedule,
    read?.manifest ?? null,
    narration,
  );
  if (cues.length === 0) {
    return {
      success: true,
      message:
        "The board has no steps with anything to say yet — nothing to caption.",
      data: { cues: 0 },
    };
  }
  const save = {
    srt: inSet(setKey, "subtitles.srt"),
    vtt: inSet(setKey, "subtitles.vtt"),
  };
  return {
    success: true,
    message: `${cues.length} cue(s) — voiced steps are timed off their clip's audio window, unvoiced steps off the board's writing. Save data.srt to ${save.srt} (or data.vtt to ${save.vtt}) verbatim — never retime a cue yourself.`,
    data: {
      cues: cues.length,
      srt: toSrt(cues),
      vtt: toVtt(cues),
      save,
    },
  };
}
