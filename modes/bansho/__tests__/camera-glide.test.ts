/**
 * camera-glide.ts — the host-side camera tween as a pure module (zero DOM;
 * happy-dom has no rAF timing, so the module is state + pose-at-time pure
 * functions and the HOST owns the animation frames).
 *
 * What it exists for (2026-08-17, measured on a real reader): only `@turn`
 * had a transition — every other camera displacement was an instant cut,
 * and 「我注意力瞬间就丢失了，无法跟着讲述者」. The canonical schedule
 * already glides every cross-board walk with Van Wijk paths and arc-length
 * durations; this module gives the HOST'S OWN writes (the same-board
 * paragraph chase, the hand-back, the Live re-attach, a locator jump) the
 * same treatment — with literally the same arithmetic.
 *
 * The load-bearing property pinned here: the tween IS the director's
 * arithmetic. `glidePoseAt` must answer byte-for-byte what
 * `cameraPoseAt(from, to, view, rho, easeCamera(p))` answers, and the
 * duration must be `cameraMoveDuration(...)` under the same
 * `DEFAULT_DURATIONS` — one motion vocabulary in code, not in prose. A
 * near nudge is quick and a long walk is slow for free, because the cost
 * function is the move's perceptual size.
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_DURATIONS } from "../engine/duration.js";
import {
  cameraMoveDuration,
  cameraPoseAt,
  easeCamera,
  type CameraPose,
  type StageView,
} from "../engine/stage.js";
import {
  glidePoseAt,
  glideRoomSeconds,
  samePose,
  stampGlide,
  startGlide,
} from "../viewer/camera-glide.js";

const VIEW: StageView = {
  viewW: 1600,
  viewH: 900,
  panelW: 1242,
  panelH: 932,
  panelCount: 2,
  panelGap: 32,
};

const FROM: CameraPose = { x: 0, y: 0, z: 1 };
const TO: CameraPose = { x: 1274, y: 120, z: 1 };
/** A same-board vertical chase — the paragraph follow's typical move. */
const NUDGE: CameraPose = { x: 0, y: 180, z: 1 };

describe("startGlide — one motion vocabulary", () => {
  test("duration is the director's own arc-length seconds, in ms", () => {
    const glide = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1);
    expect(glide).not.toBeNull();
    expect(glide!.durationMs).toBe(
      cameraMoveDuration(FROM, TO, VIEW, DEFAULT_DURATIONS) * 1000,
    );
    expect(glide!.rho).toBe(DEFAULT_DURATIONS.cameraRho);
  });

  test("a near nudge is quicker than a cross-board walk, for free", () => {
    const nudge = startGlide(FROM, NUDGE, VIEW, DEFAULT_DURATIONS, 1)!;
    const walk = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    expect(nudge.durationMs).toBeGreaterThan(0);
    expect(nudge.durationMs).toBeLessThan(walk.durationMs);
  });

  test("the playback rate divides the duration — camera tempo tracks lecture tempo", () => {
    const at1 = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    const at2 = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 2)!;
    const at15 = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1.5)!;
    expect(at2.durationMs).toBe(at1.durationMs / 2);
    expect(at15.durationMs).toBe(at1.durationMs / 1.5);
  });

  test("a degenerate rate falls back to 1, never to a frozen or negative tween", () => {
    const at1 = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, rate)!.durationMs).toBe(
        at1.durationMs,
      );
    }
  });

  test("zero travel is a cut, not a glide — null", () => {
    expect(startGlide(FROM, { ...FROM }, VIEW, DEFAULT_DURATIONS, 1)).toBeNull();
  });

  test("an unmeasured viewport is a cut, not a NaN tween — null", () => {
    for (const view of [
      { ...VIEW, viewW: 0 },
      { ...VIEW, viewH: 0 },
      { ...VIEW, viewW: -1 },
    ]) {
      expect(startGlide(FROM, TO, view, DEFAULT_DURATIONS, 1)).toBeNull();
    }
  });

  test("a glide begins unstamped — its clock is the first frame's, not construction's", () => {
    const glide = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    expect(glide.startMs).toBeNull();
  });
});

describe("stampGlide — the first frame is t = 0", () => {
  test("stamps once, verbatim thereafter", () => {
    const glide = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    const stamped = stampGlide(glide, 5000);
    expect(stamped.startMs).toBe(5000);
    // Already stamped: the same object, not a re-based copy — restamping
    // mid-flight would silently restart the tween's clock.
    expect(stampGlide(stamped, 9000)).toBe(stamped);
  });
});

describe("glidePoseAt — the director's arithmetic, frame by frame", () => {
  const glide = stampGlide(
    startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!,
    1000,
  );

  test("every interpolated frame is cameraPoseAt at the eased progress, byte for byte", () => {
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const now = 1000 + f * glide.durationMs;
      const { pose, done } = glidePoseAt(glide, now);
      expect(done).toBe(false);
      // The expected side recovers the progress through the SAME float
      // path the module walks (now − start, then the divide) — byte
      // equality then pins "same arithmetic", not float algebra.
      const p = (now - 1000) / glide.durationMs;
      expect(pose).toEqual(
        cameraPoseAt(FROM, TO, VIEW, glide.rho, easeCamera(p)),
      );
    }
  });

  test("endpoint-exact: departure and arrival are the poses VERBATIM", () => {
    // The from/to objects themselves — cameraPoseAt's u<=0 / u>=1 contract,
    // inherited rather than re-implemented (no float drift at either end).
    expect(glidePoseAt(glide, 1000).pose).toBe(FROM);
    expect(glidePoseAt(glide, 999).pose).toBe(FROM);
    const end = glidePoseAt(glide, 1000 + glide.durationMs);
    expect(end.pose).toBe(TO);
    expect(end.done).toBe(true);
    expect(glidePoseAt(glide, 1e9).pose).toBe(TO);
  });

  test("done flips exactly at the duration, not a frame early", () => {
    expect(glidePoseAt(glide, 1000 + glide.durationMs - 0.001).done).toBe(false);
    expect(glidePoseAt(glide, 1000 + glide.durationMs).done).toBe(true);
  });

  test("an unstamped glide answers its departure and is never done", () => {
    const fresh = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    const { pose, done } = glidePoseAt(fresh, 123456);
    expect(pose).toBe(FROM);
    expect(done).toBe(false);
  });

  test("pure in (glide, now): the same query answers the same pose", () => {
    const t = 1000 + 0.37 * glide.durationMs;
    expect(glidePoseAt(glide, t)).toEqual(glidePoseAt(glide, t));
  });
});

describe("a leg departs the painted pose — no jump at any seam", () => {
  // The HOST absorbs mid-flight targets and starts the next leg only at
  // arrival (camera-glide-host.test.tsx pins that law); what is pure and
  // pinned HERE is the seam arithmetic it relies on: a glide started from
  // the pose on screen paints exactly that pose on its first frame.
  test("a new leg's first frame is exactly the pose on screen", () => {
    const first = stampGlide(
      startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!,
      1000,
    );
    // The host repaints cameraRef every frame, so the painted pose at the
    // moment of retarget IS glidePoseAt(first, now) — the new glide starts
    // from it with no jump.
    const painted = glidePoseAt(first, 1000 + 0.4 * first.durationMs).pose;
    const next = stampGlide(
      startGlide(painted, NUDGE, VIEW, DEFAULT_DURATIONS, 1)!,
      1400,
    );
    expect(glidePoseAt(next, 1400).pose).toBe(painted);
  });
});

describe("samePose", () => {
  test("exact equality on all three axes", () => {
    expect(samePose({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(true);
    expect(samePose({ x: 1, y: 2, z: 3 }, { x: 1, y: 2.0001, z: 3 })).toBe(false);
    expect(samePose({ x: 0, y: -0, z: 1 }, { x: -0, y: 0, z: 1 })).toBe(true);
  });
});

describe("the clip rule — the host never starts a glide it cannot finish", () => {
  test("maxMs below the natural tempo clips the duration to the room", () => {
    const natural = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    const room = natural.durationMs / 3;
    const clipped = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, room)!;
    expect(clipped.durationMs).toBe(room);
    // The path itself is untouched — same endpoints, same rho; only the
    // clock is shorter, so the walk plays faster rather than dying early.
    expect(clipped.from).toBe(FROM);
    expect(clipped.to).toBe(TO);
    expect(clipped.rho).toBe(natural.rho);
  });

  test("maxMs above the natural tempo (or Infinity) changes nothing", () => {
    const natural = startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1)!;
    expect(
      startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, natural.durationMs * 2)!
        .durationMs,
    ).toBe(natural.durationMs);
    expect(
      startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, Infinity)!.durationMs,
    ).toBe(natural.durationMs);
  });

  test("no room is a cut, not a fast glide — the fold's lead <= 0 rule, mirrored", () => {
    expect(startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, 0)).toBeNull();
    expect(startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, -50)).toBeNull();
    // A broken room (NaN) must degrade to the cut too — a tween with an
    // unknowable budget is never an answer.
    expect(startGlide(FROM, TO, VIEW, DEFAULT_DURATIONS, 1, NaN)).toBeNull();
  });
});

describe("glideRoomSeconds — the budget before the director's next window", () => {
  const view = VIEW;
  const move = (start: number, end: number) => ({
    start,
    end,
    holdUntil: end + 1,
    from: FROM,
    to: TO,
  });

  test("no schedule, or no window ahead: open country (Infinity)", () => {
    expect(glideRoomSeconds(null, 3)).toBe(Infinity);
    expect(
      glideRoomSeconds({ view, rho: 1.4, moves: [move(1, 2)] }, 5),
    ).toBe(Infinity);
  });

  test("the first move start beyond t is the boundary", () => {
    const schedule = { view, rho: 1.4, moves: [move(1, 2), move(8, 9), move(20, 21)] };
    expect(glideRoomSeconds(schedule, 5)).toBe(3);
    // Standing exactly on a start: that window is open NOW, the next one
    // is the boundary — room is measured to a window that has yet to open.
    expect(glideRoomSeconds(schedule, 8)).toBe(12);
  });

  test("a non-finite clock reads as open country, never NaN room", () => {
    expect(
      glideRoomSeconds({ view, rho: 1.4, moves: [move(1, 2)] }, NaN),
    ).toBe(Infinity);
  });
});
