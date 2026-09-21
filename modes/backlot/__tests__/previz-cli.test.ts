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
 *
 * The film around the shot is created with `backlot.mjs` (the only writer of
 * `backlot.json`), because that is how an agent gets a shot directory now —
 * and because the gate every paid shot command answers to lives there.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pngSize } from "../skill/scripts/media.mjs";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "previz.mjs");
const BACKLOT = join(import.meta.dir, "..", "skill", "scripts", "backlot.mjs");
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

function spawn(script: string, cwd: string, argv: string[], env?: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, script, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function run(cwd: string, argv: string[], env?: Record<string, string>) {
  return spawn(SCRIPT, cwd, argv, env);
}

function json(cwd: string, argv: string[], env?: Record<string, string>): Record<string, any> {
  const result = run(cwd, argv, env);
  if (result.code !== 0) throw new Error(`previz.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

function backlot(cwd: string, argv: string[], env?: Record<string, string>): Record<string, any> {
  const result = spawn(BACKLOT, cwd, argv, env);
  if (result.code !== 0) throw new Error(`backlot.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

const shotFile = (cwd: string, project = "film", id = "lab-walk") =>
  JSON.parse(readFileSync(join(cwd, project, "shots", id, "shot.json"), "utf-8"));

/**
 * A project with one shot, scaffolded exactly as an agent would — and with
 * the gates OPEN, so a test of the shot commands is not also a test of the
 * film's approvals. The gate itself is exercised where it belongs, below.
 */
function scaffold(cwd: string, extra: string[] = []) {
  backlot(cwd, ["init", "film", "--title", "First Light", "--logline", "A researcher wakes a device"]);
  backlot(cwd, ["gates", "film", "open"]);
  return backlot(cwd, ["shot", "add", "film", "lab-walk", "--title", "The researcher wakes the device", ...extra]);
}

/** Fake a render the way `render` records one, so the file-only commands
 *  downstream of it can be exercised without Blender. `video` puts a real
 *  clip there instead of a stand-in string, for the commands that decode it. */
function fakeRender(cwd: string, { revision = 1, final = false, id = "lab-walk", video = "" } = {}) {
  const path = join(cwd, "film", "shots", id, "shot.json");
  const shot = JSON.parse(readFileSync(path, "utf-8"));
  shot.greybox.revision = revision;
  const record = {
    file: final ? "greybox/greybox.mp4" : "greybox/preview.mp4",
    revision,
    scale: final ? 1 : 0.5,
    probe: video
      ? { codec: "h264", pixFmt: "yuv420p", width: 64, height: 64, fps: 24, frames: 24, seconds: 1, bytes: 1 }
      : { codec: "h264", pixFmt: "yuv420p", width: 1280, height: 720, fps: 24, frames: 192, seconds: 8, bytes: 1 },
    renderedAt: T(1),
    renderSeconds: 9.7,
  };
  if (final) shot.greybox.final = record;
  else shot.greybox.preview = record;
  writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);
  if (video) copyFileSync(video, join(cwd, "film", "shots", id, record.file));
  else writeFileSync(join(cwd, "film", "shots", id, record.file), "not really an mp4");
}

function writePrompt(cwd: string, body: string, id = "lab-walk") {
  const path = join(cwd, "film", "shots", id, "prompts.md");
  const markdown = readFileSync(path, "utf-8").replace(/```prompt\n[\s\S]*?\n```/, `\`\`\`prompt\n${body}\n\`\`\``);
  writeFileSync(path, markdown);
}

/**
 * A prompt that gives every attached reference a job.
 *
 * `generate` refuses a pack that leaves one unassigned — an unassigned
 * reference bleeds its own lighting and framing into the shot — so the packs
 * these tests write say what each one is for, exactly as the skeleton does.
 */
const GREYBOX_ONLY =
  "@Video1 = layout, positions, timing and the single camera move only; its grey shapes are placeholders, not the look. A research lab at night.";

const BEATS = [
  { id: "establish", label: "Doorway establishes", from: 0, to: 0.5, kind: "hold" },
  { id: "walk", label: "Walks to the console", from: 0.5, to: 3.8, kind: "action" },
  { id: "touch", label: "Raises a hand to the button", from: 4.5, to: 5.5, kind: "action" },
  { id: "glow", label: "Device brightens blue", from: 5.5, to: 7.5, kind: "trigger", causedBy: "touch" },
];

describe("the shot a film scaffolds", () => {
  test("shot.json carries the acceptance list and the shot's place in the film", () => {
    const cwd = workspace();
    backlot(cwd, ["init", "film", "--title", "First Light", "--logline", "A researcher wakes a device", "--seconds", "6", "--size", "854x480"]);
    const made = backlot(cwd, ["shot", "add", "film", "Lab Walk", "--title", "The researcher wakes the device"]);
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

    const shot = shotFile(cwd);
    expect(shot.checks).toHaveLength(8);
    expect(shot.checks.every((check: any) => check.status === "unverified")).toBe(true);
    expect(shot.assumptions[0]).toContain("project defaults");
    // The prompt pack is written in the syntax Seedance documents.
    expect(readFileSync(join(cwd, "film", "shots", "lab-walk", "prompts.md"), "utf-8")).toContain("@Video1");
  });

  test("a recreate shot asks for its reference first", () => {
    const cwd = workspace();
    backlot(cwd, ["init", "film", "--title", "First Light", "--logline", "x"]);
    const made = backlot(cwd, ["shot", "add", "film", "redo", "--title", "Recreate this", "--entry", "recreate"]);
    expect(made.next.stage).toBe("reference");
    expect(existsSync(join(cwd, "film", "shots", "redo", "reference"))).toBe(true);
  });
});

describe("meta", () => {
  test("records where the shot sits in the film, and clears a field on an empty value", () => {
    const cwd = workspace();
    scaffold(cwd);
    const set = json(cwd, ["meta", "film/shots/lab-walk", "--scene", "sc1", "--characters", "kai,clerk", "--set", "store"]);
    expect(set).toMatchObject({ scene: "sc1", characters: ["kai", "clerk"], set: "store" });
    expect(shotFile(cwd)).toMatchObject({ scene: "sc1", characters: ["kai", "clerk"], set: "store" });
    // The bible does not carry them yet — reported, never refused.
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--characters", "ghost"]).err).toContain('character "ghost" is not in');

    const cleared = json(cwd, ["meta", "film/shots/lab-walk", "--set", "", "--characters", ""]);
    expect(cleared.set).toBeNull();
    expect(cleared.characters).toEqual([]);
    expect(cleared.scene).toBe("sc1");
    expect(run(cwd, ["meta", "film/shots/lab-walk"]).err).toContain("at least one of");
  });

  test("--trim-in/--trim-out name the range the CUT uses, on the shot's own clock", () => {
    const cwd = workspace();
    scaffold(cwd);
    expect(shotFile(cwd).trim).toBeNull();

    const trimmed = json(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "0.4", "--trim-out", "1.6"]);
    expect(trimmed.trim).toEqual({ in: 0.4, out: 1.6 });
    expect(shotFile(cwd).trim).toEqual({ in: 0.4, out: 1.6 });
    // The shot's own clock is untouched: the greybox and the take are still
    // eight seconds of this shot, and only the film sees 1.2 of them.
    expect(shotFile(cwd).spec.seconds).toBe(8);
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "0.4", "--trim-out", "1.6"]).err).toContain("1.2 s of film");

    // One flag alone edits the range that is there.
    expect(json(cwd, ["meta", "film/shots/lab-walk", "--trim-out", "2"]).trim).toEqual({ in: 0.4, out: 2 });
    // …and on an untrimmed shot it starts from the whole shot.
    const other = workspace();
    scaffold(other);
    expect(json(other, ["meta", "film/shots/lab-walk", "--trim-out", "3"]).trim).toEqual({ in: 0, out: 3 });

    expect(json(cwd, ["meta", "film/shots/lab-walk", "--no-trim"]).trim).toBeNull();
    expect(shotFile(cwd).trim).toBeNull();
  });

  test("a range the shot does not have is refused, and the shot is left alone", () => {
    const cwd = workspace();
    scaffold(cwd);
    json(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "1", "--trim-out", "2"]);
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "1", "--trim-out", "99"]).err).toContain("past the shot's 8 s");
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "3", "--trim-out", "1"]).err).toContain("must be later than");
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--no-trim", "--trim-in", "1"]).err).toContain("--no-trim clears the trim");
    expect(shotFile(cwd).trim).toEqual({ in: 1, out: 2 });
  });

  test("a voice-over spoken outside the trim is warned about where it is set", () => {
    const cwd = workspace();
    scaffold(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", JSON.stringify([
      { id: "l1", speaker: "narrator", kind: "vo", text: "inside", at: 1.2 },
      { id: "l2", speaker: "narrator", kind: "vo", text: "outside", at: 6 },
    ])]);
    const result = run(cwd, ["meta", "film/shots/lab-walk", "--trim-in", "1", "--trim-out", "2"]);
    expect(result.code).toBe(0);
    expect(result.err).toContain('line "l2" lands at 6 s, outside the trim');
    expect(result.err).not.toContain('line "l1"');
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
function ready(cwd: string, { id = "lab-walk", scaffolded = false, video = "" } = {}) {
  if (!scaffolded) scaffold(cwd);
  writeFileSync(join(cwd, "beats.json"), JSON.stringify(BEATS));
  json(cwd, ["beats", `film/shots/${id}`, "--set", "beats.json"]);
  fakeRender(cwd, { revision: 1, final: true, id, video });
  for (const check of ["frame-count", "blocking", "pace", "penetration", "framing", "trigger-order", "camera-smooth", "end-hold"]) {
    json(cwd, ["check", `film/shots/${id}`, "--id", check, "--status", "pass", "--now", T(1)]);
  }
  writePrompt(cwd, GREYBOX_ONLY, id);
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
    expect(run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).err).toContain("never mentions @Video1");

    const cwd2 = workspace();
    scaffold(cwd2);
    fakeRender(cwd2, { revision: 1, final: true });
    // Untouched scaffold: the template must not satisfy its own gate.
    const untouched = run(cwd2, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(untouched.code).toBe(1);
    expect(untouched.err).toContain("scaffolded placeholder");
  });

  test("[Video1] still works and is warned about — Seedance documents @Video1", () => {
    const cwd = workspace();
    ready(cwd);
    writePrompt(cwd, "[Video1] = layout, positions and timing only. A research lab at night.");
    const estimate = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(estimate.code).toBe(0);
    expect(estimate.err).toContain("[Video1]");
    expect(estimate.err).toContain("@Video1");
  });

  test("refuses a prompt that addresses a reference the shot did not attach", () => {
    const cwd = workspace();
    ready(cwd);
    // Only the greybox is attached: there is no board, no sheet, no voice.
    writePrompt(cwd, "Follow @Video1, dress her as @Image1, in the voice of @Audio1.");
    const refused = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("addresses a reference this shot did not attach");
    expect(refused.err).toContain("@Image1");
    expect(refused.err).toContain("@Audio1");
    expect(refused.err).toContain("Attached: @Video1 shots/lab-walk/greybox/greybox.mp4");
  });

  test("the film's previz stage gates a paid take, even an estimate", () => {
    const cwd = workspace();
    ready(cwd);
    backlot(cwd, ["gates", "film", "closed"]);
    const refused = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('refusing to spend on "generate"');
    expect(refused.err).toContain('stage "previz"');
    expect(refused.err).toContain("backlot.mjs approve");
    expect(shotFile(cwd).takes).toEqual([]);

    // The creator approves the greybox; the gate opens.
    backlot(cwd, ["approve", "film", "previz"]);
    expect(json(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).wouldBe).toBe("take-01");
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

  test("an accepted greybox with no anchor asks for the picture before the video", () => {
    const cwd = workspace();
    ready(cwd);
    const status = json(cwd, ["status", "film/shots/lab-walk"]);
    expect(status.next.stage).toBe("anchor");
    expect(status.next.command).toContain("previz.mjs anchor");
    // …and the report carries the two new facts about where a shot sits.
    expect(status.anchors).toEqual([]);
    expect(status.continuity).toBeNull();
  });

  test("pointed at a film it says whose report that is — one owner per report", () => {
    const cwd = workspace();
    scaffold(cwd);
    const delegated = run(cwd, ["status", "film"]);
    expect(delegated.code).toBe(1);
    expect(delegated.err).toContain("is a film, not a shot");
    expect(delegated.err).toContain("backlot.mjs status");
  });

  test("a directory that holds neither file is a named refusal, and status never writes", () => {
    const cwd = workspace();
    scaffold(cwd);
    expect(run(cwd, ["status", "."]).err).toContain("holds neither backlot.json nor shot.json");
    const before = readFileSync(join(cwd, "film", "shots", "lab-walk", "shot.json"), "utf-8");
    json(cwd, ["status", "film/shots/lab-walk"]);
    expect(readFileSync(join(cwd, "film", "shots", "lab-walk", "shot.json"), "utf-8")).toBe(before);
  });
});

/**
 * The film-facing half of a shot: the board frame, the lines, the voice-over
 * and the references a take is conditioned on.
 *
 * The TTS vendor is injected through `BACKLOT_TTS_MODULE` and writes real
 * audio with ffmpeg, so the argv this script builds and the record it keeps
 * are the real ones and nothing is sent anywhere.
 */
const FAKE_TTS = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: {
  text: { type: "string" }, output: { type: "string" }, model: { type: "string" },
  voice: { type: "string" }, style: { type: "string" }, language: { type: "string" }, json: { type: "boolean" },
} });
writeFileSync(process.env.FAKE_TTS_ARGV, JSON.stringify(values) + "\\n", { flag: "a" });
const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=520:duration=2", "-ac", "2", "-ar", "48000", values.output], { encoding: "utf-8" });
if (made.status !== 0) { console.error(made.stderr); process.exit(1); }
console.log(JSON.stringify({ path: values.output, seconds: 2 }));
`;

/** A transcript that says whatever the test put in TRANSCRIPT_TEXT. */
const FAKE_TRANSCRIBE = `#!/usr/bin/env node
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { input: { type: "string" }, language: { type: "string" }, json: { type: "boolean" } } });
if (process.env.TRANSCRIBE_FAIL) { console.error("wizper said no"); process.exit(1); }
console.log(JSON.stringify({ text: process.env.TRANSCRIPT_TEXT ?? "", chunks: [] }));
`;

function ttsSeam(cwd: string) {
  const path = join(cwd, "fake-tts.mjs");
  writeFileSync(path, FAKE_TTS);
  return { BACKLOT_TTS_MODULE: path, FAKE_TTS_ARGV: join(cwd, "tts-argv.jsonl") };
}

function pngFixture(cwd: string, name = "frame.png", size = "64x64") {
  const path = join(cwd, name);
  const made = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=teal:s=${size}:d=1`, "-frames:v", "1", path]);
  if (made.exitCode !== 0) throw new Error(made.stderr.toString());
  return path;
}

describe("board", () => {
  test.skipIf(!HAS_FFMPEG)("registers the frame with the prompt it was made from, and bumps its revision", () => {
    const cwd = workspace();
    scaffold(cwd);
    const png = pngFixture(cwd);
    const registered = json(cwd, [
      "board", "film/shots/lab-walk", "--file", png, "--prompt", "the doorway, cold blue",
      "--refs", "film/bible/characters/kai/sheet.png", "--cost-usd", "0.13", "--cost-basis", "reported", "--now", T(1),
    ]);
    expect(registered.board).toMatchObject({
      file: "board.png",
      revision: 1,
      prompt: "the doorway, cold blue",
      at: Date.parse(T(1)),
      cost: { usd: 0.13, basis: "reported" },
    });
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "board.png"))).toBe(true);
    expect(shotFile(cwd).board.revision).toBe(1);
    expect(json(cwd, ["board", "film/shots/lab-walk", "--file", png, "--prompt", "warmer"]).board.revision).toBe(2);
  });

  test.skipIf(!HAS_FFMPEG)("waits for the bible, and refuses anything that is not a PNG", () => {
    const cwd = workspace();
    scaffold(cwd);
    backlot(cwd, ["gates", "film", "closed"]);
    const png = pngFixture(cwd);
    const refused = run(cwd, ["board", "film/shots/lab-walk", "--file", png, "--prompt", "x"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('stage "bible"');
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "board.png"))).toBe(false);

    backlot(cwd, ["gates", "film", "open"]);
    writeFileSync(join(cwd, "not.png"), "nope");
    expect(run(cwd, ["board", "film/shots/lab-walk", "--file", join(cwd, "not.png"), "--prompt", "x"]).err).toContain("not a readable PNG");
    expect(run(cwd, ["board", "film/shots/lab-walk", "--file", png]).err).toContain("--prompt");
  });
});

describe("lines and vo", () => {
  const LINES = JSON.stringify([
    { id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 5.2 },
    { id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点，这家店只有一个客人。", at: 0.8 },
  ]);

  test("loads the lines inline, and says which ones the model has to speak", () => {
    const cwd = workspace();
    scaffold(cwd);
    const loaded = json(cwd, ["lines", "film/shots/lab-walk", "--set", LINES]);
    expect(loaded.count).toBe(2);
    expect(loaded.spoken).toEqual(["l1"]);
    expect(shotFile(cwd).lines[1]).toMatchObject({ id: "l2", kind: "vo", at: 0.8, file: null });
    expect(run(cwd, ["lines", "film/shots/lab-walk", "--set", '[{"id":"l1","speaker":"kai","kind":"yelled","text":"hi"}]']).err)
      .toContain("kind must be one of spoken|vo");
    // A refusal leaves the list exactly as it was.
    expect(shotFile(cwd).lines).toHaveLength(2);
  });

  test.skipIf(!HAS_FFMPEG)("vo synthesizes one line, defaults to the speaker's recorded voice, and keeps the take's kind out of it", () => {
    const cwd = workspace();
    scaffold(cwd);
    const env = ttsSeam(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", LINES]);

    // A spoken line is the video model's job, whatever the agent asks for.
    const spoken = run(cwd, ["vo", "film/shots/lab-walk", "l1"], env);
    expect(spoken.code).toBe(1);
    expect(spoken.err).toContain("SPOKEN on screen");
    expect(run(cwd, ["vo", "film/shots/lab-walk", "l9"], env).err).toContain('no line "l9"');

    // The bible's voice for the speaker is the default.
    backlot(cwd, ["character", "add", "film", "narrator", "--name", "旁白"]);
    backlot(cwd, ["character", "voice", "film", "narrator", "--text", "sample", "--model", "seed-speech", "--voice", "vienna_mixed_en_zh"], env);
    const made = json(cwd, ["vo", "film/shots/lab-walk", "l2", "--cost-usd", "0.01", "--cost-basis", "table", "--now", T(2)], env);
    expect(made.file).toBe("sound/l2.mp3");
    expect(made.seconds).toBe(2);
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "sound", "l2.mp3"))).toBe(true);
    expect(made.line).toMatchObject({
      id: "l2",
      file: "sound/l2.mp3",
      seconds: 2,
      cost: { usd: 0.01, basis: "table" },
      voice: { model: "seed-speech", voiceId: "vienna_mixed_en_zh" },
      recordedAt: Date.parse(T(2)),
    });
    const calls = readFileSync(env.FAKE_TTS_ARGV, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.at(-1)).toMatchObject({ text: "凌晨三点，这家店只有一个客人。", voice: "vienna_mixed_en_zh", model: "seed-speech" });

    // Re-loading the same text keeps the recording; changing it drops the
    // file (the audio says something else) and keeps the cost.
    const same = json(cwd, ["lines", "film/shots/lab-walk", "--set", LINES]);
    expect(same.kept).toEqual(["l1", "l2"]);
    // Everything the recording carried travels with it — the voice it was
    // made in included, or the next cut cannot say who spoke.
    expect(shotFile(cwd).lines[1]).toMatchObject({
      file: "sound/l2.mp3",
      seconds: 2,
      voice: { voiceId: "vienna_mixed_en_zh" },
      recordedAt: Date.parse(T(2)),
    });
    const edited = run(cwd, ["lines", "film/shots/lab-walk", "--set", JSON.stringify([
      { id: "l2", speaker: "narrator", kind: "vo", text: "凌晨四点。", at: 0.8 },
    ])]);
    expect(edited.err).toContain("no longer says it");
    expect(shotFile(cwd).lines[0]).toMatchObject({ id: "l2", file: null, cost: { usd: 0.01 } });
  });

  test("vo waits for the takes to be approved", () => {
    const cwd = workspace();
    scaffold(cwd);
    const env = ttsSeam(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", LINES]);
    backlot(cwd, ["gates", "film", "closed"]);
    const refused = run(cwd, ["vo", "film/shots/lab-walk", "l2"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('stage "takes"');
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "sound", "l2.mp3"))).toBe(false);
  });
});

describe("the references a take carries", () => {
  /** A bible with a sheet, a voice and a set concept, and a shot that names
   *  them — everything `generate` gathers by itself. */
  function dressed(cwd: string, env: Record<string, string>) {
    ready(cwd);
    const png = pngFixture(cwd);
    backlot(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    backlot(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "sheet"]);
    backlot(cwd, ["character", "voice", "film", "kai", "--text", "还开着吗？", "--model", "seed-speech"], env);
    backlot(cwd, ["set", "add", "film", "store", "--name", "便利店"]);
    backlot(cwd, ["set", "look", "film", "store", "--file", png, "--prompt", "wide"]);
    json(cwd, ["board", "film/shots/lab-walk", "--file", png, "--prompt", "the doorway"]);
    json(cwd, ["meta", "film/shots/lab-walk", "--characters", "kai", "--set", "store"]);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", JSON.stringify([
      { id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 5.2 },
    ])]);
  }

  test.skipIf(!HAS_FFMPEG)("gathers greybox, board, sheets, set and voices in the order the prompt addresses them", () => {
    const cwd = workspace();
    const env = ttsSeam(cwd);
    dressed(cwd, env);
    writePrompt(cwd, [
      "@Video1 = layout, positions and timing only.",
      "@Image1 = the composition of the opening frame.",
      "@Image2 = his appearance only.",
      "@Image3 = the store's appearance only.",
      "@Audio1 = his voice.",
    ].join("\n"));

    const estimate = json(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env);
    // Every reference says what it is FOR: the role is what the skeleton
    // writes its assignment sentence from, and what a viewer labels.
    expect(estimate.refs).toEqual([
      { kind: "video", index: 1, file: "shots/lab-walk/greybox/greybox.mp4", role: "greybox" },
      { kind: "image", index: 1, file: "shots/lab-walk/board.png", role: "board" },
      { kind: "image", index: 2, file: "bible/characters/kai/sheet.png", role: "character:kai" },
      { kind: "image", index: 3, file: "bible/sets/store/concept.png", role: "set:store" },
      { kind: "audio", index: 1, file: "bible/characters/kai/voice.mp3", role: "voice:kai" },
    ]);
    // A line spoken on screen turns the take's audio on by itself.
    expect(estimate.audio).toBe(true);
    // The table prices the output and the video reference. It says nothing
    // about stills, voice samples or generated audio, and the estimate says
    // so rather than inventing a number for them.
    expect(estimate.priceNote).toContain("the table does not price");
    expect(estimate.warnings.join(" ")).toContain("not a bill");
    expect(estimate.cost.basis).toContain("$0.1323/s at 480p");
  });

  test.skipIf(!HAS_FFMPEG)("a character with no sheet is reported, and the indices close up behind it", () => {
    const cwd = workspace();
    const env = ttsSeam(cwd);
    ready(cwd);
    backlot(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    json(cwd, ["meta", "film/shots/lab-walk", "--characters", "kai", "--set", "store"]);
    writePrompt(cwd, GREYBOX_ONLY);

    const estimate = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env);
    expect(estimate.code).toBe(0);
    expect(estimate.err).toContain('character "kai" has no sheet in the bible');
    expect(estimate.err).toContain('set "store" has no concept frame');
    expect(JSON.parse(estimate.out).refs).toEqual([
      { kind: "video", index: 1, file: "shots/lab-walk/greybox/greybox.mp4", role: "greybox" },
    ]);
  });

  test.skipIf(!HAS_FFMPEG)("a reference that is attached and never given a job is refused, by index", () => {
    const cwd = workspace();
    const env = ttsSeam(cwd);
    dressed(cwd, env);
    // Names every index, assigns only the first: the rest would still be sent
    // and would still bleed their lighting and framing into the shot.
    writePrompt(cwd, "@Video1 = layout and timing only. Then @Image1, @Image2, @Image3 and @Audio1 are in it somewhere.");

    const refused = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("leaves an attached reference unassigned");
    expect(refused.err).toContain("@Image1, @Image2, @Image3, @Audio1");
    expect(refused.err).toContain("prompt-skeleton");
    // Nothing was recorded by the refusal.
    expect(shotFile(cwd).takes).toEqual([]);

    // `=`, `:` and `is` all assign.
    writePrompt(cwd, [
      "@Video1 = layout and timing only.",
      "@Image1: the composition of the opening frame.",
      "@Image2 is his appearance only.",
      "@Image3 — the store's appearance only.",
      "@Audio1 = his voice.",
    ].join("\n"));
    expect(json(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env).wouldBe).toBe("take-01");
  });

  test("a timeline that disagrees with the clock is WARNED about, never refused", () => {
    const cwd = workspace();
    ready(cwd);
    writePrompt(cwd, [
      GREYBOX_ONLY,
      "Seconds 0.0–0.5: he stops in the doorway.",
      "Seconds 5.5–9.0: the device brightens.",
      "Seconds 1.0–2.0: he walks.",
    ].join("\n"));

    const estimate = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(estimate.code).toBe(0);
    expect(estimate.err).toContain("runs past the shot's 8 s");
    expect(estimate.err).toContain("the timeline goes backwards");
    const parsed = JSON.parse(estimate.out);
    expect(parsed.timeline).toEqual([
      { from: 0, to: 0.5 },
      { from: 5.5, to: 9 },
      { from: 1, to: 2 },
    ]);
    expect(parsed.warnings.join(" ")).toContain("runs past the shot's 8 s");
  });
});

/**
 * The shape of the pack that came back wrong.
 *
 * The second acceptance run's packs were structurally right and starved: a
 * word budget copied out of a text-to-video guide made the agent delete the
 * designed beats down to clauses. None of this is a refusal — the mode owns
 * what a take is conditioned on, not how a sentence is phrased — but none of
 * it is silent either.
 */
describe("what a finished pack is warned about", () => {
  const DETAILS = {
    establish: "the doorway holds, rain on the glass behind him, nothing moves but the drip off his coat",
    walk: "four heavy steps across the wet floor, the coat dripping, his eyes fixed on the console the whole way",
    touch: "his right hand rises slowly and settles flat on the pedestal, the knuckles whitening as he presses",
    glow: "the camera pushes in slowly from knee height and settles on the pedestal, both hands in frame",
  };

  /** A shot whose beats carry a designed picture, so a pack can be caught
   *  having thrown one away. */
  function designed(cwd: string) {
    scaffold(cwd);
    writeFileSync(join(cwd, "beats.json"), JSON.stringify([
      { ...BEATS[0], detail: DETAILS.establish },
      { ...BEATS[1], detail: DETAILS.walk },
      { ...BEATS[2], detail: DETAILS.touch },
      { ...BEATS[3], kind: "camera", causedBy: undefined, detail: DETAILS.glow },
    ]));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);
    fakeRender(cwd, { revision: 1, final: true });
    for (const check of ["frame-count", "blocking", "pace", "penetration", "framing", "trigger-order", "camera-smooth", "end-hold"]) {
      json(cwd, ["check", "film/shots/lab-walk", "--id", check, "--status", "pass", "--now", T(1)]);
    }
  }

  test("a starved pack is named fault by fault — and the skeleton's own is not", () => {
    const cwd = workspace();
    designed(cwd);
    // What the second acceptance run produced: every beat cut to a clause, a
    // hole in the clock, two camera moves in one segment, no locks, and an
    // @Video1 line that says what to take and not what to leave.
    writePrompt(cwd, [
      "@Video1: layout and timing.",
      "0.0–0.5s: wide, he stops in the doorway.",
      "1.0–4.0s: medium, he walks; the camera pushes in and orbits half a turn.",
      "4.0–6.0s: close, he presses the button.",
    ].join("\n"));

    const starved = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(starved.code).toBe(0);
    const warnings = (JSON.parse(starved.out).warnings as string[]).join("\n");
    expect(warnings).toContain("the timeline leaves 0.5–1 s undirected");
    expect(warnings).toContain("the timeline stops at 6 s but the clip is 8 s");
    expect(warnings).toContain("names more than one camera move");
    expect(warnings).toContain('beat "walk" was designed as');
    expect(warnings).toContain("a shortened detail is design deleted");
    expect(warnings).toContain('the camera beat "glow" was designed as');
    expect(warnings).toContain("no 【全局锁】 / 【Locks】 block");
    expect(warnings).toContain("says what to take from the greybox but not what to leave");
    // …and every warning is on stderr too, where the agent reads them.
    expect(starved.err).toContain("design deleted");

    // The same shot, with the design carried forward: not one of those fires.
    writePrompt(cwd, [
      "@Video1: use only the camera move and the paths; do not inherit the grey surfacing or the empty set.",
      `0.0–0.5s: wide, the door in frame left; ${DETAILS.establish}.`,
      `0.5–4.5s: medium; ${DETAILS.walk}.`,
      `4.5–8.0s: close on the pedestal; ${DETAILS.touch}.`,
      `Camera: one continuous take — ${DETAILS.glow}.`,
      "【Locks】 add no object and remove none; no on-screen text, no music.",
    ].join("\n"));
    const carried = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(carried.code).toBe(0);
    expect(JSON.parse(carried.out).warnings).toEqual([]);
  });

  test("a pack whose timeline overlaps itself says where", () => {
    const cwd = workspace();
    designed(cwd);
    writePrompt(cwd, [
      "@Video1: use only the paths and the timing; do not inherit the grey surfacing.",
      `0.0–4.0s: wide; ${DETAILS.establish}; ${DETAILS.walk}.`,
      `3.0–8.0s: close; ${DETAILS.touch}.`,
      `Camera: one continuous take — ${DETAILS.glow}.`,
      "【Locks】 nothing added, nothing removed.",
    ].join("\n"));

    const warnings = (JSON.parse(run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]).out).warnings as string[]).join("\n");
    expect(warnings).toContain("the timeline overlaps at");
    expect(warnings).toContain("the line before it runs to 4 s");
    expect(warnings).not.toContain("design deleted");
  });

  test("a Chinese pack assigns its references with a full-width colon", () => {
    const cwd = workspace();
    designed(cwd);
    // `@Image1：…` is the same assignment as `@Image1: …`; reading only the
    // ASCII colon would refuse every pack written for a Chinese film.
    writePrompt(cwd, [
      "@Video1：只参考运镜、主体轨迹与时机；不要继承灰白材质与空场景。",
      `0.0–8.0秒：中景，门在画左；${DETAILS.establish}；${DETAILS.walk}；${DETAILS.touch}。`,
      `运镜总原则：一镜到底——${DETAILS.glow}。`,
      "【全局锁】不新增不删除物体，不保留白模质感。禁止：字幕、自带 BGM。",
    ].join("\n"));

    const estimate = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"]);
    expect(estimate.code).toBe(0);
    expect(JSON.parse(estimate.out).warnings).toEqual([]);
  });
});

describe("take-lines", () => {
  const SPOKEN = JSON.stringify([{ id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 1 }]);

  /** The whole landing path: the injected generator writes the clip, then
   *  the injected transcriber says what it heard. */
  function generator(cwd: string, extra: Record<string, string>) {
    const seedance = join(cwd, "fake-seedance.mjs");
    writeFileSync(seedance, FAKE_SEEDANCE);
    const transcribe = join(cwd, "fake-transcribe.mjs");
    writeFileSync(transcribe, FAKE_TRANSCRIBE);
    return {
      FAL_KEY: "test-key-never-sent",
      PREVIZ_SEEDANCE_MODULE: seedance,
      BACKLOT_TRANSCRIBE_MODULE: transcribe,
      FAKE_PREVIZ: SCRIPT,
      FAKE_CWD: cwd,
      ...extra,
    };
  }

  function clip(cwd: string) {
    const path = join(cwd, "fixture.mp4");
    const made = Bun.spawnSync([
      "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=24:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
    ]);
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    return path;
  }

  test.skipIf(!HAS_FFMPEG)("passes only when every spoken line is in the transcript, and keeps the transcript as evidence", () => {
    const cwd = workspace();
    ready(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", SPOKEN]);
    const env = generator(cwd, { FAKE_TAKE_SOURCE: clip(cwd), TRANSCRIPT_TEXT: "还开着吗… 我找个东西。" });

    const landed = json(cwd, ["generate", "film/shots/lab-walk", "--now", T(20)], env);
    expect(landed.take.status).toBe("done");
    expect(landed.lines).toMatchObject({ status: "pass", transcript: "takes/take-01.transcript.json" });
    const shot = shotFile(cwd);
    const check = shot.checks.find((entry: any) => entry.id === "take-lines" && entry.target === "take-01");
    expect(check).toMatchObject({ status: "pass", label: "Spoken lines are audible and correct" });
    const transcript = JSON.parse(readFileSync(join(cwd, "film", "shots", "lab-walk", "takes", "take-01.transcript.json"), "utf-8"));
    expect(transcript).toMatchObject({ take: "take-01", text: "还开着吗… 我找个东西。" });
    // The take was generated WITH audio, because a line is spoken in it.
    expect(shot.takes[0].audio).toBe(true);
  });

  test.skipIf(!HAS_FFMPEG)("a take that never said the line FAILS, with the line and the transcript in the note", () => {
    const cwd = workspace();
    ready(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", SPOKEN]);
    const env = generator(cwd, { FAKE_TAKE_SOURCE: clip(cwd), TRANSCRIPT_TEXT: "我们打烊了。" });

    const landed = json(cwd, ["generate", "film/shots/lab-walk", "--now", T(20)], env);
    expect(landed.lines.status).toBe("fail");
    const check = shotFile(cwd).checks.find((entry: any) => entry.id === "take-lines" && entry.target === "take-01");
    expect(check.status).toBe("fail");
    expect(check.note).toContain("还开着吗？");
    expect(check.note).toContain("我们打烊了。");
    // A failing take-lines is a failing take: select refuses it.
    expect(run(cwd, ["select", "film/shots/lab-walk", "take-01"]).err).toContain("take-lines");
  });

  test.skipIf(!HAS_FFMPEG)("a transcription that failed leaves the check UNVERIFIED — never a silent pass", () => {
    const cwd = workspace();
    ready(cwd);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", SPOKEN]);
    const env = generator(cwd, { FAKE_TAKE_SOURCE: clip(cwd), TRANSCRIBE_FAIL: "1" });

    const landed = json(cwd, ["generate", "film/shots/lab-walk", "--now", T(20)], env);
    expect(landed.take.status).toBe("done");
    expect(landed.lines.status).toBe("unverified");
    const check = shotFile(cwd).checks.find((entry: any) => entry.id === "take-lines" && entry.target === "take-01");
    expect(check.status).toBe("unverified");
    expect(check.note).toContain("transcription failed");
  });

  test.skipIf(!HAS_FFMPEG)("a silent shot never grows the check at all", () => {
    const cwd = workspace();
    ready(cwd);
    const env = generator(cwd, { FAKE_TAKE_SOURCE: clip(cwd) });
    const landed = json(cwd, ["generate", "film/shots/lab-walk", "--now", T(20)], env);
    expect(landed.lines).toBeNull();
    expect(shotFile(cwd).checks.some((entry: any) => entry.id === "take-lines")).toBe(false);
  });
});

/**
 * Continuity — the opt-in hand-off.
 *
 * Every take in the first acceptance run was generated alone, so the body
 * action a model invents in shot N ended in a pose shot N+1 never saw. A
 * shot may now say it continues an earlier one; then the frame that shot
 * actually delivers to the film is cut out and handed to the model as the
 * last image reference. A shot that says nothing is generated exactly as
 * before — some cuts exist to BREAK continuity.
 */
const FAKE_IMAGE = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  "output-dir": { type: "string" }, "filename-prefix": { type: "string" }, "output-format": { type: "string" },
  "aspect-ratio": { type: "string" }, quality: { type: "string" }, "image-urls": { type: "string", multiple: true },
} });
writeFileSync(process.env.FAKE_IMAGE_ARGV, JSON.stringify({ prompt: positionals[0], ...values }) + "\\n", { flag: "a" });
mkdirSync(values["output-dir"], { recursive: true });
const out = join(values["output-dir"], values["filename-prefix"] + "." + (values["output-format"] ?? "png"));
const made = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=orange:s=96x54:d=1", "-frames:v", "1", out], { encoding: "utf-8" });
if (made.status !== 0) { console.error(made.stderr); process.exit(1); }
console.log(JSON.stringify({ backend: "openrouter", model: "openai/gpt-image-2.5-sunburst", files: [out], usage: { cost: 0.1904 } }));
`;

function imageSeam(cwd: string) {
  const path = join(cwd, "fake-image.mjs");
  writeFileSync(path, FAKE_IMAGE);
  return { BACKLOT_IMAGE_MODULE: path, FAKE_IMAGE_ARGV: join(cwd, "image-argv.jsonl") };
}

function seedanceSeam(cwd: string, extra: Record<string, string> = {}) {
  const path = join(cwd, "fake-seedance.mjs");
  writeFileSync(path, FAKE_SEEDANCE);
  return { FAL_KEY: "test-key-never-sent", PREVIZ_SEEDANCE_MODULE: path, FAKE_PREVIZ: SCRIPT, FAKE_CWD: cwd, ...extra };
}

/** One second of colour bars at 24 fps: 24 real frames to cut a hand-off
 *  out of, and something ffprobe can tell the truth about. */
function mp4Fixture(cwd: string, name = "fixture.mp4") {
  const path = join(cwd, name);
  const made = Bun.spawnSync([
    "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=24:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ]);
  if (made.exitCode !== 0) throw new Error(made.stderr.toString());
  return path;
}

/** A film with two shots, in order: the second one can continue the first. */
function twoShots(cwd: string) {
  scaffold(cwd);
  return backlot(cwd, ["shot", "add", "film", "counter", "--title", "The clerk looks up"]);
}

/** Give a shot a selected, finished take with a real clip behind it — the
 *  state a hand-off reads. */
function deliver(cwd: string, id: string, clip: string) {
  const path = join(cwd, "film", "shots", id, "shot.json");
  const shot = JSON.parse(readFileSync(path, "utf-8"));
  shot.takes = [{
    id: "take-01",
    status: "done",
    file: "takes/take-01.mp4",
    selected: true,
    probe: { codec: "h264", pixFmt: "yuv420p", width: 64, height: 64, fps: 24, frames: 24, seconds: 1, bytes: 1 },
  }];
  writeFileSync(path, `${JSON.stringify(shot, null, 2)}\n`);
  mkdirSync(join(cwd, "film", "shots", id, "takes"), { recursive: true });
  copyFileSync(clip, join(cwd, "film", "shots", id, "takes", "take-01.mp4"));
}

const CONTINUES = [
  "@Video1 = layout, positions and timing only.",
  "@Image1 = the last frame of the previous shot (lab-walk): this shot opens exactly here.",
  "Mid-stride, weight on the front foot.",
].join("\n");

describe("meta --continues-from", () => {
  test("records the hand-off, and refuses one the film cannot have", () => {
    const cwd = workspace();
    twoShots(cwd);
    const set = json(cwd, ["meta", "film/shots/counter", "--continues-from", "lab-walk",
      "--entry", "mid-stride through the door, facing screen right",
      "--exit", "hand flat on the counter, eyes up"]);
    expect(set.continuity).toEqual({
      from: "lab-walk",
      entry: "mid-stride through the door, facing screen right",
      exit: "hand flat on the counter, eyes up",
    });
    expect(shotFile(cwd, "film", "counter").continuity.from).toBe("lab-walk");

    // A shot continues an EARLIER one — never itself, never one after it.
    expect(run(cwd, ["meta", "film/shots/counter", "--continues-from", "counter", "--entry", "a", "--exit", "b"]).err)
      .toContain("this shot itself");
    expect(run(cwd, ["meta", "film/shots/lab-walk", "--continues-from", "counter", "--entry", "a", "--exit", "b"]).err)
      .toContain('comes AFTER "lab-walk"');
    expect(run(cwd, ["meta", "film/shots/counter", "--continues-from", "ghost", "--entry", "a", "--exit", "b"]).err)
      .toContain("not a shot in this film");
    // Both ends are owed — and a shot that already has them keeps them.
    const fresh = workspace();
    twoShots(fresh);
    expect(run(fresh, ["meta", "film/shots/counter", "--continues-from", "lab-walk", "--exit", "b"]).err).toContain("--entry");
    expect(run(fresh, ["meta", "film/shots/counter", "--continues-from", "lab-walk", "--entry", "a"]).err).toContain("--exit");
    expect(shotFile(fresh, "film", "counter").continuity).toBeNull();
    // A refusal leaves the record exactly as it was.
    expect(shotFile(cwd, "film", "counter").continuity.entry).toBe("mid-stride through the door, facing screen right");
    expect(shotFile(cwd).continuity).toBeNull();
  });

  test("an exit alone is allowed on any shot, and --no-continuity drops the block", () => {
    const cwd = workspace();
    twoShots(cwd);
    // A shot that continues nothing may still say how it ends, for a later
    // shot to pick up.
    const ends = json(cwd, ["meta", "film/shots/lab-walk", "--exit", "blades in contact, both weight forward"]);
    expect(ends.continuity).toEqual({ from: null, entry: null, exit: "blades in contact, both weight forward" });

    json(cwd, ["meta", "film/shots/counter", "--continues-from", "lab-walk", "--entry", "a", "--exit", "b"]);
    const cleared = json(cwd, ["meta", "film/shots/counter", "--no-continuity"]);
    expect(cleared.continuity).toBeNull();
    expect(shotFile(cwd, "film", "counter").continuity).toBeNull();

    expect(run(cwd, ["meta", "film/shots/counter", "--no-continuity", "--continues-from", "lab-walk"]).err)
      .toContain("--no-continuity drops the hand-off");
    expect(run(cwd, ["meta", "film/shots/counter", "--continues-from", ""]).err).toContain("--no-continuity");
    // An entry with nothing to continue is a frame with no predecessor.
    expect(run(cwd, ["meta", "film/shots/counter", "--entry", "mid-lunge"]).err).toContain("--continues-from");
  });
});

describe("the hand-off a take is generated with", () => {
  /** The continuing shot, ready to generate, with a prompt that gives the
   *  hand-off frame its job. */
  function continuing(cwd: string) {
    twoShots(cwd);
    ready(cwd, { id: "counter", scaffolded: true });
    json(cwd, ["meta", "film/shots/counter", "--continues-from", "lab-walk",
      "--entry", "mid-stride, weight on the front foot", "--exit", "hand flat on the counter"]);
    writePrompt(cwd, CONTINUES, "counter");
  }

  test.skipIf(!HAS_FFMPEG)("refuses while the shot it continues has no selected take, and names both ways out", () => {
    const cwd = workspace();
    continuing(cwd);
    const refused = run(cwd, ["generate", "film/shots/counter", "--estimate"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('"lab-walk" has no selected take');
    // The fix is a command that can be pasted: an absolute directory, not a
    // project-relative one the agent would have to re-root.
    expect(refused.err).toContain(`previz.mjs select ${join(cwd, "film", "shots", "lab-walk")}`);
    expect(refused.err).toContain("--no-handoff");
    expect(existsSync(join(cwd, "film", "shots", "counter", "takes", "handoff-in.png"))).toBe(false);

    // --no-handoff is the override, and it says so out loud.
    const skipped = run(cwd, ["generate", "film/shots/counter", "--estimate", "--no-handoff"]);
    expect(skipped.code).toBe(1); // the prompt still addresses @Image1, which is now attached to nothing
    expect(skipped.err).toContain("generated WITHOUT that frame");
    expect(skipped.err).toContain("@Image1");
  });

  test.skipIf(!HAS_FFMPEG)("cuts the previous shot's last USED frame and attaches it last", () => {
    const cwd = workspace();
    continuing(cwd);
    const clip = mp4Fixture(cwd);
    deliver(cwd, "lab-walk", clip);
    // The film only shows the first half second of lab-walk, so the frame
    // this shot opens on is that frame — not the one lab-walk rendered last.
    json(cwd, ["meta", "film/shots/lab-walk", "--trim-out", "0.5"]);

    const estimate = json(cwd, ["generate", "film/shots/counter", "--estimate"]);
    expect(estimate.handoff).toMatchObject({
      from: "lab-walk",
      take: "take-01",
      source: "shots/lab-walk/takes/take-01.mp4",
      frame: 12,
      file: "takes/handoff-in.png",
      trimmed: { in: 0, out: 0.5 },
    });
    const frame = join(cwd, "film", "shots", "counter", "takes", "handoff-in.png");
    expect(existsSync(frame)).toBe(true);
    // Cut at the clip's own resolution: this is a reference for a paid job,
    // not a contact sheet.
    expect(pngSize(readFileSync(frame))).toEqual({ width: 64, height: 64 });
    expect(estimate.refs).toEqual([
      { kind: "video", index: 1, file: "shots/counter/greybox/greybox.mp4", role: "greybox" },
      { kind: "image", index: 1, file: "shots/counter/takes/handoff-in.png", role: "handoff" },
    ]);
    // An untrimmed previous shot hands over its last frame instead.
    json(cwd, ["meta", "film/shots/lab-walk", "--no-trim"]);
    expect(json(cwd, ["generate", "film/shots/counter", "--estimate"]).handoff).toMatchObject({ frame: 24, trimmed: null });
  });

  test.skipIf(!HAS_FFMPEG)("the take records what it was shown, and carries take-handoff", () => {
    const cwd = workspace();
    continuing(cwd);
    const clip = mp4Fixture(cwd);
    deliver(cwd, "lab-walk", clip);
    const env = seedanceSeam(cwd, { FAKE_TAKE_SOURCE: clip });

    const landed = json(cwd, ["generate", "film/shots/counter", "--now", T(20)], env);
    expect(landed.take.status).toBe("done");
    expect(landed.take.refs.at(-1)).toMatchObject({ kind: "image", role: "handoff", file: "shots/counter/takes/handoff-in.png" });
    expect(landed.take.handoff).toMatchObject({ from: "lab-walk", take: "take-01", frame: 24 });

    const shot = shotFile(cwd, "film", "counter");
    const check = shot.checks.find((entry: any) => entry.id === "take-handoff" && entry.target === "take-01");
    expect(check).toMatchObject({
      status: "unverified",
      label: "First frame continues the previous shot's last used frame — positions, facing, weapons, action",
    });
    // …and a shot that continues nothing never grows that check.
    const alone = workspace();
    ready(alone);
    json(alone, ["generate", "film/shots/lab-walk", "--now", T(20)], seedanceSeam(alone, { FAKE_TAKE_SOURCE: mp4Fixture(alone) }));
    expect(shotFile(alone).checks.some((entry: any) => entry.id === "take-handoff")).toBe(false);
  });

  test.skipIf(!HAS_FFMPEG)("--no-handoff records 'skipped' on the take, and the shot still asks the question", () => {
    const cwd = workspace();
    continuing(cwd);
    const clip = mp4Fixture(cwd);
    deliver(cwd, "lab-walk", clip);
    // The pack must not address a reference that is no longer attached.
    writePrompt(cwd, "@Video1 = layout, positions and timing only. A convenience store at 3 a.m.", "counter");
    const env = seedanceSeam(cwd, { FAKE_TAKE_SOURCE: clip });

    const landed = run(cwd, ["generate", "film/shots/counter", "--no-handoff", "--now", T(20)], env);
    expect(landed.code).toBe(0);
    expect(landed.err).toContain("generated WITHOUT that frame");
    const take = JSON.parse(landed.out).take;
    expect(take.handoff).toBe("skipped");
    expect(take.refs).toEqual([{ kind: "video", index: 1, file: "shots/counter/greybox/greybox.mp4", role: "greybox" }]);
    expect(existsSync(join(cwd, "film", "shots", "counter", "takes", "handoff-in.png"))).toBe(false);
    // The shot still says it continues something, so the check is still asked.
    expect(shotFile(cwd, "film", "counter").checks.some((entry: any) => entry.id === "take-handoff")).toBe(true);
  });

  test.skipIf(!HAS_FFMPEG)("compare --handoff draws the joint: out-frame | in-frame", () => {
    const cwd = workspace();
    continuing(cwd);
    const clip = mp4Fixture(cwd);
    deliver(cwd, "lab-walk", clip);
    const env = seedanceSeam(cwd, { FAKE_TAKE_SOURCE: clip });
    json(cwd, ["generate", "film/shots/counter", "--now", T(20)], env);

    const pair = json(cwd, ["compare", "film/shots/counter", "--handoff"]);
    expect(pair).toMatchObject({ mode: "handoff", take: "take-01", from: "lab-walk" });
    expect(pair.file).toBe("takes/qa/take-01/handoff.png");
    expect(pair.in).toMatchObject({ frame: 1, at: 0 });
    expect(pair.entry).toBe("mid-stride, weight on the front foot");
    const drawn = join(cwd, "film", "shots", "counter", "takes", "qa", "take-01", "handoff.png");
    expect(existsSync(drawn)).toBe(true);
    // Two frames of the same size, side by side.
    expect(pngSize(readFileSync(drawn))).toEqual({ width: pair.tile.width * 2, height: pair.tile.height });

    // The left frame is cut from what the TAKE recorded — the shot, the take
    // and the frame number — not read back from takes/handoff-in.png, which
    // is one path per shot and which the next take overwrites. Replacing it
    // with something else must not change what take-01 is judged against.
    expect(pair.out).toMatchObject({ file: "takes/qa/take-01/handoff-out.png", frame: 24, recorded: true });
    copyFileSync(pngFixture(cwd, "other.png", "96x54"), join(cwd, "film", "shots", "counter", "takes", "handoff-in.png"));
    const again = json(cwd, ["compare", "film/shots/counter", "--handoff"]);
    expect(again.tile).toEqual({ width: 64, height: 64 });
    expect(again.tile).toEqual(pair.tile);

    expect(run(cwd, ["compare", "film/shots/counter", "--handoff", "--take", "take-09"]).err).toContain('no take "take-09"');
    // A shot that continues nothing has no pair to draw.
    const alone = workspace();
    ready(alone);
    json(alone, ["generate", "film/shots/lab-walk", "--now", T(20)], seedanceSeam(alone, { FAKE_TAKE_SOURCE: mp4Fixture(alone) }));
    expect(run(alone, ["compare", "film/shots/lab-walk", "--handoff"]).err).toContain("continues nothing");
  });
});

describe("prompt-skeleton", () => {
  /** The order of a v3 pack, top to bottom. The prohibitions are LAST: a
   *  negative read early is a negative the model has forgotten by the time it
   *  matters, and the non-negotiables have to be first. */
  function blockOrder(text: string, marks: string[]) {
    return marks.map((mark) => text.indexOf(mark));
  }

  test.skipIf(!HAS_FFMPEG)("writes the pack with the indices generate will actually attach", () => {
    const cwd = workspace();
    const env = { ...ttsSeam(cwd), ...imageSeam(cwd) };
    const png = pngFixture(cwd);
    ready(cwd);
    backlot(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    backlot(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "sheet"]);
    backlot(cwd, ["character", "voice", "film", "kai", "--text", "还开着吗？", "--model", "seed-speech"], env);
    backlot(cwd, ["set", "add", "film", "store", "--name", "便利店"]);
    backlot(cwd, ["set", "look", "film", "store", "--file", png, "--prompt", "wide"]);
    json(cwd, ["board", "film/shots/lab-walk", "--file", png, "--prompt", "the doorway"]);
    json(cwd, ["meta", "film/shots/lab-walk", "--characters", "kai", "--set", "store", "--trim-in", "0.4", "--trim-out", "6"]);
    json(cwd, ["meta", "film/shots/lab-walk", "--exit", "hand still on the console"]);
    json(cwd, ["lines", "film/shots/lab-walk", "--set", JSON.stringify([
      { id: "l1", speaker: "kai", kind: "spoken", text: "还开着吗？", at: 5.2 },
      { id: "l2", speaker: "narrator", kind: "vo", text: "凌晨三点。", at: 0.8 },
    ])]);
    // A beat with its designed detail: the prompt's timeline is that design,
    // at the greybox's seconds.
    const WALK_DETAIL = "four heavy steps, the coat dripping onto the floor, his eyes fixed on the console";
    const GLOW_DETAIL = "the camera pushes in slowly and settles on the pedestal, the blue glow rising over two seconds";
    writeFileSync(join(cwd, "detailed.json"), JSON.stringify([
      ...BEATS.slice(0, 1),
      { ...BEATS[1], detail: WALK_DETAIL },
      BEATS[2],
      { ...BEATS[3], kind: "camera", detail: GLOW_DETAIL },
    ]));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "detailed.json"]);

    const skeleton = json(cwd, ["prompt-skeleton", "film/shots/lab-walk"], env);
    expect(skeleton.file).toBeNull();
    // Pasted in as it comes — placeholders and all — the skeleton satisfies
    // every rule `generate` checks: it assigns every attached reference, its
    // timeline partitions the shot's clock with no gap and no overlap, it
    // carries every designed detail, and it locks the greybox out.
    const block = /```prompt\n([\s\S]*?)\n```/.exec(skeleton.skeleton as string)![1];
    writePrompt(cwd, block);
    const asPasted = run(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env);
    expect(asPasted.code).toBe(0);
    const estimate = JSON.parse(asPasted.out);
    const complaints = (estimate.warnings as string[]).filter((warning) => !/unfilled skeleton placeholder|does not price/.test(warning));
    expect(complaints).toEqual([]);
    // …and it says, loudly, that nobody has filled it in yet: the model is
    // sent exactly this text.
    expect(asPasted.err).toContain("unfilled skeleton placeholder");
    // THE point of the shared planner: the pack and the job cannot name
    // different pictures.
    expect(skeleton.refs).toEqual(estimate.refs);

    const text = skeleton.skeleton as string;
    // An English film gets English scaffolding, in the documented order.
    expect(skeleton.language).toBe("en");
    const order = blockOrder(text, ["Replace the geometric placeholders", "【References】", "【One-line brief】", "【Global】", "【Timeline】", "Sound: ambience", "Regenerate natural", "【Locks】"]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((at) => at >= 0)).toBe(true);
    // Every reference carries its scope AND its exclusion, at the index
    // `generate` will attach it to.
    expect(text).toContain("@Video1: use only the camera move, the framing, the cut points, the subjects' paths, the relative scale and what occludes what; do not inherit the grey surfacing");
    expect(text).toContain("@Image1: use only the opening composition and the intent of the frame (storyboard) — not its brushwork");
    expect(text).toContain("@Image2: <TODO: which block — its colour and where it stands at frame 1> in the greybox is 小凯; use only this sheet's face, hair, clothing and accessories — not its background.");
    expect(text).toContain("@Image3: the set's structure comes from the greybox space; use only this frame's materials, palette and light direction for the 便利店 — not the people in it.");
    expect(text).toContain("@Audio1: use only 小凯's timbre and pace — not the words in it or the room it was recorded in.");
    // The clip in one sentence, with the seconds and the aspect it renders at.
    expect(text).toContain('"First Light" — The researcher wakes the device: render the greybox as a 8 s, 16:9 film in <TODO: the look>');
    // The camera beat is NOT a timeline line: one move, said once, whole.
    expect(text).toContain(`Camera: one continuous take, one move and no more — ${GLOW_DETAIL}.`);
    expect(text).not.toContain(`s: ${GLOW_DETAIL}`);
    // The timeline is a contiguous partition of the WHOLE clip — the trim is
    // marked, not cut out, because every second is still rendered.
    expect(text).toContain("【Timeline】 (locked to the greybox clock: 8 s in total; the cut uses 0.4–6.0 s; the rest is still rendered and still needs directing)");
    expect(skeleton.segments).toEqual([
      { from: 0, to: 0.5, beats: ["establish"] },
      { from: 0.5, to: 4.5, beats: ["walk"] },
      { from: 4.5, to: 8, beats: ["touch"] },
    ]);
    // The designed detail is carried WHOLE, with 景别 + 构图 in front of it.
    expect(text).toContain(`0.5–4.5s: <TODO: shot size>, <TODO: composition>; ${WALK_DETAIL}; follow the greybox's path and timing;`);
    expect(text).toContain("0.0–0.5s: <TODO: shot size>, <TODO: composition>; Doorway establishes — <TODO");
    // A spoken line is quoted at its second, inside the segment that holds it.
    expect(text).toContain('at 5.2 s kai says "还开着吗？"');
    // The two clauses a greybox always needs, where the design does not
    // already supply them.
    expect(text).toContain("<TODO: how the materials and the light grow in over this segment>");
    expect(text).toContain("<TODO: how the body becomes natural — real steps and real weight, not a sliding block>");
    expect(text).toContain("follow the greybox's path and timing");
    // Sound, the regeneration line, and the locks — last.
    expect(text).toContain("No music — the score is laid under the whole film in the cut.");
    expect(text).toContain("The voice-over is not in this take either.");
    expect(text).toContain("do not carry over block sliding or mechanical swing.");
    expect(text).toContain("Add no object and remove none; do not change the camera path; keep none of the greybox's grey surfacing.");
    expect(text).toContain("Only 1 person is in frame: 小凯.");
    expect(text).toContain("Forbidden: greybox blocks, rigid sliding, plastic skin, face drift, extra people, on-screen text, built-in music, a sudden cut, deformed bodies, coordinate axes, view frustums.");
    expect(text).toContain("Last frame: hand still on the console");
    // No word budget — the cap is what deleted the design.
    expect(text).toContain("**There is no word limit.**");
    expect(text).not.toContain("120–180");
    expect(skeleton.budget).toBeUndefined();
  });

  test("a film written in Chinese gets a Chinese pack", () => {
    const cwd = workspace();
    scaffold(cwd);
    writeFileSync(join(cwd, "film", "screenplay.md"), "# 便利店\n\n凌晨三点，男人推门进来，站在冷柜前。他伸手按下按钮，灯亮了。\n");
    writeFileSync(join(cwd, "beats.json"), JSON.stringify([
      { ...BEATS[1], detail: "他走四步到操作台前，外套滴着水，眼睛盯着控制台" },
      { ...BEATS[3], kind: "camera", causedBy: undefined, detail: "镜头缓慢推近，最后停在控制台上，蓝光在两秒里升起来" },
    ]));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);

    const skeleton = json(cwd, ["prompt-skeleton", "film/shots/lab-walk"]);
    expect(skeleton.language).toBe("zh");
    const text = skeleton.skeleton as string;
    const order = blockOrder(text, ["将 @Video1 中的几何占位体按对应关系替换", "【素材映射】", "【一句话成片】", "【全局设定】", "【时间戳分镜】", "声音：环境声", "重新生成自然的", "【全局锁】"]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(text).toContain("@Video1：只参考运镜、构图、切点、主体轨迹、相对比例与遮挡关系；不要继承灰白材质、空场景、几何体外形与 Viewport 叠加物。");
    expect(text).toContain("运镜总原则：一镜到底，只有一个运镜动作——镜头缓慢推近，最后停在控制台上，蓝光在两秒里升起来。");
    expect(text).toContain("0.0–8.0秒：<TODO: 景别>，<TODO: 构图>；他走四步到操作台前，外套滴着水，眼睛盯着控制台；按白模路线与时机；");
    expect(text).toContain("不要配乐——配乐在成片阶段统一铺。");
    expect(text).toContain("不新增不删除物体，不改镜头轨迹，不保留白模质感。");
    expect(text).toContain("禁止：白模方块、刚性滑行、塑料皮肤、变脸、额外人物、字幕、自带 BGM、突然跳切、人物变形、坐标轴、视锥体。");
  });

  test("more beats than a clip can hold are MERGED, never shortened", () => {
    const cwd = workspace();
    scaffold(cwd, ["--seconds", "4"]);
    // Six designed beats in four seconds: one main event per segment means at
    // most four, so two merges happen — and every sentence survives them.
    const details = ["he pushes off the rear foot", "the blade comes up tight to the ribs", "the tip reaches the chest line", "the keeper slides east", "the blades meet, dust hanging", "he lowers the sword to his thigh"];
    writeFileSync(join(cwd, "beats.json"), JSON.stringify(details.map((detail, index) => ({
      id: `b${index}`, label: `beat ${index}`, from: index * 0.5, to: index * 0.5 + 0.5, kind: "action", detail,
    }))));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "beats.json"]);

    const skeleton = json(cwd, ["prompt-skeleton", "film/shots/lab-walk"]);
    expect(skeleton.maxSegments).toBe(4);
    expect(skeleton.merged).toBe(2);
    expect((skeleton.segments as Array<{ from: number; to: number }>).length).toBe(4);
    // Contiguous, covering the whole clip, in order.
    const segments = skeleton.segments as Array<{ from: number; to: number }>;
    expect(segments[0].from).toBe(0);
    expect(segments.at(-1)!.to).toBe(4);
    for (let index = 1; index < segments.length; index += 1) expect(segments[index].from).toBe(segments[index - 1].to);
    // Every designed sentence is still in the pack: a merge moves boundaries,
    // it does not delete design.
    for (const detail of details) expect(skeleton.skeleton as string).toContain(detail);
    expect((skeleton.warnings as string[]).join(" ")).toContain("merged into 4 timeline segments");
  });

  test("--write lands beside prompts.md and never on top of it", () => {
    const cwd = workspace();
    ready(cwd);
    const promptsPath = join(cwd, "film", "shots", "lab-walk", "prompts.md");
    const before = readFileSync(promptsPath, "utf-8");

    const written = json(cwd, ["prompt-skeleton", "film/shots/lab-walk", "--write"]);
    expect(written.file).toBe("prompts.skeleton.md");
    const skeletonPath = join(cwd, "film", "shots", "lab-walk", "prompts.skeleton.md");
    expect(readFileSync(skeletonPath, "utf-8")).toBe(written.skeleton);
    expect(readFileSync(skeletonPath, "utf-8")).toContain("```prompt");
    // The pack a take is made from is the agent's, and this command never
    // touches it.
    expect(readFileSync(promptsPath, "utf-8")).toBe(before);
  });

  test("a shot that continues another opens on its entry, and the hand-off gets the last index", () => {
    const cwd = workspace();
    twoShots(cwd);
    ready(cwd, { id: "counter", scaffolded: true });
    json(cwd, ["meta", "film/shots/counter", "--continues-from", "lab-walk",
      "--entry", "mid-stride, weight on the front foot, 1.2 m from the counter",
      "--exit", "hand flat on the counter"]);

    const text = json(cwd, ["prompt-skeleton", "film/shots/counter"]).skeleton as string;
    expect(text).toContain("@Image1: use only where everybody stands, which way they face and what is in their hands at the end of the previous shot (lab-walk) — this shot's frame 1 continues from exactly that");
    expect(text).toContain("First frame: mid-stride, weight on the front foot, 1.2 m from the counter");
    expect(text).toContain("Last frame: hand flat on the counter");
    // …and a shot with no hand-off leaves the entry open.
    expect(json(cwd, ["prompt-skeleton", "film/shots/lab-walk"]).skeleton).toContain("First frame: <TODO");
  });
});

describe("anchor and lineup", () => {
  /** A shot whose greybox is a real clip, so a frame can be cut out of it. */
  function anchored(cwd: string) {
    const clip = mp4Fixture(cwd);
    ready(cwd, { video: clip });
    const png = pngFixture(cwd);
    backlot(cwd, ["character", "add", "film", "kai", "--name", "小凯"]);
    backlot(cwd, ["character", "look", "film", "kai", "--file", png, "--prompt", "sheet"]);
    backlot(cwd, ["set", "add", "film", "store", "--name", "便利店"]);
    backlot(cwd, ["set", "look", "film", "store", "--file", png, "--prompt", "wide"]);
    json(cwd, ["board", "film/shots/lab-walk", "--file", png, "--prompt", "the doorway"]);
    json(cwd, ["meta", "film/shots/lab-walk", "--characters", "kai", "--set", "store"]);
    writeFileSync(join(cwd, "detailed.json"), JSON.stringify([
      { ...BEATS[0], detail: "he stops in the doorway, rain still on his shoulders" },
      ...BEATS.slice(1),
    ]));
    json(cwd, ["beats", "film/shots/lab-walk", "--set", "detailed.json"]);
  }

  test.skipIf(!HAS_FFMPEG)("makes the picture from the greybox frame plus the bible, and records what it cost", () => {
    const cwd = workspace();
    const env = imageSeam(cwd);
    anchored(cwd);

    const made = json(cwd, ["anchor", "film/shots/lab-walk", "--now", T(3)], env);
    expect(made.anchor).toMatchObject({
      id: "first",
      at: 0,
      file: "anchors/first.png",
      revision: 1,
      model: "openai/gpt-image-2.5-sunburst",
      cost: { usd: 0.1904, basis: "reported" },
      createdAt: Date.parse(T(3)),
    });
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "anchors", "first.png"))).toBe(true);
    // The composition reference is this shot's own greybox frame, kept.
    expect(made.anchor.greybox).toMatchObject({ file: "anchors/first.greybox.png", frame: 1, source: "greybox/greybox.mp4" });
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "anchors", "first.greybox.png"))).toBe(true);

    const call = JSON.parse(readFileSync(env.FAKE_IMAGE_ARGV, "utf-8").trim().split("\n").at(-1)!);
    // Composition FIRST, then the board, then who and where.
    expect(call["image-urls"].map((path: string) => path.split("/").slice(-2).join("/"))).toEqual([
      "anchors/first.greybox.png",
      "lab-walk/board.png",
      "kai/sheet.png",
      "store/concept.png",
    ]);
    expect(call["aspect-ratio"]).toBe("16:9");
    expect(call["output-format"]).toBe("png");
    // The prompt is the shot's own design read back, and it says what the
    // grey shapes are.
    expect(call.prompt).toContain("PLACEHOLDERS");
    expect(call.prompt).toContain("he stops in the doorway, rain still on his shoulders");
    expect(call.prompt).toContain("小凯");
    expect(call.prompt).toContain("便利店");
    expect(made.anchor.refs[0]).toBe("shots/lab-walk/anchors/first.greybox.png");

    // Re-shooting the same anchor bumps its revision; a second id is a
    // second anchor.
    expect(json(cwd, ["anchor", "film/shots/lab-walk", "--prompt", "colder"], env).anchor.revision).toBe(2);
    const last = json(cwd, ["anchor", "film/shots/lab-walk", "--id", "last", "--at", "0.5"], env);
    expect(last.anchor).toMatchObject({ id: "last", at: 0.5, revision: 1 });
    expect(last.anchors.map((entry: any) => entry.id).sort()).toEqual(["first", "last"]);
  });

  test.skipIf(!HAS_FFMPEG)("the anchor leads the references, and the skeleton gives it its job", () => {
    const cwd = workspace();
    const env = imageSeam(cwd);
    anchored(cwd);
    json(cwd, ["anchor", "film/shots/lab-walk"], env);
    json(cwd, ["anchor", "film/shots/lab-walk", "--id", "last", "--at", "0.9"], env);

    const text = json(cwd, ["prompt-skeleton", "film/shots/lab-walk"], env).skeleton as string;
    expect(text).toContain("@Image1: use only the opening framing, the camera, the palette and the overall style — not the exact pose of anybody in it.");
    expect(text).toContain("@Image5: use only the light, the palette and the surfaces at 0.9 s — not its composition.");
    writePrompt(cwd, /```prompt\n([\s\S]*?)\n```/.exec(text)![1]);

    const estimate = json(cwd, ["generate", "film/shots/lab-walk", "--estimate"], env);
    expect(estimate.refs).toEqual([
      { kind: "video", index: 1, file: "shots/lab-walk/greybox/greybox.mp4", role: "greybox" },
      { kind: "image", index: 1, file: "shots/lab-walk/anchors/first.png", role: "anchor:first" },
      { kind: "image", index: 2, file: "shots/lab-walk/board.png", role: "board" },
      { kind: "image", index: 3, file: "bible/characters/kai/sheet.png", role: "character:kai" },
      { kind: "image", index: 4, file: "bible/sets/store/concept.png", role: "set:store" },
      { kind: "image", index: 5, file: "shots/lab-walk/anchors/last.png", role: "anchor:last" },
    ]);
  });

  test.skipIf(!HAS_FFMPEG)("waits for the bible, and for a final greybox", () => {
    const cwd = workspace();
    const env = imageSeam(cwd);
    anchored(cwd);
    backlot(cwd, ["gates", "film", "closed"]);
    const refused = run(cwd, ["anchor", "film/shots/lab-walk"], env);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('stage "bible"');
    expect(existsSync(join(cwd, "film", "shots", "lab-walk", "anchors", "first.png"))).toBe(false);

    backlot(cwd, ["gates", "film", "open"]);
    const other = workspace();
    scaffold(other);
    expect(run(other, ["anchor", "film/shots/lab-walk"], imageSeam(other)).err).toContain("no FINAL greybox");
    expect(run(cwd, ["anchor", "film/shots/lab-walk", "--at", "99"], env).err).toContain("--at must be a second inside");
  });

  test.skipIf(!HAS_FFMPEG)("lineup puts the board, the anchor and the greybox side by side", () => {
    const cwd = workspace();
    const env = imageSeam(cwd);
    anchored(cwd);
    json(cwd, ["anchor", "film/shots/lab-walk"], env);

    const lined = json(cwd, ["lineup", "film/shots/lab-walk"]);
    expect(lined.panels.map((panel: any) => panel.kind)).toEqual(["board", "anchor", "greybox"]);
    expect(lined.missing).toEqual([]);
    expect(lined.file).toBe("lineup.png");
    const drawn = join(cwd, "film", "shots", "lab-walk", "lineup.png");
    const size = pngSize(readFileSync(drawn))!;
    // Three panels, one height, plus the footer the beats are written in.
    expect(size.height).toBe(lined.height + 44);
    expect(size.width).toBeGreaterThan(lined.height);
    expect(lined.beats[0]).toMatchObject({ id: "establish", detail: "he stops in the doorway, rain still on his shoulders" });

    // Whatever is missing is left out and named, never faked.
    const bare = workspace();
    ready(bare, { video: mp4Fixture(bare) });
    const alone = json(bare, ["lineup", "film/shots/lab-walk"]);
    expect(alone.panels.map((panel: any) => panel.kind)).toEqual(["greybox"]);
    expect(alone.missing).toEqual(["board", "anchor"]);
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
