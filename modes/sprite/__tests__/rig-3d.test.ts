/**
 * rig-3d.mjs — the image → rigged 3D model + animations step, without fal.
 *
 * The catalog, the two request bodies and the response → files mapping are
 * pinned as pure functions; the two steps run end to end with an injected
 * job runner and downloader (so the save / missing / failed decisions are
 * the real code's), and the CLI is driven only with arguments it must refuse
 * before the key is read. Nothing here can reach a paid endpoint.
 *
 * The response fixtures follow fal's OpenAPI for both endpoints and the
 * shape one real `meshy/v7.1/image-to-3d` run returned on 2026-10-30.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTION_ID_MAX,
  ACTIONS,
  ANIMATE_ENDPOINT,
  FAL_QUEUE_URL,
  MAX_ACTIONS,
  MODEL_ENDPOINT,
  animateModel,
  buildAnimateBody,
  buildModelBody,
  costLine,
  outputFiles,
  resolveActions,
  rigModel,
  stepCost,
} from "../skill/scripts/rig-3d.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "rig-3d.mjs");
const work = mkdtempSync(join(tmpdir(), "rig-3d-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const media = (name: string) => ({ url: `https://v3b.fal.media/files/x/${name}` });

/** Shaped like the real image-to-3d run (rigging on, no extra animation). */
const MODEL_RESULT = {
  model_glb: media("model.glb"),
  model_urls: { glb: media("model.glb"), fbx: media("model.fbx"), obj: media("model.obj"), stl: media("model.stl"), usdz: media("model.usdz") },
  thumbnail: media("preview.png"),
  texture_urls: [{ base_color: media("texture_0.png") }],
  rigged_character_glb: media("Character_output.glb"),
  rigged_character_fbx: media("Character_output.fbx"),
  basic_animations: {
    walking_glb: media("Animation_Walking_withSkin.glb"),
    walking_fbx: media("Animation_Walking_withSkin.fbx"),
    walking_armature_glb: media("Animation_Walking_armature.glb"),
    running_glb: media("Animation_Running_withSkin.glb"),
    running_fbx: media("Animation_Running_withSkin.fbx"),
    running_armature_glb: media("Animation_Running_armature.glb"),
  },
  rig_task_id: "rig-task-123",
};

/** Multi-animation output: `animations` is AnimationClip[] — action_id, animation_glb, animation_fbx. */
const ANIMATE_RESULT = {
  rigged_character_glb: media("rigged.glb"),
  rigged_character_fbx: media("rigged.fbx"),
  basic_animations: MODEL_RESULT.basic_animations,
  animations: [
    { action_id: 30, animation_glb: media("clip-30.glb"), animation_fbx: media("clip-30.fbx") },
    { action_id: 219, animation_glb: media("clip-219.glb"), animation_fbx: media("clip-219.fbx") },
    { action_id: 500, animation_glb: media("clip-500.glb"), animation_fbx: null },
  ],
  rig_task_id: "rig-task-456",
};

describe("action catalog", () => {
  test("names and library ids are unique and in fal's range", () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    expect(new Set(ACTIONS.map((a) => a.action)).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) {
      expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(Number.isInteger(a.action) && a.action >= 0 && a.action <= ACTION_ID_MAX).toBe(true);
    }
    const ids = Object.fromEntries(ACTIONS.map((a) => [a.id, a.action]));
    expect(ids).toMatchObject({ idle: 0, walk: 30, run: 14, jump: 466, "sword-slash": 219, death: 8, spell: 129 });
  });

  test("resolves names, raw ids and its own action-<n> spelling, in order", () => {
    expect(resolveActions("walk, Run ,sword-slash")).toEqual([
      { id: "walk", label: "Walk", action: 30 },
      { id: "run", label: "Run", action: 14 },
      { id: "sword-slash", label: "Sword slash", action: 219 },
    ]);
    // A raw id outside the catalog keeps a raw name; one inside takes the catalog's.
    expect(resolveActions(["500", 178, "action-7"])).toEqual([
      { id: "action-500", label: "Action 500", action: 500 },
      { id: "hit", label: "Hit", action: 178 },
      { id: "action-7", label: "Action 7", action: 7 },
    ]);
  });

  test("repeats are kept once, by library id", () => {
    expect(resolveActions("walk,30,walk,idle,action-30").map((a) => a.id)).toEqual(["walk", "idle"]);
  });

  test("refuses unknown names, out-of-range ids and empty lists, naming each", () => {
    expect(() => resolveActions("walk,moonwalk,flail")).toThrow(/unknown actions: moonwalk, flail/);
    expect(() => resolveActions("697")).toThrow(/0–696/);
    expect(() => resolveActions("-3")).toThrow(/unknown action: -3/);
    expect(() => resolveActions("")).toThrow(/at least one action/);
    expect(() => resolveActions([])).toThrow(/at least one action/);
  });

  test("refuses more than ten distinct actions, but not ten plus repeats", () => {
    const eleven = ACTIONS.slice(0, MAX_ACTIONS + 1).map((a) => a.id);
    expect(() => resolveActions(eleven)).toThrow(/at most 10 distinct actions/);
    const tenWithRepeats = [...eleven.slice(0, MAX_ACTIONS), eleven[0], String(ACTIONS[1].action)];
    expect(resolveActions(tenWithRepeats)).toHaveLength(MAX_ACTIONS);
  });
});

describe("request bodies", () => {
  test("model: rigging on, texturing explicit, defaults as documented", () => {
    expect(buildModelBody({ image: "https://example.com/hero.png" })).toEqual({
      image_url: "https://example.com/hero.png",
      enable_rigging: true,
      rigging_height_meters: 1.7,
      pose_mode: "a-pose",
      should_texture: true,
      enable_pbr: false,
      target_polycount: 30000,
      model_type: "standard",
    });
    const body = buildModelBody({ image: "https://example.com/hero.png", height: "1.2", polycount: "8000", modelType: "lowpoly", pose: "none" });
    expect(body).toMatchObject({ rigging_height_meters: 1.2, target_polycount: 8000, model_type: "lowpoly", pose_mode: "" });
  });

  test("model: a local PNG is inlined as a data URI", () => {
    const png = join(work, "hero.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(buildModelBody({ image: png }).image_url).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
  });

  test("model: refuses what fal would reject or silently ignore", () => {
    const image = "https://example.com/hero.png";
    expect(() => buildModelBody({})).toThrow(/--image is required/);
    expect(() => buildModelBody({ image: join(work, "clip.mp4") })).toThrow(/--image must be/);
    expect(() => buildModelBody({ image: join(work, "absent.png") })).toThrow(/file not found/);
    expect(() => buildModelBody({ image, height: 0 })).toThrow(/--height/);
    expect(() => buildModelBody({ image, height: "tall" })).toThrow(/--height/);
    expect(() => buildModelBody({ image, polycount: 99 })).toThrow(/--polycount/);
    expect(() => buildModelBody({ image, polycount: 300001 })).toThrow(/--polycount/);
    expect(() => buildModelBody({ image, polycount: "1e3.5" })).toThrow(/--polycount/);
    expect(() => buildModelBody({ image, modelType: "smart-topology" })).toThrow(/--model-type/);
    expect(() => buildModelBody({ image, pose: "" })).toThrow(/--pose/);
  });

  test("animate: ids in request order, names or resolved actions alike", () => {
    const expected = { model_url: "https://v3b.fal.media/files/x/m.glb", animation_action_ids: [0, 30, 219], height_meters: 1.7 };
    expect(buildAnimateBody({ modelUrl: expected.model_url, actions: "idle,walk,sword-slash" })).toEqual(expected);
    expect(buildAnimateBody({ modelUrl: expected.model_url, actions: resolveActions("idle,walk,sword-slash") })).toEqual(expected);
    expect(buildAnimateBody({ modelUrl: expected.model_url, actions: [0, 30], height: 2 }).height_meters).toBe(2);
    expect(() => buildAnimateBody({ modelUrl: "model.glb", actions: "walk" })).toThrow(/http\(s\) URL/);
    expect(() => buildAnimateBody({ modelUrl: expected.model_url, actions: "wave" })).toThrow(/unknown action/);
  });
});

describe("outputFiles", () => {
  test("model: the rigged GLB is the model; mesh, thumbnail and the two basic clips follow", () => {
    expect(outputFiles(MODEL_RESULT)).toEqual([
      { role: "model", name: "model.glb", url: MODEL_RESULT.rigged_character_glb.url, required: true },
      { role: "mesh", name: "mesh.glb", url: MODEL_RESULT.model_glb.url, required: false },
      { role: "thumbnail", name: "thumbnail.png", url: MODEL_RESULT.thumbnail.url, required: false },
      { role: "animation", name: "anim-walk.glb", url: MODEL_RESULT.basic_animations.walking_glb.url, required: false, animation: { id: "walk", label: "Walk" } },
      { role: "animation", name: "anim-run.glb", url: MODEL_RESULT.basic_animations.running_glb.url, required: false, animation: { id: "run", label: "Run" } },
    ]);
  });

  test("model: absent pieces keep their slot with no URL", () => {
    const files = outputFiles({ model_glb: media("m.glb"), model_urls: {}, rigged_character_glb: null, basic_animations: null });
    expect(files.find((f) => f.role === "model")).toMatchObject({ url: null, required: true });
    expect(files.filter((f) => f.url === null).map((f) => f.name)).toEqual(["model.glb", "thumbnail.png", "anim-walk.glb", "anim-run.glb"]);
  });

  test("animate: clips matched by action_id, one slot per requested action", () => {
    const files = outputFiles(ANIMATE_RESULT, { actions: resolveActions("walk,sword-slash,500,hit") });
    expect(files.map((f) => [f.name, f.url, f.required])).toEqual([
      ["model-rigged.glb", ANIMATE_RESULT.rigged_character_glb.url, false],
      ["anim-walk.glb", ANIMATE_RESULT.animations[0].animation_glb.url, true],
      ["anim-sword-slash.glb", ANIMATE_RESULT.animations[1].animation_glb.url, true],
      ["anim-action-500.glb", ANIMATE_RESULT.animations[2].animation_glb.url, true],
      ["anim-hit.glb", null, true],
    ]);
    expect(files[2].animation).toEqual({ id: "sword-slash", label: "Sword slash", action: 219 });
  });

  test("animate without a request list takes the clips as they came", () => {
    expect(outputFiles(ANIMATE_RESULT).map((f) => f.name)).toEqual(["model-rigged.glb", "anim-walk.glb", "anim-sword-slash.glb", "anim-action-500.glb"]);
  });

  test("an unrecognisable response is an error, not an empty list", () => {
    expect(() => outputFiles(null)).toThrow(/not an object/);
    expect(() => outputFiles({ video: media("v.mp4") })).toThrow(/neither model_glb nor animations/);
  });
});

test("cost is the list price, said as an estimate", () => {
  expect(stepCost("model")).toMatchObject({ usd: 0.8, estimate: true, basis: "fal list price per generation" });
  expect(stepCost("animate").usd).toBe(0.08);
  expect(costLine(stepCost("model"), MODEL_ENDPOINT)).toMatch(/^cost: ≈ \$0\.80 .*meshy\/v7\.1\/image-to-3d.*estimate/);
});

test("a source checkout resolves the shared fal client", () => {
  expect(FAL_QUEUE_URL.endsWith("/_shared/scripts/fal-queue.mjs")).toBe(true);
});

/** A job runner and downloader that record what they were asked and never touch the network. */
function fakes(data: unknown, { failing = [] as string[] } = {}) {
  const calls = { jobs: [] as any[], downloads: [] as string[], uploads: [] as string[] };
  return {
    calls,
    deps: {
      runJob: async (options: any) => {
        calls.jobs.push(options);
        return { data, requestId: "req-1" };
      },
      download: async (url: string) => {
        calls.downloads.push(url);
        if (failing.some((name) => url.endsWith(name))) throw new Error("HTTP 502");
        return Buffer.from(`bytes:${url}`);
      },
      upload: async (path: string) => {
        calls.uploads.push(path);
        return "https://v3b.fal.media/files/x/uploaded.glb";
      },
    },
  };
}

describe("steps, with fal stubbed out", () => {
  const image = "https://example.com/hero.png";

  test("model: writes every file and reports where it went", async () => {
    const out = join(work, "model-ok");
    const { calls, deps } = fakes(MODEL_RESULT);
    const { report, failed } = await rigModel({ image, out, apiKey: "k" }, deps);
    expect(failed).toBe(false);
    expect(calls.jobs[0].url).toBe(`https://fal.run/${MODEL_ENDPOINT}`);
    expect(calls.jobs[0].body.enable_rigging).toBe(true);
    expect(report).toMatchObject({
      step: "model",
      provider: "meshy-7.1",
      endpoint: MODEL_ENDPOINT,
      image,
      files: {
        model: join(out, "model.glb"),
        mesh: join(out, "mesh.glb"),
        thumbnail: join(out, "thumbnail.png"),
        animations: [
          { id: "walk", label: "Walk", file: join(out, "anim-walk.glb") },
          { id: "run", label: "Run", file: join(out, "anim-run.glb") },
        ],
      },
      remote: { model_url: MODEL_RESULT.rigged_character_glb.url, rig_task_id: "rig-task-123" },
      missing: [],
      cost: { usd: 0.8, estimate: true },
      request_id: "req-1",
    });
    expect(readFileSync(join(out, "model.glb"), "utf-8")).toBe(`bytes:${MODEL_RESULT.rigged_character_glb.url}`);
    expect(existsSync(join(out, "model.glb.tmp"))).toBe(false);
  });

  test("model: a lost side file is reported missing, the run still succeeds", async () => {
    const out = join(work, "model-partial");
    const { deps } = fakes(MODEL_RESULT, { failing: ["preview.png"] });
    const { report, failed } = await rigModel({ image, out, apiKey: "k" }, deps);
    expect(failed).toBe(false);
    expect(report.files.thumbnail).toBeNull();
    expect(report.missing).toEqual([
      { role: "thumbnail", file: join(out, "thumbnail.png"), url: MODEL_RESULT.thumbnail.url, reason: expect.stringContaining("HTTP 502") },
    ]);
  });

  test("model: a lost rigged model fails the run, with everything else saved", async () => {
    const out = join(work, "model-failed");
    const { deps } = fakes(MODEL_RESULT, { failing: ["Character_output.glb"] });
    const { report, failed } = await rigModel({ image, out, apiKey: "k" }, deps);
    expect(failed).toBe(true);
    expect(report.files.model).toBeNull();
    expect(report.files.mesh).toBe(join(out, "mesh.glb"));
    expect(report.missing.map((m) => m.role)).toEqual(["model"]);
    // The URL survives so the paid-for file can still be fetched by hand.
    expect(report.remote.model_url).toBe(MODEL_RESULT.rigged_character_glb.url);
  });

  test("model: no rigged character in the response also fails", async () => {
    const { deps } = fakes({ ...MODEL_RESULT, rigged_character_glb: null });
    const { report, failed } = await rigModel({ image, out: join(work, "model-unrigged"), apiKey: "k" }, deps);
    expect(failed).toBe(true);
    expect(report.missing[0]).toMatchObject({ role: "model", url: null, reason: "not in the response" });
  });

  test("model: refusals and a missing key stop before the job", async () => {
    const { calls, deps } = fakes(MODEL_RESULT);
    await expect(rigModel({ image, out: join(work, "x"), apiKey: "k", polycount: 5 }, deps)).rejects.toThrow(/--polycount/);
    await expect(rigModel({ image, out: join(work, "x"), apiKey: null }, deps)).rejects.toThrow(/FAL_KEY/);
    await expect(rigModel({ image, apiKey: "k" }, deps)).rejects.toThrow(/--out/);
    expect(calls.jobs).toHaveLength(0);
  });

  test("animate: a local GLB is uploaded, every clip saved", async () => {
    const glb = join(work, "model.glb");
    writeFileSync(glb, "glTF");
    const out = join(work, "anim-ok");
    const { calls, deps } = fakes(ANIMATE_RESULT);
    const { report, failed } = await animateModel({ model: glb, actions: "walk,sword-slash,500", out, apiKey: "k" }, deps);
    expect(failed).toBe(false);
    expect(calls.uploads).toEqual([glb]);
    expect(calls.jobs[0].url).toBe(`https://fal.run/${ANIMATE_ENDPOINT}`);
    expect(calls.jobs[0].body).toEqual({ model_url: "https://v3b.fal.media/files/x/uploaded.glb", animation_action_ids: [30, 219, 500], height_meters: 1.7 });
    expect(report).toMatchObject({
      step: "animate",
      provider: "meshy",
      endpoint: ANIMATE_ENDPOINT,
      files: {
        model: join(out, "model-rigged.glb"),
        animations: [
          { id: "walk", label: "Walk", action: 30, file: join(out, "anim-walk.glb") },
          { id: "sword-slash", label: "Sword slash", action: 219, file: join(out, "anim-sword-slash.glb") },
          { id: "action-500", label: "Action 500", action: 500, file: join(out, "anim-action-500.glb") },
        ],
      },
      remote: { model_url: "https://v3b.fal.media/files/x/uploaded.glb", rig_task_id: "rig-task-456" },
      missing: [],
      cost: { usd: 0.08, estimate: true },
    });
  });

  test("animate: a URL is reused as is; a clip the response lacks fails the run", async () => {
    const url = "https://v3b.fal.media/files/x/Character_output.glb";
    const { calls, deps } = fakes(ANIMATE_RESULT);
    const { report, failed } = await animateModel({ model: url, actions: "walk,hit", out: join(work, "anim-partial"), apiKey: "k" }, deps);
    expect(calls.uploads).toHaveLength(0);
    expect(calls.jobs[0].body.model_url).toBe(url);
    expect(failed).toBe(true);
    expect(report.files.animations.map((a) => a.id)).toEqual(["walk"]);
    expect(report.missing).toEqual([{ role: "animation", id: "hit", file: join(work, "anim-partial", "anim-hit.glb"), url: null, reason: "not in the response" }]);
  });

  test("animate: refusals happen before upload and before the job", async () => {
    const { calls, deps } = fakes(ANIMATE_RESULT);
    const base = { model: "https://v3b.fal.media/files/x/m.glb", out: join(work, "x"), apiKey: "k" };
    await expect(animateModel({ ...base, actions: "walk,wave" }, deps)).rejects.toThrow(/unknown action: wave/);
    await expect(animateModel({ ...base, actions: ACTIONS.slice(0, 11).map((a) => a.id).join(",") }, deps)).rejects.toThrow(/at most 10/);
    await expect(animateModel({ ...base, model: join(work, "hero.png"), actions: "walk" }, deps)).rejects.toThrow(/\.glb/);
    await expect(animateModel({ ...base, model: join(work, "absent.glb"), actions: "walk" }, deps)).rejects.toThrow(/not found/);
    await expect(animateModel({ ...base, actions: "walk", height: -1 }, deps)).rejects.toThrow(/--height/);
    expect(calls.uploads).toHaveLength(0);
    expect(calls.jobs).toHaveLength(0);
  });
});

describe("CLI", () => {
  function run(...argv: string[]) {
    const r = Bun.spawnSync(["node", SCRIPT, ...argv], { cwd: work, stdout: "pipe", stderr: "pipe", env: { ...process.env, FAL_KEY: "" } });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  test("actions --json prints the catalog as one object, offline", () => {
    const r = run("actions", "--json");
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out);
    expect(parsed.actions).toEqual(JSON.parse(JSON.stringify(ACTIONS)));
    expect(parsed.max_per_call).toBe(10);
  });

  test("actions without --json is one line per action", () => {
    const r = run("actions");
    expect(r.code).toBe(0);
    expect(r.out.trim().split("\n")).toHaveLength(ACTIONS.length);
    expect(r.out).toMatch(/^sword-slash\s+219\s+Sword slash \(Right_Hand_Sword_Slash\)$/m);
  });

  test("help and unknown commands", () => {
    expect(run("--help")).toMatchObject({ code: 0, err: expect.stringContaining("rig-3d.mjs animate") });
    expect(run()).toMatchObject({ code: 1 });
    expect(run("texture")).toMatchObject({ code: 1, err: expect.stringContaining("unknown command: texture") });
  });

  test.each([
    [["model", "--out", "o"], /--image is required/],
    [["model", "--image", "https://example.com/a.png"], /--out is required/],
    [["model", "--image", "https://example.com/a.png", "--out", "o", "--pose", "sitting"], /--pose/],
    [["model", "--image", "https://example.com/a.png", "--out", "o", "--model-type", "huge"], /--model-type/],
    [["model", "--image", "https://example.com/a.png", "--out", "o", "--actions", "walk"], /model does not take --actions/],
    [["model", "--image", "https://example.com/a.png", "--out", "o", "--deadline-s", "5"], /--deadline-s/],
    [["animate", "--model", "https://example.com/m.glb", "--out", "o"], /at least one action/],
    [["animate", "--model", "https://example.com/m.glb", "--out", "o", "--actions", "walk,moonwalk"], /unknown action: moonwalk/],
    [["animate", "--model", "https://example.com/m.glb", "--out", "o", "--actions", ACTIONS.slice(0, 11).map((a) => a.id).join(",")], /at most 10/],
    [["animate", "--actions", "walk", "--out", "o"], /--model is required/],
    [["animate", "--model", "https://example.com/m.glb", "--actions", "walk", "--out", "o", "--pose", "t-pose"], /animate does not take --pose/],
    [["animate", "--model", "https://example.com/m.glb", "--actions", "walk", "--out", "o", "--bogus"], /Unknown option '--bogus'/],
  ])("refuses %j before reading the key", (argv, message) => {
    const r = run(...(argv as string[]));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(message as RegExp);
    expect(r.err).not.toMatch(/FAL_KEY/);
    expect(r.out).toBe("");
  });
});
