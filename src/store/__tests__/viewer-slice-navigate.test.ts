/**
 * The locator channel's return path.
 *
 * A card click dispatches a navigation and gets a `seq` back; the viewer's
 * verdict comes home under that same seq, so a group of cards can tell its
 * own failure from someone else's. The rules that matter — and that a
 * careless edit would break — are all about WHEN the seq moves: a viewer
 * saying "done" is not a new question, and neither is the 50 ms wait a
 * content-set switch needs.
 */

import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import { createViewerSlice, type ViewerSlice } from "../viewer-slice.js";

/** The two neighbours `setNavigateRequest` reads out of the wider store. */
interface Host {
  activeContentSet: string | null;
  contentSets: { prefix: string }[];
  setActiveContentSet: (prefix: string) => void;
}

function makeStore(host: Partial<Host> = {}) {
  const store = create<ViewerSlice & Host>()((...a) => ({
    activeContentSet: "tech-zh",
    contentSets: [{ prefix: "tech-zh" }, { prefix: "pitch-zh" }],
    setActiveContentSet: (prefix: string) => store.setState({ activeContentSet: prefix }),
    ...host,
    ...(createViewerSlice as unknown as (...args: typeof a) => ViewerSlice)(...a),
  }));
  return store;
}

const card = (address: Record<string, unknown>) => ({ label: "the close", address });

describe("navigate seq — whose verdict is this", () => {
  test("a dispatch bumps the seq and hands the address to the viewer", () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(card({ section: 1, step: 3 }));
    expect(seq).toBe(1);
    expect(store.getState().navigateSeq).toBe(1);
    expect(store.getState().navigateRequest?.address).toEqual({ section: 1, step: 3 });
  });

  test("the viewer's failure comes home under the seq the click was given", () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(card({ section: 99 }));
    store.getState().resolveNavigate({ success: false, message: "no such step" });
    expect(store.getState().navigateOutcome).toEqual({
      seq,
      ok: false,
      message: "no such step",
    });
    expect(store.getState().navigateRequest).toBeNull();
  });

  test("a clean arrival leaves no verdict to render", () => {
    const store = makeStore();
    store.getState().setNavigateRequest(card({ section: 1 }));
    store.getState().resolveNavigate({ success: true, message: "Showing section 1" });
    expect(store.getState().navigateOutcome).toBeNull();
  });

  test("a viewer that answers nothing reads as success, not as failure", () => {
    // Eleven viewers predate this seam and call `onNavigateComplete()` bare.
    const store = makeStore();
    store.getState().setNavigateRequest(card({ section: 1 }));
    store.getState().resolveNavigate();
    expect(store.getState().navigateOutcome).toBeNull();
  });

  test("clearing the request does NOT bump the seq or erase a verdict", () => {
    // The clear is the viewer saying "done". If it moved the seq, the card
    // holding seq 1 would never recognise its own failure.
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(card({ section: 99 }));
    store.getState().resolveNavigate({ success: false, message: "no such step" });
    store.getState().setNavigateRequest(null);
    expect(store.getState().navigateSeq).toBe(seq);
    expect(store.getState().navigateOutcome?.seq).toBe(seq);
  });

  test("a new dispatch clears the previous verdict", () => {
    const store = makeStore();
    store.getState().setNavigateRequest(card({ section: 99 }));
    store.getState().resolveNavigate({ success: false, message: "no such step" });
    const second = store.getState().setNavigateRequest(card({ section: 1 }));
    expect(second).toBe(2);
    expect(store.getState().navigateOutcome).toBeNull();
  });
});

describe("navigate refusals the shell itself makes", () => {
  test("an unknown board is refused with a code, and nothing is dispatched", () => {
    const store = makeStore();
    const seq = store.getState().setNavigateRequest(
      card({ contentSet: "pitch-en", section: 2, step: 1 }),
    );
    expect(store.getState().navigateOutcome).toEqual({
      seq,
      ok: false,
      code: "unknownContentSet",
      contentSet: "pitch-en",
    });
    // The open board must not have moved — the whole bug was that it did.
    expect(store.getState().navigateRequest).toBeNull();
    expect(store.getState().activeContentSet).toBe("tech-zh");
  });

  test("a known board switches, and the rest arrives after the switch", async () => {
    const store = makeStore();
    store.getState().setNavigateRequest(card({ contentSet: "pitch-zh", section: 2 }));
    expect(store.getState().activeContentSet).toBe("pitch-zh");
    // The viewer must mount the new set before an address inside it means
    // anything — so the hand-over is deferred, under the SAME seq.
    expect(store.getState().navigateRequest).toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(store.getState().navigateRequest?.address).toEqual({ section: 2 });
    expect(store.getState().navigateSeq).toBe(1);
  });

  test("the store mints no user-facing sentence of its own", () => {
    // `message` is the viewer's, shown verbatim; the shell's own refusal
    // travels as a code the UI translates. A string here would be English
    // in a Japanese session.
    const store = makeStore();
    store.getState().setNavigateRequest(card({ contentSet: "nope", section: 1 }));
    expect(store.getState().navigateOutcome?.message).toBeUndefined();
  });
});
