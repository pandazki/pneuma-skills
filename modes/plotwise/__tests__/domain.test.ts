/**
 * Plotwise domain tests — the `Course` aggregate.
 *
 * course.json is written by agents and by `play-manager.mjs`; this
 * parse is the only structural truth the viewer has. Every field must
 * degrade to something renderable — a dropped note, an invented evidence
 * kind, a markdown heading in a script — never to a crash. The outline
 * is the attention anchor AND the evidence index the play loop shoots
 * against, so its per-beat references are pinned here too.
 */

import { describe, expect, test } from "bun:test";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { load, save } from "../domain.js";

function files(map: Record<string, string>): ViewerFileContent[] {
  return Object.entries(map).map(([path, content]) => ({ path, content }));
}

const COURSE = JSON.stringify({
  title: "勾股定理",
  topic: "Pythagorean theorem",
  goal: "state and use it",
  style: { id: "chalkboard", refImages: ["style/anchor.png"] },
  outline: [
    {
      id: "b1",
      title: "直角三角形",
      summary: "认识直角",
      tier: "world-knowledge",
      evidence: [{ kind: "world-knowledge", note: "textbook" }],
    },
    {
      id: "b2",
      title: "a²+b²=c²",
      tier: "code-verification",
      figures: ["evidence/b2/figure-345.png"],
      sources: "evidence/b2/sources.json",
      problems: [],
    },
    { id: "", title: "dropped — no id" },
    { id: "b3", title: "tier off-contract", tier: "vibes" },
  ],
  rootNode: "n1",
  path: ["n1", "n2"],
  nodes: {
    n1: { beat: "b1", kind: "main", choiceLabel: "开场", children: [{ nodeId: "n2", label: "继续" }, { nodeId: "" }], status: "ready", video: { file: "nodes/n1/video.mp4", duration: 5 } },
    n2: { parent: "n1", beat: "b2", kind: "weird", children: [], status: "bogus" },
  },
  summaryFile: "summary.md",
});

describe("load", () => {
  test("returns null until a course.json exists", () => {
    expect(load(files({ "x/nodes/n1/script.md": "hi" }))).toBeNull();
  });

  test("keys each course by its directory prefix and merges per-node files", () => {
    const course = load(
      files({
        "pythagorean/course.json": COURSE,
        "pythagorean/nodes/n1/script.md": "# 开场\n\n这是一个直角三角形。\n",
        "pythagorean/nodes/n1/evidence.json": JSON.stringify([
          { kind: "rendered-figure", file: "nodes/n1/fig.png", note: "figure" },
          { kind: "figure", file: "evidence/b1/x.png", note: "off-contract kind survives" },
          { kind: "", note: "dropped — empty kind" },
          { note: "dropped — no kind" },
        ]),
        "pythagorean/nodes/n2/evidence.json": "{ not json",
      }),
    )!;

    const set = course.byContentSet["pythagorean"];
    expect(set.title).toBe("勾股定理");
    expect(set.style).toMatchObject({ id: "chalkboard", status: "confirmed", refImages: ["style/anchor.png"] });
    expect(set.rootNode).toBe("n1");
    expect(set.path).toEqual(["n1", "n2"]);
    expect(set.summaryFile).toBe("summary.md");

    const n1 = set.nodes.n1;
    expect(n1.script).toBe("这是一个直角三角形。");
    expect(n1.video).toEqual({ file: "nodes/n1/video.mp4", duration: 5 });
    expect(n1.children).toEqual([{ nodeId: "n2", label: "继续" }]);
    expect(n1.evidence.map((e) => e.kind)).toEqual(["rendered-figure", "figure"]);

    const n2 = set.nodes.n2;
    expect(n2.parent).toBe("n1");
    expect(n2.kind).toBe("main");
    expect(n2.status).toBe("planned");
    expect(n2.evidence).toEqual([]);
    expect(n2.script).toBe("");
  });

  test("outline beats carry their planning-time evidence, lifting legacy figures[] and sources", () => {
    const set = load(files({ "course.json": COURSE }))!.byContentSet[""];
    expect(set.outline.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);

    expect(set.outline[0].tier).toBe("world-knowledge");
    expect(set.outline[0].evidence).toEqual([{ kind: "world-knowledge", note: "textbook" }]);

    expect(set.outline[1].tier).toBe("code-verification");
    expect(set.outline[1].evidence).toEqual([
      { kind: "rendered-figure", file: "evidence/b2/figure-345.png", note: "" },
      { kind: "citation", file: "evidence/b2/sources.json", note: "" },
    ]);

    expect(set.outline[2].tier).toBeUndefined();
    expect(set.outline[2].evidence).toEqual([]);
  });

  test("style: a bare id is a confirmed legacy style, nothing is pending, the sample flow round-trips", () => {
    const styleOf = (style: unknown) =>
      load(files({ "c/course.json": JSON.stringify({ title: "t", outline: [], nodes: {}, style }) }))!.byContentSet["c"].style;

    expect(styleOf(undefined)).toMatchObject({ id: "", status: "pending" });
    expect(styleOf({ id: "comic" })).toMatchObject({ id: "comic", status: "confirmed" });
    expect(styleOf({ id: "comic", status: "bogus" }).status).toBe("confirmed");
    expect(styleOf({ id: "", status: "sampling" }).status).toBe("sampling");

    expect(
      styleOf({
        id: "custom",
        status: "sampled",
        name: "黄昏手绘",
        recipe: "Hand-painted dusk tones",
        rationale: "你说想要温柔一点",
        sample: { image: "style/anchor.png", video: "style/sample.mp4", hook: "开场那句" },
        userRefs: ["style/refs/a.png", 3],
        refImages: "not-a-list",
      }),
    ).toEqual({
      id: "custom",
      status: "sampled",
      name: "黄昏手绘",
      recipe: "Hand-painted dusk tones",
      rationale: "你说想要温柔一点",
      sample: { image: "style/anchor.png", video: "style/sample.mp4", hook: "开场那句", error: undefined },
      userRefs: ["style/refs/a.png"],
      refImages: undefined,
    });
  });

  test("a scene carries its shots, its brief and the manager's progress; the caption falls back to the shots", () => {
    const set = load(
      files({
        "c/course.json": JSON.stringify({
          title: "t",
          outline: [],
          rootNode: "n1",
          nodes: {
            n1: {
              kind: "main",
              status: "generating",
              phase: "shoot",
              shotIndex: 2,
              shotCount: 3,
              startedAt: "2026-09-02T10:00:00Z",
              shots: [
                { id: "s1", script: "第一句。", visual: "a board", duration: 10, figures: ["evidence/b1/fig.png"], status: "ready", video: { file: "nodes/n1/s1.mp4", duration: 10.4 } },
                { script: "  第二句。 ", duration: 12, figures: "nope", status: "bogus" },
                "not a shot",
              ],
              children: [],
            },
            n1x: { parent: "n1", kind: "branch", brief: " 举个抛硬币的例子 ", status: "scripting", shots: [], children: [] },
            n9: { kind: "question", status: "cancelled", children: [] },
          },
          play: { state: "playing", currentNode: "n1", slots: 3, videoAhead: 2, queued: ["n1x", 7], active: ["n1"], pruned: 2, updatedAt: "2026-09-02T10:00:30Z" },
        }),
      }),
    )!.byContentSet["c"];

    const n1 = set.nodes.n1;
    expect(n1.shots).toEqual([
      { id: "s1", script: "第一句。", visual: "a board", duration: 10, figures: ["evidence/b1/fig.png"], status: "ready", video: { file: "nodes/n1/s1.mp4", duration: 10.4 } },
      { id: "s2", script: "第二句。", visual: undefined, duration: 12, figures: [], status: "planned", video: undefined },
    ]);
    expect(n1.script).toBe("第一句。\n\n第二句。");
    expect(n1).toMatchObject({ status: "generating", phase: "shoot", shotIndex: 2, shotCount: 3 });

    expect(set.nodes.n1x).toMatchObject({ kind: "branch", brief: "举个抛硬币的例子", status: "scripting", shots: [], shotCount: undefined });
    expect(set.nodes.n9).toMatchObject({ kind: "question", status: "cancelled" });

    expect(set.play).toEqual({
      state: "playing",
      currentNode: "n1",
      slots: 3,
      videoAhead: 2,
      planAhead: undefined,
      queued: ["n1x"],
      active: ["n1"],
      pruned: 2,
      updatedAt: "2026-09-02T10:00:30Z",
    });
  });

  test("a course without a manager has no play snapshot, and script.md wins over the shots", () => {
    const set = load(
      files({
        "c/course.json": JSON.stringify({ title: "t", outline: [], nodes: { n1: { status: "ready", shots: [{ script: "from shots" }] } } }),
        "c/nodes/n1/script.md": "# heading\n\nfrom the file\n",
      }),
    )!.byContentSet["c"];
    expect(set.play).toBeUndefined();
    expect(set.nodes.n1.script).toBe("from the file");
    expect(set.nodes.n1.shotCount).toBe(1);
  });

  test("a malformed course.json throws so the provider keeps the last good value", () => {
    expect(() => load(files({ "a/course.json": "{ nope" }))).toThrow();
  });
});

describe("save", () => {
  test("is a stub — the viewer never writes the domain", () => {
    expect(save({ byContentSet: {} }, [])).toEqual({ writes: [], deletes: [] });
  });
});
