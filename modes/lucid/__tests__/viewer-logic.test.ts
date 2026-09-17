/**
 * The viewer's decidable half.
 *
 * Everything the lucid stage does that can be wrong in a way a screenshot
 * would not show lives in three pure modules — `viewer/stage.ts`,
 * `viewer/bridge.ts` and `viewer/urls.ts` — and is pinned here:
 *
 *  - the address algebra `navigate-to`, `capture` and a locator card all
 *    route through (a `round` that quietly became 1 shows the wrong picture
 *    and the agent believes it);
 *  - the rail's arithmetic and the sparkline's fixed 0–10 axis (an
 *    auto-scaled trajectory makes 6.7 → 6.8 look like a breakthrough);
 *  - the bridge's request/response bookkeeping — the timeout that keeps
 *    `capture` from hanging on a scene that threw, the wait that keeps it
 *    from shooting a scene that has not started, and the reload that
 *    invalidates every answer still in flight;
 *  - the stage's own size, which is what the target image's aspect ratio is
 *    chosen from before any scene exists;
 *  - the URL builder every asset request is made of.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadLoops, type Loop } from "../domain.js";
import {
  BRIDGE_TIMEOUT_MS,
  CAPTURE_READY_POLL_MS,
  CAPTURE_READY_TIMEOUT_MS,
  MAX_TRACKED_NOTES,
  SceneBridgeChannel,
  captureRecord,
  captureViewportPayload,
  parseInbound,
  parseSceneState,
  stillCaptureRecord,
  trackNoteName,
  waitForSceneReady,
  type CaptureReply,
  type SceneState,
  type StateReply,
  type UnsupportedReply,
} from "../viewer/bridge.js";
import {
  VIEW_MODES,
  bestPoint,
  bestRoundIndex,
  budgetLabel,
  clampWipe,
  compactCount,
  exitChip,
  formatScore,
  nextStage,
  noteCount,
  parseAddress,
  parseViewMode,
  railChips,
  resolveAddress,
  sceneSignature,
  sparklinePath,
  sparklinePoints,
  stageSize,
  stillOnStage,
  vitalsLine,
  warningLines,
  wipeFromPointer,
  type StagePosition,
  type StageWorld,
} from "../viewer/stage.js";
import { base64FromBytes, fetchStillPayload } from "../viewer/still.js";
import { assetUrl, contentBase, encodeContentPath, sceneUrl } from "../viewer/urls.js";

const SHRINE = readFileSync(join(import.meta.dir, "fixtures", "lantern-shrine.json"), "utf-8");

function shrine(mutate?: (body: Record<string, unknown>) => void): Loop {
  const body = JSON.parse(SHRINE);
  mutate?.(body);
  const loops = loadLoops([
    { path: "lantern-shrine/lucid.json", content: JSON.stringify(body) },
  ])!;
  return loops.projects["lantern-shrine"];
}

const NO_SCENE = { bridge: false, fps: null, frameMs: null, triangles: null, textures: null, errors: [] };

// ── The stage's own size ───────────────────────────────────────────────────

describe("stageSize", () => {
  test("the measured box, with the aspect the target must be dreamed at", () => {
    // The blind trial's actual stage (2026-09-16). The agent dreamed 16:9
    // because it asked the stage for nothing, and every round after that was
    // judged against a differently shaped picture.
    expect(stageSize({ width: 1091, height: 738 })).toEqual({
      width: 1091,
      height: 738,
      aspect: 1.478,
    });
    expect(stageSize({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
      aspect: 1.778,
    });
  });

  test("fractional CSS pixels are rounded, and the three numbers still agree", () => {
    // `getBoundingClientRect` returns fractions; an `aspect` computed from
    // the unrounded box would not divide back out of the reported width and
    // height, and the agent does check.
    const size = stageSize({ width: 1090.6, height: 737.5 })!;
    expect({ width: size.width, height: size.height }).toEqual({ width: 1091, height: 738 });
    expect(size.aspect).toBeCloseTo(size.width / size.height, 3);
  });

  test("a box with no area has no aspect — null, never a guess", () => {
    // A stage that has not been laid out yet must not answer "1:1". An
    // invented ratio goes straight into an image prompt.
    expect(stageSize({ width: 0, height: 0 })).toBeNull();
    expect(stageSize({ width: 1091, height: 0 })).toBeNull();
    expect(stageSize({ width: -4, height: 300 })).toBeNull();
    expect(stageSize({ width: Number.NaN, height: 300 })).toBeNull();
    expect(stageSize(null)).toBeNull();
    expect(stageSize(undefined)).toBeNull();
  });
});

// ── Address ────────────────────────────────────────────────────────────────

describe("parseAddress", () => {
  test("reads the three keys this mode owns and ignores the rest", () => {
    expect(
      parseAddress({ contentSet: "lantern-shrine", round: 2, view: "split", slide: 4 }),
    ).toEqual({ contentSet: "lantern-shrine", round: 2, view: "split" });
  });

  test("a numeric string round still resolves — an agent writes JSON by hand", () => {
    expect(parseAddress({ round: "3" })).toEqual({ round: 3 });
  });

  test("a round that names nothing on disk is dropped, never coerced", () => {
    // `round: 0` and `round: 1.5` are not rounds. Rounding them to 1 would
    // put a real picture on the stage under a wrong name.
    expect(parseAddress({ round: 0 })).toEqual({});
    expect(parseAddress({ round: 1.5 })).toEqual({});
    expect(parseAddress({ round: -2 })).toEqual({});
    expect(parseAddress({ round: "soon" })).toEqual({});
    expect(parseAddress({ round: null })).toEqual({});
  });

  test("an unknown view is dropped rather than shown as live", () => {
    expect(parseAddress({ view: "wireframe" })).toEqual({});
    for (const view of VIEW_MODES) expect(parseAddress({ view }).view).toBe(view);
  });

  test("a non-object address is an empty address, not a crash", () => {
    expect(parseAddress(undefined)).toEqual({});
    expect(parseAddress(null)).toEqual({});
    expect(parseAddress("round 2")).toEqual({});
    expect(parseAddress([1, 2])).toEqual({});
  });

  test("parseViewMode is the single membership test", () => {
    expect(parseViewMode("target")).toBe("target");
    expect(parseViewMode("Target")).toBeNull();
    expect(parseViewMode(2)).toBeNull();
  });
});

describe("nextStage — naming a round must make that round visible", () => {
  // The bug this pins, measured in a real session (2026-09-16): the stage was
  // in Target view, `capture {"round": 1}` navigated, the round was selected
  // but the view stayed on Target — so the saved PNG was byte-identical to
  // target.png and filed as "round 1". A plausible picture of the wrong
  // object is exactly what the coarse-key registry exists to prevent.
  test("a round with no view lands in Split, from any view", () => {
    expect(nextStage({ round: null, view: "target" }, { round: 1 })).toEqual({
      round: 1,
      view: "split",
    });
    expect(nextStage({ round: null, view: "live" }, { round: 3 })).toEqual({
      round: 3,
      view: "split",
    });
  });

  test("already comparing? stay there — only the round changes", () => {
    expect(nextStage({ round: 1, view: "split" }, { round: 2 })).toEqual({
      round: 2,
      view: "split",
    });
  });

  test("an explicit view wins — asking for the dream gets the dream", () => {
    expect(nextStage({ round: null, view: "live" }, { round: 1, view: "target" })).toEqual({
      round: 1,
      view: "target",
    });
  });

  test("a view switch with no round returns to the live scene", () => {
    expect(nextStage({ round: 2, view: "split" }, { view: "live" })).toEqual({
      round: null,
      view: "live",
    });
  });

  test("switching project drops the round — its rounds are not this one's", () => {
    expect(nextStage({ round: 2, view: "split" }, { contentSet: "other" })).toEqual({
      round: null,
      view: "split",
    });
  });

  test("an empty address moves nothing", () => {
    expect(nextStage({ round: 2, view: "split" }, {})).toEqual({ round: 2, view: "split" });
  });
});

describe("resolveAddress — a round is checked against the project it lands on", () => {
  const LIVE: StagePosition = { round: null, view: "live" };

  function world(over: Partial<StageWorld> = {}): StageWorld {
    return {
      dir: "lantern-shrine",
      projects: { "lantern-shrine": shrine() },
      contentSets: ["lantern-shrine"],
      position: LIVE,
      ...over,
    };
  }

  test("a recorded round is a move, and the answer says where the stage landed", () => {
    expect(resolveAddress(world(), { round: 2 })).toEqual({
      ok: true,
      contentSet: "lantern-shrine",
      switchTo: null,
      position: { round: 2, view: "split" },
    });
  });

  test("the documented shorthand — no contentSet — is validated, not waved through", () => {
    // The bug: the round was checked only when `address.contentSet === dir`,
    // so `{ "round": 999, "view": "split" }` (the form the skill documents)
    // answered SUCCESS. An effect then dropped the round a render later, in
    // silence, and the agent went on believing round 999 was on the stage.
    const outcome = resolveAddress(world(), { round: 999, view: "split" });
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({
      message: 'Round 999 is not recorded in "Lantern shrine".',
    });
  });

  test("a missing round in the addressed project is refused by that project's name", () => {
    const outcome = resolveAddress(
      world({ dir: "other", projects: { other: shrine(), "lantern-shrine": shrine() }, contentSets: ["other", "lantern-shrine"] }),
      { contentSet: "lantern-shrine", round: 9 },
    );
    expect(outcome).toMatchObject({ ok: false, message: 'Round 9 is not recorded in "Lantern shrine".' });
  });

  test("a round in ANOTHER project resolves against that project's rounds", () => {
    // The stage is on a project with two rounds; the address names a project
    // with five. Checking against the one on stage would refuse round 5.
    const five = shrine((body) => {
      const rounds = body.rounds as Array<Record<string, unknown>>;
      for (let i = 3; i <= 5; i++) {
        rounds.push({ index: i, kind: "iterate", at: "", capture: null, fps: null, verdict: null });
      }
    });
    expect(
      resolveAddress(
        world({ projects: { "lantern-shrine": shrine(), deep: five }, contentSets: ["lantern-shrine", "deep"] }),
        { contentSet: "deep", round: 5 },
      ),
    ).toEqual({
      ok: true,
      contentSet: "deep",
      switchTo: "deep",
      position: { round: 5, view: "split" },
    });
  });

  test("an unknown project is named in the refusal, with what stays on stage", () => {
    expect(resolveAddress(world(), { contentSet: "ghost", round: 1 })).toEqual({
      ok: false,
      message: 'No project named "ghost" in this workspace. Showing "Lantern shrine".',
    });
  });

  test("a project the switcher knows but the loader could not read refuses by name", () => {
    // Half-written `lucid.json`: `resolveContentSets` still offers the
    // directory, `loadLoops` skips it. Nothing can be said about its rounds,
    // and saying nothing is the bug above.
    const outcome = resolveAddress(
      world({ contentSets: ["lantern-shrine", "half"] }),
      { contentSet: "half", round: 1 },
    );
    expect(outcome).toMatchObject({
      ok: false,
      message: 'Cannot show round 1: no readable lucid.json in "half".',
    });
  });

  test("a view-only address needs no project and no round to be valid", () => {
    expect(resolveAddress(world({ position: { round: 2, view: "split" } }), { view: "live" })).toEqual({
      ok: true,
      contentSet: "lantern-shrine",
      switchTo: null,
      position: { round: null, view: "live" },
    });
    // An empty workspace can still be told to show its (empty) live stage.
    expect(resolveAddress(world({ dir: "", projects: {}, contentSets: [] }), { view: "target" })).toMatchObject({
      ok: true,
      position: { round: null, view: "target" },
    });
  });

  test("switching to the project already on stage is not a switch", () => {
    expect(
      resolveAddress(world(), { contentSet: "lantern-shrine", round: 1 }),
    ).toMatchObject({ ok: true, switchTo: null, contentSet: "lantern-shrine" });
  });
});

describe("stillOnStage — what `capture` hands back", () => {
  const urls = { target: "/content/p/target.png", capture: "/content/p/rounds/02/capture.png" };

  test("the live scene is the subject in Live and in Split", () => {
    // Split shows the target as the yardstick BESIDE the live frame; the
    // agent asks for the target by name when it wants the target.
    expect(stillOnStage({ round: null, view: "live" }, urls)).toBeNull();
    expect(stillOnStage({ round: null, view: "split" }, urls)).toBeNull();
  });

  test("a selected round hands back that round's recorded PNG, named", () => {
    expect(stillOnStage({ round: 2, view: "split" }, urls)).toEqual({
      url: urls.capture,
      source: "round",
      round: 2,
    });
  });

  test("Target hands back the dream, even with a round selected", () => {
    expect(stillOnStage({ round: 2, view: "target" }, urls)).toEqual({
      url: urls.target,
      source: "target",
    });
  });

  test("nothing recorded is nothing to hand back — the live scene answers", () => {
    // A round with no capture, and a project with no target locked yet. The
    // live scene is still rendering underneath either placeholder.
    expect(stillOnStage({ round: 2, view: "split" }, { ...urls, capture: null })).toBeNull();
    expect(stillOnStage({ round: null, view: "target" }, { ...urls, target: null })).toBeNull();
  });
});

// ── The wipe ───────────────────────────────────────────────────────────────

describe("the wipe", () => {
  test("clamps to the stage — a drag that leaves it must not invert", () => {
    expect(clampWipe(-0.4)).toBe(0);
    expect(clampWipe(1.8)).toBe(1);
    expect(clampWipe(0.37)).toBeCloseTo(0.37, 5);
  });

  test("a non-finite value falls back to the middle, not to NaN", () => {
    expect(clampWipe(Number.NaN)).toBe(0.5);
  });

  test("pointer x maps to a fraction of the stage's own box", () => {
    const rect = { left: 100, width: 400 };
    expect(wipeFromPointer(100, rect)).toBe(0);
    expect(wipeFromPointer(260, rect)).toBeCloseTo(0.4, 5);
    expect(wipeFromPointer(500, rect)).toBe(1);
    // Past the edge mid-drag — pointer capture keeps sending these.
    expect(wipeFromPointer(2000, rect)).toBe(1);
  });

  test("a zero-width stage answers the middle instead of dividing by zero", () => {
    expect(wipeFromPointer(40, { left: 0, width: 0 })).toBe(0.5);
  });
});

// ── The rail ───────────────────────────────────────────────────────────────

describe("formatScore", () => {
  test("up to two decimals, and no trailing zeros", () => {
    expect(formatScore(6.8)).toBe("6.8");
    expect(formatScore(7)).toBe("7");
    expect(formatScore(Number.NaN)).toBe("—");
  });

  test("a hundredth is printed, not rounded away", () => {
    // The judge scores in hundredths — composition/lighting/materials are
    // 0–3 and details 0–1, fractions allowed — so the seed's own trajectory
    // is 3.35 → 4 → 4.25. One decimal turned that into 3.4 / 4.3 on the rail
    // while the chat, the verdict file and the seed description all said the
    // real number; a rail that disagrees with the verdict is not read twice.
    expect(formatScore(3.35)).toBe("3.35");
    expect(formatScore(4.25)).toBe("4.25");
    expect(formatScore(4)).toBe("4");
  });

  test("the zeros of a whole number survive the trim", () => {
    // `10.00` → `10`, never `1`: the stripping is anchored behind the decimal
    // point `toFixed` always writes.
    expect(formatScore(10)).toBe("10");
    expect(formatScore(4.2)).toBe("4.2");
    expect(formatScore(0)).toBe("0");
  });

  test("a third decimal still rounds — the rubric does not score that finely", () => {
    // Not a tie value: `6.755` is 6.75499… as a double, so which way a
    // half-way case falls is the binary's business, not this function's.
    expect(formatScore(6.757)).toBe("6.76");
    expect(formatScore(6.751)).toBe("6.75");
  });
});

describe("railChips", () => {
  const chips = railChips(shrine());

  test("one chip per round, printed the way the rail shows it", () => {
    expect(chips.map((c) => c.short)).toEqual(["R1 4.5", "R2 6.8"]);
    expect(chips.map((c) => c.label)).toEqual(["Round 1 · 4.5", "Round 2 · 6.8"]);
  });

  test("the best judged round is the one lit", () => {
    expect(chips.filter((c) => c.best).map((c) => c.index)).toEqual([2]);
  });

  test("a hundredths total reaches the chip intact", () => {
    // The seed's real trajectory. A chip reading `R1 3.4` next to a verdict
    // saying 3.35 is the rail contradicting the file it is drawn from.
    const hundredths = railChips(
      shrine((body) => {
        const rounds = body.rounds as Array<Record<string, unknown>>;
        (rounds[0].verdict as Record<string, unknown>).total = 3.35;
        (rounds[1].verdict as Record<string, unknown>).total = 4.25;
      }),
    );
    expect(hundredths.map((c) => c.short)).toEqual(["R1 3.35", "R2 4.25"]);
    expect(hundredths.map((c) => c.label)).toEqual(["Round 1 · 3.35", "Round 2 · 4.25"]);
  });

  test("ties keep the earlier round — the later one gained nothing", () => {
    // The fallback derivation, reached only before the script has evaluated:
    // with an `evaluation` on file the rail quotes its `best` instead.
    const tied = railChips(
      shrine((body) => {
        body.evaluation = null;
        (body.rounds as Array<Record<string, unknown>>)[0].verdict = {
          composition: 2.5, lighting: 2, materials: 1.5, details: 0.8, total: 6.8,
          gaps: [], judgedAt: "2026-09-16T09:25:00.000Z",
        };
      }),
    );
    expect(tied.filter((c) => c.best).map((c) => c.index)).toEqual([1]);
  });

  test("an unjudged round is a chip with no score, and is never the best", () => {
    const chips = railChips(
      shrine((body) => {
        (body.rounds as unknown[]).push({
          index: 3, kind: "rethink", at: "", capture: null, fps: null, verdict: null,
        });
      }),
    );
    expect(chips[2]).toMatchObject({
      index: 3,
      short: "R3",
      label: "Round 3",
      total: null,
      judged: false,
      best: false,
      hasCapture: false,
      rethink: true,
    });
  });

  test("a re-dream reads as a restart, not as one long climb", () => {
    // After `target --set --reason "re-dream"` the earlier rounds stay on the
    // rail — they happened, and their captures are worth looking at — but
    // `lucid.mjs` excludes them from the exit rules. The rail marks them with
    // the target version they were judged against so the two agree.
    const redreamed = railChips(
      shrine((body) => {
        (body.target as Record<string, unknown>).version = 2;
        const rounds = body.rounds as Array<Record<string, unknown>>;
        rounds[0].targetVersion = 1;
        rounds[1].targetVersion = 2;
      }),
    );
    expect(redreamed.map((c) => ({ index: c.index, superseded: c.superseded, v: c.targetVersion }))).toEqual([
      { index: 1, superseded: true, v: 1 },
      { index: 2, superseded: false, v: 2 },
    ]);
    expect(redreamed[0].label).toBe("Round 1 · 4.5 · target v1");
    expect(redreamed[1].label).toBe("Round 2 · 6.8");
  });

  test("the lit chip is the SCRIPT's best, not a second opinion", () => {
    // `lucid.mjs` computes `evaluation.best` over the locked target version
    // only. The rail quotes it; deriving its own answer is how the chip and
    // the status line the agent reads out start naming different rounds.
    const lit = railChips(
      shrine((body) => {
        (body.evaluation as Record<string, unknown>).best = { index: 1, total: 4.5 };
      }),
    );
    expect(lit.filter((c) => c.best).map((c) => c.index)).toEqual([1]);
  });

  test("an evaluated loop with no best lights nothing", () => {
    const none = railChips(
      shrine((body) => {
        (body.evaluation as Record<string, unknown>).best = null;
      }),
    );
    expect(none.some((c) => c.best)).toBe(false);
  });

  test("before the first evaluation a superseded round still cannot be best", () => {
    // The fallback derivation applies the same target-version exclusion the
    // script would, so the window before `status` runs does not light a round
    // scored against an abandoned dream.
    const redreamed = railChips(
      shrine((body) => {
        body.evaluation = null;
        (body.target as Record<string, unknown>).version = 2;
        const rounds = body.rounds as Array<Record<string, unknown>>;
        // The old dream's round scored 6.8; the new dream's first round is 4.5.
        rounds[0].targetVersion = 2;
        rounds[1].targetVersion = 1;
      }),
    );
    expect(redreamed.filter((c) => c.best).map((c) => c.index)).toEqual([1]);
  });

  test("with no target locked nothing is superseded — there is nothing to be behind", () => {
    const fresh = railChips(
      shrine((body) => {
        body.evaluation = null;
        (body.target as Record<string, unknown>).version = 0;
      }),
    );
    expect(fresh.every((c) => !c.superseded)).toBe(true);
    // And the best round is still chosen from everything judged.
    expect(fresh.filter((c) => c.best).map((c) => c.index)).toEqual([2]);
  });

  test("a file written before targetVersion existed reads as the first target", () => {
    // `parseRound` defaults the field to 1, so a v1 loop is unchanged: every
    // round belongs to the target that is locked.
    const legacy = railChips(
      shrine((body) => {
        for (const round of body.rounds as Array<Record<string, unknown>>) {
          delete round.targetVersion;
        }
      }),
    );
    expect(legacy.map((c) => ({ v: c.targetVersion, superseded: c.superseded }))).toEqual([
      { v: 1, superseded: false },
      { v: 1, superseded: false },
    ]);
  });

  test("no project and no rounds are both an empty rail", () => {
    expect(railChips(null)).toEqual([]);
    expect(railChips(shrine((body) => { body.rounds = []; }))).toEqual([]);
  });

  test("bestRoundIndex is null before the first verdict", () => {
    expect(bestRoundIndex([])).toBeNull();
  });
});

describe("bestPoint — one answer for every surface that shows a best round", () => {
  test("the script's evaluation wins over any derivation here", () => {
    // The rail chip, the command notification and the context block all read
    // this. Two of them deriving their own answer is how the stage starts
    // disagreeing with `lucid.mjs status` in front of the user.
    expect(bestPoint(shrine())).toEqual({ index: 2, total: 6.8 });
    expect(
      bestPoint(shrine((body) => { (body.evaluation as Record<string, unknown>).best = null; })),
    ).toBeNull();
  });

  test("without an evaluation it derives the same thing, minus the old target's rounds", () => {
    const fallback = bestPoint(
      shrine((body) => {
        body.evaluation = null;
        (body.target as Record<string, unknown>).version = 2;
        const rounds = body.rounds as Array<Record<string, unknown>>;
        rounds[0].targetVersion = 2; // 4.5, current dream
        rounds[1].targetVersion = 1; // 6.8, the dream that was replaced
      }),
    );
    expect(fallback).toEqual({ index: 1, total: 4.5 });
  });

  test("no project and no judged round are both null", () => {
    expect(bestPoint(null)).toBeNull();
    expect(
      bestPoint(shrine((body) => { body.evaluation = null; body.rounds = []; })),
    ).toBeNull();
  });
});

describe("sparklinePoints", () => {
  test("the y axis is the rubric's 0–10, not the data's own range", () => {
    // Auto-scaling would make 6.7 → 6.8 fill the box, which is the one thing
    // the user reads this control to rule out.
    const points = sparklinePoints([0, 5, 10], 100, 20);
    expect(points.map((p) => p.y)).toEqual([20, 10, 0]);
    expect(points.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  test("a near-flat trajectory looks near-flat", () => {
    const points = sparklinePoints([6.7, 6.8], 100, 20);
    expect(Math.abs(points[0].y - points[1].y)).toBeCloseTo(0.2, 5);
  });

  test("a single judged round is one centered point, not a zero-length line", () => {
    const points = sparklinePoints([4.5], 100, 20);
    expect(points).toEqual([{ x: 50, y: 11 }]);
    expect(sparklinePath(points)).toBe("");
  });

  test("scores outside the rubric are clamped rather than drawn off the box", () => {
    const points = sparklinePoints([-3, 14], 100, 20);
    expect(points.map((p) => p.y)).toEqual([20, 0]);
  });

  test("nothing to draw yields nothing", () => {
    expect(sparklinePoints([], 100, 20)).toEqual([]);
    expect(sparklinePoints([4.5, 6.8], 0, 20)).toEqual([]);
    expect(sparklinePath([])).toBe("");
  });

  test("the path walks the points in order", () => {
    expect(sparklinePath(sparklinePoints([0, 10], 100, 20))).toBe("M0.00 20.00 L100.00 0.00");
  });
});

// ── Status ─────────────────────────────────────────────────────────────────

describe("exitChip", () => {
  test("quotes the script's exit state rather than re-deriving one", () => {
    expect(exitChip(shrine())).toEqual({ label: "Looping", tone: "active" });
    const states: Array<[string, string, string]> = [
      ["done", "Done", "good"],
      ["optimize-fps", "Score met, fps short", "warn"],
      ["stall-approaching", "Stall approaching", "warn"],
      ["stalled", "Stalled", "bad"],
      ["budget-exhausted", "Budget exhausted", "bad"],
      ["dreaming", "Dreaming the target", "idle"],
    ];
    for (const [exit, label, tone] of states) {
      const loop = shrine((body) => {
        (body.evaluation as Record<string, unknown>).exit = exit;
      });
      expect({ exit, ...exitChip(loop) }).toEqual({ exit, label, tone: tone as never });
    }
  });

  test("an unevaluated project falls back to its own status", () => {
    const loop = shrine((body) => {
      body.evaluation = null;
      body.status = "stalled";
    });
    expect(exitChip(loop)).toEqual({ label: "Stalled", tone: "bad" });
  });

  test("no project at all is an idle chip, not an empty one", () => {
    expect(exitChip(null)).toEqual({ label: "No project", tone: "idle" });
  });
});

describe("budgetLabel", () => {
  const started = "2026-09-16T09:05:00.000Z";

  test("counts down from the moment the target was locked", () => {
    expect(budgetLabel(shrine(), new Date("2026-09-16T09:23:00.000Z"))).toBe("27 min left");
  });

  test("the last minute is named, not rounded to zero", () => {
    expect(budgetLabel(shrine(), new Date("2026-09-16T09:49:40.000Z"))).toBe(
      "under a minute left",
    );
  });

  test("past the deadline it says so instead of going negative", () => {
    expect(budgetLabel(shrine(), new Date("2026-09-16T11:00:00.000Z"))).toBe("out of time");
  });

  test("no budget, or a budget that has not started, shows no clock", () => {
    expect(budgetLabel(shrine((b) => { b.budget = null; }), new Date(started))).toBeNull();
    expect(
      budgetLabel(
        shrine((b) => { (b.budget as Record<string, unknown>).startedAt = null; }),
        new Date(started),
      ),
    ).toBeNull();
    expect(budgetLabel(null)).toBeNull();
  });
});

describe("warningLines", () => {
  test("a missing bridge leads — it invalidates every other number", () => {
    const lines = warningLines(shrine(), NO_SCENE);
    expect(lines[0]).toBe("no bridge — the scene cannot be measured or captured");
  });

  test("scene errors are counted and the first one is quoted", () => {
    const lines = warningLines(shrine(), {
      ...NO_SCENE,
      bridge: true,
      errors: ["GLTFLoader: models/arch.glb 404", "THREE.WebGLProgram: shader error"],
    });
    expect(lines[0]).toBe("2 scene errors: GLTFLoader: models/arch.glb 404");
  });

  test("loader warnings about the manifest ride along", () => {
    const loop = shrine((body) => { delete body.rounds; });
    const lines = warningLines(loop, { ...NO_SCENE, bridge: true });
    expect(lines).toContain("rounds missing, shown as none");
  });

  test("a healthy loop and a healthy scene warn about nothing", () => {
    expect(warningLines(shrine(), { ...NO_SCENE, bridge: true })).toEqual([]);
  });
});

describe("vitalsLine", () => {
  test("prints what is known and skips what is not", () => {
    expect(
      vitalsLine({ bridge: true, fps: 58.4, frameMs: 17.24, triangles: 84210, textures: 6, errors: [] }),
    ).toBe("58 fps · 17.2 ms · 84k tris · 6 textures");
    expect(vitalsLine({ ...NO_SCENE, fps: 60 })).toBe("60 fps");
    expect(vitalsLine(NO_SCENE)).toBe("");
  });

  test("one texture is not 1 textures", () => {
    expect(vitalsLine({ ...NO_SCENE, bridge: true, textures: 1 })).toBe("1 texture");
  });

  test("notes are counted on the strip, never warned about", () => {
    // A note is the scene reporting something it measured — including a
    // passing self-check. Routing it through `warningLines` would put good
    // news behind an alert icon.
    expect(vitalsLine({ ...NO_SCENE, bridge: true, fps: 60, notes: 2 })).toBe("60 fps · 2 notes");
    expect(vitalsLine({ ...NO_SCENE, bridge: true, notes: 1 })).toBe("1 note");
    expect(vitalsLine({ ...NO_SCENE, bridge: true, notes: 0 })).toBe("");
    expect(warningLines(shrine(), { ...NO_SCENE, bridge: true, notes: 3 })).toEqual([]);
  });

  test("compactCount stays readable across three orders of magnitude", () => {
    expect(compactCount(840)).toBe("840");
    expect(compactCount(8400)).toBe("8.4k");
    expect(compactCount(84210)).toBe("84k");
    expect(compactCount(1_240_000)).toBe("1.2M");
  });
});

// ── Scene change detection ─────────────────────────────────────────────────

describe("sceneSignature", () => {
  test("a same-length edit is still a change", () => {
    // The reason this hashes instead of measuring: an agent fixing a material
    // swaps one hex literal for another of the same size, and a length-only
    // signature would report "nothing happened" for exactly that edit.
    const before = [{ path: "scene/main.js", content: "const c = 0xffffff;" }];
    const after = [{ path: "scene/main.js", content: "const c = 0x8844ff;" }];
    expect(sceneSignature(before)).not.toBe(sceneSignature(after));
  });

  test("a reordered snapshot is not a change", () => {
    const a = [
      { path: "scene/index.html", content: "<!doctype html>" },
      { path: "scene/main.js", content: "init();" },
    ];
    expect(sceneSignature(a)).toBe(sceneSignature([a[1], a[0]]));
  });

  test("an added or renamed file is a change", () => {
    const a = [{ path: "scene/main.js", content: "init();" }];
    expect(sceneSignature(a)).not.toBe(
      sceneSignature([...a, { path: "scene/lights.js", content: "init();" }]),
    );
    expect(sceneSignature(a)).not.toBe(sceneSignature([{ path: "scene/app.js", content: "init();" }]));
  });

  test("no files is a stable empty signature, not a change every render", () => {
    expect(sceneSignature([])).toBe("");
    expect(sceneSignature(null)).toBe("");
    expect(sceneSignature(undefined)).toBe("");
  });
});

// ── URLs ───────────────────────────────────────────────────────────────────

describe("content URLs", () => {
  test("a project's assets are served under its own directory", () => {
    expect(assetUrl("", "lantern-shrine", "rounds/02/capture.png", 7)).toBe(
      "/content/lantern-shrine/rounds/02/capture.png?v=7",
    );
  });

  test("a root-level project has no prefix to add", () => {
    expect(contentBase("", "")).toBe("/content");
    expect(assetUrl("", "", "target.png", 1)).toBe("/content/target.png?v=1");
  });

  test("the API origin rides in front in dev, where the viewer is on another port", () => {
    expect(sceneUrl("http://localhost:17007", "lantern-shrine", 3)).toBe(
      "http://localhost:17007/content/lantern-shrine/scene/index.html?r=3",
    );
  });

  test("each segment is encoded on its own — the separators must survive", () => {
    expect(encodeContentPath("灯 籠/rounds/01/capture.png")).toBe(
      "%E7%81%AF%20%E7%B1%A0/rounds/01/capture.png",
    );
    expect(assetUrl("", "夜の社", "target.png", 2)).toBe(
      "/content/%E5%A4%9C%E3%81%AE%E7%A4%BE/target.png?v=2",
    );
  });

  test("a missing path is null, not a request for /content/<dir>/null", () => {
    expect(assetUrl("", "lantern-shrine", null, 1)).toBeNull();
    expect(assetUrl("", "lantern-shrine", undefined, 1)).toBeNull();
  });

  test("the scene document carries a reload nonce, so a reload is a reload", () => {
    expect(sceneUrl("", "a", 1)).not.toBe(sceneUrl("", "a", 2));
  });
});

// ── The bridge ─────────────────────────────────────────────────────────────

describe("parseInbound", () => {
  test("reads the three announcements the scene volunteers", () => {
    // `bridgeVersion` is an integer protocol version, not a semver string.
    expect(parseInbound({ type: "pneuma:lucid:hello", bridgeVersion: 1 })).toEqual({
      kind: "hello",
      bridgeVersion: 1,
    });
    expect(parseInbound({ type: "pneuma:lucid:hello", bridgeVersion: "1" })).toEqual({
      kind: "hello",
      bridgeVersion: null,
    });
    expect(parseInbound({ type: "pneuma:lucid:ready" })).toEqual({ kind: "ready" });
    expect(parseInbound({ type: "pneuma:lucid:error", message: "GLB 404" })).toEqual({
      kind: "error",
      message: "GLB 404",
    });
  });

  test("a note announcement carries the name it filed the diagnostic under", () => {
    expect(parseInbound({ type: "pneuma:lucid:note", name: "integrationCheck" })).toEqual({
      kind: "note",
      name: "integrationCheck",
    });
  });

  test("a note with no name announces nothing — there is nothing to look up", () => {
    // The value lives in the state reply's `notes`, keyed by this name. An
    // anonymous note is as unroutable as a reply with no id.
    expect(parseInbound({ type: "pneuma:lucid:note" })).toBeNull();
    expect(parseInbound({ type: "pneuma:lucid:note", name: "" })).toBeNull();
    expect(parseInbound({ type: "pneuma:lucid:note", name: 7 })).toBeNull();
  });

  test("anything that is not this protocol is ignored", () => {
    // The page shares its window with the session shell and Vite's HMR client.
    expect(parseInbound({ type: "pneuma:textEdit", html: "" })).toBeNull();
    expect(parseInbound({ type: "pneuma:lucid:whatever" })).toBeNull();
    expect(parseInbound("pneuma:lucid:ready")).toBeNull();
    expect(parseInbound(null)).toBeNull();
  });

  test("a reply without an id cannot be routed, so it is not a reply", () => {
    expect(parseInbound({ type: "pneuma:lucid:capture:result", ok: true })).toBeNull();
    expect(parseInbound({ type: "pneuma:lucid:state:result", state: {} })).toBeNull();
  });

  test("a failed capture is parsed as a failure, not discarded", () => {
    expect(
      parseInbound({
        type: "pneuma:lucid:capture:result",
        id: "x",
        ok: false,
        registered: false,
        error: "no renderer registered",
      }),
    ).toEqual({
      kind: "capture:result",
      id: "x",
      ok: false,
      dataUrl: null,
      width: null,
      height: null,
      registered: false,
      error: "no renderer registered",
    });
  });
});

describe("parseSceneState", () => {
  test("defaults every unknown field rather than trusting the scene's shape", () => {
    // The scene is code the agent wrote minutes ago; it may post anything.
    expect(parseSceneState(undefined)).toEqual({
      bridgeVersion: null,
      registered: false,
      ready: false,
      loading: false,
      fps: null,
      rafFps: null,
      fpsSource: null,
      frameMs: null,
      framesRendered: null,
      passesPerFrame: null,
      errorSources: null,
      visibility: null,
      sinceLastRenderMs: null,
      drawCalls: null,
      triangles: null,
      textures: null,
      geometries: null,
      errors: [],
      notes: {},
      viewport: null,
    });
  });

  test("visibility, the time since the last render and the render pixel ratio come through, and an old bridge reports null", () => {
    const fresh = parseSceneState({
      visibility: "hidden", sinceLastRenderMs: 4120.5,
      viewport: { width: 800, height: 600, pixelRatio: 2, renderPixelRatio: 1.5 },
    });
    expect(fresh).toMatchObject({ visibility: "hidden", sinceLastRenderMs: 4120.5 });
    expect(fresh.viewport).toEqual({ width: 800, height: 600, pixelRatio: 2, renderPixelRatio: 1.5 });
    const old = parseSceneState({ viewport: { width: 800, height: 600, pixelRatio: 2 } });
    expect(old).toMatchObject({ visibility: null, sinceLastRenderMs: null });
    expect(old.viewport).toEqual({ width: 800, height: 600, pixelRatio: 2, renderPixelRatio: null });
    expect(parseSceneState({ visibility: 3, sinceLastRenderMs: "soon" })).toMatchObject({ visibility: null, sinceLastRenderMs: null });
  });

  test("errorSources come through per channel, and an old bridge reports null", () => {
    // A failed shader is not an error event — three.js only prints it — so
    // the channel counts are how the agent tells a black material from a
    // script that threw. A bridge that predates the field yields null, not
    // four zeros pretending to have looked.
    expect(parseSceneState({ errorSources: { window: 1, unhandledrejection: 0, console: 2, shader: 1 } }).errorSources)
      .toEqual({ window: 1, unhandledrejection: 0, console: 2, shader: 1 });
    expect(parseSceneState({ errorSources: { console: "3" } }).errorSources)
      .toEqual({ window: 0, unhandledrejection: 0, console: 0, shader: 0 });
    expect(parseSceneState({}).errorSources).toBeNull();
  });

  test("the scene's notes come through as they are, minus the shape guesses", () => {
    // A note is the scene's own structured diagnostic — the reason the blind
    // trial had to smuggle a PASSING self-check through the error channel,
    // where it made the status strip warn about good news.
    expect(
      parseSceneState({ notes: { integrationCheck: "pass", renderedFrames: 412 } }).notes,
    ).toEqual({ integrationCheck: "pass", renderedFrames: 412 });
    // A nested value is the scene's business; the viewer forwards, it does
    // not interpret.
    expect(parseSceneState({ notes: { camera: { fov: 35 } } }).notes).toEqual({
      camera: { fov: 35 },
    });
    for (const notes of [undefined, null, "pass", 7, ["pass"]]) {
      expect(parseSceneState({ notes }).notes).toEqual({});
    }
  });

  test("the notes object is copied, not aliased into the agent's result", () => {
    const raw = { notes: { a: 1 } };
    const parsed = parseSceneState(raw);
    raw.notes.a = 2;
    expect(parsed.notes).toEqual({ a: 1 });
  });

  test("a note that cannot be JSON-encoded is named, not left to throw", () => {
    // `postMessage` carries a cycle; the action result's JSON encoding does
    // not. One such note would otherwise take down the whole get-scene-state
    // reply, and the agent would read "the scene did not answer".
    const cyclic: Record<string, unknown> = { n: 1 };
    cyclic.self = cyclic;
    const notes = parseSceneState({ notes: { ok: "pass", cyclic } }).notes;
    expect(notes.ok).toBe("pass");
    expect(notes.cyclic).toBe("[note value could not be serialized]");
    expect(() => JSON.stringify(notes)).not.toThrow();
  });

  test("passes per displayed frame come through, and are null when unknown", () => {
    // `fps` counts DISPLAYED frames, at most one per animation frame; a scene
    // that draws a reflection pass first renders twice for one picture. This
    // is the number that says where the extra work went — dropping it would
    // leave "60 fps, and it stutters" unexplainable.
    expect(parseSceneState({ passesPerFrame: 2 }).passesPerFrame).toBe(2);
    expect(parseSceneState({ passesPerFrame: 1.08 }).passesPerFrame).toBe(1.08);
    // The bridge answers null while nothing is registered: no render to divide.
    expect(parseSceneState({ passesPerFrame: null }).passesPerFrame).toBeNull();
    expect(parseSceneState({ passesPerFrame: "2" }).passesPerFrame).toBeNull();
  });

  test("the rAF cadence is reported apart from fps, and labelled", () => {
    // Scheduling cadence is not proof that anything was drawn; reporting it
    // as `fps` is how a scene that renders nothing reads as 120 fps.
    const state = parseSceneState({ fps: 58, rafFps: 120, fpsSource: "render" });
    expect({ fps: state.fps, rafFps: state.rafFps, fpsSource: state.fpsSource }).toEqual({
      fps: 58,
      rafFps: 120,
      fpsSource: "render",
    });
    expect(parseSceneState({ rafFps: "120", fpsSource: 3 })).toMatchObject({
      rafFps: null,
      fpsSource: null,
    });
  });

  test("a NaN fps is unknown, not a number", () => {
    expect(parseSceneState({ fps: Number.NaN }).fps).toBeNull();
  });

  test("the protocol version is read as a number", () => {
    expect(parseSceneState({ bridgeVersion: 1 }).bridgeVersion).toBe(1);
    expect(parseSceneState({ bridgeVersion: "1" }).bridgeVersion).toBeNull();
  });

  test("non-string entries are dropped from errors", () => {
    expect(parseSceneState({ errors: ["real", 7, null] }).errors).toEqual(["real"]);
  });
});

describe("captureViewportPayload", () => {
  const reply = (over: Partial<CaptureReply>): CaptureReply => ({
    kind: "capture:result",
    id: "x",
    ok: true,
    dataUrl: "data:image/png;base64,QUJD",
    width: 1280,
    height: 720,
    registered: true,
    error: null,
    ...over,
  });

  test("strips the data: prefix — the framework contract is bare base64", () => {
    expect(captureViewportPayload(reply({}))).toEqual({ data: "QUJD", media_type: "image/png" });
  });

  test("a declined or unanswered capture is null, so the framework falls through", () => {
    expect(captureViewportPayload(null)).toBeNull();
    expect(captureViewportPayload(reply({ ok: false, dataUrl: null }))).toBeNull();
    expect(captureViewportPayload(reply({ dataUrl: null }))).toBeNull();
  });

  test("a non-base64 data URL is refused rather than shipped as bytes", () => {
    expect(captureViewportPayload(reply({ dataUrl: "data:image/svg+xml,<svg/>" }))).toBeNull();
    expect(captureViewportPayload(reply({ dataUrl: "blob:http://x/y" }))).toBeNull();
    expect(captureViewportPayload(reply({ dataUrl: "data:image/png;base64," }))).toBeNull();
  });

  test("the scene's own media type survives", () => {
    expect(captureViewportPayload(reply({ dataUrl: "data:image/jpeg;base64,QUJD" }))).toEqual({
      data: "QUJD",
      media_type: "image/jpeg",
    });
  });
});

describe("SceneBridgeChannel", () => {
  test("a request carries its own id and the scene's reply settles it", async () => {
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 50);
    const pending = channel.request("state");
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("pneuma:lucid:state");
    expect(channel.pendingCount).toBe(1);

    channel.accept(
      parseInbound({ type: "pneuma:lucid:state:result", id: sent[0].id, state: { fps: 59 } }),
    );
    const reply = await pending;
    expect(reply).toMatchObject({ kind: "state:result", state: { fps: 59 } });
    expect(channel.pendingCount).toBe(0);
  });

  test("two requests in flight do not answer each other", async () => {
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 80);
    const first = channel.request("state");
    const second = channel.request("state");
    expect(sent[0].id).not.toBe(sent[1].id);

    channel.accept(
      parseInbound({ type: "pneuma:lucid:state:result", id: sent[1].id, state: { fps: 30 } }),
    );
    expect(await second).toMatchObject({ state: { fps: 30 } });
    expect(channel.pendingCount).toBe(1);
    channel.accept(
      parseInbound({ type: "pneuma:lucid:state:result", id: sent[0].id, state: { fps: 60 } }),
    );
    expect(await first).toMatchObject({ state: { fps: 60 } });
  });

  test("a scene that never answers resolves null instead of hanging", async () => {
    // A scene that threw during module evaluation never calls back, and
    // `capture` would otherwise leave the agent waiting on a dead promise.
    const channel = new SceneBridgeChannel(() => {}, 20);
    expect(await channel.request("capture")).toBeNull();
    expect(channel.pendingCount).toBe(0);
  });

  test("a stale id — the previous document's reply — settles nothing", async () => {
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 30);
    const pending = channel.request("capture");
    const consumed = channel.accept(
      parseInbound({ type: "pneuma:lucid:capture:result", id: "lucid-capture-999", ok: true, dataUrl: "data:image/png;base64,QUJD" }),
    );
    expect(consumed).toBe(false);
    expect(await pending).toBeNull();
  });

  test("a capture reply may not answer a state request", async () => {
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 30);
    const pending = channel.request("state");
    expect(
      channel.accept(
        parseInbound({ type: "pneuma:lucid:capture:result", id: sent[0].id, ok: true }),
      ),
    ).toBe(false);
    expect(await pending).toBeNull();
  });

  test("an `unsupported` answer settles the request — a named refusal, not silence", async () => {
    // An older bridge that does not know a request type answers rather than
    // ignoring: silence is indistinguishable from a hung scene, and the agent
    // would spend its next turn debugging the wrong thing.
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 5000);
    const pending = channel.request("state");
    expect(
      channel.accept(
        parseInbound({
          type: "pneuma:lucid:unsupported",
          id: sent[0].id,
          requestType: "pneuma:lucid:state",
          bridgeVersion: 1,
        }),
      ),
    ).toBe(true);
    expect(await pending).toEqual({
      kind: "unsupported",
      id: sent[0].id,
      requestType: "pneuma:lucid:state",
      bridgeVersion: 1,
    });
    expect(channel.pendingCount).toBe(0);
  });

  test("an `unsupported` capture is not a picture — the framework must fall through", async () => {
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 5000);
    const pending = channel.request("capture");
    channel.accept(
      parseInbound({
        type: "pneuma:lucid:unsupported",
        id: sent[0].id,
        requestType: "pneuma:lucid:capture",
        bridgeVersion: 1,
      }),
    );
    expect(captureViewportPayload(await pending)).toBeNull();
  });

  test("abort settles everything in flight — a reload invalidates the answers", async () => {
    const channel = new SceneBridgeChannel(() => {}, 5000);
    const capture = channel.request("capture");
    const state = channel.request("state");
    channel.abort();
    expect(await capture).toBeNull();
    expect(await state).toBeNull();
    expect(channel.pendingCount).toBe(0);
  });

  test("a torn-down iframe throwing on postMessage settles now, not in 3 s", async () => {
    const channel = new SceneBridgeChannel(() => {
      throw new Error("contentWindow is gone");
    }, 5000);
    expect(await channel.request("state")).toBeNull();
  });

  test("the default timeout is the same 3 s the bridge verdict waits", () => {
    expect(BRIDGE_TIMEOUT_MS).toBe(3000);
  });

  test("an announcement is not a reply — a note settles no request", async () => {
    // `hello`, `ready`, `error` and `note` arrive unsolicited and carry no
    // id; the channel must hand them back to the component untouched instead
    // of resolving whatever happens to be in flight.
    const sent: Array<{ type: string; id: string }> = [];
    const channel = new SceneBridgeChannel((m) => sent.push(m), 20);
    const pending = channel.request("state");
    expect(channel.accept(parseInbound({ type: "pneuma:lucid:note", name: "fpsProbe" }))).toBe(
      false,
    );
    expect(channel.accept(parseInbound({ type: "pneuma:lucid:ready" }))).toBe(false);
    expect(channel.pendingCount).toBe(1);
    expect(await pending).toBeNull();
  });
});

// ── Waiting for a frame worth judging ──────────────────────────────────────

describe("waitForSceneReady", () => {
  /** A clock and a sleeper that only move when the loop asks them to. */
  function fakeClock() {
    let t = 0;
    const slept: number[] = [];
    return {
      slept,
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
      /** Every `requestState` call also costs the bridge's own round trip. */
      tick: (ms: number) => {
        t += ms;
      },
    };
  }

  const stateReply = (state: Partial<SceneState>): StateReply => ({
    kind: "state:result",
    id: "x",
    state: parseSceneState(state),
  });

  test("a ready scene is shot immediately — no poll, no sleep", async () => {
    const clock = fakeClock();
    const readiness = await waitForSceneReady({
      requestState: async () => stateReply({ registered: true, ready: true }),
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(readiness).toEqual({ ready: true, registered: true, waitedMs: 0 });
    expect(clock.slept).toEqual([]);
  });

  test("a scene still starting is waited for, then shot when it says ready", async () => {
    // The blind trial's failure, in order (2026-09-16): right after a reload
    // the bridge answers `registered: false` for a few hundred milliseconds,
    // and `capture` used to shoot straight through that window.
    const clock = fakeClock();
    const answers = [
      { registered: false, ready: false },
      { registered: true, ready: false },
      { registered: true, ready: true },
    ];
    let call = 0;
    const readiness = await waitForSceneReady({
      requestState: async () => stateReply(answers[call++]),
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(readiness).toEqual({ ready: true, registered: true, waitedMs: 500 });
    expect(clock.slept).toEqual([CAPTURE_READY_POLL_MS, CAPTURE_READY_POLL_MS]);
    expect(call).toBe(3);
  });

  test("a scene that never becomes ready is still shot, and says so", async () => {
    // A real frame of a broken scene beats the framework's fallback (a black
    // rasterization of a WebGL canvas) — but the caller has to learn that
    // this one must not be judged.
    const clock = fakeClock();
    let call = 0;
    const readiness = await waitForSceneReady({
      requestState: async () => {
        call++;
        return stateReply({ registered: true, ready: false });
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(readiness).toEqual({ ready: false, registered: true, waitedMs: 3750 });
    expect(readiness.waitedMs).toBeLessThan(CAPTURE_READY_TIMEOUT_MS);
    expect(call).toBe(16);
  });

  test("the deadline counts the bridge's own round trips, not just the sleeps", async () => {
    // A scene busy in a long task makes every `state` request cost its full
    // 3 s timeout. The wait cannot interrupt a request already in flight, so
    // it overruns — but it must stop after two of them rather than sixteen,
    // and it must report the time it actually spent.
    const clock = fakeClock();
    let call = 0;
    const readiness = await waitForSceneReady({
      requestState: async () => {
        call++;
        clock.tick(BRIDGE_TIMEOUT_MS);
        return null;
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(call).toBe(2);
    expect(readiness).toEqual({ ready: false, registered: false, waitedMs: 6250 });
  });

  test("silence is not readiness — an unanswered poll reports neither", async () => {
    const clock = fakeClock();
    const readiness = await waitForSceneReady({
      requestState: async () => null,
      now: clock.now,
      sleep: clock.sleep,
      timeoutMs: 600,
      pollMs: 200,
    });
    expect(readiness).toEqual({ ready: false, registered: false, waitedMs: 400 });
  });

  test("a bridge too old to answer `state` is not waited out", async () => {
    // It will never report readiness, whatever the deadline says; polling it
    // again only delays the screenshot by four seconds.
    const clock = fakeClock();
    let call = 0;
    const unsupported: UnsupportedReply = {
      kind: "unsupported",
      id: "x",
      requestType: "pneuma:lucid:state",
      bridgeVersion: 1,
    };
    const readiness = await waitForSceneReady({
      requestState: async () => {
        call++;
        return unsupported;
      },
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(call).toBe(1);
    expect(readiness).toEqual({ ready: false, registered: false, waitedMs: 0 });
    expect(clock.slept).toEqual([]);
  });

  test("the budget is the one the capture contract documents", () => {
    expect({ poll: CAPTURE_READY_POLL_MS, timeout: CAPTURE_READY_TIMEOUT_MS }).toEqual({
      poll: 250,
      timeout: 4000,
    });
  });
});

describe("captureRecord", () => {
  const readiness = { ready: true, registered: true, waitedMs: 250 };
  const reply = (over: Partial<CaptureReply> = {}): CaptureReply => ({
    kind: "capture:result",
    id: "x",
    ok: true,
    dataUrl: "data:image/png;base64,QUJD",
    width: 1091,
    height: 738,
    registered: true,
    error: null,
    ...over,
  });

  test("a frame from a ready, registered scene is recorded as judgeable", () => {
    expect(captureRecord("2026-09-16T09:30:00.000Z", readiness, reply())).toEqual({
      at: "2026-09-16T09:30:00.000Z",
      source: "live",
      ready: true,
      registered: true,
      waitedMs: 250,
    });
  });

  test("the capture's own `registered` outranks the poll's — it is the later fact", () => {
    // Without a registered renderer the bridge grabs the first <canvas> on
    // the page, which for a WebGL context reads back black. A scene that lost
    // its renderer between the poll and the shot did not produce a frame
    // anyone may judge.
    expect(captureRecord("t", readiness, reply({ registered: false }))).toMatchObject({
      ready: false,
      registered: false,
    });
  });

  test("a scene that never got ready is filed as not judgeable", () => {
    expect(
      captureRecord("t", { ready: false, registered: true, waitedMs: 3750 }, reply()),
    ).toEqual({ at: "t", source: "live", ready: false, registered: true, waitedMs: 3750 });
  });

  test("a capture that said nothing leaves the poll's answer standing", () => {
    expect(captureRecord("t", readiness, null)).toMatchObject({ ready: true, registered: true });
    expect(
      captureRecord("t", readiness, {
        kind: "unsupported",
        id: "x",
        requestType: "pneuma:lucid:capture",
        bridgeVersion: 1,
      }),
    ).toMatchObject({ ready: true, registered: true });
  });
});

describe("stillCaptureRecord — a still is filed too", () => {
  // The failure this closes: `capture` answers with a PNG path whichever way
  // it went, so an agent that meant to shoot the live scene and got the
  // TARGET back could not tell from the reply — and `lastCapture` still
  // described some earlier live frame, so the readiness check passed on
  // evidence about a different picture. A judge scoring the target against
  // itself costs a whole round.
  test("a round's recorded PNG is named, with the round it belongs to", () => {
    expect(stillCaptureRecord("2026-09-16T10:00:00.000Z", "round", 2)).toEqual({
      at: "2026-09-16T10:00:00.000Z",
      source: "round",
      round: 2,
      ready: false,
      registered: null,
      waitedMs: null,
    });
  });

  test("the target carries no round — it belongs to none of them", () => {
    expect(stillCaptureRecord("t", "target")).toEqual({
      at: "t",
      source: "target",
      ready: false,
      registered: null,
      waitedMs: null,
    });
  });

  test("a still is never judgeable, and never claims a lost renderer", () => {
    // `ready: false` keeps the old rule (`lastCapture.ready === false` means
    // do not judge) true for an agent that has not learned `source` yet.
    // `registered`/`waitedMs` are null rather than false/0: no bridge was
    // asked, and a fabricated `registered: false` reads as "the scene lost
    // its renderer", which is a different thing to go and fix.
    for (const record of [stillCaptureRecord("t", "round", 1), stillCaptureRecord("t", "target")]) {
      expect({ ready: record.ready, registered: record.registered, waited: record.waitedMs }).toEqual({
        ready: false,
        registered: null,
        waited: null,
      });
      expect(record.source).not.toBe("live");
    }
  });
});

// ── Notes ──────────────────────────────────────────────────────────────────

describe("trackNoteName", () => {
  test("a new name is appended", () => {
    expect(trackNoteName([], "integrationCheck")).toEqual(["integrationCheck"]);
    expect(trackNoteName(["a"], "b")).toEqual(["a", "b"]);
  });

  test("a repeat returns the same array, so the strip does not re-render", () => {
    const names = ["a", "b"];
    expect(trackNoteName(names, "b")).toBe(names);
    expect(trackNoteName(names, "")).toBe(names);
  });

  test("a scene that announces in a loop cannot grow the list without bound", () => {
    let names: string[] = [];
    for (let i = 0; i < MAX_TRACKED_NOTES + 5; i++) names = trackNoteName(names, `n${i}`);
    expect(names).toHaveLength(MAX_TRACKED_NOTES);
    expect(names[names.length - 1]).toBe(`n${MAX_TRACKED_NOTES + 4}`);
  });
});

describe("noteCount", () => {
  test("announcements and the state reply are one count, not two", () => {
    // The announcement carries the name, the state reply carries the value;
    // the same note usually arrives through both.
    expect(noteCount(["a", "b"], { a: 1, c: 3 })).toBe(3);
    expect(noteCount([], { a: 1 })).toBe(1);
    expect(noteCount(["a"], null)).toBe(1);
    expect(noteCount([], undefined)).toBe(0);
  });
});

// ── Capturing a still ──────────────────────────────────────────────────────

describe("fetchStillPayload", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

  const respond = (
    over: Partial<{ ok: boolean; type: string; body: Uint8Array }> = {},
  ) =>
    async () => ({
      ok: over.ok ?? true,
      headers: { get: () => over.type ?? "image/png" },
      arrayBuffer: async () =>
        (over.body ?? png).buffer.slice(
          (over.body ?? png).byteOffset,
          (over.body ?? png).byteOffset + (over.body ?? png).byteLength,
        ) as ArrayBuffer,
    });

  test("hands back the file's exact bytes, base64, with its media type", async () => {
    // Exact, because the recorded capture is what the judge scored — a
    // rasterized screenshot of the <img> would be a rescaled, re-encoded copy
    // of a picture the agent could have had verbatim.
    await expect(fetchStillPayload("/content/p/target.png", respond())).resolves.toEqual({
      data: base64FromBytes(png),
      media_type: "image/png",
    });
  });

  test("an HTML 404 page is not an image, whatever its status says", async () => {
    await expect(
      fetchStillPayload("/content/p/gone.png", respond({ type: "text/html; charset=utf-8" })),
    ).resolves.toBeNull();
  });

  test("a failed request, an empty body and no url are all null, not a throw", async () => {
    // Null lets `captureViewer` fall through to its own strategies; throwing
    // would turn a missing file into a broken `capture` action.
    await expect(fetchStillPayload("/content/p/x.png", respond({ ok: false }))).resolves.toBeNull();
    await expect(
      fetchStillPayload("/content/p/x.png", respond({ body: new Uint8Array(0) })),
    ).resolves.toBeNull();
    await expect(fetchStillPayload(null)).resolves.toBeNull();
    await expect(
      fetchStillPayload("/content/p/x.png", async () => {
        throw new Error("network down");
      }),
    ).resolves.toBeNull();
  });

  test("base64FromBytes survives a payload larger than one chunk", async () => {
    // `String.fromCharCode(...bytes)` on a 4 MB PNG blows the argument limit;
    // the chunking is the whole reason this helper exists.
    const big = new Uint8Array(0x8000 * 2 + 7).fill(200);
    expect(base64FromBytes(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

// ── House rules ────────────────────────────────────────────────────────────

describe("the viewer obeys the repository's UI rules", () => {
  const sources = readdirSync(join(import.meta.dir, "..", "viewer"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ file: f, text: readFileSync(join(import.meta.dir, "..", "viewer", f), "utf-8") }));

  test("there are viewer components to check", () => {
    expect(sources.length).toBeGreaterThan(2);
  });

  test("no emoji anywhere — icons are inline SVG", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const { file, text } of sources) {
      expect({ file, emoji: emoji.test(text) }).toEqual({ file, emoji: false });
    }
  });

  test("no native form-control chrome — a bare select or range clashes with the theme", () => {
    for (const { file, text } of sources) {
      expect({ file, native: /<(select|progress|meter)\b/.test(text) }).toEqual({
        file,
        native: false,
      });
      expect({ file, range: /type="(range|checkbox|radio)"/.test(text) }).toEqual({
        file,
        range: false,
      });
    }
  });

  test("the stage loads the scene by src, never srcdoc", () => {
    // `srcdoc` has no base URL, so `./vendor/three.module.js`, every GLB and
    // every texture 404s — as a blank canvas, with nothing on screen to say why.
    const preview = sources.find((s) => s.file === "LucidPreview.tsx")!.text;
    expect(preview).toContain("<iframe");
    // The attribute, not the word — the module comment above explains exactly
    // why this mode may not use it.
    expect(preview).not.toMatch(/srcdoc\s*=/);
  });
});

// ── The mounted stage ──────────────────────────────────────────────────────

/**
 * The half that only exists once the component is running: which control
 * changes what, and what `capture` actually hands back afterwards.
 *
 * Mounted against happy-dom with a FAKE SCENE answering the bridge — the
 * iframe's `contentWindow.postMessage` is replaced with a function that
 * replies on the parent window, so `state` and `capture` settle immediately
 * instead of waiting out the 3 s timeout of a scene that will never load in a
 * test. Pixels stay the browser's job; what is pinned here is the wiring that
 * decides WHICH picture the agent is handed, which no screenshot would show.
 */
describe("the mounted stage — the control, the selection and the capture agree", () => {
  let restore: (() => void) | undefined;

  beforeAll(() => {
    const window = new Window({ url: "http://localhost/" });
    const g = globalThis as unknown as Record<string, unknown>;
    const saved: Record<string, unknown> = {};
    const install = (key: string, value: unknown): void => {
      saved[key] = g[key];
      g[key] = value;
    };
    const w = window as unknown as Record<string, unknown>;
    for (const key of [
      "window", "document", "navigator", "HTMLElement", "Element", "Node",
      "Event", "CustomEvent", "MessageEvent", "getComputedStyle", "localStorage",
      "requestAnimationFrame", "cancelAnimationFrame",
    ]) {
      install(key, key === "window" ? window : w[key]);
    }
    install("ResizeObserver", class {
      observe(): void {}
      disconnect(): void {}
    });
    install("IS_REACT_ACT_ENVIRONMENT", true);
    // The stills come off `/content/…`; answer with bytes that name the URL so
    // a test can tell WHICH file came back.
    install("fetch", async (url: string) => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new TextEncoder().encode(`PNG:${url}`).buffer,
    }));
    restore = () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
    };
  });

  afterAll(() => restore?.());

  /** A scene that answers the bridge immediately, like a loaded one would. */
  function attachScene(iframe: HTMLIFrameElement, frame: string): void {
    const contentWindow = iframe.contentWindow as unknown as {
      postMessage: (message: { type: string; id: string }) => void;
    };
    const post = (data: unknown): void => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: iframe.contentWindow as never }),
      );
    };
    contentWindow.postMessage = (message) => {
      if (message.type === "pneuma:lucid:state") {
        post({
          type: "pneuma:lucid:state:result",
          id: message.id,
          state: { bridgeVersion: 1, registered: true, ready: true, fps: 58 },
        });
      } else if (message.type === "pneuma:lucid:capture") {
        post({
          type: "pneuma:lucid:capture:result",
          id: message.id,
          ok: true,
          dataUrl: frame,
          width: 1091,
          height: 738,
          registered: true,
        });
      }
    };
    post({ type: "pneuma:lucid:hello", bridgeVersion: 1 });
  }

  const LIVE_FRAME = "data:image/png;base64,TElWRQ==";

  async function mountStage() {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useStore } = await import("../../../src/store.js");
    const { default: LucidPreview } = await import("../viewer/LucidPreview.js");
    const lucidMode = (await import("../pneuma-mode.js")).default;

    useStore.setState({
      contentSets: [{ prefix: "lantern-shrine", label: "Lantern shrine", traits: {} }],
      activeContentSet: "lantern-shrine",
    });

    const loops = loadLoops([{ path: "lantern-shrine/lucid.json", content: SHRINE }])!;
    const source = {
      current: () => loops,
      subscribe: () => () => {},
      write: async () => {},
      destroy: () => {},
    };
    const selections: Array<Record<string, unknown> | null> = [];
    const results = new Map<string, { success: boolean; message?: string; data?: Record<string, unknown> }>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    const render = async (extra: Record<string, unknown> = {}) => {
      await act(async () => {
        root.render(
          createElement(LucidPreview, {
            sources: { loops: source },
            selection: null,
            onSelect: (s: Record<string, unknown> | null) => selections.push(s),
            mode: "view",
            imageVersion: 1,
            editing: false,
            onActionResult: (id: string, result: { success: boolean; message?: string; data?: Record<string, unknown> }) =>
              results.set(id, result),
            ...extra,
          } as unknown as ViewerPreviewProps),
        );
      });
    };

    await render();
    const iframe = host.querySelector("iframe") as HTMLIFrameElement;
    await act(async () => {
      attachScene(iframe, LIVE_FRAME);
    });

    const button = (text: string): HTMLButtonElement =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
    const chip = (prefix: string): HTMLButtonElement =>
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith(prefix),
      ) as HTMLButtonElement;

    let requests = 0;
    return {
      host,
      selections,
      press: async (el: HTMLButtonElement) => {
        await act(async () => {
          el.click();
        });
      },
      button,
      chip,
      capture: () => lucidMode.viewer.captureViewport!(),
      /** Run `get-scene-state` the way the runtime does, and read the answer. */
      sceneState: async (): Promise<Record<string, unknown>> => {
        const requestId = `req-${++requests}`;
        await render({ actionRequest: { requestId, actionId: "get-scene-state", params: {} } });
        await act(async () => {});
        return results.get(requestId)!.data!;
      },
      /** Run `navigate-to` the way the runtime does, and read the answer. */
      navigate: async (address: Record<string, unknown>) => {
        const requestId = `req-${++requests}`;
        await render({
          actionRequest: { requestId, actionId: "navigate-to", params: { address } },
        });
        await act(async () => {});
        return results.get(requestId)! as {
          success: boolean;
          message?: string;
          data?: Record<string, unknown>;
        };
      },
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  }

  test("a round on the stage is handed back AS a round, not as a fresh frame", async () => {
    const stage = await mountStage();
    try {
      await stage.press(stage.chip("R2"));
      const shot = await stage.capture();
      // The recorded PNG's own bytes, not a frame of the scene.
      expect(shot).toEqual({
        data: base64FromBytes(
          new TextEncoder().encode("PNG:/content/lantern-shrine/rounds/02/capture.png?v=1"),
        ),
        media_type: "image/png",
      });
      // …and the agent can find that out. Before this, `lastCapture` still
      // described some earlier live frame, so a still passed the readiness
      // check on evidence about a different picture.
      const state = await stage.sceneState();
      expect(state.lastCapture).toMatchObject({
        source: "round",
        round: 2,
        ready: false,
      });
    } finally {
      await stage.unmount();
    }
  });

  test("pressing Live clears the round, in the DOM, the selection and the capture", async () => {
    // The bug: the button changed only the view, so the round overlay stayed
    // mounted — "Live" was lit while `capture` still handed back round 2's
    // PNG, and the HTTP `navigate-to { view: "live" }` (which does clear it)
    // disagreed with the button beside it.
    const stage = await mountStage();
    try {
      await stage.press(stage.chip("R2"));
      expect(stage.host.querySelector('img[alt="Round 2 capture"]')).not.toBeNull();

      await stage.press(stage.button("Live"));
      expect(stage.host.querySelector('img[alt="Round 2 capture"]')).toBeNull();
      // The agent's copy of the selection lost the round too; otherwise the
      // user's next message still says "they are looking at round 2".
      expect(stage.selections[stage.selections.length - 1]).toMatchObject({
        type: "scene",
        address: { contentSet: "lantern-shrine" },
      });
      expect(
        (stage.selections[stage.selections.length - 1]!.address as Record<string, unknown>).round,
      ).toBeUndefined();

      const shot = await stage.capture();
      expect(shot).toEqual({ data: "TElWRQ==", media_type: "image/png" });
      const state = await stage.sceneState();
      expect(state.lastCapture).toMatchObject({ source: "live", ready: true, registered: true });
    } finally {
      await stage.unmount();
    }
  });

  test("the target on the stage is handed back as the target", async () => {
    // A judge scoring the target against itself costs a whole round, and the
    // reply — a PNG path — looks the same either way.
    const stage = await mountStage();
    try {
      await stage.press(stage.button("Target"));
      const shot = await stage.capture();
      expect(shot!.data).toBe(
        base64FromBytes(new TextEncoder().encode("PNG:/content/lantern-shrine/target.png?v=1")),
      );
      const state = await stage.sceneState();
      expect(state.lastCapture).toMatchObject({ source: "target", ready: false });
      expect((state.lastCapture as Record<string, unknown>).round).toBeUndefined();
    } finally {
      await stage.unmount();
    }
  });

  test("a round the project does not have is refused, and nothing moves", async () => {
    const stage = await mountStage();
    try {
      await stage.press(stage.chip("R1"));
      const refused = await stage.navigate({ round: 999, view: "split" });
      expect(refused.success).toBe(false);
      expect(refused.message).toContain("Round 999 is not recorded");
      // The stage still shows round 1 — a refusal that had moved something
      // would leave the agent describing a stage it cannot see.
      expect(refused.data).toMatchObject({ contentSet: "lantern-shrine", round: 1, view: "split" });
      expect(stage.host.querySelector('img[alt="Round 1 capture"]')).not.toBeNull();
    } finally {
      await stage.unmount();
    }
  });
});
