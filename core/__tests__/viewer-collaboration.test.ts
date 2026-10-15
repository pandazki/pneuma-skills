import { describe, expect, test } from "bun:test";
import { isCollaborationJson, isViewerViewState } from "../types/viewer-collaboration.js";

describe("mode collaboration payload boundary", () => {
  test("supports unrelated mode semantics without transport or layout assumptions", () => {
    expect(isViewerViewState({ address: { page: "about.html", contentSet: "site" }, detail: { scroll: { x: 0, y: 100 }, hash: "#team" } })).toBe(true);
    expect(isViewerViewState({ address: { file: "board.excalidraw" }, detail: { camera: { x: -20, y: 4, zoom: 0.5 } } })).toBe(true);
    expect(isViewerViewState({ address: { step: "intro" }, detail: { playhead: 2.5, playing: false } })).toBe(true);
  });

  test("rejects non-JSON and excessive payloads before relay", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [undefined, () => {}, Symbol("x"), NaN, Infinity, new Date(), new Map(), cycle,
      { value: undefined }, JSON.parse('{"__proto__":{"x":1}}'), { constructor: "bad" }]) {
      expect(isCollaborationJson(value)).toBe(false);
    }
    expect(isCollaborationJson({ text: "x".repeat(32 * 1024) })).toBe(false);
    expect(isCollaborationJson({ text: "文".repeat(12 * 1024) })).toBe(false);
    expect(isCollaborationJson(Array.from({ length: 5000 }, () => 0))).toBe(false);
    let nested: unknown = 0;
    for (let i = 0; i < 20; i++) nested = { nested };
    expect(isCollaborationJson(nested)).toBe(false);
  });

  test("addresses and optional detail must be objects, never missing or arrays", () => {
    for (const value of [null, {}, { address: null }, { address: [] }, { address: {}, detail: [] }, { address: {}, detail: "scroll" }]) {
      expect(isViewerViewState(value)).toBe(false);
    }
    expect(isViewerViewState({ address: { page: "index.html" } })).toBe(true);
    const shared = { x: 1 };
    expect(isCollaborationJson({ a: shared, b: shared })).toBe(true);
  });
});
