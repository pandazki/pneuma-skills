/**
 * `lucid.mjs` and `lucid-bridge.js`, pinned as real artefacts.
 *
 * The script is spawned as a PROCESS with a pinned cwd, never imported: its
 * contract with the agent is argv in, one JSON object out, exit code, and the
 * bytes it leaves on disk. Testing it any other way would pin something the
 * agent never sees.
 *
 * Two things carry most of the weight here:
 *
 *  - the EXIT RULES. The loop's whole premise is that the decision to keep
 *    going, rethink, or stop is computed from the recorded history rather
 *    than remembered by the agent. Each rule gets a synthetic history
 *    (`fixtures/lucid/histories.json`) replayed through the real CLI, so the
 *    verdicts are read back out of a file the script itself wrote.
 *  - the BRIDGE PROTOCOL, which the viewer implements the other side of. It
 *    is driven here through a hand-made global object rather than happy-dom:
 *    happy-dom has no canvas and no WebGL, and every interesting case in this
 *    protocol is about a three.js renderer object, a stubbed rAF clock, or a
 *    message shape. A fake root makes the fps maths and the capture paths
 *    exact instead of approximate.
 *
 * `--now <ISO>` pins every timestamp, so nothing here depends on the clock.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { announceLiveTierSkip, LIVE_TIER, LIVE_TIER_LABEL } from "../../../core/__tests__/test-tier.js";
import { writePng } from "./fixtures/lucid/make-png.js";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "lucid.mjs");
const BRIDGE = join(import.meta.dir, "..", "skill", "scripts", "lucid-bridge.js");
const FIXTURES = join(import.meta.dir, "fixtures", "lucid");

announceLiveTierSkip("the real `npm pack three` vendoring run");

/** A pinned timestamp, `minutes` past 2026-09-16T10:00Z. */
const T = (minutes: number): string => new Date(Date.UTC(2026, 8, 16, 10, minutes)).toISOString();

const workspaces: string[] = [];
afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway workspace holding the two source images a loop needs.
 * `realpathSync` because macOS resolves /var to /private/var for a child
 * process's cwd — without it every absolute path the script prints would
 * disagree with the one the test built.
 */
function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lucid-")));
  workspaces.push(dir);
  writePng(join(dir, "dream.png"), { width: 6, height: 6, color: [10, 20, 30, 255] });
  writePng(join(dir, "shot.png"), { width: 8, height: 6, color: [200, 120, 40, 255] });
  return dir;
}

function run(cwd: string, argv: string[], stdin?: string) {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
    cwd,
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function json(cwd: string, argv: string[], stdin?: string) {
  const result = run(cwd, argv, stdin);
  if (result.code !== 0) throw new Error(`lucid.mjs ${argv.join(" ")} failed (${result.code}):\n${result.err}`);
  return JSON.parse(result.out);
}

const manifestOf = (cwd: string, project = "shrine") =>
  JSON.parse(readFileSync(join(cwd, project, "lucid.json"), "utf-8"));

const INIT = [
  "init", "shrine",
  "--title", "Lantern Shrine",
  "--brief", "an isometric shrine courtyard at dusk, lanterns on wet stone",
  "--no-vendor",
];

/** A project with a locked target — where every loop test starts. */
function looping(extra: string[] = []): string {
  const cwd = workspace();
  json(cwd, [...INIT, "--now", T(0), ...extra]);
  json(cwd, ["target", "shrine", "--set", "dream.png", "--now", T(5)]);
  return cwd;
}

// ── synthetic histories ─────────────────────────────────────────────────────

interface ScenarioRound {
  fps?: number;
  kind?: string;
  /** [composition, lighting, materials, details] */
  scores: [number, number, number, number];
  /** "<gap-id>:<area>" */
  gaps: string[];
}
interface Scenario {
  why: string;
  fpsTarget: number;
  expect: string;
  rounds: ScenarioRound[];
}

const HISTORIES = JSON.parse(readFileSync(join(FIXTURES, "histories.json"), "utf-8")) as Record<
  string,
  Scenario
>;

function verdictJson(round: ScenarioRound): string {
  const [composition, lighting, materials, details] = round.scores;
  return JSON.stringify({
    composition,
    lighting,
    materials,
    details,
    total: composition + lighting + materials + details,
    summary: "synthetic verdict",
    gaps: round.gaps.map((entry) => {
      const [id, area] = entry.split(":");
      return { id, area, issue: `${id} does not match the target`, fix: `fix ${id}` };
    }),
  });
}

/** Replay a named history through the real CLI and return its workspace. */
function replay(name: string): { cwd: string; scenario: Scenario } {
  const scenario = HISTORIES[name];
  if (!scenario) throw new Error(`no history fixture named "${name}"`);
  const cwd = workspace();
  json(cwd, [...INIT, "--fps-target", String(scenario.fpsTarget), "--now", T(0)]);
  json(cwd, ["target", "shrine", "--set", "dream.png", "--now", T(5)]);
  scenario.rounds.forEach((round, i) => {
    json(
      cwd,
      [
        "round", "shrine", "add",
        "--capture", "shot.png",
        ...(round.fps === undefined ? [] : ["--fps", String(round.fps)]),
        ...(round.kind === undefined ? [] : ["--kind", round.kind]),
        "--verdict", "-",
        "--now", T(10 + i * 10),
      ],
      verdictJson(round),
    );
  });
  return { cwd, scenario };
}

// ───────────────────────────────────────────────────────────────────────────

describe("lucid.mjs init", () => {
  test("creates the project layout, a runnable scene, and a dreaming manifest", () => {
    const cwd = workspace();
    const result = json(cwd, [...INIT, "--fps-target", "30", "--budget-minutes", "45", "--now", T(0)]);

    expect(result.ok).toBe(true);
    expect(result.vendor).toMatchObject({ ok: false, skipped: true, reason: "--no-vendor" });
    const layout = [
      "rounds", "assets",
      "scene/index.html", "scene/main.js", "scene/assets.js", "scene/lucid-bridge.js",
    ];
    for (const relative of layout) {
      expect(existsSync(join(cwd, "shrine", relative))).toBe(true);
    }
    // The starter page must load the bridge before its module graph, and
    // resolve three through a relative importmap — both are what let it run
    // from /content/<project>/scene/index.html with no build step.
    const html = readFileSync(join(cwd, "shrine", "scene", "index.html"), "utf-8");
    expect(html.indexOf("./lucid-bridge.js")).toBeLessThan(html.indexOf("./main.js"));
    expect(html).toContain('"three": "./vendor/three.module.js"');
    expect(html).toContain('"three/addons/": "./vendor/addons/"');

    const manifest = manifestOf(cwd);
    expect(manifest).toMatchObject({
      format: "pneuma-lucid/v1",
      title: "Lantern Shrine",
      status: "dreaming",
      createdAt: T(0),
      updatedAt: T(0),
      fpsTarget: 30,
      // The clock starts HERE, before any target exists: the user's 45
      // minutes began when they asked, and dreaming spends them too.
      budget: { minutes: 45, startedAt: T(0) },
      target: { path: null, version: 0, lockedAt: null, history: [] },
      rounds: [],
      assets: [],
    });
    expect(manifest.evaluation.exit).toBe("dreaming");
  });

  /**
   * The two starter modules never RUN in this suite — there is no importmap,
   * no canvas and no WebGL here — so they are parsed instead. Bun's transpiler
   * is a real ES module parser, and its scan reports exactly the two things
   * that break this pair silently in a browser: a specifier the starter's
   * importmap cannot resolve (blank page, one console error, no loader), and a
   * renamed export (main.js's import throws before the bridge ever registers,
   * so the loop sees a dead scene rather than a bad one).
   */
  test("the starter modules parse, and import and export only what the page can resolve", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--now", T(0)]);
    const transpiler = new Bun.Transpiler({ loader: "js" });
    const scan = (file: string) =>
      transpiler.scan(readFileSync(join(cwd, "shrine", "scene", file), "utf-8"));

    const assets = scan("assets.js");
    // The loader API the mode skill documents. Renaming one is a mode-skill
    // change, not a refactor.
    expect([...assets.exports].sort()).toEqual([
      "disposeModel", "instance", "loadModel", "playClip", "studioEnv", "textureFrom",
    ]);
    // Only addons `vendor-three` actually copies: an import of, say,
    // DRACOLoader.js resolves through the importmap prefix and then 404s.
    expect(assets.imports.map((entry) => entry.path).sort()).toEqual([
      "three", "three/addons/loaders/GLTFLoader.js", "three/addons/utils/SkeletonUtils.js",
    ]);
    expect(scan("main.js").imports.map((entry) => entry.path).sort()).toEqual([
      "./assets.js", "./look.js", "three", "three/addons/controls/OrbitControls.js",
    ]);
    // The post chain look.js wires, every file of it in VENDOR_FILES.
    const look = scan("look.js");
    expect([...look.exports]).toEqual(["makeLook"]);
    expect(look.imports.map((entry) => entry.path).sort()).toEqual([
      "three",
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/postprocessing/RenderPass.js",
      "three/addons/postprocessing/ShaderPass.js",
      "three/addons/postprocessing/UnrealBloomPass.js",
    ]);
  });

  test("refuses to overwrite an existing lucid.json", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--now", T(0)]);
    writeFileSync(join(cwd, "shrine", "scene", "main.js"), "// the agent's own scene\n");

    const second = run(cwd, [...INIT, "--now", T(1)]);
    expect(second.code).toBe(1);
    expect(second.err).toContain("refusing to overwrite");
    expect(manifestOf(cwd).createdAt).toBe(T(0));
    expect(readFileSync(join(cwd, "shrine", "scene", "main.js"), "utf-8")).toContain("the agent's own scene");
  });

  test("accepts an absolute project directory as well as one relative to the cwd", () => {
    const cwd = workspace();
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "lucid-abs-")));
    workspaces.push(elsewhere);
    const absolute = join(elsewhere, "shrine");
    const result = json(cwd, [
      "init", absolute, "--title", "Elsewhere", "--brief", "b", "--no-vendor", "--now", T(0),
    ]);
    expect(result.dir).toBe(absolute);
    expect(existsSync(join(absolute, "lucid.json"))).toBe(true);
  });

  test("needs a title and a brief", () => {
    const cwd = workspace();
    expect(run(cwd, ["init", "shrine", "--brief", "b", "--no-vendor"]).err).toContain("--title");
    expect(run(cwd, ["init", "shrine", "--title", "t", "--no-vendor"]).err).toContain("--brief");
    expect(existsSync(join(cwd, "shrine", "lucid.json"))).toBe(false);
  });
});

describe("lucid.mjs target", () => {
  test("the first lock starts the loop but does not touch the budget clock", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--budget-minutes", "45", "--now", T(0)]);
    const result = json(cwd, ["target", "shrine", "--set", "dream.png", "--now", T(5)]);

    expect(result.firstLock).toBe(true);
    const manifest = manifestOf(cwd);
    expect(manifest.status).toBe("looping");
    expect(manifest.target).toEqual({
      path: "target.png",
      version: 1,
      lockedAt: T(5),
      history: [],
    });
    // The five minutes spent dreaming are the user's minutes: the lock must
    // not reset the clock to its own timestamp.
    expect(manifest.budget).toEqual({ minutes: 45, startedAt: T(0) });
    expect(readFileSync(join(cwd, "shrine", "target.png"))).toEqual(readFileSync(join(cwd, "dream.png")));
  });

  test("replacing a target archives the old one and bumps the version", () => {
    const cwd = looping();
    const original = readFileSync(join(cwd, "dream.png"));
    const result = json(cwd, [
      "target", "shrine", "--set", "shot.png", "--reason", "dusk was too dark", "--now", T(30),
    ]);

    expect(result.firstLock).toBe(false);
    expect(result.archived).toEqual(["target-history/v1.png"]);
    const manifest = manifestOf(cwd);
    expect(manifest.target.version).toBe(2);
    expect(manifest.target.lockedAt).toBe(T(30));
    expect(manifest.target.history).toEqual([
      { version: 1, path: "target-history/v1.png", replacedAt: T(30), reason: "dusk was too dark" },
    ]);
    // The archived copy is the OLD dream, byte for byte: a trajectory must
    // never be silently compared against two different targets.
    expect(readFileSync(join(cwd, "shrine", "target-history", "v1.png"))).toEqual(original);
    expect(readFileSync(join(cwd, "shrine", "target.png"))).toEqual(readFileSync(join(cwd, "shot.png")));
  });

  test("rejects a file that is not a PNG and leaves the project untouched", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--now", T(0)]);
    writeFileSync(join(cwd, "not-a-png.png"), "GIF89a definitely not a png");

    const result = run(cwd, ["target", "shrine", "--set", "not-a-png.png", "--now", T(5)]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("not a PNG");
    expect(manifestOf(cwd).target.version).toBe(0);
    expect(existsSync(join(cwd, "shrine", "target.png"))).toBe(false);
  });
});

describe("lucid.mjs round add", () => {
  test("numbers rounds from 1 and copies the capture into rounds/NN/", () => {
    const cwd = looping();
    const first = json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "58", "--now", T(10)]);
    const second = json(cwd, [
      "round", "shrine", "add", "--capture", "dream.png",
      "--kind", "rethink", "--note", "rebuilt the courtyard", "--now", T(20),
    ]);

    // Every round carries the target version it is judged against, so a later
    // re-dream can tell which verdicts still mean anything.
    expect(first.round).toMatchObject({ index: 1, kind: "iterate", targetVersion: 1, capture: "rounds/01/capture.png", fps: 58, verdict: null });
    expect(second.round).toMatchObject({ index: 2, kind: "rethink", capture: "rounds/02/capture.png", fps: null, note: "rebuilt the courtyard" });
    expect(readFileSync(join(cwd, "shrine", "rounds", "01", "capture.png"))).toEqual(readFileSync(join(cwd, "shot.png")));
    expect(readFileSync(join(cwd, "shrine", "rounds", "02", "capture.png"))).toEqual(readFileSync(join(cwd, "dream.png")));
    expect(manifestOf(cwd).rounds.map((r: { index: number }) => r.index)).toEqual([1, 2]);
  });

  test("accepts an absolute capture path, as the framework's capture action returns", () => {
    const cwd = looping();
    const absolute = join(cwd, "shot.png");
    const result = json(cwd, ["round", "shrine", "add", "--capture", absolute, "--now", T(10)]);
    expect(result.capturePath).toBe(join(cwd, "shrine", "rounds", "01", "capture.png"));
  });

  test("refuses to record a round before a target is locked", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--now", T(0)]);
    const result = run(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no target is locked");
    expect(manifestOf(cwd).rounds).toEqual([]);
  });

  test("a malformed verdict fails the whole round — no half-made round directory", () => {
    const cwd = looping();
    const result = run(
      cwd,
      ["round", "shrine", "add", "--capture", "shot.png", "--verdict", "-", "--now", T(10)],
      JSON.stringify({ composition: 1, lighting: 1, materials: 1 }),
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain("verdict.details");
    expect(manifestOf(cwd).rounds).toEqual([]);
    expect(existsSync(join(cwd, "shrine", "rounds", "01"))).toBe(false);
  });
});

describe("lucid.mjs verdict", () => {
  test("stores a well-formed verdict from a file and recomputes the evaluation", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--now", T(10)]);
    const result = json(cwd, [
      "verdict", "shrine", "--round", "1", "--file", join(FIXTURES, "verdict-round1.json"), "--now", T(12),
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.round.verdict).toMatchObject({
      composition: 1.5, lighting: 1, materials: 0.8, details: 0.2, total: 3.5, judgedAt: T(12),
    });
    expect(result.round.verdict.gaps.map((g: { id: string }) => g.id)).toEqual(["flat-sky", "stone-too-clean"]);
    expect(result.evaluation.trend).toEqual([3.5]);
    expect(result.evaluation.fpsOk).toBe(true);
  });

  test("rejects a score outside the rubric's range and writes nothing", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    const before = readFileSync(join(cwd, "shrine", "lucid.json"), "utf-8");

    const result = run(cwd, [
      "verdict", "shrine", "--round", "1", "--file", join(FIXTURES, "verdict-out-of-range.json"), "--now", T(12),
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("verdict.lighting is 4, outside the rubric's 0-3 range");
    expect(readFileSync(join(cwd, "shrine", "lucid.json"), "utf-8")).toBe(before);
  });

  test("recomputes a wrong total, says so, and slugs a gap that arrived without an id", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    const result = json(cwd, [
      "verdict", "shrine", "--round", "1", "--file", join(FIXTURES, "verdict-bad-total.json"), "--now", T(12),
    ]);

    // The judge said 9; the four areas sum to 5. The trajectory is the loop's
    // only measure of progress, so the SUM is what gets stored.
    expect(result.round.verdict.total).toBe(5);
    expect(result.warnings[0]).toContain("judge reported total 9");
    expect(result.warnings[1]).toContain("had no id");
    expect(result.round.verdict.gaps[0].id).toBe("camera-is-too-high-the-shrine-roof-hides-the-cou");
  });

  test("refuses to overwrite an existing verdict without --replace", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    const file = join(FIXTURES, "verdict-round1.json");
    json(cwd, ["verdict", "shrine", "--round", "1", "--file", file, "--now", T(12)]);

    const blocked = run(cwd, ["verdict", "shrine", "--round", "1", "--file", file, "--now", T(13)]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("--replace");

    const replaced = json(cwd, ["verdict", "shrine", "--round", "1", "--file", file, "--replace", "--now", T(14)]);
    expect(replaced.replaced).toBe(true);
    expect(manifestOf(cwd).rounds[0].verdict.judgedAt).toBe(T(14));
  });

  test("reports an unknown round instead of inventing one", () => {
    const cwd = looping();
    const result = run(cwd, ["verdict", "shrine", "--round", "3", "--file", join(FIXTURES, "verdict-round1.json")]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("no round 3");
  });

  // Ingesting BY PATH is what keeps a judge's JSON from being retyped into the
  // loop — a hand-copied verdict is how a key gets corrupted.
  test("without --file it reads the rounds/NN/verdict.json the judge brief named", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--now", T(10)]);
    const brief = run(cwd, ["judge-prompt", "shrine"]).out;
    const promised = join(cwd, "shrine", "rounds", "01", "verdict.json");
    expect(brief).toContain(promised);

    // The judge writes exactly the file the brief told it to write.
    writeFileSync(promised, readFileSync(join(FIXTURES, "verdict-round1.json"), "utf-8"));
    const result = json(cwd, ["verdict", "shrine", "--round", "1", "--now", T(12)]);
    expect(result.source).toBe(promised);
    expect(result.round.verdict.total).toBe(3.5);
    expect(manifestOf(cwd).rounds[0].verdict.total).toBe(3.5);
  });

  test("--file still wins over the default path", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    writeFileSync(
      join(cwd, "shrine", "rounds", "01", "verdict.json"),
      JSON.stringify({ composition: 3, lighting: 3, materials: 3, details: 1, total: 10, gaps: [] }),
    );

    const result = json(cwd, [
      "verdict", "shrine", "--round", "1", "--file", join(FIXTURES, "verdict-round1.json"), "--now", T(12),
    ]);
    expect(result.source).toBe(join(FIXTURES, "verdict-round1.json"));
    expect(result.round.verdict.total).toBe(3.5);
  });

  test("with neither --file nor a written verdict it names the path it looked for", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--now", T(10)]);
    const result = run(cwd, ["verdict", "shrine", "--round", "1", "--now", T(12)]);

    expect(result.code).toBe(1);
    expect(result.err).toContain(join(cwd, "shrine", "rounds", "01", "verdict.json"));
    expect(result.err).toContain("--file");
    expect(manifestOf(cwd).rounds[0].verdict).toBeNull();
  });
});

describe("lucid.mjs status — the exit rules", () => {
  // One case per rule, each replayed through the real CLI from a fixture
  // history, so the verdict is read back out of a file the script wrote.
  for (const name of Object.keys(HISTORIES).filter((key) => !key.startsWith("_"))) {
    test(`${name}: ${HISTORIES[name].why} -> ${HISTORIES[name].expect}`, () => {
      const { cwd, scenario } = replay(name);
      const result = json(cwd, ["status", "shrine", "--now", T(60)]);

      expect(result.evaluation.exit).toBe(scenario.expect);
      expect(result.evaluation.reasons.length).toBeGreaterThan(0);
      expect(result.evaluation.trend).toHaveLength(scenario.rounds.length);
      expect(result.advice.length).toBeGreaterThan(0);
      // The stored evaluation agrees with the report; only the clock differs.
      expect(manifestOf(cwd).evaluation.exit).toBe(scenario.expect);
    });
  }

  test("a score of 8+ with no fps stays continue and names the missing measurement", () => {
    const { cwd } = replay("unmeasured");
    const result = json(cwd, ["status", "shrine", "--now", T(60)]);
    expect(result.evaluation.exit).toBe("continue");
    expect(result.evaluation.fpsOk).toBeNull();
    expect(result.evaluation.reasons.join(" ")).toContain("fps unmeasured");
  });

  test("a repeated gap id is reported, not just implied — and two in a row is not a stall", () => {
    const { cwd } = replay("repeated-gap");
    const result = json(cwd, ["status", "shrine", "--now", T(60)]);
    expect(result.evaluation.repeatedGaps).toEqual(["flat-sky"]);
    expect(result.evaluation.stubbornGaps).toEqual([]);
    expect(result.evaluation.exit).toBe("continue");
  });

  // The judge is told to carry a persisting gap's id forward, so "named twice"
  // is every real scene one round in; the second blind trial hit
  // stall-approaching at round 2 with a 0.9-point gain and seventeen carried
  // ids. Three verdicts running is a gap that survived two rounds of work.
  test("a gap named in three verdicts running is the stall signal, whatever the score did", () => {
    const { cwd } = replay("stubborn-gap");
    const result = json(cwd, ["status", "shrine", "--now", T(60)]);
    expect(result.evaluation.trend).toEqual([3, 5, 6.5]);
    expect(result.evaluation.repeatedGaps).toEqual(["flat-sky"]);
    expect(result.evaluation.stubbornGaps).toEqual(["flat-sky"]);
    expect(result.evaluation.exit).toBe("stall-approaching");
    expect(result.evaluation.reasons.join(" ")).toContain("3 verdicts in a row: flat-sky");
  });

  test("done and the coarse status agree", () => {
    const { cwd } = replay("done");
    expect(json(cwd, ["status", "shrine", "--now", T(60)]).status).toBe("done");
    expect(manifestOf(cwd).status).toBe("done");
  });

  test("a spent budget overrides continue but never done", () => {
    const improving = replay("improving").cwd;
    // The budget is asked for at T(40), so its clock starts there.
    json(improving, ["budget", "shrine", "--minutes", "45", "--now", T(40)]);
    expect(json(improving, ["status", "shrine", "--now", T(40)]).evaluation.exit).toBe("continue");

    const spent = json(improving, ["status", "shrine", "--now", T(90)]);
    expect(spent.evaluation.exit).toBe("budget-exhausted");
    expect(spent.budget).toEqual({
      minutes: 45, startedAt: T(40), pausedMinutes: 0, elapsedMinutes: 50, remainingMinutes: 0,
      sinceLastWriteMinutes: 50,
    });
    expect(spent.evaluation.reasons.join(" ")).toContain("45-minute budget is spent");
    // A report never writes: the stored evaluation is time-independent.
    expect(manifestOf(improving, "shrine").evaluation.exit).toBe("continue");

    const finished = replay("done").cwd;
    json(finished, ["budget", "shrine", "--minutes", "1", "--now", T(40)]);
    expect(json(finished, ["status", "shrine", "--now", T(300)]).evaluation.exit).toBe("done");
  });

  // The wall clock keeps counting while credits are out or the machine sleeps,
  // and the clock never pauses on its own: the agent credits the pause after
  // the resume, reading it from the span since the manifest was last written.
  test("a credited pause gives the wall clock back to the budget", () => {
    const cwd = replay("improving").cwd;
    json(cwd, ["budget", "shrine", "--minutes", "45", "--now", T(40)]);
    const spent = json(cwd, ["status", "shrine", "--now", T(700)]);
    expect(spent.evaluation.exit).toBe("budget-exhausted");
    // `status` never writes, so the span since the last write IS the pause.
    expect(spent.budget).toMatchObject({ pausedMinutes: 0, sinceLastWriteMinutes: 660 });

    const credited = json(cwd, ["budget", "shrine", "--pause-credit", "650", "--now", T(700)]);
    expect(credited.pauseCreditedMinutes).toBe(650);
    expect(credited.budget).toEqual({ minutes: 45, startedAt: T(40), pausedMinutes: 650 });
    expect(credited.elapsedMinutes).toBe(10);

    const resumed = json(cwd, ["status", "shrine", "--now", T(700)]);
    expect(resumed.evaluation.exit).toBe("continue");
    expect(resumed.budget).toMatchObject({ pausedMinutes: 650, elapsedMinutes: 10, remainingMinutes: 35 });

    // Credits accumulate and survive a --minutes change; nothing shrinks them.
    json(cwd, ["budget", "shrine", "--pause-credit", "10", "--minutes", "60", "--now", T(700)]);
    expect(manifestOf(cwd).budget).toEqual({ minutes: 60, startedAt: T(40), pausedMinutes: 660 });
    expect(json(cwd, ["status", "shrine", "--now", T(700)]).budget.remainingMinutes).toBe(60);

    expect(run(cwd, ["budget", "shrine", "--pause-credit", "0"]).err).toContain("positive");
    expect(run(looping(), ["budget", "shrine", "--pause-credit", "5"]).err).toContain("no running budget");
  });

  // The clock is spent whether or not a verdict exists. A loop that burned its
  // budget dreaming and building has to say so, not report "keep looping".
  test("a spent budget is reported before the first verdict too", () => {
    const cwd = looping();
    json(cwd, ["budget", "shrine", "--minutes", "30", "--now", T(10)]);
    expect(json(cwd, ["status", "shrine", "--now", T(20)]).evaluation.exit).toBe("continue");

    const spent = json(cwd, ["status", "shrine", "--now", T(200)]);
    expect(spent.judged).toBe(0);
    expect(spent.evaluation.exit).toBe("budget-exhausted");
    expect(spent.evaluation.trend).toEqual([]);
    expect(spent.evaluation.reasons.join(" ")).toContain("30-minute budget is spent");
    expect(spent.advice).toContain("time budget is spent");
    // Still a report: the stored evaluation stays time-independent.
    expect(manifestOf(cwd).evaluation.exit).toBe("continue");
  });

  test("reports an incomplete vendor directory as unusable", () => {
    const cwd = looping();
    const result = json(cwd, ["status", "shrine", "--now", T(10)]);
    expect(result.scene.bridge).toBe(true);
    expect(result.scene.bridgeCurrent).toBe(true);
    expect(result.scene.vendor.ok).toBe(false);
    expect(result.scene.vendor.missing).toContain("three.module.js");
    expect(result.scene.vendor.missing).toContain("VERSION");
  });

  test("is a report, not a gate: exit code 0 even when the loop is stalled", () => {
    const { cwd } = replay("rethink-no-gain");
    const result = run(cwd, ["status", "shrine", "--now", T(60)]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).evaluation.exit).toBe("stalled");
  });
});

// A verdict is a comparison against ONE image. Replacing the target replaces
// the question, so every score earned against the old dream stops counting —
// otherwise a loop that reached `done` stays `done` against a target it has
// never once been compared to.
describe("lucid.mjs target — a re-dream restarts the trajectory", () => {
  /** The `done` history (two judged rounds, 5 then 8.5), then a new dream. */
  function reDreamed(): string {
    const cwd = replay("done").cwd;
    expect(json(cwd, ["status", "shrine", "--now", T(60)]).evaluation.exit).toBe("done");
    const result = json(cwd, [
      "target", "shrine", "--set", "shot.png", "--reason", "re-dream", "--now", T(65),
    ]);
    expect(result.supersededRounds).toBe(2);
    expect(result.target.version).toBe(2);
    return cwd;
  }

  test("a done loop goes back to continue with an empty trend, and says why", () => {
    const cwd = reDreamed();

    const after = json(cwd, ["status", "shrine", "--now", T(66)]);
    expect(after.evaluation.exit).toBe("continue");
    expect(after.evaluation.targetVersion).toBe(2);
    expect(after.evaluation.trend).toEqual([]);
    expect(after.evaluation.best).toBeNull();
    expect(after.evaluation.last).toBeNull();
    expect(after.evaluation.fpsOk).toBeNull();
    expect(after.evaluation.reasons.join(" ")).toContain("do not count");
    // The coarse status follows the exit state: this loop is looping again.
    expect(after.status).toBe("looping");

    // The old rounds are still on disk and still on the rail — they are the
    // project's history, they just score nothing now.
    expect(after.rounds).toBe(2);
    expect(after.judged).toBe(2);
    expect(after.judgedAgainstTarget).toBe(0);
    const manifest = manifestOf(cwd);
    expect(manifest.status).toBe("looping");
    expect(manifest.evaluation.exit).toBe("continue");
    expect(manifest.evaluation.targetVersion).toBe(2);
    expect(manifest.rounds.map((r: { targetVersion: number }) => r.targetVersion)).toEqual([1, 1]);
    expect(manifest.rounds[1].verdict.total).toBe(8.5);
    expect(existsSync(join(cwd, "shrine", "rounds", "02", "capture.png"))).toBe(true);
  });

  test("a round recorded after the re-dream is scored against the new dream alone", () => {
    const cwd = reDreamed();
    const added = json(
      cwd,
      ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--verdict", "-", "--now", T(70)],
      verdictJson({ scores: [1, 1, 0.5, 0.2], gaps: [] }),
    );

    expect(added.round).toMatchObject({ index: 3, targetVersion: 2 });
    // 2.7 against the new target, not 8.5 carried over from the old one.
    expect(added.evaluation.trend).toEqual([2.7]);
    expect(added.evaluation.targetVersion).toBe(2);
    expect(added.evaluation.best).toEqual({ index: 3, total: 2.7 });
    expect(json(cwd, ["status", "shrine", "--now", T(71)]).judgedAgainstTarget).toBe(1);
  });

  test("the next judge is given no previous verdict to be consistent with", () => {
    const cwd = reDreamed();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--now", T(70)]);

    const brief = run(cwd, ["judge-prompt", "shrine"]);
    expect(brief.code).toBe(0);
    expect(brief.out).toContain("# Judge round 3");
    // Round 2 scored 8.5 — against the OLD dream. Handing that verdict to this
    // judge would ask it to stay consistent with a comparison it cannot see.
    expect(brief.out).not.toContain("## The previous verdict");
    expect(brief.out).toContain("first round judged against this target (v2)");
  });
});

describe("lucid.mjs budget", () => {
  test("--budget-minutes at init starts the clock there, and the target lock leaves it alone", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--budget-minutes", "45", "--now", T(0)]);
    expect(manifestOf(cwd).budget).toEqual({ minutes: 45, startedAt: T(0) });

    // Twelve minutes of dreaming before the lock: they came out of the user's
    // budget, which is the whole point of starting the clock at init.
    json(cwd, ["target", "shrine", "--set", "dream.png", "--now", T(12)]);
    expect(manifestOf(cwd).budget).toEqual({ minutes: 45, startedAt: T(0) });
    expect(json(cwd, ["status", "shrine", "--now", T(20)]).budget).toEqual({
      minutes: 45, startedAt: T(0), pausedMinutes: 0, elapsedMinutes: 20, remainingMinutes: 25,
      sinceLastWriteMinutes: 8,
    });
  });

  test("a budget asked for later starts counting from that moment", () => {
    const cwd = looping();
    const result = json(cwd, ["budget", "shrine", "--minutes", "30", "--now", T(20)]);
    expect(result.startedAtSource).toBe("now");
    expect(result.budget).toEqual({ minutes: 30, startedAt: T(20) });
  });

  test("a budget set before the target runs from then on, and 0 removes it", () => {
    const cwd = workspace();
    json(cwd, [...INIT, "--now", T(0)]);
    expect(json(cwd, ["budget", "shrine", "--minutes", "30", "--now", T(1)]).budget).toEqual({
      minutes: 30, startedAt: T(1),
    });
    json(cwd, ["target", "shrine", "--set", "dream.png", "--now", T(5)]);
    expect(manifestOf(cwd).budget).toEqual({ minutes: 30, startedAt: T(1) });

    // Raising the budget must not restart the clock.
    const raised = json(cwd, ["budget", "shrine", "--minutes", "60", "--now", T(9)]);
    expect(raised.startedAtSource).toBe("budget");
    expect(raised.budget).toEqual({ minutes: 60, startedAt: T(1) });
    expect(json(cwd, ["budget", "shrine", "--minutes", "0", "--now", T(10)]).budget).toBeNull();
  });
});

describe("lucid.mjs asset", () => {
  test("adds and updates ledger entries without touching files", () => {
    const cwd = looping();
    const added = json(cwd, [
      "asset", "shrine", "add", "--id", "lantern", "--role", "prop", "--source", "blender",
      "--files", "scene/models/lantern.glb,assets/lantern-ref.png", "--note", "hand-modelled",
      "--now", T(10),
    ]);
    expect(added.asset).toEqual({
      id: "lantern", role: "prop", source: "blender", state: "planned",
      files: ["scene/models/lantern.glb", "assets/lantern-ref.png"],
      note: "hand-modelled", updatedAt: T(10),
    });
    expect(existsSync(join(cwd, "shrine", "scene", "models", "lantern.glb"))).toBe(false);

    const updated = json(cwd, ["asset", "shrine", "update", "--id", "lantern", "--state", "placed", "--now", T(20)]);
    expect(updated.asset).toMatchObject({ state: "placed", updatedAt: T(20), files: ["scene/models/lantern.glb", "assets/lantern-ref.png"] });
    expect(manifestOf(cwd).assets).toHaveLength(1);
  });

  test("status lists the entries not yet on stage", () => {
    const cwd = looping();
    json(cwd, ["asset", "shrine", "add", "--id", "saint", "--role", "hero", "--source", "image-to-3d", "--state", "generating", "--now", T(10)]);
    json(cwd, ["asset", "shrine", "add", "--id", "lantern", "--role", "prop", "--source", "blender", "--state", "placed", "--now", T(10)]);
    expect(json(cwd, ["status", "shrine"]).assetsPending).toEqual([{ id: "saint", state: "generating" }]);
    json(cwd, ["asset", "shrine", "update", "--id", "saint", "--state", "placed", "--now", T(20)]);
    expect(json(cwd, ["status", "shrine"]).assetsPending).toEqual([]);
  });

  test("refuses a duplicate id, an unknown id, and an invalid enum", () => {
    const cwd = looping();
    json(cwd, ["asset", "shrine", "add", "--id", "lantern", "--role", "prop", "--source", "blender", "--now", T(10)]);

    expect(run(cwd, ["asset", "shrine", "add", "--id", "lantern", "--role", "prop", "--source", "blender"]).err)
      .toContain("already exists");
    expect(run(cwd, ["asset", "shrine", "update", "--id", "ghost", "--state", "ready"]).err)
      .toContain('no asset "ghost"');
    expect(run(cwd, ["asset", "shrine", "add", "--id", "torii", "--role", "backdrop", "--source", "blender"]).err)
      .toContain("--role must be one of hero|prop|environment");
    expect(manifestOf(cwd).assets).toHaveLength(1);
  });
});

describe("lucid.mjs judge-prompt", () => {
  test("carries the rubric, both absolute paths, the brief, and the output schema", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--now", T(10)]);
    const result = run(cwd, ["judge-prompt", "shrine"]);

    expect(result.code).toBe(0);
    // Plain text, not JSON: it is piped into a subagent verbatim.
    expect(() => JSON.parse(result.out)).toThrow();

    // Matched against whitespace-collapsed text: what must survive is the
    // rubric's WORDING, not the column the upstream file happens to wrap at.
    const flat = result.out.replace(/\s+/g, " ");
    for (const phrase of [
      "**Composition (0-3):**", "**Lighting (0-3):**", "**Materials (0-3):**", "**Details (0-1):**",
      "You can give fractional scores",
      "You should be nitpicky and precise",
      "It needs to be comprehensive and actionable",
      "The goal is for both images to be identical",
      "If the product regressed, it should score worse",
    ]) {
      expect(flat).toContain(phrase);
    }
    expect(result.out).toContain(join(cwd, "shrine", "target.png"));
    expect(result.out).toContain(join(cwd, "shrine", "rounds", "01", "capture.png"));
    expect(result.out).toContain("an isometric shrine courtyard at dusk, lanterns on wet stone");
    expect(result.out).toContain('"gaps"');
    expect(result.out).toContain("kebab-case-slug");
    expect(result.out).toContain("this is the first judged round");
  });

  test("writes the same brief to rounds/NN/judge-brief.md and prints that path first", () => {
    const cwd = looping();
    json(cwd, ["round", "shrine", "add", "--capture", "shot.png", "--fps", "60", "--now", T(10)]);
    const result = run(cwd, ["judge-prompt", "shrine"]);

    const file = join(cwd, "shrine", "rounds", "01", "judge-brief.md");
    const [header, blank, ...rest] = result.out.split("\n");
    expect(header).toBe(`# Brief file: ${file}`);
    expect(blank).toBe("");
    // The file holds the brief itself — byte for byte what was printed after
    // the header, so handing the judge the path cannot lose or alter a word.
    expect(readFileSync(file, "utf-8")).toBe(rest.join("\n"));
    expect(rest[0]).toBe('# Judge round 1 of "Lantern Shrine"');

    // And it tells the judge where to put the answer, so the loop can ingest
    // the verdict by path instead of through a copied chat turn.
    const verdict = join(cwd, "shrine", "rounds", "01", "verdict.json");
    expect(result.out).toContain(`WRITE that JSON object to ${verdict}`);
    expect(result.out).toContain("AND print it in your reply");
  });

  test("re-running overwrites the brief rather than appending to it", () => {
    const { cwd } = replay("improving");
    const file = join(cwd, "shrine", "rounds", "02", "judge-brief.md");
    writeFileSync(file, "a stale brief from an earlier round\n");

    const result = run(cwd, ["judge-prompt", "shrine", "--round", "2"]);
    const written = readFileSync(file, "utf-8");
    expect(written).not.toContain("a stale brief");
    expect(written.startsWith('# Judge round 2 of "Lantern Shrine"')).toBe(true);
    expect(result.out.endsWith(written)).toBe(true);
  });

  test("hands the previous verdict to the next judge and tells it to reuse gap ids", () => {
    const { cwd } = replay("improving");
    const result = run(cwd, ["judge-prompt", "shrine"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("# Judge round 3");
    expect(result.out).toContain("## The previous verdict (round 2)");
    expect(result.out).toContain("stone-too-clean");
    expect(result.out).toContain("REUSE that gap's `id` verbatim");
    // Ids and issues travel; the numbers do not — a judge that reads 4.5
    // before looking scores around 4.5.
    expect(result.out).toContain("scores are withheld");
    const previousSection = result.out.slice(result.out.indexOf("## The previous verdict"), result.out.indexOf("## Output"));
    expect(previousSection).toContain('"id": "stone-too-clean"');
    expect(previousSection).toContain('"issue"');
    for (const withheld of ['"total"', '"composition"', '"summary"', '"fix"']) {
      expect(previousSection).not.toContain(withheld);
    }
    expect(result.out).toContain(join(cwd, "shrine", "rounds", "03", "capture.png"));
  });

  test("--round selects an earlier round", () => {
    const { cwd } = replay("improving");
    const result = run(cwd, ["judge-prompt", "shrine", "--round", "2"]);
    expect(result.out).toContain("# Judge round 2");
    expect(result.out).toContain(join(cwd, "shrine", "rounds", "02", "capture.png"));
    expect(result.out).toContain("## The previous verdict (round 1)");
  });

  test("refuses when there is nothing to judge", () => {
    const cwd = looping();
    expect(run(cwd, ["judge-prompt", "shrine"]).err).toContain("no rounds recorded");

    const dreaming = workspace();
    json(dreaming, [...INIT, "--now", T(0)]);
    expect(run(dreaming, ["judge-prompt", "shrine"]).err).toContain("no target is locked");
  });
});

describe("lucid.mjs bridge --refresh", () => {
  test("re-copies the skill's bridge over a stale one", () => {
    const cwd = looping();
    const installed = join(cwd, "shrine", "scene", "lucid-bridge.js");
    writeFileSync(installed, "// an old bridge from a previous skill version\n");
    // status says so before anyone trusts what that bridge reports.
    expect(json(cwd, ["status", "shrine"]).scene.bridgeCurrent).toBe(false);

    const result = json(cwd, ["bridge", "shrine", "--refresh"]);
    expect(result.path).toBe(installed);
    expect(readFileSync(installed, "utf-8")).toBe(readFileSync(BRIDGE, "utf-8"));
    expect(result.bytes).toBe(readFileSync(BRIDGE).length);
  });

  test("needs --refresh spelled out", () => {
    const cwd = looping();
    expect(run(cwd, ["bridge", "shrine"]).err).toContain("--refresh");
  });
});

describe("lucid.mjs --help", () => {
  test("documents every subcommand, the --now pin, and every exit state", () => {
    const help = run(workspace(), ["--help"]);
    expect(help.code).toBe(0);
    for (const subcommand of [
      "init", "vendor-three", "target", "round", "verdict", "status", "budget", "asset",
      "judge-prompt", "bridge",
    ]) {
      expect(help.out).toContain(`  ${subcommand} `);
    }
    for (const exitState of [
      "dreaming", "continue", "done", "optimize-fps", "stall-approaching", "stalled", "budget-exhausted",
    ]) {
      expect(help.out).toContain(exitState);
    }
    expect(help.out).toContain("--now <ISO-8601>");
    // The agent reads the rules here or nowhere: a re-dream resetting the
    // trajectory is not something it can infer from a field name.
    expect(help.out).toContain("targetVersion");
    expect(help.out).toContain("RESTARTS THE SCORE");
    expect(help.out).toContain("judgedAgainstTarget");
    expect(help.out).toContain("including before the first verdict");
  });

  test("an unknown subcommand and an unknown flag both fail loudly", () => {
    const cwd = workspace();
    expect(run(cwd, ["dream", "shrine"]).code).toBe(1);
    expect(run(cwd, ["dream", "shrine"]).err).toContain("unknown subcommand");
    expect(run(cwd, ["status", "shrine", "--wat"]).err).toContain("--wat");
  });
});

// ── lucid-bridge.js ────────────────────────────────────────────────────────
//
// It lives in this file rather than its own because it is the other half of
// the same script directory's contract with the viewer.

interface FakeCanvas {
  width: number;
  height: number;
  toDataURL: (type?: string) => string;
}

interface Harness {
  root: Record<string, unknown> & {
    /** The page's console, which the bridge wraps to see three.js's output. */
    console: { error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
    lucid: {
      register: (parts: unknown) => boolean;
      setLoading: (value: boolean) => void;
      report: (message: string) => void;
      note: (name: unknown, data?: unknown) => boolean;
    };
    __lucidBridge: {
      bridgeVersion: number;
      handleMessage: (data: unknown, reply: (message: Record<string, unknown>) => void) => boolean;
      state: () => Record<string, unknown>;
      noteFrame: (timestamp: number) => void;
      frameStats: (times: number[]) => { fps: number | null; frameMs: number | null };
    };
  };
  /** Messages the bridge pushed to the parent window. */
  toParent: Array<Record<string, unknown>>;
  /** Advance the rAF sampler; each entry is one callback timestamp in ms. */
  frames: (timestamps: number[]) => void;
  /** Move the page clock WITHOUT an animation frame: a hidden tab. */
  advance: (t: number) => void;
  /**
   * Draw real frames: each entry is ONE animation frame — the page clock
   * moves, the rAF sampler turns, and then `renderer.render` is called
   * `passes` times, as a scene with a reflection or shadow pass does. After
   * `register` those calls run through the bridge's counting wrapper, which
   * counts the first as the displayed frame and the rest as extra passes.
   */
  renders: (renderer: FakeRenderer, timestamps: number[], passes?: number) => void;
  /** Fire a listener the bridge registered on the window. */
  fire: (type: string, event: unknown) => void;
  /**
   * Everything the UNDERLYING console method received. The bridge wraps
   * console.error / console.warn, so this is the spy that proves the page's
   * own logging still happens.
   */
  consoleCalls: Array<{ method: string; args: unknown[] }>;
}

const BRIDGE_SOURCE = readFileSync(BRIDGE, "utf-8");

function canvas(width = 1280, height = 720, dataUrl = "data:image/png;base64,QQ=="): FakeCanvas {
  return { width, height, toDataURL: () => dataUrl };
}

/**
 * Load the bridge against a hand-made global. The file's last line is
 * `(typeof window !== "undefined" ? window : globalThis)`, so a `window`
 * parameter is exactly what the page would hand it.
 */
function loadBridge(pageCanvas: FakeCanvas | null = null): Harness {
  const pending: Array<(t: number) => void> = [];
  const toParent: Array<Record<string, unknown>> = [];
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const consoleCalls: Array<{ method: string; args: unknown[] }> = [];
  // The page clock. rAF callbacks carry their own timestamp; a render is
  // timed by the bridge itself, so `renders` moves this before each call.
  let clock = 0;

  const root = {
    devicePixelRatio: 2,
    performance: { now: () => clock },
    // The real console the bridge wraps. Recording here — inside the
    // ORIGINAL method — is what lets a test prove the wrapper called through.
    console: {
      error: (...args: unknown[]) => consoleCalls.push({ method: "error", args }),
      warn: (...args: unknown[]) => consoleCalls.push({ method: "warn", args }),
      log: (...args: unknown[]) => consoleCalls.push({ method: "log", args }),
    },
    document: {
      visibilityState: "visible",
      querySelector: (selector: string) => (selector === "canvas" ? pageCanvas : null),
    },
    requestAnimationFrame: (callback: (t: number) => void) => pending.push(callback),
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      (listeners[type] ??= []).push(callback);
    },
    parent: { postMessage: (message: Record<string, unknown>) => toParent.push(message) },
  } as unknown as Harness["root"];

  new Function("window", BRIDGE_SOURCE)(root);

  return {
    root,
    toParent,
    frames: (timestamps) => {
      for (const t of timestamps) {
        clock = t;
        for (const callback of pending.splice(0, pending.length)) callback(t);
      }
    },
    advance: (t) => {
      clock = t;
    },
    renders: (renderer, timestamps, passes = 1) => {
      for (const t of timestamps) {
        clock = t;
        // The sampler turn comes first, exactly as on a page: the bridge
        // queued its rAF callback before main.js ever ran, so the browser
        // calls it ahead of the scene's own animation loop.
        for (const callback of pending.splice(0, pending.length)) callback(t);
        for (let i = 0; i < passes; i += 1) renderer.render();
      }
    },
    fire: (type, event) => {
      for (const callback of listeners[type] ?? []) callback(event);
    },
    consoleCalls,
  };
}

/** A three.js renderer as far as the bridge is concerned. It records what it
 *  was asked to draw, so a test can prove the wrapper still calls through. */
function fakeRenderer(element: FakeCanvas = canvas()) {
  const rendered: Array<{ scene: unknown; camera: unknown }> = [];
  return {
    domElement: element,
    // Capped below the display's 2: the number a performance decision hides.
    getPixelRatio: () => 1.5,
    info: { render: { calls: 42, triangles: 123_456 }, memory: { textures: 7, geometries: 9 } },
    // WebGLRenderer always carries `debug`; `onShaderError` is null until
    // somebody installs one, which is exactly what `register` does.
    debug: { checkShaderErrors: true, onShaderError: null } as {
      checkShaderErrors: boolean;
      onShaderError: ((...args: unknown[]) => void) | null;
    },
    render(scene?: unknown, camera?: unknown): string {
      rendered.push({ scene, camera });
      return "drawn";
    },
    rendered,
  };
}

type FakeRenderer = ReturnType<typeof fakeRenderer>;

/** Register and DRAW enough real frames that the scene counts as ready —
 *  `ready` needs renderer.render calls now, not animation-frame callbacks. */
function readyBridge(harness: Harness, renderer = fakeRenderer(), frames = 12) {
  harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });
  harness.renders(renderer, Array.from({ length: frames }, (_, i) => i * 16));
  return renderer;
}

describe("lucid-bridge.js frame statistics", () => {
  test("fps spans the window while frameMs is the median interval", () => {
    const { frameStats } = loadBridge().root.__lucidBridge;
    // Four timestamps = three 16ms intervals = 62.5 fps.
    expect(frameStats([0, 16, 32, 48])).toEqual({ fps: 62.5, frameMs: 16 });
    // One 400ms hitch must show up as a lower fps, not as a frame time the
    // scene never actually took.
    expect(frameStats([0, 16, 32, 432])).toEqual({ fps: 6.94, frameMs: 16 });
    expect(frameStats([])).toEqual({ fps: null, frameMs: null });
    expect(frameStats([12])).toEqual({ fps: null, frameMs: null });
  });

  test("the window is bounded at 120 frames, so fps tracks the recent past", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness);
    // 200 renders at a steady 100 fps after the ready burst: the oldest
    // timestamps fall out and the reported fps is the recent rate.
    harness.renders(renderer, Array.from({ length: 200 }, (_, i) => 1_000 + i * 10));
    const state = harness.root.__lucidBridge.state();
    expect(state.framesRendered).toBe(212);
    expect(state.fps).toBe(100);
    expect(state.frameMs).toBe(10);
  });

  // The report an agent trusts must be about frames that were DRAWN. A rAF
  // loop that runs at 60 Hz while the scene renders every fifth callback is
  // exactly the case the old rAF-only measurement described as healthy.
  test("fps counts real renders once a renderer is registered; rafFps keeps the page cadence", () => {
    const harness = loadBridge();

    // Before registration there is no render to count, so `fps` is the rAF
    // sampler and `fpsSource` says so rather than implying a drawn frame.
    harness.frames([0, 16, 32, 48]);
    expect(harness.root.__lucidBridge.state()).toMatchObject({
      registered: false, ready: false, fpsSource: "raf", fps: 62.5, rafFps: 62.5, framesRendered: 4,
    });

    const renderer = fakeRenderer();
    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });
    // The page keeps scheduling animation frames at a steady 62.5 fps; the
    // scene only draws on every fifth one.
    for (let i = 0; i < 61; i += 1) {
      const t = 64 + i * 16;
      if (i % 5 === 0) harness.renders(renderer, [t]);
      else harness.frames([t]);
    }

    expect(harness.root.__lucidBridge.state()).toMatchObject({
      registered: true,
      ready: true,
      fpsSource: "render",
      fps: 12.5,
      frameMs: 80,
      rafFps: 62.5,
      framesRendered: 13,
      passesPerFrame: 1,
    });
  });

  // The seed scene draws a reflection into a render target and then the
  // visible frame: two renderer.render calls for one picture. Counting both
  // reported a 30 fps scene as 60 — past the 54 fps `done` bar for a 60 fps
  // target, on a scene the user could see stuttering.
  test("two render passes in one animation frame are ONE frame, not two", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });

    const ticks = Array.from({ length: 31 }, (_, i) => (i * 1000) / 30);
    harness.renders(renderer, ticks, 2);

    expect(harness.root.__lucidBridge.state()).toMatchObject({
      fps: 30,
      frameMs: 33.33,
      framesRendered: 31,
      passesPerFrame: 2,
      rafFps: 30,
      ready: true,
    });
    // The wrapper still calls through for every pass — both draws happened.
    expect(renderer.rendered).toHaveLength(62);
  });

  test("one render per animation frame is unchanged: one frame, one pass", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });
    harness.renders(renderer, Array.from({ length: 31 }, (_, i) => (i * 1000) / 30));

    expect(harness.root.__lucidBridge.state()).toMatchObject({
      fps: 30, framesRendered: 31, passesPerFrame: 1,
    });
  });

  test("a render with no animation frame behind it still counts once", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });

    // Nothing has sampled yet — a scene that draws off its own clock must
    // read as slow, never as "never drew".
    renderer.render();
    expect(harness.root.__lucidBridge.state()).toMatchObject({
      framesRendered: 1, passesPerFrame: 1,
    });

    // …but a second draw with still no frame in between is a pass, not a frame.
    renderer.render();
    expect(harness.root.__lucidBridge.state()).toMatchObject({
      framesRendered: 1, passesPerFrame: 2,
    });

    harness.frames([16]);
    renderer.render();
    expect(harness.root.__lucidBridge.state().framesRendered).toBe(2);
  });

  test("registering wraps renderer.render: the original still runs, once per call", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    const scene = { id: "scene" };
    const camera = { id: "camera" };
    harness.root.lucid.register({ renderer, scene, camera });
    // Registering the same renderer twice must not make one frame count twice.
    harness.root.lucid.register({ renderer, scene, camera });

    expect(renderer.render(scene, camera)).toBe("drawn");
    expect(renderer.rendered).toEqual([{ scene, camera }]);
    expect(harness.root.__lucidBridge.state()).toMatchObject({
      framesRendered: 1, fpsSource: "render", ready: false,
    });

    // Nine more: `ready` is ten RENDERED frames, and rAF cannot stand in.
    harness.frames(Array.from({ length: 30 }, (_, i) => i * 16));
    expect(harness.root.__lucidBridge.state().ready).toBe(false);
    harness.renders(renderer, Array.from({ length: 9 }, (_, i) => 500 + i * 16));
    expect(harness.root.__lucidBridge.state()).toMatchObject({ framesRendered: 10, ready: true });
  });
});

describe("lucid-bridge.js state", () => {
  test("says hello to the parent on load and reports an unregistered scene honestly", () => {
    const harness = loadBridge();
    expect(harness.toParent).toEqual([{ type: "pneuma:lucid:hello", bridgeVersion: 1 }]);

    const state = harness.root.__lucidBridge.state();
    expect(state).toMatchObject({
      bridgeVersion: 1,
      registered: false,
      ready: false,
      loading: false,
      fps: null,
      fpsSource: "raf",
      rafFps: null,
      framesRendered: 0,
      drawCalls: null,
      triangles: null,
      textures: null,
      geometries: null,
      errors: [],
      errorSources: { window: 0, unhandledrejection: 0, console: 0, shader: 0 },
      notes: {},
      viewport: { width: 0, height: 0, pixelRatio: 2 },
    });
  });

  // A scene with a post chain draws through a composer; a capture that calls
  // the bare renderer.render would hand the judge a frame without bloom, fog
  // or tone mapping — a picture the user never sees.
  test("a capture draws through the registered render callback when the scene gave one", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    const drawn: string[] = [];
    harness.root.lucid.register({
      renderer, scene: { id: "scene" }, camera: { id: "camera" },
      render: () => { drawn.push("chain"); renderer.render("chain-scene", "chain-camera"); },
    });
    harness.renders(renderer, Array.from({ length: 12 }, (_, i) => i * 16));
    const before = renderer.rendered.length;
    const r: Array<Record<string, unknown>> = [];
    harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:capture", id: "c-chain" }, (m) => r.push(m));
    expect(r[0]).toMatchObject({ ok: true, registered: true });
    expect(drawn).toEqual(["chain"]);
    // The chain's own draw went through the wrapper — counted, not bypassed.
    expect(renderer.rendered.slice(before)).toEqual([{ scene: "chain-scene", camera: "chain-camera" }]);
  });

  // The browser pauses animation frames in a background tab: nothing draws,
  // and the samples the bridge still holds are from before the pause. Sixty
  // fps an hour later is the number that sends an agent hunting for a
  // performance bug that does not exist.
  test("a tab in the background reports no measurement, and says why", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness);
    const live = harness.root.__lucidBridge.state() as Record<string, any>;
    expect(live.fps).not.toBeNull();
    expect(live.visibility).toBe("visible");
    expect(live.sinceLastRenderMs).toBe(0);
    expect(live.viewport).toEqual({ width: 1280, height: 720, pixelRatio: 2, renderPixelRatio: 1.5 });

    (harness.root.document as { visibilityState: string }).visibilityState = "hidden";
    harness.advance(11 * 16 + 3000);
    const hidden = harness.root.__lucidBridge.state() as Record<string, any>;
    expect(hidden).toMatchObject({
      fps: null, frameMs: null, rafFps: null, visibility: "hidden", sinceLastRenderMs: 3000,
      ready: true, registered: true,
    });
    expect(hidden.framesRendered).toBe(live.framesRendered);

    // Frames again: the measurement comes back with them.
    harness.renders(renderer, [3200, 3216, 3232, 3248]);
    expect((harness.root.__lucidBridge.state() as Record<string, any>).fps).not.toBeNull();
  });

  test("a registered, drawing scene becomes ready once and reports the renderer's counters", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness);

    const state = harness.root.__lucidBridge.state();
    expect(state).toMatchObject({
      registered: true,
      ready: true,
      fpsSource: "render",
      framesRendered: 12,
      drawCalls: 42,
      triangles: 123_456,
      textures: 7,
      geometries: 9,
      viewport: { width: renderer.domElement.width, height: renderer.domElement.height, pixelRatio: 2 },
    });
    expect(harness.toParent.filter((m) => m.type === "pneuma:lucid:ready")).toHaveLength(1);

    harness.renders(renderer, [1000, 1016]);
    expect(harness.toParent.filter((m) => m.type === "pneuma:lucid:ready")).toHaveLength(1);
  });

  test("setLoading holds ready back while assets are still arriving", () => {
    const harness = loadBridge();
    harness.root.lucid.setLoading(true);
    readyBridge(harness);
    expect(harness.root.__lucidBridge.state()).toMatchObject({ registered: true, loading: true, ready: false });

    harness.root.lucid.setLoading(false);
    expect(harness.root.__lucidBridge.state().ready).toBe(true);
    expect(harness.toParent.filter((m) => m.type === "pneuma:lucid:ready")).toHaveLength(1);
  });

  test("register without the three pieces is refused and reported, not silently ignored", () => {
    const harness = loadBridge();
    expect(harness.root.lucid.register({ renderer: fakeRenderer() })).toBe(false);
    const state = harness.root.__lucidBridge.state();
    expect(state.registered).toBe(false);
    expect(state.errors).toEqual(["window.lucid.register needs { renderer, scene, camera }"]);
  });
});

describe("lucid-bridge.js errors", () => {
  test("collects page errors, rejections and scene reports, deduped, and tells the parent once", () => {
    const harness = loadBridge();
    harness.fire("error", { message: "GLTFLoader: failed to load lantern.glb" });
    harness.fire("error", { message: "GLTFLoader: failed to load lantern.glb" });
    harness.fire("unhandledrejection", { reason: new Error("texture fetch rejected") });
    harness.root.lucid.report("hero asset is still a placeholder");

    expect(harness.root.__lucidBridge.state().errors).toEqual([
      "GLTFLoader: failed to load lantern.glb",
      "texture fetch rejected",
      "hero asset is still a placeholder",
    ]);
    expect(harness.toParent.filter((m) => m.type === "pneuma:lucid:error")).toHaveLength(3);
  });

  test("errors[] is bounded and says how many it dropped", () => {
    const harness = loadBridge();
    for (let i = 0; i < 40; i += 1) harness.fire("error", { message: `error ${i}` });
    const errors = harness.root.__lucidBridge.state().errors as string[];
    expect(errors).toHaveLength(20);
    expect(errors[19]).toBe("+21 more distinct errors (suppressed)");
  });
});

// The second blind trial (2026-09-17) built a scene whose material rendered
// black while the bridge reported NO errors: three.js prints a failed shader
// link through console.error and returns, so window.onerror never fires. The
// builder had to write its own diagnostic to see what the bridge should have
// handed it. These pin the two channels that close that hole.
describe("lucid-bridge.js console and shader errors", () => {
  const stateOf = (harness: Harness) => harness.root.__lucidBridge.state();
  const errorsOf = (harness: Harness) => stateOf(harness).errors as string[];
  const sourcesOf = (harness: Harness) => stateOf(harness).errorSources as Record<string, number>;

  /** A GL context as far as the shader hook is concerned. */
  function fakeGl(programLog: string, fragmentLog = "", vertexLog = "") {
    return {
      getProgramInfoLog: (program: unknown) => (program === "program" ? programLog : ""),
      getShaderInfoLog: (shader: unknown) => (shader === "fs" ? fragmentLog : vertexLog),
    };
  }

  test("a three.js shader error printed to console.error lands in errors[], counted as console", () => {
    const harness = loadBridge();
    harness.root.console.error(
      "THREE.WebGLProgram: Shader Error 0x0502 - VALIDATE_STATUS false\n\nProgram Info Log: \nERROR: unresolved symbol",
    );

    expect(errorsOf(harness)[0]).toBe(
      "THREE.WebGLProgram: Shader Error 0x0502 - VALIDATE_STATUS false Program Info Log: ERROR: unresolved symbol",
    );
    expect(sourcesOf(harness)).toEqual({ window: 0, unhandledrejection: 0, console: 1, shader: 0 });
    expect(harness.toParent.filter((m) => m.type === "pneuma:lucid:error")).toHaveLength(1);

    // The page's own logging is untouched: the original still ran, with the
    // arguments it was given.
    expect(harness.consoleCalls).toHaveLength(1);
    expect(harness.consoleCalls[0].method).toBe("error");
    expect(String(harness.consoleCalls[0].args[0])).toContain("VALIDATE_STATUS");
  });

  test("console.warn is captured only when three.js is the one warning", () => {
    const harness = loadBridge();
    harness.root.console.warn("[vite] connected.");
    harness.root.console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");

    // three.js hands the console an Error rather than a string on its
    // stack-trace path (`three.core.js` warn/error), and the text lives in
    // `message` — a summary that only read strings would lose it.
    harness.root.console.warn(new Error("THREE.TSL: node not found"));

    expect(errorsOf(harness)).toEqual([
      "warn: THREE.WebGLRenderer: Texture marked for update but no image data found.",
      "warn: THREE.TSL: node not found",
    ]);
    expect(sourcesOf(harness).console).toBe(2);
    // Ignored or not, every warn reached the real console.
    expect(harness.consoleCalls.map((c) => c.method)).toEqual(["warn", "warn", "warn"]);
  });

  test("a console call is summarized to one line: objects by message or short JSON, capped at 240", () => {
    const harness = loadBridge();
    harness.root.console.error("load failed", new Error("lantern.glb 404"), { url: "lantern.glb" });
    expect(errorsOf(harness)[0]).toBe('load failed lantern.glb 404 {"url":"lantern.glb"}');

    harness.root.console.error("THREE.WebGLProgram: Shader Error\n" + "x".repeat(1_000));
    const long = errorsOf(harness)[1];
    expect(long).toHaveLength(240);
    expect(long.startsWith("THREE.WebGLProgram: Shader Error x")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toContain("\n");

    // An empty call says nothing and is not an error.
    harness.root.console.error();
    expect(errorsOf(harness)).toHaveLength(2);
  });

  test("register installs onShaderError: the info log is reported and the scene's own handler still runs", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    const seen: unknown[][] = [];
    renderer.debug.onShaderError = (...args: unknown[]) => {
      seen.push(args);
    };

    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });
    // Registering twice must not install the hook twice.
    harness.root.lucid.register({ renderer, scene: { id: "scene" }, camera: { id: "camera" } });
    const hook = renderer.debug.onShaderError!;
    const gl = fakeGl("ERROR: 0:42 'vNormal' : undeclared identifier\nERROR: 1 compilation error");
    hook(gl, "program", "vs", "fs");

    expect(errorsOf(harness)).toEqual(["shader: ERROR: 0:42 'vNormal' : undeclared identifier"]);
    expect(sourcesOf(harness)).toEqual({ window: 0, unhandledrejection: 0, console: 0, shader: 1 });
    expect(seen).toEqual([[gl, "program", "vs", "fs"]]);
    // A scene with its own handler had already replaced three.js's report,
    // so the bridge has nothing to put back.
    expect(harness.consoleCalls).toEqual([]);
  });

  test("an empty program log falls back to the shader log, and a silent failure still says so", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness);
    renderer.debug.onShaderError!(fakeGl("", "ERROR: 0:7 syntax error"), "program", "vs", "fs");
    renderer.debug.onShaderError!(fakeGl(""), "program", "vs", "fs");

    expect(errorsOf(harness)).toEqual([
      "shader: ERROR: 0:7 syntax error",
      "shader: program link failed with no info log",
    ]);
    expect(sourcesOf(harness).shader).toBe(2);
  });

  // three.js's WebGLProgram calls onShaderError INSTEAD of printing its own
  // report, so a hook that only fed errors[] would take the driver's logs
  // away from devtools — the most useful message in the engine, gone because
  // the bridge was watching.
  test("the hook puts three.js's displaced report back in the page console, without a second entry", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness);
    renderer.debug.onShaderError!(
      fakeGl("ERROR: link failed", "ERROR: 0:7 'vUv' : undeclared identifier", "ERROR: 0:3 syntax"),
      "program",
      "vs",
      "fs",
    );

    expect(harness.consoleCalls).toHaveLength(1);
    const logged = String(harness.consoleCalls[0].args[0]);
    expect(logged).toContain("Program Info Log: ERROR: link failed");
    expect(logged).toContain("Fragment Shader Info Log: ERROR: 0:7 'vUv' : undeclared identifier");
    expect(logged).toContain("Vertex Shader Info Log: ERROR: 0:3 syntax");

    // It went through console.error as it was BEFORE the wrap, so the page
    // keeps its message and the failure is still filed exactly once.
    expect(errorsOf(harness)).toEqual(["shader: ERROR: link failed"]);
    expect(sourcesOf(harness)).toEqual({ window: 0, unhandledrejection: 0, console: 0, shader: 1 });
  });

  test("a renderer with no debug object registers normally, it just cannot see shader failures", () => {
    const harness = loadBridge();
    const renderer = fakeRenderer();
    delete (renderer as { debug?: unknown }).debug;
    expect(harness.root.lucid.register({ renderer, scene: {}, camera: {} })).toBe(true);
    expect(errorsOf(harness)).toEqual([]);
  });

  test("errorSources names the channel while dedupe and the 20-entry cap stay as they were", () => {
    const harness = loadBridge();
    harness.fire("error", { message: "boom" });
    harness.fire("unhandledrejection", { reason: new Error("texture fetch rejected") });
    harness.root.console.error("THREE.WebGLProgram: Shader Error");
    harness.root.console.error("THREE.WebGLProgram: Shader Error"); // same line, already seen
    harness.root.lucid.report("hero asset is still a placeholder");

    expect(errorsOf(harness)).toEqual([
      "boom",
      "texture fetch rejected",
      "THREE.WebGLProgram: Shader Error",
      "hero asset is still a placeholder",
    ]);
    // `report` is the scene talking, not a channel the bridge watches.
    expect(sourcesOf(harness)).toEqual({ window: 1, unhandledrejection: 1, console: 1, shader: 0 });

    // Past the cap the list still samples, and the counter still counts every
    // DISTINCT line the channel produced — including the suppressed ones.
    for (let i = 0; i < 40; i += 1) harness.root.console.error(`three.js is unhappy ${i}`);
    const errors = errorsOf(harness);
    expect(errors).toHaveLength(20);
    expect(errors[19]).toBe("+25 more distinct errors (suppressed)");
    expect(sourcesOf(harness).console).toBe(41);
  });
});

// A scene that ran a successful in-viewer check had nowhere to put the result
// except errors[] — so a PASS was reported through the failure channel. These
// pin the separate channel that fixes it.
describe("lucid-bridge.js notes", () => {
  const notesOf = (harness: Harness) =>
    harness.root.__lucidBridge.state().notes as Record<string, unknown>;
  const noteMessages = (harness: Harness) =>
    harness.toParent.filter((m) => m.type === "pneuma:lucid:note");

  test("a note carries structure, stays out of errors[], and tells the parent its name", () => {
    const harness = loadBridge();
    expect(harness.root.lucid.note("integration-check", { pass: true, cases: ["click", "zoom"] })).toBe(true);

    expect(notesOf(harness)).toEqual({ "integration-check": { pass: true, cases: ["click", "zoom"] } });
    expect(harness.root.__lucidBridge.state().errors).toEqual([]);
    expect(noteMessages(harness)).toEqual([{ type: "pneuma:lucid:note", name: "integration-check" }]);
  });

  test("the last write under a name wins, and each write is announced", () => {
    const harness = loadBridge();
    harness.root.lucid.note("probe", { frame: 1 });
    harness.root.lucid.note("probe", { frame: 2 });

    expect(notesOf(harness)).toEqual({ probe: { frame: 2 } });
    expect(noteMessages(harness)).toHaveLength(2);
  });

  test("values are stored as their JSON round-trip, truncated at 2 KB, never thrown on", () => {
    const harness = loadBridge();
    harness.root.lucid.note("huge", { blob: "x".repeat(5_000) });
    const huge = notesOf(harness).huge as string;
    expect(typeof huge).toBe("string");
    expect(huge.length).toBeLessThan(2_100);
    expect(huge).toContain("truncated 5011 -> 2048 chars of JSON");

    // Neither of these can cross postMessage, so they are reported in place
    // rather than silently dropped or thrown back into the scene.
    harness.root.lucid.note("fn", () => 1);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    harness.root.lucid.note("cycle", cycle);
    expect(String(notesOf(harness).fn)).toContain("not serializable");
    expect(String(notesOf(harness).cycle)).toContain("not serializable");

    // …and a note is still not an error.
    expect(harness.root.__lucidBridge.state().errors).toEqual([]);
  });

  test("notes are capped at 20 keys and the refusals are counted, not hidden", () => {
    const harness = loadBridge();
    for (let i = 0; i < 30; i += 1) harness.root.lucid.note(`note-${i}`, i);

    const notes = notesOf(harness);
    expect(Object.keys(notes)).toHaveLength(20);
    expect(String(notes["+dropped"])).toBe("11 notes refused (at most 19 names)");
    expect(noteMessages(harness)).toHaveLength(19);
    expect(notes["note-18"]).toBe(18);

    // A name already in the table still gets through after the cap.
    expect(harness.root.lucid.note("note-0", "updated")).toBe(true);
    expect(notesOf(harness)["note-0"]).toBe("updated");
    expect(harness.root.lucid.note("note-29", 29)).toBe(false);
  });

  test("a nameless note is refused and reported instead of swallowed", () => {
    const harness = loadBridge();
    expect(harness.root.lucid.note("   ", { pass: true })).toBe(false);
    expect(harness.root.lucid.note(42, { pass: true })).toBe(false);

    expect(notesOf(harness)).toEqual({});
    expect(String((harness.root.__lucidBridge.state().errors as string[])[0])).toContain(
      "window.lucid.note needs a non-empty name",
    );
  });
});

describe("lucid-bridge.js message routing", () => {
  const reply = () => {
    const sent: Array<Record<string, unknown>> = [];
    return { sent, send: (message: Record<string, unknown>) => sent.push(message) };
  };

  test("ignores anything that is not addressed to it", () => {
    const harness = loadBridge();
    const r = reply();
    expect(harness.root.__lucidBridge.handleMessage({ type: "webpack:hot-update" }, r.send)).toBe(false);
    expect(harness.root.__lucidBridge.handleMessage("hello", r.send)).toBe(false);
    expect(harness.root.__lucidBridge.handleMessage(null, r.send)).toBe(false);
    expect(r.sent).toEqual([]);
  });

  test("answers a state request with the id it was given", () => {
    const harness = loadBridge();
    readyBridge(harness);
    const r = reply();
    expect(harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:state", id: "s-1" }, r.send)).toBe(true);
    expect(r.sent[0]).toMatchObject({ type: "pneuma:lucid:state:result", id: "s-1" });
    expect((r.sent[0].state as Record<string, unknown>).ready).toBe(true);
  });

  test("answers an unknown request under its prefix instead of hanging", () => {
    const harness = loadBridge();
    const r = reply();
    expect(harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:teleport", id: 9 }, r.send)).toBe(true);
    expect(r.sent[0]).toEqual({
      type: "pneuma:lucid:unsupported", id: 9, requestType: "pneuma:lucid:teleport", bridgeVersion: 1,
    });
  });
});

describe("lucid-bridge.js capture", () => {
  test("a registered renderer draws and reads the canvas in the same task", () => {
    const harness = loadBridge();
    const renderer = readyBridge(harness, fakeRenderer(canvas(1600, 900, "data:image/png;base64,SCENE")));
    const drawnBefore = renderer.rendered.length;
    const r: Array<Record<string, unknown>> = [];

    harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:capture", id: "c-1" }, (m) => r.push(m));

    // Synchronous, with no animation frame in between: that is the only way
    // to read a WebGL buffer that was not created with preserveDrawingBuffer.
    expect(r[0]).toEqual({
      type: "pneuma:lucid:capture:result",
      id: "c-1",
      ok: true,
      dataUrl: "data:image/png;base64,SCENE",
      width: 1600,
      height: 900,
      registered: true,
    });
    // The capture's own draw goes through the same wrapper, so the scene is
    // really redrawn — but it lands inside an animation frame that was already
    // counted, so it is an extra PASS and does not inflate the fps the exit
    // rules read.
    expect(renderer.rendered).toHaveLength(drawnBefore + 1);
    const state = harness.root.__lucidBridge.state();
    expect(state.framesRendered).toBe(drawnBefore); // 12 frames, 13 render calls
    expect(state.passesPerFrame).toBe(1.08);
  });

  test("without a renderer it falls back to the page canvas after one frame and says so", () => {
    const harness = loadBridge(canvas(800, 600, "data:image/png;base64,PAGE"));
    const r: Array<Record<string, unknown>> = [];

    harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:capture", id: "c-2" }, (m) => r.push(m));
    expect(r).toEqual([]); // waiting for a frame

    harness.frames([16]);
    expect(r[0]).toMatchObject({ ok: true, registered: false, width: 800, dataUrl: "data:image/png;base64,PAGE" });
  });

  test("with neither a renderer nor a canvas it fails with the fix in the message", () => {
    const harness = loadBridge();
    const r: Array<Record<string, unknown>> = [];
    harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:capture", id: "c-3" }, (m) => r.push(m));

    expect(r[0]).toMatchObject({ ok: false, registered: false });
    expect(String(r[0].error)).toContain("window.lucid.register");
  });

  test("a throwing canvas is reported as a failed capture, never as a blank success", () => {
    const harness = loadBridge();
    const broken = {
      width: 1280,
      height: 720,
      toDataURL: () => {
        throw new Error("Tainted canvases may not be exported");
      },
    };
    readyBridge(harness, fakeRenderer(broken));
    const r: Array<Record<string, unknown>> = [];
    harness.root.__lucidBridge.handleMessage({ type: "pneuma:lucid:capture", id: "c-4" }, (m) => r.push(m));

    expect(r[0]).toEqual({
      type: "pneuma:lucid:capture:result",
      id: "c-4",
      ok: false,
      error: "Tainted canvases may not be exported",
      registered: true,
    });
  });
});

// ── live tier ──────────────────────────────────────────────────────────────

describe.skipIf(!LIVE_TIER)(`lucid.mjs vendor-three ${LIVE_TIER_LABEL}`, () => {
  test(
    "npm packs one three.js release and lands exactly six files plus VERSION",
    () => {
      const cwd = workspace();
      json(cwd, [...INIT, "--now", T(0)].filter((arg) => arg !== "--no-vendor"));

      const report = json(cwd, ["status", "shrine", "--now", T(1)]);
      expect(report.scene.vendor.ok).toBe(true);
      expect(report.scene.vendor.missing).toEqual([]);
      expect(report.scene.vendor.version).toMatch(/^\d+\.\d+\.\d+/);

      const vendor = join(cwd, "shrine", "scene", "vendor");
      for (const relative of [
        "three.module.js",
        "three.core.js",
        "addons/loaders/GLTFLoader.js",
        "addons/controls/OrbitControls.js",
        "addons/utils/BufferGeometryUtils.js",
        "addons/utils/SkeletonUtils.js",
        "VERSION",
      ]) {
        expect(existsSync(join(vendor, relative))).toBe(true);
      }
      expect(readFileSync(join(vendor, "three.module.js"), "utf-8")).toContain("REVISION");
      expect(existsSync(join(cwd, "shrine", "scene", "vendor.incoming"))).toBe(false);

      // Re-vendoring the same version is idempotent, and a version that does
      // not exist fails loudly without touching what is already on disk.
      const version = readFileSync(join(vendor, "VERSION"), "utf-8").trim();
      json(cwd, ["vendor-three", "shrine", "--version", version]);
      const bogus = run(cwd, ["vendor-three", "shrine", "--version", "0.0.0-not-a-release"]);
      expect(bogus.code).toBe(1);
      expect(readFileSync(join(vendor, "VERSION"), "utf-8").trim()).toBe(version);
    },
    300_000,
  );
});
