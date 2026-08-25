/**
 * The viewer-state persistence subscriber vs the hosted static player.
 *
 * The store debounce-POSTs `/api/viewer-state` whenever the active content
 * set / file changes. In a live session that persists the user's place; in
 * the hosted player there is no backend — the POST could only 404 against
 * the static host, once per content-set switch. The subscriber must skip the
 * POST exactly when `staticPlayer` is set, and keep it otherwise (the live
 * path must not change).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useStore } from "../store/index.js";

const DEBOUNCE_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("viewer-state persistence and the static player", () => {
  const realFetch = globalThis.fetch;
  let calls: { url: string; method: string | undefined }[] = [];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    useStore.getState().setStaticPlayer(false);
  });

  test("live session: a content-set change still POSTs /api/viewer-state", async () => {
    useStore.getState().setStaticPlayer(false);
    useStore.getState().setActiveContentSet("live-set-a");
    await wait(DEBOUNCE_MS + 150);
    const posts = calls.filter(
      (c) => c.url.includes("/api/viewer-state") && c.method === "POST",
    );
    expect(posts.length).toBe(1);
  });

  test("static player: the same change makes no viewer-state request", async () => {
    useStore.getState().setStaticPlayer(true);
    useStore.getState().setActiveContentSet("static-set-b");
    await wait(DEBOUNCE_MS + 150);
    const posts = calls.filter((c) => c.url.includes("/api/viewer-state"));
    expect(posts.length).toBe(0);
  });
});
