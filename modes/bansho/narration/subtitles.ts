/**
 * Subtitle export (T10) — SRT / VTT off the same compile the board plays.
 *
 * A cue captions what is HEARD when there is a voice, and what is WRITTEN
 * when there is not:
 *
 *  - A narrated step's cue is its audio window (`ClipWindow`): it starts
 *    at the footprint start (scaled leading pen-lift included — the voice
 *    begins as the pen travels) and ends at `audioEnd`, where the clip
 *    actually stops. At the clamp bounds this deliberately diverges from
 *    the pen: a long clip over a capped footprint keeps captioning past
 *    the writing, a short clip under a floored footprint stops while the
 *    pen finishes. The numbers still come from the SAME compile as the
 *    schedule (the acceptance bar: SRT 时间轴与 schedule 一致 — one
 *    compile, one truth), never from a second timing pass.
 *  - An unvoiced step's cue is its schedule window (first pen-down to
 *    last pen-up) — with no clip there is nothing else to agree with.
 *
 * Known T10-4 limit: cue times are CANONICAL seconds. Once the conductor
 * holds the clock at `holdAt` (wall-clock advances, canonical time
 * pauses), a straight mux of this SRT against a recorded audio track
 * drifts by the hold lengths; the conductor owns that projection.
 *
 * Cue text prefers the manifest's spoken text (the agent may rephrase for
 * speech, and hand-writes the voice of formula steps) and falls back to
 * the step's plain board text — so subtitles work with no narration
 * manifest and no key at all. `srcSpan` rides along so a cue can point
 * back at the 讲稿 line it captions.
 */

import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import type {
  Lecture,
  SrcSpan,
  StepRef,
  StepSchedule,
} from "../engine/types.js";
import { stepKey } from "../viewer/address.js";
import type { ClipWindow } from "./timing.js";
import type { NarrationManifest } from "./types.js";

export interface SubtitleCue {
  ref: StepRef;
  srcSpan: SrcSpan;
  start: number;
  end: number;
  text: string;
}

/**
 * A cue's text must survive verbatim inside an SRT/VTT block: a blank
 * line terminates the block, and a literal `-->` reads as a timing line —
 * either corrupts every cue after it. `stepPlainText` is safe by
 * construction, but the preferred source is the agent-hand-written
 * manifest text, so the mode owns the escaping: normalize CRLF, collapse
 * blank-line runs to a single newline, and bend `-->` into an arrow.
 */
function sanitizeCueText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n")
    .replace(/-->/g, "→")
    .trim();
}

/**
 * One cue per scheduled step with something to say, in start order.
 *
 * `narration` is the compile's applied clip windows (`CompiledBoard.
 * narration`); a step found there is captioned over its AUDIO window,
 * everything else over its schedule window. Omitting it (or passing `[]`)
 * is the no-narration degradation: every cue is a pen window, exactly as
 * a silent board schedules.
 */
export function narrationCues(
  lecture: Lecture,
  schedule: readonly StepSchedule[],
  manifest: NarrationManifest | null,
  narration: readonly ClipWindow[] = [],
): SubtitleCue[] {
  const windows = new Map<string, { start: number; end: number }>();
  for (const entry of schedule) {
    const key = stepKey(entry.step);
    const w = windows.get(key);
    if (!w) windows.set(key, { start: entry.start, end: entry.end });
    else {
      if (entry.start < w.start) w.start = entry.start;
      if (entry.end > w.end) w.end = entry.end;
    }
  }
  const voiced = new Map<string, ClipWindow>();
  for (const w of narration) voiced.set(stepKey(w.ref), w);

  const cues: SubtitleCue[] = [];
  for (const { ref, step } of flattenSteps(lecture)) {
    const key = stepKey(ref);
    const window = windows.get(key);
    if (!window) continue; // never scheduled — nothing to caption
    const clip = manifest?.clips[stepContentHash(step, lecture.source)];
    const text = sanitizeCueText(
      (clip?.text ?? "").trim() || stepPlainText(step).trim(),
    );
    if (text === "") continue;
    const voice = voiced.get(key);
    cues.push({
      ref,
      srcSpan: step.srcSpan,
      start: voice ? voice.start : window.start,
      end: voice ? voice.audioEnd : window.end,
      text,
    });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// ── Formatting ──────────────────────────────────────────────────────────────

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** `HH:MM:SS<sep>mmm`, clamped at 0, rounded to the millisecond. */
function formatTime(seconds: number, sep: "," | "."): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
}

export function toSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${formatTime(cue.start, ",")} --> ${formatTime(cue.end, ",")}\n${cue.text}\n`,
    )
    .join("\n");
}

export function toVtt(cues: readonly SubtitleCue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${formatTime(cue.start, ".")} --> ${formatTime(cue.end, ".")}\n${cue.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
