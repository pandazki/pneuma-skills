import { describe, test, expect, beforeEach } from "bun:test";
import { FileGlobSource } from "../file-glob.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

// In-memory FileChannel for testing — lets the test drive file events
// directly without a real server.
class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public writeError: Error | null = null;

  snapshot(): ReadonlyArray<ViewerFileContent> {
    return this.files;
  }

  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  async write(path: string, content: string): Promise<void> {
    if (this.writeError) throw this.writeError;
    this.writes.push({ path, content });
  }

  public deletes: string[] = [];
  async delete(path: string): Promise<void> {
    this.deletes.push(path);
  }

  // Test hook
  push(batch: FileChangeEvent[]): void {
    for (const h of this.handlers) h(batch);
  }
}

describe("FileGlobSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
  });

  test("on create, reads snapshot and fires initial with matching files", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "b.css", content: "body {}" },
      { path: "c.md", content: "# C" },
    ];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    await Promise.resolve();  // let the initial microtask run
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value.map((f) => f.path).sort()).toEqual(["a.md", "c.md"]);
  });

  test("external file change matching patterns emits external event", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();  // drain initial
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.files = [{ path: "a.md", content: "# A edited" }];
    ch.push([{ path: "a.md", content: "# A edited", origin: "external" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value.find((f) => f.path === "a.md")?.content).toBe("# A edited");
  });

  test("self-origin change emits self event (unchanged origin tag)", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([{ path: "a.md", content: "# Fresh", origin: "self" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
  });

  test("file change not matching patterns does not emit", async () => {
    ch.files = [{ path: "a.md", content: "# A" }];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.push([{ path: "b.css", content: "body {}", origin: "external" }]);
    expect(events).toHaveLength(0);
  });

  test("write() throws — file-glob is read-only via Source.write", async () => {
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await expect(source.write([])).rejects.toThrow(/read-only/i);
  });

  test("batch with a mix of matching and non-matching files emits once with the full current set", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "b.md", content: "# B" },
    ];
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    ch.files = [
      { path: "a.md", content: "# A2" },
      { path: "b.md", content: "# B" },
    ];
    ch.push([
      { path: "a.md", content: "# A2", origin: "external" },
      { path: "x.css", content: "...", origin: "external" },
    ]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    const paths = events[0].value.map((f) => f.path).sort();
    expect(paths).toEqual(["a.md", "b.md"]);
  });

  test("ignore patterns filter out matching files", async () => {
    ch.files = [
      { path: "a.md", content: "# A" },
      { path: "node_modules/x.md", content: "# X" },
    ];
    const source = new FileGlobSource(
      { patterns: ["**/*.md"], ignore: ["**/node_modules/**"] },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<ViewerFileContent[]>[] = [];
    source.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(source.current()?.map((f) => f.path)).toEqual(["a.md"]);
  });

  test("destroy unsubscribes from FileChannel", () => {
    const source = new FileGlobSource({ patterns: ["**/*.md"] }, ch);
    expect(ch.handlers.size).toBe(1);
    source.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
