/** @jsxImportSource react */
/**
 * `navigate-to { tab }` opens a panel tab for the motion it puts on stage.
 *
 * Until 0.5.1 the agent could move the stage but not the panel, so it never
 * saw the Export tab it handed the user: the skill told it to read `show`
 * instead. The tab is now part of the navigation, answered with the tab the
 * panel really shows, and refused — by name, with the tabs the motion has —
 * when the motion has no such tab.
 *
 * Mounted for real (happy-dom + react-dom/client), the way
 * `navigate-wait.test.tsx` is: the behaviour is the handler, the roster wait
 * and the panel's DOM agreeing, which no pure function can show.
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

/** `bounce` plus a second motion that is still being planned — no Export tab yet. */
const withPlanned = () => roster((body) => {
  const bounce = body.sprite.motions[0];
  body.sprite.motions.push({
    ...bounce,
    id: "hop",
    label: "Hop",
    status: "planned",
    frames: [],
    gif: undefined,
    webp: undefined,
    sheet: undefined,
    atlas: undefined,
    inspect: undefined,
  });
});

async function mount(initial: Roster = roster()) {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: SpritePreview } = await import("../viewer/SpritePreview.js");
  const source = rosterSource(initial);
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
  /** The tab the panel renders, off the DOM — not off the action's answer. */
  const panelTab = () => host.querySelector("[data-sprite-panel]")?.getAttribute("data-sprite-panel") ?? null;
  const last = () => results[results.length - 1];
  return {
    act, source, results, render, panelTab, last, host,
    unmount: () => act(async () => { root.unmount(); host.remove(); }),
  };
}

const action = (requestId: string, actionId: string, params: Record<string, unknown>) => ({
  actionRequest: { requestId, actionId, params },
});

describe("navigate-to opens a panel tab", () => {
  test("Export opens for a ready motion, and the answer names the tab the panel shows", async () => {
    const stage = await mount();
    // The panel starts on the motion's own artefact.
    expect(stage.panelTab()).toBe("gif");
    await stage.render(action("t1", "navigate-to", { address: { contentSet: "mini", motion: "bounce" }, tab: "export" }));
    expect(stage.last().result).toMatchObject({ success: true, data: { motion: "bounce", tab: "export" } });
    expect(stage.panelTab()).toBe("export");
    // The strip agrees: the Export button is the selected one.
    const selected = [...stage.host.querySelectorAll("[data-sprite-panel] button")]
      .find((b) => (b.getAttribute("class") ?? "").includes("bg-cc-primary/15"));
    expect(selected?.textContent).toContain("Export");
    // get-playback-state reads the same tab back.
    await stage.render(action("t2", "get-playback-state", {}));
    expect(stage.last().result.data?.tab).toBe("export");
    await stage.unmount();
  });

  test("any tab the motion has can be opened, and a plain navigation keeps it while it has content", async () => {
    const stage = await mount();
    await stage.render(action("t3", "navigate-to", { address: { contentSet: "mini", motion: "bounce" }, tab: "atlas" }));
    expect(stage.last().result).toMatchObject({ success: true, data: { tab: "atlas" } });
    expect(stage.panelTab()).toBe("atlas");
    // Without `tab`, the old rule: the atlas has content, so Atlas stays.
    await stage.render(action("t4", "navigate-to", { address: { contentSet: "mini", motion: "bounce", frame: 1 } }));
    expect(stage.last().result).toMatchObject({ success: true, data: { tab: "atlas", frame: 1 } });
    expect(stage.panelTab()).toBe("atlas");
    await stage.unmount();
  });

  test("a tab name the panel does not have is refused before anything moves", async () => {
    const stage = await mount(withPlanned());
    await stage.render(action("t5", "navigate-to", { address: { contentSet: "mini", motion: "hop" }, tab: "exports" }));
    const { result } = stage.last();
    expect(result.success).toBe(false);
    expect(result.message).toBe('"tab" must be one of gif, loop, video, atlas, export (got "exports").');
    // The stage stayed on the motion it was showing.
    expect(result.data).toMatchObject({ motion: "bounce", tab: "gif" });
    expect(stage.panelTab()).toBe("gif");
    await stage.unmount();
  });

  test("a tab the motion does not have is refused by name; the stage still moves and says so", async () => {
    const stage = await mount(withPlanned());
    await stage.render(action("t6", "navigate-to", { address: { contentSet: "mini", motion: "hop" }, tab: "export" }));
    const { result } = stage.last();
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      'The stage moved, but the panel did not: "hop" has no export tab (it has: gif, video, atlas). Export appears once the motion is ready (it is planned).',
    );
    expect(result.data).toMatchObject({ motion: "hop", tab: "gif" });
    expect(stage.panelTab()).toBe("gif");
    await stage.unmount();
  });

  test("a motion registered a moment ago opens on its tab once the roster lists it", async () => {
    const stage = await mount();
    const added = roster((body) => {
      body.sprite.motions.push({ ...body.sprite.motions[0], id: "wave", label: "Wave" });
    });
    await stage.render(action("t7", "navigate-to", { address: { contentSet: "mini", motion: "wave" }, tab: "export" }));
    // Not answered yet: the roster in hand does not list `wave`.
    expect(stage.results.find((r) => r.requestId === "t7")).toBeUndefined();
    await stage.act(async () => stage.source.emit(added));
    expect(stage.last()).toMatchObject({ requestId: "t7", result: { success: true, data: { motion: "wave", tab: "export" } } });
    expect(stage.panelTab()).toBe("export");
    await stage.unmount();
  });
});
