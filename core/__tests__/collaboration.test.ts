import { describe, expect, test } from "bun:test";
import {
  canDiscussCollaboration, canManageCollaborationRoom, canWriteCollaboration, isCollaborationHost,
  type CollaborationIdentity, type CollaborationRoom,
} from "../types/collaboration.js";
import { isCollaborationPublicPath } from "../types/collaboration-publication.js";

const room: CollaborationRoom = {
  id: "landing", title: "Landing", mode: "webcraft", ownerId: "owner",
  enabled: true, revision: 1, page: "index.html", updatedAt: 1,
};

describe("collaboration authorization contract", () => {
  test("only the designated writable member can host, not another administrator or guest", () => {
    const owner: CollaborationIdentity = { id: room.ownerId, name: "Host", kind: "member", role: "admin" };
    expect(isCollaborationHost(owner, room)).toBe(true);
    expect(isCollaborationHost({ ...owner, role: "writer" }, room)).toBe(true);
    expect(isCollaborationHost({ ...owner, role: "reader" }, room)).toBe(false);
    expect(isCollaborationHost({ ...owner, id: "other-admin" }, room)).toBe(false);
    expect(isCollaborationHost({ ...owner, kind: "guest", roomId: room.id }, room)).toBe(false);
  });
  test("LAN and cloud publication share one private-path boundary", () => {
    for (const path of [".env", "a/../secret", "AGENTS.md", "nested/session.json", "node_modules/library.js", "/index.html", "a\\b.html"]) {
      expect(isCollaborationPublicPath(path)).toBe(false);
    }
    for (const path of ["index.html", "assets/photo.webp", "viewer/webcraft/v1/frame.js"]) expect(isCollaborationPublicPath(path)).toBe(true);
  });
  test("readers and anonymous identities cannot perform any durable mutation", () => {
    const reader: CollaborationIdentity = { id: "owner", name: "Reader", role: "reader", kind: "member" };
    expect(canWriteCollaboration(reader)).toBe(false);
    expect(canDiscussCollaboration(reader)).toBe(false);
    expect(canDiscussCollaboration({ ...reader, guestAccess: "comment" })).toBe(false);
    expect(canManageCollaborationRoom(reader, room)).toBe(false);
    // A guest cannot gain authority even if malformed storage grants a role.
    for (const role of ["reader", "writer", "admin"] as const) {
      const guest: CollaborationIdentity = { id: "owner", name: "Guest", role, kind: "guest", roomId: room.id };
      expect(canWriteCollaboration(guest)).toBe(false);
      expect(canDiscussCollaboration(guest)).toBe(false);
      expect(canManageCollaborationRoom(guest, room)).toBe(false);
    }
  });

  test("a discussion invitation allows feedback only within its assigned room", () => {
    const reviewer: CollaborationIdentity = { id: "visitor", name: "Visitor", kind: "guest", role: "reader", roomId: room.id, guestAccess: "comment" };
    expect(canDiscussCollaboration(reviewer)).toBe(true);
    expect(canWriteCollaboration(reviewer)).toBe(false);
    expect(canManageCollaborationRoom(reviewer, room)).toBe(false);
    expect(canDiscussCollaboration({ ...reviewer, roomId: undefined })).toBe(false);
    expect(canDiscussCollaboration({ ...reviewer, guestAccess: "view" })).toBe(false);
  });

  test("only an administrator or a writing owner manages a room", () => {
    const writer: CollaborationIdentity = { id: "other", name: "Writer", role: "writer", kind: "member" };
    expect(canWriteCollaboration(writer)).toBe(true);
    expect(canManageCollaborationRoom(writer, room)).toBe(false);
    expect(canManageCollaborationRoom({ ...writer, id: "owner" }, room)).toBe(true);
    expect(canManageCollaborationRoom({ ...writer, role: "admin" }, room)).toBe(true);
  });
});
