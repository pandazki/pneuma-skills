import { describe, expect, test } from "bun:test";
import { create } from "zustand";
import type { AppState } from "../../store/types.js";
import { createChatSlice } from "../../store/chat-slice.js";
import { createSessionSlice } from "../../store/session-slice.js";
import type { CollaborationComment, CollaborationRoom } from "../../../core/types/collaboration.js";
import { createChatFeedback, createCommentFeedback, serializeCollaborationFeedback } from "../forward-to-agent.js";

const room: CollaborationRoom = { id: "room", title: "Landing page", mode: "webcraft", ownerId: "owner", workspaceId: "workspace", modeInstanceId: "instance", enabled: true, revision: 9, page: "index.html", updatedAt: 10 };
const scope = { sessionId: "session-a", projectId: "project", room, contentSet: "en-dark" };
const comment: CollaborationComment = {
  id: "thread", roomId: "room", status: "open", resolvedBy: null, updatedAt: 11,
  anchor: { address: { page: "pricing.html", selector: "#cta", contentSet: "en-light" }, revision: 7, x: 0, y: 0, quote: "Get started" },
  messages: [
    { id: "first", authorId: "guest", authorName: "Reviewer", body: "Increase contrast", createdAt: 123 },
    { id: "reply", authorId: "owner", authorName: "Owner", body: "Keep the warm orange", createdAt: 456 },
  ],
};
function makeStore() {
  return create<AppState>()((...args) => ({ ...createChatSlice(...args), ...createSessionSlice(...args) }) as AppState);
}

describe("private collaboration feedback", () => {
  test("captures canonical source, address, revision and full attributed reply chain independently of live objects", () => {
    const input = structuredClone(comment);
    const feedback = createCommentFeedback({ ...scope, comment: input });
    input.messages[0].body = "edited after forwarding";
    input.anchor.address.page = "other.html";
    expect(feedback.messages).toEqual(comment.messages);
    expect(feedback.address).toEqual(comment.anchor.address);
    expect(feedback.source).toEqual({ contentSet: "en-light", file: "en-light/pricing.html" });
    expect(feedback.revision).toBe(7);
    expect(feedback.currentRevision).toBe(9);
    expect(feedback.workspaceId).toBe("workspace");
    expect(feedback.modeInstanceId).toBe("instance");
  });

  test("chat snapshots retain attribution and room source without private authority metadata", () => {
    const contaminatedRoom = { ...room, token: "do-not-copy", pageUrl: "https://private.invalid/grant" };
    const feedback = createChatFeedback({ ...scope, room: contaminatedRoom, message: { ...comment.messages[0], roomId: room.id } });
    expect(feedback.messages).toEqual([comment.messages[0]]);
    expect(feedback.source.file).toBe("en-dark/index.html");
    expect(JSON.stringify(feedback)).not.toContain("do-not-copy");
    expect(JSON.stringify(feedback)).not.toContain("private.invalid");
  });

  test("preserves raw filename punctuation and an explicit workspace-root content set", () => {
    const address = { file: "draft #2?50%.html", contentSet: null, selector: "#cta" };
    const feedback = createCommentFeedback({ ...scope, comment: { ...comment, anchor: { ...comment.anchor, address } } });
    expect(feedback.source).toEqual({ contentSet: null, file: "draft #2?50%.html" });
    expect(feedback.address).toEqual(address);
    expect(serializeCollaborationFeedback("", [feedback])).toContain("draft #2?50%.html");
  });

  test("uses shared preview bounds and rejects external thumbnail URLs", () => {
    const feedback = createCommentFeedback({ ...scope, comment: { ...comment, anchor: { ...comment.anchor, preview: { label: "Wrong filename", file: "misleading.html", content: "excerpt", thumbnail: "https://private.invalid/image" } } } });
    expect(feedback.source.file).toBe("en-light/pricing.html");
    expect(feedback.preview?.content).toBe("excerpt");
    expect(feedback.preview?.thumbnail).toBeUndefined();
  });

  test("staging only attaches context, deduplicates updated threads and allows individual removal", () => {
    const store = makeStore();
    store.getState().setSessionId(scope.sessionId);
    store.getState().setComposerInsertion({ id: "existing", text: "Keep my draft" });
    const first = createCommentFeedback({ ...scope, comment });
    expect(store.getState().stageCollaborationFeedback(first)).toBe(true);
    first.messages[0].body = "external mutation";
    const newer = createCommentFeedback({ ...scope, comment: { ...comment, messages: [...comment.messages, { ...comment.messages[0], id: "third", body: "New reply" }] } });
    store.getState().stageCollaborationFeedback(newer);
    const chat = createChatFeedback({ ...scope, message: { ...comment.messages[0], roomId: room.id } });
    store.getState().stageCollaborationFeedback(chat);
    expect(store.getState().collaborationFeedback).toHaveLength(2);
    expect(store.getState().collaborationFeedback[0].messages).toHaveLength(3);
    expect(store.getState().pendingMessages).toEqual([]);
    expect(store.getState().messages).toEqual([]);
    expect(store.getState().composerInsertion?.text).toBe("Keep my draft");
    expect(store.getState().collaborationFeedbackFocus).toBe(3);
    store.getState().removeCollaborationFeedback(newer.key);
    expect(store.getState().collaborationFeedback.map((item) => item.key)).toEqual([chat.key]);
  });

  test("late completion consumes only submitted snapshots and session changes clear unsent context", () => {
    const store = makeStore();
    store.getState().setSessionId(scope.sessionId);
    const submitted = createCommentFeedback({ ...scope, comment });
    store.getState().stageCollaborationFeedback(submitted);
    const edited = createCommentFeedback({ ...scope, comment });
    store.getState().stageCollaborationFeedback(edited);
    store.getState().consumeCollaborationFeedback([submitted]);
    expect(store.getState().collaborationFeedback[0].snapshotId).toBe(edited.snapshotId);
    store.getState().addPendingMessage({ text: "queued feedback", collaborationFeedback: [submitted] });
    store.getState().setSessionId("session-b");
    expect(store.getState().collaborationFeedback).toEqual([]);
    expect(store.getState().pendingMessages).toEqual([]);
    expect(store.getState().stageCollaborationFeedback(submitted)).toBe(false);
  });

  test("serializes collaborator content as quoted reference and keeps user instructions separate", () => {
    const feedback = createCommentFeedback({ ...scope, comment });
    const text = serializeCollaborationFeedback("Please address both comments", [feedback]);
    expect(text).toContain('>       "authorName": "Reviewer"');
    expect(text).toContain("Increase contrast");
    expect(text).toContain("Keep the warm orange");
    expect(text).toContain('"file": "en-light/pricing.html"');
    expect(text).toEndWith("User instructions:\nPlease address both comments");
    expect(serializeCollaborationFeedback("", [feedback])).toContain("Increase contrast");
    expect(serializeCollaborationFeedback("", [feedback])).toEndWith("User instructions:\nPlease address this feedback in the workspace.");
    expect(serializeCollaborationFeedback("Unchanged draft", [])).toBe("Unchanged draft");
  });
});
