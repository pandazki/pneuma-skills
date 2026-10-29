/**
 * The manifest's `series` source end to end, on an in-memory FileChannel:
 * the viewer's direct edits reach disk as bible.json / episode.json writes
 * only (never project.json, never a delete), and a script landing new work
 * in project.json reaches the viewer as an external update.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { AggregateFileSource } from "../../../core/sources/aggregate-file.js";
import { reserveAsset } from "../../_shared/scripts/craft-project.mjs";
import type { FileChangeEvent, FileChannel, SourceEvent } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { findEpisode, pickStoryboard, setEntityField, type Series } from "../domain.js";
import manifest from "../manifest.js";
import { buildSeriesWorkspace, cleanupWorkspaces, readSeriesFiles } from "./series-workspace.js";

class MemoryChannel implements FileChannel {
  handlers = new Set<(batch: FileChangeEvent[]) => void>();
  writes: Array<{ path: string; content: string }> = [];
  deletes: string[] = [];
  constructor(public files: ViewerFileContent[]) {}
  snapshot() {
    return this.files;
  }
  subscribe(h: (batch: FileChangeEvent[]) => void) {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }
  async write(path: string, content: string) {
    this.writes.push({ path, content });
    this.files = [...this.files.filter((f) => f.path !== path), { path, content }];
  }
  async delete(path: string) {
    this.deletes.push(path);
    this.files = this.files.filter((f) => f.path !== path);
  }
  push(batch: FileChangeEvent[]) {
    for (const f of batch) this.files = [...this.files.filter((x) => x.path !== f.path), { path: f.path, content: f.content }];
    for (const h of this.handlers) h(batch);
  }
}

let files: ViewerFileContent[];
beforeAll(() => {
  files = readSeriesFiles(buildSeriesWorkspace());
});
afterAll(cleanupWorkspaces);

function open() {
  const spec = manifest.sources!.series;
  if (spec.kind !== "aggregate-file") throw new Error("series must be an aggregate-file source");
  const channel = new MemoryChannel(files.map((f) => ({ ...f })));
  const source = new AggregateFileSource<Series>(spec.config as never, channel);
  const events: SourceEvent<Series>[] = [];
  source.subscribe((e) => events.push(e));
  return { channel, source, events };
}

const values = (events: SourceEvent<Series>[]) =>
  events.flatMap((e) => (e.kind === "value" ? [{ origin: e.origin, value: e.value }] : []));

describe("the series source", () => {
  test("loads once, then a viewer edit writes only the files it changed", async () => {
    const { channel, source, events } = open();
    await Promise.resolve();
    const first = values(events);
    expect(first.map((v) => v.origin)).toEqual(["initial"]);

    await source.write(pickStoryboard(first[0].value, "ep01", "A", "ep01-a-board-1"));
    expect(channel.writes.map((w) => w.path)).toEqual(["episodes/ep01/episode.json"]);
    expect(channel.deletes).toEqual([]);
    const self = values(events).at(-1)!;
    expect(self.origin).toBe("self");
    expect(findEpisode(self.value, "ep01")!.parts[0].board?.record.asset).toBe("ep01-a-board-1");

    await source.write(setEntityField(self.value, "character", "guang", "personality", "smug"));
    expect(channel.writes.map((w) => w.path)).toEqual(["episodes/ep01/episode.json", "bible.json"]);
    expect(channel.writes.some((w) => w.path === "project.json")).toBe(false);
    source.destroy();
  });

  test("a script's project.json write reaches the viewer as an external update", async () => {
    const { channel, source, events } = open();
    await Promise.resolve();
    // What `series.mjs shoot-board` records before it sends: a reserved
    // asset and its sidecar slot.
    const project = JSON.parse(files.find((f) => f.path === "project.json")!.content);
    reserveAsset(
      project,
      { id: "ep01-a-board-3", type: "image", name: "ep01 A storyboard", op: "generate", uri: "episodes/ep01/boards/a-3.webp", model: "mock", prompt: "grid", provider: "mock" },
      Date.now(),
    );
    const boards = project.series.episodes.ep01.parts.A.boards;
    boards.push({ ...boards[0], asset: "ep01-a-board-3" });
    channel.push([{ path: "project.json", content: JSON.stringify(project), origin: "external" }]);
    const last = values(events).at(-1)!;
    expect(last.origin).toBe("external");
    expect(last.value.projectError).toBeNull();
    expect(last.value.assets["ep01-a-board-3"].status).toBe("pending");
    expect(findEpisode(last.value, "ep01")!.busy).toBe(true);
    expect(channel.writes).toEqual([]);
    source.destroy();
  });
});
