/** @jsxImportSource react */
import { afterAll, beforeAll, expect, it } from "bun:test";
import { Window } from "happy-dom";
import type { ViewerPreviewProps, ViewerNotification, ViewerSelectionContext } from "../../../core/types/viewer-contract.js";
import { MemorySource } from "../../../core/sources/memory.js";
import { loadStudio } from "../domain.js";
import { emptyProject, type BrandProject } from "../skill/scripts/model.js";
import manifest from "../manifest.js";

let win: Window;
let restore: () => void;
beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "getComputedStyle"]) {
    saved[key] = g[key]; g[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete g[key]; else g[key] = value; } };
});
afterAll(() => restore());

function project(title: string): BrandProject {
  const p = emptyProject(); p.title = title;
  p.contexts = [{ id: "unused", title: "Unused context", purpose: "A future application", guidance: "No examples yet" }];
  p.items = [
    { id: "identity", title: "Identity", stage: "identity", kind: "image", status: "ready", file: "identity.svg", description: "Identity system", contexts: [], referenceIds: [], regions: [], width: 390, height: 844 },
    { id: "example", title: "Application", stage: "applications", kind: "image", status: "ready", file: "example.svg", description: "A use example", contexts: [], referenceIds: ["identity"], regions: [], width: 390, height: 844 },
  ]; return p;
}

it("keeps selection, commands and comparison aligned when projects and context filters change", async () => {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Preview } = await import("../viewer/BrandPreview.js");
  const { useStore } = await import("../../../src/store.js");
  const old = useStore.getState();
  const source = new MemorySource({ initial: loadStudio(["a", "b"].map((path) => ({ path: `${path}/brand.json`, content: JSON.stringify(project(path)) }))) });
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  const notifications: ViewerNotification[] = [];
  const selections: Array<ViewerSelectionContext | null> = [];
  const outcomes: boolean[] = [];
  const props: ViewerPreviewProps = {
    sources: { studio: source }, fileChannel: {} as ViewerPreviewProps["fileChannel"],
    selection: null, onSelect: (s) => selections.push(s), mode: "view", imageVersion: 0,
    editing: true, readonly: false, theme: "dark", locale: "en", commands: manifest.viewerApi!.commands,
    onNotifyAgent: (n) => notifications.push(n), onActionResult: (_id, r) => outcomes.push(r.success),
  };
  const click = async (text: string) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);
    expect(button).toBeDefined(); await act(async () => (button as HTMLButtonElement).click());
  };
  try {
    await act(async () => { useStore.setState({ activeContentSet: "a", staticPlayer: false }); root.render(createElement(Preview, props)); });
    await click("Inspect Application");
    expect(selections.at(-1)?.address?.contentSet).toBe("a");
    await act(async () => useStore.setState({ activeContentSet: "b" }));
    await click("Review consistency");
    expect(notifications.at(-1)?.message).toContain('"contentSet":"b"');
    expect(notifications.at(-1)?.message).not.toContain('"item"');
    await click("Inspect Application");
    await click("Unused context");
    expect(selections.at(-1)).toBeNull();
    expect(host.textContent).toContain("No work in this view yet");
    await act(async () => root.render(createElement(Preview, { ...props, actionRequest: { requestId: "compare-a", actionId: "compare", params: { address: { contentSet: "a", item: "example" } } } })));
    expect(host.querySelector(".is-comparing")).not.toBeNull();
    await act(async () => { host.querySelectorAll(".brand-media img").forEach((img) => img.dispatchEvent(new win.Event("load") as unknown as Event)); });
    expect(outcomes).toEqual([true]);
    await act(async () => root.render(createElement(Preview, { ...props, editing: false, readonly: true })));
    expect(host.querySelector(".brand-command-bar")).toBeNull();
    await act(async () => {
      await source.write(loadStudio([{ path: "a/brand.json", content: JSON.stringify(project("a")) }, { path: "b/brand.json", content: "{" }]));
      useStore.setState({ staticPlayer: true, activeContentSet: "b" });
    });
    expect(host.textContent).toContain("Brand project needs attention");
    expect(host.querySelector(".brand-projects")).not.toBeNull();
    await click("a");
    expect(host.textContent).not.toContain("Brand project needs attention");
    expect(host.textContent).toContain("Identity system");
  } finally {
    await act(async () => root.unmount()); host.remove(); source.destroy(); useStore.setState(old, true);
  }
});
