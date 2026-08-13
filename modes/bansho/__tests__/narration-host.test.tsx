/** @jsxImportSource react */
/**
 * The narration host seam (T10, pinned after R1 review): BoardCanvas is
 * where the manifest prop becomes a G3 hook becomes `compiled.narration`.
 * The pure layer is tested to the bone in narration.test.ts — what nothing
 * pinned was the INSTALLATION: that a board rendered with a manifest
 * actually compiles a stretched schedule and hands the clip windows
 * upward. That is the seam the audio conductor (T10-4) consumes, so it
 * gets an assertion of its own — and the flow test below closes the loop
 * from those windows to audible, hold-gated playback.
 *
 * Same happy-dom harness as theme-remeasure.test.tsx: Bun has no layout
 * engine, so the pixels stay the screenshots' job — the seam is about
 * values, not geometry.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps } from "../engine/types.js";
import { flattenSteps } from "../engine/inference.js";
import { stepContentHash, stepPlainText } from "../engine/text.js";
import type { NarrationManifest } from "../narration/types.js";
import type { CompiledBoard } from "../viewer/BoardCanvas.js";

const SOURCE = [
  "# Board",
  "",
  "The ceiling is set by the serial fraction.",
  "",
  "The parallel part thins out; the serial part does not move.",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

let restore: (() => void) | undefined;

beforeAll(() => {
  const window = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = window as unknown as Record<string, unknown>;
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
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? window : w[key]);
  }
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

describe("BoardCanvas — a narration manifest reaches the compile", () => {
  test("manifest prop → G3 hook → stretched schedule + clip windows upward", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

    const lecture = parseLecture(SOURCE, "narration-host");
    const { step } = flattenSteps(lecture).find(({ step }) =>
      stepPlainText(step).includes("serial fraction"),
    )!;
    const hash = stepContentHash(step, lecture.source);
    // 600s is far past every clamp band — the footprint pins at
    // 2.5 × natural, so the narrated compile MUST run longer than the
    // silent one if (and only if) the hook was actually installed.
    const manifest: NarrationManifest = {
      clips: {
        [hash]: {
          file: `narration/${hash}.wav`,
          seconds: 600,
          text: "the spoken line",
        },
      },
    };

    const compiles: CompiledBoard[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = {
      lecture,
      view: "board" as const,
      theme: "light" as const,
      fontsReady: true,
      env: ENV,
      getPlayheadT: () => 0,
      onCompiled: (c: CompiledBoard | null) => {
        if (c) compiles.push(c);
      },
      activeIndex: 0,
      playing: false,
      follow: "live" as const,
      onSeek: () => () => {},
      onFrame: () => () => {},
      selectedRef: null,
    };

    await act(async () => {
      root.render(<BoardCanvas {...props} narration={null} />);
    });
    const silent = compiles[compiles.length - 1]!;
    // A silent board's compile carries no windows — playback follows
    // content-derived pacing untouched (the degradation guarantee).
    expect(silent.narration).toEqual([]);

    await act(async () => {
      root.render(<BoardCanvas {...props} narration={manifest} />);
    });
    const narrated = compiles[compiles.length - 1]!;

    expect(narrated.narration).toHaveLength(1);
    const window0 = narrated.narration[0]!;
    expect(window0.hash).toBe(hash);
    expect(window0.audioSeconds).toBe(600);
    // The windows are read off the applied record, so they sit inside the
    // stretched schedule the same compile produced.
    expect(narrated.timeline.duration).toBeGreaterThan(
      silent.timeline.duration,
    );
    expect(window0.audioEnd).toBeGreaterThan(window0.start);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  // R1-review F1 (resolved by T10-4): the windows now HAVE their consumer.
  // This is the flow-level closure of the seam test above: manifest →
  // windows (pinned there through BoardCanvas) → conductor sounds the clip
  // → the clock gate projects the element's clock and holds at holdAt
  // until the voice finishes. The element is the shared fake (Bun has no
  // media engine); the timeline is a real compile.
  test("T10-4: a narration manifest produces audible playback — the conductor sounds the window, the clock holds at holdAt until the voice finishes", async () => {
    const { DEFAULT_DURATIONS } = await import("../engine/duration.js");
    const { buildTimeline } = await import("../engine/timeline.js");
    const { clipWindows, createNarrationHook } = await import(
      "../narration/timing.js"
    );
    const { AudioConductor } = await import("../viewer/audio-conductor.js");
    const { gatedTick } = await import("../viewer/clock-gate.js");
    const { createPlayer } = await import("../viewer/player-core.js");
    const { FakeAudioElement, FakeGestureTarget } = await import(
      "./fake-audio.js"
    );

    const lecture = parseLecture(SOURCE, "narration-host");
    const { step } = flattenSteps(lecture).find(({ step }) =>
      stepPlainText(step).includes("serial fraction"),
    )!;
    const hash = stepContentHash(step, lecture.source);
    // 30s is far past the 2.5× clamp for this sentence: the footprint caps
    // and the voice must finish over a hold at the next pen-down.
    const manifest: NarrationManifest = {
      clips: {
        [hash]: { file: `narration/${hash}.wav`, seconds: 30, text: "spoken" },
      },
    };
    const hook = createNarrationHook(lecture.source, manifest)!;
    const timeline = buildTimeline(lecture, {
      durations: DEFAULT_DURATIONS,
      durationOverride: hook.durationOverride,
    });
    const windows = clipWindows(timeline.schedule, hook.applied);
    const w = windows[0]!;
    expect(w.holdAt).not.toBeNull();

    const element = new FakeAudioElement();
    const conductor = new AudioConductor({
      resolveUrl: (path) => `/api/file?path=${path}`,
      createElement: () => element,
      gestureTarget: new FakeGestureTarget(),
    });
    conductor.setProgram(
      windows,
      new Map([[hash, `narration/${hash}.wav`]]),
    );

    // Play the board from 0 the way the hook does: conductor.frame →
    // gatedTick per frame, the fake media engine advancing alongside.
    let s = createPlayer(timeline.duration, false);
    const dt = 1 / 30;
    let trackedFrames = 0;
    let heldFrames = 0;
    for (let i = 0; i < 4000 && s.t < timeline.duration; i++) {
      const { window, audio } = conductor.frame(s.t, s.rate);
      const next = gatedTick(s, dt, window, audio);
      if (audio?.sounding) {
        if (next.t < w.holdAt! - 1e-9) {
          // Audio master before the hold: the playhead IS the projection
          // of the element's clock.
          expect(next.t).toBeCloseTo(w.start + element.currentTime, 6);
          trackedFrames++;
        } else if (next.t === w.holdAt!) {
          heldFrames++;
        }
        // Never past the pen-down while the voice still sounds.
        expect(next.t).toBeLessThanOrEqual(w.holdAt!);
      }
      s = next;
      element.advance(dt);
      if (element.currentTime >= 30) element.end();
    }

    expect(element.playCalls).toBe(1); // sounded once, never restarted
    expect(trackedFrames).toBeGreaterThan(10); // audio really owned the clock
    expect(heldFrames).toBeGreaterThan(10); // the hold really bound
    // The voice finished and the board played on to its end.
    expect(s.t).toBeGreaterThanOrEqual(timeline.duration - 1e-9);
  });
});

describe("useBoardPlayer — every transport act reaches the narration clock", () => {
  test("scrub aligns silently, resume continues, rate rides the element", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { createElement } = await import("react");
    const { useBoardPlayer } = await import("../viewer/useBoardPlayer.js");
    type Handle = ReturnType<typeof useBoardPlayer>["player"];

    const calls: Array<[string, ...unknown[]]> = [];
    const clock = {
      frame: () => ({ window: null, audio: null }),
      seek: (t: number, playing: boolean) => calls.push(["seek", t, playing]),
      resume: (t: number) => calls.push(["resume", t]),
      pause: () => calls.push(["pause"]),
      setRate: (rate: number) => calls.push(["setRate", rate]),
    };
    const timeline = {
      duration: 10,
      schedule: [],
      seek: () => {},
    } as unknown as import("../engine/types.js").BoardTimeline;

    let handle: Handle | null = null;
    function Probe() {
      handle = useBoardPlayer(timeline, false, "", clock).player;
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Probe));
    });

    await act(async () => handle!.scrubTo(3));
    expect(calls).toContainEqual(["seek", 3, false]); // silent alignment
    await act(async () => handle!.togglePlay());
    const afterResume = calls[calls.length - 1]!;
    expect(afterResume[0]).toBe("resume"); // same playhead → no re-seek
    await act(async () => handle!.togglePlay());
    expect(calls[calls.length - 1]![0]).toBe("pause");
    await act(async () => handle!.playFrom(2));
    expect(calls).toContainEqual(["seek", 2, true]);
    await act(async () => handle!.goLive());
    expect(calls).toContainEqual(["seek", 10, true]);
    await act(async () => handle!.setRate(1.25));
    expect(calls).toContainEqual(["setRate", 1.25]);
    // A skim rate reaches the conductor exactly the same way — what it
    // DOES there (step aside) is the conductor's own contract.
    await act(async () => handle!.setRate(16));
    expect(calls[calls.length - 1]).toEqual(["setRate", 16]);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
