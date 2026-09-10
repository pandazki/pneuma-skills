/**
 * fal-queue.mjs::downloadFalFile — the leg that turns a finished job into
 * bytes a caller can write.
 *
 * Every script that uses it injects a stub for it, so without this file
 * nothing pins the helper itself: that a streamed body is reassembled in
 * order, that what gives up on a stalled CDN is an IDLE ceiling rather than
 * a wall clock, that a retried attempt is announced and counted, and that
 * the caller's own abort comes back untouched instead of being retried
 * three times against a signal that is already dead.
 *
 * No network and no real back-off: `fetchImpl` and `sleep` are injected and
 * the idle window is a few tens of milliseconds, so the whole file costs
 * less than the one 60 s ceiling it is pinning.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DOWNLOAD_ATTEMPTS, downloadFalFile } from "../fal-queue.mjs";

const workspace = mkdtempSync(join(tmpdir(), "fal-download-test-"));
const URL_UNDER_TEST = "https://cdn.fal.ai/clip.mp4";

const bytes = (text: string) => new TextEncoder().encode(text);

/** `fetch`'s shape, narrowed to what this helper actually calls it with. */
type FetchStub = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
const asFetch = (stub: FetchStub) => stub as unknown as typeof fetch;

/** A body that emits every chunk and then closes. */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(bytes(chunk));
      controller.close();
    },
  });
}

/**
 * A body that emits one chunk and then stops — what a stalled CDN
 * connection looks like from here. Like a real `fetch`, it errors when the
 * signal it was handed fires; interrupting it is the idle ceiling's job.
 */
function stalledBody(signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes("first frame of a clip"));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  });
}

/** Collects what the helper announced and what it would have waited. */
function recorder() {
  const notes: string[] = [];
  const delays: number[] = [];
  return {
    notes,
    delays,
    onNote: (message: string) => void notes.push(message),
    sleep: async (ms: number) => void delays.push(ms),
  };
}

describe("downloadFalFile", () => {
  test("a streamed body is reassembled in order and survives as a file", async () => {
    const log = recorder();
    let calls = 0;
    const buffer = await downloadFalFile(URL_UNDER_TEST, {
      fetchImpl: asFetch(async (url) => {
        calls++;
        expect(url).toBe(URL_UNDER_TEST);
        return new Response(bodyOf(["head", "-middle", "-tail"]));
      }),
      onNote: log.onNote,
      sleep: log.sleep,
    });

    expect(calls).toBe(1);
    const path = join(workspace, "clip.mp4");
    writeFileSync(path, buffer);
    expect(readFileSync(path, "utf-8")).toBe("head-middle-tail");
    expect(log.notes).toEqual([]);
    expect(log.delays).toEqual([]);
  });

  test("a body that stops moving is given up on by the idle ceiling, then retried", async () => {
    const log = recorder();
    let calls = 0;
    const buffer = await downloadFalFile(URL_UNDER_TEST, {
      idleMs: 60,
      fetchImpl: asFetch(async (_url, init) => {
        calls++;
        return calls === 1 ? new Response(stalledBody(init!.signal!)) : new Response(bodyOf(["a complete clip"]));
      }),
      onNote: log.onNote,
      sleep: log.sleep,
    });

    expect(calls).toBe(2);
    expect(buffer.toString("utf-8")).toBe("a complete clip");
    expect(log.notes).toHaveLength(1);
    expect(log.notes[0]).toContain("no bytes for");
    expect(log.notes[0]).toContain(`attempt 1 of ${DOWNLOAD_ATTEMPTS}`);
    expect(log.delays).toEqual([3000]); // the back-off is announced, never really waited here
  });

  test("three failed attempts throw the last reason, each one announced and counted", async () => {
    const log = recorder();
    let calls = 0;
    await expect(
      downloadFalFile(URL_UNDER_TEST, {
        fetchImpl: asFetch(async () => {
          calls++;
          return new Response("upstream is down", { status: 503 });
        }),
        onNote: log.onNote,
        sleep: log.sleep,
      }),
    ).rejects.toThrow("HTTP 503");

    expect(calls).toBe(DOWNLOAD_ATTEMPTS);
    expect(log.notes.map((note) => note.slice(note.indexOf("attempt")))).toEqual([
      `attempt 1 of ${DOWNLOAD_ATTEMPTS})`,
      `attempt 2 of ${DOWNLOAD_ATTEMPTS})`,
    ]);
    expect(log.delays).toEqual([3000, 6000]);
  });

  test("the caller's own abort is rethrown untouched and never retried", async () => {
    const log = recorder();
    const controller = new AbortController();
    const reason = new DOMException("received SIGINT", "AbortError");
    let calls = 0;
    let caught: unknown = null;

    try {
      await downloadFalFile(URL_UNDER_TEST, {
        signal: controller.signal,
        idleMs: 60,
        fetchImpl: asFetch(async (_url, init) => {
          calls++;
          const body = stalledBody(init!.signal!);
          queueMicrotask(() => controller.abort(reason));
          return new Response(body);
        }),
        onNote: log.onNote,
        sleep: log.sleep,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(reason); // not wrapped, not re-spelled
    expect(calls).toBe(1);
    expect(log.notes).toEqual([]);
    expect(log.delays).toEqual([]);
  });
});
