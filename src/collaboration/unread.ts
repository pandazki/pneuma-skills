import type { CollaborationChatMessage, CollaborationComment, CollaborationCommentMessage, CollaborationRoomState } from "../../core/types/collaboration.js";

export type DiscussionChannel = "chat" | "comments";
export interface UnreadCounts { chat: number; comments: number }
interface RoomUnread {
  seen: Record<DiscussionChannel, Set<string>>;
  unread: Record<DiscussionChannel, Set<string>>;
}

/** Counts message IDs, not frames: reconnect snapshots and repeated events are idempotent. */
export class UnreadTracker {
  private rooms = new Map<string, RoomUnread>();

  constructor(private selfId: string, serialized?: string | null) {
    if (!serialized) return;
    try {
      const parsed = JSON.parse(serialized);
      if (parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== "object") return;
      for (const [id, raw] of Object.entries(parsed.rooms)) {
        const item = raw as { seen?: Record<string, unknown>; unread?: Record<string, unknown> };
        const arrays = [item?.seen?.chat, item?.seen?.comments, item?.unread?.chat, item?.unread?.comments];
        if (!arrays.every((value) => Array.isArray(value) && value.every((entry) => typeof entry === "string"))) continue;
        const [chat, comments, unreadChat, unreadComments] = arrays as string[][];
        const state: RoomUnread = { seen: { chat: new Set(chat), comments: new Set(comments) }, unread: { chat: new Set(unreadChat), comments: new Set(unreadComments) } };
        for (const channel of ["chat", "comments"] as const) for (const message of state.unread[channel]) state.seen[channel].add(message);
        this.rooms.set(id, state);
      }
    } catch { /* Corrupt or outdated tab state starts with a new history baseline. */ }
  }

  private room(id: string): RoomUnread {
    let room = this.rooms.get(id);
    if (!room) {
      room = { seen: { chat: new Set(), comments: new Set() }, unread: { chat: new Set(), comments: new Set() } };
      this.rooms.set(id, room);
    }
    return room;
  }

  private observe(id: string, channel: DiscussionChannel, messages: CollaborationCommentMessage[], read: boolean, baseline = false) {
    const state = this.room(id);
    if (read) state.unread[channel].clear();
    for (const message of messages) {
      if (state.seen[channel].has(message.id)) continue;
      state.seen[channel].add(message.id);
      if (!baseline && !read && message.authorId !== this.selfId) state.unread[channel].add(message.id);
    }
  }

  snapshot(snapshot: CollaborationRoomState, visible: DiscussionChannel | null = null): void {
    const id = snapshot.room.id;
    const baseline = !this.rooms.has(id);
    this.observe(id, "chat", snapshot.messages, visible === "chat", baseline);
    this.observe(id, "comments", snapshot.comments.flatMap((comment) => comment.messages), visible === "comments", baseline);
  }

  chat(message: CollaborationChatMessage, read = false): void {
    this.observe(message.roomId, "chat", [message], read);
  }

  comments(roomId: string, comments: CollaborationComment[], read = false): void {
    this.observe(roomId, "comments", comments.filter((comment) => comment.roomId === roomId).flatMap((comment) => comment.messages), read);
  }

  markRead(roomId: string, channel: DiscussionChannel): void {
    this.rooms.get(roomId)?.unread[channel].clear();
  }

  restrictTo(roomIds: string[]): void {
    const allowed = new Set(roomIds);
    for (const id of this.rooms.keys()) if (!allowed.has(id)) this.rooms.delete(id);
  }

  counts(roomId: string): UnreadCounts {
    const room = this.rooms.get(roomId);
    return { chat: room?.unread.chat.size || 0, comments: room?.unread.comments.size || 0 };
  }

  allCounts(): Record<string, UnreadCounts> {
    return Object.fromEntries(Array.from(this.rooms.keys(), (id) => [id, this.counts(id)]));
  }

  serialize(): string {
    return JSON.stringify({ version: 1, rooms: Object.fromEntries(Array.from(this.rooms, ([id, room]) => [id, {
      seen: { chat: Array.from(room.seen.chat), comments: Array.from(room.seen.comments) },
      unread: { chat: Array.from(room.unread.chat), comments: Array.from(room.unread.comments) },
    }])) });
  }
}
