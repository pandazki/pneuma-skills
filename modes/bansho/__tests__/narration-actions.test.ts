/**
 * The narration actions' agent-facing response shapes (T10 host seam,
 * pinned after R1 review) — what `narrate` and `subtitles` actually answer,
 * exercised through the same pure builders the runner calls.
 *
 * The load-bearing pin is the PATH CONTRACT: `steps[].file` is the manifest
 * value and stays relative to the content set (`NarrationClip.file`), while
 * `steps[].output` is the workspace path for the CLI. The R1 review caught
 * the runner handing the agent a set-prefixed string as `file`: an agent
 * that stored it verbatim compounded the prefix on every narrate call
 * (`tech-zh/tech-zh/narration/…`). The round-trip test below is that bug's
 * regression harness — feed the response's own `file` back as the manifest
 * entry and the next response must be byte-identical, twice over.
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import { narrationCues, toSrt, toVtt } from "../narration/subtitles.js";
import { clipWindows, createNarrationHook } from "../narration/timing.js";
import {
  readNarrationManifest,
  type NarrationClip,
  type NarrationManifest,
  type NarrationManifestRead,
} from "../narration/types.js";
import {
  narrateResponse,
  subtitlesResponse,
} from "../viewer/narration-actions.js";

const BOARD = `# 标题

第一句话,讲清楚一件事。

第二句话,再讲一件事。
`;

type NarrateStep = {
  address: { section: number; step?: number };
  key: string;
  text: string;
  file: string;
  output: string;
  status: "ready" | "needs-audio";
};

function stepsOf(result: { data?: unknown }): NarrateStep[] {
  return (result.data as { steps: NarrateStep[] }).steps;
}

describe("narrateResponse — the path contract", () => {
  test("on a content set: file stays set-relative, output carries the prefix", () => {
    const lecture = parseLecture(BOARD);
    const result = narrateResponse(lecture, null, "tech-zh");
    expect(result.success).toBe(true);
    const steps = stepsOf(result);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.file).toBe(`narration/${step.key}.mp3`);
      expect(step.file.startsWith("tech-zh/")).toBe(false);
      expect(step.output).toBe(`tech-zh/${step.file}`);
      expect(step.status).toBe("needs-audio");
      expect(step.address.section).toBeDefined();
    }
    // The manifest LOCATION is a workspace path (a place to write a file,
    // not a manifest field) — prefixed is correct here.
    expect((result.data as { manifest: string }).manifest).toBe(
      "tech-zh/narration/manifest.json",
    );
  });

  test("on the root set: no prefix anywhere", () => {
    const lecture = parseLecture(BOARD);
    const steps = stepsOf(narrateResponse(lecture, null, ""));
    for (const step of steps) {
      expect(step.output).toBe(step.file);
    }
  });

  test("round trip: storing the answered file verbatim never compounds the prefix", () => {
    const lecture = parseLecture(BOARD);
    const first = stepsOf(narrateResponse(lecture, null, "tech-zh"));

    // The agent does exactly what narration.md says: record each clip
    // under the plan's key with the plan's `file`, verbatim.
    const manifest: NarrationManifest = {
      clips: Object.fromEntries(
        first.map((s) => [s.key, { file: s.file, seconds: 2, text: s.text }]),
      ),
    };
    const read: NarrationManifestRead = { manifest, issue: null };

    const second = stepsOf(narrateResponse(lecture, read, "tech-zh"));
    expect(second.every((s) => s.status === "ready")).toBe(true);
    // Byte-identical paths call after call — the R1 double-prefix bug
    // (`tech-zh/tech-zh/…`) compounded here.
    expect(second.map((s) => s.file)).toEqual(first.map((s) => s.file));
    expect(second.map((s) => s.output)).toEqual(first.map((s) => s.output));
    const third = stepsOf(narrateResponse(lecture, read, "tech-zh"));
    expect(third.map((s) => s.file)).toEqual(first.map((s) => s.file));
  });

  /**
   * Task #197 — the instruction has to be SUFFICIENT, not merely true.
   *
   * `readNarrationManifest` requires `file` + positive `seconds` + `text`
   * on every clip entry and drops any entry missing one of them. The
   * narrate message used to name only `file`; an agent that followed it
   * literally wrote a `text`-less entry, the reader dropped it, and the
   * step silently lost its voice while the message that caused it still
   * read as correct advice. Reproduced live against a real board before
   * this fix: one entry with its `text` removed came back as "1 unusable
   * clip entry". So the sentence must name every field the reader
   * demands — and this test reads that demand off `readNarrationManifest`
   * itself rather than a hand-kept list, so a new required field fails
   * here instead of shipping as another silent-drop instruction.
   */
  test("the recording instruction names every field the manifest reader requires (#197)", () => {
    const message = narrateResponse(parseLecture(BOARD), null, "tech-zh")
      .message!;

    // Establish, from the reader, which fields are actually load-bearing:
    // drop each one from a complete entry and see if the entry survives.
    const complete = { file: "narration/x.wav", seconds: 2, text: "spoken" };
    const required = (
      Object.keys(complete) as (keyof typeof complete)[]
    ).filter((field) => {
      const partial: Record<string, unknown> = { ...complete };
      delete partial[field];
      const read = readNarrationManifest(
        JSON.stringify({ clips: { abcd1234: partial } }),
      );
      return read.issue !== null;
    });
    expect(required.sort()).toEqual(["file", "seconds", "text"]);

    for (const field of required) {
      expect(message, `narrate never tells the agent to write "${field}"`)
        .toContain(`"${field}"`);
    }
  });

  test("a manifest entry written by following the instruction is accepted", () => {
    // The end-to-end shape of #197: build the entry the message describes
    // and hand it back to the reader. No dropped entries, no issue.
    const lecture = parseLecture(BOARD);
    const steps = stepsOf(narrateResponse(lecture, null, "tech-zh"));
    const written = readNarrationManifest(
      JSON.stringify({
        clips: Object.fromEntries(
          steps.map((s) => [
            s.key,
            { file: s.file, seconds: 3.42, text: s.text },
          ]),
        ),
      }),
    );
    expect(written.issue).toBeNull();
    expect(Object.keys(written.manifest!.clips).sort()).toEqual(
      steps.map((s) => s.key).sort(),
    );
  });

  test("a malformed manifest's reason surfaces as manifestIssue", () => {
    const lecture = parseLecture(BOARD);
    const read: NarrationManifestRead = {
      manifest: null,
      issue: "narration/manifest.json is not valid JSON: oops",
    };
    const result = narrateResponse(lecture, read, "tech-zh");
    expect(
      (result.data as { manifestIssue?: string }).manifestIssue,
    ).toContain("not valid JSON");
    expect(result.message).toContain("Manifest problem");
  });
});

describe("subtitlesResponse — finished text off the schedule", () => {
  function compiledSchedule() {
    const lecture = parseLecture(BOARD);
    return {
      lecture,
      schedule: buildTimeline(lecture, { durations: DEFAULT_DURATIONS })
        .schedule,
    };
  }

  test("no manifest at all: cues fall back to the board's own words", () => {
    const { lecture, schedule } = compiledSchedule();
    const result = subtitlesResponse(lecture, schedule, null, "tech-zh");
    expect(result.success).toBe(true);
    const data = result.data as {
      cues: number;
      srt: string;
      vtt: string;
      save: { srt: string; vtt: string };
    };
    expect(data.cues).toBeGreaterThan(0);
    // The text is EXACTLY the pure formatters over the canonical cues —
    // the action adds reachability, never its own timing.
    const cues = narrationCues(lecture, schedule, null);
    expect(data.srt).toBe(toSrt(cues));
    expect(data.vtt).toBe(toVtt(cues));
    expect(data.srt.startsWith("1\n00:")).toBe(true);
    expect(data.vtt.startsWith("WEBVTT\n")).toBe(true);
    expect(data.save).toEqual({
      srt: "tech-zh/subtitles.srt",
      vtt: "tech-zh/subtitles.vtt",
    });
  });

  test("manifest text wins over board text where a clip exists", () => {
    const lecture = parseLecture(BOARD);
    const { step } = flattenSteps(lecture).find(({ step }) =>
      stepPlainText(step).includes("第一句话"),
    )!;
    const hash = stepContentHash(step, lecture.source);
    const manifest: NarrationManifest = {
      clips: {
        [hash]: { file: `narration/${hash}.wav`, seconds: 2, text: "旁白版第一句" },
      },
    };
    const schedule = buildTimeline(lecture, {
      durations: DEFAULT_DURATIONS,
    }).schedule;
    const result = subtitlesResponse(
      lecture,
      schedule,
      { manifest, issue: null },
      "",
    );
    const data = result.data as { srt: string; save: { srt: string } };
    expect(data.srt).toContain("旁白版第一句");
    expect(data.srt).not.toContain("第一句话");
    expect(data.save.srt).toBe("subtitles.srt");
  });

  test("an empty schedule answers honestly with zero cues", () => {
    const lecture = parseLecture(BOARD);
    const result = subtitlesResponse(lecture, [], null, "");
    expect(result.success).toBe(true);
    expect((result.data as { cues: number }).cues).toBe(0);
  });

  test("the compile's clip windows reach the cues — voiced timing is audio timing", () => {
    // R2 review F2: cues used to read only the schedule, so at the clamp
    // bounds the caption and the voice diverged. The response must hand
    // the windows through to narrationCues, not re-time off the pen.
    const lecture = parseLecture(BOARD);
    const { step } = flattenSteps(lecture).find(({ step }) =>
      stepPlainText(step).includes("第一句话"),
    )!;
    const hash = stepContentHash(step, lecture.source);
    const manifest: NarrationManifest = {
      clips: {
        [hash]: { file: `narration/${hash}.wav`, seconds: 120, text: "长音频" },
      },
    };
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: DEFAULT_DURATIONS,
      durationOverride: hook.durationOverride,
    });
    const windows = clipWindows(timeline.schedule, hook.applied);
    const result = subtitlesResponse(
      lecture,
      timeline.schedule,
      { manifest, issue: null },
      "",
      windows,
    );
    const data = result.data as { srt: string; vtt: string };
    const cues = narrationCues(lecture, timeline.schedule, manifest, windows);
    expect(data.srt).toBe(toSrt(cues));
    expect(data.vtt).toBe(toVtt(cues));
    // The voiced cue really spans the 120s clip, past the capped pen.
    const voiced = cues.find((c) => c.text === "长音频")!;
    expect(voiced.end - voiced.start).toBeCloseTo(120, 6);
  });
});

// ── The mix plan (T10-5) ────────────────────────────────────────────────────

describe("narrate hands the mixer its plan — but only when it is worth mixing", () => {
  const lecture = parseLecture(BOARD);
  /** Every speakable step recorded, so nothing is left needing audio. */
  function fullManifest(): NarrationManifestRead {
    const plan = narrateResponse(lecture, null, "tech-zh");
    const clips: Record<string, NarrationClip> = {};
    for (const step of stepsOf(plan)) {
      clips[step.key] = { file: step.file, seconds: 4, text: step.text };
    }
    return { manifest: { clips }, issue: null };
  }
  function windowsFor(read: NarrationManifestRead) {
    const hook = createNarrationHook(lecture.source, read.manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: DEFAULT_DURATIONS,
      durationOverride: hook.durationOverride,
    });
    return {
      windows: clipWindows(timeline.schedule, hook.applied),
      duration: timeline.duration,
    };
  }

  test("a complete manifest yields a plan the mixer can run as-is", () => {
    const read = fullManifest();
    const { windows, duration } = windowsFor(read);
    const result = narrateResponse(lecture, read, "tech-zh", new Set(), {
      windows,
      duration,
      state: "absent",
    });
    const track = (result.data as { track: { plan: { clips: { source: string; offset: number }[]; track: string; manifest: string; file: string; samples: number } } }).track;
    expect(track.plan.clips).toHaveLength(windows.length);
    // The two-name path discipline, exactly as the per-step answer keeps
    // it: `file` is the sidecar's own value, everything else is a
    // workspace path the CLI can open.
    expect(track.plan.file).toBe("narration/track.mp3");
    expect(track.plan.track).toBe("tech-zh/narration/track.mp3");
    expect(track.plan.manifest).toBe("tech-zh/narration/track.json");
    for (const clip of track.plan.clips) {
      expect(clip.source.startsWith("tech-zh/narration/")).toBe(true);
    }
    // Offsets ascend and the track is long enough to hold them.
    const offsets = track.plan.clips.map((c) => c.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    expect(track.plan.samples).toBeGreaterThan(offsets[offsets.length - 1]!);
    expect(result.message).toContain("mix-narration.mjs");
  });

  test("a board still owing audio gets no plan — mixing early is wasted work", () => {
    const read = fullManifest();
    const [first] = Object.keys(read.manifest!.clips);
    delete read.manifest!.clips[first!];
    const { windows, duration } = windowsFor(read);
    const result = narrateResponse(lecture, read, "tech-zh", new Set(), {
      windows,
      duration,
      state: "absent",
    });
    expect((result.data as { track: { plan?: unknown } }).track.plan).toBeUndefined();
    expect(result.message).not.toContain("mix-narration.mjs");
  });

  test("a refused track says so, and says why, in the message the agent reads", () => {
    const read = fullManifest();
    const { windows, duration } = windowsFor(read);
    const result = narrateResponse(lecture, read, "tech-zh", new Set(), {
      windows,
      duration,
      state: "refused",
      reason: "clip 3 sits 1.40s away from where the board now performs it",
    });
    expect(result.message).toContain("1.40s");
    expect(result.message).toContain("NOT played");
    expect((result.data as { track: { state: string } }).track.state).toBe("refused");
  });

  test("no track state at all leaves the answer byte-identical to before", () => {
    const read = fullManifest();
    const result = narrateResponse(lecture, read, "tech-zh");
    expect((result.data as { track?: unknown }).track).toBeUndefined();
  });
});
