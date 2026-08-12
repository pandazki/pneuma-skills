/**
 * `glance-board` timing (S1 §6), and the §9.1 notification slot after the
 * canvas pivot emptied it.
 *
 * The §13 action-timing pins: a probe mismatch DEFERS the answer until
 * the compile catches up; a timeout answers honestly with "catching-up"
 * and the render's honest tail; a failed probe blocks nothing. Then the
 * negatives that replaced `boardAutoErased` — the room retires no board,
 * so nothing announces a retirement (design §2.3, 2026-08-11).
 */

import { describe, expect, test } from "bun:test";

import { parseLecture } from "../domain.js";
import { foldBoardLayout, type LayoutStepInput } from "../engine/layout.js";
import { FINDING_CODES } from "../viewer/board-check.js";
import {
  glanceBoard,
  type GlanceHost,
  type SnapshotBasis,
} from "../viewer/glance.js";

const content = (key: string, height: number): LayoutStepInput => ({
  kind: "content",
  key,
  height,
});

const SRC_V1 = `# 题\n\n甲。\n`;
const SRC_V2 = `# 题\n\n甲。\n\n乙。\n`;

const basisOf = (source: string): SnapshotBasis => {
  const lecture = parseLecture(source);
  const inputs: LayoutStepInput[] = [content("0:-1", 10), content("0:0", 20)];
  if (source === SRC_V2) inputs.push(content("0:1", 20));
  return { inputs, count: 1, budget: Infinity, columns: 1, source, lecture };
};

/** A scriptable host: a virtual clock, a swappable basis, a probe answer,
 *  and a log of every wait. */
function makeHost(opts: {
  live: string;
  basis: SnapshotBasis | null;
  disk: string | null;
  /** Called on each waitForCompile — mutate the world, return the ms to
   *  advance the virtual clock by. */
  onWait?: (host: { basis: SnapshotBasis | null }) => number;
}) {
  let t = 0;
  const world = { basis: opts.basis };
  const waits: number[] = [];
  const host: GlanceHost = {
    liveSource: () => opts.live,
    readBasis: () => world.basis,
    probeDisk: () => Promise.resolve(opts.disk),
    now: () => t,
    waitForCompile: (ms) => {
      waits.push(ms);
      t += opts.onWait ? opts.onWait(world) : ms;
      return Promise.resolve();
    },
  };
  return { host, waits, world };
}

describe("glance-board — the §6 wait semantics", () => {
  test("emit ahead of the compile: the answer DEFERS until the basis catches up, then reports complete", async () => {
    const { host, waits } = makeHost({
      live: SRC_V2,
      basis: basisOf(SRC_V1),
      disk: SRC_V2,
      onWait: (world) => {
        world.basis = basisOf(SRC_V2); // the compile lands mid-wait
        return 50;
      },
    });
    const result = await glanceBoard(host);
    expect(waits.length).toBe(1);
    expect(result.success).toBe(true);
    const lines = (result.message ?? "").split("\n");
    expect(lines[lines.length - 1]).toBe(
      "This answers all 3 steps of board.md, measured.",
    );
    expect((result.data as { basis: { measured: string } }).basis.measured).toBe(
      "complete",
    );
  });

  test("timeout: the answer is the CURRENT basis, honestly marked catching-up — never a hang, never a lie", async () => {
    const { host } = makeHost({
      live: SRC_V2,
      basis: basisOf(SRC_V1),
      disk: SRC_V2,
      // The compile never lands; each wait burns the remaining budget.
    });
    const result = await glanceBoard(host);
    expect(result.success).toBe(true);
    const lines = (result.message ?? "").split("\n");
    expect(lines[lines.length - 1]).toBe(
      "The board is still catching up to board.md — this answers what is standing now; ask again in a moment for the tail.",
    );
    // The answer covers what IS standing (the v1 basis), said as such.
    expect((result.data as { basis: { steps: number } }).basis.steps).toBe(2);
  });

  test("a failed probe accuses nothing and blocks nothing: basis == live answers immediately", async () => {
    const { host, waits } = makeHost({
      live: SRC_V1,
      basis: basisOf(SRC_V1),
      disk: null, // the probe could not answer
    });
    const result = await glanceBoard(host);
    expect(waits).toEqual([]);
    expect(result.success).toBe(true);
    expect(
      (result.data as { basis: { measured: string } }).basis.measured,
    ).toBe("complete");
  });

  test("gap B — the disk is ahead of everything the viewer has: wait, then answer catching-up", async () => {
    const { host, waits } = makeHost({
      live: SRC_V1,
      basis: basisOf(SRC_V1),
      disk: SRC_V2, // written to disk; the watcher event is still in flight
    });
    const result = await glanceBoard(host);
    expect(waits.length).toBeGreaterThan(0);
    expect(
      (result.data as { basis: { measured: string } }).basis.measured,
    ).toBe("catching-up");
  });

  test("no board open: the mirror of check-board's empty answer", async () => {
    const { host } = makeHost({
      live: SRC_V1,
      basis: null,
      disk: null,
    });
    host.liveSource = () => null;
    const result = await glanceBoard(host);
    expect(result).toEqual({
      success: true,
      message: "The board is empty — nothing is standing yet.",
      data: {
        boards: [],
        pen: { panel: 0, roomSteps: null, nextOverflow: null },
        tip: null,
        basis: { steps: 0, measured: "complete" },
      },
    });
  });

  test("mounted but never built: an honest refusal, not an invented board", async () => {
    const { host } = makeHost({ live: SRC_V1, basis: null, disk: SRC_V1 });
    const result = await glanceBoard(host);
    expect(result).toEqual({
      success: false,
      message: "The board is still being measured — ask again in a moment.",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// §9.1 — the notification that no longer has an event (design §2.3/§5.5)
// ────────────────────────────────────────────────────────────────────────────

describe("boardAutoErased is GONE — the room retires nothing, so nothing announces a retirement", () => {
  // Until 2026-08-11 this block pinned an `info` push whose wording
  // branched on the trigger ("To give you a clean board for @turn, the
  // room erased board 1 (…)" / "To keep writing, the room erased …").
  // The canvas pivot deleted the physics behind both sentences. The
  // deletion is asserted three ways, because a notification type that
  // survives as a string in one place and dies in another is worse than
  // either.
  test("no deriver survives on the projection module", async () => {
    const mod = await import("../viewer/board-snapshot.js");
    expect("deriveAutoEraseNotification" in mod).toBe(false);
  });

  test("the fold gives it nothing to speak from: a wall with no clean board synthesizes NO erase", () => {
    const layout = foldBoardLayout(
      [
        { kind: "content", key: "0:1", height: 90 },
        { kind: "content", key: "0:2", height: 90 },
        { kind: "turn", key: "0:3" },
        { kind: "content", key: "0:4", height: 90 },
      ],
      2,
      100,
    );
    expect(layout.eraseOps).toEqual([]);
    expect(layout.turns[0]!.fullWall).toBe(true);
  });

  test("HARD GUARD survives its subject: `boardAutoErased` is in no finding vocabulary", () => {
    expect(FINDING_CODES).not.toContain("boardAutoErased" as never);
  });
});
