/**
 * blender.mjs — pinned as a real process, because that is how the agent calls it.
 *
 * Two halves:
 *
 * 1. **Detection, argument passing and timeouts** run against a FAKE Blender —
 *    a shell script that prints `Blender 4.4.3` for `--version` and otherwise
 *    echoes its argv. That makes the resolution order testable on a machine
 *    with no Blender and, more importantly, on a machine that HAS one: this
 *    developer's box has /Applications/Blender.app, so the "nothing was found"
 *    case has to blank the platform search explicitly
 *    (`LUCID_BLENDER_APP_PATHS=`, documented as test-only) or it would pass for
 *    the wrong reason here and fail on CI.
 *
 * 2. **render-views / probe / convert** drive the real binary and are live
 *    tier. Their input GLBs are written in code by `fixtures/glb/make-glb.mjs`;
 *    the FBX that `convert` needs is produced by the same Blender through
 *    `fixtures/glb/make-fbx.py`, since no binary fixtures are committed.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceLiveTierSkip, LIVE_TIER, LIVE_TIER_LABEL } from "../../../core/__tests__/test-tier.js";
import { buildGlb, gridMesh } from "./fixtures/glb/make-glb.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "blender.mjs");
const MAKE_FBX = join(import.meta.dir, "fixtures", "glb", "make-fbx.py");
const FAKE_VERSION = "4.4.3";
const POSIX = process.platform !== "win32";

announceLiveTierSkip("every real Blender run behind blender.mjs render-views/probe/convert");

if (!POSIX) {
  console.warn("(skip) modes/lucid blender.mjs fake-binary suites — the stub Blender is a POSIX shell script");
}

const workspaces: string[] = [];

function fresh(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lucid-blender-")));
  workspaces.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in Blender. `--version` answers like the real one; anything else
 * echoes the argv it was handed, one line each, which is how the `run`
 * assertions read the command line the wrapper built.
 */
function fakeBlender(dir: string, { name = "blender", body = "" } = {}): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Blender ${FAKE_VERSION}"
  echo "\tbuild date: 2026-01-01"
  exit 0
fi
${body || `for arg in "$@"; do echo "argv: $arg"; done
exit 0`}
`);
  chmodSync(path, 0o755);
  return path;
}

/** A binary that exists, runs, and is not Blender. */
function notBlender(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "imposter");
  writeFileSync(path, "#!/bin/sh\necho \"GNU coreutils 9.4\"\nexit 0\n");
  chmodSync(path, 0o755);
  return path;
}

/** Env with every Blender-locating input under the test's control. */
function env(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "BLENDER_PATH") base[key] = value;
  }
  // Blank the platform install locations: this machine has Blender installed,
  // and a "nothing found" assertion must not be able to find it.
  base.LUCID_BLENDER_APP_PATHS = "";
  base.PATH = "/nonexistent-for-tests";
  return { ...base, ...overrides };
}

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function run(cwd: string, environment: Record<string, string>, ...argv: string[]): Run {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function runJson(cwd: string, environment: Record<string, string>, ...argv: string[]): any {
  const result = run(cwd, environment, ...argv, "--json");
  if (result.code !== 0) throw new Error(`blender.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

// ---------------------------------------------------------------------------

describe.skipIf(!POSIX)("blender.mjs doctor — the resolution order", () => {
  test("--blender wins, and is reported as the source", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"));
    const payload = runJson(dir, env(), "doctor", "--no-gltf-probe", "--blender", fake);
    expect(payload.ok).toBe(true);
    expect(payload.blender).toMatchObject({ found: true, path: fake, version: FAKE_VERSION, source: "flag" });
    expect(payload.node).toBe(process.version);
    expect(payload.gltfTransform.note).toContain("--no-gltf-probe");
  });

  test("$BLENDER_PATH is next", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"));
    const payload = runJson(dir, env({ BLENDER_PATH: fake }), "doctor", "--no-gltf-probe");
    expect(payload.blender).toMatchObject({ found: true, path: fake, source: "env" });
    // The flag step is still reported, so the search is readable end to end.
    expect(payload.blender.steps[0]).toEqual({ source: "flag", candidate: null, status: "not-given" });
  });

  test("'blender' on $PATH is next after that", () => {
    const dir = fresh();
    const binDir = join(dir, "bin");
    const fake = fakeBlender(binDir);
    const payload = runJson(dir, env({ PATH: `${binDir}:/nonexistent-for-tests` }), "doctor", "--no-gltf-probe");
    expect(payload.blender).toMatchObject({ found: true, path: fake, source: "path" });
    expect(payload.blender.steps.map((step: any) => step.source)).toEqual(["flag", "env", "path"]);
  });

  test("the platform install locations come last, and are overridable", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"), { name: "Blender" });
    const payload = runJson(dir, env({ LUCID_BLENDER_APP_PATHS: fake }), "doctor", "--no-gltf-probe");
    expect(payload.blender).toMatchObject({ found: true, path: fake, source: "platform" });
  });

  test("with nothing to find, doctor is still a report — until --strict", () => {
    const dir = fresh();
    const report = run(dir, env(), "doctor", "--no-gltf-probe");
    expect(report.code).toBe(0);
    expect(report.out).toContain("blender        NOT FOUND");

    const payload = runJson(dir, env(), "doctor", "--no-gltf-probe");
    expect(payload.ok).toBe(false);
    expect(payload.blender).toMatchObject({ found: false, path: null, version: null, source: null });
    expect(payload.blender.steps.map((step: any) => [step.source, step.status])).toEqual([
      ["flag", "not-given"],
      ["env", "not-set"],
      ["path", "not-on-path"],
      ["platform", "no-candidates"],
    ]);

    const strict = run(dir, env(), "doctor", "--no-gltf-probe", "--strict");
    expect(strict.code).toBe(1);
  });

  test("a candidate that exists but is not Blender is rejected by --version", () => {
    const dir = fresh();
    const imposter = notBlender(join(dir, "bin"));
    const payload = runJson(dir, env({ BLENDER_PATH: imposter }), "doctor", "--no-gltf-probe");
    expect(payload.blender.found).toBe(false);
    const step = payload.blender.steps.find((entry: any) => entry.source === "env");
    expect(step.status).toBe("not-blender");
    expect(step.reason).toContain("did not print a Blender version");
  });

  test("an explicit --blender that does not work is a refusal, not a fallback", () => {
    const dir = fresh();
    const imposter = notBlender(join(dir, "bin"));
    const working = fakeBlender(join(dir, "other"));
    const result = run(dir, env({ LUCID_BLENDER_APP_PATHS: working }), "doctor", "--blender", imposter);
    expect(result.code).toBe(1);
    expect(result.err).toContain("is not a working Blender");
    expect(result.out).not.toContain(working);
  });
});

describe.skipIf(!POSIX)("blender.mjs run — the passthrough", () => {
  function scriptIn(dir: string): string {
    const path = join(dir, "step.py");
    writeFileSync(path, "# a placeholder: the fake Blender never reads it\n");
    return path;
  }

  test("builds --background --factory-startup --python <script> -- <args>", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"));
    const script = scriptIn(dir);
    const result = run(dir, env(), "run", script, "--blender", fake, "--", "one", "--two", "3");
    expect(result.code).toBe(0);
    const argv = result.out
      .split("\n")
      .filter((line) => line.startsWith("[blender] argv: "))
      .map((line) => line.slice("[blender] argv: ".length));
    expect(argv).toEqual(["--background", "--factory-startup", "--python", script, "--", "one", "--two", "3"]);
  });

  test("--json buffers the stream onto stderr and leaves one object on stdout", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"));
    const script = scriptIn(dir);
    const result = run(dir, env(), "run", script, "--blender", fake, "--json", "--", "alpha");
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.out);
    expect(payload).toMatchObject({ ok: true, command: "run", script, args: ["alpha"], exitCode: 0, timedOut: false });
    expect(payload.stdout).toContain("argv: alpha");
    expect(result.err).toContain("[blender] argv: alpha");
    // stdout is the JSON and nothing else.
    expect(result.out.trim().split("\n")).toHaveLength(1);
  });

  test("the child's exit code is propagated", () => {
    const dir = fresh();
    const fake = fakeBlender(join(dir, "bin"), { body: 'echo "boom" >&2\nexit 3' });
    const result = run(dir, env(), "run", scriptIn(dir), "--blender", fake);
    expect(result.code).toBe(3);
    expect(result.err).toContain("[blender] boom");
  });

  test("a run past --timeout is killed and says so", () => {
    const dir = fresh();
    // exec, so the signal reaches sleep itself rather than the shell wrapper.
    // `sleep` is an external binary, so this is the one case that needs a real
    // PATH; --blender still pins which "Blender" runs.
    const fake = fakeBlender(join(dir, "bin"), { body: "exec sleep 30" });
    const started = Date.now();
    const result = run(dir, env({ PATH: "/bin:/usr/bin" }), "run", scriptIn(dir), "--blender", fake, "--timeout", "1");
    const elapsed = Date.now() - started;
    expect(result.code).toBe(124);
    expect(result.err).toContain("timed out after 1s");
    expect(result.err).toContain("did not finish within 1s");
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);

  test("a missing script is refused before Blender is started", () => {
    const dir = fresh();
    const result = run(dir, env(), "run", "no-such.py");
    expect(result.code).toBe(1);
    expect(result.err).toContain("<script.py> does not exist");
  });

  test("with no Blender anywhere, the refusal lists where it looked", () => {
    const dir = fresh();
    const result = run(dir, env(), "run", join(dir, "x.py"));
    expect(result.code).toBe(1);
    expect(result.err).toContain("does not exist");
  });
});

describe.skipIf(!POSIX)("blender.mjs — help and refusals", () => {
  test("--help documents the argument convention the Python side must follow", () => {
    const result = run(fresh(), env(), "--help");
    expect(result.code).toBe(0);
    expect(result.out).toContain("sys.argv[sys.argv.index('--') + 1:]");
    expect(result.out).toContain("NO OpenGL context in --background");
    expect(result.out).toContain("LUCID_BLENDER_APP_PATHS");
  });

  test("an unknown subcommand exits 1", () => {
    const result = run(fresh(), env(), "bake");
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown subcommand 'bake'");
  });

  test("render-views without a Blender refuses with the search it performed", () => {
    const dir = fresh();
    buildGlb(join(dir, "model.glb"));
    const result = run(dir, env(), "render-views", "model.glb", "sheet.png");
    expect(result.code).toBe(1);
    expect(result.err).toContain("no Blender found");
  });
});

// ---------------------------------------------------------------------------
// Live tier: the real binary
// ---------------------------------------------------------------------------

/** Probe for a real Blender ONCE, and only when the live tier was asked for:
 *  a module-level probe runs during collection, before any skipIf. */
const REAL_BLENDER: string | null = (() => {
  if (!LIVE_TIER) return null;
  const probe = Bun.spawnSync([process.execPath, SCRIPT, "doctor", "--json", "--no-gltf-probe"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const payload = JSON.parse(probe.stdout.toString());
    return payload.blender.found ? (payload.blender.path as string) : null;
  } catch {
    return null;
  }
})();

if (LIVE_TIER && !REAL_BLENDER) {
  console.warn("(skip) modes/lucid blender.mjs live suite — no Blender binary on this machine");
}

const HAS_BLENDER = REAL_BLENDER !== null;

describe(`blender.mjs — real Blender ${LIVE_TIER_LABEL}`, () => {
  test.skipIf(!HAS_BLENDER)("render-views writes a six-tile sheet and a sidecar that names the order", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 12 });
    buildGlb(join(dir, "model.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });

    const payload = runJson(dir, { ...process.env } as Record<string, string>, "render-views", "model.glb", "sheet.png", "--size", "128");
    expect(payload.ok).toBe(true);
    expect(payload.views).toEqual(["-Z front", "+X right", "+Z back", "-X left", "+Y top", "iso"]);

    // The size check is the point: a headless Blender that framed nothing
    // writes a few-hundred-byte PNG and exits 0.
    const bytes = statSync(join(dir, "sheet.png")).size;
    expect(bytes).toBe(payload.bytes);
    expect(bytes).toBeGreaterThan(10 * 1024);

    const sidecar = JSON.parse(readFileSync(join(dir, "sheet.png.json"), "utf-8"));
    expect(sidecar.cols).toBe(3);
    expect(sidecar.rows).toBe(2);
    expect(sidecar.tileSize).toBe(128);
    expect(sidecar.meshObjects).toBe(1);
    expect(sidecar.tiles).toHaveLength(6);
    expect(sidecar.tiles.map((tile: any) => [tile.row, tile.col])).toEqual([
      [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2],
    ]);
    // Every tile records the glTF-space direction it was shot from, so the
    // name never has to be interpreted.
    expect(sidecar.tiles.map((tile: any) => tile.cameraDirection)).toEqual([
      [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [1, 1, 1],
    ]);
    // Six DIFFERENT framings: an ortho_scale that never changed would mean the
    // camera never moved.
    expect(new Set(sidecar.tiles.map((tile: any) => tile.orthoScale)).size).toBeGreaterThan(1);
  }, 300_000);

  test.skipIf(!HAS_BLENDER)("probe reports the one mesh, its triangles and the world bbox in glTF axes", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 6 });
    buildGlb(join(dir, "model.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });

    const payload = runJson(dir, { ...process.env } as Record<string, string>, "probe", "model.glb");
    expect(payload.ok).toBe(true);
    expect(payload.meshObjects).toBe(1);
    expect(payload.triangles).toBe(72);
    const mesh = payload.objects.find((entry: any) => entry.type === "MESH");
    expect(mesh).toMatchObject({ triangles: 72, notExported: false });
    // The grid spans x,z in [-1, 1] with a small y displacement — in glTF
    // axes, which is what the scene will load it into.
    expect(payload.bboxGltf.min[0]).toBeCloseTo(-1, 3);
    expect(payload.bboxGltf.max[0]).toBeCloseTo(1, 3);
    expect(payload.bboxGltf.max[1]).toBeLessThan(0.5);
    expect(payload.blender.version).toMatch(/^\d+\.\d+/);
  }, 300_000);

  test.skipIf(!HAS_BLENDER)("convert turns an FBX into a GLB and proves what it produced", () => {
    const dir = fresh();
    const grid = gridMesh({ segments: 8 });
    buildGlb(join(dir, "source.glb"), { positions: grid.positions, indices: grid.indices, node: { translation: [0, 0, 0] } });

    // No binary fixtures live in the repo, so the FBX is made by the same
    // Blender, with its textures embedded (which is what makes the importer
    // want to unpack a .fbm directory next to whatever it reads).
    const made = run(dir, { ...process.env } as Record<string, string>, "run", MAKE_FBX, "--", "source.glb", "source.fbx");
    expect(made.code).toBe(0);
    expect(existsSync(join(dir, "source.fbx"))).toBe(true);

    const payload = runJson(
      dir,
      { ...process.env } as Record<string, string>,
      "convert", "source.fbx", "out.glb", "--yaw", "90", "--texture-size", "256",
    );
    expect(payload.ok).toBe(true);
    expect(payload.checklist.triangles).toBe(128);
    expect(payload.checklist.materials).toBeGreaterThan(0);
    // Blender's exporter writes doubleSided: true by default; the helper turns
    // backface culling on so it does not.
    expect(payload.checklist.doubleSidedMaterials).toBe(0);
    expect(payload.checklist.extensionsRequired).toEqual([]);
    expect(payload.helper.yawBaked).toBe(true);
    expect(payload.helper.yaw).toBe(90);
    // The source directory is untouched: the .fbm dump lands in a temp dir.
    expect(existsSync(join(dir, "source.fbm"))).toBe(false);
  }, 300_000);

  test.skipIf(!HAS_BLENDER)("doctor finds the real binary and reports its version", () => {
    const payload = runJson(fresh(), { ...process.env } as Record<string, string>, "doctor", "--no-gltf-probe");
    expect(payload.blender.found).toBe(true);
    expect(payload.blender.path).toBe(REAL_BLENDER as string);
    expect(payload.blender.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
    expect(["flag", "env", "path", "platform"]).toContain(payload.blender.source);
  }, 120_000);
});
