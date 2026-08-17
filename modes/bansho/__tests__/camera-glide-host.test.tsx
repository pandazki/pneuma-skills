/** @jsxImportSource react */
/**
 * The host glide's WIRING (2026-08-17) — camera-glide.test.ts pins the
 * arithmetic; what this file pins is which camera channel commits as
 * MOTION and which stays the deliberate cut, because the whole defect was
 * a wiring fact: the fold already glided every cross-board walk while the
 * host's own writes cut, and 「我注意力瞬间就丢失了」.
 *
 *  - a locator/navigate jump (`BoardApi.showStep`) GLIDES — no instant
 *    write, frames converge on the follow target, the chain terminates;
 *  - the passive playback follow (activeIndex advancing) GLIDES — the
 *    same-board paragraph chase was the loudest cut of all;
 *  - a seek TRACKS: the camera lands instantly (a dragged playhead is
 *    tracked, not chased) — except a reader being RE-ATTACHED (Live after
 *    a grab), whose return home is precisely the glide they are owed;
 *  - a user gesture mid-flight CANCELS the tween outright.
 *
 * happy-dom has no rAF timing, so the harness installs a CONTROLLABLE
 * rAF: a queue the test flushes with chosen timestamps. Every per-frame
 * assertion is byte-exact against the pure module driven with the same
 * timestamps — no sleeps, no tolerance bands, no flake.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { PANEL_GAP, PANEL_HEIGHT, PANEL_WIDTH } from "../engine/layout.js";
import type { EnvCaps, Lecture, StepRef } from "../engine/types.js";
import {
  cameraCss,
  followShift,
  reattachCamera,
  restZoom,
  wheelZoomFactor,
  zoomAt,
  type Camera,
  type Viewbox,
} from "../viewer/camera.js";
import {
  glidePoseAt,
  stampGlide,
  startGlide,
  type CameraGlide,
} from "../viewer/camera-glide.js";
import { stepKey } from "../viewer/address.js";
import type { BoardApi, CompiledBoard } from "../viewer/BoardCanvas.js";

const SOURCE = [
  "# Glide",
  "",
  "The camera is a walk, not a teleport.",
  "",
  "- First line",
  "- Second line",
  "- Third line",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

/** The stubbed stage: a tall board inside a short viewport. */
const PANEL_W = 800;
const PANEL_H = 3000;
const VIEW_W = 800;
const VIEW_H = 600;

/** The camera's clamp box, as `liveViewbox` reads it on this strip. */
const BOX: Viewbox = { panelW: PANEL_W, panelH: PANEL_H, viewW: VIEW_W, viewH: VIEW_H };

/** The view the HOST hands `startGlide` (viewport size + panel constants). */
const GLIDE_VIEW = {
  viewW: VIEW_W,
  viewH: VIEW_H,
  panelW: PANEL_WIDTH,
  panelH: PANEL_HEIGHT,
  panelCount: 1,
  panelGap: PANEL_GAP,
};

let win: Window;
let restore: (() => void) | undefined;

/** The controllable rAF: callbacks wait here until the test flushes them
 *  with a timestamp of its choosing. */
const rafQueue = new Map<number, (t: number) => void>();
let rafSeq = 0;

function flushFrame(t: number): void {
  const cbs = [...rafQueue.values()];
  rafQueue.clear();
  for (const cb of cbs) cb(t);
}

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
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
    "getComputedStyle",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("requestAnimationFrame", (cb: (t: number) => void): number => {
    rafQueue.set(++rafSeq, cb);
    return rafSeq;
  });
  install("cancelAnimationFrame", (id: number): void => {
    rafQueue.delete(id);
  });
  install(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

function stubSize(el: Element, props: Record<string, number>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
}

interface Mounted {
  stage: HTMLElement;
  viewport: HTMLElement;
  api: BoardApi;
  compiled: CompiledBoard;
  seek: (t: number) => void;
  /** offsetTop stubbed onto each step node, by refKey. */
  topOf: Map<string, number>;
  render(props: { playing?: boolean; activeIndex?: number }): Promise<void>;
  unmount(): Promise<void>;
}

async function mountBoard(
  name: string,
  init: { playing?: boolean; activeIndex?: number; rate?: number } = {},
): Promise<Mounted> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const lecture: Lecture = parseLecture(SOURCE, name);
  let api: BoardApi | null = null;
  let compiled: CompiledBoard | null = null;
  let seekListener: ((t: number) => void) | null = null;

  // IDENTITY-STABLE callbacks, exactly as the real host provides them —
  // inline arrows would re-fire the rebuild effect on every re-render and
  // its re-clamp would masquerade as a camera cut.
  const getPlayheadT = () => 0;
  const onCompiled = (c: CompiledBoard | null) => {
    if (c) compiled = c;
  };
  const onSeek = (l: (t: number) => void) => {
    seekListener = l;
    return () => {};
  };
  const onFrame = () => () => {};
  const onApi = (a: BoardApi | null) => {
    if (a) api = a;
  };

  const paint = async (props: { playing?: boolean; activeIndex?: number }) => {
    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={lecture}
          view="board"
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={getPlayheadT}
          onCompiled={onCompiled}
          activeIndex={props.activeIndex ?? 0}
          playing={props.playing ?? false}
          follow="detached"
          rate={init.rate ?? 1}
          onSeek={onSeek}
          onFrame={onFrame}
          selectedRef={null}
          onApi={onApi}
        />,
      );
    });
  };
  await paint(init);

  const viewport = host.querySelector(".bansho-viewport") as HTMLElement;
  const stage = host.querySelector(".bansho-stage") as HTMLElement;
  const panel = host.querySelector(".bansho-panel") as HTMLElement;
  stubSize(panel, { offsetWidth: PANEL_W, offsetHeight: PANEL_H });
  stubSize(viewport, { clientWidth: VIEW_W, clientHeight: VIEW_H });

  // Give every step node a place on the tall board — happy-dom computes no
  // layout, so the follow target is this fiction, read through `offset*`.
  const topOf = new Map<string, number>();
  const nodes = Array.from(panel.querySelectorAll("[data-bansho-ref]"));
  nodes.forEach((node, i) => {
    const top = 100 + i * 700;
    topOf.set(node.getAttribute("data-bansho-ref")!, top);
    stubSize(node, { offsetTop: top, offsetLeft: 0, offsetWidth: 600, offsetHeight: 40 });
  });

  if (!api || !compiled) throw new Error("board api/compile did not arrive");
  return {
    stage,
    viewport,
    api,
    compiled,
    seek: (t: number) => seekListener!(t),
    topOf,
    render: paint,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
      rafQueue.clear();
    },
  };
}

/** The last scheduled step and its stubbed rect — the deep target every
 *  scenario walks to. */
function lastTarget(m: Mounted): { ref: StepRef; top: number; bottom: number } {
  const entry = m.compiled.timeline.schedule.at(-1)!;
  const top = m.topOf.get(stepKey(entry.step))!;
  return { ref: entry.step, top, bottom: top + 40 };
}

/** Drive the pure module with the same inputs the host used — the byte
 *  oracle every frame is compared against. */
function oracle(from: Camera, to: Camera, rate = 1): CameraGlide {
  return startGlide(from, to, GLIDE_VIEW, DEFAULT_DURATIONS, rate)!;
}

const poseFrom = (stage: HTMLElement): string => stage.style.transform;

describe("the host glide — displacement is motion, not a cut", () => {
  test("a locator jump (BoardApi.showStep) glides to the step and terminates", async () => {
    const m = await mountBoard("glide-locator");
    const { act } = await import("react");
    const before = poseFrom(m.stage);
    const from = { x: 0, y: 0, z: 1 };
    const { ref, top, bottom } = lastTarget(m);
    const to = followShift(from, BOX, { top, bottom })!;
    expect(to).not.toBeNull();

    let ok = false;
    await act(async () => {
      ok = m.api.showStep(ref);
    });
    expect(ok).toBe(true);
    // NOT an instant write any more — the cut is gone…
    expect(poseFrom(m.stage)).toBe(before);
    // …a frame is owed instead.
    expect(rafQueue.size).toBe(1);

    // Frame 1 stamps the clock and paints the departure.
    flushFrame(10_000);
    expect(poseFrom(m.stage)).toBe(cameraCss(from));

    // Every mid-flight frame is the pure module's own answer, byte for byte.
    const g = stampGlide(oracle(from, to), 10_000);
    for (const t of [10_000 + g.durationMs * 0.3, 10_000 + g.durationMs * 0.7]) {
      flushFrame(t);
      expect(poseFrom(m.stage)).toBe(cameraCss(glidePoseAt(g, t).pose));
    }

    // Arrival is the follow target VERBATIM, and the chain stops asking
    // for frames — no idle rAF loop survives the glide. The end frame is
    // flushed strictly PAST the duration: `(start + d) - start` can
    // quantize below `d` on the float grid, and a real browser frame
    // never lands on an exact float boundary either.
    flushFrame(10_000 + g.durationMs + 1);
    expect(poseFrom(m.stage)).toBe(cameraCss(to));
    expect(rafQueue.size).toBe(0);
    await m.unmount();
  });

  test("the playback rate divides the host glide's tempo too", async () => {
    const m = await mountBoard("glide-rate", { rate: 2 });
    const { act } = await import("react");
    const from = { x: 0, y: 0, z: 1 };
    const { ref, top, bottom } = lastTarget(m);
    const to = followShift(from, BOX, { top, bottom })!;
    await act(async () => {
      m.api.showStep(ref);
    });
    flushFrame(20_000);
    const g = stampGlide(oracle(from, to, 2), 20_000);
    expect(g.durationMs).toBe(oracle(from, to, 1).durationMs / 2);
    // At the 2× duration's end the walk is DONE — half the wall-clock the
    // 1× walk would take.
    flushFrame(20_000 + g.durationMs + 1);
    expect(poseFrom(m.stage)).toBe(cameraCss(to));
    expect(rafQueue.size).toBe(0);
    await m.unmount();
  });

  test("the paragraph chase — activeIndex advancing during playback — glides", async () => {
    const m = await mountBoard("glide-chase", { playing: true, activeIndex: 0 });
    const before = poseFrom(m.stage);
    const from = { x: 0, y: 0, z: 1 };
    const { top, bottom } = lastTarget(m);
    const to = followShift(from, BOX, { top, bottom })!;

    // The pen advances to the last entry: the passive follow fires…
    await m.render({ playing: true, activeIndex: m.compiled.timeline.schedule.length - 1 });
    // …and the camera does NOT cut to it.
    expect(poseFrom(m.stage)).toBe(before);
    expect(rafQueue.size).toBe(1);

    flushFrame(30_000);
    const g = stampGlide(oracle(from, to), 30_000);
    flushFrame(30_000 + g.durationMs / 2);
    expect(poseFrom(m.stage)).toBe(
      cameraCss(glidePoseAt(g, 30_000 + g.durationMs / 2).pose),
    );
    flushFrame(30_000 + g.durationMs + 1);
    expect(poseFrom(m.stage)).toBe(cameraCss(to));
    await m.unmount();
  });

  test("a user gesture mid-flight cancels the tween — the hand wins outright", async () => {
    const m = await mountBoard("glide-cancel");
    const { act } = await import("react");
    const { ref } = lastTarget(m);
    await act(async () => {
      m.api.showStep(ref);
    });
    flushFrame(40_000);
    expect(rafQueue.size).toBe(1);

    // The wheel: a camera gesture through the detach door.
    const wheel = new win.WheelEvent("wheel", { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      deltaX: 0, deltaY: -120, deltaMode: 0, clientX: 400, clientY: 300, ctrlKey: false,
    })) {
      Object.defineProperty(wheel, key, { value, configurable: true });
    }
    await act(async () => {
      m.viewport.dispatchEvent(wheel as unknown as Event);
    });
    const held = poseFrom(m.stage);
    // The pending frame was CANCELLED, not left to fight the hand…
    expect(rafQueue.size).toBe(0);
    // …and no stray frame can move the camera again.
    flushFrame(41_000);
    expect(poseFrom(m.stage)).toBe(held);
    await m.unmount();
  });

  test("a seek is a cut: the camera tracks the playhead instantly", async () => {
    const m = await mountBoard("glide-seek");
    const { act } = await import("react");
    const from = { x: 0, y: 0, z: 1 };
    const { top, bottom } = lastTarget(m);
    const to = followShift(from, BOX, { top, bottom })!;
    await act(async () => {
      m.seek(999); // past the end — the last entry is the active one
    });
    // Landed already — no tween, no owed frame.
    expect(poseFrom(m.stage)).toBe(cameraCss(to));
    expect(rafQueue.size).toBe(0);
    await m.unmount();
  });

  test("the Live return — a detached reader re-attaching — glides home", async () => {
    const m = await mountBoard("glide-reattach");
    const { act } = await import("react");
    // The reader takes the camera (wheel = detach)…
    const wheel = new win.WheelEvent("wheel", { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({
      deltaX: 0, deltaY: -120, deltaMode: 0, clientX: 400, clientY: 300, ctrlKey: false,
    })) {
      Object.defineProperty(wheel, key, { value, configurable: true });
    }
    await act(async () => {
      m.viewport.dispatchEvent(wheel as unknown as Event);
    });
    const wandered = poseFrom(m.stage);

    // …then an explicit seek re-engages: the canonical re-attach pose, as
    // a GLIDE even on the seek channel — this is the return the reader is
    // owed, and a scrub's next tick would settle it via the instant path.
    const { top, bottom } = lastTarget(m);
    await act(async () => {
      m.seek(999);
    });
    expect(poseFrom(m.stage)).toBe(wandered);
    expect(rafQueue.size).toBe(1);

    // The departure is the wandered pose — recomputed with the host's own
    // arithmetic on the host's own inputs (string-parsing the transform
    // would drop the last ulp and the oracle's duration would disagree).
    const fromPose = zoomAt(
      { x: 0, y: 0, z: 1 },
      BOX,
      { x: 400, y: 300 },
      wheelZoomFactor(-120, 0),
    );
    expect(cameraCss(fromPose)).toBe(wandered);
    const to = reattachCamera(fromPose, BOX, { top, bottom });
    expect(to.z).toBe(restZoom(VIEW_W, PANEL_WIDTH));

    flushFrame(50_000);
    const g = stampGlide(oracle(fromPose, to), 50_000);
    flushFrame(50_000 + g.durationMs / 2);
    expect(poseFrom(m.stage)).toBe(
      cameraCss(glidePoseAt(g, 50_000 + g.durationMs / 2).pose),
    );
    flushFrame(50_000 + g.durationMs + 1);
    expect(poseFrom(m.stage)).toBe(cameraCss(to));
    expect(rafQueue.size).toBe(0);
    await m.unmount();
  });

  test("unmounting mid-flight leaves no frame behind", async () => {
    const m = await mountBoard("glide-unmount");
    const { act } = await import("react");
    const { ref } = lastTarget(m);
    await act(async () => {
      m.api.showStep(ref);
    });
    expect(rafQueue.size).toBe(1);
    await m.unmount();
    expect(rafQueue.size).toBe(0);
  });
});
