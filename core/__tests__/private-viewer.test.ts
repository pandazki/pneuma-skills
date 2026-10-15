import { expect, test } from "bun:test";
import { createPrivateViewerInstanceId, isPrivateViewerInstanceId } from "../types/private-viewer.js";
import type { PrivateViewerIncomingMessage, PrivateViewerOutgoingMessage } from "../types/private-viewer.js";

test("private viewer identity is a runtime UUID, distinct from room/actor handles", () => {
  const id = crypto.randomUUID();
  expect(isPrivateViewerInstanceId(id)).toBe(true);
  for (const invalid of ["room-a", "actor-a", "", null, {}, id + "-extra"]) {
    expect(isPrivateViewerInstanceId(invalid)).toBe(false);
  }
  const request: PrivateViewerIncomingMessage = {
    type: "viewer_action_request", viewer_instance_id: id, request_id: "request-a", action_id: "capture",
  };
  const response: PrivateViewerOutgoingMessage = {
    type: "viewer_action_response", viewer_instance_id: id, request_id: request.request_id, result: { success: true },
  };
  expect(JSON.parse(JSON.stringify(response)).viewer_instance_id).toBe(request.viewer_instance_id);
});

test("plain HTTP browsers can issue independent valid UUIDs without randomUUID", () => {
  const random = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const first = createPrivateViewerInstanceId(random);
  const second = createPrivateViewerInstanceId(random);
  expect(isPrivateViewerInstanceId(first)).toBe(true);
  expect(isPrivateViewerInstanceId(second)).toBe(true);
  expect(first).not.toBe(second);
});
