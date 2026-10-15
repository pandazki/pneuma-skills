import { beforeEach, expect, test } from "bun:test";
import { useStore } from "../store/index.js";
import { handleParsedMessage, mountPrivateViewer } from "../ws.js";

beforeEach(() => useStore.getState().setViewerInstance(null));

test("an action addressed to another mount cannot reach this tab's viewer", () => {
  const id = crypto.randomUUID();
  useStore.getState().setViewerInstance(id);
  handleParsedMessage({ type: "viewer_action_request", viewer_instance_id: crypto.randomUUID(), request_id: "other", action_id: "capture" });
  expect(useStore.getState().actionRequest).toBeNull();
  handleParsedMessage({ type: "viewer_action_request", viewer_instance_id: id, request_id: "mine", action_id: "capture" });
  expect(useStore.getState().actionRequest?.requestId).toBe("mine");
});

test("unmount invalidates its action and cannot clear a replacement mount", () => {
  const first = crypto.randomUUID();
  const cleanup = mountPrivateViewer(first);
  useStore.getState().setActionRequest({ requestId: "old-action", actionId: "capture" });
  const next = crypto.randomUUID();
  const cleanupNext = mountPrivateViewer(next);
  cleanup();
  expect(useStore.getState().viewerInstanceId).toBe(next);
  expect(useStore.getState().actionRequest).toBeNull();
  cleanupNext();
  expect(useStore.getState().viewerInstanceId).toBeNull();
});
