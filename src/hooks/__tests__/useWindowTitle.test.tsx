/** @jsxImportSource react */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useStore } from "../../store.js";
import { useWindowTitle } from "../useWindowTitle.js";

let win: Window;
let root: Root | undefined;
let restore: () => void;
const initialState = useStore.getState();
const realFetch = globalThis.fetch;
let nextResponse: () => Promise<Response>;
let calls = 0;

beforeAll(() => {
  win = new Window({ url: "http://localhost/?session=one&mode=doc" });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "IS_REACT_ACT_ENVIRONMENT"]) {
    saved[key] = globals[key];
    globals[key] = key === "IS_REACT_ACT_ENVIRONMENT" ? true : (win as unknown as Record<string, unknown>)[key];
  }
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  };
  globalThis.fetch = (async () => { calls++; return nextResponse(); }) as unknown as typeof fetch;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  useStore.setState(initialState, true);
  win.document.body.innerHTML = "";
  calls = 0;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await win.happyDOM.close();
  restore();
});

const info = (title: string | null, projectName: string | null = "Morrow") => Response.json({
  sessionId: "one", title, workspace: "/work/brand-site", watcher: null,
  project: projectName ? { projectRoot: "/work/morrow", projectName } : null,
});
const props = { session: true, projectRoot: null, chat: false };
function Probe(options: Parameters<typeof useWindowTitle>[0]) {
  useWindowTitle(options);
  return null;
}
async function render(options: Parameters<typeof useWindowTitle>[0] = props) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => { root!.render(createElement(Probe, options)); });
}

test("loads the summarized title and refreshes it after refinement and focus", async () => {
  useStore.setState({ sessionId: "one", sessionWorkspace: "/work/brand-site" });
  nextResponse = async () => info("Brand redesign");
  await render();
  expect(document.title).toBe("Brand redesign · Morrow — Pneuma Skills");
  nextResponse = async () => info("Launch-ready brand");
  await act(async () => { useStore.getState().bumpSessionMetaTick(); });
  expect(document.title).toBe("Launch-ready brand · Morrow — Pneuma Skills");
  nextResponse = async () => info("My manual title");
  await act(async () => { window.dispatchEvent(new win.Event("focus") as unknown as Event); });
  expect(document.title).toBe("My manual title · Morrow — Pneuma Skills");
});

test("uses workspace fallback, distinguishes chat, and resets launcher/project-only windows", async () => {
  nextResponse = async () => info(null, null);
  await render({ ...props, chat: true });
  expect(document.title).toBe("brand-site · Chat — Pneuma Skills");
  const before = calls;
  await render({ ...props, session: false });
  expect(document.title).toBe("Pneuma Skills");
  expect(calls).toBe(before);
  await act(async () => { useStore.setState({ projectContext: { projectRoot: "/work/morrow", projectName: "Morrow" } }); });
  await render({ ...props, session: false, projectRoot: "/work/morrow" });
  expect(document.title).toBe("Morrow — Pneuma Skills");
});

test("a late response from the previous session cannot overwrite the current window title", async () => {
  let release!: (response: Response) => void;
  nextResponse = () => new Promise(resolve => { release = resolve; });
  useStore.setState({ sessionId: "one" });
  await render();
  nextResponse = async () => info("Second session", null);
  await act(async () => { useStore.setState({ sessionId: "two" }); });
  expect(document.title).toBe("Second session — Pneuma Skills");
  await act(async () => { release(info("Stale first session")); });
  expect(document.title).toBe("Second session — Pneuma Skills");
});
