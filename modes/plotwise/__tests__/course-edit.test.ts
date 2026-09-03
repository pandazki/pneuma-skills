/**
 * course-edit.mjs — the session's hand on course.json, pinned as a real
 * process (this is how the agent calls it). The style step lives in
 * these ops: `init` opens a course pending a style, `set-style` merges a
 * candidate, `confirm-style` seals it with the sample anchor as the
 * first shoot reference, and a bare `--status pending` resets it.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "course-edit.mjs");

function run(cwd: string, ...argv: string[]) {
  const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const coursePath = (ws: string) => join(ws, "plexus", "course.json");
const readCourse = (ws: string) => JSON.parse(readFileSync(coursePath(ws), "utf-8"));
const fresh = () => mkdtempSync(join(tmpdir(), "plotwise-ws-"));

describe("course-edit.mjs", () => {
  test("init creates the skeleton once, pending a style, and merges afterwards", () => {
    const ws = fresh();
    const r = run(ws, "init", "--set", "plexus", "--title", "Plexus 是什么", "--topic", "Plexus");
    expect(r.code).toBe(0);
    expect(readCourse(ws)).toMatchObject({
      title: "Plexus 是什么",
      topic: "Plexus",
      language: "zh",
      style: { id: "", status: "pending" },
      outline: [],
      rootNode: "",
      path: [],
      nodes: {},
    });

    expect(run(ws, "init", "--set", "plexus", "--title", "Plexus 是什么", "--goal", "讲清楚").code).toBe(0);
    const c = readCourse(ws);
    expect(c.goal).toBe("讲清楚");
    expect(c.topic).toBe("Plexus");
  });

  test("set-style merges a candidate; confirm-style seals it with the sample anchor first", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    const r = run(
      ws, "set-style", "--set", "plexus",
      "--style-id", "custom", "--name", "黄昏手绘", "--recipe", "Hand-painted dusk",
      "--status", "sampling", "--ref-image", "style/refs/a.png",
    );
    expect(r.code).toBe(0);
    expect(readCourse(ws).style).toMatchObject({
      id: "custom",
      name: "黄昏手绘",
      recipe: "Hand-painted dusk",
      status: "sampling",
      userRefs: ["style/refs/a.png"],
    });

    // The sampler lands the sample.
    const c = readCourse(ws);
    c.style.sample = { image: "style/anchor.png", video: "style/sample.mp4", hook: "h" };
    c.style.status = "sampled";
    writeFileSync(coursePath(ws), JSON.stringify(c));

    expect(run(ws, "confirm-style", "--set", "plexus").code).toBe(0);
    expect(readCourse(ws).style).toMatchObject({
      status: "confirmed",
      name: "黄昏手绘",
      refImages: ["style/anchor.png", "style/refs/a.png"],
      sample: { video: "style/sample.mp4" },
    });

    // A reset drops the sample and the shoot refs, keeps the learner's refs.
    expect(run(ws, "set-style", "--set", "plexus", "--status", "pending").code).toBe(0);
    const reset = readCourse(ws).style;
    expect(reset.status).toBe("pending");
    expect(reset.sample).toBeUndefined();
    expect(reset.refImages).toBeUndefined();
    expect(reset.userRefs).toEqual(["style/refs/a.png"]);
  });

  test("confirm-style refuses without a candidate; watched is idempotent at the tail", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    const refused = run(ws, "confirm-style", "--set", "plexus");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("no style candidate");

    const c = readCourse(ws);
    c.nodes = { n1: { children: [], status: "ready" } };
    writeFileSync(coursePath(ws), JSON.stringify(c));
    expect(run(ws, "watched", "--set", "plexus", "--node", "n1").code).toBe(0);
    expect(run(ws, "watched", "--set", "plexus", "--node", "n1").code).toBe(0);
    expect(readCourse(ws).path).toEqual(["n1"]);
    expect(run(ws, "watched", "--set", "plexus", "--node", "nope").code).toBe(1);
  });

  test("watched records the whole line up to the segment, and the tail is the latest watched", () => {
    // The first live course ended up with path ["n2b"]: the director never
    // recorded the root, and the learner opened n3b from the rail. A path
    // that does not carry its own ancestors cannot draw a main line.
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    const c = readCourse(ws);
    c.rootNode = "n1";
    c.nodes = {
      n1: { children: [{ nodeId: "n2a" }, { nodeId: "n2b" }], status: "ready" },
      n2a: { parent: "n1", children: [], status: "ready" },
      n2b: { parent: "n1", children: [{ nodeId: "n3b" }], status: "ready" },
      n3b: { parent: "n2b", children: [], status: "ready" },
    };
    c.path = ["n2b"];
    writeFileSync(coursePath(ws), JSON.stringify(c));

    expect(run(ws, "watched", "--set", "plexus", "--node", "n3b").code).toBe(0);
    expect(readCourse(ws).path).toEqual(["n2b", "n1", "n3b"]);
    // Taking the other branch at the first fork: its ancestors are already
    // there, it goes on the tail, nothing already seen is lost.
    expect(run(ws, "watched", "--set", "plexus", "--node", "n2a").code).toBe(0);
    expect(readCourse(ws).path).toEqual(["n2b", "n1", "n3b", "n2a"]);
    // Coming back to a segment already seen moves it to the tail.
    expect(run(ws, "watched", "--set", "plexus", "--node", "n2b").code).toBe(0);
    expect(readCourse(ws).path).toEqual(["n1", "n3b", "n2a", "n2b"]);
  });
});

describe("planner ops: outline / evidence / audit", () => {
  const BEATS = [
    { id: "b1", title: "开场：秋千摇一摇", summary: "波是来回摇", tier: "world-knowledge", figures: [] },
    { id: "b2", title: "频率", summary: "一秒摇几次", tier: "code-verification", figures: ["两条正弦波，一秒 2 次与 6 次"] },
    { id: "b3", title: "傅里叶的历史", summary: "谁提出的", tier: "citation", figures: [] },
  ];

  test("outline lands the beats, mints n1, keeps style and path, and grounds textbook beats by definition", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "声音的配方", "--topic", "傅里叶");
    run(ws, "set-style", "--set", "plexus", "--style-id", "papercraft", "--status", "sampled");
    writeFileSync(join(ws, "outline.json"), JSON.stringify(BEATS));
    const r = run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ op: "outline", outline: 3, grounded: 1 });
    const c = readCourse(ws);
    expect(c.outline.map((b: { id: string }) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(c.outline[0].evidence).toEqual([{ kind: "world-knowledge", note: "教科书级常识，无需查证" }]);
    expect(c.outline[1].evidence).toEqual([]);
    expect(c.outline[1].figureSpecs).toHaveLength(1);
    expect(c.outline[1].figures).toBeUndefined();
    expect(c.rootNode).toBe("n1");
    expect(c.nodes.n1).toMatchObject({ beat: "b1", kind: "main", choiceLabel: "开场：秋千摇一摇", status: "planned" });
    expect(c.style).toMatchObject({ id: "papercraft", status: "sampled" });
    expect(c.path).toEqual([]);
  });

  test("evidence merges one beat, refuses files that are not on disk, and records problems", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    writeFileSync(join(ws, "outline.json"), JSON.stringify(BEATS));
    run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    const evDir = join(ws, "plexus", "evidence", "b2");
    mkdirSync(evDir, { recursive: true });
    writeFileSync(join(evDir, "waves.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(evDir, "check.py"), "print(2)");
    writeFileSync(
      join(evDir, "grounding.json"),
      JSON.stringify({
        evidence: [
          { kind: "rendered-figure", file: "evidence/b2/waves.png", note: "两条波" },
          { kind: "code-verification", file: "evidence/b2/check.py", note: "数波峰" },
          { kind: "rendered-figure", file: "evidence/b2/ghost.png", note: "never rendered" },
        ],
        problems: ["6 次那条的标注挤在一起"],
      }),
    );
    const r = run(ws, "evidence", "--set", "plexus", "--beat", "b2", "--file", join(evDir, "grounding.json"));
    expect(r.code).toBe(0);
    let b2 = readCourse(ws).outline[1];
    expect(b2.evidence.map((e: { file: string }) => e.file)).toEqual(["evidence/b2/waves.png", "evidence/b2/check.py"]);
    expect(b2.problems).toEqual(["6 次那条的标注挤在一起", "evidence file not on disk: evidence/b2/ghost.png"]);
    expect(b2.grounded).toBe(true);
    // Committing again is a merge, not a duplicate.
    run(ws, "evidence", "--set", "plexus", "--beat", "b2", "--file", join(evDir, "grounding.json"));
    b2 = readCourse(ws).outline[1];
    expect(b2.evidence).toHaveLength(2);
    // A beat that is not in the outline is refused.
    expect(run(ws, "evidence", "--set", "plexus", "--beat", "b9", "--file", join(evDir, "grounding.json")).code).toBe(1);
  });

  test("audit says what every beat still owes, without writing", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    writeFileSync(join(ws, "outline.json"), JSON.stringify(BEATS));
    run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    const before = readFileSync(coursePath(ws), "utf-8");
    const r = run(ws, "audit", "--set", "plexus");
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.ok).toBe(false);
    expect(report.beats[0]).toMatchObject({ id: "b1", ok: true });
    expect(report.beats[1].problems).toEqual(["1 figure spec(s) without a rendered file", "no verification run on disk"]);
    expect(report.beats[2].problems).toEqual(["no pinned source"]);
    expect(readFileSync(coursePath(ws), "utf-8")).toBe(before);
  });

  test("audit names a figure outside fal's reference aspect range", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    writeFileSync(join(ws, "outline.json"), JSON.stringify(BEATS));
    run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    const evDir = join(ws, "plexus", "evidence", "b3");
    mkdirSync(evDir, { recursive: true });
    // A PNG header is enough: signature, then IHDR with width and height.
    const png = (w: number, h: number) => {
      const b = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
      b.writeUInt32BE(13, 8);
      b.write("IHDR", 12);
      b.writeUInt32BE(w, 16);
      b.writeUInt32BE(h, 20);
      return b;
    };
    writeFileSync(join(evDir, "strip.png"), png(1902, 683));
    writeFileSync(join(evDir, "frame.png"), png(1600, 900));
    writeFileSync(
      join(evDir, "grounding.json"),
      JSON.stringify([
        { kind: "rendered-figure", file: "evidence/b3/strip.png", note: "three panels" },
        { kind: "rendered-figure", file: "evidence/b3/frame.png", note: "one panel" },
        { kind: "citation", url: "https://example.org/x", note: "src" },
      ]),
    );
    run(ws, "evidence", "--set", "plexus", "--beat", "b3", "--file", join(evDir, "grounding.json"));
    const report = JSON.parse(run(ws, "audit", "--set", "plexus").out);
    const b3 = report.beats.find((b: { id: string }) => b.id === "b3");
    expect(b3.problems).toEqual(["figure evidence/b3/strip.png is 2.78:1 — outside the reference range 0.4-2.5; split it or reframe it (16:9 / 4:3)"]);
  });

  test("re-landing the outline keeps evidence already committed", () => {
    const ws = fresh();
    run(ws, "init", "--set", "plexus", "--title", "t");
    writeFileSync(join(ws, "outline.json"), JSON.stringify(BEATS));
    run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    const evDir = join(ws, "plexus", "evidence", "b3");
    mkdirSync(evDir, { recursive: true });
    writeFileSync(join(evDir, "grounding.json"), JSON.stringify([{ kind: "citation", url: "https://example.org/fourier", note: "1822 年的论文" }]));
    run(ws, "evidence", "--set", "plexus", "--beat", "b3", "--file", join(evDir, "grounding.json"));
    run(ws, "outline", "--set", "plexus", "--file", join(ws, "outline.json"));
    expect(readCourse(ws).outline[2].evidence).toEqual([{ kind: "citation", url: "https://example.org/fourier", note: "1822 年的论文" }]);
  });
});
