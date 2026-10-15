import { expect } from "bun:test";
import { useStore } from "../../store/index.js";
import { connect, disconnect, sendUserMessage, sendSteerMessage } from "../../ws.js";
import { createChatFeedback, serializeCollaborationFeedback } from "../../collaboration/forward-to-agent.js";
import type { AppState } from "../../store/types.js";

const wire: { type: string; content?: string }[] = [];
const server = Bun.serve({ port: 0, fetch(request, server) { return server.upgrade(request) ? undefined : new Response("not found", { status: 404 }); }, websocket: { message(_socket, message) { wire.push(JSON.parse(String(message))); }, open(socket) { socket.send(JSON.stringify({ type: "cli_connected" })); } } });
(globalThis as unknown as { location: URL }).location = new URL(`http://localhost:${server.port}`);
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for local WebSocket delivery");
    await Bun.sleep(1);
  }
};
const reset = () => useStore.setState({ sessionId: "transport-session", messages: [], pendingMessages: [], pendingSteerIds: new Set(), connectionStatus: "disconnected", sessionStatus: "idle", turnInProgress: false, userActions: [], modeViewer: null, files: [], activeFile: null, activeContentSet: null, viewportRange: null, debugMode: true });
const userBubbles = () => useStore.getState().messages.filter((message) => message.role === "user");
const action = { timestamp: Date.now(), actionId: "selected", description: "Selected the header" };
reset();
useStore.getState().pushUserAction(action);
useStore.getState().setPromptSuggestions(["Keep this suggestion"]);
const feedback = createChatFeedback({ sessionId: "transport-session", projectId: "project", contentSet: null, room: { id: "room", title: "Page", mode: "webcraft", ownerId: "owner", enabled: true, revision: 2, page: "index.html", updatedAt: 1 }, message: { id: "message", roomId: "room", authorId: "guest", authorName: "Guest", body: "Increase title contrast", createdAt: 3 } });
const text = serializeCollaborationFeedback("Keep the size", [feedback]);

try {
  // Two failed retries must leave no apparent sent messages or consumed context.
  expect(await sendUserMessage(text)).toBe(false);
  expect(await sendUserMessage(text)).toBe(false);
  expect(userBubbles()).toHaveLength(0);
  expect(useStore.getState().userActions).toEqual([action]);
  expect(useStore.getState().promptSuggestions).toEqual(["Keep this suggestion"]);
  expect(useStore.getState().turnInProgress).toBe(false);

  // A real extraction failure is equally retryable and leaves no phantom row.
  useStore.setState({ modeViewer: { extractContext() { throw new Error("real enrichment failure"); } } as unknown as AppState["modeViewer"] });
  await expect(sendUserMessage(text)).rejects.toThrow("real enrichment failure");
  expect(userBubbles()).toHaveLength(0);
  expect(useStore.getState().userActions).toEqual([action]);
  useStore.setState({ modeViewer: null });

  connect("transport-session");
  await waitFor(() => useStore.getState().connectionStatus === "connected");
  const selection = { file: "index.html", type: "heading" as const, content: "Selected title" };
  const images = [{ media_type: "image/png", data: "YQ==" }];
  const annotations = [{ id: "annotation", slideFile: "index.html", element: selection, comment: "Preserve this annotation" }];
  const files = [{ name: "notes.txt", media_type: "text/plain", data: "YQ==", size: 1 }];
  expect(await sendUserMessage(text, selection, images, annotations, files)).toBe(true);
  await waitFor(() => wire.some((message) => message.type === "user_message"));
  expect(userBubbles()).toHaveLength(1);
  expect(userBubbles()[0].content).toBe(text);
  expect(userBubbles()[0].selectionContext).toEqual(selection);
  expect(userBubbles()[0].images).toEqual(images);
  expect(userBubbles()[0].annotations).toEqual(annotations);
  expect(userBubbles()[0].files).toEqual([{ name: "notes.txt", size: 1 }]);
  expect(userBubbles()[0].debugPayload?.images).toEqual(images);
  expect(userBubbles()[0].debugPayload?.files).toEqual([{ name: "notes.txt", media_type: "text/plain", size: 1 }]);
  expect(userBubbles()[0].debugPayload?.enrichedContent).toContain("Selected the header");
  expect(wire.filter((message) => message.type === "user_message")).toHaveLength(1);
  expect(wire.find((message) => message.type === "user_message")?.content).toContain("Selected the header");
  expect(useStore.getState().userActions).toHaveLength(0);
  expect(useStore.getState().promptSuggestions).toHaveLength(0);

  // Steer still waits for its acknowledgement before publishing a user bubble.
  expect(await sendSteerMessage("steer", "queued guidance")).toBe(true);
  expect(userBubbles()).toHaveLength(1);

  // A busy queued message that fails real enrichment remains visible and
  // retryable. A successful explicit retry publishes exactly one bubble/frame.
  wire.length = 0;
  useStore.setState({ messages: [], pendingMessages: [], sessionStatus: "running", turnInProgress: true, modeViewer: { extractContext() { throw new Error("queued enrichment failure"); } } as unknown as AppState["modeViewer"] });
  useStore.getState().pushUserAction(action);
  useStore.getState().addPendingMessage({ text, collaborationFeedback: [feedback] });
  useStore.getState().setTurnInProgress(false);
  useStore.getState().setSessionStatus("idle");
  await waitFor(() => useStore.getState().pendingMessages.some((message) => message.kind === "user" && !!message.deliveryError));
  expect(userBubbles()).toHaveLength(0);
  expect(useStore.getState().userActions).toEqual([action]);
  expect(wire.filter((message) => message.type === "user_message")).toHaveLength(0);
  useStore.setState({ modeViewer: null });
  await Bun.sleep(5);
  expect(userBubbles()).toHaveLength(0);
  useStore.getState().retryPendingMessage(useStore.getState().pendingMessages[0].id);
  await waitFor(() => wire.some((message) => message.type === "user_message"));
  expect(userBubbles()).toHaveLength(1);
  expect(wire.filter((message) => message.type === "user_message")).toHaveLength(1);
  expect(useStore.getState().pendingMessages).toHaveLength(0);
  expect(useStore.getState().userActions).toHaveLength(0);

  // Busy-queue closed-socket recovery retains the payload without a bubble.
  wire.length = 0;
  useStore.setState({ messages: [], sessionStatus: "running", turnInProgress: true, connectionStatus: "disconnected" });
  disconnect();
  await waitFor(() => useStore.getState().connectionStatus === "disconnected");
  disconnect(); // Cancel the normal close-triggered reconnect timer.
  useStore.getState().addPendingMessage({ text, collaborationFeedback: [feedback] });
  useStore.getState().setTurnInProgress(false);
  useStore.getState().setSessionStatus("idle");
  useStore.getState().setConnectionStatus("connected"); // A stale connected edge; the real socket is closed.
  await waitFor(() => useStore.getState().connectionStatus === "disconnected");
  expect(useStore.getState().pendingMessages).toHaveLength(1);
  expect(userBubbles()).toHaveLength(0);
  connect("transport-session");
  await waitFor(() => wire.some((message) => message.type === "user_message"));
  expect(userBubbles()).toHaveLength(1);
  expect(wire.filter((message) => message.type === "user_message")).toHaveLength(1);
  expect(useStore.getState().pendingMessages).toHaveLength(0);
} finally {
  disconnect();
  server.stop(true);
  await Bun.sleep(1);
  disconnect();
}
process.stdout.write("real user delivery flow passed\n");
