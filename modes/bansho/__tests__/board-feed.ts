/**
 * Shared board-feed harness — the simulated chokidar→WS pipeline: an
 * in-memory `FileChannel` under the REAL production source config (the
 * bansho manifest's `aggregate-file` loadBoard). Consumed by `e2e.test.ts`
 * (T11 [1] streaming R1–R8) and `stage-e2e.test.ts` (C1–C3 stage layer).
 *
 * Not a `*.test.ts` file on purpose (Bun would collect it): a fixture
 * module, precedent `vocabulary.ts`, `incremental-host.ts` and
 * `determinism-probe.ts`. Lifted out of e2e.test.ts when the stage suite
 * arrived — the alternative was a near-verbatim private copy, the exact
 * drift class the incremental-host header documents (its two copies
 * diverged until one was blind to graph containers with every assertion
 * green). One copy, both suites.
 */

import { expect } from "bun:test";

import {
  AggregateFileSource,
  type AggregateFileConfig,
} from "../../../core/sources/aggregate-file.js";
import type {
  FileChangeEvent,
  FileChannel,
} from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";

import banshoManifest from "../manifest.js";
import type { Board } from "../domain.js";
import type { Lecture } from "../engine/types.js";

/**
 * In-memory FileChannel: what the browser runtime's chokidar→WS bridge is
 * to the real system. `emit()` commits contents to the snapshot FIRST and
 * then fires handlers — the same ordering the real channel guarantees
 * (AggregateFileSource re-reads `snapshot()`, not the batch).
 */
export class FakeChannel implements FileChannel {
  private files = new Map<string, string>();
  private handlers = new Set<(batch: FileChangeEvent[]) => void>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, content);
    }
  }

  snapshot(): ReadonlyArray<ViewerFileContent> {
    return [...this.files].map(([path, content]) => ({ path, content }));
  }

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  /** Simulate one chokidar batch arriving over the wire. */
  emit(batch: FileChangeEvent[]): void {
    for (const ev of batch) this.files.set(ev.path, ev.content);
    for (const handler of [...this.handlers]) handler(batch);
  }
}

/** The REAL production load config, straight off the manifest. */
export const boardConfig = banshoManifest.sources!.board!
  .config as AggregateFileConfig<Board>;

export interface BoardFeed {
  channel: FakeChannel;
  source: AggregateFileSource<Board>;
  /** Every value event delivered, in order. */
  values: Array<{ board: Board; origin: "initial" | "self" | "external" }>;
  errors: Array<{ code: string; message: string }>;
}

/** Mount the real aggregate-file source on a fake channel and record. */
export async function openFeed(
  initial: Record<string, string>,
): Promise<BoardFeed> {
  const channel = new FakeChannel(initial);
  const source = new AggregateFileSource<Board>(boardConfig, channel);
  const feed: BoardFeed = { channel, source, values: [], errors: [] };
  source.subscribe((event) => {
    if (event.kind === "value") {
      feed.values.push({ board: event.value, origin: event.origin });
    } else {
      feed.errors.push({ code: event.code, message: event.message });
    }
  });
  await settle(); // initial load is queued as a microtask
  return feed;
}

/** Let the source's queued work drain. */
export const settle = () => new Promise<void>((r) => setTimeout(r, 0));

export const lastLecture = (feed: BoardFeed, set = ""): Lecture => {
  const board = feed.values[feed.values.length - 1]?.board;
  expect(board).toBeDefined();
  const lecture = board!.byContentSet[set];
  expect(lecture).toBeDefined();
  return lecture!;
};

export const lastNarration = (feed: BoardFeed, set = "") => {
  const board = feed.values[feed.values.length - 1]?.board;
  expect(board).toBeDefined();
  const read = board!.narration[set];
  expect(read).toBeDefined();
  return read!;
};
