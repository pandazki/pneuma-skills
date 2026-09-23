/**
 * `capture` of an addressed object waits for the viewer to say it has
 * arrived (`src/hooks/useCaptureAction.ts::waitForNavigation`) instead of a
 * fixed 1.1 s guess.
 *
 * The guess shot whatever was on screen when it ran out: the page being
 * left, a blank page still loading, or — when the address named nothing the
 * viewer had — a plausible picture of the wrong object. The verdict channel
 * (`onNavigateComplete` → `resolveNavigate`) already existed for locator
 * cards; `navigateDoneSeq` marks when a navigation has ended, including the
 * ones the shell settles without a viewer.
 */

import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import { createViewerSlice, type ViewerSlice } from "../store/viewer-slice.js";
import { waitForNavigation } from "../hooks/useCaptureAction.js";

interface Host {
  activeContentSet: string | null;
  contentSets: { prefix: string }[];
  setActiveContentSet: (prefix: string) => void;
}

function makeStore() {
  const store = create<ViewerSlice & Host>()((...a) => ({
    activeContentSet: "gazette",
    contentSets: [{ prefix: "gazette" }, { prefix: "carbon-park" }],
    setActiveContentSet: (prefix: string) => store.setState({ activeContentSet: prefix }),
    ...(createViewerSlice as unknown as (...args: typeof a) => ViewerSlice)(...a),
  }));
  return store;
}

const go = (address: Record<string, unknown>) => ({ label: "capture", address });

describe("waitForNavigation", () => {
  test("resolves when the viewer reports arrival, not before", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ page: "article.html" }));
    let settled = false;
    const wait = waitForNavigation(seq, 2000, store).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    store.getState().resolveNavigate();
    expect(await wait).toEqual({ status: "arrived" });
  });

  test("carries the viewer's failure", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ page: "nope.html" }));
    const wait = waitForNavigation(seq, 2000, store);
    store.getState().resolveNavigate({ success: false, message: 'This site has no page "nope.html"' });
    expect(await wait).toEqual({ status: "failed", message: 'This site has no page "nope.html"' });
  });

  test("an unknown content set is a failure the shell settles itself", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ contentSet: "missing", page: "index.html" }));
    expect(await waitForNavigation(seq, 2000, store)).toEqual({
      status: "failed",
      message: 'No content set "missing"',
    });
  });

  test("an address already on screen needs no viewer answer", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ contentSet: "gazette" }));
    expect(await waitForNavigation(seq, 2000, store)).toEqual({ status: "arrived" });
  });

  test("a bare content-set switch is settled by the shell", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ contentSet: "carbon-park" }));
    expect(await waitForNavigation(seq, 2000, store)).toEqual({ status: "arrived" });
  });

  test("a viewer that never answers yields a timeout, never a hang", async () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(go({ page: "article.html" }));
    expect(await waitForNavigation(seq, 40, store)).toEqual({ status: "timeout" });
  });

  test("a newer navigation supersedes the wait — its arrival never certifies the earlier target", async () => {
    // Review repro (2026-09-23): capture of target.html was pending when a
    // locator dispatched index.html; index.html's arrival was reported as the
    // capture's, and the capture returned a picture of the wrong page.
    const store = makeStore();
    const first = store.getState().setNavigateRequest(go({ page: "article.html" }));
    const wait = waitForNavigation(first, 2000, store);
    store.getState().setNavigateRequest(go({ page: "index.html" }));
    store.getState().resolveNavigate();
    expect(await wait).toEqual({ status: "superseded" });
  });

  test("a late verdict for the replaced request is ignored and does not end the newer one", async () => {
    const store = makeStore();
    const first = store.getState().setNavigateRequest(go({ page: "article.html" }));
    const second = store.getState().setNavigateRequest(go({ page: "index.html" }));
    const wait = waitForNavigation(second, 2000, store);
    store.getState().resolveNavigate(undefined, first); // the old request's viewer answers late
    expect(store.getState().navigateRequest?.address).toEqual({ page: "index.html" });
    store.getState().resolveNavigate(undefined, second);
    expect(await wait).toEqual({ status: "arrived" });
  });
});
