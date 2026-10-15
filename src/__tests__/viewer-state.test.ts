import { expect, test } from "bun:test";
import { normalizeViewerState, loadTabViewerState, saveTabViewerState, viewerStateStorageKey } from "../utils/viewer-state.js";
import { Window } from "happy-dom";

const contentSets = [
  { prefix: "gazette", label: "Gazette", traits: {} },
  { prefix: "pneuma", label: "Pneuma", traits: {} },
];

test("normalizeViewerState infers content set from prefixed file path", () => {
  expect(
    normalizeViewerState(
      { contentSet: null, file: "pneuma/index.html" },
      contentSets,
    ),
  ).toEqual({
    contentSet: "pneuma",
    file: "index.html",
  });
});

test("normalizeViewerState strips duplicated prefix from persisted file", () => {
  expect(
    normalizeViewerState(
      { contentSet: "gazette", file: "gazette/article.html" },
      contentSets,
    ),
  ).toEqual({
    contentSet: "gazette",
    file: "article.html",
  });
});

test("normalizeViewerState leaves already-normalized state unchanged", () => {
  expect(
    normalizeViewerState(
      { contentSet: "pneuma", file: "index.html" },
      contentSets,
    ),
  ).toEqual({
    contentSet: "pneuma",
    file: "index.html",
  });
});

test("two tabs in one private Session restore independent positions", () => {
  const href = "http://localhost/?session=shared-private-session&mode=webcraft";
  const a = new Window({ url: href });
  const b = new Window({ url: href });
  const key = viewerStateStorageKey("", href);
  saveTabViewerState(key, { contentSet: "site-a", file: "about.html" }, a.sessionStorage);
  expect(loadTabViewerState(key, b.sessionStorage)).toEqual({});
  saveTabViewerState(key, { contentSet: "site-b", file: "index.html" }, b.sessionStorage);
  expect(loadTabViewerState(key, a.sessionStorage)).toEqual({ contentSet: "site-a", file: "about.html" });
  expect(loadTabViewerState(key, b.sessionStorage)).toEqual({ contentSet: "site-b", file: "index.html" });
  expect(viewerStateStorageKey("", "http://localhost/?session=another&mode=webcraft")).not.toBe(key);
});
