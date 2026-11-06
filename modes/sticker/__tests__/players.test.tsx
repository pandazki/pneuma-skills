/** @jsxImportSource react */
/**
 * `useGifFrames` against a stand-in ImageDecoder (happy-dom has none): a
 * bitmap the hook has closed must never be handed to a render. In Chrome,
 * drawing one throws "The image source is detached", which took the whole
 * viewer down when the inspector moved from one sticker to the next.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

interface FakeBitmap {
  url: string;
  closed: boolean;
  close(): void;
}

let restore: () => void;

beforeAll(() => {
  const win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    saved[key] = g[key];
    g[key] = value;
  };
  set("window", win);
  set("document", win.document);
  set("IS_REACT_ACT_ENVIRONMENT", true);
  let current = "";
  set("fetch", async (input: unknown) => {
    current = String(input);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  class FakeDecoder {
    static isTypeSupported = async () => true;
    private readonly url = current;
    completed = Promise.resolve();
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 3 } };
    async decode() {
      return { image: { url: this.url, close() {}, displayWidth: 8, displayHeight: 8 } };
    }
    close() {}
  }
  set("ImageDecoder", FakeDecoder);
  set("createImageBitmap", async (image: { url: string }): Promise<FakeBitmap> => {
    const bitmap: FakeBitmap = {
      url: image.url,
      closed: false,
      close() {
        bitmap.closed = true;
      },
    };
    return bitmap;
  });
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore());

test("switching GIFs never renders the previous GIF's closed bitmaps", async () => {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useGifFrames } = await import("../viewer/players.js");

  const seen: Array<{ url: string | null; status: string; frames: FakeBitmap[] }> = [];
  function Probe({ url }: { url: string | null }) {
    const state = useGifFrames(url);
    seen.push({ url, status: state.status, frames: state.status === "ready" ? (state.frames as unknown as FakeBitmap[]) : [] });
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  const settle = async (url: string | null) => {
    await act(async () => root.render(createElement(Probe, { url })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  };

  await settle("/a.gif");
  const firstA = seen.findLast((s) => s.url === "/a.gif");
  expect(firstA?.status).toBe("ready");
  expect(firstA?.frames.every((b) => b.url === "/a.gif")).toBe(true);
  const aFrames = firstA!.frames;

  seen.length = 0;
  await settle("/b.gif");
  expect(aFrames.every((b) => b.closed)).toBe(true); // released, as promised
  // The first render with /b.gif happens before its effect: loading, not /a.gif's frames.
  expect(seen[0]).toMatchObject({ url: "/b.gif", status: "loading" });
  for (const render of seen) {
    expect(render.frames.some((b) => b.closed)).toBe(false);
    expect(render.frames.every((b) => b.url === render.url)).toBe(true);
  }
  expect(seen.at(-1)?.status).toBe("ready");

  seen.length = 0;
  await settle(null);
  expect(seen.every((s) => s.status === "idle")).toBe(true);
  await act(async () => root.unmount());
});
