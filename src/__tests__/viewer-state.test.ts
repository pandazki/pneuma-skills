import { expect, test } from "bun:test";
import { normalizeViewerState } from "../utils/viewer-state.js";

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
