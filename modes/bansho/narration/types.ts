/**
 * Narration contracts (T10) — the voice layer over the canonical timeline.
 *
 * Layering: this directory is host-agnostic pure TS (no React, no DOM, no
 * engine imports beyond `engine/types.js` + `engine/text.js`). The ENGINE
 * stays narration-free: audio length reaches `timeline.ts` through the one
 * existing G3 channel (`ScheduleContext.durationOverride`), and everything
 * here is the host-side policy that feeds it.
 *
 * Vendor isolation: the product owner has not settled on a TTS provider,
 * so the synthesis seam is the shared CLI
 * (`modes/_shared/scripts/generate-tts.mjs`, fal.ai today), run by the
 * AGENT — this module never talks to a vendor. The real isolation
 * boundary is the manifest's `{ file, seconds }`: the engine and the
 * viewer only ever consume that, so swapping vendors is swapping the
 * script, nothing else. (A typed `VoiceSynthesizer` interface once
 * mirrored the CLI here; with no repo-side caller it was dead surface
 * and was dropped — if a repo-side synthesis path ever becomes real,
 * define its interface against the CLI's request shape then.)
 *
 * The on-disk truth is `<content-set>/narration/manifest.json`, written by
 * the AGENT (it runs the TTS script with FAL_KEY from .env; the browser
 * never holds the key). Clips are content-addressed by step hash
 * (`stepContentHash`) — editing one sentence changes exactly one hash, so
 * exactly one clip is re-synthesized and the rest never re-bill.
 * `NarrationClip.seconds` (copied from the script's `--json` output) is
 * the SCHEDULING truth: deterministic input → byte-identical schedule
 * (R8). The audio element is for sound alone, never for scheduling; the
 * clamp below bounds the damage of a mistyped number to [0.6, 2.5] ×
 * natural.
 */

// ── Manifest (on-disk contract, agent-written) ──────────────────────────────

/** One synthesized clip, keyed in the manifest by its step's content hash. */
export interface NarrationClip {
  /** Clip file, relative to the content set (e.g. "narration/1a2b3c4d.wav"). */
  file: string;
  /** Audio length in seconds — the scheduling truth (see module header). */
  seconds: number;
  /** What was actually spoken (the agent may rephrase for speech). */
  text: string;
}

export interface NarrationManifest {
  voice?: string;
  style?: string;
  language?: string;
  clips: Record<string, NarrationClip>;
}

export interface NarrationManifestRead {
  manifest: NarrationManifest | null;
  /**
   * null when the manifest is absent OR fully valid. A MISSING manifest is
   * the documented "no narration" state and stays silent; a MALFORMED one
   * must not hide behind that silence — the issue text is surfaced through
   * the `narrate` action so the agent can heal the file.
   */
  issue: string | null;
}

/**
 * Tolerant manifest reader. `raw === undefined/null` means "no manifest"
 * (silent, natural playback). Anything unreadable degrades to the same
 * playback but CARRIES the reason; individually broken clip entries are
 * dropped one by one so one typo never mutes the whole board.
 */
export function readNarrationManifest(
  raw: string | null | undefined,
): NarrationManifestRead {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { manifest: null, issue: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      manifest: null,
      issue: `narration/manifest.json is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      manifest: null,
      issue: "narration/manifest.json must be a JSON object",
    };
  }
  const obj = parsed as Record<string, unknown>;
  const clipsRaw = obj.clips;
  if (
    clipsRaw === undefined ||
    typeof clipsRaw !== "object" ||
    clipsRaw === null ||
    Array.isArray(clipsRaw)
  ) {
    return {
      manifest: null,
      issue: 'narration/manifest.json needs a "clips" object (step hash → clip)',
    };
  }
  const clips: Record<string, NarrationClip> = {};
  const dropped: string[] = [];
  for (const [hash, value] of Object.entries(clipsRaw)) {
    const clip = value as Partial<NarrationClip> | null;
    if (
      typeof clip === "object" &&
      clip !== null &&
      typeof clip.file === "string" &&
      clip.file.length > 0 &&
      typeof clip.seconds === "number" &&
      Number.isFinite(clip.seconds) &&
      clip.seconds > 0 &&
      typeof clip.text === "string"
    ) {
      clips[hash] = { file: clip.file, seconds: clip.seconds, text: clip.text };
    } else {
      dropped.push(hash);
    }
  }
  const manifest: NarrationManifest = {
    ...(typeof obj.voice === "string" ? { voice: obj.voice } : {}),
    ...(typeof obj.style === "string" ? { style: obj.style } : {}),
    ...(typeof obj.language === "string" ? { language: obj.language } : {}),
    clips,
  };
  return {
    manifest,
    issue:
      dropped.length > 0
        ? `narration/manifest.json has ${dropped.length} unusable clip entr${
            dropped.length === 1 ? "y" : "ies"
          } (need file + positive seconds + text): ${dropped.join(", ")}`
        : null,
  };
}

/**
 * The manifest minus clips whose file is CONFIRMED absent on disk (M3).
 * This is what the host hands the G3 hook instead of the raw manifest: a
 * recorded `seconds` whose audio does not exist must not pace the writing
 * — the step plays at its natural pace, silent, and the miss is surfaced
 * (check-board finding + the board's own chip) instead of slowing the
 * whole visual schedule 2.5× with nobody told. The compile stays a pure
 * function of its inputs — (watched bytes, confirmed-absent set) — and
 * "unknown" never lands in the set (`probeMissingClips` accuses only on a
 * confirmed 404), so a probe that cannot answer changes nothing.
 *
 * Identity-preserving when nothing is missing, so memoized consumers do
 * not recompile; the input manifest is never mutated.
 */
export function withoutMissingClips(
  manifest: NarrationManifest | null,
  missing: ReadonlySet<string>,
): NarrationManifest | null {
  if (manifest === null || missing.size === 0) return manifest;
  const kept = Object.entries(manifest.clips).filter(
    ([hash]) => !missing.has(hash),
  );
  if (kept.length === Object.keys(manifest.clips).length) return manifest;
  return { ...manifest, clips: Object.fromEntries(kept) };
}

// ── Pacing policy (the clamp) ───────────────────────────────────────────────

/**
 * 边说边写 bounds: the pen writes over the voice, but never more than 1/0.6×
 * faster (audio much shorter than the writing — racing through the board
 * reads as刷屏) nor more than 2.5× slower (audio much longer — a pen
 * crawling for a minute reads as broken). Beyond the slow bound the voice
 * finishes over a HOLD (the host clock waits at the next pen-down; see
 * `timing.ts`), never over stretched writing.
 */
export const NARRATION_MIN_SCALE = 0.6;
export const NARRATION_MAX_SCALE = 2.5;

/**
 * The footprint the G3 override reports for a narrated step:
 * `clamp(audio, natural × 0.6, natural × 2.5)`. Total over its domain —
 * a non-positive or non-finite audio length (unreachable past the
 * manifest reader, kept defensive) and a zero natural footprint (the
 * scheduler ignores overrides there) both return `natural` unchanged.
 */
export function narratedFootprint(
  audioSeconds: number,
  naturalFootprint: number,
): number {
  if (
    !Number.isFinite(audioSeconds) ||
    audioSeconds <= 0 ||
    !Number.isFinite(naturalFootprint) ||
    naturalFootprint <= 0
  ) {
    return naturalFootprint;
  }
  const min = naturalFootprint * NARRATION_MIN_SCALE;
  const max = naturalFootprint * NARRATION_MAX_SCALE;
  return Math.min(Math.max(audioSeconds, min), max);
}
