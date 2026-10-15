/** Tab-local position persistence must never write Session-global viewer state. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { useStore } from "../store/index.js";
import { viewerStateStorageKey } from "../utils/viewer-state.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("viewer-state persistence and the static player", () => {
  const realFetch = globalThis.fetch;
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  let win: Window;
  let calls: string[];
  beforeEach(() => {
    win = new Window({ url: "http://localhost/?session=private-session&mode=webcraft" });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: win.sessionStorage });
    Object.defineProperty(globalThis, "location", { configurable: true, value: win.location });
    calls = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedStorage) Object.defineProperty(globalThis, "sessionStorage", savedStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
    if (savedLocation) Object.defineProperty(globalThis, "location", savedLocation);
    else Reflect.deleteProperty(globalThis, "location");
    useStore.getState().setStaticPlayer(false);
  });

  test("live Session persists its position in this tab without a shared HTTP write", async () => {
    useStore.getState().setStaticPlayer(false);
    useStore.getState().setActiveContentSet("live-set-a");
    await wait(600);
    const key = viewerStateStorageKey("", win.location.href);
    expect(JSON.parse(win.sessionStorage.getItem(key)!)).toEqual({ contentSet: "live-set-a", file: null });
    expect(calls.filter((url) => url.includes("/api/viewer-state"))).toEqual([]);
  });

  test("static player skips position persistence", async () => {
    useStore.getState().setStaticPlayer(true);
    useStore.getState().setActiveContentSet("static-set-b");
    await wait(600);
    expect(win.sessionStorage.length).toBe(0);
    expect(calls.filter((url) => url.includes("/api/viewer-state"))).toEqual([]);
  });
});
