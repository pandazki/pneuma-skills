/**
 * The play manager, scheduling without a single paid call.
 *
 * What is pinned is the shape of the play loop the learner feels: the
 * spine is shot ahead of them in priority order (nearer first, main
 * before detour), a detour is written before it is shot, a choice prunes
 * the roads not taken — cancelling work in flight — and pulls the chosen
 * road's work forward, a failure names its reason and a retry re-queues
 * it, a road pruned earlier can be taken later, a learner's question
 * becomes a scene with the way back, and every input reaches the process
 * as a file. Every dependency with a cost is a fake that writes bytes.
 *
 * Since 0.6 the unit is a MONTAGE CLIP: a scene is 1-3 of them, and every
 * clip is shot reference-to-video with the same bindings (the style anchor
 * as Image 1, the voice as Audio 1). There is no frame chain to pin any
 * more — that is the point of the change.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManager, defaultDeps, descendantWindow, subtreeIds, type ManagerDeps, type PlayManager } from "../skill/scripts/play-manager.mjs";
import { probeDuration } from "../skill/scripts/segment-lib.mjs";

/** A montage clip: four cuts, two narration lines, nothing to bind. */
function clip(id: string, ...lines: string[]) {
  return {
    id,
    duration: 15,
    theme: "粉笔把这一步画出来",
    cuts: [
      { from: 0, to: 4, shot: "白粉笔点出一个圆", camera: "俯拍" },
      { from: 4, to: 8, shot: "第二个圆长出来", camera: "缓慢推进" },
      { from: 8, to: 12, shot: "圆沿弧线排开", camera: "横移" },
      { from: 12, to: 15, shot: "整条弧线亮起", camera: "固定镜头" },
    ] as Array<{ from: number; to: number; shot: string; camera: string; figures?: string[] }>,
    narration: lines.map((text, i) => ({ from: i * (15 / lines.length), to: (i + 1) * (15 / lines.length), text })),
    audio: "安静的教室底噪",
    figures: [] as string[],
    videoPrompt: `1. Style anchor: chalk.\n\n2. Shot list — 4 cuts in 15s:\n0-4s Cut 1: 白粉笔点出一个圆。 [俯拍]`,
    status: "planned",
  };
}

/** What the clip says, joined the way the manager joins it (zh). */
const spoken = (c: { narration?: Array<{ text: string }> }) => (c.narration ?? []).map((l) => l.text).join("");

type Evidence = { kind: string; file?: string; url?: string; note: string };

function courseFixture() {
  return {
    title: "贝叶斯",
    topic: "Bayes",
    language: "zh",
    style: { id: "chalkboard", status: "confirmed", refImages: [] as string[] },
    outline: [
      { id: "b1", title: "一", evidence: [] as Evidence[] },
      { id: "b2", title: "二", evidence: [] as Evidence[] },
      { id: "b3", title: "三", evidence: [] as Evidence[] },
      { id: "b4", title: "四", evidence: [] as Evidence[] },
    ],
    rootNode: "n1",
    path: [],
    nodes: {
      n1: { beat: "b1", kind: "main", choiceLabel: "开场", status: "planned", clips: [clip("c1", "第一句。"), clip("c2", "第二句。")], children: [{ nodeId: "n2", label: "继续：二" }, { nodeId: "n1d", label: "举个例子" }] },
      n1d: { parent: "n1", beat: "b1", kind: "branch", choiceLabel: "举个例子", brief: "抛硬币的例子", status: "planned", clips: [] as ReturnType<typeof clip>[], children: [{ nodeId: "n2", label: "回到主线" }] },
      n2: { parent: "n1", beat: "b2", kind: "main", choiceLabel: "二", status: "planned", clips: [clip("c1", "第三句。")], children: [{ nodeId: "n3", label: "继续：三" }, { nodeId: "n2d", label: "再看一眼" }] },
      n2d: { parent: "n2", beat: "b2", kind: "branch", choiceLabel: "再看一眼", brief: "把公式的每一项指出来", status: "planned", clips: [] as ReturnType<typeof clip>[], children: [{ nodeId: "n3", label: "回到主线" }] },
      n3: { parent: "n2", beat: "b3", kind: "main", choiceLabel: "三", status: "planned", clips: [clip("c1", "第四句。")], children: [{ nodeId: "n4", label: "继续：四" }] },
      n4: { parent: "n3", beat: "b4", kind: "main", choiceLabel: "四", status: "planned", clips: [clip("c1", "第五句。")], children: [] },
    },
  };
}

interface Fakes {
  deps: ManagerDeps;
  /** Clips shot, in order, as "node/clip". */
  renders: string[];
  /** What each shoot was given: a first frame, or the reference images and audio. */
  inputs: Map<string, { image?: string; refImages: string[]; refAudios: string[] }>;
  /** The prompt each shoot was given. */
  prompts: Map<string, string>;
  /** The continuity kit steps that ran. */
  kit: string[];
  /** Transcriptions attempted, in order, as "node/clip". */
  transcriptions: string[];
  /** Make the next shoot of this clip throw. */
  failOnce: Set<string>;
  /** Make the next N transcriptions of this clip throw. */
  deafFor: Map<string, number>;
  /** Park a shoot until released; records whether it was aborted. */
  hold(key: string): { release: () => void; aborted: () => boolean };
}

function fakes(setDir: string, manager: () => PlayManager): Fakes {
  const renders: string[] = [];
  const inputs = new Map<string, { image?: string; refImages: string[]; refAudios: string[] }>();
  const prompts = new Map<string, string>();
  const kit: string[] = [];
  const transcriptions: string[] = [];
  const failOnce = new Set<string>();
  const deafFor = new Map<string, number>();
  const holds = new Map<string, { promise: Promise<void>; release: () => void; aborted: boolean }>();
  const keyOf = (abs: string) => abs.slice(setDir.length + 1).replace(/^nodes\//, "").replace(/\.mp4$/, "");
  const rel = (abs: string) => abs.slice(setDir.length + 1);
  const deps: ManagerDeps = {
    chat: async () => ({
      device: "一枚硬币长出第二枚",
      clips: [clip("c1", "例子一。"), clip("c2", "例子二。")],
    }),
    async extractAudio(_video, output) {
      kit.push("voice");
      writeFileSync(output, "mp3");
    },
    async firstFrame(_video, output) {
      kit.push("frame");
      writeFileSync(output, "png");
    },
    async characterSheet({ outputs }) {
      kit.push("sheet");
      for (const o of outputs) writeFileSync(o, "png");
    },
    async renderClip({ output, prompt, image, refImages = [], refAudios = [] }, signal) {
      const key = keyOf(output);
      renders.push(key);
      inputs.set(key, { image: image ? rel(image) : undefined, refImages: refImages.map(rel), refAudios: refAudios.map(rel) });
      prompts.set(key, prompt);
      if (failOnce.has(key)) {
        failOnce.delete(key);
        throw new Error(`boom at ${key}`);
      }
      const h = holds.get(key);
      if (h) {
        // Parked once: a re-run of the same clip renders straight away.
        holds.delete(key);
        await new Promise<void>((res, rej) => {
          h.promise.then(res);
          signal?.addEventListener("abort", () => {
            h.aborted = true;
            const e = new Error("aborted");
            e.name = "AbortError";
            rej(e);
          }, { once: true });
        });
      }
      writeFileSync(output, `mp4:${key}`);
      return { duration: 15 };
    },
    async transcribe({ input }) {
      const key = keyOf(input);
      transcriptions.push(key);
      const deaf = deafFor.get(key) ?? 0;
      if (deaf > 0) {
        deafFor.set(key, deaf - 1);
        throw new Error(`wizper is down for ${key}`);
      }
      // Exactly what the clip says: the fake camera never mis-speaks.
      const [id, cid] = key.split("/");
      const found = manager().course.nodes[id].clips.find((c) => c.id === cid);
      return found ? spoken(found) : "";
    },
    judge: async () => ({ verdict: "pass", reason: "" }),
    lastFrame: (_video, out) => {
      writeFileSync(out, "png");
      return true;
    },
    probe: () => 15,
    async concat(inputs, output) {
      writeFileSync(output, inputs.map((f) => readFileSync(f, "utf-8")).join("+"));
    },
  };
  return {
    deps,
    renders,
    inputs,
    prompts,
    kit,
    transcriptions,
    failOnce,
    deafFor,
    hold(key) {
      let release = () => {};
      const promise = new Promise<void>((res) => {
        release = res;
      });
      const entry = { promise, release, aborted: false };
      holds.set(key, entry);
      return { release, aborted: () => entry.aborted };
    },
  };
}

/** Both queues empty twice in a row — a job's tail can enqueue another. */
async function settle(mgr: PlayManager) {
  for (let i = 0; i < 3; i++) {
    await mgr.whenIdle();
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function until(cond: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let setDir: string;
let mgr: PlayManager | null;

beforeEach(() => {
  setDir = mkdtempSync(join(tmpdir(), "plotwise-manager-"));
  writeFileSync(join(setDir, "course.json"), JSON.stringify(courseFixture(), null, 2));
  mgr = null;
});

afterEach(async () => {
  await mgr?.stop();
  rmSync(setDir, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(readFileSync(join(setDir, "course.json"), "utf-8"));

describe("descendantWindow", () => {
  test("walks breadth-first with distances, stops at the depth and at unknown ids", () => {
    const nodes = courseFixture().nodes;
    expect(descendantWindow(nodes, "n1", 1)).toEqual([
      { id: "n1", distance: 0 },
      { id: "n2", distance: 1 },
      { id: "n1d", distance: 1 },
    ]);
    expect(descendantWindow(nodes, "n1", 2).map((i) => i.id)).toEqual(["n1", "n2", "n1d", "n3", "n2d"]);
    expect(subtreeIds(nodes, "n2")).toEqual(["n2", "n3", "n2d", "n4"]);
    expect(descendantWindow(nodes, "nope", 3)).toEqual([]);
  });
});

describe("createManager", () => {
  test("shoots the spine ahead of the learner, nearer first and main before detour, and lands every scene", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    // One ahead means the scene on stage and the scenes one step from it
    // — the next main scene and this scene's detour — and nothing further
    // until the learner moves (an extra step was shot before the review).
    expect(f.renders).toEqual(["n1/c1", "n1/c2", "n2/c1", "n1d/c1", "n1d/c2"]);
    const c = mgr.course;
    expect(["n1", "n2", "n1d"].map((id) => c.nodes[id].status)).toEqual(["ready", "ready", "ready"]);
    expect(["n3", "n2d", "n4"].map((id) => c.nodes[id].status)).toEqual(["planned", "planned", "planned"]);
    expect(c.nodes.n2d.clips).toEqual([]);
    expect(c.nodes.n1.video).toEqual({ file: "nodes/n1/video.mp4", duration: 15 });
    expect(readFileSync(join(setDir, "nodes/n1/video.mp4"), "utf-8")).toBe("mp4:n1/c1+mp4:n1/c2");
    // The interlude shows the last clip's last frame while the next scene shoots.
    expect(existsSync(join(setDir, "nodes/n1/c2.last.png"))).toBe(true);
    expect(readFileSync(join(setDir, "nodes/n1/script.md"), "utf-8")).toContain("第一句。\n\n第二句。");
    // The evidence panel reads this file; a scene without it shows "Evidence (0)".
    expect(JSON.parse(readFileSync(join(setDir, "nodes/n1/evidence.json"), "utf-8"))).toEqual([]);
    // A single-clip scene is its own file, no concat.
    expect(readFileSync(join(setDir, "nodes/n2/video.mp4"), "utf-8")).toBe("mp4:n2/c1");
    // The detour was written from its brief before it was shot, device and all.
    expect(c.nodes.n1d.clips.map(spoken)).toEqual(["例子一。", "例子二。"]);
    expect(c.nodes.n1d.device).toBe("一枚硬币长出第二枚");
    expect(c.nodes.n1d.clips.every((s) => typeof s.videoPrompt === "string" && s.videoPrompt.length > 0)).toBe(true);

    const disk = onDisk();
    expect(disk.play.state).toBe("playing");
    expect(disk.play.currentNode).toBe("n1");
    expect(disk.path).toEqual(["n1"]);
    expect(disk.nodes.n1.status).toBe("ready");
    expect(typeof disk.play.updatedAt).toBe("string");
    expect(existsSync(join(setDir, "state/manager.pid"))).toBe(true);

    // Moving on brings the next step into the window: n3 and n2's detour.
    mgr.choose("n2");
    await settle(mgr);
    expect(f.renders.slice(5)).toEqual(["n3/c1", "n2d/c1", "n2d/c2"]);
    expect(["n3", "n2d"].map((id) => c.nodes[id].status)).toEqual(["ready", "ready"]);
    expect(c.nodes.n4.status).toBe("planned");
  });

  test("while a scene is in production the viewer is told which clip of how many", async () => {
    const f = fakes(setDir, () => mgr!);
    const parked = f.hold("n1/c2");
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await until(() => f.renders.includes("n1/c2"));
    expect(mgr.course.nodes.n1).toMatchObject({ status: "generating", phase: "shoot", clipIndex: 2, clipCount: 2 });
    parked.release();
    await settle(mgr);
    expect(mgr.course.nodes.n1.clipIndex).toBeNull();
  });

  test("a choice prunes the roads not taken, cancels their work in flight, and pulls the chosen road forward", async () => {
    const f = fakes(setDir, () => mgr!);
    const parked = f.hold("n1d/c1");
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await until(() => f.renders.includes("n1d/c1"));

    mgr.choose("n2");
    expect(mgr.course.nodes.n1d.status).toBe("cancelled");
    await until(() => parked.aborted());
    await settle(mgr);

    const c = mgr.course;
    expect(f.renders).not.toContain("n1d/c2");
    expect(c.nodes.n1d.video).toBeUndefined();
    expect(c.nodes.n3.status).toBe("ready");
    expect(c.nodes.n4.status).toBe("planned");
    expect(c.path).toEqual(["n1", "n2"]);
    expect(c.play.currentNode).toBe("n2");
    // Only the detour itself: its way back onto the spine must not take
    // the rest of the course down with it, and nothing on the spine is
    // shot twice.
    expect(c.play.pruned).toBe(1);
    expect(f.renders.filter((k) => k === "n3/c1")).toHaveLength(1);

    // Going back on the map: the pruned road is planned again and shot.
    parked.release();
    mgr.choose("n1d");
    expect(c.nodes.n1d.status).not.toBe("cancelled");
    await settle(mgr);
    expect(c.nodes.n1d.status).toBe("ready");
    expect(c.nodes.n2.status).toBe("ready");
    expect(c.path[c.path.length - 1]).toBe("n1d");
  });

  test("taking the detour prunes nothing: the spine it returns to is still the course", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await until(() => mgr!.course.nodes.n1.status === "ready");
    mgr.choose("n1d");
    expect(mgr.course.play.pruned).toBe(0);
    expect(Object.values(mgr.course.nodes).some((n) => n.status === "cancelled")).toBe(false);
    await settle(mgr);
    // The way back (n2) is one step from the detour; n3 is two.
    expect(["n1d", "n2", "n3"].map((id) => mgr!.course.nodes[id].status)).toEqual(["ready", "ready", "planned"]);
    expect(mgr.course.path).toEqual(["n1", "n1d"]);
  });

  test("a failed scene carries its reason; a retry re-queues it", async () => {
    const f = fakes(setDir, () => mgr!);
    f.failOnce.add("n3/c1");
    mgr = createManager({ setDir, deps: f.deps, slots: 2, videoAhead: 2, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    expect(mgr.course.nodes.n3.status).toBe("failed");
    expect(String(mgr.course.nodes.n3.error)).toContain("boom at n3/c1");
    expect(onDisk().nodes.n3.status).toBe("failed");

    mgr.retry("n3");
    expect(mgr.course.nodes.n3.error).toBeNull();
    await settle(mgr);
    expect(mgr.course.nodes.n3.status).toBe("ready");
    expect(f.renders.filter((k) => k === "n3/c1")).toHaveLength(2);
  });

  test("a retry while the scene is being shot re-queues it once the abort has settled", async () => {
    const f = fakes(setDir, () => mgr!);
    const parked = f.hold("n2/c1");
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await until(() => f.renders.includes("n2/c1"));

    // The learner asks again while the clip is in flight: the running job
    // is aborted, and the scene must come back on its own — the reconcile
    // that ran inside the aborted job's tail used to see its key still
    // active and give up until the next choice.
    mgr.retry("n2");
    await until(() => parked.aborted());
    await settle(mgr);
    expect(f.renders.filter((k) => k === "n2/c1")).toHaveLength(2);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(readFileSync(join(setDir, "nodes/n2/video.mp4"), "utf-8")).toBe("mp4:n2/c1");
  });

  test("a retry of a ready scene is a new take of every clip, a single-clip scene included", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(mgr.course.nodes.n1.status).toBe("ready");

    // n2 is one clip, so that clip IS the scene file; a re-run used to
    // rename that file onto itself and lose it.
    mgr.retry("n2");
    expect(mgr.course.nodes.n2.video).toBeUndefined();
    expect(mgr.course.nodes.n2.clips[0].status).toBe("planned");
    await settle(mgr);
    expect(f.renders.filter((k) => k === "n2/c1")).toHaveLength(2);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(mgr.course.nodes.n2.video).toEqual({ file: "nodes/n2/video.mp4", duration: 15 });
    expect(readFileSync(join(setDir, "nodes/n2/video.mp4"), "utf-8")).toBe("mp4:n2/c1");

    // A two-clip scene: both clips are shot again, not only the last.
    mgr.retry("n1");
    await settle(mgr);
    expect(f.renders.filter((k) => k === "n1/c1")).toHaveLength(2);
    expect(f.renders.filter((k) => k === "n1/c2")).toHaveLength(2);
    expect(mgr.course.nodes.n1.status).toBe("ready");
  });

  test("narration that cannot be transcribed fails the clip honestly, and a retry checks the kept file before paying again", async () => {
    const f = fakes(setDir, () => mgr!);
    f.deafFor.set("n2/c1", 2);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    const n2 = mgr.course.nodes.n2;
    expect(n2.status).toBe("failed");
    expect(String(n2.error)).toContain("could not be checked");
    expect(String(n2.error)).toContain("wizper is down");
    // Two attempts, one clip, and the clip is still there.
    expect(f.transcriptions.filter((k) => k === "n2/c1")).toHaveLength(2);
    expect(f.renders.filter((k) => k === "n2/c1")).toHaveLength(1);
    expect(n2.clips[0].status).toBe("unchecked");
    expect(existsSync(join(setDir, "nodes/n2/c1.mp4"))).toBe(true);
    expect(onDisk().nodes.n2.clips[0].status).toBe("unchecked");

    // The transcriber is back: the retry checks the clip on disk and lands
    // the scene without a second render.
    mgr.retry("n2");
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(f.renders.filter((k) => k === "n2/c1")).toHaveLength(1);
    expect(f.transcriptions.filter((k) => k === "n2/c1")).toHaveLength(3);
    expect(mgr.course.nodes.n2.clips[0].status).toBe("ready");
  });

  /** A confirmed style with a sample on file: anchor still + clip. */
  function withSample(raw: ReturnType<typeof courseFixture>, extra: Record<string, unknown> = {}) {
    mkdirSync(join(setDir, "style"), { recursive: true });
    writeFileSync(join(setDir, "style", "anchor.png"), "png");
    writeFileSync(join(setDir, "style", "sample.mp4"), "mp4");
    raw.style = { ...raw.style, refImages: ["style/anchor.png"], sample: { image: "style/anchor.png", video: "style/sample.mp4", hook: "h" }, ...extra } as typeof raw.style;
    writeFileSync(join(setDir, "course.json"), JSON.stringify(raw));
  }

  test("the kit takes the voice from the sample, and EVERY clip is reference-to-video with the anchor and that voice", async () => {
    withSample(courseFixture());
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    expect(f.kit).toEqual(["voice"]);
    expect(mgr.course.style.voiceRef).toBe("style/voice.mp3");
    expect(existsSync(join(setDir, "style/voice.mp3"))).toBe(true);
    expect(onDisk().style.voiceRef).toBe("style/voice.mp3");
    // This is the whole continuity story of 0.6: the same anchor and the
    // same voice on the first clip of a scene and on the second, with no
    // frame chain between them.
    const same = { image: undefined, refImages: ["style/anchor.png"], refAudios: ["style/voice.mp3"] };
    expect(f.inputs.get("n1/c1")).toEqual(same);
    expect(f.inputs.get("n1/c2")).toEqual(same);
    expect(f.inputs.get("n2/c1")).toEqual(same);
    // The bindings are numbered into the prompt at the shoot, not before.
    expect(f.prompts.get("n1/c1")).toContain("Reference material: Image 1 is this course's style anchor");
    expect(f.prompts.get("n1/c1")).toContain("Audio 1 is the narrator's voice");
    expect(mgr.course.nodes.n1.clips[0].h3Practices).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(mgr.course.nodes.n1.clips[0].endpoint).toBe("reference");
    expect(mgr.course.nodes.n1.status).toBe("ready");
  });

  test("a speaker on screen gets a character sheet, drawn once and riding on every clip", async () => {
    withSample(courseFixture(), { narration: "on-camera" });
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(f.kit).toEqual(["voice", "frame", "sheet"]);
    expect(mgr.course.style.characterSheet).toEqual(["style/character-1.png", "style/character-2.png"]);
    expect(mgr.course.style.refImages).toEqual(["style/anchor.png", "style/character-1.png", "style/character-2.png"]);
    const withHost = ["style/anchor.png", "style/character-1.png", "style/character-2.png"];
    expect(f.inputs.get("n1/c1")?.refImages).toEqual(withHost);
    expect(f.inputs.get("n1/c2")?.refImages).toEqual(withHost);
    expect(f.inputs.get("n2/c1")?.refImages).toEqual(withHost);

    // A second manager finds the kit on file and does not draw it again.
    await mgr.stop();
    const g = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: g.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(g.kit).toEqual([]);
  });

  test("a voiceover course draws no character sheet", async () => {
    withSample(courseFixture());
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(f.kit).toEqual(["voice"]);
    expect(mgr.course.style.characterSheet).toBeUndefined();
  });

  test("without a sample it shoots anyway, without a voice reference", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(f.kit).toEqual([]);
    expect(mgr.course.nodes.n1.status).toBe("ready");
    // No anchor and no voice: text-to-video, and nothing pretends otherwise.
    expect(f.inputs.get("n1/c1")).toEqual({ image: undefined, refImages: [], refAudios: [] });
    expect(mgr.course.nodes.n1.clips[0].endpoint).toBe("text");
  });

  test("a clip binding more figures than the reference slots allow fails at the shoot, naming the split", async () => {
    const raw = courseFixture();
    // A style anchor takes one slot; a recurring character another; two
    // figures fit, three do not.
    mkdirSync(join(setDir, "style"), { recursive: true });
    mkdirSync(join(setDir, "evidence", "b2"), { recursive: true });
    writeFileSync(join(setDir, "style", "anchor.png"), "png");
    writeFileSync(join(setDir, "style", "host.png"), "png");
    raw.style.refImages = ["style/anchor.png", "style/host.png"];
    const figures = ["a.png", "b.png", "c.png"].map((f) => `evidence/b2/${f}`);
    for (const f of figures) writeFileSync(join(setDir, f), "png");
    raw.outline[1] = { ...raw.outline[1], evidence: figures.map((file) => ({ kind: "rendered-figure", file, note: "" })) };
    raw.nodes.n2.clips[0].figures = figures;
    raw.nodes.n2.clips[0].cuts[1].figures = figures;
    writeFileSync(join(setDir, "course.json"), JSON.stringify(raw));

    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("failed");
    expect(String(mgr.course.nodes.n2.error)).toContain("3 figures");
    expect(String(mgr.course.nodes.n2.error)).toContain("split the figures across clips");
    expect(f.renders).not.toContain("n2/c1");
    // The scenes that fit were shot as usual.
    expect(mgr.course.nodes.n1.status).toBe("ready");
  });

  test("a figure the clip does show is bound in cut order, and the prompt says which cut", async () => {
    const raw = courseFixture();
    mkdirSync(join(setDir, "style"), { recursive: true });
    mkdirSync(join(setDir, "evidence", "b2"), { recursive: true });
    writeFileSync(join(setDir, "style", "anchor.png"), "png");
    raw.style.refImages = ["style/anchor.png"];
    const figures = ["late.png", "early.png"].map((f) => `evidence/b2/${f}`);
    for (const f of figures) writeFileSync(join(setDir, f), "png");
    raw.outline[1] = { ...raw.outline[1], evidence: figures.map((file) => ({ kind: "rendered-figure", file, note: "" })) };
    // early.png is named by cut 2, late.png by cut 4: the shoot passes
    // them in that order, whatever order the evidence list is in.
    raw.nodes.n2.clips[0].cuts[1].figures = ["evidence/b2/early.png"];
    raw.nodes.n2.clips[0].cuts[3].figures = ["evidence/b2/late.png"];
    raw.nodes.n2.clips[0].figures = figures;
    writeFileSync(join(setDir, "course.json"), JSON.stringify(raw));

    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(f.inputs.get("n2/c1")?.refImages).toEqual(["style/anchor.png", "evidence/b2/early.png", "evidence/b2/late.png"]);
    const prompt = f.prompts.get("n2/c1") ?? "";
    expect(prompt).toContain('Image 2 is the code-rendered knowledge figure "early.png"');
    expect(prompt).toContain("It appears in cut 2");
    expect(prompt).toContain('Image 3 is the code-rendered knowledge figure "late.png"');
    expect(prompt).toContain("It appears in cut 4");
  });

  test("a learner's question becomes a scene under the scene they were on, with the way back", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 2, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    mgr.request({ parent: "n2", label: "为什么要归一化？", brief: "分母是所有可能的证据之和" });
    const q = mgr.course.nodes.q1;
    // Written at once: a question outranks everything at its distance.
    expect(q).toMatchObject({ parent: "n2", beat: "b2", kind: "question", choiceLabel: "为什么要归一化？", brief: "分母是所有可能的证据之和" });
    expect(q.children).toEqual([{ nodeId: "n3", label: "回到主线" }]);
    expect(mgr.course.nodes.n2.children).toContainEqual({ nodeId: "q1", label: "为什么要归一化？" });

    // Written and shot at once, wherever it hangs: the learner is waiting for it.
    await settle(mgr);
    expect(mgr.course.nodes.q1.status).toBe("ready");
    expect(mgr.course.nodes.q1.clips.map(spoken)).toEqual(["例子一。", "例子二。"]);
    expect(f.renders.slice(-2)).toEqual(["q1/c1", "q1/c2"]);
  });

  test("a question about a scene the learner has left is offered where they are now", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 2, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    mgr.choose("n2");
    mgr.choose("n3");
    mgr.request({ parent: "n2", label: "那个系数呢？", brief: "回答关于系数的问题" });
    const q = mgr.course.nodes.q1;
    expect(q.parent).toBe("n3");
    expect(q.beat).toBe("b2");
    expect(q.children).toEqual([{ nodeId: "n4", label: "回到主线" }]);
    expect(mgr.course.nodes.n3.children.map((c) => c.nodeId)).toContain("q1");
    expect(mgr.course.nodes.n2.children.map((c) => c.nodeId)).not.toContain("q1");
    await settle(mgr);
    expect(mgr.course.nodes.q1.status).toBe("ready");
  });

  test("inputs arrive as files: a choice, a retry riding with it, and a request", async () => {
    const f = fakes(setDir, () => mgr!);
    f.failOnce.add("n2/c1");
    mgr = createManager({ setDir, deps: f.deps, slots: 2, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("failed");

    const state = join(setDir, "state");
    writeFileSync(join(state, "choice.json"), JSON.stringify({ at: new Date().toISOString(), retry: "n2", choose: "n2" }));
    await until(() => mgr!.course.play.currentNode === "n2");
    await settle(mgr);
    expect(mgr.course.nodes.n2.status).toBe("ready");
    expect(mgr.course.path).toEqual(["n1", "n2"]);

    mkdirSync(join(state, "requests"), { recursive: true });
    writeFileSync(join(state, "requests", "q.json"), JSON.stringify({ parent: "n2", label: "那先验从哪来？", brief: "先验是拿到证据之前的信念" }));
    await until(() => !!mgr!.course.nodes.q1);
    expect(existsSync(join(state, "requests", "q.json.done"))).toBe(true);
    await settle(mgr);
    expect(mgr.course.nodes.q1.status).toBe("ready");

    // A stale choice (same timestamp) is not replayed.
    const before = mgr.course.play.pruned;
    await new Promise((r) => setTimeout(r, 60));
    expect(mgr.course.play.pruned).toBe(before);
  });

  test("a manager that died mid-shoot takes its unfinished scenes back on start", async () => {
    const raw = courseFixture();
    raw.nodes.n1.status = "generating";
    raw.nodes.n2.status = "queued";
    (raw as { play?: unknown }).play = { state: "warming" };
    writeFileSync(join(setDir, "course.json"), JSON.stringify(raw));
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);
    expect(mgr.course.nodes.n1.status).toBe("ready");
    expect(mgr.course.nodes.n2.status).toBe("ready");
  });
});

describe("play-manager.mjs --detach", () => {
  const script = join(import.meta.dir, "..", "skill", "scripts", "play-manager.mjs");
  const run = (extra: string[] = []) =>
    Bun.spawnSync(["node", script, "--set", setDir, "--detach", ...extra], {
      cwd: setDir,
      env: { ...process.env, FAL_KEY: "", OPENROUTER_API_KEY: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  test("daemonizes into its own process, reports the pid, and never starts a second manager", async () => {
    // A course with nothing left to shoot: the manager starts, writes its pid, idles.
    const raw = courseFixture();
    for (const n of Object.values(raw.nodes)) {
      n.status = "ready";
      (n as { video?: unknown }).video = { file: "nodes/x/video.mp4", duration: 1 };
    }
    writeFileSync(join(setDir, "course.json"), JSON.stringify(raw));

    // 0.5's --continuity is still accepted and ignored: a session resumed
    // with the old skill text passes it, and dying on an unknown flag
    // would leave the learner waiting for a manager that never started.
    const first = run(["--continuity", "chain"]);
    const out = JSON.parse(new TextDecoder().decode(first.stdout).trim());
    expect(first.exitCode).toBe(0);
    expect(typeof out.pid).toBe("number");
    try {
      expect(alive(out.pid)).toBe(true);
      expect(readFileSync(join(setDir, "state/manager.pid"), "utf-8").trim()).toBe(String(out.pid));
      // The launcher has exited; the manager has not.
      expect(first.success).toBe(true);
      await until(() => readFileSync(join(setDir, "state/manager.log"), "utf-8").includes("ignored"), 5000);

      const second = run();
      expect(JSON.parse(new TextDecoder().decode(second.stdout).trim())).toEqual({ pid: out.pid, log: join(setDir, "state/manager.log"), alreadyRunning: true });
    } finally {
      process.kill(out.pid, "SIGTERM");
    }
    await until(() => !alive(out.pid), 5000);
    expect(existsSync(join(setDir, "state/manager.pid"))).toBe(false);
  });
});

describe("defaultDeps().concat", () => {
  const ffmpeg = !!Bun.which("ffmpeg") && !!Bun.which("ffprobe");
  const made = (file: string, sampleRate: number, seconds = 1) => {
    const r = Bun.spawnSync([
      "ffmpeg", "-y", "-v", "error",
      "-f", "lavfi", "-i", `testsrc=size=160x90:rate=24:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${sampleRate}:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
    ]);
    if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
    return file;
  };

  test.skipIf(!ffmpeg)("clips of mixed audio sample rates join into a scene as long as its parts", async () => {
    const a = made(join(setDir, "a.mp4"), 32000);
    const b = made(join(setDir, "b.mp4"), 96000);
    const out = join(setDir, "mixed.mp4");
    await defaultDeps({ setDir }).concat([a, b], out);
    expect(Math.abs((probeDuration(out) ?? 0) - 2)).toBeLessThanOrEqual(0.3);
  });

  test.skipIf(!ffmpeg)("clips of one shape are joined by stream copy, also as long as their parts", async () => {
    const a = made(join(setDir, "a.mp4"), 48000);
    const b = made(join(setDir, "b.mp4"), 48000);
    const out = join(setDir, "same.mp4");
    await defaultDeps({ setDir }).concat([a, b], out);
    expect(Math.abs((probeDuration(out) ?? 0) - 2)).toBeLessThanOrEqual(0.3);
  });
});
