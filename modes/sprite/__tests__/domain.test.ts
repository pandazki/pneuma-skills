/**
 * Sprite domain tests — the `Roster` aggregate.
 *
 * A roster is N characters, each one a craft project file plus a `sprite`
 * sidecar, written by `sprite-project.mjs` while the agent works. Three
 * properties are load-bearing and all three are pinned here:
 *
 *  - the key is the DIRECTORY, because the character is the content set;
 *  - motions keep their DECLARED order, because that order is the rail;
 *  - a broken `project.json` is SKIPPED, not thrown on, because one
 *    half-written character must not blank the stage for its siblings.
 *
 * The canonical fixture (`fixtures/mini/project.json`) is the design
 * document's own example, byte-for-byte. TASK-4's `sprite-project.mjs` tests
 * reproduce it from the CLI, so the two halves of the contract are pinned
 * against the same artefact rather than against each other's assumptions.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import {
  CRAFT_PROJECT_SCHEMA,
  createCharacterProjectFile,
  EXPORT_FORMATS,
  findMotion,
  findRef,
  loadRoster,
  measuredAnchor,
  MOTION_STATUSES,
  resolveAssetUri,
  saveRoster,
} from "../domain.js";

const MINI = readFileSync(
  join(import.meta.dir, "fixtures", "mini", "project.json"),
  "utf-8",
);

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

describe("loadRoster", () => {
  test("keys the character by its directory prefix", () => {
    const roster = loadRoster(files({ "mini/project.json": MINI }));
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
    expect(roster!.byContentSet.mini.contentSet).toBe("mini");
    expect(roster!.byContentSet.mini.sprite.character.name).toBe("Mini");
  });

  test("a root-level project keys as the empty string", () => {
    // A quick session that never made a subdirectory is a real workspace,
    // not a degenerate one — the viewer resolves `""` the same as any prefix.
    const roster = loadRoster(files({ "project.json": MINI }));
    expect(Object.keys(roster!.byContentSet)).toEqual([""]);
    expect(roster!.byContentSet[""].contentSet).toBe("");
  });

  test("motions keep their declared order — that order is the rail", () => {
    const twoMotions = JSON.parse(MINI);
    twoMotions.sprite.motions.push({
      ...twoMotions.sprite.motions[0],
      id: "attack",
      label: "Attack",
    });
    const roster = loadRoster(
      files({ "mini/project.json": JSON.stringify(twoMotions) }),
    );
    expect(
      roster!.byContentSet.mini.sprite.motions.map((m) => m.id),
    ).toEqual(["bounce", "attack"]);
  });

  test("assets are indexed by id so a motion's frame ids resolve to uris", () => {
    const project = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini;
    const motion = project.sprite.motions[0];
    expect(motion.frames).toHaveLength(4);
    expect(
      motion.frames.map((id) => resolveAssetUri(project, id)),
    ).toEqual([
      "motions/bounce/frames/00.png",
      "motions/bounce/frames/01.png",
      "motions/bounce/frames/02.png",
      "motions/bounce/frames/03.png",
    ]);
    expect(resolveAssetUri(project, motion.sheet!)).toBe(
      "motions/bounce/sheet.png",
    );
    expect(resolveAssetUri(project, "no-such-asset")).toBeUndefined();
  });

  test("the sidecar's structural fields survive the parse intact", () => {
    const project = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini;
    const motion = project.sprite.motions[0];
    expect(motion.grid).toEqual({ rows: 2, cols: 2 });
    expect(motion.fps).toBe(8);
    expect(motion.loop).toBe(true);
    expect(motion.anchor).toBe("bottom");
    expect(motion.status).toBe("ready");
    expect(motion.inspect?.frameCount).toBe(4);
    expect(motion.inspect?.warnings).toEqual([]);
    expect(project.sprite.character.cell).toEqual({ width: 64, height: 64 });
    expect(project.sprite.refs).toEqual([
      { id: "portrait", asset: "ref-portrait", role: "portrait", label: "Portrait" },
    ]);
    expect(project.provenance).toHaveLength(9);
    expect(project.composition?.settings.fps).toBe(8);
  });

  test("returns null when the snapshot holds no project at all", () => {
    expect(loadRoster([])).toBeNull();
    expect(
      loadRoster(files({ "mini/refs/portrait.png": "", "notes.md": "hi" })),
    ).toBeNull();
  });

  test("a malformed project is skipped while a valid sibling still loads", () => {
    // The agent writes project.json mid-turn; a reader can catch a partial
    // file. Blanking the whole stage for it would be the wrong trade.
    const roster = loadRoster(
      files({
        "broken/project.json": '{"$schema": "pneuma-craft/pro',
        "mini/project.json": MINI,
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("a project without the craft schema or the sprite sidecar is skipped", () => {
    const noSchema = JSON.parse(MINI);
    delete noSchema.$schema;
    const noSidecar = JSON.parse(MINI);
    delete noSidecar.sprite;

    const roster = loadRoster(
      files({
        "no-schema/project.json": JSON.stringify(noSchema),
        "no-sidecar/project.json": JSON.stringify(noSidecar),
        "mini/project.json": MINI,
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("image entries arrive with empty content and are simply not projects", () => {
    // The aggregate-file source watches refs/ and motions/ as change signals;
    // their content is empty by design and must not look like a parse failure.
    const roster = loadRoster(
      files({
        "mini/project.json": MINI,
        "mini/refs/portrait.png": "",
        "mini/motions/bounce/frames/00.png": "",
      }),
    );
    expect(Object.keys(roster!.byContentSet)).toEqual(["mini"]);
  });

  test("every declared status survives, and an unknown one falls back", () => {
    // `status` is what the rail renders a chip for and what "is this motion
    // done" reads. A string outside the five would travel as if it were one
    // of ours — an unrenderable chip, or a half-built motion reading `ready`
    // because the sidecar carried a typo.
    const withStatus = (status: unknown) => {
      const body = JSON.parse(MINI);
      body.sprite.motions[0].status = status;
      return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
        .byContentSet.mini.sprite.motions[0].status;
    };

    for (const status of MOTION_STATUSES) {
      expect({ status, parsed: withStatus(status) }).toEqual({
        status,
        parsed: status,
      });
    }
    expect(withStatus("rendering")).toBe("planned");
    expect(withStatus("")).toBe("planned");
    expect(withStatus(7)).toBe("planned");
    expect(withStatus(undefined)).toBe("planned");
  });

  test("the measured anchor point survives, and a broken one does not", () => {
    // The point is where the pipeline actually put the feet inside the cell.
    // Unlike every other inspect number it has NO safe default: 0 would put
    // the viewer's pivot guide in the top-left corner while looking exactly
    // like a measurement, so a malformed point must vanish rather than degrade.
    const withPoint = (anchorPoint: unknown) => {
      const body = JSON.parse(MINI);
      body.sprite.motions[0].inspect.anchorPoint = anchorPoint;
      return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
        .byContentSet.mini.sprite.motions[0].inspect?.anchorPoint;
    };

    expect(withPoint({ x: 32, y: 56 })).toEqual({ x: 32, y: 56 });
    // Fractional pixels are real: `--scale` and an odd bbox both produce them.
    expect(withPoint({ x: 31.5, y: 55.5 })).toEqual({ x: 31.5, y: 55.5 });
    expect(withPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });

    for (const broken of [
      undefined,
      null,
      {},
      { x: 32 },
      { y: 56 },
      { x: "32", y: "56" },
      { x: 32, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 56 },
      [32, 56],
      "32,56",
    ]) {
      expect({ broken, parsed: withPoint(broken) }).toEqual({
        broken,
        parsed: undefined,
      });
    }
  });

  test("the measured body drift survives, and a broken one does not", () => {
    // `bodyDrift` is the number `align --x-from feet` exists to keep near
    // zero, and the row the viewer shows beside the anchor drift. It gets
    // `anchorPoint`'s treatment rather than `num(value, 0)`'s for one reason:
    // 0 is the GOOD reading here, so a default of 0 is indistinguishable from
    // a perfect measurement. It has to survive when real and vanish when not.
    const withDrift = (bodyDrift: unknown) => {
      const body = JSON.parse(MINI);
      body.sprite.motions[0].inspect.bodyDrift = bodyDrift;
      return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
        .byContentSet.mini.sprite.motions[0].inspect!;
    };

    // The Lumi seed's own two numbers, and the one that must not be dropped.
    for (const value of [0.199, 0.263, 17.4, 0]) {
      expect({ value, parsed: withDrift(value).bodyDrift }).toEqual({
        value,
        parsed: value,
      });
    }
    expect("bodyDrift" in withDrift(0)).toBe(true);

    for (const broken of [
      undefined,
      null,
      "0.199",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      {},
      [0.199],
      true,
    ]) {
      const parsed = withDrift(broken);
      expect({ broken, value: parsed.bodyDrift, present: "bodyDrift" in parsed }).toEqual({
        broken,
        value: undefined,
        present: false,
      });
    }

    // The canonical fixture predates the field, and absence is what tells the
    // viewer to leave the row out instead of printing a drift of 0.
    const mini = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini.sprite.motions[0].inspect!;
    expect("bodyDrift" in mini).toBe(false);
    expect(mini.frameCount).toBe(4);
  });

  test("a motion measured before the pipeline recorded the point has none", () => {
    // The canonical fixture predates `align.json`; absence is a real state,
    // and it is what tells the viewer to fall back to the cell instead of
    // drawing a guide on a number nobody measured.
    const project = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini;
    expect(project.sprite.motions[0].inspect?.anchorPoint).toBeUndefined();
    expect(project.sprite.motions[0].inspect?.frameCount).toBe(4);
  });

  test("a motion missing its optional halves still loads as a motion", () => {
    // `add-motion --status planned` writes exactly this: no sheet, no frames.
    const planned = JSON.parse(MINI);
    planned.sprite.motions = [
      {
        id: "walk",
        label: "Walk",
        prompt: "",
        grid: { rows: 2, cols: 4 },
        fps: 10,
        loop: true,
        anchor: "bottom",
        status: "planned",
        frames: [],
        videos: [],
      },
    ];
    const project = loadRoster(
      files({ "mini/project.json": JSON.stringify(planned) }),
    )!.byContentSet.mini;
    expect(project.sprite.motions[0].status).toBe("planned");
    expect(project.sprite.motions[0].sheet).toBeUndefined();
    expect(project.sprite.motions[0].inspect).toBeUndefined();
  });
});

/**
 * A loop motion, parsed.
 *
 * The three fields the stage reads off `kind` all fail SILENTLY when the word
 * does not survive: the panel opens the GIF tab for a motion that has no GIF,
 * the stage draws a pivot guide for an anchor nobody measured, and the Loop
 * tab — the only place the exports can be downloaded — never appears. So the
 * word, the two keyframe ids, the exports block and the loop's own inspect
 * numbers are pinned here the way `bodyDrift` is: present when real, absent
 * when not, never defaulted into a confident zero.
 */
describe("loop motions", () => {
  const motionWith = (edit: (motion: any) => void) => {
    const body = JSON.parse(MINI);
    edit(body.sprite.motions[0]);
    return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
      .byContentSet.mini.sprite.motions[0];
  };

  test("kind survives, and anything that is not `loop` is not a kind", () => {
    expect(motionWith((m) => { m.kind = "loop"; }).kind).toBe("loop");
    for (const broken of [undefined, null, "", "sprite", "Loop", 1, {}]) {
      expect({ broken, kind: motionWith((m) => { m.kind = broken; }).kind })
        .toEqual({ broken, kind: undefined });
    }
    // The canonical sprite motion says nothing at all, and that absence IS
    // "this is a sprite motion".
    expect("kind" in motionWith(() => {})).toBe(false);
  });

  test("a transition carries where it goes from and to, and its source when it is a reverse", () => {
    const transition = motionWith((m) => {
      m.id = "idle-to-coffee";
      m.kind = "transition";
      m.from = "idle";
      m.to = "coffee";
      m.loop = false;
      m.brief = { duration: 1.2, budgetUsd: 1.5, recordedAt: "2026-09-24T00:00:00.000Z" };
      m.inspect = { ...m.inspect, startGap: 0.012, endGap: 0.4, step: 0.03 };
    });
    expect(transition).toMatchObject({ kind: "transition", from: "idle", to: "coffee", loop: false });
    expect(transition.brief).toEqual({ duration: 1.2, budgetUsd: 1.5, recordedAt: "2026-09-24T00:00:00.000Z" });
    expect({ start: transition.inspect?.startGap, end: transition.inspect?.endGap }).toEqual({ start: 0.012, end: 0.4 });
    expect("reverseOf" in transition).toBe(false);

    const reverse = motionWith((m) => {
      m.kind = "transition";
      m.from = "coffee";
      m.to = "idle";
      m.reverseOf = "idle-to-coffee";
    });
    expect(reverse.reverseOf).toBe("idle-to-coffee");

    // A transition that does not say both ends connects nothing: it loads as
    // the sprite motion an unknown kind always falls back to.
    for (const broken of [{ from: "idle" }, { to: "coffee" }, { from: "", to: "coffee" }, { from: 1, to: 2 }]) {
      const parsed = motionWith((m) => { Object.assign(m, { kind: "transition" }, broken); });
      expect({ broken, kind: parsed.kind, from: parsed.from }).toEqual({ broken, kind: undefined, from: undefined });
    }
    // A half brief is no brief, as for a loop; a loop's brief is not a transition's.
    expect(motionWith((m) => {
      Object.assign(m, { kind: "transition", from: "a", to: "b", brief: { duration: 1.2, recordedAt: "x" } });
    }).brief).toBeUndefined();
    expect(motionWith((m) => {
      Object.assign(m, { kind: "loop", brief: { duration: 1.2, budgetUsd: 1, recordedAt: "x" } });
    }).brief).toBeUndefined();
  });

  test("the keyframe ids travel, and an empty one does not", () => {
    const withKeys = motionWith((m) => {
      m.keyframe = "bounce-keyframe";
      m.keyframeAlpha = "bounce-keyframe-alpha";
    });
    expect(withKeys.keyframe).toBe("bounce-keyframe");
    expect(withKeys.keyframeAlpha).toBe("bounce-keyframe-alpha");

    const empty = motionWith((m) => {
      m.keyframe = "";
      m.keyframeAlpha = 7;
    });
    expect(empty.keyframe).toBeUndefined();
    expect(empty.keyframeAlpha).toBeUndefined();
  });

  test("exports carry only the ids that are really there", () => {
    expect(motionWith((m) => {
      m.exports = { apng: "b-apng", webm: "b-webm", lottie: "b-lottie" };
    }).exports).toEqual({ apng: "b-apng", webm: "b-webm", lottie: "b-lottie" });

    // A partial export set is normal: an encoder the machine does not have is
    // skipped with a warning, and the tab must offer what exists.
    expect(motionWith((m) => { m.exports = { webm: "b-webm" }; }).exports)
      .toEqual({ webm: "b-webm" });

    // An empty block is no block — `motion.exports` must not be truthy for a
    // motion that exported nothing.
    for (const broken of [undefined, null, {}, { apng: "" }, [], "b-apng"]) {
      expect({ broken, exports: motionWith((m) => { m.exports = broken; }).exports })
        .toEqual({ broken, exports: undefined });
    }
  });

  test("seam, step, seam fill and alpha coverage survive — including a perfect 0", () => {
    const inspectWith = (over: Record<string, unknown>) =>
      motionWith((m) => { m.inspect = { ...m.inspect, ...over }; }).inspect!;

    const measured = inspectWith({ seam: 0.0065, step: 0.02, seamFill: 3, alphaCoverage: 0.31 });
    expect(measured.seam).toBe(0.0065);
    expect(measured.step).toBe(0.02);
    // `loop --seam-fill auto` inserted three in-betweens at the wrap; the
    // panel says so beside a frame count that is no longer the clip's own.
    expect(measured.seamFill).toBe(3);
    expect(measured.alphaCoverage).toBe(0.31);

    // 0 is the seam of a loop that closes exactly, which is the whole point of
    // the workflow — it must not be mistaken for "not measured". A seamFill of
    // 0 is the same statement: the wrap needed no help.
    const perfect = inspectWith({ seam: 0, step: 0, seamFill: 0, alphaCoverage: 0 });
    expect("seam" in perfect).toBe(true);
    expect(perfect.seam).toBe(0);
    expect(perfect.step).toBe(0);
    expect("seamFill" in perfect).toBe(true);
    expect(perfect.seamFill).toBe(0);
    expect(perfect.alphaCoverage).toBe(0);

    for (const broken of [undefined, null, "0.0065", Number.NaN, {}, [0.0065], true]) {
      const parsed = inspectWith({ seam: broken, step: broken, seamFill: broken, alphaCoverage: broken });
      expect({
        broken,
        seam: "seam" in parsed,
        step: "step" in parsed,
        seamFill: "seamFill" in parsed,
        alpha: "alphaCoverage" in parsed,
      }).toEqual({ broken, seam: false, step: false, seamFill: false, alpha: false });
    }

    // A sheet motion carries none of the three, and the anchor numbers it does
    // carry still parse beside them.
    const sheet = loadRoster(files({ "mini/project.json": MINI }))!
      .byContentSet.mini.sprite.motions[0].inspect!;
    expect("seam" in sheet).toBe(false);
    expect(sheet.maxJump).toBe(1);
  });

  test("a loop's crop and clip scale survive; anything else is no record", () => {
    const inspectWith = (over: Record<string, unknown>) =>
      motionWith((m) => { m.inspect = { ...m.inspect, ...over }; }).inspect!;
    const recorded = inspectWith({ crop: { x: 97, y: 46, w: 434, h: 552 }, scale: 1.1797 });
    expect(recorded.crop).toEqual({ x: 97, y: 46, w: 434, h: 552 });
    expect(recorded.scale).toBe(1.1797);
    for (const [crop, scale] of [
      [undefined, undefined], [null, 0], [{ x: 1, y: 2, w: 3 }, -1], [{ x: "1", y: 2, w: 3, h: 4 }, "1.2"],
      [{ x: 0, y: 0, w: 0, h: 4 }, Number.NaN],
    ]) {
      const parsed = inspectWith({ crop, scale });
      expect({ crop, scale, has: ["crop" in parsed, "scale" in parsed] }).toEqual({ crop, scale, has: [false, false] });
    }
  });

  test("a loop's measured clip record survives; half of one is no record", () => {
    const clipWith = (clip: unknown) => motionWith((m) => { m.kind = "loop"; m.clip = clip; }).clip;
    expect(clipWith({ scale: 1.18, origin: { x: 97.2, y: 46.1 }, from: "measured" }))
      .toEqual({ scale: 1.18, origin: { x: 97.2, y: 46.1 }, from: "measured" });
    // The scale alone is still a record: the loop is sized, and stood on its feet.
    expect(clipWith({ scale: 1.18, origin: null, from: "measured" }))
      .toEqual({ scale: 1.18, origin: null, from: "measured" });
    for (const broken of [undefined, null, { scale: 0, from: "measured" }, { scale: 1.2 }, { scale: "1.2", from: "measured" },
      { scale: 1.2, origin: { x: 1 }, from: "measured" }, { scale: 1.2, from: "recorded" }]) {
      expect({ broken, clip: clipWith(broken) }).toEqual({ broken, clip: undefined });
    }
    // A sprite motion is not cut from a clip, so it has no such record.
    expect(motionWith((m) => { m.clip = { scale: 1.18, origin: null, from: "measured" }; }).clip).toBeUndefined();
  });

  test("a derived clip keeps its parent, its op and its matting model", () => {
    const videos = motionWith((m) => {
      m.videos = [
        { id: "video-1", asset: "bounce-video-1", model: "seedance-2.5", mode: "first-last", prompt: "a flame", status: "ready" },
        { id: "video-2", asset: "bounce-video-2", model: "veed", mode: "derived", prompt: "", status: "ready", derivedFrom: "video-1", op: "matte" },
        { id: "video-3", asset: "bounce-video-3", model: "topaz", mode: "derived", prompt: "", status: "ready", derivedFrom: "video-1", op: "interpolate" },
      ];
    }).videos;

    expect(videos.map((v) => [v.model, v.mode, v.derivedFrom, v.op])).toEqual([
      ["seedance-2.5", "first-last", undefined, undefined],
      ["veed", "derived", "video-1", "matte"],
      ["topaz", "derived", "video-1", "interpolate"],
    ]);
    // A generated clip has no derivation, and the keys stay off it entirely.
    expect("derivedFrom" in videos[0]).toBe(false);
    expect("op" in videos[0]).toBe(false);
  });

  test("bria is a model, and an unknown one still falls back as before", () => {
    const parse = (model: unknown, mode: unknown, op: unknown) =>
      motionWith((m) => {
        m.videos = [{ id: "video-1", asset: "bounce-video-1", model, mode, prompt: "", status: "ready", op }];
      }).videos[0];

    expect(parse("bria", "derived", "matte").model).toBe("bria");
    // The fallback is unchanged: a name nothing can render travels as the clip
    // every motion of this mode started as, not as itself.
    expect(parse("sora-9", "derived", "matte").model).toBe("seedance-2.5");
    expect(parse("veed", "matting", "matte").mode).toBe("i2v");
    expect(parse("veed", "derived", "denoise").op).toBeUndefined();
  });

  test("a retime by ffmpeg is a clip made out of a clip like any other", () => {
    // The Kiki trial reordered a plate clip's own frames with ffmpeg concat to
    // cut a 1.5s freeze and a double blink out of it, and had nowhere to
    // record it: the result travelled as `op: "interpolate", model: "topaz"`,
    // which is a step nobody ran. Both names exist now.
    const video = motionWith((m) => {
      m.videos = [
        { id: "video-1", asset: "bounce-video-1", model: "seedance-2.5", mode: "first-last", prompt: "a flame", status: "ready" },
        { id: "video-2", asset: "bounce-video-2", model: "ffmpeg", mode: "derived", prompt: "", status: "ready", derivedFrom: "video-1", op: "retime" },
      ];
    }).videos[1];
    expect([video.model, video.mode, video.op, video.derivedFrom])
      .toEqual(["ffmpeg", "derived", "retime", "video-1"]);
  });

  test("the loop brief survives whole, or not at all, and only on a loop", () => {
    const briefedAs = (kind: unknown, brief: unknown) =>
      motionWith((m) => { m.kind = kind; m.brief = brief; }).brief;
    const briefed = (brief: unknown) => briefedAs("loop", brief);

    const full = {
      duration: 4, width: 512, interpolator: "topaz" as const, budgetUsd: 3,
      recordedAt: "2026-09-22T07:11:00.000Z",
    };
    expect(briefed(full)).toEqual(full);

    // A budget is the one optional answer: the user may not have named a
    // ceiling, and 0 is not the same statement as "they said nothing".
    const { budgetUsd: _none, ...noBudget } = full;
    expect(briefed(noBudget)).toEqual(noBudget);
    expect("budgetUsd" in briefed(noBudget)!).toBe(false);

    // A half-recorded brief is not a brief: the scripts gate a paid clip on
    // it, so a partial one would open that gate on answers nobody gave.
    for (const broken of [
      undefined, null, {}, "4s",
      { ...full, duration: undefined }, { ...full, duration: 0 }, { ...full, duration: "4" },
      { ...full, width: undefined }, { ...full, width: Number.NaN },
      { ...full, interpolator: "topaz-2" }, { ...full, interpolator: undefined },
      { ...full, recordedAt: undefined }, { ...full, recordedAt: "" },
    ]) {
      expect({ broken, brief: briefed(broken) }).toEqual({ broken, brief: undefined });
    }

    // A sprite motion never carries one — the same tolerance every loop-only
    // field gets, because a brief on a sheet motion describes nothing.
    expect(briefedAs(undefined, full)).toBeUndefined();
    expect(briefedAs("sprite", full)).toBeUndefined();
  });
});

/**
 * On-demand exports (0.4.0).
 *
 * `motion.exports` was the loop's `{ apng, webm, lottie }`; it is now a map
 * from export format to asset id on EVERY motion, and the character gained
 * `sprite.exports.riv`. The Export tab reads both to decide which rows are
 * ready — a key that fails to survive shows a Generate button for a file the
 * user already has, and a key that is invented offers a download of nothing.
 */
describe("exports", () => {
  const withBody = (edit: (body: any) => void) => {
    const body = JSON.parse(MINI);
    edit(body);
    return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!.byContentSet.mini;
  };

  test("the format list is the one the scripts export", () => {
    expect([...EXPORT_FORMATS]).toEqual(["mp4", "mov", "webm", "apng", "lottie", "png-seq"]);
  });

  test("a sprite motion carries every format it exported, keyed by format", () => {
    const all = {
      mp4: "bounce-export-mp4",
      mov: "bounce-export-mov",
      webm: "bounce-export-webm",
      apng: "bounce-export-apng",
      lottie: "bounce-export-lottie",
      "png-seq": "bounce-export-png-seq",
    };
    const motion = withBody((b) => { b.sprite.motions[0].exports = all; }).sprite.motions[0];
    expect(motion.exports).toEqual(all);
  });

  test("a key that is not an export format, or an empty id, is not an export", () => {
    // `gif`, `webp` and the sheet are the motion's own fields, and `riv`
    // belongs to the character — none of them is an on-demand export of a
    // motion, and letting them through would show a second row for a file the
    // tab already lists.
    const motion = withBody((b) => {
      b.sprite.motions[0].exports = { mp4: "bounce-export-mp4", gif: "bounce-gif", riv: "x", mov: "", webm: 3 };
    }).sprite.motions[0];
    expect(motion.exports).toEqual({ mp4: "bounce-export-mp4" });
  });

  test("a 0.3.x loop's exports load unchanged under the same keys", () => {
    const motion = withBody((b) => {
      const m = b.sprite.motions[0];
      m.kind = "loop";
      m.exports = { apng: "bounce-apng", webm: "bounce-webm", lottie: "bounce-lottie" };
    }).sprite.motions[0];
    expect(motion.exports).toEqual({ apng: "bounce-apng", webm: "bounce-webm", lottie: "bounce-lottie" });
  });

  test("the character's Rive file travels, and a project without one has no block", () => {
    const withRiv = withBody((b) => { b.sprite.exports = { riv: "mini-export-riv" }; });
    expect(withRiv.sprite.exports).toEqual({ riv: "mini-export-riv" });

    // The 0.3.x file has no `sprite.exports` at all — the canonical fixture
    // is one — and it must load exactly as before.
    const old = loadRoster(files({ "mini/project.json": MINI }))!.byContentSet.mini;
    expect("exports" in old.sprite).toBe(false);
    expect(old.sprite.motions[0].status).toBe("ready");

    for (const broken of [null, {}, { riv: "" }, { riv: 4 }, [], "mini-export-riv"]) {
      expect({ broken, exports: withBody((b) => { b.sprite.exports = broken; }).sprite.exports })
        .toEqual({ broken, exports: undefined });
    }
  });
});

describe("measuredAnchor", () => {
  const motionWith = (inspect: unknown) => {
    const body = JSON.parse(MINI);
    body.sprite.motions[0].inspect = inspect;
    return loadRoster(files({ "mini/project.json": JSON.stringify(body) }))!
      .byContentSet.mini.sprite.motions[0];
  };

  test("hands back the point together with the cell it was taken in", () => {
    // The two travel as one value on purpose: a point in pixels means nothing
    // without the cell, and both readers (the stage guide, the atlas pivot)
    // have to compare or divide by that cell before they can use it.
    const motion = motionWith({
      frameCount: 4,
      cell: { width: 64, height: 64 },
      anchorPoint: { x: 32, y: 56 },
      anchorDrift: { x: 0, y: 0 },
      maxJump: 0,
      scaleDrift: 0,
      emptyFrames: [],
      warnings: [],
    });
    expect(measuredAnchor(motion)).toEqual({
      point: { x: 32, y: 56 },
      cell: { width: 64, height: 64 },
    });
  });

  test("no inspect, no point, or a zero cell is no measurement", () => {
    expect(measuredAnchor(motionWith(undefined))).toBeUndefined();
    expect(
      measuredAnchor(
        motionWith({
          frameCount: 4,
          cell: { width: 64, height: 64 },
          anchorDrift: { x: 0, y: 0 },
          maxJump: 0,
          scaleDrift: 0,
          emptyFrames: [],
          warnings: [],
        }),
      ),
    ).toBeUndefined();
    // A cell of 0 is what the parser leaves behind when `cell` was missing;
    // nothing can be divided by it or matched against it.
    expect(
      measuredAnchor(
        motionWith({
          frameCount: 4,
          anchorPoint: { x: 32, y: 56 },
          anchorDrift: { x: 0, y: 0 },
          maxJump: 0,
          scaleDrift: 0,
          emptyFrames: [],
          warnings: [],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("lookups", () => {
  const project = loadRoster(files({ "mini/project.json": MINI }))!
    .byContentSet.mini;

  test("findMotion / findRef resolve by address key, and miss cleanly", () => {
    expect(findMotion(project, "bounce")?.label).toBe("Bounce");
    expect(findMotion(project, "attack")).toBeUndefined();
    expect(findRef(project, "portrait")?.asset).toBe("ref-portrait");
    expect(findRef(project, "turnaround")).toBeUndefined();
  });
});

describe("saveRoster", () => {
  test("throws — the viewer is read-only in v0.1", () => {
    // Silence here would mean a viewer write vanishing without a trace.
    expect(() => saveRoster({ byContentSet: {} }, [])).toThrow(
      /read-only/,
    );
  });
});

describe("createCharacterProjectFile", () => {
  test("produces a project the loader accepts — createEmpty and `init` agree", () => {
    // The viewer's "new character" and `sprite-project.mjs init` must write
    // the same skeleton; they share this function so they cannot drift, and
    // this test pins the shape both of them depend on.
    const content = createCharacterProjectFile({
      name: "Lumi",
      description: "A lantern courier.",
      style: "clean anime-chibi line art",
      cell: { width: 256, height: 256 },
      facing: "right",
    });
    const roster = loadRoster(files({ "lumi/project.json": content }));
    const project = roster!.byContentSet.lumi;

    expect(JSON.parse(content).$schema).toBe(CRAFT_PROJECT_SCHEMA);
    expect(project.title).toBe("Lumi");
    expect(project.sprite.character).toEqual({
      name: "Lumi",
      description: "A lantern courier.",
      style: "clean anime-chibi line art",
      cell: { width: 256, height: 256 },
      facing: "right",
    });
    expect(project.sprite.refs).toEqual([]);
    expect(project.sprite.motions).toEqual([]);
    expect(project.assets).toEqual([]);
    expect(project.provenance).toEqual([]);
    // Composition mirrors the cell size: a future timeline renders at the
    // character's own resolution, not at a guessed one.
    expect(project.composition?.settings).toEqual({
      width: 256,
      height: 256,
      fps: 8,
      aspectRatio: "1:1",
    });
    expect(content.endsWith("\n")).toBe(true);
  });

  test("defaults a 256×256 cell and omits facing when unspecified", () => {
    const body = JSON.parse(createCharacterProjectFile({ name: "Nameless" }));
    expect(body.sprite.character.cell).toEqual({ width: 256, height: 256 });
    expect("facing" in body.sprite.character).toBe(false);
  });
});
