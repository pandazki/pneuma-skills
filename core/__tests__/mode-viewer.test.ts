import { expect, test } from "bun:test";
import { modeViewerAssetUrl } from "../types/mode-viewer.js";

test("recovered entry assets have a new browser module identity", () => {
  const first = new URL(modeViewerAssetUrl("pneuma-mode.js", "attempt-1"), "http://localhost");
  const retry = new URL(modeViewerAssetUrl("pneuma-mode.js", "attempt-2"), first);
  expect(retry.pathname).toBe(first.pathname);
  expect(retry.href).not.toBe(first.href);
  expect(retry.searchParams.get("v")).toBe("attempt-2");
});

test("CSS names and revisions cannot inject query parameters or HTML", () => {
  const path = modeViewerAssetUrl('viewer"&.css', "a&extra=1");
  expect(path).not.toContain('"');
  const url = new URL(path, "http://localhost");
  expect([...url.searchParams.keys()]).toEqual(["v"]);
  expect(url.searchParams.get("v")).toBe("a&extra=1");
});
