/**
 * Where the board is right now — published by the mounted viewer, read by
 * `pneuma-mode.ts::extractContext`.
 *
 * `extractContext(selection, files)` is a pure function of the workspace by
 * contract, but half of what the agent needs to understand "this bit" is
 * not in the files at all: the playhead, whether the user is on the live
 * board, and which steps have been written yet. Those live in the running
 * player. The draw mode has the same shape for `captureViewport`
 * (`setDrawCaptureViewport`) — the viewer publishes a handle into its own
 * mode module after mount and retracts it on unmount.
 *
 * A READER, not a snapshot: the playhead moves ~60 times a second and
 * publishing it would put a write on the frame path for something read
 * once per user message. The viewer registers a closure over its own refs;
 * the cost is paid only when the agent is actually asked something.
 *
 * One board is mounted at a time (the shell mounts one PreviewComponent),
 * so a single slot is the whole story. An unmounted viewer reads `null`,
 * which is a real answer — "there is no board running" — not a failure.
 */

import type { BoardMoment } from "./context.js";

export type BoardMomentReader = () => BoardMoment | null;

let reader: BoardMomentReader | null = null;

/** The mounted viewer publishes its reader; unmount passes `null`. */
export function setBoardMomentReader(next: BoardMomentReader | null): void {
  reader = next;
}

/**
 * Where the board is, or `null` when no board is mounted. A reader that
 * throws (mid-unmount teardown, a torn ref) reads as "no board running" —
 * a message must never fail to send because the player was between states
 * — but it is logged, never swallowed: a reader that throws every time
 * would otherwise silently strip the playhead from every context block.
 */
export function readBoardMoment(): BoardMoment | null {
  if (!reader) return null;
  try {
    return reader();
  } catch (err) {
    console.warn("[bansho] could not read the board's position:", err);
    return null;
  }
}
