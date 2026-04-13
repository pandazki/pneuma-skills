import { describe, test, expect, beforeEach } from "bun:test";
import { AggregateFileSource } from "../aggregate-file.js";
import type {
  FileChannel,
  FileChangeEvent,
  SourceEvent,
} from "../../types/source.js";
import type { ViewerFileContent } from "../../types/viewer-contract.js";

// A tiny toy domain: a "Deck" of slides where each slide is a file
// at `slides/slide-<id>.html` and the deck order lives in `manifest.json`.
interface Slide { id: string; html: string }
interface Deck { order: string[]; slides: Record<string, Slide> }

function loadDeck(files: ReadonlyArray<ViewerFileContent>): Deck | null {
  const manifest = files.find((f) => f.path === "manifest.json");
  if (!manifest) return null;
  const parsed = JSON.parse(manifest.content) as { order: string[] };
  const slides: Record<string, Slide> = {};
  for (const id of parsed.order) {
    const f = files.find((x) => x.path === `slides/slide-${id}.html`);
    if (f) slides[id] = { id, html: f.content };
  }
  return { order: parsed.order, slides };
}

function saveDeck(
  next: Deck,
  current: ReadonlyArray<ViewerFileContent>,
): { writes: Array<{ path: string; content: string }>; deletes: string[] } {
  const writes: Array<{ path: string; content: string }> = [
    { path: "manifest.json", content: JSON.stringify({ order: next.order }) },
  ];
  for (const id of next.order) {
    const slide = next.slides[id];
    if (slide) writes.push({ path: `slides/slide-${id}.html`, content: slide.html });
  }
  // Delete any slide file whose id is no longer in next.order
  const keep = new Set(next.order.map((id) => `slides/slide-${id}.html`));
  const deletes: string[] = [];
  for (const f of current) {
    if (f.path.startsWith("slides/slide-") && f.path.endsWith(".html") && !keep.has(f.path)) {
      deletes.push(f.path);
    }
  }
  return { writes, deletes };
}

class MockFileChannel implements FileChannel {
  public handlers = new Set<(batch: FileChangeEvent[]) => void>();
  public files: ViewerFileContent[] = [];
  public writes: Array<{ path: string; content: string }> = [];
  public deletes: string[] = [];

  snapshot() { return this.files; }
  subscribe(h: (b: FileChangeEvent[]) => void) {
    this.handlers.add(h);
    return () => { this.handlers.delete(h); };
  }
  async write(path: string, content: string) {
    this.writes.push({ path, content });
    const existing = this.files.find((f) => f.path === path);
    if (existing) existing.content = content;
    else this.files.push({ path, content });
  }
  async delete(path: string) {
    this.deletes.push(path);
    this.files = this.files.filter((f) => f.path !== path);
  }
  push(batch: FileChangeEvent[]) { for (const h of this.handlers) h(batch); }
}

describe("AggregateFileSource", () => {
  let ch: MockFileChannel;

  beforeEach(() => {
    ch = new MockFileChannel();
    ch.files = [
      { path: "manifest.json", content: '{"order":["a","b"]}' },
      { path: "slides/slide-a.html", content: "<p>A</p>" },
      { path: "slides/slide-b.html", content: "<p>B</p>" },
    ];
  });

  test("initial load reconstructs the domain aggregate from files", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("initial");
    expect(events[0].value.order).toEqual(["a", "b"]);
    expect(events[0].value.slides.a.html).toBe("<p>A</p>");
  });

  test("external file change re-runs load and emits external", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    await Promise.resolve();
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));

    ch.files = ch.files.map((f) =>
      f.path === "slides/slide-a.html" ? { ...f, content: "<p>A edited by agent</p>" } : f,
    );
    ch.push([{ path: "slides/slide-a.html", content: "<p>A edited by agent</p>", origin: "external" }]);

    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("external");
    expect(events[0].value.slides.a.html).toBe("<p>A edited by agent</p>");
  });

  test("write decomposes the aggregate via save() and produces channel writes + deletes", async () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    await Promise.resolve();

    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));

    // Delete slide "b", add a new slide "c"
    const next: Deck = {
      order: ["a", "c"],
      slides: {
        a: { id: "a", html: "<p>A</p>" },
        c: { id: "c", html: "<p>C (new)</p>" },
      },
    };
    await s.write(next);

    // save() should produce: write manifest.json, write slide-a (unchanged),
    // write slide-c (new), delete slide-b
    const writePaths = ch.writes.map((w) => w.path).sort();
    expect(writePaths).toContain("manifest.json");
    expect(writePaths).toContain("slides/slide-c.html");
    expect(ch.deletes).toEqual(["slides/slide-b.html"]);

    // And a self-origin event fires with the new aggregate
    expect(events).toHaveLength(1);
    if (events[0].kind !== "value") throw new Error("expected value");
    expect(events[0].origin).toBe("self");
    expect(events[0].value.order).toEqual(["a", "c"]);
  });

  test("load failure emits error, source stays live for future events", async () => {
    ch.files = [{ path: "manifest.json", content: "{not json" }];
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    const events: SourceEvent<Deck>[] = [];
    s.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("error");

    // Recover with a valid manifest
    ch.files = [
      { path: "manifest.json", content: '{"order":["a"]}' },
      { path: "slides/slide-a.html", content: "<p>A</p>" },
    ];
    ch.push([
      { path: "manifest.json", content: '{"order":["a"]}', origin: "external" },
    ]);
    // First successful load post-error still fires as "initial"
    const valueEvents = events.filter((e) => e.kind === "value");
    expect(valueEvents).toHaveLength(1);
    if (valueEvents[0].kind !== "value") throw new Error("expected value");
    expect(valueEvents[0].origin).toBe("initial");
  });

  test("destroy unsubscribes from channel", () => {
    const s = new AggregateFileSource<Deck>(
      { patterns: ["manifest.json", "slides/**/*.html"], load: loadDeck, save: saveDeck },
      ch,
    );
    expect(ch.handlers.size).toBe(1);
    s.destroy();
    expect(ch.handlers.size).toBe(0);
  });
});
