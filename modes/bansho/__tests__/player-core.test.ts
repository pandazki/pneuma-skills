/**
 * Player state machine (T4) — the transitions behind `useBoardPlayer`.
 *
 * Bar (T4-impl 验收):
 *  - rate scales the clock's dt ONLY — canonical duration never changes
 *    ("倍速不改总时长");
 *  - live follow: hold at the tip (playing stays true), auto-resume from
 *    the HELD position when an append extends the timeline (R2 — zero
 *    replay: the playhead never rewinds in live mode);
 *  - scrub detaches (R7); the Live button returns to the tip;
 *  - timeline swaps clamp forward-only (R3) and never yank a detached
 *    user's position.
 */

import { describe, expect, test } from "bun:test";

import {
  RATES,
  createPlayer,
  goLive,
  pause,
  scrub,
  setRate,
  tick,
  playFrom,
  timelineReplaced,
  togglePlay,
  type PlayerState,
} from "../viewer/player-core.js";

describe("createPlayer — live join", () => {
  test("opens at the content tip in live mode, playing", () => {
    const s = createPlayer(42);
    expect(s).toEqual({
      t: 42,
      playing: true,
      rate: 1,
      follow: "live",
      duration: 42,
    });
  });

  test("an empty board joins live at 0 — the first append plays from the start", () => {
    const s = createPlayer(0);
    expect(s.t).toBe(0);
    expect(s.follow).toBe("live");
    expect(s.playing).toBe(true);
  });

  test("joinAtTip=false starts a NON-empty first timeline from 0 — a board born under the viewer's eyes is broadcast, not history", () => {
    // The empty-at-open case: the workspace had no board when the viewer
    // hydrated, so the first compiled timeline IS the live stream from its
    // first character (R2), not history to skip.
    const s = createPlayer(8, false);
    expect(s).toEqual({
      t: 0,
      playing: true,
      rate: 1,
      follow: "live",
      duration: 8,
    });
  });

  test("joinAtTip defaults to true — opening an existing board lands at the tip (zero replay of history)", () => {
    expect(createPlayer(42).t).toBe(42);
    expect(createPlayer(42, true).t).toBe(42);
  });
});

describe("rate — clock speed only, canonical untouched", () => {
  test("tick advances t by dt × rate", () => {
    let s: PlayerState = { ...createPlayer(100), t: 0 };
    s = setRate(s, 1.5);
    s = tick(s, 2);
    expect(s.t).toBeCloseTo(3, 12);
    s = setRate(s, 0.75);
    s = tick(s, 4);
    expect(s.t).toBeCloseTo(6, 12);
  });

  test("no rate transition ever changes duration (倍速不改总时长)", () => {
    let s = createPlayer(37.5);
    for (const r of RATES) {
      s = setRate(s, r);
      expect(s.duration).toBe(37.5);
      s = tick(s, 1);
      expect(s.duration).toBe(37.5);
    }
  });

  test("the ladder reaches the skim rates and keeps the study end", () => {
    // Two jobs, one scale: 0.75 exists to study a single stroke, 8 and 16
    // exist to judge a five-minute wall in twenty seconds. Ascending, with
    // 1 on it — every consumer (the menu's order, the `Rate` type) reads
    // the ladder rather than restating it.
    expect([...RATES]).toEqual([0.75, 1, 1.25, 1.5, 2, 4, 8, 16]);
    for (let i = 1; i < RATES.length; i++) {
      expect(RATES[i]!).toBeGreaterThan(RATES[i - 1]!);
    }
    expect(RATES).toContain(1);
  });

  test("setRate jumps to any rung — the ladder is chosen from, not walked", () => {
    let s = createPlayer(10);
    s = setRate(s, 16);
    expect(s.rate).toBe(16);
    expect(s.duration).toBe(10); // 倍速不改总时长, at the skim end too
    s = setRate(s, 0.75);
    expect(s.rate).toBe(0.75);
  });

  test("a skim rate scales the clock and nothing else", () => {
    let s: PlayerState = { ...createPlayer(1000), t: 0 };
    s = setRate(s, 16);
    s = tick(s, 1);
    expect(s.t).toBeCloseTo(16, 12);
    expect(s.duration).toBe(1000);
  });
});

describe("live follow — hold and auto-resume (R2, zero replay)", () => {
  test("reaching the end in live mode HOLDS: playing stays true", () => {
    let s: PlayerState = { ...createPlayer(5), t: 4.5 };
    s = tick(s, 10); // clock overshoots
    expect(s.t).toBe(5);
    expect(s.playing).toBe(true);
    expect(s.follow).toBe("live");
  });

  test("an append extends the timeline and the SAME ticking resumes from the held position", () => {
    let s: PlayerState = { ...createPlayer(5), t: 5 };
    s = tick(s, 3); // held at the tip
    expect(s.t).toBe(5);
    s = timelineReplaced(s, 9); // agent appended content
    expect(s.t).toBe(5); // no jump, no reset — zero replay
    s = tick(s, 1);
    expect(s.t).toBe(6); // continues forward from the hold
    expect(s.playing).toBe(true);
  });

  test("live playhead is monotone across any tick/append interleaving", () => {
    let s: PlayerState = { ...createPlayer(2), t: 0 };
    let prev = s.t;
    const events: Array<() => void> = [
      () => (s = tick(s, 0.5)),
      () => (s = timelineReplaced(s, 3)),
      () => (s = tick(s, 5)),
      () => (s = timelineReplaced(s, 7)),
      () => (s = tick(s, 0.25)),
      () => (s = timelineReplaced(s, 7.5)),
      () => (s = tick(s, 100)),
    ];
    for (const apply of events) {
      apply();
      expect(s.t).toBeGreaterThanOrEqual(prev);
      prev = s.t;
    }
  });

  test("a SHORTER recompiled timeline clamps, never rewinds below the new end (R3)", () => {
    let s: PlayerState = { ...createPlayer(10), t: 10 };
    s = timelineReplaced(s, 6);
    expect(s.t).toBe(6); // clamped to the new tip — still fully-shown state
    expect(s.follow).toBe("live");
  });
});

describe("detached — the user owns the playhead (R7)", () => {
  test("scrub detaches and pauses at the target", () => {
    let s = createPlayer(20);
    s = scrub(s, 7.25);
    expect(s).toMatchObject({ t: 7.25, follow: "detached", playing: false });
  });

  test("scrub clamps into [0, duration]", () => {
    const s = createPlayer(20);
    expect(scrub(s, -3).t).toBe(0);
    expect(scrub(s, 99).t).toBe(20);
  });

  test("reaching the end while detached stops playback (end-of-media)", () => {
    let s = createPlayer(5);
    s = scrub(s, 4.8);
    s = togglePlay(s);
    expect(s.playing).toBe(true);
    s = tick(s, 1);
    expect(s.t).toBe(5);
    expect(s.playing).toBe(false);
  });

  test("appends extend duration but never move a detached playhead", () => {
    let s = createPlayer(5);
    s = scrub(s, 2);
    s = timelineReplaced(s, 12);
    expect(s.t).toBe(2);
    expect(s.playing).toBe(false);
    expect(s.follow).toBe("detached");
  });

  test("togglePlay at the end restarts from 0 (replay affordance)", () => {
    let s = createPlayer(5);
    s = scrub(s, 5);
    s = togglePlay(s);
    expect(s.t).toBe(0);
    expect(s.playing).toBe(true);
  });

  test("pausing detaches — live is only re-entered via goLive", () => {
    let s = createPlayer(5);
    expect(s.follow).toBe("live");
    s = togglePlay(s); // pause
    expect(s.follow).toBe("detached");
    s = goLive(s);
    expect(s).toMatchObject({ t: 5, follow: "live", playing: true });
  });
});

describe("pause — the gesture-safe transport act (C1′)", () => {
  test("pausing a playing board detaches, exactly like the pause button", () => {
    const s = pause(createPlayer(20));
    expect(s).toMatchObject({ playing: false, follow: "detached", t: 20 });
  });

  test("pausing an already paused board is the IDENTICAL state", () => {
    // Identity, not equality: the host skips its voice + camera work on
    // `next !== prev`, and a grab on a paused board must do neither.
    const paused = scrub(createPlayer(20), 7);
    expect(pause(paused)).toBe(paused);
  });

  test("it can never START playback — that is why a grab may not toggle", () => {
    // THE hazard this transition exists for: the camera host knows
    // `playing` one render late, and grabbing a paused board through a
    // toggle would set the board moving under the user's hand.
    let s = scrub(createPlayer(20), 7);
    for (let i = 0; i < 3; i++) s = pause(s);
    expect(s.playing).toBe(false);
  });

  test("togglePlay's pause branch IS this transition", () => {
    const playing = createPlayer(20);
    expect(togglePlay(playing)).toEqual(pause(playing));
  });
});

describe("tick totality", () => {
  test("non-finite or non-positive dt is inert", () => {
    const s: PlayerState = { ...createPlayer(10), t: 3 };
    expect(tick(s, NaN)).toBe(s);
    expect(tick(s, -1)).toBe(s);
    expect(tick(s, 0)).toBe(s);
  });

  test("paused state ignores ticks", () => {
    let s = createPlayer(10);
    s = scrub(s, 3);
    expect(tick(s, 5)).toBe(s);
  });

  test("live hold at the tip returns the IDENTICAL object — the hook's rAF idle guard depends on it", () => {
    let s: PlayerState = { ...createPlayer(5), t: 4.8 };
    s = tick(s, 10); // reach the tip and hold (playing stays true)
    expect(s.t).toBe(5);
    expect(s.playing).toBe(true);
    // Identity, not equality: useBoardPlayer skips apply() (seek + DOM
    // fan-out + setState) whenever tick returns the same object, so an
    // idle board at the tip does zero per-frame work.
    expect(tick(s, 0.016)).toBe(s);
  });
});

// ── T6: the agent's playback verb ───────────────────────────────────────────

describe("playFrom — the agent replays a stretch of the lecture", () => {
  test("starts playing from the given moment, detached from the live tip", () => {
    const s = playFrom(createPlayer(30), 12);
    expect(s.t).toBe(12);
    expect(s.playing).toBe(true);
    // "Watch this part again" is the user's position now — an append must
    // not yank them forward (R7 detached semantics).
    expect(s.follow).toBe("detached");
  });

  test("clamps into range instead of leaving the playhead outside it", () => {
    expect(playFrom(createPlayer(30), -5).t).toBe(0);
    expect(playFrom(createPlayer(30), 99).t).toBe(30);
  });

  test("a non-finite moment is refused, not silently read as 0", () => {
    const before = createPlayer(30);
    expect(playFrom(before, NaN)).toBe(before);
  });

  test("playback rate is the user's setting and survives", () => {
    let s = createPlayer(30);
    s = setRate(s, 1.5);
    expect(playFrom(s, 4).rate).toBe(1.5);
  });

  test("replaying an ended board really restarts it", () => {
    let s = createPlayer(30);
    s = scrub(s, 30); // detached + paused at the very end
    expect(s.playing).toBe(false);
    s = playFrom(s, 0);
    expect(s).toMatchObject({ t: 0, playing: true, follow: "detached" });
  });
});
