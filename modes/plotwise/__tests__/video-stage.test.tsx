/** @jsxImportSource react */
/**
 * The stage's double buffer — two stacked <video> layers so a segment
 * switch never flashes — pinned at the one property that went wrong in
 * the first live course: only ONE layer may ever hold a clip once a
 * switch has settled. Both layers carrying the same clip a few seconds
 * apart is an echo the learner hears, not a state anyone sees.
 *
 * happy-dom's media elements are stateful enough for this (play/pause
 * flip `paused`, `currentSrc` mirrors `src`, `load()` fires `emptied`,
 * `currentTime` is settable and `timeupdate` dispatchable) and have no
 * decoder — nothing here depends on real decoding inside a clip.
 * (Harness shape follows `modes/eli5/__tests__/rail.test.tsx`.)
 *
 * The second half of the file pins the caption path end to end: the
 * playhead this stage reports, resolved against the scene's clips, is
 * what the learner reads under the picture — for a pre-0.6 course of
 * one-take shots and for a 0.6 course of montage clips alike.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    saved[key] = g[key];
    g[key] = key === "window" ? win : w[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

interface Mounted {
  layers: () => [HTMLVideoElement, HTMLVideoElement];
  onStage: () => HTMLVideoElement;
  transport: (label: "Play" | "Pause") => HTMLButtonElement | undefined;
  update: (src: string) => Promise<void>;
  fire: (el: Element, type: string) => Promise<void>;
  /** Move the playhead of the layer on stage and let it report. */
  seek: (seconds: number) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountStage(src: string, onTime?: (seconds: number) => void): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: VideoStage } = await import("../viewer/VideoStage.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (s: string) => root.render(createElement(VideoStage, { src: s, onTime }));
  await act(async () => render(src));

  const layers = () =>
    [
      host.querySelector('video[data-plotwise-layer="0"]'),
      host.querySelector('video[data-plotwise-layer="1"]'),
    ] as [HTMLVideoElement, HTMLVideoElement];

  return {
    layers,
    onStage: () => layers().find((v) => v.className.includes("opacity-100"))!,
    transport: (label) =>
      (host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null) ?? undefined,
    update: async (s) => {
      await act(async () => render(s));
    },
    fire: async (el, type) => {
      await act(async () => {
        el.dispatchEvent(new Event(type, { bubbles: false }));
      });
    },
    seek: async (seconds) => {
      const el = layers().find((v) => v.className.includes("opacity-100"))!;
      await act(async () => {
        el.currentTime = seconds;
        el.dispatchEvent(new Event("timeupdate", { bubbles: false }));
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const A = "/content/c/nodes/n1/video.mp4";
const B = "/content/c/nodes/n2/video.mp4";

describe("VideoStage double buffer", () => {
  test("the first clip lands on layer 0 and plays there", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(l1.getAttribute("src")).toBeNull();
    expect(m.onStage()).toBe(l0);
    expect(m.transport("Pause")).toBeDefined();
    await m.unmount();
  });

  test("a switch moves the picture to the other layer and empties the one it left", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    await m.update(B);
    // The incoming clip is on stage and audible; the outgoing layer holds
    // nothing at all — an empty layer cannot sound.
    expect(l1.getAttribute("src")).toBe(B);
    expect(l1.paused).toBe(false);
    expect(m.onStage()).toBe(l1);
    expect(l0.getAttribute("src")).toBeNull();
    expect(l0.paused).toBe(true);
    // And the transport knows the stage is playing.
    expect(m.transport("Pause")).toBeDefined();
    expect(m.transport("Play")).toBeUndefined();

    // Back the other way: the roles swap again, the invariant holds.
    await m.update(A);
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(m.onStage()).toBe(l0);
    expect(l1.getAttribute("src")).toBeNull();
    expect(l1.paused).toBe(true);
    await m.unmount();
  });

  test("a retry scheduled on a layer that has since left the stage does nothing", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    // The active layer fails once: a retry is booked 1.2s out.
    await m.fire(l0, "error");
    // Before it fires, the learner moves on.
    await m.update(B);
    expect(m.onStage()).toBe(l1);
    await new Promise((r) => setTimeout(r, 1400));
    // The retry must not have revived the layer it was booked on.
    expect(l0.getAttribute("src")).toBeNull();
    expect(l0.paused).toBe(true);
    expect(l1.paused).toBe(false);
    await m.unmount();
  });

  test("the same clip again is a no-op: no reload, nothing moves", async () => {
    const m = await mountStage(A);
    const [l0, l1] = m.layers();
    await m.update(A);
    expect(l0.getAttribute("src")).toBe(A);
    expect(l0.paused).toBe(false);
    expect(l1.getAttribute("src")).toBeNull();
    expect(m.onStage()).toBe(l0);
    await m.unmount();
  });
});

/**
 * The whole caption path, disk to screen: course.json → `load` → the
 * scene's clips → the playhead the stage reports → the narration line
 * under the picture. A scene's video is its clips concatenated, so the
 * lookup is only right if it subtracts the clips before the current one.
 */
describe("the caption follows the narration line being spoken", () => {
  const captionsAlong = async (courseJson: string, playheads: number[]) => {
    const { load } = await import("../domain.js");
    const { captionAt } = await import("../viewer/waiting.js");
    const set = load([{ path: "c/course.json", content: courseJson }])!.byContentSet["c"];
    const node = set.nodes.n1;
    const seen: string[] = [];
    const m = await mountStage(`/content/c/${node.video!.file}`, (t) => seen.push(captionAt(node, t)));
    // The scene's whole clip is on stage and running before anything is
    // spoken — a caption over a still picture would be a lie.
    expect(m.onStage().getAttribute("src")).toBe(`/content/c/${node.video!.file}`);
    expect(m.onStage().paused).toBe(false);
    for (const t of playheads) await m.seek(t);
    await m.unmount();
    return { seen, node };
  };

  test("a pre-0.6 course (shots[], one line each) plays and captions shot by shot", async () => {
    const { seen, node } = await captionsAlong(
      JSON.stringify({
        title: "复利",
        language: "zh",
        rootNode: "n1",
        nodes: {
          n1: {
            kind: "main",
            status: "ready",
            shotCount: 3,
            shots: [
              { id: "s1", script: "第一年，本金先生出利息。", duration: 6, status: "ready", video: { file: "nodes/n1/s1.mp4", duration: 6.6 } },
              { id: "s2", script: "第二年，利息也开始生利息。", duration: 8, status: "ready", video: { file: "nodes/n1/s2.mp4", duration: 8 } },
              { id: "s3", script: "于是曲线越来越陡。", duration: 8, status: "ready", video: { file: "nodes/n1/s3.mp4", duration: 8 } },
            ],
            video: { file: "nodes/n1/video.mp4", duration: 22.6 },
          },
        },
      }),
      [0, 3, 7, 12, 15, 22.4],
    );
    expect(node.clips).toHaveLength(3);
    expect(seen).toEqual([
      "第一年，本金先生出利息。",
      "第一年，本金先生出利息。",
      "第二年，利息也开始生利息。",
      "第二年，利息也开始生利息。",
      "于是曲线越来越陡。",
      "于是曲线越来越陡。",
    ]);
  });

  test("a 0.6 course captions line by line inside each montage clip", async () => {
    const { seen } = await captionsAlong(
      JSON.stringify({
        title: "复利",
        language: "zh",
        rootNode: "n1",
        nodes: {
          n1: {
            kind: "main",
            status: "ready",
            clipCount: 2,
            clips: [
              {
                id: "c1",
                duration: 15,
                cuts: [{ from: 0, to: 8, shot: "纸片硬币静置" }, { from: 8, to: 15, shot: "第二枚弹出" }],
                narration: [
                  { from: 0, to: 5, text: "本金先生出利息。" },
                  { from: 5, to: 10, text: "利息又生利息。" },
                  { from: 10, to: 15, text: "每一轮都从更高处开始。" },
                ],
                status: "ready",
                video: { file: "nodes/n1/c1.mp4", duration: 15 },
              },
              {
                id: "c2",
                duration: 12,
                cuts: [{ from: 0, to: 12, shot: "曲线抬头" }],
                narration: [
                  { from: 0, to: 6, text: "于是曲线越来越陡。" },
                  { from: 6, to: 12, text: "时间是这条曲线的燃料。" },
                ],
                status: "ready",
                video: { file: "nodes/n1/c2.mp4", duration: 12 },
              },
            ],
            video: { file: "nodes/n1/video.mp4", duration: 27 },
          },
        },
      }),
      [0, 6, 12, 15.5, 22, 26.9],
    );
    expect(seen).toEqual([
      "本金先生出利息。",
      "利息又生利息。",
      "每一轮都从更高处开始。",
      "于是曲线越来越陡。",
      "时间是这条曲线的燃料。",
      "时间是这条曲线的燃料。",
    ]);
  });

  test("a scene with nothing spoken captions with the scene's own text", async () => {
    const { seen } = await captionsAlong(
      JSON.stringify({
        title: "t",
        language: "zh",
        rootNode: "n1",
        nodes: {
          n1: {
            kind: "main",
            status: "ready",
            clips: [{ id: "c1", duration: 10, cuts: [{ from: 0, to: 10, shot: "无声画面" }], narration: [], status: "ready", video: { file: "nodes/n1/c1.mp4", duration: 10 } }],
            video: { file: "nodes/n1/video.mp4", duration: 10 },
          },
        },
      }),
      [0, 5],
    );
    // No narration line to show, and no script.md either: the caption is
    // empty rather than wrong, and nothing crashes.
    expect(seen).toEqual(["", ""]);
  });
});
