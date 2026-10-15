import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CollaborationIdentity, CollaborationRoom, CollaborationRoomState, CollaborationView } from "../../../core/types/collaboration.js";
import { CommentThread, RoomActions } from "../App.js";
import { InvitationJoin } from "../Entry.js";
import { canApplyView, discussionAvailable, mutationAvailable, readCredentials, safePageUrl, shareUrl, validAnchor, validView, visibleRoomIds } from "../client-state.js";
import type { useCollaboration } from "../use-collaboration.js";

const room: CollaborationRoom = { id: "page", title: "Launch page", mode: "webcraft", ownerId: "writer", enabled: true, revision: 3, page: "index.html", updatedAt: 1 };
const view: CollaborationView = { page: "index.html", revision: 3, scrollX: 0, scrollY: 400, width: 1200, height: 800, documentWidth: 1200, documentHeight: 1600 };
const roomState: CollaborationRoomState = { room, participants: [], comments: [], messages: [], pageUrl: "/frame/page" };
const noOp = () => {};
const renderActions = (self: CollaborationIdentity, enabled = true) => renderToStaticMarkup(<RoomActions self={self} room={room} enabled={enabled} commenting={false} onComment={noOp} onSource={noOp} onShare={noOp} onToggle={noOp}/>);

describe("collaboration UI access boundaries", () => {
  test("reader and guest toolbar has no durable-action affordance, including an owning reader", () => {
    for (const kind of ["member", "guest"] as const) {
      const markup = renderActions({ id: "writer", name: "Reader", kind, role: "reader", roomId: "page" });
      expect(markup).toContain("Read only");
      for (const label of ["Add comment", "Source", "Share", 'role="switch"']) expect(markup).not.toContain(label);
    }
  });
  test("writer can contribute but only owner/admin can manage sharing", () => {
    const writer: CollaborationIdentity = { id: "other", name: "Other", kind: "member", role: "writer" };
    const other = renderActions(writer);
    expect(other).toContain("Add comment");
    expect(other).toContain("Source");
    expect(other).not.toContain("Share");
    expect(renderActions({ ...writer, id: "writer" })).toContain('role="switch"');
    expect(renderActions({ ...writer, role: "admin" })).toContain("Share");
  });
  test("a lost connection disables mutations even with a previously valid administrator identity", () => {
    const admin: CollaborationIdentity = { id: "admin", name: "Admin", role: "admin", kind: "member" };
    expect(mutationAvailable(admin, "connected")).toBe(true);
    for (const state of ["connecting", "reconnecting", "closed", "error"] as const) expect(mutationAvailable(admin, state)).toBe(false);
    const markup = renderActions(admin, false);
    expect(markup.match(/disabled=""/g)?.length).toBe(4);
  });
  test("guest directory is limited even if an overbroad room list reaches the UI", () => {
    expect(visibleRoomIds({ id: "g", name: "Guest", kind: "guest", role: "reader", roomId: "one" }, ["one", "two"])).toEqual(["one"]);
  });
  test("a cloud reviewer can comment and reply but has no source, resolve, or management controls", () => {
    const reviewer: CollaborationIdentity = { id: "visitor", name: "Visitor", role: "reader", kind: "guest", roomId: "page", guestAccess: "comment" };
    const markup = renderActions(reviewer);
    expect(markup).toContain("Add comment");
    for (const label of ["Source", "Share", 'role="switch"']) expect(markup).not.toContain(label);
    const comment = { id: "comment", roomId: "page", anchor: { address: {}, revision: 3, x: 0, y: 0 }, messages: [{ id: "m", authorId: "host", authorName: "Host", body: "Review this", createdAt: 1 }], status: "open" as const, resolvedBy: null, updatedAt: 1 };
    const client = { room: roomState } as ReturnType<typeof useCollaboration>;
    const thread = renderToStaticMarkup(<CommentThread comment={comment} client={client} writable={discussionAvailable(reviewer, "connected")} canResolve={mutationAvailable(reviewer, "connected")} onLocate={noOp}/>);
    expect(thread).toContain("Reply");
    expect(thread).not.toContain("Resolve");
    expect(discussionAvailable({ ...reviewer, kind: "member" }, "connected")).toBe(false);
    expect(discussionAvailable({ ...reviewer, guestAccess: "view" }, "connected")).toBe(false);
    expect(discussionAvailable(reviewer, "reconnecting")).toBe(false);
  });
  test("cloud source capability hides editing even for an administrator", () => {
    const markup = renderToStaticMarkup(<RoomActions self={{ id: "admin", name: "Admin", role: "admin", kind: "member" }} room={room} enabled commenting={false} canEditSource={false} onComment={noOp} onSource={noOp} onShare={noOp} onToggle={noOp}/>);
    expect(markup).not.toContain("Source");
    expect(markup).toContain("Add comment");
    expect(markup).toContain("Share");
  });
});

describe("invitation and frame boundaries", () => {
  test("invitation credentials are removed from the URL and isolated by tab storage", () => {
    const tab = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
    const first = tab(); const second = tab();
    const admin = readCredentials("http://localhost:8000/#token=admin-secret&room=page", first);
    const guest = readCredentials("http://localhost:8000/#token=guest-secret&room=page", second);
    expect(admin.cleanUrl).not.toContain("admin-secret");
    expect(admin.cleanUrl).toEndWith("#room=page");
    expect(guest.token).toBe("guest-secret");
    expect(readCredentials(admin.cleanUrl, first).token).toBe("admin-secret");
    expect(readCredentials(guest.cleanUrl, second).token).toBe("guest-secret");
  });
  test("frame URLs cannot switch origin or invoke scripts", () => {
    expect(safePageUrl("/frames/page?grant=readonly", "https://example.test")).toBe("https://example.test/frames/page?grant=readonly");
    expect(safePageUrl("https://attacker.test/page", "https://example.test")).toBeNull();
    expect(safePageUrl("javascript:alert(1)", "https://example.test")).toBeNull();
  });
  test("local bridge accepts only its configured cloud frame origin", () => {
    expect(safePageUrl("https://collab.example.test/frame", "http://localhost:8000", "https://collab.example.test")).toBe("https://collab.example.test/frame");
    expect(safePageUrl("https://another.collab.example.test/frame", "http://localhost:8000", "https://collab.example.test")).toBeNull();
    expect(safePageUrl("https://collab.example.test/frame", "http://localhost:8000")).toBeNull();
  });
  test("cloud invitation links use the public origin and never serialize member credentials", () => {
    const link = shareUrl("invitation-secret", "page", { publicOrigin: "https://collab.example.test", invitation: true });
    const url = new URL(link);
    expect(url.origin).toBe("https://collab.example.test");
    expect(new URLSearchParams(url.hash.slice(1)).get("invite")).toBe("invitation-secret");
    expect(new URLSearchParams(url.hash.slice(1)).has("token")).toBe(false);
  });
  test("opening an invitation cannot silently reuse a prior tab's administrator credential", () => {
    const values = new Map([["pneuma-collaboration-token", "old-admin"]]);
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const invite = readCredentials("https://collab.example.test/#invite=join-secret&room=page", storage);
    expect(invite.token).toBe("");
    expect(invite.inviteToken).toBe("join-secret");
    expect(invite.cleanUrl).not.toContain("join-secret");
    expect(readCredentials(invite.cleanUrl, storage).inviteToken).toBe("join-secret");
    const restoredMember = readCredentials("https://collab.example.test/#token=member-secret", storage);
    expect(restoredMember.inviteToken).toBe("");
    expect(restoredMember.token).toBe("member-secret");
  });
  test("name-entry view exposes no invitation secret", () => {
    const markup = renderToStaticMarkup(<InvitationJoin inviteToken="private-invitation-token" onJoin={noOp}/>);
    expect(markup).toContain("Your name");
    expect(markup).toContain("Join workspace");
    expect(markup).not.toContain("private-invitation-token");
  });
  test("malformed untrusted frame state never becomes presence or a comment draft", () => {
    expect(validView(view)).toBe(true);
    expect(validView({ ...view, scrollY: Infinity })).toBe(false);
    expect(validView({ ...view, width: 0 })).toBe(false);
    expect(validView({ ...view, revision: -1 })).toBe(false);
    expect(validAnchor({ address: { selector: "#hero" }, revision: 3, x: 10, y: 20, quote: "Launch" })).toBe(true);
    expect(validAnchor({ address: [], revision: 3, x: 10, y: 20 })).toBe(false);
    expect(validAnchor({ address: {}, revision: 3, x: NaN, y: 20 })).toBe(false);
  });
  test("follow cannot apply coordinates from a stale revision or a different page", () => {
    expect(canApplyView(view, roomState)).toBe(true);
    expect(canApplyView({ ...view, revision: 2 }, roomState)).toBe(false);
    expect(canApplyView({ ...view, page: "other.html" }, roomState)).toBe(false);
    expect(canApplyView(null, roomState)).toBe(false);
  });
});
