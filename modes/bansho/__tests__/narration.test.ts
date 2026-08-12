/**
 * T10 — narration layer (voice over the canonical timeline).
 *
 * Pins the acceptance bars in order:
 *  - manifest reading is tolerant, and MISSING ≠ MALFORMED (silent natural
 *    playback vs a surfaced issue the narrate action reports);
 *  - the clamp: audio within [0.6, 2.5] × natural wins verbatim, both
 *    boundaries clip (极短句配长音频 / 极长句配短音频);
 *  - the G3 path: audio length flows through the EXISTING override channel
 *    (no second timeline), degrades byte-identically when absent, and the
 *    recorded windows land exactly where timeline.ts laid the footprint;
 *  - 改一句只重合成一句: the plan flips exactly the edited step's hash;
 *  - subtitles: a voiced cue spans its clip's audio window (start of the
 *    voice to audioEnd — diverging from the pen at the clamp bounds), an
 *    unvoiced cue spans its schedule window.
 */

import { describe, expect, test } from "bun:test";

import { loadBoard, parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import { buildTimeline } from "../engine/timeline.js";
import type {
  Lecture,
  StepRef,
  StepSchedule,
} from "../engine/types.js";
import { buildNarrationPlan } from "../narration/plan.js";
import {
  activeClipAt,
  clipWindows,
  createNarrationHook,
} from "../narration/timing.js";
import { narrationCues, toSrt, toVtt } from "../narration/subtitles.js";
import {
  NARRATION_MAX_SCALE,
  NARRATION_MIN_SCALE,
  narratedFootprint,
  readNarrationManifest,
  withoutMissingClips,
  type NarrationManifest,
} from "../narration/types.js";
import { stepKey, toAddress } from "../viewer/address.js";
import {
  collectFindings,
  deriveNotifications,
} from "../viewer/board-check.js";
import {
  narrateResponse,
  probeMissingClips,
} from "../viewer/narration-actions.js";

const D = DEFAULT_DURATIONS;

const BOARD = `# 标题

第一句话,讲清楚一件事。

第二句话,再讲一件事。

@wait 1

结尾一句。
`;

function hashOf(lecture: Lecture, text: string): string {
  const found = flattenSteps(lecture).find(({ step }) =>
    stepPlainText(step).includes(text),
  );
  if (!found) throw new Error(`no step containing "${text}"`);
  return stepContentHash(found.step, lecture.source);
}

function manifestFor(
  lecture: Lecture,
  entries: Array<[textFragment: string, seconds: number]>,
): NarrationManifest {
  const clips: NarrationManifest["clips"] = {};
  for (const [fragment, seconds] of entries) {
    const hash = hashOf(lecture, fragment);
    clips[hash] = {
      file: `narration/${hash}.wav`,
      seconds,
      text: fragment,
    };
  }
  return { voice: "Kore", clips };
}

// ── Manifest reading ────────────────────────────────────────────────────────

describe("readNarrationManifest — missing is silent, malformed is surfaced", () => {
  test("absent manifest: no manifest, no issue (the documented silence)", () => {
    expect(readNarrationManifest(undefined)).toEqual({
      manifest: null,
      issue: null,
    });
    expect(readNarrationManifest(null)).toEqual({ manifest: null, issue: null });
    expect(readNarrationManifest("")).toEqual({ manifest: null, issue: null });
  });

  test("broken JSON: no manifest, but the issue names the file", () => {
    const { manifest, issue } = readNarrationManifest("{nope");
    expect(manifest).toBeNull();
    expect(issue).toContain("narration/manifest.json");
  });

  test("wrong shape: clips must be an object", () => {
    expect(readNarrationManifest('{"clips": 3}').manifest).toBeNull();
    expect(readNarrationManifest('{"clips": 3}').issue).toContain("clips");
    expect(readNarrationManifest('[1,2]').manifest).toBeNull();
  });

  test("broken clip entries are dropped one by one, valid ones survive", () => {
    const { manifest, issue } = readNarrationManifest(
      JSON.stringify({
        voice: "Puck",
        clips: {
          good: { file: "narration/good.wav", seconds: 2.5, text: "ok" },
          zero: { file: "narration/zero.wav", seconds: 0, text: "no" },
          nofile: { seconds: 1, text: "no" },
          nan: { file: "narration/nan.wav", seconds: "x", text: "no" },
        },
      }),
    );
    expect(manifest).not.toBeNull();
    expect(Object.keys(manifest!.clips)).toEqual(["good"]);
    expect(manifest!.voice).toBe("Puck");
    expect(issue).toContain("zero");
    expect(issue).toContain("nofile");
    expect(issue).toContain("nan");
  });
});

// ── The clamp ───────────────────────────────────────────────────────────────

describe("narratedFootprint — clamp(audio, natural × 0.6, natural × 2.5)", () => {
  test("audio inside the band wins verbatim (边说边写)", () => {
    expect(narratedFootprint(3, 2)).toBe(3);
    expect(narratedFootprint(1.5, 2)).toBe(1.5);
  });

  test("极短句配长音频: a long clip caps at 2.5 × natural", () => {
    expect(narratedFootprint(60, 2)).toBe(2 * NARRATION_MAX_SCALE);
  });

  test("极长句配短音频: a short clip floors at 0.6 × natural", () => {
    expect(narratedFootprint(0.1, 2)).toBe(2 * NARRATION_MIN_SCALE);
  });

  test("degenerate inputs return the natural footprint unchanged", () => {
    expect(narratedFootprint(NaN, 2)).toBe(2);
    expect(narratedFootprint(-1, 2)).toBe(2);
    expect(narratedFootprint(0, 2)).toBe(2);
    expect(narratedFootprint(3, 0)).toBe(0);
  });
});

// ── G3 wiring: hook + degradation + exact windows ───────────────────────────

describe("createNarrationHook — the existing G3 channel, nothing else", () => {
  test("no manifest / empty clips → no hook → schedule byte-identical to silent", () => {
    expect(createNarrationHook("x", null)).toBeNull();
    expect(createNarrationHook("x", { clips: {} })).toBeNull();

    const lecture = parseLecture(BOARD);
    const silent = buildTimeline(lecture, { durations: D });
    const alsoSilent = buildTimeline(lecture, { durations: D });
    expect(JSON.stringify(silent.schedule)).toBe(
      JSON.stringify(alsoSilent.schedule),
    );
  });

  test("a narrated step's window lands exactly where timeline.ts laid it", () => {
    const lecture = parseLecture(BOARD);
    // 1.0s sits inside the clamp band for this sentence's natural
    // footprint (~0.98s) — the override must be the audio length verbatim.
    const manifest = manifestFor(lecture, [["第一句话", 1]]);
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: D,
      durationOverride: hook.durationOverride,
    });

    expect(hook.applied.size).toBe(1);
    const [key, record] = [...hook.applied.entries()][0]!;
    const windows = clipWindows(timeline.schedule, hook.applied);
    expect(windows).toHaveLength(1);
    const w = windows[0]!;
    expect(stepKey(w.ref)).toBe(key);

    // footprintStart = lastEnd − footprint, and the entries of the step
    // span exactly that footprint (leading scaled pen-lift included).
    const entries = timeline.schedule.filter(
      (e) => stepKey(e.step) === key,
    );
    const lastEnd = entries[entries.length - 1]!.end;
    expect(w.start).toBeCloseTo(lastEnd - record.footprint, 10);
    expect(w.audioEnd).toBeCloseTo(w.start + 1, 10);
    // In-band audio: the override IS the audio length, so the voice ends
    // exactly at the step's last pen-up.
    expect(record.footprint).toBe(1);
    expect(w.audioEnd).toBeCloseTo(lastEnd, 10);
    expect(w.holdAt).toBeNull();
  });

  test("a clip past the slow bound holds at the next pen-down", () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", 600]]);
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: D,
      durationOverride: hook.durationOverride,
    });
    const [w] = clipWindows(timeline.schedule, hook.applied);
    expect(w!.audioEnd).toBeGreaterThan(timeline.duration);
    // The hold sits on the first entry AFTER the narrated step.
    const entries = timeline.schedule.filter(
      (e) => stepKey(e.step) === stepKey(w!.ref),
    );
    const lastEnd = entries[entries.length - 1]!.end;
    const next = timeline.schedule.find((e) => e.start >= lastEnd)!;
    expect(w!.holdAt).toBe(next.start);
  });

  test("activeClipAt projects t onto the sounding window, totally", () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [
      ["第一句话", 3],
      ["结尾一句", 2],
    ]);
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: D,
      durationOverride: hook.durationOverride,
    });
    const windows = clipWindows(timeline.schedule, hook.applied);
    expect(windows).toHaveLength(2);
    const [a, b] = [windows[0]!, windows[1]!];
    expect(a.start).toBeLessThan(b.start);
    expect(activeClipAt(windows, a.start + 0.01)?.hash).toBe(a.hash);
    expect(activeClipAt(windows, b.start + 0.01)?.hash).toBe(b.hash);
    expect(activeClipAt(windows, a.start - 0.5)).toBeNull();
    expect(activeClipAt(windows, NaN)).toBeNull();
  });
});

// ── The plan: 改一句只重合成一句 ────────────────────────────────────────────

describe("buildNarrationPlan", () => {
  test("prose steps are narratable; waits and rules never appear", () => {
    const lecture = parseLecture(BOARD);
    const plan = buildNarrationPlan(lecture, null);
    const texts = plan.entries.map((e) => e.text);
    expect(texts.some((t) => t.includes("第一句话"))).toBe(true);
    expect(texts.some((t) => t.includes("结尾一句"))).toBe(true);
    expect(plan.entries.every((e) => e.status === "needs-audio")).toBe(true);
    expect(plan.entries.every((e) => e.file === `narration/${e.hash}.wav`)).toBe(
      true,
    );
    // @wait produces no plan entry (its plain text is empty).
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });

  test("editing one sentence flips exactly that entry to needs-audio", () => {
    const before = parseLecture(BOARD);
    const manifest = manifestFor(before, [
      ["第一句话", 2],
      ["第二句话", 2],
      ["结尾一句", 2],
    ]);
    const ready = buildNarrationPlan(before, manifest);
    expect(
      ready.entries.filter((e) => e.status === "ready").map((e) => e.text),
    ).toHaveLength(3);
    const alreadyStale = new Set(
      ready.entries
        .filter((e) => e.status === "needs-audio")
        .map((e) => e.hash),
    );

    const after = parseLecture(
      BOARD.replace("第二句话,再讲一件事。", "第二句话,换个说法讲。"),
    );
    const replan = buildNarrationPlan(after, manifest);
    // The un-narrated heading was needs-audio before and after; the NEWLY
    // stale set is exactly the edited sentence — nothing else re-bills.
    const newlyStale = replan.entries.filter(
      (e) => e.status === "needs-audio" && !alreadyStale.has(e.hash),
    );
    expect(newlyStale).toHaveLength(1);
    expect(newlyStale[0]!.text).toContain("换个说法");
    // …and only its old hash became an orphan.
    expect(replan.orphans).toEqual([hashOf(before, "第二句话")]);
  });

  // R2-review F4 (resolved by T10-4): the file-existence channel is the
  // async /api/file probe (`probeMissingClips` in narration-actions.ts —
  // only a confirmed 404 counts as missing; a probe that cannot answer
  // must not accuse a file that may exist). The plan takes the probe's
  // verdict and refuses "ready" for a clip whose file is gone — the fix
  // is re-synthesis to the same path, and the entry going back to
  // needs-audio is what routes the agent there. Since the M3 release-gate
  // fix, the same verdict also feeds the COMPILE: the host filters
  // confirmed-missing clips out of the manifest it hands the G3 hook
  // (`withoutMissingClips`), so a phantom `seconds` no longer paces the
  // writing. The compile stays a pure function of its inputs — (watched
  // bytes, confirmed-absent set) — and "unknown" never accuses.
  test("a manifest entry whose clip file does not exist on disk must not report ready", async () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [
      ["第一句话", 2],
      ["第二句话", 2],
    ]);
    const gone = hashOf(lecture, "第一句话");
    const kept = hashOf(lecture, "第二句话");

    const probed: string[] = [];
    const missing = await probeMissingClips(
      manifest.clips,
      "tech-zh",
      async (workspacePath) => {
        probed.push(workspacePath);
        return workspacePath.includes(gone); // this one 404s
      },
    );
    // The probe asks about WORKSPACE paths (set prefix + manifest file).
    expect(probed.sort()).toEqual(
      [
        `tech-zh/narration/${gone}.wav`,
        `tech-zh/narration/${kept}.wav`,
      ].sort(),
    );
    expect(missing).toEqual(new Set([gone]));

    const plan = buildNarrationPlan(lecture, manifest, missing);
    expect(plan.entries.find((e) => e.hash === gone)!.status).toBe(
      "needs-audio",
    );
    expect(plan.entries.find((e) => e.hash === kept)!.status).toBe("ready");

    // …and the narrate response carries the same verdict to the agent,
    // naming the missing clips outright.
    const response = narrateResponse(
      lecture,
      { manifest, issue: null },
      "tech-zh",
      missing,
    );
    const data = response.data as {
      steps: Array<{ key: string; status: string }>;
      missing: string[];
    };
    expect(data.steps.find((s) => s.key === gone)!.status).toBe("needs-audio");
    expect(data.missing).toEqual([gone]);
    expect(response.message).toContain("missing");
  });

  test("a probe that cannot answer accuses nothing (only a confirmed 404 is missing)", async () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", 2]]);
    const missing = await probeMissingClips(manifest.clips, "", async () => {
      throw new Error("network down");
    });
    expect(missing.size).toBe(0);
    // Unknown existence keeps the entry ready — no false re-billing.
    const plan = buildNarrationPlan(lecture, manifest, missing);
    expect(plan.entries.every((e) => e.status === "ready" || e.text !== "")).toBe(
      true,
    );
  });

  test("a hand-narrated step with no prose text stays in the plan as ready", () => {
    const src = "$$E = mc^2$$\n";
    const lecture = parseLecture(src);
    const { ref, step } = flattenSteps(lecture).find(
      ({ step }) => step.kind === "math",
    )!;
    const hash = stepContentHash(step, lecture.source);
    const manifest: NarrationManifest = {
      clips: {
        [hash]: { file: `narration/${hash}.wav`, seconds: 3, text: "E 等于 mc 平方" },
      },
    };
    const plan = buildNarrationPlan(lecture, manifest);
    const entry = plan.entries.find((e) => e.hash === hash);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("ready");
    expect(entry!.ref).toEqual(ref);
  });

  // M5: the skill teaches "take the formula's key from the plan" — but a
  // zero-text formula used to enter the plan only once a clip ALREADY
  // existed under its key. The first key was unobtainable: circular. A
  // formula now always appears, status "silent": not required, never
  // counted as needs-audio noise, its key and paths ready to use.
  test("an unvoiced formula is IN the plan — status silent, key ready to use", () => {
    const src = "$$E = mc^2$$\n";
    const lecture = parseLecture(src);
    const { ref, step } = flattenSteps(lecture).find(
      ({ step }) => step.kind === "math",
    )!;
    const hash = stepContentHash(step, lecture.source);
    const bare = buildNarrationPlan(lecture, null);
    const entry = bare.entries.find((e) => e.hash === hash);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("silent");
    expect(entry!.text).toBe("");
    expect(entry!.file).toBe(`narration/${hash}.wav`);
    expect(entry!.ref).toEqual(ref);
    // Waits and rules still never appear — silence is the formula's
    // special case, not a door for every zero-text step.
    const board = buildNarrationPlan(parseLecture(BOARD), null);
    expect(board.entries.every((e) => e.text !== "")).toBe(true);
  });

  test("narrate counts speakable steps without the silent formulas, and says how to voice one", () => {
    const src = "$$E = mc^2$$\n";
    const lecture = parseLecture(src);
    const response = narrateResponse(lecture, null, "");
    expect(response.success).toBe(true);
    const data = response.data as {
      steps: Array<{ status: string; key: string; output: string }>;
    };
    // The parent defect: "0 of 0 speakable steps", steps: [] — the agent
    // had no way to get the first key. Now the formula is handed over…
    const silent = data.steps.filter((s) => s.status === "silent");
    expect(silent).toHaveLength(1);
    expect(silent[0]!.output).toBe(`narration/${silent[0]!.key}.wav`);
    // …while the speakable counts stay honest (a formula is not owed a
    // clip) and the message routes the agent to the workflow.
    expect(response.message).toContain("0 of 0 speakable");
    expect(response.message!.toLowerCase()).toContain("formula");
  });
});

// ── M3: confirmed-missing clips — un-paced, and reported ────────────────────

describe("a confirmed-missing clip stops pacing the schedule, and check-board says so", () => {
  test("withoutMissingClips drops exactly the confirmed-absent entries (identity when none)", () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [
      ["第一句话", 600],
      ["第二句话", 2],
    ]);
    const gone = hashOf(lecture, "第一句话");
    const kept = hashOf(lecture, "第二句话");
    // Nothing missing → the SAME object back (memo-friendly identity).
    expect(withoutMissingClips(manifest, new Set())).toBe(manifest);
    expect(withoutMissingClips(null, new Set([gone]))).toBeNull();
    const filtered = withoutMissingClips(manifest, new Set([gone]))!;
    expect(Object.keys(filtered.clips)).toEqual([kept]);
    expect(manifest.clips[gone]).toBeDefined(); // the input is untouched
  });

  test("the defect, then the fix: a phantom 600s entry re-paced the writing 2.5×; filtered, it does not", () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", 600]]);
    const gone = hashOf(lecture, "第一句话");
    // The defect shape: the manifest's `seconds` paced the schedule before
    // the file's existence was knowable — and nothing ever un-paced it.
    const hook = createNarrationHook(lecture.source, manifest)!;
    const paced = buildTimeline(lecture, {
      durations: D,
      durationOverride: hook.durationOverride,
    });
    const silent = buildTimeline(lecture, { durations: D });
    expect(paced.duration).toBeGreaterThan(silent.duration);
    // The fix: a CONFIRMED miss is removed from the hook's input, so the
    // compile is the silent board again (byte-identical degradation).
    const healed = withoutMissingClips(manifest, new Set([gone]));
    expect(createNarrationHook(lecture.source, healed)).toBeNull();
  });

  test("check-board carries a missing clip as an addressed finding — but never interrupts", () => {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", 2]]);
    const plan = buildNarrationPlan(lecture, manifest);
    const entry = plan.entries.find((e) => e.text.includes("第一句话"))!;
    const findings = collectFindings(lecture, {
      mathErrors: [],
      overflowing: [],
      missingNarrationClips: [{ ref: entry.ref, file: entry.file }],
    });
    const finding = findings.find((f) => f.code === "narrationClipMissing");
    expect(finding).toBeDefined();
    expect(finding!.address).toEqual(toAddress(entry.ref));
    expect(finding!.excerpt).toContain(entry.file);
    // The notification channel stays the three §9 kinds — a missing clip
    // is a report (check-board + the board's own chip), not an interrupt.
    const { notifications } = deriveNotifications(new Set(), findings);
    expect(notifications).toEqual([]);
  });
});

// ── Subtitles ───────────────────────────────────────────────────────────────

describe("subtitles — narrated cues ride the voice, unvoiced cues ride the pen", () => {
  function compiled(clipSeconds: number) {
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", clipSeconds]]);
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: D,
      durationOverride: hook.durationOverride,
    });
    const windows = clipWindows(timeline.schedule, hook.applied);
    return { lecture, manifest, timeline, windows };
  }

  /** First/last schedule entry window (the pen window) for a cue's step. */
  function penWindow(
    schedule: readonly StepSchedule[],
    ref: StepRef,
  ): { start: number; end: number } {
    const entries = schedule.filter((e) => stepKey(e.step) === stepKey(ref));
    return { start: entries[0]!.start, end: entries[entries.length - 1]!.end };
  }

  test("an unvoiced cue's start/end equal the step's first/last schedule entry", () => {
    const { lecture, manifest, timeline, windows } = compiled(4);
    const cues = narrationCues(lecture, timeline.schedule, manifest, windows);
    expect(cues.length).toBeGreaterThan(1);
    const voiced = new Set(windows.map((w) => stepKey(w.ref)));
    for (const cue of cues.filter((c) => !voiced.has(stepKey(c.ref)))) {
      const pen = penWindow(timeline.schedule, cue.ref);
      expect(cue.start).toBe(pen.start);
      expect(cue.end).toBe(pen.end);
      expect(cue.end).toBeGreaterThan(cue.start);
    }
    // Ordered, and text falls back to the board's own words where the
    // manifest has no clip.
    const starts = cues.map((c) => c.start);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
    expect(cues.some((c) => c.text.includes("第二句话"))).toBe(true);
  });

  test("a narrated cue spans its audio window, not the pen's", () => {
    const { lecture, manifest, timeline, windows } = compiled(4);
    expect(windows.length).toBe(1);
    const w = windows[0]!;
    const cues = narrationCues(lecture, timeline.schedule, manifest, windows);
    const cue = cues.find((c) => stepKey(c.ref) === stepKey(w.ref))!;
    expect(cue.start).toBe(w.start);
    expect(cue.end).toBe(w.audioEnd);
    // The voice starts at the step's footprint start — scaled leading
    // pen-lift included — which is at or before the first pen-down.
    const pen = penWindow(timeline.schedule, cue.ref);
    expect(cue.start).toBeLessThanOrEqual(pen.start);
  });

  test("极短句配长音频: the caption keeps speaking past the capped pen window", () => {
    // Audio far past 2.5 × natural: the footprint clamps but the voice
    // does not — the cue must end where the AUDIO ends, after the pen.
    const { lecture, manifest, timeline, windows } = compiled(120);
    const w = windows[0]!;
    const cues = narrationCues(lecture, timeline.schedule, manifest, windows);
    const cue = cues.find((c) => stepKey(c.ref) === stepKey(w.ref))!;
    const pen = penWindow(timeline.schedule, cue.ref);
    expect(cue.end).toBe(w.audioEnd);
    expect(cue.end - cue.start).toBeCloseTo(120, 6);
    expect(cue.end).toBeGreaterThan(pen.end);
  });

  test("极长句配短音频: the caption stops with the voice, before the floored pen window", () => {
    // Audio far below 0.6 × natural: the pen keeps its floored footprint
    // but the voice is long done — the cue must not linger to the pen end.
    const { lecture, manifest, timeline, windows } = compiled(0.05);
    const w = windows[0]!;
    const cues = narrationCues(lecture, timeline.schedule, manifest, windows);
    const cue = cues.find((c) => stepKey(c.ref) === stepKey(w.ref))!;
    const pen = penWindow(timeline.schedule, cue.ref);
    expect(cue.end).toBe(w.audioEnd);
    expect(cue.end - cue.start).toBeCloseTo(0.05, 6);
    expect(cue.end).toBeLessThan(pen.end);
  });

  test("agent-written clip text cannot break the cue structure", () => {
    // The manifest's text is hand-written: a blank line ends an SRT/VTT
    // cue block, a literal --> reads as a timing line. Both must be
    // neutralized at cue construction so every downstream format is safe.
    const lecture = parseLecture(BOARD);
    const manifest = manifestFor(lecture, [["第一句话", 4]]);
    const hash = hashOf(lecture, "第一句话");
    manifest.clips[hash]!.text =
      "第一行\r\n \r\n\n第二行 00:00:01,000 --> 00:00:02,000 之后\n";
    const timeline = buildTimeline(lecture, { durations: D });
    const cues = narrationCues(lecture, timeline.schedule, manifest);
    const cue = cues.find((c) => c.text.includes("第一行"))!;
    expect(cue.text).toBe("第一行\n第二行 00:00:01,000 → 00:00:02,000 之后");
    // Structurally: one timing arrow per cue in the SRT, and no blank
    // line inside any cue payload.
    const srt = toSrt(cues);
    expect(srt.split("-->").length - 1).toBe(cues.length);
    for (const block of srt.trimEnd().split("\n\n")) {
      expect(block.split("\n").length).toBeGreaterThanOrEqual(3);
    }
  });

  test("without windows the cues degrade to pen windows (no-narration path)", () => {
    const { lecture, timeline } = compiled(4);
    const cues = narrationCues(lecture, timeline.schedule, null);
    for (const cue of cues) {
      const pen = penWindow(timeline.schedule, cue.ref);
      expect(cue.start).toBe(pen.start);
      expect(cue.end).toBe(pen.end);
    }
  });

  test("SRT and VTT format the same cues with their two time dialects", () => {
    const cues = [
      {
        ref: { section: 0, step: 0 },
        srcSpan: { start: 0, end: 5 },
        start: 0,
        end: 2.5,
        text: "第一句",
      },
      {
        ref: { section: 0, step: 1 },
        srcSpan: { start: 6, end: 12 },
        start: 61.25,
        end: 3661.0125,
        text: "第二句",
      },
    ];
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\n第一句\n\n" +
        "2\n00:01:01,250 --> 01:01:01,013\n第二句\n",
    );
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n第一句\n\n" +
        "00:01:01.250 --> 01:01:01.013\n第二句\n",
    );
  });
});

// ── The manifest rides the board source (flow: files → Board.narration) ─────

describe("loadBoard picks up narration/manifest.json per content set", () => {
  test("present, absent and malformed manifests each load to their own read", () => {
    const board = loadBoard([
      { path: "tech/board.md", content: "第一句。\n" },
      {
        path: "tech/narration/manifest.json",
        content: JSON.stringify({
          clips: { abc: { file: "narration/abc.wav", seconds: 2, text: "第一句。" } },
        }),
      },
      { path: "pitch/board.md", content: "另一句。\n" },
      { path: "broken/board.md", content: "坏的。\n" },
      { path: "broken/narration/manifest.json", content: "{nope" },
    ])!;
    expect(board.narration["tech"]!.manifest!.clips.abc!.seconds).toBe(2);
    expect(board.narration["tech"]!.issue).toBeNull();
    // Absent: silence by design — no manifest, no issue.
    expect(board.narration["pitch"]).toEqual({ manifest: null, issue: null });
    // Malformed: same silent playback, but the reason survives for narrate.
    expect(board.narration["broken"]!.manifest).toBeNull();
    expect(board.narration["broken"]!.issue).toContain("manifest.json");
  });
});
