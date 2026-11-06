/**
 * The manifest's `pack` source end to end, on an in-memory FileChannel: a
 * viewer edit reaches disk as a pack.json write only (never project.json,
 * never a delete), and a script landing a take in project.json reaches the
 * viewer as an external update with the new status.
 */

import { describe, expect, test } from "bun:test";

import { AggregateFileSource } from "../../../core/sources/aggregate-file.js";
import type { FileChangeEvent, FileChannel, SourceEvent } from "../../../core/types/source.js";
import type { ViewerFileContent } from "../../../core/types/viewer-contract.js";
import { landAsset } from "../../_shared/scripts/craft-project.mjs";
import { findSticker, pickTake, type StickerPack } from "../domain.js";
import manifest from "../manifest.js";
import { richWorkspace } from "./pack-workspace.js";

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

function open() {
  const spec = manifest.sources!.pack;
  if (spec.kind !== "aggregate-file") throw new Error("pack must be an aggregate-file source");
  const ws = richWorkspace();
  const channel = new MemoryChannel(ws.files.map((f) => ({ ...f })));
  const source = new AggregateFileSource<StickerPack>(spec.config as never, channel);
  const events: SourceEvent<StickerPack>[] = [];
  source.subscribe((e) => events.push(e));
  return { ws, channel, source, events };
}

const values = (events: SourceEvent<StickerPack>[]) => events.flatMap((e) => (e.kind === "value" ? [{ origin: e.origin, value: e.value }] : []));

describe("the pack source", () => {
  test("loads once, then a pick writes pack.json and nothing else", async () => {
    const { channel, source, events } = open();
    await Promise.resolve();
    const first = values(events);
    expect(first.map((v) => v.origin)).toEqual(["initial"]);
    await source.write(pickTake(first[0].value, "s02", "s02-take-2"));
    expect(channel.writes.map((w) => w.path)).toEqual(["pack.json"]);
    expect(channel.deletes).toEqual([]);
    const self = values(events).at(-1)!;
    expect(self.origin).toBe("self");
    expect(findSticker(self.value, "s02")!.state.status).toBe("ready");
    source.destroy();
  });

  test("a take landing in project.json reaches the viewer as an external update", async () => {
    const { ws, channel, source, events } = open();
    await Promise.resolve();
    expect(findSticker(values(events)[0].value, "s04")!.state.status).toBe("generating");
    // What sticker.mjs gen records when the GIF lands.
    landAsset(ws.doc, { id: "s04-take-1", uri: "stickers/s04/take-1.gif", metadata: { width: 512, height: 512 } }, Date.now());
    channel.push([{ path: "project.json", content: JSON.stringify(ws.doc), origin: "external" }]);
    const last = values(events).at(-1)!;
    expect(last.origin).toBe("external");
    expect(findSticker(last.value, "s04")!.state.status).toBe("pick");
    expect(channel.writes).toEqual([]);
    source.destroy();
  });
});
