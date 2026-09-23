/**
 * The webcraft workspace items name every HTML page of a site, declared ones
 * first. The store drops an active file that is not an item on every file
 * update, so while only declared pages were items, saving an edit on a nested
 * undeclared page the preview had followed a link to (`undeclared/deep.html`)
 * reset `activeFile` to null (round-3 review, 2026-09-23).
 */

import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import webcraftMode from "../pneuma-mode.js";
import { createWorkspaceSlice, type WorkspaceSlice } from "../../../src/store/workspace-slice.js";
import { createViewerSlice, type ViewerSlice } from "../../../src/store/viewer-slice.js";

const workspace = webcraftMode.viewer.workspace!;

const SITE = [
  { path: "probe/manifest.json", content: JSON.stringify({ title: "Probe", pages: [{ file: "index.html", title: "Home" }, { file: "sub/page.html" }] }) },
  { path: "probe/index.html", content: "<h1>Home</h1>" },
  { path: "probe/sub/page.html", content: "<h1>Nested</h1>" },
  { path: "probe/undeclared/deep.html", content: "<p>Original</p>" },
  { path: "probe/styles.css", content: "h1{}" },
];

describe("webcraft workspace items", () => {
  test("declared pages first, in manifest order, then the site's other HTML pages", () => {
    const stripped = SITE.map((f) => ({ ...f, path: f.path.replace(/^probe\//, "") }));
    const items = workspace.resolveItems!(stripped);
    expect(items.map((i) => i.path)).toEqual(["index.html", "sub/page.html", "undeclared/deep.html"]);
    expect(items[2].metadata).toEqual({ declared: false });
  });

  test("saving a nested undeclared page keeps it the active file", () => {
    type S = WorkspaceSlice & ViewerSlice;
    const useStore = create<S>()((...a) => ({
      ...(createViewerSlice as unknown as (...args: typeof a) => ViewerSlice)(...a),
      ...(createWorkspaceSlice as unknown as (...args: typeof a) => WorkspaceSlice)(...a),
      modeViewer: { workspace },
    }) as S);
    const s = useStore.getState();
    s.setFiles(SITE);
    useStore.getState().setActiveContentSet("probe");
    useStore.getState().setActiveFile("undeclared/deep.html");
    useStore.getState().updateFiles([{ path: "probe/undeclared/deep.html", content: "<p>UNDECLARED SAVED</p>", origin: "self" }]);
    expect(useStore.getState().activeFile).toBe("undeclared/deep.html");
  });
});
