/**
 * The screenplay — the whole main line of a course, written in one call.
 *
 * Everything here runs against a fake `chat`: the library's job is not to
 * talk to a model, it is to (a) state the discipline once, (b) refuse a
 * draft that would waste a paid shoot (a script that cannot be spoken in
 * its clip, a figure that is not on disk, a beat without a scene), and
 * (c) land the result as a tree the play manager can render without ever
 * asking an agent what a node means.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CourseLike } from "../skill/scripts/segment-lib.mjs";
import type { Screenplay, ScreenplayScene } from "../skill/scripts/screenplay-lib.mjs";
import {
  buildShotPrompt,
  figureBudget,
  landScreenplay,
  validateScreenplay,
  writeDetourScene,
  writeScreenplay,
} from "../skill/scripts/screenplay-lib.mjs";

const RECIPE = "Hand-drawn chalkboard animation: white chalk on dark green slate.";

/** A three-beat course; only b2 has a rendered figure, and it exists. */
function tempSet(): string {
  const dir = mkdtempSync(join(tmpdir(), "plotwise-screenplay-"));
  mkdirSync(join(dir, "evidence", "b2"), { recursive: true });
  writeFileSync(join(dir, "evidence", "b2", "prior.png"), "not-really-a-png");
  writeFileSync(join(dir, "course.json"), `${JSON.stringify(course(), null, 2)}\n`);
  return dir;
}

function course(): CourseLike {
  return {
    title: "贝叶斯是什么",
    topic: "贝叶斯定理",
    goal: "让人会用先验",
    language: "zh",
    style: { id: "chalkboard", status: "confirmed", recipe: RECIPE },
    outline: [
      { id: "b1", title: "为什么要更新信念", summary: "从一次误诊说起", tier: "world-knowledge", evidence: [] },
      {
        id: "b2",
        title: "先验：把瞎猜变成数字",
        summary: "先验是起点",
        tier: "code-verification",
        evidence: [{ kind: "rendered-figure", file: "evidence/b2/prior.png", note: "先验分布" }],
      },
      { id: "b3", title: "更新：证据怎么改数字", summary: "乘上似然", tier: "world-knowledge", evidence: [] },
    ],
    rootNode: "",
    path: [],
    nodes: {},
  };
}

/** A well-formed scene for beat `id`, `shots` shots of 10s each. */
function scene(beat: string, label: string, shots = 1, figures: string[] = []): unknown {
  return {
    beat,
    label,
    shots: Array.from({ length: shots }, (_, i) => ({
      script: `这一拍讲的是第${i + 1}段内容，先接住上一句，再把这一步说清楚。`,
      visual: "Chalk lines build a curve on the slate.",
      duration: 10,
      figures: i === 0 ? figures : [],
    })),
    detour: { label: "举个例子", brief: "用一次核酸检测把先验讲成具体数字，最后回到主线的更新公式。" },
  };
}

function fullDraft(): unknown {
  return {
    scenes: [
      scene("b1", "从一次误诊说起"),
      scene("b2", "先验：把瞎猜变成数字", 3, ["evidence/b2/prior.png"]),
      scene("b3", "更新：证据怎么改数字", 2),
    ],
  };
}

const validate = (raw: unknown, setDir: string) =>
  validateScreenplay(raw, { course: course(), language: "zh", setDir });

describe("validateScreenplay", () => {
  test("a well-formed draft passes clean and comes back normalized", () => {
    const setDir = tempSet();
    const { scenes, problems } = validate(fullDraft(), setDir);
    expect(problems).toEqual([]);
    expect(scenes.map((s) => s.beat)).toEqual(["b1", "b2", "b3"]);
    expect(scenes.map((s) => s.shots.length)).toEqual([1, 3, 2]);
    expect(scenes[1].shots[0].figures).toEqual(["evidence/b2/prior.png"]);
    expect(scenes[0].detour).toEqual({ label: "举个例子", brief: "用一次核酸检测把先验讲成具体数字，最后回到主线的更新公式。" });
  });

  test("a script that cannot be spoken in its clip is named by scene and shot", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ shots: Array<{ script: string; duration: number }> }> };
    // 10s of Chinese is ~48 units; the hard cap is 1.4x that.
    draft.scenes[1].shots[1].script = "字".repeat(120);
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 2 (b2) shot 2");
    expect(problems[0]).toMatch(/speech units/);
    // The scene still comes back — the caller decides whether to shoot it.
    expect(scenes[1].shots[1].script).toBe("字".repeat(120));
  });

  test("a figure that is not a rendered figure of the beat is refused", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ shots: Array<{ figures: string[] }> }> };
    draft.scenes[0].shots[0].figures = ["evidence/b1/ghost.png"];
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 1 (b1) shot 1");
    expect(problems[0]).toContain("evidence/b1/ghost.png");
    // Normalization drops it: a shoot never binds a figure that is not there.
    expect(scenes[0].shots[0].figures).toEqual([]);
  });

  test("a beat without a scene is a problem, and the beats that are there still land", () => {
    const setDir = tempSet();
    const { problems, scenes } = validate({ scenes: [scene("b1", "a"), scene("b2", "b")] }, setDir);
    expect(scenes.length).toBe(2);
    expect(problems.some((p) => p.includes("3 beats") && p.includes("2 scene"))).toBe(true);
  });

  test("a duration outside 5-15s is a problem and is clamped", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ shots: Array<{ duration: number }> }> };
    draft.scenes[2].shots[0].duration = 24;
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 3 (b3) shot 1");
    expect(problems[0]).toContain("24");
    expect(scenes[2].shots[0].duration).toBe(15);
  });

  test("a scene with no shots, or more than six, is refused", () => {
    const setDir = tempSet();
    const empty = { scenes: [scene("b1", "a", 0), scene("b2", "b"), scene("b3", "c")] };
    expect(validate(empty, setDir).problems.some((p) => p.includes("scene 1 (b1)") && p.includes("0 shots"))).toBe(true);
    const many = { scenes: [scene("b1", "a"), scene("b2", "b", 7), scene("b3", "c")] };
    expect(validate(many, setDir).problems.some((p) => p.includes("scene 2 (b2)") && p.includes("7 shots"))).toBe(true);
  });

  test("more figures than the shoot can bind is reported, not silently dropped later", () => {
    const setDir = tempSet();
    mkdirSync(join(setDir, "evidence", "b1"), { recursive: true });
    const many: string[] = [];
    for (const name of ["a.png", "b.png", "c.png", "d.png"]) {
      writeFileSync(join(setDir, "evidence", "b1", name), "x");
      many.push(`evidence/b1/${name}`);
    }
    const draft = fullDraft() as { scenes: Array<{ shots: Array<{ figures: string[] }> }> };
    draft.scenes[0].shots[0].figures = many;
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 1 (b1) shot 1");
    expect(problems[0]).toContain("4 figures");
    expect(problems[0]).toContain("at most 3");
    // They are all kept: the writer bound them, and the caller decides.
    expect(scenes[0].shots[0].figures).toEqual(many);

    // A course with a recurring character has one slot fewer: the same
    // three figures that fit above are now one too many — the manager
    // would fail that shot at the shoot, so the writer hears it here.
    const withHost = course();
    withHost.style = { ...withHost.style, refImages: ["style/anchor.png", "style/host.png"] };
    expect(figureBudget(withHost)).toBe(2);
    draft.scenes[0].shots[0].figures = many.slice(0, 3);
    const capped = validateScreenplay(draft, { course: withHost, language: "zh", setDir });
    expect(capped.problems.length).toBe(1);
    expect(capped.problems[0]).toContain("3 figures");
    expect(capped.problems[0]).toContain("at most 2");
    expect(capped.problems[0]).toContain("recurring characters");
    // Without a character the three fit again.
    expect(validate(draft, setDir).problems).toEqual([]);
  });

  test("a scene without a detour brief is a problem", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ detour?: unknown }> };
    delete draft.scenes[2].detour;
    const { problems } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("scene 3 (b3)") && p.includes("detour"))).toBe(true);
  });
});

describe("landScreenplay", () => {
  function landed() {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    return { c: landScreenplay(course(), scenes, { language: "zh" }), scenes };
  }

  test("the main line becomes n1..nK with a detour stub hanging off each", () => {
    const { c, scenes } = landed();
    expect(c.rootNode).toBe("n1");
    expect(c.path).toEqual([]);
    expect(Object.keys(c.nodes ?? {}).sort()).toEqual(["n1", "n1d", "n2", "n2d", "n3", "n3d"]);

    const n2 = c.nodes!.n2;
    expect(n2).toMatchObject({
      beat: "b2",
      kind: "main",
      parent: "n1",
      choiceLabel: "先验：把瞎猜变成数字",
      status: "planned",
    });
    expect(n2.children).toEqual([
      { nodeId: "n3", label: "继续：更新：证据怎么改数字" },
      { nodeId: "n2d", label: "举个例子" },
    ]);
    expect((n2.shots as unknown[]).length).toBe(3);
    expect(n2.shots![0]).toMatchObject({
      id: "s1",
      script: scenes[1].shots[0].script,
      visual: "Chalk lines build a curve on the slate.",
      duration: 10,
      figures: ["evidence/b2/prior.png"],
      status: "planned",
    });
    expect(String(n2.shots![0].videoPrompt)).toContain("integrated_multimodal_description:");

    // The root has no parent; the last scene has no "continue" child.
    expect(c.nodes!.n1.parent).toBeUndefined();
    expect(c.nodes!.n3.children).toEqual([{ nodeId: "n3d", label: "举个例子" }]);

    // Detour stubs are scripted later — they carry a brief and no shots.
    expect(c.nodes!.n2d).toMatchObject({
      kind: "branch",
      parent: "n2",
      beat: "b2",
      choiceLabel: "举个例子",
      brief: "用一次核酸检测把先验讲成具体数字，最后回到主线的更新公式。",
      status: "planned",
    });
    expect(c.nodes!.n2d.shots).toEqual([]);
    // The detour returns to the spine where the learner left it.
    expect(c.nodes!.n2d.children).toEqual([{ nodeId: "n3", label: "回到主线：更新：证据怎么改数字" }]);

    // The outline, the style and the title are the planner's, not ours.
    expect(c.outline?.length).toBe(3);
    expect(c.style?.id).toBe("chalkboard");
    expect(c.title).toBe("贝叶斯是什么");
  });

  test("an English course says Next instead of 继续", () => {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    const c = landScreenplay(course(), scenes, { language: "en" });
    expect(c.nodes!.n1.children![0]).toEqual({ nodeId: "n2", label: "Next: 先验：把瞎猜变成数字" });
  });

  test("re-landing rewrites the plan but never a scene that has a video", () => {
    const { c } = landed();
    c.nodes!.n1.status = "ready";
    c.nodes!.n1.video = { file: "nodes/n1/video.mp4", duration: 41.2 };
    (c.nodes!.n1.shots as Array<Record<string, unknown>>)[0].video = { file: "nodes/n1/s1.mp4", duration: 10.1 };
    c.nodes!.n2.status = "failed";
    c.path = ["n1"];

    const setDir = tempSet();
    const redraft = fullDraft() as { scenes: Array<{ label: string; shots: Array<{ script: string }> }> };
    redraft.scenes[0].shots[0].script = "重写过的第一段。";
    redraft.scenes[1].label = "先验，换个说法";
    const { scenes } = validate(redraft, setDir);
    landScreenplay(c, scenes, { language: "zh" });

    // Shot on film: untouched, including its shots and its video.
    expect(c.nodes!.n1.status).toBe("ready");
    expect(c.nodes!.n1.video).toEqual({ file: "nodes/n1/video.mp4", duration: 41.2 });
    expect((c.nodes!.n1.shots as Array<Record<string, unknown>>)[0].script).not.toBe("重写过的第一段。");
    // ...but its outgoing links follow the new plan, so the card the
    // learner presses cannot advertise a scene that no longer says that.
    expect(c.nodes!.n1.children).toEqual([
      { nodeId: "n2", label: "继续：先验，换个说法" },
      { nodeId: "n1d", label: "举个例子" },
    ]);

    // Only planned: replaced outright.
    expect(c.nodes!.n2.status).toBe("planned");
    expect(c.nodes!.n2.choiceLabel).toBe("先验，换个说法");
    expect(c.path).toEqual(["n1"]);
  });
});

describe("buildShotPrompt", () => {
  const shot = {
    script: "先验就是你还没看证据时的猜测。",
    visual: "A chalk bell curve is drawn across the slate.",
    duration: 10,
    figures: ["evidence/b2/prior.png"],
  };

  test("the narration rides verbatim inside the tagged clause, and no binding is named", () => {
    const prompt = buildShotPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      shot,
      sceneGoal: "先验：把瞎猜变成数字",
      hasParentFrame: true,
      isSceneOpening: false,
    });
    expect(prompt).toContain(`<d>[Chinese] ${shot.script}</d>`);
    // The manager numbers the references at shoot time (injectBindings).
    expect(prompt).not.toMatch(/Image \d/);
    expect(prompt).toContain('reference figure "prior.png"');
    expect(prompt.split("\n")[0].startsWith("integrated_multimodal_description: [Shot 1] One continuous shot, no cuts. Style anchor: ")).toBe(true);
    expect(prompt).toContain("\noverall_soundscape:");
    expect(prompt).toContain("\nnon_diegetic_music: N/A");
    expect(prompt).toContain(RECIPE);
    expect(prompt).toContain("continues seamlessly");
  });

  test("a shot's beats and sound survive validation and landing, and a beat without a camera is named", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ shots: Array<Record<string, unknown>> }> };
    draft.scenes[0].shots[0].beats = [
      { from: 0, to: 4, action: "chalk lines sketch the slate", camera: "the camera holds still" },
      { from: 4, to: 10, action: "the curve rises" },
    ];
    draft.scenes[0].shots[0].sound = "quiet classroom tone, a chalk tap at 4s";
    const { scenes, problems } = validate(draft, setDir);
    expect(problems).toEqual([expect.stringContaining("scene 1 (b1) shot 1 beat 2: no camera")]);
    expect(scenes[0].shots[0].beats).toHaveLength(2);
    expect(scenes[0].shots[0].sound).toBe("quiet classroom tone, a chalk tap at 4s");
    const c = landScreenplay(course(), scenes, { language: "zh", styleRecipe: RECIPE, narration: "voiceover" });
    const landed = c.nodes!.n1.shots[0];
    expect(landed.beats).toHaveLength(2);
    expect(landed.sound).toBe("quiet classroom tone, a chalk tap at 4s");
    expect(landed.videoPrompt).toContain("Timeline of this one continuous take: 0-4s — chalk lines sketch the slate. The camera holds still.");
    expect(landed.videoPrompt).toContain("overall_soundscape: Quiet classroom tone, a chalk tap at 4s. Nothing louder than the voice.");
    // A shot without beats still lands with a prompt.
    expect(c.nodes!.n2.shots[0].beats).toBeUndefined();
    expect(String(c.nodes!.n2.shots[0].videoPrompt)).toContain("integrated_multimodal_description:");
  });

  test("on-camera speaks on screen; a scene opening establishes instead of continuing", () => {
    const prompt = buildShotPrompt({
      styleRecipe: RECIPE,
      narration: "on-camera",
      language: "en",
      shot: { ...shot, script: "A prior is your guess before the evidence.", figures: [] },
      sceneGoal: "priors",
      hasParentFrame: true,
      isSceneOpening: true,
    });
    expect(prompt).toContain("<d>[English] A prior is your guess before the evidence.</d>");
    expect(prompt).toContain("(S1)");
    expect(prompt).not.toContain("continues seamlessly");
    expect(prompt).not.toContain("off-screen voiceover");
    expect(prompt).not.toMatch(/reference figure/);
  });
});

describe("writeScreenplay", () => {
  test("one call for the whole line when the model answers well", async () => {
    const setDir = tempSet();
    const calls: Array<{ system: string; user: string }> = [];
    const chat = async (req: { system: string; user: string }) => {
      calls.push(req);
      return fullDraft() as Record<string, unknown>;
    };
    const out = await writeScreenplay({
      course: course(),
      chat,
      setDir,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
    });
    expect(out.mode).toBe("single");
    expect(out.problems).toEqual([]);
    expect(out.scenes.map((s) => s.beat)).toEqual(["b1", "b2", "b3"]);
    expect(calls.length).toBe(1);
    // The spine, the evidence index and the style all reach the writer.
    expect(calls[0].user).toContain("b2");
    expect(calls[0].user).toContain("evidence/b2/prior.png");
    expect(calls[0].user).toContain(RECIPE);
  });

  test("a thrown call falls back to one call per scene, each carrying the last", async () => {
    const setDir = tempSet();
    const users: string[] = [];
    let first = true;
    const chat = async (req: { system: string; user: string }) => {
      if (first) {
        first = false;
        throw new Error("OpenRouter returned HTTP 503");
      }
      users.push(req.user);
      const beat = ["b1", "b2", "b3"][users.length - 1];
      return { scenes: [scene(beat, `第${users.length}幕`)] } as Record<string, unknown>;
    };
    const out = await writeScreenplay({
      course: course(),
      chat,
      setDir,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
    });
    expect(out.mode).toBe("fallback");
    expect(out.scenes.map((s) => s.beat)).toEqual(["b1", "b2", "b3"]);
    expect(users.length).toBe(3);
    // Why we fell back is reported, never swallowed.
    expect(out.problems.some((p) => p.includes("503"))).toBe(true);
    // Scene 2 is written knowing what scene 1 said.
    expect(users[1]).toContain("第1幕");
  });

  test("a short answer also falls back — a missing beat is a hole in the spine", async () => {
    const setDir = tempSet();
    let calls = 0;
    const chat = async (req: { system: string; user: string }) => {
      calls += 1;
      if (calls === 1) return { scenes: [scene("b1", "a"), scene("b2", "b")] } as Record<string, unknown>;
      const beat = ["b1", "b2", "b3"][calls - 2];
      return { scenes: [scene(beat, `幕${calls - 1}`)] } as Record<string, unknown>;
    };
    const out = await writeScreenplay({
      course: course(),
      chat,
      setDir,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
    });
    expect(out.mode).toBe("fallback");
    expect(out.scenes.length).toBe(3);
    expect(calls).toBe(4);
  });
});

describe("writeDetourScene", () => {
  const stub = {
    kind: "branch",
    parent: "n2",
    beat: "b2",
    choiceLabel: "举个例子",
    brief: "用一次核酸检测把先验讲成具体数字。",
    status: "planned",
    shots: [],
    children: [],
  };

  test("a stub with a brief becomes shots ready to shoot", async () => {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    const c = landScreenplay(course(), scenes, { language: "zh" });
    let seen = { system: "", user: "" };
    const chat = async (req: { system: string; user: string }) => {
      seen = req;
      return {
        shots: [
          { script: "假设一千个人里有一个真的病了。", visual: "Chalk figures line up.", duration: 8, figures: [] },
          { script: "把这一千个人的比例写成先验，就是千分之一。", visual: "The ratio is written as a fraction.", duration: 9, figures: ["evidence/b2/prior.png"] },
        ],
      } as Record<string, unknown>;
    };
    const { shots, problems } = await writeDetourScene({
      course: c,
      node: c.nodes!.n2d,
      chat,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      setDir,
    });
    expect(problems).toEqual([]);
    expect(shots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(shots[1].figures).toEqual(["evidence/b2/prior.png"]);
    expect(shots[0].status).toBe("planned");
    expect(shots[0].videoPrompt).toContain("<d>[Chinese] 假设一千个人里有一个真的病了。</d>");
    // The brief and the scene it hangs off both reach the writer.
    expect(seen.user).toContain(c.nodes.n2d.brief as string);
    expect(seen.user).toContain(scenes[1].shots[0].script);
  });

  test("the same per-shot checks apply, and a stub without a brief is an error", async () => {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    const c = landScreenplay(course(), scenes, { language: "zh" });
    const chat = async () =>
      ({ shots: [{ script: "字".repeat(200), visual: "v", duration: 8, figures: ["evidence/b9/nope.png"] }] }) as Record<string, unknown>;
    const { shots, problems } = await writeDetourScene({
      course: c,
      node: { ...stub },
      chat,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      setDir,
    });
    expect(shots.length).toBe(1);
    expect(shots[0].figures).toEqual([]);
    expect(problems.length).toBe(2);
    expect(problems.join(" ")).toContain("speech units");
    expect(problems.join(" ")).toContain("evidence/b9/nope.png");

    await expect(
      writeDetourScene({
        course: c,
        node: { ...stub, brief: "" },
        chat,
        styleRecipe: RECIPE,
        narration: "voiceover",
        language: "zh",
        setDir,
      }),
    ).rejects.toThrow(/brief/);
  });
});

describe("write-screenplay.mjs", () => {
  const SCRIPT = join(import.meta.dir, "..", "skill", "scripts", "write-screenplay.mjs");
  function run(cwd: string, argv: string[], env: Record<string, string> = {}) {
    const r = Bun.spawnSync([process.execPath, SCRIPT, ...argv], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      // A key inherited from the developer's shell would make this suite
      // call OpenRouter for real; PATH is all the script needs.
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  test("it refuses an empty outline, an unconfirmed style, and a missing key — each with its own reason", () => {
    const setDir = tempSet();
    const bare = course();
    bare.outline = [];
    writeFileSync(join(setDir, "course.json"), JSON.stringify(bare, null, 2));
    const noOutline = run(setDir, ["--set", setDir]);
    expect(noOutline.code).toBe(1);
    expect(noOutline.err).toMatch(/outline/);

    const pending = course();
    pending.style = { id: "chalkboard", status: "sampled", recipe: RECIPE };
    writeFileSync(join(setDir, "course.json"), JSON.stringify(pending, null, 2));
    const noStyle = run(setDir, ["--set", setDir]);
    expect(noStyle.code).toBe(1);
    expect(noStyle.err).toMatch(/style/);

    writeFileSync(join(setDir, "course.json"), JSON.stringify(course(), null, 2));
    const noKey = run(setDir, ["--set", setDir]);
    expect(noKey.code).toBe(1);
    expect(noKey.err).toMatch(/OPENROUTER_API_KEY/);
  });
});

// Type-level: the exported shapes are what the manager reads off disk.
const _shape: (s: Screenplay) => ScreenplayScene[] = (s) => s.scenes;
void _shape;
