/**
 * The screenplay — the whole main line of a course, written in one call.
 *
 * Everything here runs against a fake `chat`: the library's job is not to
 * talk to a model, it is to (a) state the directing discipline once,
 * (b) refuse a draft that would waste a paid shoot (a narration that
 * cannot be spoken in its clip, a one-take "montage", a figure that is
 * not on disk, a beat without a scene), and (c) land the result as a tree
 * the play manager can render without ever asking an agent what a node
 * means.
 *
 * The fixture `fixtures/w1-papercraft-scene.json` is the W1 trial's own
 * shot list — a montage that was shot at published quality. It must pass
 * the validator clean, forever: it is the standard the writer is held to.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CourseLike } from "../skill/scripts/segment-lib.mjs";
import type { Screenplay, ScreenplayScene } from "../skill/scripts/screenplay-lib.mjs";
import {
  SAMPLE_SYSTEM,
  buildClipPrompt,
  figureBudget,
  landScreenplay,
  sampleUser,
  validateSampleClip,
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

/** A well-formed montage clip of `duration` seconds with four cuts. */
function clip(index: number, figures: string[] = [], duration = 15): Record<string, unknown> {
  const q = duration / 4;
  return {
    duration,
    theme: `第${index}段：粉笔把这一步画出来`,
    cuts: [
      { from: 0, to: q, shot: "白粉笔在深绿石板上点出一个小圆", camera: "俯拍", ...(figures.length ? { figures } : {}) },
      { from: q, to: q * 2, shot: "小圆旁边长出第二个圆，两者用一条短线连起来", camera: "缓慢推进" },
      { from: q * 2, to: q * 3, shot: "更多圆沿着一条弧线排开，粉笔灰轻轻落下", camera: "横移" },
      { from: q * 3, to: duration, shot: "整条弧线亮起来，末端明显翘起", camera: "固定镜头" },
    ],
    // ~60 characters for 15 s: inside the density band the model speaks
    // cleanly (under ~50 it pads the silence, over ~80 it garbles).
    narration: [
      { from: 0, to: duration / 2, text: `第${index}段先接住上一句话，把刚才留下的那个问题重新摆到桌面上来。` },
      { from: duration / 2, to: duration, text: "再把这一步说清楚，让每一个粉笔圆点都有它自己的位置和意思。" },
    ],
    audio: "安静的教室底噪；粉笔点在石板上的轻响落在第一拍",
    negatives: "不要出现彩色、照片质感、格线",
  };
}

/** A well-formed scene for beat `id`, with `clips` montage clips. */
function scene(beat: string, label: string, clips = 1, figures: string[] = []): unknown {
  return {
    beat,
    label,
    device: "用粉笔圆点表示一个个病例，圆点越多，判断越有底",
    clips: Array.from({ length: clips }, (_, i) => clip(i + 1, i === 0 ? figures : [])),
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
    expect(scenes.map((s) => s.clips.length)).toEqual([1, 3, 2]);
    expect(scenes.map((s) => s.clips[0].cuts.length)).toEqual([4, 4, 4]);
    expect(scenes[1].clips[0].figures).toEqual(["evidence/b2/prior.png"]);
    expect(scenes[1].clips[0].cuts[0].figures).toEqual(["evidence/b2/prior.png"]);
    expect(scenes[0].device).toContain("粉笔圆点");
    expect(scenes[0].detour).toEqual({ label: "举个例子", brief: "用一次核酸检测把先验讲成具体数字，最后回到主线的更新公式。" });
  });

  test("the W1 montage — the standard the writer is held to — passes clean", () => {
    const setDir = tempSet();
    const w1 = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "w1-papercraft-scene.json"), "utf-8"));
    const { scenes, problems } = validateScreenplay(
      { scenes: [w1] },
      { course: { ...course(), outline: [course().outline![0]] } as CourseLike, language: "zh", setDir },
    );
    // W1 is the GRAMMAR standard. Its narration (40 characters over 15 s)
    // is under the density floor measured later the same day at 480P
    // reference-to-video — the one thing the validator now says about it.
    expect(problems).toEqual([expect.stringContaining("under the 50-unit floor")]);
    expect(scenes[0].clips[0].cuts).toHaveLength(8);
    expect(scenes[0].clips[0].narration).toHaveLength(5);
    expect(scenes[0].clips[0].figures).toEqual([]);
  });

  test("a narration over the density ceiling is reported before the cap is reached", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
    // 95 characters in 15 s: inside the 101 hard cap, over the 90 ceiling.
    draft.scenes[0].clips[0].narration = [{ from: 0, to: 15, text: "字".repeat(95) }];
    const { problems } = validate(draft, setDir);
    expect(problems).toEqual([expect.stringContaining("over the 90-unit ceiling — the model garbles a stretch to fit")]);
  });

  test("a sparse narration is reported: the model pads unspoken seconds", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
    draft.scenes[0].clips[0].narration = [{ from: 0, to: 15, text: "一枚硬币先长出一枚新硬币。" }];
    const { problems } = validate(draft, setDir);
    expect(problems).toEqual([expect.stringContaining("scene 1 (b1) clip 1: the narration is 12 speech units for 15s, under the 50-unit floor")]);
  });

  test("a narration that cannot be spoken in its clip is named by scene and clip", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
    // 15s of Chinese is ~72 units; the hard cap is 1.4x that.
    draft.scenes[1].clips[1].narration = [{ from: 0, to: 15, text: "字".repeat(140) }];
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 2 (b2) clip 2");
    expect(problems[0]).toMatch(/speech units/);
    // The scene still comes back — the caller decides whether to shoot it.
    expect(scenes[1].clips[1].narration[0].text).toBe("字".repeat(140));
    // The brief states the band the validator enforces.
    expect(problems[0]).not.toContain("floor");
  });

  test("a one-take clip is refused: a montage is cuts", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ cuts: unknown[] }> }> };
    draft.scenes[0].clips[0].cuts = [{ from: 0, to: 15, shot: "粉笔慢慢画出一整条曲线", camera: "缓慢推进" }];
    const { problems } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("scene 1 (b1) clip 1") && p.includes("1 cut in 15s"))).toBe(true);
    expect(problems.some((p) => p.includes("one long take is what this format exists to replace"))).toBe(true);
  });

  test("a gap in the timeline and a shot list that starts late are both reported", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ cuts: Array<{ from: number; to: number }> }> }> };
    const cuts = draft.scenes[2].clips[0].cuts;
    cuts[0].from = 2;
    cuts[2].from = cuts[1].to + 3;
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("the shot list starts at 2s"))).toBe(true);
    expect(problems.some((p) => p.includes("gap between cut 2 and cut 3"))).toBe(true);
    // Normalized: the clip is shootable from its first frame.
    expect(scenes[2].clips[0].cuts[0].from).toBe(0);
  });

  test("a figure that is not a rendered figure of the beat is refused, and its cut loses it", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ cuts: Array<{ figures?: string[] }> }> }> };
    draft.scenes[0].clips[0].cuts[0].figures = ["evidence/b1/ghost.png"];
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 1 (b1) clip 1");
    expect(problems[0]).toContain("evidence/b1/ghost.png");
    // Normalization drops it: a shoot never binds a figure that is not there.
    expect(scenes[0].clips[0].figures).toEqual([]);
    expect(scenes[0].clips[0].cuts[0].figures).toBeUndefined();
  });

  test("writing on screen with no figure to reproduce is called out", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ cuts: Array<{ shot: string }> }> }> };
    draft.scenes[2].clips[0].cuts[1].shot = "粉笔在石板上写下 P(A|B) = P(B|A)P(A)/P(B)";
    const { problems } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("scene 3 (b3) clip 1 cut 2") && p.includes("no figure to reproduce"))).toBe(true);
  });

  test("a beat without a scene is a problem, and the beats that are there still land", () => {
    const setDir = tempSet();
    const { problems, scenes } = validate({ scenes: [scene("b1", "a"), scene("b2", "b")] }, setDir);
    expect(scenes.length).toBe(2);
    expect(problems.some((p) => p.includes("3 beats") && p.includes("2 scene"))).toBe(true);
  });

  test("a duration outside 8-15s is a problem and is clamped", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ duration: number }> }> };
    draft.scenes[2].clips[0].duration = 24;
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("scene 3 (b3) clip 1") && p.includes("24"))).toBe(true);
    expect(scenes[2].clips[0].duration).toBe(15);
    // The cuts are clamped with it, and the last one carries to the end.
    expect(scenes[2].clips[0].cuts[3].to).toBe(15);
  });

  test("a scene with no clips, or more than three, is refused", () => {
    const setDir = tempSet();
    const empty = { scenes: [scene("b1", "a", 0), scene("b2", "b"), scene("b3", "c")] };
    expect(validate(empty, setDir).problems.some((p) => p.includes("scene 1 (b1)") && p.includes("0 clips"))).toBe(true);
    const many = { scenes: [scene("b1", "a"), scene("b2", "b", 4), scene("b3", "c")] };
    expect(validate(many, setDir).problems.some((p) => p.includes("scene 2 (b2)") && p.includes("4 clips"))).toBe(true);
  });

  test("more figures than the shoot can bind is reported, not silently dropped later", () => {
    const setDir = tempSet();
    mkdirSync(join(setDir, "evidence", "b1"), { recursive: true });
    const many: string[] = [];
    for (const name of ["a.png", "b.png", "c.png", "d.png"]) {
      writeFileSync(join(setDir, "evidence", "b1", name), "x");
      many.push(`evidence/b1/${name}`);
    }
    const draft = fullDraft() as { scenes: Array<{ clips: Array<{ cuts: Array<{ figures?: string[] }> }> }> };
    draft.scenes[0].clips[0].cuts[0].figures = many;
    const { problems, scenes } = validate(draft, setDir);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain("scene 1 (b1) clip 1");
    expect(problems[0]).toContain("4 figures");
    expect(problems[0]).toContain("at most 3");
    // They are all kept: the writer bound them, and the caller decides.
    expect(scenes[0].clips[0].figures).toEqual(many);

    // A course with a recurring character has one slot fewer: the same
    // three figures that fit above are now one too many — the manager
    // would fail that clip at the shoot, so the writer hears it here.
    const withHost = course();
    withHost.style = { ...withHost.style, refImages: ["style/anchor.png", "style/host.png"] };
    expect(figureBudget(withHost)).toBe(2);
    draft.scenes[0].clips[0].cuts[0].figures = many.slice(0, 3);
    const capped = validateScreenplay(draft, { course: withHost, language: "zh", setDir });
    expect(capped.problems.length).toBe(1);
    expect(capped.problems[0]).toContain("3 figures");
    expect(capped.problems[0]).toContain("at most 2");
    expect(capped.problems[0]).toContain("recurring characters");
    // Without a character the three fit again.
    expect(validate(draft, setDir).problems).toEqual([]);
  });

  test("a scene without a device, or without a detour brief, is a problem", () => {
    const setDir = tempSet();
    const draft = fullDraft() as { scenes: Array<{ detour?: unknown; device?: unknown }> };
    delete draft.scenes[2].detour;
    delete draft.scenes[0].device;
    const { problems } = validate(draft, setDir);
    expect(problems.some((p) => p.includes("scene 3 (b3)") && p.includes("detour"))).toBe(true);
    expect(problems.some((p) => p.includes("scene 1 (b1)") && p.includes("visual device"))).toBe(true);
  });

  test("a device the planner wrote on the beat carries the scene when the writer omits one", () => {
    const setDir = tempSet();
    const planned = course();
    planned.outline![0] = { ...planned.outline![0], device: "一枚硬币长出第二枚硬币" };
    const draft = fullDraft() as { scenes: Array<{ device?: unknown }> };
    delete draft.scenes[0].device;
    const { scenes, problems } = validateScreenplay(draft, { course: planned, language: "zh", setDir });
    expect(scenes[0].device).toBe("一枚硬币长出第二枚硬币");
    expect(problems.some((p) => p.includes("visual device"))).toBe(false);
  });
});

describe("landScreenplay", () => {
  function landed() {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    return { c: landScreenplay(course(), scenes, { language: "zh", styleRecipe: RECIPE, narration: "voiceover" }), scenes };
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
    expect(n2.device).toContain("粉笔圆点");
    expect(n2.children).toEqual([
      { nodeId: "n3", label: "继续：更新：证据怎么改数字" },
      { nodeId: "n2d", label: "举个例子" },
    ]);
    expect((n2.clips as unknown[]).length).toBe(3);
    expect(n2.clips![0]).toMatchObject({
      id: "c1",
      duration: 15,
      figures: ["evidence/b2/prior.png"],
      status: "planned",
    });
    expect(n2.clips![0].cuts).toHaveLength(4);
    expect(n2.clips![0].narration[0].text).toBe(scenes[1].clips[0].narration[0].text);

    // The prompt is assembled at landing, in the montage grammar.
    const prompt = String(n2.clips![0].videoPrompt);
    expect(prompt.startsWith(`1. Style anchor: ${RECIPE}`)).toBe(true);
    expect(prompt).toContain("2. Shot list — 4 cuts in 15s");
    expect(prompt).toContain("<d>[Chinese]");
    expect(prompt).toContain('reference figure "prior.png"');
    // A three-clip scene tells each clip which part it is.
    expect(prompt).toContain("This is part 1 of 3 of one continuous scene about 先验：把瞎猜变成数字");
    expect(String(n2.clips![2].videoPrompt)).toContain("This is part 3 of 3");
    // A single-clip scene says nothing about parts.
    expect(String(c.nodes!.n1.clips![0].videoPrompt)).not.toContain("This is part");

    // The root has no parent; the last scene has no "continue" child.
    expect(c.nodes!.n1.parent).toBeUndefined();
    expect(c.nodes!.n3.children).toEqual([{ nodeId: "n3d", label: "举个例子" }]);

    // Detour stubs are scripted later — they carry a brief and no clips.
    expect(c.nodes!.n2d).toMatchObject({
      kind: "branch",
      parent: "n2",
      beat: "b2",
      choiceLabel: "举个例子",
      brief: "用一次核酸检测把先验讲成具体数字，最后回到主线的更新公式。",
      status: "planned",
    });
    expect(c.nodes!.n2d.clips).toEqual([]);
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
    (c.nodes!.n1.clips as Array<Record<string, unknown>>)[0].video = { file: "nodes/n1/c1.mp4", duration: 15.1 };
    c.nodes!.n2.status = "failed";
    c.path = ["n1"];

    const setDir = tempSet();
    const redraft = fullDraft() as { scenes: Array<{ label: string; clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
    redraft.scenes[0].clips[0].narration[0].text = "重写过的第一段。";
    redraft.scenes[1].label = "先验，换个说法";
    const { scenes } = validate(redraft, setDir);
    landScreenplay(c, scenes, { language: "zh" });

    // Shot on film: untouched, including its clips and its video.
    expect(c.nodes!.n1.status).toBe("ready");
    expect(c.nodes!.n1.video).toEqual({ file: "nodes/n1/video.mp4", duration: 41.2 });
    expect((c.nodes!.n1.clips as Array<Record<string, unknown>>)[0].video).toEqual({ file: "nodes/n1/c1.mp4", duration: 15.1 });
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

describe("buildClipPrompt at the writer's seam", () => {
  test("the narration rides verbatim, and no binding is named at writing time", () => {
    const prompt = buildClipPrompt({
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      clip: clip(1, ["evidence/b2/prior.png"]) as never,
      part: { index: 2, total: 2, sceneGoal: "先验" },
    });
    expect(prompt).toContain("<d>[Chinese]第1段先接住上一句话，把刚才留下的那个问题重新摆到桌面上来。</d>");
    // The manager numbers the references at shoot time.
    expect(prompt).not.toMatch(/Image \d/);
    expect(prompt).toContain('reference figure "prior.png"');
    expect(prompt).toContain("This is part 2 of 2");
  });

  test("an on-camera course speaks on screen", () => {
    const prompt = buildClipPrompt({
      styleRecipe: "Live-action lesson with a warm instructor speaking to camera.",
      narration: "on-camera",
      language: "en",
      clip: {
        ...clip(1),
        narration: [{ from: 0, to: 8, text: "A prior is your guess before the evidence." }],
      } as never,
    });
    expect(prompt).toContain("<d>[English]A prior is your guess before the evidence.</d>");
    expect(prompt).toContain("(S1)");
    expect(prompt).not.toContain("off-screen voiceover");
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
    // The spine, the evidence index and the art direction all reach the writer.
    expect(calls[0].user).toContain("b2");
    expect(calls[0].user).toContain("evidence/b2/prior.png");
    expect(calls[0].user).toContain(RECIPE);
    // The look's graphic devices reach the writer when the caller has them.
    expect(calls[0].user).not.toContain("Graphic devices this look owns");
    const withDevices = { system: "", user: "" };
    await writeScreenplay({
      course: course(),
      chat: async (req) => {
        Object.assign(withDevices, req);
        return fullDraft() as Record<string, unknown>;
      },
      setDir,
      styleRecipe: RECIPE,
      styleDevices: "the top-down flat lay; a paper band used as an axis",
      narration: "voiceover",
      language: "zh",
    });
    expect(withDevices.user).toContain("Graphic devices this look owns — reach for them cut by cut so no two cuts share one framing: the top-down flat lay; a paper band used as an axis");
    // The brief is a director's brief: the device first, then the montage.
    expect(calls[0].system).toContain("THE VISUAL DEVICE COMES FIRST");
    expect(calls[0].system).toContain("A CLIP is a MONTAGE");
    expect(calls[0].system).toContain("Write every human-readable string in the course's language");
  });

  test("the course's visual bible reaches the writer when the planner wrote one", async () => {
    const setDir = tempSet();
    const planned = course();
    planned.visual = { bible: "整门课都在同一块石板上，粉笔不擦只叠", motifs: ["粉笔圆点"], neverDraw: ["坐标轴"] };
    let user = "";
    await writeScreenplay({
      course: planned,
      chat: async (req) => {
        user = req.user;
        return fullDraft() as Record<string, unknown>;
      },
      setDir,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
    });
    expect(user).toContain("整门课都在同一块石板上");
    expect(user).toContain("Recurring motifs: 粉笔圆点");
    expect(user).toContain("This course never draws: 坐标轴");
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
    // Scene 2 is written knowing what scene 1 said, and with what device.
    expect(users[1]).toContain("第1幕");
    expect(users[1]).toContain("Its device:");
  });

  test("a short answer also falls back — a missing beat is a hole in the spine", async () => {
    const setDir = tempSet();
    let calls = 0;
    const chat = async () => {
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
    clips: [],
    children: [],
  };

  test("a stub with a brief becomes clips ready to shoot", async () => {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    const c = landScreenplay(course(), scenes, { language: "zh", styleRecipe: RECIPE, narration: "voiceover" });
    let seen = { system: "", user: "" };
    const chat = async (req: { system: string; user: string }) => {
      seen = req;
      return {
        device: "用一千个粉笔小人里的一个被圈出来表示千分之一",
        clips: [clip(1), clip(2, ["evidence/b2/prior.png"])],
      } as Record<string, unknown>;
    };
    const { clips, device, problems } = await writeDetourScene({
      course: c,
      node: c.nodes!.n2d,
      chat,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      setDir,
    });
    expect(problems).toEqual([]);
    expect(clips.map((s) => s.id)).toEqual(["c1", "c2"]);
    expect(clips[1].figures).toEqual(["evidence/b2/prior.png"]);
    expect(clips[0].status).toBe("planned");
    expect(device).toContain("粉笔小人");
    expect(clips[0].videoPrompt).toContain("<d>[Chinese]第1段先接住上一句话，把刚才留下的那个问题重新摆到桌面上来。</d>");
    expect(clips[0].videoPrompt).toContain("This is part 1 of 2");
    // The brief and the scene it hangs off both reach the writer.
    expect(seen.user).toContain(c.nodes.n2d.brief as string);
    expect(seen.user).toContain(scenes[1].clips[0].narration[0].text);
  });

  test("the same per-clip checks apply, and a stub without a brief is an error", async () => {
    const setDir = tempSet();
    const { scenes } = validate(fullDraft(), setDir);
    const c = landScreenplay(course(), scenes, { language: "zh" });
    const chat = async () =>
      ({
        clips: [
          {
            ...clip(1),
            narration: [{ from: 0, to: 15, text: "字".repeat(200) }],
            cuts: [{ from: 0, to: 15, shot: "一整条曲线慢慢画完", camera: "缓慢推进", figures: ["evidence/b9/nope.png"] }],
          },
        ],
      }) as Record<string, unknown>;
    const { clips, problems } = await writeDetourScene({
      course: c,
      node: { ...stub },
      chat,
      styleRecipe: RECIPE,
      narration: "voiceover",
      language: "zh",
      setDir,
    });
    expect(clips.length).toBe(1);
    expect(clips[0].figures).toEqual([]);
    expect(problems.join(" ")).toContain("speech units");
    expect(problems.join(" ")).toContain("evidence/b9/nope.png");
    expect(problems.join(" ")).toContain("1 cut in 15s");

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

describe("a draft outside the density band is asked for once more", () => {
  test("the revision replaces the draft when it fixes the density", async () => {
    const setDir = tempSet();
    const asks: string[] = [];
    let round = 0;
    const chat = async (req: { system: string; user: string }) => {
      asks.push(req.user);
      round += 1;
      const d = fullDraft() as { scenes: Array<{ clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
      // The first draft starves scene 1's only clip; the revision fills it.
      if (round === 1) d.scenes[0].clips[0].narration = [{ from: 0, to: 15, text: "太短了。" }];
      return (round === 1 ? d : { scenes: [d.scenes[0]] }) as Record<string, unknown>;
    };
    const out = await writeScreenplay({ course: course(), chat, setDir, styleRecipe: RECIPE, narration: "voiceover", language: "zh" });
    expect(out.mode).toBe("single");
    expect(asks).toHaveLength(2);
    // The second ask is the scene lane, carrying what was wrong.
    expect(asks[1]).toContain("REVISION — your previous draft of this scene was refused");
    expect(asks[1]).toContain("under the 50-unit floor");
    expect(out.scenes[0].clips[0].narration[0].text).not.toBe("太短了。");
    expect(out.problems).toEqual(["scene 1 (b1): revised once for narration density"]);
  });

  test("a revision that is still outside the band leaves the first draft standing, and says so", async () => {
    const setDir = tempSet();
    const chat = async () => {
      const d = fullDraft() as { scenes: Array<{ clips: Array<{ narration: Array<{ from: number; to: number; text: string }> }> }> };
      d.scenes[0].clips[0].narration = [{ from: 0, to: 15, text: "太短了。" }];
      return d as Record<string, unknown>;
    };
    const out = await writeScreenplay({ course: course(), chat, setDir, styleRecipe: RECIPE, narration: "voiceover", language: "zh" });
    expect(out.scenes[0].clips[0].narration[0].text).toBe("太短了。");
    expect(out.problems.some((p) => p.includes("still outside the band — the first draft stands"))).toBe(true);
  });
});

describe("the style sample", () => {
  test("one clip, the same grammar, the hook spoken verbatim", () => {
    const raw = {
      theme: "纸片硬币开始繁殖",
      cuts: [
        { from: 0, to: 5, shot: "一枚纸片硬币静置在米白纸面上", camera: "俯拍" },
        { from: 5, to: 10, shot: "第二枚硬币从它边缘弹出", camera: "快速硬切" },
        { from: 10, to: 15, shot: "两枚一起滑向一条上升的纸带", camera: "跟随" },
      ],
      narration: [{ from: 0, to: 15, text: "钱为什么会自己变多？" }],
      audio: "轻微纸张摩擦；5 秒一声清脆纸响",
      negatives: "不要出现真实金属硬币",
    };
    const { clip, problems } = validateSampleClip(raw, { language: "zh", duration: 15 });
    // A sample speaks one hook line, so it is always under the density
    // floor; that is the one thing said about it, and the sampler ignores it.
    expect(problems).toEqual([expect.stringContaining("under the 50-unit floor")]);
    expect(clip?.duration).toBe(15);
    expect(clip?.cuts).toHaveLength(3);
    expect(clip?.narration[0].text).toBe("钱为什么会自己变多？");
    // A sample is shot before anything is rendered, so it never binds a figure.
    expect(clip?.figures).toEqual([]);
  });

  test("a sample that is one long take, or that shows nothing, is reported", () => {
    const oneTake = validateSampleClip(
      { cuts: [{ from: 0, to: 15, shot: "一枚硬币慢慢变多", camera: "缓慢推进" }], narration: [{ from: 0, to: 15, text: "钱为什么会自己变多？" }] },
      { language: "zh" },
    );
    expect(oneTake.problems.some((p) => p.includes("1 cut in 15s"))).toBe(true);
    const empty = validateSampleClip(null, { language: "zh" });
    expect(empty.clip).toBeNull();
    expect(empty.problems.some((p) => p.includes("0 clips"))).toBe(true);
  });

  test("the brief carries the topic, the hook, the device and the art direction", () => {
    const user = sampleUser({
      topic: "复利",
      goal: "看懂为什么钱会指数增长",
      hook: "钱为什么会自己变多？",
      action: "a coin buds a second coin, and both climb a rising band",
      styleRecipe: RECIPE,
      styleName: "chalkboard",
      narration: "voiceover",
      language: "zh",
      duration: 15,
    });
    expect(user).toContain("TOPIC: 复利");
    expect(user).toContain("钱为什么会自己变多？");
    expect(user).toContain("a coin buds a second coin");
    expect(user).toContain(RECIPE);
    expect(user).toContain("THE CLIP: 15 seconds.");
    expect(SAMPLE_SYSTEM).toContain("THE VISUAL DEVICE COMES FIRST");
    expect(SAMPLE_SYSTEM).toContain("spoken VERBATIM");
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
