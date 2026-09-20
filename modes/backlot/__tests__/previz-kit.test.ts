/**
 * `previz_kit.py` — the greybox grammar, pinned by running the real Blender.
 *
 * The kit is Python that only exists inside Blender, so there is no unit to
 * test: every claim here is made by launching `blender --background` exactly
 * the way `previz.mjs render` launches it (`--factory-startup`, the kit on
 * `sys.path` through `--python-expr`, the runner's `--key value` pairs after
 * a literal `--`) and reading what came out — the exported GLB, the sidecar,
 * or the rendered pixels. That is live tier: it spawns a real binary, and it
 * is skipped unless `PNEUMA_TEST_LIVE=1` (`bun run test:all`).
 *
 * Three things are worth knowing about the shape of this file:
 *
 * 1. **One Blender per group, not one per assertion.** A refusal ends the
 *    process (`die()` is `sys.exit(1)`, because Blender can exit 0 after an
 *    uncaught exception), so the refusal fixture catches `SystemExit` itself
 *    and reports every case from ONE run as JSON on stdout. Fifteen refusals
 *    cost one process instead of fifteen.
 * 2. **The fixtures are written here, into a temp dir**, rather than living
 *    in the shipped skill directory — a scene that only a test renders is not
 *    something an agent should find next to the worked examples.
 * 3. **The examples are rendered through the real CLI**, not through a
 *    re-implementation of its argv, because "these run end to end" is the
 *    claim being made.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceLiveTierSkip, LIVE_TIER, LIVE_TIER_LABEL } from "../../../core/__tests__/test-tier.js";

const SCRIPTS = join(import.meta.dir, "..", "skill", "scripts");
const PREVIZ = join(SCRIPTS, "previz.mjs");
const BACKLOT = join(SCRIPTS, "backlot.mjs");
const KIT_DIR = join(SCRIPTS, "blender");
const KIT_FILE = join(KIT_DIR, "previz_kit.py");
const EXAMPLES = join(SCRIPTS, "scene-starter", "examples");

/** A Blender run is seconds, not milliseconds. */
const SLOW = 300_000;

announceLiveTierSkip(
  "every real Blender run behind previz_kit's orbit/zoom/dolly_zoom/dash, its slowmo/impact tempo and the duel examples",
);

// ---------------------------------------------------------------------------
// Finding Blender the way the CLI does
// ---------------------------------------------------------------------------

/** Probe ONCE, and only when the live tier was asked for: a module-level
 *  probe runs during collection, before any `skipIf` is consulted. */
const BLENDER: string | null = (() => {
  if (!LIVE_TIER) return null;
  const probe = Bun.spawnSync([process.execPath, PREVIZ, "doctor"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const payload = JSON.parse(probe.stdout.toString());
    return payload.blender?.found ? (payload.blender.path as string) : null;
  } catch {
    return null;
  }
})();

if (LIVE_TIER && !BLENDER) {
  console.warn("(skip) modes/backlot previz_kit live suite — no Blender binary on this machine");
}

const HAS_BLENDER = BLENDER !== null;

const workspaces: string[] = [];

function fresh(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "previz-kit-")));
  workspaces.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  code: number | null;
  out: string;
  err: string;
}

/** One scene script under headless Blender — the same argv `previz.mjs
 *  render` builds, including `dont_write_bytecode`. */
function runScene(script: string, args: string[] = []): Run {
  const setup = `import sys; sys.dont_write_bytecode = True; sys.path.insert(0, ${JSON.stringify(KIT_DIR)})`;
  const result = Bun.spawnSync(
    [BLENDER as string, "--background", "--factory-startup", "--python-expr", setup, "--python", script, "--", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/** A `[test] <label> {...}` line the fixture printed. */
function payload(run: Run, label: string): any {
  const marker = `[test] ${label} `;
  const line = run.out.split("\n").filter((entry) => entry.includes(marker)).pop();
  if (!line) throw new Error(`no "${marker}" line in the Blender log.\nstdout:\n${run.out}\nstderr:\n${run.err}`);
  return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
}

function writeFixture(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

// ---------------------------------------------------------------------------
// Reading a GLB
// ---------------------------------------------------------------------------

interface Glb {
  json: any;
  bytes: Buffer;
  binOffset: number;
}

function readGlb(path: string): Glb {
  const bytes = readFileSync(path);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf-8"));
  return { json, bytes, binOffset: 20 + jsonLength + 8 };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Float accessor data. Every accessor the exporter writes for sampled
 *  animation is float32, which is the only case this needs to read. */
function accessor(glb: Glb, index: number): number[][] {
  const acc = glb.json.accessors[index];
  if (acc.componentType !== 5126) throw new Error(`accessor ${index} is not float32`);
  const view = glb.json.bufferViews[acc.bufferView];
  const start = glb.binOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const width = COMPONENTS[acc.type];
  const rows: number[][] = [];
  for (let element = 0; element < acc.count; element += 1) {
    const row: number[] = [];
    for (let component = 0; component < width; component += 1) {
      row.push(glb.bytes.readFloatLE(start + (element * width + component) * 4));
    }
    rows.push(row);
  }
  return rows;
}

/** The sampled values of one channel of one animation, in frame order. */
function channel(glb: Glb, animationName: string, path: string): { times: number[]; values: number[][] } {
  const animation = (glb.json.animations ?? []).find((entry: any) => entry.name === animationName);
  if (!animation) throw new Error(`no animation named ${animationName} (have: ${(glb.json.animations ?? []).map((a: any) => a.name).join(", ")})`);
  const found = animation.channels.find((entry: any) => entry.target?.path === path);
  if (!found) throw new Error(`animation ${animationName} has no ${path} channel`);
  const sampler = animation.samplers[found.sampler];
  return {
    times: accessor(glb, sampler.input).map((row) => row[0]),
    values: accessor(glb, sampler.output),
  };
}

/** glTF is Y-up and Blender is Z-up: (x, y, z)_blender -> (x, z, -y)_gltf. */
function toBlender(point: number[]): [number, number, number] {
  return [point[0], -point[2], point[1]];
}

// ---------------------------------------------------------------------------
// The API the kit advertises
// ---------------------------------------------------------------------------

/**
 * Every public function `previz_kit` defines. Written out here rather than
 * derived from the module, which is the whole point: a list read back out of
 * the same file would pass for an empty kit, and a new public function has to
 * be a decision somebody took twice — once in the code, once here.
 */
const KIT_API = [
  "F", "T", "accent", "accent_material", "action_time", "box", "camera", "camera_move", "cylinder",
  "dash", "die", "dolly_zoom", "figure", "finish", "hinge", "hold", "impact", "log", "material",
  "move", "orbit", "plane", "pose_at", "room", "runner_args", "set_interpolation", "setup", "shot",
  "shot_time", "slowmo", "sphere", "swing", "travel", "turn", "zoom",
];

/**
 * Not live tier: reading two files costs nothing and needs no binary, and the
 * routine suite is exactly where an undocumented function should be caught —
 * the module docstring's vocabulary list is what an agent reads before it
 * writes a scene.
 */
describe("previz_kit's module docstring is its API index", () => {
  const source = readFileSync(KIT_FILE, "utf-8");
  const vocabulary = source.slice(source.indexOf("## The vocabulary"), source.indexOf("## Axes"));

  test("the vocabulary section names every public function", () => {
    expect(vocabulary.length).toBeGreaterThan(200);
    for (const name of KIT_API) {
      expect(vocabulary).toContain(name);
    }
  });

  test("each new camera and burst move is documented with its signature", () => {
    for (const signature of [
      "orbit(cam, center, radius, height, deg_from, deg_to, start, end, look_at",
      "zoom(cam, mm_from, mm_to, start, end, ease)",
      "dolly_zoom(cam, subject, dist_from, dist_to, start, end, ease)",
      "dash(fig, path, start, end, pace=\"leap\", settle, ramp, arc=None)",
      "slowmo(start, end, factor)",
      "impact(cam, at, push=0.15, shake=0.02, seconds=0.25)",
      "shot_time(action_time)",
      "action_time(shot_time)",
    ]) {
      expect(vocabulary).toContain(signature);
    }
  });

  test("the measured glTF note explains why focal length travels in the sidecar", () => {
    expect(source).toContain("camera_lens: [{frame, mm}]");
    expect(source).toContain("KHR_animation_pointer");
  });

  /**
   * The remap splits one clock into two, and an author who does not know
   * which one a number is in will write a beats table that disagrees with the
   * clip. The rule has to be findable in the file the agent reads, not only
   * in this test.
   */
  test("the two clocks, and which one beats are written in, are explained", () => {
    const clocks = source.slice(source.indexOf("## Two clocks"), source.indexOf("## What the greybox states"));
    expect(clocks.length).toBeGreaterThan(400);
    expect(clocks).toContain("**Beats are shot seconds.**");
    expect(clocks).toContain("t_action = W(t_shot)");
    expect(clocks).toContain("time_warp: [{from, to, factor}]");
    // The cost of a ramp — the one thing that surprises an author.
    expect(clocks).toContain("L * (1 - 1/f)");
  });
});

// ---------------------------------------------------------------------------
// Refusals — one Blender for all of them
// ---------------------------------------------------------------------------

const REFUSAL_FIXTURE = `"""Every refusal the new moves owe, in one process.

\`die()\` is \`sys.exit(1)\`, so each case is run inside a SystemExit guard with
stderr captured; the scene is rebuilt from scratch for every case.
"""

import contextlib
import io
import json

import previz_kit as pv

CASES = []


def case(name):
    def register(fn):
        CASES.append((name, fn))
        return fn
    return register


def scene(seconds=4.0):
    pv.setup(seconds=seconds, fps=24, width=320, height=180)
    pv.plane("floor", (24, 24), (0, 0, 0), pv.GREY)
    fig = pv.figure("root", location=(0.0, 0.0))
    cam = pv.camera(35, location=(0.0, -6.0, 1.6), look_at=(0.0, 0.0, 1.2))
    return fig, cam


@case("orbit-radius")
def _orbit_radius():
    _fig, cam = scene()
    pv.orbit(cam, (0, 0), 0.05, 2.0, 0, 180, 0.0, 3.0)


@case("orbit-no-sweep")
def _orbit_no_sweep():
    _fig, cam = scene()
    pv.orbit(cam, (0, 0), 6.0, 2.0, 45, 45, 0.0, 3.0)


@case("orbit-past-the-shot")
def _orbit_past():
    _fig, cam = scene()
    pv.orbit(cam, (0, 0), 6.0, 2.0, 0, 180, 0.0, 9.0)


@case("orbit-backwards-window")
def _orbit_backwards():
    _fig, cam = scene()
    pv.orbit(cam, (0, 0), 6.0, 2.0, 0, 180, 3.0, 1.0)


@case("orbit-not-a-camera")
def _orbit_not_a_camera():
    _fig, cam = scene()
    pv.orbit(cam["object"], (0, 0), 6.0, 2.0, 0, 180, 0.0, 3.0)


@case("orbit-would-cut")
def _orbit_would_cut():
    _fig, cam = scene()
    pv.camera_move(cam, [(0.0, (0.0, -6.0, 1.6), (0, 0, 1.2)), (1.5, (2.0, -5.0, 1.8), (0, 0, 1.2))], settle=0.3)
    pv.orbit(cam, (0, 0), 6.0, 2.0, 0, 180, 2.0, 3.5)


@case("zoom-impossible-lens")
def _zoom_lens():
    _fig, cam = scene()
    pv.zoom(cam, 35, 900, 0.5, 2.0)


@case("zoom-same-lens")
def _zoom_same():
    _fig, cam = scene()
    pv.zoom(cam, 35, 35, 0.5, 2.0)


@case("zoom-would-cut")
def _zoom_would_cut():
    _fig, cam = scene()
    pv.zoom(cam, 35, 20, 0.0, 1.0)
    pv.zoom(cam, 50, 30, 1.5, 3.0)


@case("dolly-too-close")
def _dolly_close():
    _fig, cam = scene()
    pv.dolly_zoom(cam, (0, 0, 1.2), 4.0, 0.2, 0.5, 2.0)


@case("dolly-no-travel")
def _dolly_no_travel():
    _fig, cam = scene()
    pv.dolly_zoom(cam, (0, 0, 1.2), 4.0, 4.0, 0.5, 2.0)


@case("dolly-lens-out-of-range")
def _dolly_lens():
    _fig, cam = scene()
    pv.dolly_zoom(cam, (0, 0, 1.2), 60.0, 0.5, 0.5, 2.0)


@case("dolly-would-cut")
def _dolly_would_cut():
    _fig, cam = scene()
    pv.camera_move(cam, [(0.0, (0.0, -6.0, 1.6), (0, 0, 1.2)), (1.5, (0.0, -5.0, 1.6), (0, 0, 1.2))], settle=0.3)
    pv.dolly_zoom(cam, (0, 0, 1.2), 9.0, 3.0, 2.0, 3.5)


@case("dash-too-slow-for-a-leap")
def _dash_slow():
    fig, _cam = scene()
    pv.dash(fig, [(0.0, 0.0), (1.0, 0.0)], start=0.2, end=1.4)


@case("dash-too-fast-for-a-burst")
def _dash_fast():
    fig, _cam = scene()
    pv.dash(fig, [(0.0, 0.0), (9.0, 0.0)], start=0.2, end=1.2, pace="burst")


@case("dash-rejects-a-walk")
def _dash_walk():
    fig, _cam = scene()
    pv.dash(fig, [(0.0, 0.0), (1.2, 0.0)], start=0.2, end=1.4, pace="walk")


@case("travel-still-rejects-a-leap")
def _travel_leap():
    fig, _cam = scene()
    pv.travel(fig, [(0.0, 0.0), (1.2, 0.0)], start=0.2, end=1.4, pace="leap")


@case("travel-walk-speeds-unchanged")
def _travel_fast_walk():
    fig, _cam = scene()
    pv.travel(fig, [(0.0, 0.0), (6.0, 0.0)], start=0.2, end=2.2)


@case("dash-arc-too-tall")
def _dash_arc():
    fig, _cam = scene()
    pv.dash(fig, [(0.0, 0.0), (5.0, 0.0)], start=0.2, end=1.2, arc=4.5)


@case("dash-leap-is-accepted")
def _dash_ok():
    fig, _cam = scene()
    pv.dash(fig, [(0.0, 0.0), (5.0, 0.0)], start=0.2, end=1.2, arc=1.2)


@case("orbit-is-accepted")
def _orbit_ok():
    _fig, cam = scene()
    pv.orbit(cam, (0, 0), 6.0, 2.0, -90, 90, 0.0, 3.0)


@case("slowmo-overlap")
def _slowmo_overlap():
    scene()
    pv.slowmo(0.5, 1.5, 2.0)
    pv.slowmo(1.2, 2.0, 2.0)


@case("slowmo-factor-too-fast")
def _slowmo_too_fast():
    scene()
    pv.slowmo(0.5, 1.5, 0.1)


@case("slowmo-factor-too-slow")
def _slowmo_too_slow():
    scene()
    pv.slowmo(0.5, 1.5, 20.0)


@case("slowmo-factor-of-one")
def _slowmo_one():
    scene()
    pv.slowmo(0.5, 1.5, 1.0)


@case("slowmo-past-the-shot")
def _slowmo_past():
    scene()
    pv.slowmo(3.0, 5.0, 2.0)


@case("slowmo-before-the-shot")
def _slowmo_before():
    scene()
    pv.slowmo(-0.5, 1.0, 2.0)


@case("slowmo-backwards-window")
def _slowmo_backwards():
    scene()
    pv.slowmo(2.0, 1.0, 2.0)


@case("slowmo-end-to-end-is-accepted")
def _slowmo_ok():
    scene()
    pv.slowmo(0.5, 1.5, 2.0)
    pv.slowmo(1.5, 2.5, 0.5)


@case("impact-rings-down-past-the-end")
def _impact_past():
    _fig, cam = scene()
    pv.impact(cam, 3.9)


@case("impact-longer-than-a-hit")
def _impact_long():
    _fig, cam = scene()
    pv.impact(cam, 1.0, seconds=3.0)


@case("impact-does-nothing")
def _impact_nothing():
    _fig, cam = scene()
    pv.impact(cam, 1.0, push=0.0, shake=0.0)


@case("impact-thrown-camera")
def _impact_thrown():
    _fig, cam = scene()
    pv.impact(cam, 1.0, push=4.0)


@case("impact-not-a-camera")
def _impact_not_a_camera():
    _fig, cam = scene()
    pv.impact(cam["object"], 1.0)


@case("impact-is-accepted")
def _impact_ok():
    _fig, cam = scene()
    pv.impact(cam, 1.0)


results = []
for name, fn in CASES:
    captured = io.StringIO()
    try:
        with contextlib.redirect_stderr(captured):
            fn()
    except SystemExit as stop:
        results.append({"case": name, "died": True, "code": int(stop.code or 0), "message": captured.getvalue().strip()})
        continue
    results.append({"case": name, "died": False, "code": 0, "message": captured.getvalue().strip()})

api = sorted(
    name for name in dir(pv)
    if not name.startswith("_") and callable(getattr(pv, name))
    and getattr(getattr(pv, name), "__module__", None) == "previz_kit"
)
print("[test] api " + json.dumps(api))
print("[test] refusals " + json.dumps(results))

# The two clocks, sampled. A slowmo and a matching speed-up laid end to end:
# the second gives back exactly what the first took, so the clip ends on the
# action's own clock again. Costs nothing but one setup in a process that is
# already running.
pv.setup(seconds=6.0, fps=24, width=320, height=180)
pv.slowmo(1.0, 2.0, 2.0)
pv.slowmo(3.0, 3.5, 0.5)
SAMPLES = [0.0, 0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.25, 3.5, 4.0, 6.0]
print("[test] clocks " + json.dumps({
    "action_of_shot": [[t, pv.action_time(t)] for t in SAMPLES],
    "shot_of_action": [[t, pv.shot_time(t)] for t in SAMPLES],
    "round_trip": [pv.action_time(pv.shot_time(t)) for t in SAMPLES],
}))
`;

interface Clocks {
  action_of_shot: [number, number][];
  shot_of_action: [number, number][];
  round_trip: number[];
}

let refusalRun: {
  cases: Record<string, { died: boolean; message: string }>;
  api: string[];
  clocks: Clocks;
} | null = null;

function refusals() {
  if (refusalRun) return refusalRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "refusals.py", REFUSAL_FIXTURE));
  if (run.code !== 0) throw new Error(`the refusal fixture did not finish (exit ${run.code}):\n${run.err}`);
  const rows = payload(run, "refusals") as { case: string; died: boolean; message: string }[];
  const cases: Record<string, { died: boolean; message: string }> = {};
  for (const row of rows) cases[row.case] = { died: row.died, message: row.message };
  refusalRun = { cases, api: payload(run, "api") as string[], clocks: payload(run, "clocks") as Clocks };
  return refusalRun;
}

// ---------------------------------------------------------------------------
// The time map, written out independently of the kit
// ---------------------------------------------------------------------------

interface Warp {
  from: number;
  to: number;
  factor: number;
}

/**
 * `W(t)` and its inverse, implemented here from the SPECIFICATION — slope 1
 * outside the segments, 1/factor inside, continuous at the joins — rather
 * than read back out of the kit. That is what lets these tests assert a whole
 * baked curve instead of five numbers somebody once observed: if the kit's
 * map and this one disagree anywhere, the disagreement is the failure.
 */
function actionTime(warps: Warp[], shotSeconds: number): number {
  let out = shotSeconds;
  for (const segment of warps) {
    if (shotSeconds <= segment.from) break;
    out -= (Math.min(shotSeconds, segment.to) - segment.from) * (1 - 1 / segment.factor);
  }
  return out;
}

function shotTime(warps: Warp[], actionSeconds: number): number {
  let lag = 0;
  for (const segment of warps) {
    const opens = segment.from - lag;
    if (actionSeconds <= opens) break;
    const length = segment.to - segment.from;
    const closes = opens + length / segment.factor;
    if (actionSeconds <= closes) return segment.from + (actionSeconds - opens) * segment.factor;
    lag += length * (1 - 1 / segment.factor);
  }
  return actionSeconds + lag;
}

/** The kit's `F()`: a shot second to its 1-based frame. */
function frameOf(seconds: number, fps = 24): number {
  return 1 + Math.round(seconds * fps);
}

/** Assert one refusal happened and said the words that name the fix. */
function refused(name: string, ...phrases: string[]) {
  const result = refusals().cases[name];
  expect(result, `no case named ${name}`).toBeDefined();
  expect(result.died, `${name} was accepted; it should have been refused`).toBe(true);
  for (const phrase of phrases) expect(result.message).toContain(phrase);
  expect(result.message.startsWith("ERROR: ")).toBe(true);
}

describe(`previz_kit — refusals that name the fix ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("every function the kit's vocabulary advertises exists", () => {
    expect(refusals().api).toEqual(KIT_API);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("orbit refuses a radius, a sweep or a window that is not one", () => {
    refused("orbit-radius", "orbit: radius", "is not an orbit");
    refused("orbit-no-sweep", "deg_from and deg_to are both", "still camera");
    refused("orbit-past-the-shot", "is past the shot's 4.0 s", "--seconds");
    refused("orbit-backwards-window", "must be after start");
    refused("orbit-not-a-camera", "the handle previz_kit.camera(...) returned");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("a camera move that would cut is refused, not rendered", () => {
    refused("orbit-would-cut", "the shot would cut there", "Start the orbit at the angle and radius");
    refused("zoom-would-cut", "focal length", "the shot would cut there");
    refused("dolly-would-cut", "m from the subject", "Match dist_from to where the camera already is");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("zoom refuses a focal length no lens has", () => {
    refused("zoom-impossible-lens", "mm_to is 900.0 mm", "4-400 mm");
    refused("zoom-same-lens", "a zoom needs two focal lengths");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("dolly_zoom guards the distance and the lens it computes", () => {
    refused("dolly-too-close", "dist_to is 0.20 m", "inside the body it is filming");
    refused("dolly-no-travel", "the camera never moves", "pv.zoom");
    refused("dolly-lens-out-of-range", "takes the 35 mm lens to", "dolly a smaller ratio");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("dash checks burst speeds against its OWN table", () => {
    refused("dash-too-slow-for-a-leap", "a leap is 4.0-12.0 m/s");
    refused("dash-too-fast-for-a-burst", "a burst is 2.5-6.0 m/s");
    refused("dash-rejects-a-walk", 'pace must be "burst" or "leap"');
    refused("dash-arc-too-tall", "arc=4.5 m must be a rise between 0 and 3.0 m");
    expect(refusals().cases["dash-leap-is-accepted"].died).toBe(false);
    expect(refusals().cases["orbit-is-accepted"].died).toBe(false);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("travel's walking speeds are not loosened by dash existing", () => {
    // The brief's rule, made a test: a burst gets its own verb, and `travel`
    // still refuses both the pace name and the speed.
    refused("travel-still-rejects-a-leap", 'pace must be "run" or "walk"');
    refused("travel-walk-speeds-unchanged", "a walk is 0.7-1.9 m/s");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("slowmo refuses a window the clip does not have", () => {
    refused("slowmo-past-the-shot", "is past the shot's 4.0 s", "stated in SHOT seconds");
    refused("slowmo-before-the-shot", "before the clip's first frame", "stated in SHOT seconds");
    refused("slowmo-backwards-window", "must be after start");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("two ramps over the same second have no single answer, so they are refused", () => {
    refused("slowmo-overlap", "overlaps the segment already registered at 0.50-1.50 s",
      "ONE time curve", "Lay them end to end");
    // Touching is not overlapping: a ramp straight into a speed-up is the
    // ordinary way to get the action's clock back.
    expect(refusals().cases["slowmo-end-to-end-is-accepted"].died).toBe(false);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("slowmo refuses a factor that is not a speed ramp", () => {
    refused("slowmo-factor-too-fast", "factor 0.1 is outside 0.25-8.0");
    refused("slowmo-factor-too-slow", "factor 20.0 is outside 0.25-8.0");
    refused("slowmo-factor-of-one", "a factor of 1 is no remap at all");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("impact refuses a hit the clip cannot recover from, or is not one", () => {
    refused("impact-rings-down-past-the-end", "rings down until 4.15 s, past the shot's 4.0 s",
      "still off its path", "end-hold");
    refused("impact-longer-than-a-hit", "seconds=3.0 is outside 0.08-2.0 s", "pv.camera_move");
    refused("impact-does-nothing", "push and shake are both 0");
    refused("impact-thrown-camera", "push=4.0 m is outside 0-1.5 m", "thrown, not hit");
    refused("impact-not-a-camera", "the handle previz_kit.camera(...) returned");
    expect(refusals().cases["impact-is-accepted"].died).toBe(false);
  }, SLOW);
});

describe(`previz_kit — the two clocks a slowmo splits apart ${LIVE_TIER_LABEL}`, () => {
  // 1.0-2.0 s at half speed, then 3.0-3.5 s at double speed: the second
  // segment gives back exactly the 0.5 s the first one took.
  const SEGMENTS: Warp[] = [
    { from: 1.0, to: 2.0, factor: 2.0 },
    { from: 3.0, to: 3.5, factor: 0.5 },
  ];

  test.skipIf(!HAS_BLENDER)("action_time is the piecewise map, and shot_time is its inverse", () => {
    const { action_of_shot, shot_of_action, round_trip } = refusals().clocks;
    for (const [t, answered] of action_of_shot) {
      expect(answered).toBeCloseTo(actionTime(SEGMENTS, t), 9);
    }
    for (const [t, answered] of shot_of_action) {
      expect(answered).toBeCloseTo(shotTime(SEGMENTS, t), 9);
    }
    for (const [index, answered] of round_trip.entries()) {
      expect(answered).toBeCloseTo(action_of_shot[index][0], 9);
    }
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("a ramp costs the action exactly what it gives the clip", () => {
    const answers = new Map(refusals().clocks.action_of_shot);
    // Inside the ramp the action runs at half rate...
    expect(answers.get(1.0)).toBeCloseTo(1.0, 9);
    expect(answers.get(1.5)).toBeCloseTo(1.25, 9);
    expect(answers.get(2.0)).toBeCloseTo(1.5, 9);
    // ...and stays half a second behind the clip afterwards.
    expect(answers.get(2.5)).toBeCloseTo(2.0, 9);
    expect(answers.get(3.0)).toBeCloseTo(2.5, 9);
    // The speed-up hands the half second back, so the clip ends on the
    // action's own clock: six seconds of clip, six seconds of action.
    expect(answers.get(3.5)).toBeCloseTo(3.5, 9);
    expect(answers.get(6.0)).toBeCloseTo(6.0, 9);
    // Which is the number an author needs the other way round: the ramp ends
    // on 1.5 s of action, so a beat written at 1.5 s is seen at 2.0 s of clip
    // and one written at 2.0 s is seen at 2.5 s — half a second later, the
    // whole cost of the ramp, and not a second later.
    const clip = new Map(refusals().clocks.shot_of_action);
    expect(clip.get(1.5)).toBeCloseTo(2.0, 9);
    expect(clip.get(2.0)).toBeCloseTo(2.5, 9);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// orbit and dash, measured in the exported GLB
// ---------------------------------------------------------------------------

const EXPORT_FIXTURE = `"""A 540 deg orbit and a leap, exported without rendering."""

import previz_kit as pv

CENTER = (0.7, 0.4)
RADIUS, HEIGHT = 7.0, 2.1

pv.setup(seconds=4, fps=24, width=320, height=180)
pv.plane("floor", (26, 26), (0, 0, 0), pv.GREY)
leaper = pv.figure("leaper", location=(-4.0, -1.0))
pv.dash(leaper, [(-4.0, -1.0), (0.2, 0.2)], start=0.2, end=1.3, arc=1.1)
pv.hold(leaper, 1.3, 4.0)
cam = pv.camera(35, location=(CENTER[0] + RADIUS, CENTER[1], HEIGHT), look_at=(CENTER[0], CENTER[1], 1.25))
pv.orbit(cam, CENTER, RADIUS, HEIGHT, 0, 540, 0.0, 3.5)
pv.finish(render=False)
`;

interface Exported {
  glb: Glb;
  meta: any;
}

let exportRun: Exported | null = null;

function exported(): Exported {
  if (exportRun) return exportRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "export.py", EXPORT_FIXTURE), [
    "--glb", join(dir, "scene.glb"),
    "--meta", join(dir, "scene.meta.json"),
    "--out", join(dir, "frames"),
  ]);
  if (run.code !== 0) throw new Error(`the export fixture did not finish (exit ${run.code}):\n${run.err}`);
  exportRun = {
    glb: readGlb(join(dir, "scene.glb")),
    meta: JSON.parse(readFileSync(join(dir, "scene.meta.json"), "utf-8")),
  };
  return exportRun;
}

describe(`previz_kit orbit — the arc survives the glTF export ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("the camera is on the circle at every sampled frame, to the centimetre", () => {
    const { values, times } = channel(exported().glb, "cam", "translation");
    // SCENE mode + force sampling: one key per frame, glTF time = frame / fps.
    expect(values).toHaveLength(96);
    expect(times[0]).toBeCloseTo(1 / 24, 5);
    expect(times[times.length - 1]).toBeCloseTo(4, 5);

    const radii = values.map((point) => {
      const [x, y] = toBlender(point);
      return Math.hypot(x - 0.7, y - 0.4);
    });
    // The five the task asks for, and then the whole curve, because a
    // sampled arc that is right on five frames and wrong on a sixth is a
    // camera that leaves the circle where nobody looked.
    for (const frame of [1, 24, 48, 72, 96]) {
      expect(Math.abs(radii[frame - 1] - 7.0)).toBeLessThan(0.01);
    }
    expect(Math.max(...radii.map((radius) => Math.abs(radius - 7.0)))).toBeLessThan(0.01);
    const heights = values.map((point) => toBlender(point)[2]);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.001);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("a sweep of one and a half turns really goes round one and a half times", () => {
    const { values } = channel(exported().glb, "cam", "translation");
    let previous = Math.atan2(toBlender(values[0])[1] - 0.4, toBlender(values[0])[0] - 0.7);
    let swept = 0;
    for (const point of values.slice(1)) {
      const [x, y] = toBlender(point);
      const angle = Math.atan2(y - 0.4, x - 0.7);
      let step = angle - previous;
      while (step > Math.PI) step -= 2 * Math.PI;
      while (step < -Math.PI) step += 2 * Math.PI;
      swept += step;
      previous = angle;
    }
    expect((swept * 180) / Math.PI).toBeCloseTo(540, 1);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the camera arrives before the shot ends and holds", () => {
    const { values } = channel(exported().glb, "cam", "translation");
    // The orbit ends at 3.5 s of a 4 s shot: frames 85..96 are the same
    // station, which is what `end-hold` is about.
    const tail = values.slice(84).map(toBlender);
    for (const station of tail) {
      expect(Math.hypot(station[0] - tail[0][0], station[1] - tail[0][1])).toBeLessThan(0.001);
    }
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("dash's arc lifts the pawn off the floor and puts it back", () => {
    const { values } = channel(exported().glb, "leaper", "translation");
    const heights = values.map((point) => toBlender(point)[2]);
    // The leap runs 0.2-1.3 s: frames 6..32 of 96.
    expect(heights[0]).toBeCloseTo(0, 4);
    expect(Math.max(...heights)).toBeGreaterThan(1.05);
    expect(Math.max(...heights)).toBeLessThanOrEqual(1.1 + 1e-4);
    expect(heights[heights.length - 1]).toBeCloseTo(0, 4);
    // It is back on the floor from the landing frame onward, not drifting.
    for (const height of heights.slice(32)) expect(height).toBeCloseTo(0, 4);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("a shot with no zoom records an empty focal curve", () => {
    expect(exported().meta.camera_lens).toEqual([]);
    expect(exported().meta.subjects).toEqual(["leaper"]);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// zoom — what glTF does, and does not, carry
// ---------------------------------------------------------------------------

const ZOOM_FIXTURE = `"""An animated lens on a moving camera, exported."""

import previz_kit as pv

pv.setup(seconds=2, fps=24, width=320, height=180)
pv.plane("floor", (20, 20), (0, 0, 0), pv.GREY)
pv.box("pillar", (0.5, 0.5, 3.0), (2.0, 3.0, 1.5), pv.WHITE)
cam = pv.camera(35, location=(0.0, -6.0, 1.6), look_at=(0.0, 0.0, 1.2))
pv.camera_move(cam, [(0.0, (0.0, -6.0, 1.6), (0, 0, 1.2)), (1.5, (1.2, -5.4, 1.75), (0, 0, 1.2))], settle=0.3)
pv.zoom(cam, 35, 14, 0.5, 1.5)
pv.finish(render=False)
`;

let zoomRun: Exported | null = null;

function zoomed(): Exported {
  if (zoomRun) return zoomRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "zoom.py", ZOOM_FIXTURE), [
    "--glb", join(dir, "scene.glb"),
    "--meta", join(dir, "scene.meta.json"),
    "--out", join(dir, "frames"),
  ]);
  if (run.code !== 0) throw new Error(`the zoom fixture did not finish (exit ${run.code}):\n${run.err}`);
  zoomRun = {
    glb: readGlb(join(dir, "scene.glb")),
    meta: JSON.parse(readFileSync(join(dir, "scene.meta.json"), "utf-8")),
  };
  return zoomRun;
}

describe(`previz_kit zoom — glTF carries no focal length ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("the exported camera animation has transform channels and nothing else", () => {
    const { json } = zoomed().glb;
    const animations = (json.animations ?? []).filter((entry: any) => entry.name === "cam");
    expect(animations).toHaveLength(1);
    expect(animations[0].channels.map((entry: any) => entry.target.path).sort()).toEqual(["rotation", "translation"]);
    // Blender 5.2.1 CAN write the lens curve as KHR_animation_pointer, but
    // only with export_pointer_animation=True — which the kit does not set,
    // because three.js's GLTFLoader does not read that extension and the
    // second animation it emits carries the camera's name a second time.
    expect(json.extensionsUsed ?? []).not.toContain("KHR_animation_pointer");
    expect(JSON.stringify(json)).not.toContain("yfov\":{");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the static yfov it does carry is the lens on FRAME 1", () => {
    const camera = zoomed().glb.json.cameras[0].perspective;
    const aspect = 320 / 180;
    const frameOne = 2 * Math.atan(Math.tan(Math.atan(18 / 35)) / aspect);
    expect(camera.yfov).toBeCloseTo(frameOne, 4);
    // 14 mm would be a much wider angle: the end of the zoom is simply not in
    // the file, which is the whole reason for the sidecar below.
    const frameEnd = 2 * Math.atan(Math.tan(Math.atan(18 / 14)) / aspect);
    expect(Math.abs(camera.yfov - frameEnd)).toBeGreaterThan(0.4);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("so the curve travels in scene.meta.json as camera_lens", () => {
    const lens = zoomed().meta.camera_lens as { frame: number; mm: number }[];
    // Keyed from frame 1 even though the zoom starts at 0.5 s: the lens is
    // held at 35 mm until the move begins, so the shot cannot pop onto it.
    expect(lens[0]).toEqual({ frame: 1, mm: 35 });
    expect(lens[lens.length - 1]).toEqual({ frame: 37, mm: 14 });
    expect(lens).toHaveLength(37);
    expect(lens.map((entry) => entry.frame)).toEqual(lens.map((_entry, index) => index + 1));
    for (let index = 1; index < lens.length; index += 1) {
      expect(lens[index].mm).toBeLessThanOrEqual(lens[index - 1].mm);
    }
    // The camera the curve belongs to is named in the same file.
    expect(zoomed().meta.camera).toBe("cam");
  }, SLOW);
});

// ---------------------------------------------------------------------------
// dolly_zoom — measured in rendered pixels
// ---------------------------------------------------------------------------

const DOLLY_FIXTURE = `"""A dolly zoom, rendered at 480p on its first and last frame and MEASURED.

The claim is about what the lens does, so the evidence is pixels, not the
matrix that produced them. A dark pawn and a dark pillar on the flat world
background make a silhouette a threshold can find; the pillar sits far behind
the subject and well off to the side, so the two never share a column.
"""

import json
import os

import bpy
import numpy as np
import previz_kit as pv

OUT = pv.runner_args()["out"]
os.makedirs(OUT, exist_ok=True)

pv.setup(seconds=2, fps=24, width=854, height=480)
subject = pv.figure("pawn", height=1.75, location=(0.0, 0.0), material=pv.DARK)
pv.hold(subject, 0.0, 2.0)
pv.box("pillar", (0.8, 0.8, 5.0), (3.4, 9.0, 2.5), pv.DARK)
chest = subject["dims"]["shoulder_z"] * 0.85
cam = pv.camera(35, location=(0.0, -6.0, chest), look_at=(0.0, 0.0, chest))
pv.dolly_zoom(cam, subject, 6.0, 2.4, 0.0, 1.5)
pv.finish(render=False)


def extent(block, axis):
    """(first, last, count) of the rows or columns this block covers."""
    hit = np.any(block, axis=axis)
    found = np.flatnonzero(hit)
    return (int(found[0]), int(found[-1]), int(found[-1] - found[0] + 1)) if found.size else (0, 0, 0)


scene = bpy.context.scene
measured = {}
for label, frame in (("wide", 1), ("close", pv.F(1.5))):
    path = os.path.join(OUT, "%s.png" % label)
    scene.frame_set(frame)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path)
    width, height = image.size
    buffer = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(buffer)
    rgba = buffer.reshape(height, width, 4)
    luma = rgba[:, :, 0] * 0.2126 + rgba[:, :, 1] * 0.7152 + rgba[:, :, 2] * 0.0722
    # The corner is the flat world background; anything that differs from it
    # by more than a rounding error is geometry.
    mask = np.abs(luma - float(luma[2, 2])) > 0.05
    middle = width // 2
    measured[label] = {
        "frame": frame,
        "size": [width, height],
        "subject": extent(mask[:, middle - 60:middle + 60], 1),
        "pillar": extent(mask[:, middle + 70:], 0),
        "bytes": os.path.getsize(path),
    }
    bpy.data.images.remove(image)

print("[test] dolly " + json.dumps(measured))
`;

let dollyRun: { measured: any; meta: any } | null = null;

function dolly() {
  if (dollyRun) return dollyRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "dolly.py", DOLLY_FIXTURE), [
    "--meta", join(dir, "scene.meta.json"),
    "--out", join(dir, "frames"),
  ]);
  if (run.code !== 0) throw new Error(`the dolly fixture did not finish (exit ${run.code}):\n${run.err}`);
  dollyRun = {
    measured: payload(run, "dolly"),
    meta: JSON.parse(readFileSync(join(dir, "scene.meta.json"), "utf-8")),
  };
  return dollyRun;
}

describe(`previz_kit dolly_zoom — the subject holds while the world does not ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("the pawn's silhouette keeps its height within 4 % across the move", () => {
    const { wide, close } = dolly().measured;
    // A headless Blender can write a few-hundred-byte PNG and exit 0, so the
    // measurement is only worth reading if there was a picture.
    expect(wide.bytes).toBeGreaterThan(10 * 1024);
    expect(close.bytes).toBeGreaterThan(10 * 1024);
    expect(wide.size).toEqual([854, 480]);

    const wideHeight = wide.subject[2];
    const closeHeight = close.subject[2];
    expect(wideHeight).toBeGreaterThan(150);
    // Not clipped by the frame: a silhouette that runs off the top or the
    // bottom would "hold" for the wrong reason.
    expect(wide.subject[0]).toBeGreaterThan(0);
    expect(wide.subject[1]).toBeLessThan(479);
    expect(close.subject[0]).toBeGreaterThan(0);
    expect(close.subject[1]).toBeLessThan(479);
    expect(Math.abs(closeHeight - wideHeight) / wideHeight).toBeLessThan(0.04);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the background falls away — which is the whole shot", () => {
    const { wide, close } = dolly().measured;
    const wideWidth = wide.pillar[2];
    const closeWidth = close.pillar[2];
    expect(wideWidth).toBeGreaterThan(20);
    expect(closeWidth).toBeLessThan(wideWidth * 0.75);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the compensation is mm proportional to distance, recorded in the meta", () => {
    const lens = dolly().meta.camera_lens as { frame: number; mm: number }[];
    expect(lens[0]).toEqual({ frame: 1, mm: 35 });
    // 2.4 / 6.0 of the distance, so 2.4 / 6.0 of the focal length.
    expect(lens[lens.length - 1].mm).toBeCloseTo(35 * (2.4 / 6.0), 3);
    expect(lens[lens.length - 1].frame).toBe(37);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// slowmo — measured in the exported GLB and in the sidecar
// ---------------------------------------------------------------------------

const SLOWMO_FIXTURE = `"""Four metres in two seconds, one ramp under the middle of it.

The travel has NO ramp, NO settle and its pace check turned off on purpose:
the claim under test is arithmetic, and a constant 2 m/s makes the remapped
speed readable straight off the GLB instead of through the easing profile.
The zoom and the accent are here because their numbers travel in the sidecar
rather than in the glTF, so the remap has to move them too.
"""

import previz_kit as pv

pv.setup(seconds=4, fps=24, width=320, height=180)
pv.plane("floor", (30, 30), (0, 0, 0), pv.GREY)
crate = pv.box("crate", (0.6, 0.6, 0.6), (3.0, 2.0, 0.3), pv.GREY)

runner = pv.figure("runner", location=(0.0, 0.0))
pv.travel(runner, [(0.0, 0.0), (4.0, 0.0)], start=0.5, end=2.5, ramp=0.0, settle=0.0, pace=None)
pv.hold(runner, 2.5, 4.0)

cam = pv.camera(50, location=(0.0, -7.0, 1.6), look_at=(2.0, 0.0, 1.2))
pv.zoom(cam, 50, 25, 0.0, 1.0)
pv.accent([crate], 0.5, 1.0, (0.1, 0.4, 1.0))

pv.slowmo(0.5, 1.5, 2.0)
pv.finish(render=False)
`;

/** The one segment `SLOWMO_FIXTURE` registers. */
const SLOWMO_WARPS: Warp[] = [{ from: 0.5, to: 1.5, factor: 2.0 }];

let slowmoRun: (Exported & { log: string }) | null = null;

function slowmo(): Exported & { log: string } {
  if (slowmoRun) return slowmoRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "slowmo.py", SLOWMO_FIXTURE), [
    "--glb", join(dir, "scene.glb"),
    "--meta", join(dir, "scene.meta.json"),
    "--out", join(dir, "frames"),
  ]);
  if (run.code !== 0) throw new Error(`the slowmo fixture did not finish (exit ${run.code}):\n${run.err}`);
  slowmoRun = {
    glb: readGlb(join(dir, "scene.glb")),
    meta: JSON.parse(readFileSync(join(dir, "scene.meta.json"), "utf-8")),
    log: run.out,
  };
  return slowmoRun;
}

/** Where the figure is on each frame, in metres along its path. */
function walked(): number[] {
  return channel(slowmo().glb, "runner", "translation").values.map((point) => toBlender(point)[0]);
}

describe(`previz_kit slowmo — the clip stretches, the clock does not ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("the arrival moves by exactly the remap, and by nothing else", () => {
    const x = walked();
    // The shot is untouched: 4 s at 24 fps, before and after the ramp.
    expect(x).toHaveLength(96);
    expect(slowmo().meta.frames).toBe(96);
    expect(slowmo().meta.seconds).toBe(4);

    // Written: 4 m between 0.5 s and 2.5 s. The ramp eats 1.0 * (1 - 1/2) =
    // 0.5 s of action, so the arrival is seen at 3.0 s — frame 73, not 61.
    expect(shotTime(SLOWMO_WARPS, 2.5)).toBeCloseTo(3.0, 9);
    const arrival = x.findIndex((metres) => metres > 4 - 1e-4) + 1;
    expect(arrival).toBe(73);
    expect(frameOf(shotTime(SLOWMO_WARPS, 2.5))).toBe(73);
    // On the frame it would have arrived on without the ramp it is still a
    // metre short, which is the same claim stated so a regression cannot pass
    // by arriving early and holding.
    expect(x[60]).toBeCloseTo(3.0, 4);
    expect(x[71]).toBeLessThan(4 - 1e-4);
    for (const metres of x.slice(72)) expect(metres).toBeCloseTo(4.0, 4);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("every frame shows where the action is at W(t), not near it", () => {
    const x = walked();
    for (const [index, metres] of x.entries()) {
      const action = actionTime(SLOWMO_WARPS, index / 24);
      // 2 m/s from 0.5 s to 2.5 s of ACTION, and the pawn is baked from the
      // tracks rather than resampled out of a curve, so this is exact.
      expect(metres).toBeCloseTo(Math.max(0, Math.min(4, 2 * (action - 0.5))), 4);
    }
    // Half speed means half speed: one second of clip inside the segment
    // covers the half second of action a half second outside it covers.
    expect(x[36] - x[12]).toBeCloseTo(x[48] - x[36], 4);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the sidecar carries the segments, in shot seconds", () => {
    expect(slowmo().meta.time_warp).toEqual([{ from: 0.5, to: 1.5, factor: 2 }]);
    // The accent was written over 0.5-1.0 s of action; the viewer replays it
    // against the clip, so the sidecar says where the clip shows it.
    expect(slowmo().meta.accents).toEqual([
      { objects: ["crate"], from: 0.5, to: 1.5, color: [0.1, 0.4, 1] },
    ]);
    expect(shotTime(SLOWMO_WARPS, 1.0)).toBeCloseTo(1.5, 9);
  }, SLOW);

  /**
   * `--background` has no UI, so the printed log is the only observability a
   * headless run has — and a ramp's cost is exactly the thing an author needs
   * told rather than left to discover in the MP4.
   */
  test.skipIf(!HAS_BLENDER)("the log says what the ramp cost and where the clip now ends", () => {
    const lines = slowmo().log;
    expect(lines).toContain("1.00 s of clip carries 0.50 s of action");
    expect(lines).toContain("lands 0.50 s later");
    expect(lines).toContain("clip's last frame shows 3.50 s of action (of the 4.00 s written)");
    // The pawn is baked through the map, everything else is resampled through
    // it, and the line says which datablocks were which.
    expect(lines).toContain("baked runner over 96 frames through 1 time-warp segment(s)");
    expect(lines).toMatch(/time warp: 1 segment\(s\) 0\.50-1\.50 s at 1\/2, \d+ channel\(s\)/);
    expect(lines).toContain("cameras/cam");
    // This camera never moves, so the ramp cannot have eaten a settle — and
    // the line reports that rather than leaving it to be assumed.
    expect(lines).toContain("end-hold after the remap: cam moves 0.000 m over the clip's last 0.50 s");
    expect(lines).not.toContain("pushed the settle past the end");
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the focal curve is re-read off the warped lens, not the frames it was written on", () => {
    const lens = slowmo().meta.camera_lens as { frame: number; mm: number }[];
    // The zoom was written over 0.0-1.0 s of action — frames 1..25 — and the
    // ramp moves its end to 1.5 s of clip, frame 37.
    expect(lens).toHaveLength(96);
    expect(lens[0]).toEqual({ frame: 1, mm: 50 });
    expect(lens[36]).toEqual({ frame: 37, mm: 25 });
    expect(lens[lens.length - 1]).toEqual({ frame: 96, mm: 25 });
    expect(frameOf(shotTime(SLOWMO_WARPS, 1.0))).toBe(37);
    for (let index = 1; index < lens.length; index += 1) {
      expect(lens[index].mm).toBeLessThanOrEqual(lens[index - 1].mm + 1e-9);
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// impact — composed onto a camera that is already moving, under a ramp
// ---------------------------------------------------------------------------

const IMPACT_FIXTURE = `"""A hit on a camera that has a move and a ramp underneath it.

The camera_move ENDS before the hit on purpose: from then on the base path is
one station, so "returns to its path" is a distance from a point that can be
read straight off the export with no second run to compare against. The ramp
is here to prove the hit is NOT remapped with the action it punctuates.
"""

import previz_kit as pv

STATION_A = (0.0, -6.0, 1.60)
STATION_B = (1.4, -5.2, 1.85)
LOOK = (0.0, 0.0, 1.20)

pv.setup(seconds=3, fps=24, width=320, height=180)
pv.plane("floor", (24, 24), (0, 0, 0), pv.GREY)
pv.box("pillar", (0.5, 0.5, 3.0), (2.0, 3.0, 1.5), pv.WHITE)
cam = pv.camera(35, location=STATION_A, look_at=LOOK)
pv.camera_move(cam, [(0.0, STATION_A, LOOK), (1.2, STATION_B, LOOK)], settle=0.4)
pv.slowmo(0.4, 1.4, 2.0)
pv.impact(cam, 2.0)
pv.finish(render=False)
`;

const IMPACT_WARPS: Warp[] = [{ from: 0.4, to: 1.4, factor: 2.0 }];
const STATION_A: [number, number, number] = [0.0, -6.0, 1.6];
const STATION_B: [number, number, number] = [1.4, -5.2, 1.85];
const LOOK: [number, number, number] = [0.0, 0.0, 1.2];
const PUSH = 0.15;
const SHAKE = 0.02;

let impactRun: Exported | null = null;

function impact(): Exported {
  if (impactRun) return impactRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "impact.py", IMPACT_FIXTURE), [
    "--glb", join(dir, "scene.glb"),
    "--meta", join(dir, "scene.meta.json"),
    "--out", join(dir, "frames"),
  ]);
  if (run.code !== 0) throw new Error(`the impact fixture did not finish (exit ${run.code}):\n${run.err}`);
  impactRun = {
    glb: readGlb(join(dir, "scene.glb")),
    meta: JSON.parse(readFileSync(join(dir, "scene.meta.json"), "utf-8")),
  };
  return impactRun;
}

/** The camera's station on each frame, in Blender axes. */
function cameraPath(): [number, number, number][] {
  return channel(impact().glb, "cam", "translation").values.map(toBlender);
}

function minus(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe(`previz_kit impact — a hit laid on top of the path, in shot time ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("the camera move underneath it survives, moved by the ramp", () => {
    const path = cameraPath();
    expect(path).toHaveLength(72);
    expect(length(minus(path[0], STATION_A))).toBeLessThan(1e-3);
    // The move was written to end at 1.2 s of action; the ramp costs 0.5 s,
    // so the camera arrives at its station at 1.7 s of clip — frame 42 — and
    // is still well short of it on the frame it was written to arrive on.
    expect(shotTime(IMPACT_WARPS, 1.2)).toBeCloseTo(1.7, 9);
    expect(frameOf(1.7)).toBe(42);
    expect(length(minus(path[41], STATION_B))).toBeLessThan(1e-3);
    expect(length(minus(path[29], STATION_B))).toBeGreaterThan(0.01);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the hit lands on the SHOT second it was given, not on the remapped one", () => {
    const path = cameraPath();
    // 2.0 s of clip is frame 49. Had the hit been carried through W(t) with
    // everything else it would have landed at frame 61 instead.
    expect(frameOf(2.0)).toBe(49);
    for (const frame of [43, 44, 45, 46, 47, 48]) {
      expect(length(minus(path[frame - 1], STATION_B))).toBeLessThan(1e-3);
    }
    expect(length(minus(path[48], STATION_B))).toBeGreaterThan(0.01);
    expect(frameOf(shotTime(IMPACT_WARPS, 2.0))).toBe(61);
    expect(length(minus(path[60], STATION_B))).toBeLessThan(1e-3);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the push is down the sightline, and the shake is across it", () => {
    const path = cameraPath();
    const sight = minus(LOOK, STATION_B);
    const forward = sight.map((axis) => axis / length(sight));
    let deepest = 0;
    let sideways = 0;
    for (let frame = 49; frame <= 55; frame += 1) {
      const offset = minus(path[frame - 1], STATION_B);
      const along = dot(offset, forward);
      deepest = Math.max(deepest, along);
      sideways = Math.max(sideways, Math.sqrt(Math.max(0, length(offset) ** 2 - along ** 2)));
    }
    // The shove reaches `push` metres towards what the camera is looking at.
    // The window is six frames, so the sample nearest the peak is a couple of
    // per cent short of it — and never over.
    expect(deepest).toBeLessThanOrEqual(PUSH + 1e-6);
    expect(deepest).toBeGreaterThan(PUSH * 0.9);
    // Everything off the sightline is the shake, and it stays inside its
    // stated amplitude.
    expect(sideways).toBeGreaterThan(SHAKE * 0.5);
    expect(sideways).toBeLessThanOrEqual(SHAKE + 1e-6);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("it is back on the path within a millimetre when the window closes", () => {
    const path = cameraPath();
    // `seconds=0.25` from 2.0 s: the window closes on frame 55, and the rest
    // of the clip is the station the move left the camera on — which is what
    // `end-hold` is about.
    expect(frameOf(2.25)).toBe(55);
    for (let frame = 55; frame <= 72; frame += 1) {
      expect(length(minus(path[frame - 1], STATION_B))).toBeLessThan(0.001);
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// The worked examples, through the real CLI
// ---------------------------------------------------------------------------

interface Rendered {
  payload: any;
  dir: string;
}

const DUEL = [
  { id: "orbit", file: "duel_orbit.py", seconds: 6 },
  { id: "dolly", file: "duel_dolly_zoom.py", seconds: 4 },
  { id: "crane", file: "duel_crane.py", seconds: 5 },
];

let duelRuns: Record<string, Rendered> | null = null;

/** Scaffold a film with three shots and render each example into one, the
 *  way an agent would: `backlot.mjs` makes the project and the shots,
 *  `previz.mjs render` runs the scene. */
function duel(): Record<string, Rendered> {
  if (duelRuns) return duelRuns;
  const cwd = fresh();
  const cli = (script: string, argv: string[]) => {
    const result = Bun.spawnSync([process.execPath, script, ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`${script} ${argv.join(" ")} failed (${result.exitCode}):\n${result.stderr.toString()}`);
    }
    return JSON.parse(result.stdout.toString());
  };

  cli(BACKLOT, ["init", "film", "--title", "The Duel", "--logline", "Two swords on a ruined terrace."]);
  const rendered: Record<string, Rendered> = {};
  for (const entry of DUEL) {
    cli(BACKLOT, ["shot", "add", "film", entry.id, "--title", entry.id,
      "--seconds", String(entry.seconds), "--fps", "24", "--size", "1280x720"]);
    const greybox = join(cwd, "film", "shots", entry.id, "greybox");
    mkdirSync(greybox, { recursive: true });
    cpSync(join(EXAMPLES, entry.file), join(greybox, "scene.py"));
    cpSync(join(EXAMPLES, "courtyard.py"), join(greybox, "courtyard.py"));
    rendered[entry.id] = {
      payload: cli(PREVIZ, ["render", join("film", "shots", entry.id), "--preview"]),
      dir: greybox,
    };
  }
  duelRuns = rendered;
  return duelRuns;
}

describe(`previz_kit examples — the duel renders end to end ${LIVE_TIER_LABEL}`, () => {
  for (const entry of DUEL) {
    test.skipIf(!HAS_BLENDER)(`${entry.file} renders a playable MP4, a GLB and a sidecar`, () => {
      const { payload: result, dir } = duel()[entry.id];
      expect(result.ok).toBe(true);
      expect(result.wrote).toEqual({ blend: true, glb: true, meta: true });

      // `render` probes the encode with ffprobe and refuses a mismatch, so
      // these are the numbers ffprobe measured, not the ones we hoped for.
      expect(result.probe.codec).toBe("h264");
      expect(result.probe.pixFmt).toBe("yuv420p");
      expect(result.probe.frames).toBe(entry.seconds * 24);
      expect(result.probe.fps).toBe(24);
      expect([result.probe.width, result.probe.height]).toEqual([640, 360]);

      expect(statSync(join(dir, "scene.glb")).size).toBeGreaterThan(50 * 1024);
      expect(result.meta.frames).toBe(entry.seconds * 24);
      expect(result.meta.subjects).toEqual(["challenger", "master"]);
      expect(existsSync(join(dir, "sheet.png"))).toBe(true);

      // The example imports `courtyard` beside it; the runner's
      // `dont_write_bytecode` is what keeps that from littering the
      // workspace the viewer watches.
      expect(existsSync(join(dir, "__pycache__"))).toBe(false);
    }, SLOW);
  }

  test.skipIf(!HAS_BLENDER)("the orbit example sweeps 160 deg on a 5.6 m circle", () => {
    const glb = readGlb(join(duel().orbit.dir, "scene.glb"));
    const { values } = channel(glb, "cam", "translation");
    expect(values).toHaveLength(144);
    const radii = values.map((point) => {
      const [x, y] = toBlender(point);
      return Math.hypot(x - 0.0, y + 0.5);
    });
    expect(Math.max(...radii.map((radius) => Math.abs(radius - 5.6)))).toBeLessThan(0.01);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the crane example's zoom reaches the viewer through camera_lens", () => {
    const lens = duel().crane.payload.meta.camera_lens as { frame: number; mm: number }[];
    expect(lens[0]).toEqual({ frame: 1, mm: 30 });
    expect(lens[lens.length - 1]).toEqual({ frame: 102, mm: 21 });
    // The orbit example has no zoom, so its curve is empty — the key is
    // always present, and empty means "the exported yfov is the whole truth".
    expect(duel().orbit.payload.meta.camera_lens).toEqual([]);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the dolly example's ramp is in the sidecar and leaves the end-hold intact", () => {
    // `pv.slowmo(0.9, 1.5, 2)` — the descent and the landing at half speed.
    const warps: Warp[] = [{ from: 0.9, to: 1.5, factor: 2 }];
    expect(duel().dolly.payload.meta.time_warp).toEqual([{ from: 0.9, to: 1.5, factor: 2 }]);
    expect(duel().orbit.payload.meta.time_warp).toEqual([]);
    expect(duel().crane.payload.meta.time_warp).toEqual([]);

    // The dolly zoom was written to end at 3.2 s of action; the ramp costs
    // 0.3 s, so it ends at 3.5 s of a 4 s clip — the settled half second
    // `end-hold` asks for, arrived at by arithmetic rather than by hope.
    expect(shotTime(warps, 3.2)).toBeCloseTo(3.5, 9);
    const lens = duel().dolly.payload.meta.camera_lens as { frame: number; mm: number }[];
    const compensated = 40 * (2.6 / 6.4);
    expect(lens).toHaveLength(96);
    expect(lens[0]).toEqual({ frame: 1, mm: 40 });
    // Frame 85 is 3.5 s of clip. The move's last lens key was written on
    // frame 78, which is 3.2083 s of action rather than 3.2 — `F()` rounds to
    // a frame — so 3.5 s of clip reads a fifth of a frame short of the end of
    // the curve and lands four thousandths of a millimetre wide of it. From
    // the next frame the curve is past its last key and held exactly.
    expect(lens[frameOf(3.5) - 1].mm).toBeCloseTo(compensated, 2);
    expect(lens[frameOf(3.5)]).toEqual({ frame: 86, mm: compensated });
    expect(lens[95]).toEqual({ frame: 96, mm: compensated });

    // And the landing itself: the leap ends at 1.2 s of action, and the ramp
    // puts that on 1.5 s of clip — frame 37. On frame 30, the frame he would
    // have landed on without it, he is still a third of a metre in the air.
    const glb = readGlb(join(duel().dolly.dir, "scene.glb"));
    const height = channel(glb, "challenger", "translation").values.map((point) => toBlender(point)[2]);
    expect(frameOf(shotTime(warps, 1.2))).toBe(37);
    expect(height[29]).toBeGreaterThan(0.05);
    expect(height[35]).toBeGreaterThan(1e-4);
    for (const z of height.slice(36)) expect(z).toBeCloseTo(0, 4);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("the crane example's hit shows up as a spike on a camera that is still craning", () => {
    const glb = readGlb(join(duel().crane.dir, "scene.glb"));
    const path = channel(glb, "cam", "translation").values.map(toBlender);
    expect(path).toHaveLength(120);
    // No baseline run to subtract: a crane is smooth, so the hit is the one
    // place the camera's second difference is large. `pv.impact(cam, 1.2)`
    // runs frames 30..36.
    const jerk = path.slice(2).map((point, index) => {
      const back = path[index];
      const middle = path[index + 1];
      return length([
        point[0] - 2 * middle[0] + back[0],
        point[1] - 2 * middle[1] + back[1],
        point[2] - 2 * middle[2] + back[2],
      ]);
    });
    const loudest = jerk.indexOf(Math.max(...jerk)) + 2;
    expect(loudest).toBeGreaterThanOrEqual(frameOf(1.2));
    expect(loudest).toBeLessThanOrEqual(frameOf(1.45));
    // Measured, Blender 5.2.1: the hit bends the path by 0.21 m per frame
    // squared and the crane on its own never bends it by more than 0.004 m —
    // so the two are stated as the absolute numbers they are, and the crane
    // is still craning after the camera is back on its path.
    expect(Math.max(...jerk)).toBeGreaterThan(0.1);
    expect(Math.max(...jerk.slice(frameOf(1.45)))).toBeLessThan(0.01);
  }, SLOW);

  test.skipIf(!HAS_BLENDER)("duel_collage.py refuses to be a scene, and says which files are", () => {
    const run = runScene(join(EXAMPLES, "duel_collage.py"));
    expect(run.code).toBe(1);
    expect(run.err).toContain("duel_collage.py is the collage PATTERN, not a scene");
    expect(run.err).toContain("duel_orbit.py");
    expect(run.out).toContain("one strike, three angles");
    expect(existsSync(join(EXAMPLES, "__pycache__"))).toBe(false);
  }, SLOW);
});
