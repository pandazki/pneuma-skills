/**
 * The play manager, scheduling without a single paid call.
 *
 * What is pinned is the shape of the play loop the learner feels: the
 * spine is rendered ahead of them in priority order (nearer first, main
 * before detour), a detour is written before it is shot, a choice prunes
 * the roads not taken — cancelling work in flight — and pulls the chosen
 * road's work forward, a failure names its reason and a retry re-queues
 * it, a road pruned earlier can be taken later, a learner's question
 * becomes a scene with the way back, and every input reaches the process
 * as a file. Every dependency with a cost is a fake that writes bytes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManager, defaultDeps, descendantWindow, subtreeIds, type ManagerDeps, type PlayManager } from "../skill/scripts/play-manager.mjs";
import { probeDuration } from "../skill/scripts/segment-lib.mjs";

function shot(id: string, script: string) {
  return { id, script, visual: "a chalkboard", duration: 10, figures: [], videoPrompt: `PROMPT ${script}`, status: "planned" };
}

function courseFixture() {
  return {
    title: "贝叶斯",
    topic: "Bayes",
    language: "zh",
    style: { id: "chalkboard", status: "confirmed", refImages: [] },
    outline: [
      { id: "b1", title: "一", evidence: [] },
      { id: "b2", title: "二", evidence: [] },
      { id: "b3", title: "三", evidence: [] },
      { id: "b4", title: "四", evidence: [] },
    ],
    rootNode: "n1",
    path: [],
    nodes: {
      n1: { beat: "b1", kind: "main", choiceLabel: "开场", status: "planned", shots: [shot("s1", "第一句。"), shot("s2", "第二句。")], children: [{ nodeId: "n2", label: "继续：二" }, { nodeId: "n1d", label: "举个例子" }] },
      n1d: { parent: "n1", beat: "b1", kind: "branch", choiceLabel: "举个例子", brief: "抛硬币的例子", status: "planned", shots: [], children: [{ nodeId: "n2", label: "回到主线" }] },
      n2: { parent: "n1", beat: "b2", kind: "main", choiceLabel: "二", status: "planned", shots: [shot("s1", "第三句。")], children: [{ nodeId: "n3", label: "继续：三" }, { nodeId: "n2d", label: "再看一眼" }] },
      n2d: { parent: "n2", beat: "b2", kind: "branch", choiceLabel: "再看一眼", brief: "把公式的每一项指出来", status: "planned", shots: [], children: [{ nodeId: "n3", label: "回到主线" }] },
      n3: { parent: "n2", beat: "b3", kind: "main", choiceLabel: "三", status: "planned", shots: [shot("s1", "第四句。")], children: [{ nodeId: "n4", label: "继续：四" }] },
      n4: { parent: "n3", beat: "b4", kind: "main", choiceLabel: "四", status: "planned", shots: [shot("s1", "第五句。")], children: [] },
    },
  };
}

interface Fakes {
  deps: ManagerDeps;
  /** Shots rendered, in order, as "node/shot". */
  renders: string[];
  /** Make the next render of this shot throw. */
  failOnce: Set<string>;
  /** Park a render until released; records whether it was aborted. */
  hold(key: string): { release: () => void; aborted: () => boolean };
}

function fakes(setDir: string, manager: () => PlayManager): Fakes {
  const renders: string[] = [];
  const failOnce = new Set<string>();
  const holds = new Map<string, { promise: Promise<void>; release: () => void; aborted: boolean }>();
  const keyOf = (abs: string) => abs.slice(setDir.length + 1).replace(/^nodes\//, "").replace(/\.mp4$/, "");
  const deps: ManagerDeps = {
    chat: async () => ({
      shots: [
        { script: "例子一。", visual: "coins", duration: 8, figures: [] },
        { script: "例子二。", visual: "coins again", duration: 8, figures: [] },
      ],
    }),
    async renderShot({ output }, signal) {
      const key = keyOf(output);
      renders.push(key);
      if (failOnce.has(key)) {
        failOnce.delete(key);
        throw new Error(`boom at ${key}`);
      }
      const h = holds.get(key);
      if (h) {
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
      return { duration: 10 };
    },
    async transcribe({ input }) {
      // Exactly what the shot says: the fake camera never mis-speaks.
      const [id, sid] = keyOf(input).split("/");
      return manager().course.nodes[id].shots.find((s) => s.id === sid)?.script ?? "";
    },
    judge: async () => ({ verdict: "pass", reason: "" }),
    lastFrame: (_video, out) => {
      writeFileSync(out, "png");
      return true;
    },
    probe: () => 10,
    async concat(inputs, output) {
      writeFileSync(output, inputs.map((f) => readFileSync(f, "utf-8")).join("+"));
    },
  };
  return {
    deps,
    renders,
    failOnce,
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
  test("renders the spine ahead of the learner, nearer first and main before detour, and lands every scene", async () => {
    const f = fakes(setDir, () => mgr!);
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    expect(f.renders).toEqual(["n1/s1", "n1/s2", "n2/s1", "n1d/s1", "n1d/s2", "n3/s1", "n2d/s1", "n2d/s2"]);
    const c = mgr.course;
    expect(["n1", "n2", "n3", "n1d", "n2d"].map((id) => c.nodes[id].status)).toEqual(["ready", "ready", "ready", "ready", "ready"]);
    expect(c.nodes.n4.status).toBe("planned");
    expect(c.nodes.n1.video).toEqual({ file: "nodes/n1/video.mp4", duration: 10 });
    expect(readFileSync(join(setDir, "nodes/n1/video.mp4"), "utf-8")).toBe("mp4:n1/s1+mp4:n1/s2");
    expect(existsSync(join(setDir, "nodes/n1/s2.last.png"))).toBe(true);
    expect(readFileSync(join(setDir, "nodes/n1/script.md"), "utf-8")).toContain("第一句。\n\n第二句。");
    // The evidence panel reads this file; a scene without it shows "Evidence (0)".
    expect(JSON.parse(readFileSync(join(setDir, "nodes/n1/evidence.json"), "utf-8"))).toEqual([]);
    // A single-shot scene is its own file, no concat.
    expect(readFileSync(join(setDir, "nodes/n2/video.mp4"), "utf-8")).toBe("mp4:n2/s1");
    // The detour was written from its brief before it was shot.
    expect(c.nodes.n1d.shots.map((s) => s.script)).toEqual(["例子一。", "例子二。"]);
    expect(c.nodes.n1d.shots.every((s) => typeof s.videoPrompt === "string" && s.videoPrompt.length > 0)).toBe(true);

    const disk = onDisk();
    expect(disk.play.state).toBe("playing");
    expect(disk.play.currentNode).toBe("n1");
    expect(disk.path).toEqual(["n1"]);
    expect(disk.nodes.n1.status).toBe("ready");
    expect(typeof disk.play.updatedAt).toBe("string");
    expect(existsSync(join(setDir, "state/manager.pid"))).toBe(true);
  });

  test("a choice prunes the roads not taken, cancels their work in flight, and pulls the chosen road forward", async () => {
    const f = fakes(setDir, () => mgr!);
    const parked = f.hold("n1d/s1");
    mgr = createManager({ setDir, deps: f.deps, slots: 1, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await until(() => f.renders.includes("n1d/s1"));

    mgr.choose("n2");
    expect(mgr.course.nodes.n1d.status).toBe("cancelled");
    await until(() => parked.aborted());
    await settle(mgr);

    const c = mgr.course;
    expect(f.renders).not.toContain("n1d/s2");
    expect(c.nodes.n1d.video).toBeUndefined();
    expect(c.nodes.n3.status).toBe("ready");
    expect(c.nodes.n4.status).toBe("ready");
    expect(c.path).toEqual(["n1", "n2"]);
    expect(c.play.currentNode).toBe("n2");
    // Only the detour itself: its way back onto the spine must not take
    // the rest of the course down with it, and nothing on the spine is
    // shot twice.
    expect(c.play.pruned).toBe(1);
    expect(f.renders.filter((k) => k === "n3/s1")).toHaveLength(1);

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
    expect(["n1d", "n2", "n3"].map((id) => mgr!.course.nodes[id].status)).toEqual(["ready", "ready", "ready"]);
    expect(mgr.course.path).toEqual(["n1", "n1d"]);
  });

  test("a failed scene carries its reason; a retry re-queues it", async () => {
    const f = fakes(setDir, () => mgr!);
    f.failOnce.add("n3/s1");
    mgr = createManager({ setDir, deps: f.deps, slots: 2, videoAhead: 1, planAhead: 1, pollMs: 20 }).start();
    await settle(mgr);

    expect(mgr.course.nodes.n3.status).toBe("failed");
    expect(String(mgr.course.nodes.n3.error)).toContain("boom at n3/s1");
    expect(onDisk().nodes.n3.status).toBe("failed");

    mgr.retry("n3");
    expect(mgr.course.nodes.n3.error).toBeNull();
    await settle(mgr);
    expect(mgr.course.nodes.n3.status).toBe("ready");
    expect(f.renders.filter((k) => k === "n3/s1")).toHaveLength(2);
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
    expect(mgr.course.nodes.q1.shots.map((s) => s.script)).toEqual(["例子一。", "例子二。"]);
    expect(f.renders.slice(-2)).toEqual(["q1/s1", "q1/s2"]);
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
    f.failOnce.add("n2/s1");
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

  test("a manager that died mid-shot takes its unfinished scenes back on start", async () => {
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
  const run = () =>
    Bun.spawnSync(["node", script, "--set", setDir, "--detach"], {
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

    const first = run();
    const out = JSON.parse(new TextDecoder().decode(first.stdout).trim());
    expect(first.exitCode).toBe(0);
    expect(typeof out.pid).toBe("number");
    try {
      expect(alive(out.pid)).toBe(true);
      expect(readFileSync(join(setDir, "state/manager.pid"), "utf-8").trim()).toBe(String(out.pid));
      // The launcher has exited; the manager has not.
      expect(first.success).toBe(true);

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
  const clip = (file: string, sampleRate: number, seconds = 1) => {
    const r = Bun.spawnSync([
      "ffmpeg", "-y", "-v", "error",
      "-f", "lavfi", "-i", `testsrc=size=160x90:rate=24:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${sampleRate}:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
    ]);
    if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
    return file;
  };

  test.skipIf(!ffmpeg)("shots of mixed audio sample rates join into a scene as long as its parts", async () => {
    const a = clip(join(setDir, "a.mp4"), 32000);
    const b = clip(join(setDir, "b.mp4"), 96000);
    const out = join(setDir, "mixed.mp4");
    await defaultDeps({ setDir }).concat([a, b], out);
    expect(Math.abs((probeDuration(out) ?? 0) - 2)).toBeLessThanOrEqual(0.3);
  });

  test.skipIf(!ffmpeg)("shots of one shape are joined by stream copy, also as long as their parts", async () => {
    const a = clip(join(setDir, "a.mp4"), 48000);
    const b = clip(join(setDir, "b.mp4"), 48000);
    const out = join(setDir, "same.mp4");
    await defaultDeps({ setDir }).concat([a, b], out);
    expect(Math.abs((probeDuration(out) ?? 0) - 2)).toBeLessThanOrEqual(0.3);
  });
});
