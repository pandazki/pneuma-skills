import { afterEach, expect, spyOn, test } from "bun:test";
import { loadSessionMode } from "../load-session-mode.js";
import type { ModeInfo } from "../../../core/types/mode-viewer.js";

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
const failed: ModeInfo = {
  external: true, name: "test-mode", path: "/test-mode", type: "local",
  viewerBuild: { status: "failed", error: "UNKNOWN_CERTIFICATE_VERIFICATION_ERROR" },
};

test("the original build failure reaches the viewer instead of an unknown-mode error", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(failed));
  restore = () => fetchSpy.mockRestore();
  await expect(loadSessionMode("test-mode", { retry: false, signal: new AbortController().signal }))
    .rejects.toThrow("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("an explicit retry uses the recovery endpoint and reports another failed attempt", async () => {
  const calls: string[] = [];
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(failed);
  }, { preconnect: () => {} }));
  restore = () => fetchSpy.mockRestore();
  await expect(loadSessionMode("test-mode", { retry: true, signal: new AbortController().signal }))
    .rejects.toThrow("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR");
  expect(calls).toEqual(["GET /api/mode-info", "POST /api/mode-viewer/retry", "GET /api/mode-info"]);
});

test("leaving the page cancels build polling", async () => {
  const controller = new AbortController();
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
    queueMicrotask(() => controller.abort(new Error("left the page")));
    return Response.json({ ...failed, viewerBuild: { status: "building" } });
  }, { preconnect: () => {} }));
  restore = () => fetchSpy.mockRestore();
  await expect(loadSessionMode("test-mode", { retry: false, signal: controller.signal }))
    .rejects.toThrow("left the page");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("mode-info HTTP failures are surfaced before trying to load an unrelated builtin", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("offline", { status: 503 }));
  restore = () => fetchSpy.mockRestore();
  await expect(loadSessionMode("test-mode", { retry: false, signal: new AbortController().signal }))
    .rejects.toThrow("HTTP 503");
});
