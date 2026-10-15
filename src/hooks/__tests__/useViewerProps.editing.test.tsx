/** @jsxImportSource react */
/**
 * `useViewerProps` hands the viewer the session's `editing` flag.
 *
 * The protocol says a viewer reads creating vs consuming from
 * `ViewerPreviewProps.editing` (docs/reference/viewer-agent-protocol.md,
 * "Editing 状态"). Only the app layout passed it — `editing={false}` on its
 * viewing branch — so in the editor layout a local `--viewing` session, which
 * starts no agent, rendered every mode viewer with `editing` undefined. Three
 * modes gate their request controls on `editing !== false` (backlot, lucid,
 * sprite), and all three offered to ask an agent that was not there; a press
 * queued a notification for whichever agent started next.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import type { ViewerPreviewProps } from "../../../core/types/viewer-contract.js";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const w = win as unknown as Record<string, unknown>;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"]) {
    saved[key] = g[key];
    g[key] = key === "window" ? win : w[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

describe("useViewerProps", () => {
  let unmount: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await unmount?.();
    unmount = null;
  });

  /** Mount a component that renders nothing but records the props the hook
   *  built — what the editor layout spreads onto the mode's viewer. */
  async function propsWith(state: { editing: boolean; replayMode?: boolean }) {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useStore } = await import("../../store.js");
    const { useViewerProps } = await import("../useViewerProps.js");
    useStore.setState({ editing: state.editing, replayMode: state.replayMode ?? false });
    const seen: ViewerPreviewProps[] = [];
    function Probe() {
      seen.push(useViewerProps({ theme: "dark", locale: "en" }));
      return null;
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Probe));
    });
    unmount = async () => {
      await act(async () => root.unmount());
      host.remove();
    };
    return {
      latest: () => seen[seen.length - 1],
      set: async (editing: boolean) => {
        await act(async () => {
          useStore.setState({ editing });
        });
      },
    };
  }

  test("a viewing-only session reaches the viewer as editing: false", async () => {
    const probe = await propsWith({ editing: false });
    expect(probe.latest().editing).toBe(false);
  });

  test("an editing session reaches it as editing: true", async () => {
    const probe = await propsWith({ editing: true });
    expect(probe.latest().editing).toBe(true);
  });

  test("the flag follows the session when it is switched", async () => {
    const probe = await propsWith({ editing: true });
    await probe.set(false);
    expect(probe.latest().editing).toBe(false);
    await probe.set(true);
    expect(probe.latest().editing).toBe(true);
  });

  test("a replay is still readonly, whatever the editing flag says", async () => {
    const probe = await propsWith({ editing: true, replayMode: true });
    expect(probe.latest().readonly).toBe(true);
  });

  test("native preview resources stay on the browser origin and encode raw filenames and directory paths", async () => {
    const probe = await propsWith({ editing: true });
    expect(probe.latest().resolveResourceUrl!("/site/pages/report#2026?draft%.html")).toBe("/content/site/pages/report%232026%3Fdraft%25.html");
    expect(probe.latest().resolveResourceUrl!("site/image assets/")).toBe("/content/site/image%20assets/");
  });

  test("selection preserves its ViewerAddress through the shell roundtrip", async () => {
    const { act } = await import("react");
    const probe = await propsWith({ editing: true });
    const selection = {
      type: "element" as const,
      content: "Headline",
      file: "index.html",
      address: { contentSet: "website", page: "index.html", selector: "#headline" },
    };
    await act(async () => probe.latest().onSelect(selection));
    expect(probe.latest().selection?.address).toEqual(selection.address);
  });

  test("an old mount's action result cannot clear the replacement mount's request", async () => {
    const { act } = await import("react");
    const { useStore } = await import("../../store.js");
    const probe = await propsWith({ editing: true });
    await act(async () => {
      useStore.getState().setViewerInstance(crypto.randomUUID());
      useStore.getState().setActionRequest({ requestId: "old", actionId: "navigate" });
    });
    const oldResponse = probe.latest().onActionResult!;
    await act(async () => {
      useStore.getState().setViewerInstance(crypto.randomUUID());
      useStore.getState().setActionRequest({ requestId: "new", actionId: "navigate" });
    });
    oldResponse("old", { success: true });
    expect(useStore.getState().actionRequest?.requestId).toBe("new");
    await act(async () => useStore.getState().setViewerInstance(null));
  });
});
