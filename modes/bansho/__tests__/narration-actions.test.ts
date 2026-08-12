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
import type {
  NarrationManifest,
  NarrationManifestRead,
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
      expect(step.file).toBe(`narration/${step.key}.wav`);
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
