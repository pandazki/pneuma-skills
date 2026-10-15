import { describe, expect, test } from "bun:test";
import type { CollaborationChatMessage, CollaborationComment, CollaborationRoomState } from "../../../core/types/collaboration.js";
import { UnreadTracker } from "../unread.js";

const message = (id: string, authorId = "other", roomId = "room"): CollaborationChatMessage => ({ id, authorId, authorName: authorId, body: id, createdAt: 1, roomId });
const thread = (ids: string[], roomId = "room"): CollaborationComment => ({ id: "thread", roomId, anchor: { address: { selector: "h1" }, revision: 1, x: 1, y: 1 }, messages: ids.map((id) => message(id)), status: "open", resolvedBy: null, updatedAt: 1 });
const snapshot = (messages: CollaborationChatMessage[] = [], comments: CollaborationComment[] = [], id = "room"): CollaborationRoomState => ({ room: { id, title: id, mode: "webcraft", ownerId: "me", enabled: true, revision: 1, page: "index.html", updatedAt: 1 }, messages, comments, participants: [], pageUrl: "/page" });

describe("unread discussion notifications", () => {
  test("initial history is a baseline, never a notification", () => {
    const unread = new UnreadTracker("me");
    unread.snapshot(snapshot([message("past-chat")], [thread(["past-comment"])]));
    expect(unread.counts("room")).toEqual({ chat: 0, comments: 0 });
    unread.chat(message("past-chat"));
    unread.comments("room", [thread(["past-comment"])]);
    expect(unread.counts("room")).toEqual({ chat: 0, comments: 0 });
  });

  test("new others' chat and replies notify once, own messages and status changes do not", () => {
    const unread = new UnreadTracker("me");
    unread.snapshot(snapshot([], [thread(["original"])]));
    unread.chat(message("new-chat"));
    unread.chat(message("new-chat"));
    unread.chat(message("my-chat", "me"));
    unread.comments("room", [thread(["original", "reply"])]);
    unread.comments("room", [{ ...thread(["original", "reply"]), status: "resolved", resolvedBy: "other" }]);
    expect(unread.counts("room")).toEqual({ chat: 1, comments: 1 });
  });

  test("viewing one panel clears only its unread set, and subsequent live updates stay read", () => {
    const unread = new UnreadTracker("me");
    unread.snapshot(snapshot());
    unread.chat(message("unseen-chat"));
    unread.comments("room", [thread(["unseen-comment"])]);
    unread.markRead("room", "comments");
    unread.comments("room", [thread(["unseen-comment", "visible-reply"])], true);
    expect(unread.counts("room")).toEqual({ chat: 1, comments: 0 });
    unread.markRead("room", "chat");
    unread.chat(message("visible-chat"), true);
    expect(unread.counts("room")).toEqual({ chat: 0, comments: 0 });
  });

  test("reconnect and tab reload retain unread without counting duplicate snapshot history", () => {
    const unread = new UnreadTracker("me");
    unread.snapshot(snapshot([message("history")]));
    unread.chat(message("pending"));
    const restored = new UnreadTracker("me", unread.serialize());
    restored.snapshot(snapshot([message("history"), message("pending"), message("during-disconnect")]));
    expect(restored.counts("room").chat).toBe(2);
    restored.snapshot(snapshot([message("history"), message("pending"), message("during-disconnect")]));
    expect(restored.counts("room").chat).toBe(2);
  });

  test("room identity scopes seen IDs and clearing", () => {
    const unread = new UnreadTracker("me");
    unread.snapshot(snapshot());
    unread.snapshot(snapshot([], [], "second"));
    unread.chat(message("same-id", "other", "room"));
    unread.chat(message("same-id", "other", "second"));
    unread.markRead("room", "chat");
    expect(unread.counts("room").chat).toBe(0);
    expect(unread.counts("second").chat).toBe(1);
  });

  test("bad persisted data falls back to a fresh baseline", () => {
    const unread = new UnreadTracker("me", '{"version":1,"rooms":{"room":{"seen":null}}}');
    unread.snapshot(snapshot([message("history")]));
    expect(unread.counts("room")).toEqual({ chat: 0, comments: 0 });
  });
});
