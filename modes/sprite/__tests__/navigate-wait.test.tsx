/** @jsxImportSource react */
/**
 * A navigation that arrives before the roster does.
 *
 * Four-direction blind trial, 2026-09-27: the agent registered a reference
 * with `add-ref` and pointed the stage at it in its next command; the file
 * event carrying the new `project.json` had not reached the viewer yet, and
 * `navigate-to` answered `Reference "turnaround" is not in this character
 * (has: none)` — the viewer's lag reported as the agent's mistake. The stage
 * now waits for the next roster update, bounded by NAVIGATE_ROSTER_WAIT_MS,
 * before it refuses an address that names something it does not list yet.
 *
 * Mounted for real (happy-dom + react-dom/client), because the behaviour is
 * the ordering of an action, a source update and a timer — nothing a pure
 * function can show.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

import type { SourceEvent } from "../../../core/types/source.js";
import type { ViewerActionResult, ViewerPreviewProps } from "../../../core/types/viewer-contract.js";
import { loadRoster, type Roster } from "../domain.js";

const MINI = readFileSync(join(import.meta.dir, "fixtures", "mini", "project.json"), "utf-8");

/** An image that never loads: nothing here is about pictures. */
class InertImage {
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";
  removeAttribute(): void {}
}

let restore: (() => void) | undefined;

beforeAll(() => {
  const win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent",
    "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install("Image", InertImage);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

/** A roster source the test can move forward, the way a file event does. */
function rosterSource(initial: Roster) {
  let value: Roster | null = initial;
  const listeners = new Set<(event: SourceEvent<Roster>) => void>();
  return {
    current: () => value,
    subscribe(listener: (event: SourceEvent<Roster>) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    write: async () => {},
    destroy() {},
    emit(next: Roster) {
      value = next;
      for (const listener of listeners) listener({ kind: "value", value: next, origin: "external" });
    },
  };
}

const roster = (edit?: (body: any) => void): Roster => {
  const body = JSON.parse(MINI);
  edit?.(body);
  const loaded = loadRoster([{ path: "mini/project.json", content: JSON.stringify(body) }]);
  if (!loaded) throw new Error("fixture did not parse");
  return loaded;
};

/** The roster after `add-ref --id turnaround` landed. */
const withTurnaround = () => roster((body) => {
  body.assets.push({
    id: "ref-turnaround", type: "image", uri: "refs/turnaround.png", name: "Turnaround",
    metadata: { width: 64, height: 64 }, createdAt: 1, status: "ready", tags: ["ref"],
  });
  body.sprite.refs.push({ id: "turnaround", asset: "ref-turnaround", role: "turnaround", label: "Turnaround" });
});

async function mount() {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: SpritePreview } = await import("../viewer/SpritePreview.js");
  const source = rosterSource(roster());
  const results: Array<{ requestId: string; result: ViewerActionResult }> = [];
  const base = {
    sources: { roster: source },
    files: [],
    selection: null,
    onSelect: () => {},
    mode: "view",
    imageVersion: 0,
    theme: "dark",
    locale: "en",
    editing: false,
    onActionResult: (requestId: string, result: ViewerActionResult) => results.push({ requestId, result }),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (over: Record<string, unknown> = {}) =>
    act(async () => {
      root.render(<SpritePreview {...({ ...base, ...over } as unknown as ViewerPreviewProps)} />);
    });
  await render();
  return { act, source, results, render, unmount: () => act(async () => root.unmount()) };
}

const navigate = (requestId: string, address: Record<string, unknown>) => ({
  actionRequest: { requestId, actionId: "navigate-to", params: { address } },
});

describe("navigate-to waits for the roster, bounded", () => {
  test("a reference registered a moment ago is navigated to once the roster lists it", async () => {
    const stage = await mount();
    await stage.render(navigate("r1", { contentSet: "mini", ref: "turnaround" }));
    // Not answered yet: the roster in hand does not list it.
    expect(stage.results).toEqual([]);
    await stage.act(async () => stage.source.emit(withTurnaround()));
    expect(stage.results).toHaveLength(1);
    expect(stage.results[0]).toMatchObject({ requestId: "r1", result: { success: true } });
    await stage.unmount();
  });

  test("an address the roster can list at once is answered at once", async () => {
    const stage = await mount();
    await stage.render(navigate("r2", { contentSet: "mini", motion: "bounce", frame: 1 }));
    expect(stage.results).toHaveLength(1);
    expect(stage.results[0].result.success).toBe(true);
    // Another character is refused at once too: no roster update makes it this one.
    await stage.render(navigate("r3", { contentSet: "other", motion: "bounce" }));
    expect(stage.results).toHaveLength(2);
    expect(stage.results[1].result).toMatchObject({ success: false });
    await stage.unmount();
  });

  test("a name no update brings is refused after the wait, saying it waited", async () => {
    const stage = await mount();
    const started = Date.now();
    await stage.render(navigate("r4", { contentSet: "mini", ref: "nope" }));
    // An unrelated update does not answer it early.
    await stage.act(async () => stage.source.emit(withTurnaround()));
    expect(stage.results).toEqual([]);
    await stage.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(stage.results).toHaveLength(1);
    expect(stage.results[0].result.success).toBe(false);
    expect(stage.results[0].result.message).toMatch(/Reference "nope" is not in this character \(has: portrait, turnaround\)\. \(waited 2 s for the viewer to load the latest project\.json\)/);
    await stage.unmount();
  });

  test("a newer navigation answers the one still waiting", async () => {
    const stage = await mount();
    await stage.render(navigate("r5", { contentSet: "mini", ref: "later" }));
    await stage.render(navigate("r6", { contentSet: "mini", motion: "bounce" }));
    expect(stage.results.map((r) => [r.requestId, r.result.success])).toEqual([["r5", false], ["r6", true]]);
    await stage.unmount();
  });
});
