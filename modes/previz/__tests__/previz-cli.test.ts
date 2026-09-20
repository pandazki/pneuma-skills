/**
 * `previz.mjs`, pinned as a real artefact.
 *
 * The script is SPAWNED as a process with a pinned cwd, never imported: its
 * contract with the agent is argv in, one JSON object out, an exit code, and
 * the bytes it leaves on disk. Testing it any other way would pin something
 * the agent never sees.
 *
 * Only the file-only commands are exercised here — `render`, `reference`,
 * `sheet`, `compare` and a real `generate` need Blender, ffmpeg or the
 * network, and a test that needs those is a test that is skipped on CI and
 * therefore proves nothing. Their pure halves live in `previz-media.test.ts`
 * and `previz-shot.test.ts`; the end-to-end runs are recorded in the mode's
 * verification notes.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "previz.mjs");
const T = (minutes: number): string => new Date(Date.UTC(2026, 8, 20, 10, minutes)).toISOString();

const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS resolves /var to /private/var for a child
 *  process's cwd — without it every absolute path the script prints would
 *  disagree with the one the test built. */
function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "previz-")));
  workspaces.push(dir);
  return dir;
}

function run(cwd: string, argv: string[], env?: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function json(cwd: string, argv: string[]): Record<string, any> {
  const result = run(cwd, argv);
  if (result.code !== 0) throw new Error(`previz.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

const shotFile = (cwd: string, project = "film", id = "lab-walk") =>
  JSON.parse(readFileSync(join(cwd, project, "shots", id, "shot.json"), "utf-8"));

/** A project with one shot, scaffolded exactly as an agent would. */
function scaffold(cwd: string, extra: string[] = []) {
  json(cwd, ["init", "film", "--title", "First Light"]);
  return json(cwd, ["shot", "film", "lab-walk", "--title", "The researcher wakes the device", ...extra]);
}

/** Fake a render the way `render` records one, so the file-only commands
 *  downstream of it can be exercised without Blender. */
function fakeRender(cwd: string, { revision = 1, final = false } = {}) {
  const path = join(cwd, "film", "shots", "lab-walk", "shot.json");
  const shot = JSON.parse(readFileSync(path, "utf-8"));
  shot.greybox.revision = revision;
  const record = {
    file: final ? "greybox/greybox.mp4" : "greybox/preview.mp4",
    revision,
    scale: final ? 1 : 0.5,
    probe: { codec: "h264", pixFmt: "yuv420p", width: 1280, height: 720, fps: 24, frames: 192, seconds: 8, bytes: 1 },
    renderedAt: T(1),
    renderSeconds: 9.7,
  };
  if (final) shot.greybox.final = record;
  else shot.greybox.preview = record;
  writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);
  writeFileSync(join(cwd, "film", "shots", "lab-walk", record.file), "not really an mp4");
}

function writePrompt(cwd: string, body: string) {
  const path = join(cwd, "film", "shots", "lab-walk", "prompts.md");
  const markdown = readFileSync(path, "utf-8").replace(/```prompt\n[\s\S]*?\n```/, `\`\`\`prompt\n${body}\n\`\`\``);
  writeFileSync(path, markdown);
}

const BEATS = [
  { id: "establish", label: "Doorway establishes", from: 0, to: 0.5, kind: "hold" },
  { id: "walk", label: "Walks to the console", from: 0.5, to: 3.8, kind: "action" },
  { id: "touch", label: "Raises a hand to the button", from: 4.5, to: 5.5, kind: "action" },
  { id: "glow", label: "Device brightens blue", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch" },
];

describe("init and shot", () => {
  test("scaffolds a project and a shot that is ready to render", () => {
    const cwd = workspace();
    const init = json(cwd, ["init", "film", "--title", "First Light", "--seconds", "6", "--fps", "24", "--size", "854x480"]);
    expect(init.project).toEqual({
      version: 1,
      title: "First Light",
      defaults: { seconds: 6, fps: 24, width: 854, height: 480 },
      shots: [],
    });

    const made = json(cwd, ["shot", "film", "Lab Walk", "--title", "The researcher wakes the device"]);
    expect(made.id).toBe("lab-walk");
    expect(made.spec).toEqual({ seconds: 6, fps: 24, width: 854, height: 480, frames: 144 });
    expect(made.next.stage).toBe("plan");
    for (const file of ["shot.json", "shot-plan.md", "prompts.md", "comparison.md", "greybox/scene.py"]) {
      expect(existsSync(join(cwd, "film", "shots", "lab-walk", file))).toBe(true);
    }
    // The starter is retuned to THIS shot's spec, so the first render cannot
    // fail the kit's frame-range check.
    const scene = readFileSync(join(cwd, "film", "shots", "lab-walk", "greybox", "scene.py"), "utf-8");
    expect(scene).toContain("pv.setup(seconds=6, fps=24, width=854, height=480)");

    const project = JSON.parse(readFileSync(join(cwd, "film", "previz.json"), "utf-8"));
    expect(project.shots).toEqual(["lab-walk"]);

    const shot = shotFile(cwd);
    expect(shot.checks).toHaveLength(8);
    expect(shot.checks.every((check: any) => check.status === "unverified")).toBe(true);
    expect(shot.assumptions[0]).toContain("project defaults");
  });

  test("refuses a second init, a second shot of the same id, and a fractional frame count", () => {
    const cwd = workspace();
    scaffold(cwd);
    expect(run(cwd, ["init", "film", "--title", "Again"]).code).toBe(1);
    expect(run(cwd, ["init", "film", "--title", "Again"]).err).toContain("already exists");
    expect(run(cwd, ["shot", "film", "lab-walk", "--title", "Twice"]).err).toContain("already exists");
    const bad = run(cwd, ["shot", "film", "odd", "--title", "Odd", "--seconds", "7.9"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("not whole");
  });

  test("a recreate shot asks for its reference first", () => {
    const cwd = workspace();
    json(cwd, ["init", "film", "--title", "First Light"]);
    const made = json(cwd, ["shot", "film", "redo", "--title", "Recreate this", "--entry", "recreate"]);
    expect(made.next.stage).toBe("reference");
    expect(existsSync(join(cwd, "film", "shots", "redo", "reference"))).toBe(true);
  });
});

describe("beats", () => {
  test("loads a validated timeline and refuses a broken one whole", () => {
    const cwd = workspace();
    scaffold(cwd);
    writeFileSync(join(cwd, "beats.json"), JSON.stringify(BEATS));
    const loaded = json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);
    expect(loaded.count).toBe(4);
    expect(loaded.next.stage).toBe("greybox-preview");
    expect(shotFile(cwd).beats[3]).toMatchObject({ id: "glow", causedBy: "touch", kind: "trigger" });

    writeFileSync(join(cwd, "bad.json"), JSON.stringify([
      { id: "touch", from: 6, to: 6.5, kind: "action" },
      { id: "glow", from: 5.5, to: 9.5, kind: "trigger", causedBy: "touch" },
    ]));
    const refused = run(cwd, ["beats", "film/shots/lab-walk", "--set", "bad.json"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("past the shot's 8 s");
    expect(refused.err).toContain("an effect cannot precede its cause");
    // A refusal leaves the shot exactly as it was.
    expect(shotFile(cwd).beats).toHaveLength(4);
  });
});

describe("check and checklist", () => {
  test("records against the current revision, keeps a history, and computes stuck", () => {
    const cwd = workspace();
    scaffold(cwd);
    fakeRender(cwd, { revision: 1 });

    const first = json(cwd, ["check", "film/shots/lab-walk", "--id", "pace", "--status", "fail",
      "--range", "3.5,4.5", "--note", "skates at the stop", "--now", T(1)]);
    expect(first.check).toMatchObject({ status: "fail", revision: 1, range: [3.5, 4.5] });
    expect(first.stuck).toEqual([]);
    expect(first.summary).toMatchObject({ fail: 1, unverified: 7, accepted: false });

    fakeRender(cwd, { revision: 2 });
    const second = json(cwd, ["check", "film/shots/lab-walk", "--id", "pace", "--status", "fail",
      "--note", "still there", "--now", T(2)]);
    expect(second.stuck).toEqual(["pace"]);
    expect(second.check.history).toEqual([{ revision: 1, status: "fail", note: "skates at the stop", at: T(1) }]);
    expect(shotFile(cwd).stuck).toEqual(["pace"]);

    fakeRender(cwd, { revision: 3 });
    const fixed = json(cwd, ["check", "film/shots/lab-walk", "--id", "pace", "--status", "pass", "--now", T(3)]);
    expect(fixed.stuck).toEqual([]);
    expect(fixed.check.history).toHaveLength(2);
  });

  test("refuses a check before a render, an unknown status, and a range past the shot", () => {
    const cwd = workspace();
    scaffold(cwd);
    expect(run(cwd, ["check", "film/shots/lab-walk", "--id", "blocking", "--status", "pass"]).err)
      .toContain("no greybox render to check yet");
    fakeRender(cwd);
    expect(run(cwd, ["check", "film/shots/lab-walk", "--id", "blocking", "--status", "fine"]).err)
      .toContain("--status must be one of");
    expect(run(cwd, ["check", "film/shots/lab-walk", "--id", "blocking", "--status", "pass", "--range", "1,99"]).err)
      .toContain("past the shot's 8 s");
  });

  test("checklist seeds what is missing and never overwrites a verdict", () => {
    const cwd = workspace();
    scaffold(cwd);
    fakeRender(cwd);
    json(cwd, ["check", "film/shots/lab-walk", "--id", "framing", "--status", "pass", "--now", T(1)]);
    const seeded = json(cwd, ["checklist", "film/shots/lab-walk"]);
    expect(seeded.added).toEqual([]);
    expect(seeded.byTarget.greybox.pass).toBe(1);
    expect(shotFile(cwd).checks.find((c: any) => c.id === "framing").status).toBe("pass");
  });
});

/** A shot whose greybox is rendered, accepted, and has a real prompt. */
function ready(cwd: string) {
  scaffold(cwd);
  writeFileSync(join(cwd, "beats.json"), JSON.stringify(BEATS));
  json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);
  fakeRender(cwd, { revision: 1, final: true });
  for (const id of ["frame-count", "blocking", "pace", "penetration", "framing", "trigger-order", "camera-smooth", "end-hold"]) {
    json(cwd, ["check", "film/shots/lab-walk", "--id", id, "--status", "pass", "--now", T(1)]);
  }
  writePrompt(cwd, "Follow the motion, staging and camera of [Video1] exactly. A research lab at night.");
}

describe("generate --estimate", () => {
  test("prices the job from the greybox's measured duration and stops", () => {
    const cwd = workspace();
    ready(cwd);
    const estimate = json(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(estimate).toMatchObject({
      estimate: true,
      wouldBe: "take-01",
      endpoint: "reference",
      resolution: "480p",
      seconds: 8,
      refSeconds: 8,
      greyboxRevision: 1,
    });
    expect(estimate.cost.usd).toBeCloseTo(16 * 0.1323, 4);
    expect(estimate.cost.basis).toBe("(8 s out + 8 s ref) x $0.1323/s at 480p");
    // An estimate is a query: it records nothing.
    expect(shotFile(cwd).takes).toEqual([]);

    const dearer = json(cwd, ["generate", "film/shots/lab-walk", "--estimate", "--resolution", "720p"]);
    expect(dearer.cost.usd).toBeCloseTo(16 * 0.2838, 4);
  });

  test("refuses a resolution it cannot price, before anything else happens", () => {
    const cwd = workspace();
    ready(cwd);
    const refused = run(cwd, ["generate", "film/shots/lab-walk", "--estimate", "--resolution", "1080p"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--resolution must be one of 480p|720p");
  });

  test("refuses without a final greybox, and while a greybox check is failing", () => {
    const cwd = workspace();
    scaffold(cwd);
    writePrompt(cwd, "Follow [Video1].");
    expect(run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).err).toContain("no final greybox");

    ready(workspace());
    const cwd2 = workspace();
    ready(cwd2);
    json(cwd2, ["check", "film/shots/lab-walk", "--id", "penetration", "--status", "fail", "--now", T(2)]);
    const blocked = run(cwd2, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("the greybox has failing checks (penetration)");
    expect(blocked.err).toContain('--allow-failing "<reason>"');
    const allowed = json(cwd2, ["generate", "film/shots/lab-walk", "--estimate", "--allow-failing", "the model repaints that beat"]);
    expect(allowed.ok).toBe(true);
  });

  test("refuses a prompt that is missing, placeholder, or never addresses the greybox", () => {
    const cwd = workspace();
    ready(cwd);
    writePrompt(cwd, "A research lab at night, blue light.");
    expect(run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).err).toContain("never mentions [Video1]");

    const cwd2 = workspace();
    scaffold(cwd2);
    fakeRender(cwd2, { revision: 1, final: true });
    // Untouched scaffold: the template must not satisfy its own gate.
    const untouched = run(cwd2, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(untouched.code).toBe(1);
    expect(untouched.err).toContain("scaffolded placeholder");
  });

  test("the take policy escalates: free, then --fix, then --user-approved", () => {
    const cwd = workspace();
    ready(cwd);
    const path = join(cwd, "film", "shots", "lab-walk", "shot.json");
    const withTakes = (count: number) => {
      const shot = JSON.parse(readFileSync(path, "utf-8"));
      shot.takes = Array.from({ length: count }, (_, index) => ({ id: `take-0${index + 1}`, status: "done" }));
      writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);
    };

    expect(json(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).wouldBe).toBe("take-01");
    withTakes(1);
    expect(run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).err).toContain('--fix "<what this take changes>"');
    expect(json(cwd, ["generate", "film/shots/lab-walk", "--estimate", "--fix", "the hand missed"]).wouldBe).toBe("take-02");
    withTakes(2);
    expect(run(cwd, ["generate", "film/shots/lab-walk", "--estimate", "--fix", "again"]).err).toContain("--user-approved");
    expect(json(cwd, ["generate", "film/shots/lab-walk", "--estimate", "--fix", "again", "--user-approved"]).wouldBe).toBe("take-03");
  });
});

/**
 * A take that lands must not carry the shot BACK to what it looked like five
 * minutes ago.
 *
 * `generate` reads `shot.json`, records the take as `submitted`, then waits
 * on fal. An agent recording checks or rendering in that window is the normal
 * case, and writing back the in-memory copy afterwards erased them (observed:
 * a `check --status pass` answered `ok` mid-generation and was `unverified`
 * again once the take landed). The generator here is injected through
 * `PREVIZ_SEEDANCE_MODULE` — nothing is sent anywhere and nothing is paid —
 * and it does the concurrent work through the REAL CLI while it "runs".
 */
const FAKE_SEEDANCE = `
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

export const SEEDANCE_MODEL = "bytedance/seedance-2.5";

export async function generateSeedanceVideo({ output }) {
  if (process.env.FAKE_MIDFLIGHT) {
    const result = spawnSync(process.execPath, [process.env.FAKE_PREVIZ, ...JSON.parse(process.env.FAKE_MIDFLIGHT)], {
      cwd: process.env.FAKE_CWD,
      encoding: "utf-8",
    });
    if (result.status !== 0) throw new Error("the mid-flight command failed: " + result.stderr);
  }
  if (process.env.FAKE_DROP_TAKES) {
    const shot = JSON.parse(readFileSync(process.env.FAKE_DROP_TAKES, "utf-8"));
    shot.takes = [];
    writeFileSync(process.env.FAKE_DROP_TAKES, JSON.stringify(shot, null, 2) + "\\n");
  }
  if (process.env.FAKE_THROW) throw new Error(process.env.FAKE_THROW);
  copyFileSync(process.env.FAKE_TAKE_SOURCE, output);
  return { request_id: "fake-request-01", url: "https://example.invalid/fake.mp4" };
}
`;

const HAS_FFMPEG =
  Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0 &&
  Bun.spawnSync(["ffprobe", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

describe("a take in flight never rewinds the shot", () => {
  const SHOT = "film/shots/lab-walk";

  /** The injected generator, plus the env that drives it. */
  function generator(cwd: string, extra: Record<string, string>) {
    const path = join(cwd, "fake-seedance.mjs");
    writeFileSync(path, FAKE_SEEDANCE);
    return { FAL_KEY: "test-key-never-sent", PREVIZ_SEEDANCE_MODULE: path, FAKE_PREVIZ: SCRIPT, FAKE_CWD: cwd, ...extra };
  }

  /** One second of colour bars: a real MP4, so ffprobe has something true to
   *  say about the take that lands. */
  function fixtureMp4(cwd: string) {
    const path = join(cwd, "fixture.mp4");
    const made = Bun.spawnSync([
      "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=24:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
    ]);
    if (made.exitCode !== 0) throw new Error(`could not build the fixture MP4: ${made.stderr.toString()}`);
    return path;
  }

  const MIDFLIGHT = JSON.stringify([
    "check", "film/shots/lab-walk", "--id", "camera-smooth", "--status", "fail",
    "--note", "recorded while the take was in flight", "--now", T(30),
  ]);

  test.skipIf(!HAS_FFMPEG)("a check recorded while the take runs survives the take landing", () => {
    const cwd = workspace();
    ready(cwd);
    const env = generator(cwd, { FAKE_MIDFLIGHT: MIDFLIGHT, FAKE_TAKE_SOURCE: fixtureMp4(cwd) });

    const result = run(cwd, ["generate", SHOT, "--now", T(20)], env);
    expect(result.code).toBe(0);
    const landed = JSON.parse(result.out);
    expect(landed.take).toMatchObject({ id: "take-01", status: "done", requestId: "fake-request-01", file: "takes/take-01.mp4" });

    const shot = shotFile(cwd);
    const camera = shot.checks.find((check: any) => check.id === "camera-smooth" && check.target === "greybox");
    // THE regression: the mid-flight verdict is still the one on disk.
    expect(camera).toMatchObject({ status: "fail", note: "recorded while the take was in flight" });
    expect(camera.history.at(-1)).toMatchObject({ status: "pass" });
    // …and the take was written into that same document, not over it.
    expect(shot.takes).toHaveLength(1);
    expect(shot.takes[0]).toMatchObject({ id: "take-01", status: "done" });
    // The take's own checks are seeded against the shot as it now stands.
    expect(shot.checks.some((check: any) => check.target === "take-01")).toBe(true);
    // A 64x64 fixture is not 480p, and the record says what the probe saw.
    expect(shot.takes[0].probe).toMatchObject({ width: 64, height: 64 });
    expect(shot.takes[0].note).toContain("fal delivered 64x64");
  });

  test("a check recorded while the take runs survives the take FAILING", () => {
    const cwd = workspace();
    ready(cwd);
    const env = generator(cwd, { FAKE_MIDFLIGHT: MIDFLIGHT, FAKE_THROW: "fal said no" });

    const result = run(cwd, ["generate", SHOT, "--now", T(20)], env);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({ ok: false, take: { id: "take-01", status: "failed" } });
    expect(result.err).toContain("fal said no");

    const shot = shotFile(cwd);
    expect(shot.checks.find((check: any) => check.id === "camera-smooth" && check.target === "greybox")).toMatchObject({
      status: "fail",
      note: "recorded while the take was in flight",
    });
    expect(shot.takes).toMatchObject([{ id: "take-01", status: "failed", note: "fal said no" }]);
  });

  test("a take whose record vanished mid-flight is reported, never silently re-appended", () => {
    const cwd = workspace();
    ready(cwd);
    const shotJson = join(cwd, "film", "shots", "lab-walk", "shot.json");
    const env = generator(cwd, { FAKE_DROP_TAKES: shotJson, FAKE_THROW: "fal said no" });

    const result = run(cwd, ["generate", SHOT, "--now", T(20)], env);
    expect(result.code).toBe(1);
    const reported = JSON.parse(result.out);
    expect(reported.ok).toBe(false);
    expect(reported.error).toContain("no longer in shot.json");
    expect(reported.take).toMatchObject({ id: "take-01", status: "failed", cost: { estimate: true } });
    expect(reported.orphanFile).toBe("takes/take-01.orphan.json");
    expect(result.err).toContain("NOT in shot.json");
    // The document this process no longer understands was left alone, and the
    // record of a job that may have been billed is on disk anyway.
    expect(shotFile(cwd).takes).toEqual([]);
    expect(JSON.parse(readFileSync(join(cwd, "film", "shots", "lab-walk", "takes", "take-01.orphan.json"), "utf-8")))
      .toMatchObject({ id: "take-01", status: "failed" });
  });

  test("the injected generator announces itself — a fake take is never mistaken for a real one", () => {
    const cwd = workspace();
    ready(cwd);
    const env = generator(cwd, { FAKE_THROW: "fal said no" });
    expect(run(cwd, ["generate", SHOT, "--now", T(20)], env).err).toContain("PREVIZ_SEEDANCE_MODULE is set");
  });
});

describe("a take nobody can look at is refused by name", () => {
  /** Every command that names a take refuses an unknown one with the list of
   *  recorded ids, and a take that is not `done` with the status it is in —
   *  before any ffmpeg work starts. */
  function withTakes(cwd: string) {
    scaffold(cwd);
    fakeRender(cwd, { revision: 1, final: true });
    const path = join(cwd, "film", "shots", "lab-walk", "shot.json");
    const shot = JSON.parse(readFileSync(path, "utf-8"));
    shot.takes = [
      { id: "take-01", status: "failed", file: null },
      { id: "take-02", status: "submitted", file: null },
    ];
    writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);
  }

  test("sheet, compare, select and check all name the takes that do exist", () => {
    const cwd = workspace();
    withTakes(cwd);
    const unknown = /unknown lane "take-09".*take-01, take-02/s;

    expect(run(cwd, ["sheet", "film/shots/lab-walk", "--lane", "take-09"]).err).toMatch(unknown);
    expect(run(cwd, ["compare", "film/shots/lab-walk", "--a", "greybox", "--b", "take-09"]).err).toMatch(unknown);
    expect(run(cwd, ["select", "film/shots/lab-walk", "take-09"]).err).toContain('no take "take-09" on this shot (take-01, take-02)');
    expect(run(cwd, ["check", "film/shots/lab-walk", "--id", "take-motion", "--status", "pass", "--target", "take-09"]).err)
      .toContain('--target "take-09" is neither "greybox" nor a recorded take (take-01, take-02)');
  });

  test("a take that is not done carries its status into every refusal", () => {
    const cwd = workspace();
    withTakes(cwd);
    expect(run(cwd, ["sheet", "film/shots/lab-walk", "--lane", "take-01"]).err).toContain('take-01 is "failed" and has no file to look at');
    expect(run(cwd, ["compare", "film/shots/lab-walk", "--a", "greybox", "--b", "take-02"]).err).toContain('take-02 is "submitted" and has no file to look at');
    expect(run(cwd, ["select", "film/shots/lab-walk", "take-02"]).err).toContain('take-02 is "submitted" — only a finished take can be the one this shot delivers');
    // Nothing was written by any of them.
    expect(shotFile(cwd).takes.map((take: any) => take.status)).toEqual(["failed", "submitted"]);
  });
});

describe("select", () => {
  test("marks the delivered take, and refuses one that is not done or that failed a check", () => {
    const cwd = workspace();
    scaffold(cwd);
    fakeRender(cwd, { revision: 1, final: true });
    const path = join(cwd, "film", "shots", "lab-walk", "shot.json");
    const shot = JSON.parse(readFileSync(path, "utf-8"));
    shot.takes = [
      { id: "take-01", status: "done", selected: false },
      { id: "take-02", status: "failed", selected: false },
    ];
    writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);

    expect(run(cwd, ["select", "film/shots/lab-walk", "take-09"]).err).toContain('no take "take-09"');
    expect(run(cwd, ["select", "film/shots/lab-walk", "take-02"]).err).toContain('is "failed"');

    json(cwd, ["check", "film/shots/lab-walk", "--target", "take-01", "--id", "take-motion", "--status", "fail", "--now", T(1)]);
    expect(run(cwd, ["select", "film/shots/lab-walk", "take-01"]).err).toContain("has failing checks (take-motion)");

    json(cwd, ["check", "film/shots/lab-walk", "--target", "take-01", "--id", "take-motion", "--status", "pass", "--now", T(2)]);
    const selected = json(cwd, ["select", "film/shots/lab-walk", "take-01"]);
    expect(selected.selected).toBe("take-01");
    expect(shotFile(cwd).takes[0].selected).toBe(true);
    expect(shotFile(cwd).takes[1].selected).toBe(false);
  });
});

describe("status", () => {
  test("reports a shot, with unverified counted apart from fail and next naming the open stage", () => {
    const cwd = workspace();
    scaffold(cwd);
    writeFileSync(join(cwd, "beats.json"), JSON.stringify(BEATS));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);
    fakeRender(cwd, { revision: 1 });
    json(cwd, ["check", "film/shots/lab-walk", "--id", "blocking", "--status", "pass", "--now", T(1)]);
    json(cwd, ["check", "film/shots/lab-walk", "--id", "pace", "--status", "fail", "--now", T(1)]);

    const status = json(cwd, ["status", "film/shots/lab-walk"]);
    expect(status.kind).toBe("shot");
    expect(status.spec).toEqual({ seconds: 8, fps: 24, width: 1280, height: 720, frames: 192 });
    expect(status.beats.count).toBe(4);
    expect(status.beats.byKind).toEqual({ hold: 1, action: 2, trigger: 1 });
    expect(status.greybox).toMatchObject({ revision: 1, finalIsCurrent: false });
    expect(status.greybox.files).toMatchObject({ script: true, preview: true, final: false });
    expect(status.checks.byTarget.greybox).toMatchObject({ pass: 1, fail: 1, unverified: 6, accepted: false });
    expect(status.next.stage).toBe("checks");
    expect(status.next.reason).toContain("pace");
    expect(status.costs).toMatchObject({ count: 0, total: 0, estimate: true });
    expect(status.prompt.ok).toBe(false);
  });

  test("reports a project, with a total cost labelled an estimate and the first open shot", () => {
    const cwd = workspace();
    scaffold(cwd);
    json(cwd, ["shot", "film", "second", "--title", "A second shot"]);
    const path = join(cwd, "film", "shots", "lab-walk", "shot.json");
    const shot = JSON.parse(readFileSync(path, "utf-8"));
    shot.takes = [{ id: "take-01", status: "done", cost: { usd: 2.1168, basis: "(8 s out + 8 s ref) x $0.1323/s at 480p" } }];
    writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);

    const status = json(cwd, ["status", "film"]);
    expect(status.kind).toBe("project");
    expect(status.title).toBe("First Light");
    expect(status.shots.map((entry: any) => entry.id)).toEqual(["lab-walk", "second"]);
    expect(status.costs).toMatchObject({ count: 1, estimate: true });
    expect(status.costs.total).toBeCloseTo(2.1168, 4);
    expect(status.next).toMatchObject({ shot: "lab-walk", stage: "plan" });
  });

  test("a directory that holds neither file is a named refusal, and status never writes", () => {
    const cwd = workspace();
    scaffold(cwd);
    expect(run(cwd, ["status", "."]).err).toContain("holds neither previz.json nor shot.json");
    const before = readFileSync(join(cwd, "film", "shots", "lab-walk", "shot.json"), "utf-8");
    json(cwd, ["status", "film/shots/lab-walk"]);
    expect(readFileSync(join(cwd, "film", "shots", "lab-walk", "shot.json"), "utf-8")).toBe(before);
  });
});

describe("the argv contract", () => {
  test("an unknown subcommand, a missing directory and --help are all explicit", () => {
    const cwd = workspace();
    expect(run(cwd, ["render-everything"]).code).toBe(1);
    expect(run(cwd, ["render-everything"]).err).toContain("unknown subcommand");
    expect(run(cwd, ["status"]).err).toContain("status needs a directory");
    const help = run(cwd, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("Usage: previz.mjs <subcommand>");
  });

  test("--json is accepted everywhere and changes nothing — stdout is already one object", () => {
    const cwd = workspace();
    scaffold(cwd);
    const plain = json(cwd, ["status", "film/shots/lab-walk"]);
    const flagged = json(cwd, ["status", "film/shots/lab-walk", "--json"]);
    expect(flagged).toEqual(plain);
  });
});
