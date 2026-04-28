import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHandoffWatcher } from "../handoff-watcher.js";

let dir: string;
let handoffsDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pneuma-handoff-"));
  handoffsDir = join(dir, ".pneuma", "handoffs");
  await mkdir(handoffsDir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeHandoff(content: { id: string; target: string; intent: string }): string {
  return `---\nhandoff_id: ${content.id}\ntarget_mode: ${content.target}\nsource_session: src\nsource_mode: doc\nintent: ${content.intent}\ncreated_at: 2026-04-27T00:00:00Z\n---\n\n# Handoff\n\nbody here.\n`;
}

describe("startHandoffWatcher", () => {
  test("emits 'created' event when a new handoff file appears", async () => {
    const events: { type: string; id: string; target_mode: string }[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push({ type: e.type, id: e.handoff.frontmatter.handoff_id, target_mode: e.handoff.frontmatter.target_mode }),
    });

    await writeFile(join(handoffsDir, "h1.md"), makeHandoff({ id: "h1", target: "webcraft", intent: "build site" }));

    await new Promise((r) => setTimeout(r, 400));

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ type: "created", id: "h1", target_mode: "webcraft" });

    await stop();
  });

  test("emits 'deleted' event when handoff file is removed", async () => {
    const file = join(handoffsDir, "h2.md");
    await writeFile(file, makeHandoff({ id: "h2", target: "webcraft", intent: "x" }));

    const events: { type: string; id: string }[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push({ type: e.type, id: e.handoff.frontmatter.handoff_id }),
    });

    await new Promise((r) => setTimeout(r, 400));
    events.length = 0;

    await unlink(file);
    await new Promise((r) => setTimeout(r, 400));

    expect(events).toEqual([{ type: "deleted", id: "h2" }]);
    await stop();
  });

  test("ignores non-md files", async () => {
    const events: unknown[] = [];
    const stop = await startHandoffWatcher({
      projectRoot: dir,
      onEvent: (e) => events.push(e),
    });

    await writeFile(join(handoffsDir, "notes.txt"), "hello");
    await new Promise((r) => setTimeout(r, 400));

    expect(events.length).toBe(0);
    await stop();
  });
});
