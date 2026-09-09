// src/player/__tests__/content-sw.test.ts
//
// Pins `public/player-content-sw.js` — the hosted player's only file server.
// The worker is a classic (non-module) script registered by the browser, so it
// cannot be imported; it is booted here in a fake ServiceWorkerGlobalScope, the
// same way the wordtaste workflow tests load their scripts.
//
// The case these tests exist for, measured 2026-09-09 against a real sprite play
// package on the built player: a browser TERMINATES an idle service worker after
// ~30 s and restarts it on the next fetch with a fresh module scope. The
// checkout map lived only in that scope, and `controllerchange` does not fire
// for a restart — so every `/content/*` request made late in a session answered
// 404 "Not found in play package" while the page still had the very same
// checkpoint open. Reproduced in the browser: idle frame, attack frame and the
// mp4 all 200 right after reload; the identical idle-frame URL 404 after 95 s of
// no traffic. Modes that paint everything in the load burst (iframe viewers,
// image decks) never noticed; sprite fetches 16 new frame PNGs when the user
// picks another motion and starts an mp4 when they open the Video tab — minutes
// later, with the worker long gone.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SW_SOURCE = readFileSync(
  join(import.meta.dir, "..", "..", "..", "public", "player-content-sw.js"),
  "utf8",
);

const ORIGIN = "https://player.test";
const BASE = "https://packages.test/plays/sprite-smoke";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const MP4_BYTES = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

// `Uint8Array<ArrayBuffer>`, not the bare alias: the default type argument is
// `ArrayBufferLike`, which `BodyInit` (and therefore `new Response(...)`) rejects.
const BLOBS: Record<string, Uint8Array<ArrayBuffer>> = {
  "sha-png": PNG_BYTES,
  "sha-mp4": MP4_BYTES,
};

const CHECKOUT = {
  type: "pneuma-player-checkout",
  baseUrl: BASE,
  files: {
    "lumi/project.json": "sha-png",
    "lumi/motions/idle/frames/00.png": "sha-png",
    "lumi/motions/attack/video-seedance-1.mp4": "sha-mp4",
  },
};

type Listeners = Record<string, Array<(event: any) => void>>;

/** In-memory CacheStorage — the storage a restarted worker reads back. Shared
 *  across boots on purpose: that IS the browser's behaviour. */
function createCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      const bound = store;
      return {
        async put(url: string, response: Response) {
          bound.set(url, response);
        },
        async match(url: string) {
          const hit = bound.get(url);
          return hit ? hit.clone() : undefined;
        },
      };
    },
  };
}

/** Boot one worker lifetime over the given CacheStorage. Calling it twice with
 *  the same storage is exactly an eviction + restart. */
function bootWorker(caches: unknown) {
  const listeners: Listeners = {};
  const scope = {
    addEventListener(type: string, fn: (event: any) => void) {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
    location: { origin: ORIGIN },
  };
  const blobFetch = async (url: string) => {
    const sha = url.split("/blobs/")[1];
    const bytes = BLOBS[sha];
    return bytes
      ? new Response(bytes, { status: 200 })
      : new Response("missing", { status: 404 });
  };
  // The worker is a classic script over `self` / `caches` / `fetch`; there is no
  // export to import. Same loading trick as modes/wordtaste/__tests__.
  new Function("self", "caches", "fetch", SW_SOURCE)(scope, caches, blobFetch);
  return listeners;
}

async function postMessage(listeners: Listeners, data: unknown): Promise<void> {
  const pending: Array<Promise<unknown>> = [];
  for (const fn of listeners.message ?? []) {
    fn({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
  }
  await Promise.all(pending);
}

async function requestContent(
  listeners: Listeners,
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  let responded: Promise<Response> | null = null;
  const event = {
    request: new Request(url, init),
    respondWith(promise: Promise<Response>) {
      responded = promise;
    },
  };
  for (const fn of listeners.fetch ?? []) fn(event);
  return responded ? await responded : null;
}

describe("player content service worker", () => {
  test("serves a package asset from the pushed checkout map", async () => {
    const caches = createCacheStorage();
    const sw = bootWorker(caches);
    await postMessage(sw, CHECKOUT);

    const res = await requestContent(sw, `${ORIGIN}/content/lumi/motions/idle/frames/00.png?v=0`);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("a restarted worker still resolves — the checkout survives the module scope", async () => {
    const caches = createCacheStorage();
    const first = bootWorker(caches);
    await postMessage(first, CHECKOUT);

    // Eviction: everything the first lifetime held in memory is gone, and no
    // new checkout arrives — `controllerchange` does not fire for a restart.
    const restarted = bootWorker(caches);

    const res = await requestContent(
      restarted,
      `${ORIGIN}/content/lumi/motions/idle/frames/00.png?v=0`,
    );
    expect(res?.status).toBe(200);
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("a restarted worker keeps Range support, so a late-opened video plays", async () => {
    const caches = createCacheStorage();
    await postMessage(bootWorker(caches), CHECKOUT);
    const restarted = bootWorker(caches);

    const res = await requestContent(
      restarted,
      `${ORIGIN}/content/lumi/motions/attack/video-seedance-1.mp4?v=0`,
      { headers: { Range: "bytes=8-15" } },
    );
    expect(res?.status).toBe(206);
    expect(res?.headers.get("Content-Range")).toBe("bytes 8-15/32");
    expect(res?.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(MP4_BYTES.slice(8, 16));
  });

  test("a restarted worker resolves content-set-relative paths too", async () => {
    const caches = createCacheStorage();
    const first = bootWorker(caches);
    await postMessage(first, CHECKOUT);
    await postMessage(first, { type: "pneuma-player-content-set", contentSet: "lumi" });

    const restarted = bootWorker(caches);
    const res = await requestContent(restarted, `${ORIGIN}/content/motions/idle/frames/00.png`);
    expect(res?.status).toBe(200);
  });

  test("restoring never invents a file — an absent path still 404s", async () => {
    const caches = createCacheStorage();
    await postMessage(bootWorker(caches), CHECKOUT);
    const restarted = bootWorker(caches);

    const res = await requestContent(restarted, `${ORIGIN}/content/lumi/motions/walk/frames/00.png`);
    expect(res?.status).toBe(404);
  });

  test("a worker with nothing stored answers 404 rather than throwing", async () => {
    const cold = bootWorker(createCacheStorage());
    const res = await requestContent(cold, `${ORIGIN}/content/lumi/project.json`);
    expect(res?.status).toBe(404);
  });

  test("a fresh checkout wins over the restored one", async () => {
    const caches = createCacheStorage();
    await postMessage(bootWorker(caches), CHECKOUT);

    const restarted = bootWorker(caches);
    await postMessage(restarted, {
      type: "pneuma-player-checkout",
      baseUrl: BASE,
      files: { "lumi/motions/idle/frames/00.png": "sha-mp4" },
    });

    const res = await requestContent(restarted, `${ORIGIN}/content/lumi/motions/idle/frames/00.png`);
    expect(res?.status).toBe(200);
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(MP4_BYTES);
  });

  test("cross-origin requests are left alone", async () => {
    const caches = createCacheStorage();
    const sw = bootWorker(caches);
    await postMessage(sw, CHECKOUT);

    const res = await requestContent(sw, "https://elsewhere.test/content/lumi/project.json");
    expect(res).toBeNull();
  });

  test("/api/file resolves against the same checkout map", async () => {
    const caches = createCacheStorage();
    const sw = bootWorker(caches);
    await postMessage(sw, CHECKOUT);

    const res = await requestContent(
      sw,
      `${ORIGIN}/api/file?path=${encodeURIComponent("lumi/project.json")}`,
    );
    expect(res?.status).toBe(200);
  });
});
