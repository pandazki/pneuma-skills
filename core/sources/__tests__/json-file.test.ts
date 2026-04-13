import { describe, test, expect, beforeEach } from "bun:test";
import { JsonFileSource } from "../json-file.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

interface Project {
  title: string;
  count?: number;
}

class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public deletes: string[] = [];
  public writeError: Error | null = null;
  public writeDelay = 0;

  snapshot(): ReadonlyArray<ViewerFileContent> {
    return this.files;
  }
  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  async write(path: string, content: string): Promise<void> {
    if (this.writeDelay > 0) await new Promise((r) => setTimeout(r, this.writeDelay));
    if (this.writeError) throw this.writeError;
    this.writes.push({ path, content });
  }
  async delete(path: string): Promise<void> {
    this.deletes.push(path);
  }
  push(batch: FileChangeEvent[]): void {
    for (const h of this.handlers) h(batch);
  }
}

const parse = (raw: string) => JSON.parse(raw) as Project;
const serialize = (v: Project) => JSON.stringify(v);

describe("JsonFileSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
  });

  test("initial snapshot with a parseable file fires initial event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"Hello"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value).toEqual({ title: "Hello" });
  });

  test("missing file on startup emits no initial event, current() is null", async () => {
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(0);
    expect(s.current()).toBeNull();
  });

  test("external update emits external event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.files = [{ path: "project.json", content: '{"title":"B"}' }];
    ch.push([{ path: "project.json", content: '{"title":"B"}', origin: "external" }]);
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value).toEqual({ title: "B" });
  });

  test("write persists via channel and emits self event", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await s.write({ title: "B" });
    expect(ch.writes).toHaveLength(1);
    expect(ch.writes[0]).toEqual({
      path: "project.json",
      content: '{"title":"B"}',
    });
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
    expect(events[0].value).toEqual({ title: "B" });
    expect(s.current()).toEqual({ title: "B" });
  });

  test("write followed by the echo event emits only the self event (not a duplicate external)", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));

    // 1. viewer writes
    await s.write({ title: "B" });
    expect(events).toHaveLength(1);
    expect((events[0] as { origin?: string }).origin).toBe("self");

    // 2. FileChannel delivers the server-tagged echo. Because the server
    // tags it origin: "self" via pendingSelfWrites, JsonFileSource should
    // recognize it as an already-emitted self and drop it rather than
    // re-emit another self event.
    ch.files = [{ path: "project.json", content: '{"title":"B"}' }];
    ch.push([{ path: "project.json", content: '{"title":"B"}', origin: "self" }]);
    expect(events).toHaveLength(1);  // no duplicate
  });

  test("parse failure on initial load emits error event, not value", async () => {
    ch.files = [{ path: "project.json", content: "{not json" }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");
    expect(s.current()).toBeNull();
  });

  test("parse failure is non-fatal — a later valid external update succeeds", async () => {
    ch.files = [{ path: "project.json", content: "{not json" }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();  // drain initial error
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.files = [{ path: "project.json", content: '{"title":"Recovered"}' }];
    ch.push([{ path: "project.json", content: '{"title":"Recovered"}', origin: "external" }]);
    // The source had never successfully observed a value before, so this
    // one is still the "first" — it fires with origin="initial".
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value).toEqual({ title: "Recovered" });
  });

  test("write failure propagates and does not update current()", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    ch.writeError = new Error("disk full");
    await expect(s.write({ title: "B" })).rejects.toThrow("disk full");
    expect(s.current()).toEqual({ title: "A" });
  });

  test("only events for the declared path are processed", async () => {
    ch.files = [{ path: "project.json", content: '{"title":"A"}' }];
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Project>[] = [];
    s.subscribe((e) => events.push(e));
    ch.push([{ path: "other.json", content: '{"title":"X"}', origin: "external" }]);
    expect(events).toHaveLength(0);
  });

  test("destroy unsubscribes from channel", () => {
    const s = new JsonFileSource<Project>(
      { path: "project.json", parse, serialize },
      ch,
    );
    expect(ch.handlers.size).toBe(1);
    s.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
