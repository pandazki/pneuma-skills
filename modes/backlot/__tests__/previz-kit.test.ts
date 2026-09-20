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

announceLiveTierSkip("every real Blender run behind previz_kit's orbit/zoom/dolly_zoom/dash and the duel examples");

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
  "F", "T", "accent", "accent_material", "box", "camera", "camera_move", "cylinder", "dash", "die",
  "dolly_zoom", "figure", "finish", "hinge", "hold", "log", "material", "move", "orbit", "plane",
  "pose_at", "room", "runner_args", "set_interpolation", "setup", "shot", "sphere", "swing",
  "travel", "turn", "zoom",
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
    ]) {
      expect(vocabulary).toContain(signature);
    }
  });

  test("the measured glTF note explains why focal length travels in the sidecar", () => {
    expect(source).toContain("camera_lens: [{frame, mm}]");
    expect(source).toContain("KHR_animation_pointer");
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
`;

let refusalRun: { cases: Record<string, { died: boolean; message: string }>; api: string[] } | null = null;

function refusals() {
  if (refusalRun) return refusalRun;
  const dir = fresh();
  const run = runScene(writeFixture(dir, "refusals.py", REFUSAL_FIXTURE));
  if (run.code !== 0) throw new Error(`the refusal fixture did not finish (exit ${run.code}):\n${run.err}`);
  const rows = payload(run, "refusals") as { case: string; died: boolean; message: string }[];
  const cases: Record<string, { died: boolean; message: string }> = {};
  for (const row of rows) cases[row.case] = { died: row.died, message: row.message };
  refusalRun = { cases, api: payload(run, "api") as string[] };
  return refusalRun;
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

  test.skipIf(!HAS_BLENDER)("duel_collage.py refuses to be a scene, and says which files are", () => {
    const run = runScene(join(EXAMPLES, "duel_collage.py"));
    expect(run.code).toBe(1);
    expect(run.err).toContain("duel_collage.py is the collage PATTERN, not a scene");
    expect(run.err).toContain("duel_orbit.py");
    expect(run.out).toContain("one strike, three angles");
    expect(existsSync(join(EXAMPLES, "__pycache__"))).toBe(false);
  }, SLOW);
});
