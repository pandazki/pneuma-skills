import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { CollaborationAnchor, CollaborationChatMessage, CollaborationComment, CollaborationRoomState } from "../../../core/types/collaboration.js";
import { CommentReference } from "../CommentReference.js";
import { Chat, Comments, CommentThread } from "../App.js";
import { createCommentAnchor } from "../comment-anchor.js";
import type { useCollaboration } from "../use-collaboration.js";

let win: Window;
let root: Root;
let restore: () => void;
const thumbnail = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>Selected heading</text></svg>');
const anchor: CollaborationAnchor = { address: { contentSet: "website", page: "index.html", selector: "#knowledge-heading" }, revision: 3, x: 0, y: 0, quote: "#knowledge-heading", preview: { label: 'h2 "Shared knowledge"', file: "index.html", type: "heading", content: "Shared knowledge makes work better.", thumbnail } };
const comment: CollaborationComment = { id: "thread", roomId: "room", anchor, status: "open", messages: [{ id: "message", authorId: "peer", authorName: "Peer", body: "Improve this section", createdAt: 1 }], resolvedBy: null, updatedAt: 1 };
const message: CollaborationChatMessage = { id: "chat", roomId: "room", authorId: "peer", authorName: "Peer", body: "Please review the page", createdAt: 1 };
const room = { room: { id: "room", revision: 3 }, comments: [comment], messages: [message] } as CollaborationRoomState;
const client = { room, request: async () => { throw new Error("Display actions must not mutate shared state"); } } as unknown as ReturnType<typeof useCollaboration>;

beforeEach(() => {
  win = new Window({ url: "http://localhost:17007/" });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await win.happyDOM.close(); restore(); });
function button(text: string) { return [...win.document.querySelectorAll("button")].find((node) => node.textContent === text)!; }

describe("comment references and private forwarding affordances", () => {
  test("selection conversion preserves its address and preview while bounding quote and failed capture", () => {
    const selection = { address: anchor.address, type: "heading", content: "x".repeat(2500), file: "index.html", thumbnail };
    const result = createCommentAnchor(selection, 3)!;
    expect(result.address).toEqual(anchor.address);
    expect(result.preview?.thumbnail).toBe(thumbnail);
    expect(result.preview?.content).toHaveLength(2000);
    expect(result.quote).toHaveLength(1000);
    expect(createCommentAnchor({ ...selection, thumbnail: "data:image/png;base64," + "a".repeat(50000) }, 3)?.preview?.thumbnail).toBeUndefined();
    expect(createCommentAnchor({ type: "image", content: "" }, 3)).toBeNull();
  });
  test("clicking a preview locates the original anchor and a failed image leaves its readable reference", async () => {
    const located: CollaborationAnchor[] = [];
    await act(async () => root.render(<CommentReference anchor={anchor} onLocate={(value) => { located.push(value); }}/>));
    expect(win.document.querySelector("img")?.src).toBe(thumbnail);
    expect(win.document.body.textContent).toContain('h2 "Shared knowledge"');
    expect(win.document.body.textContent).toContain("index.html");
    await act(async () => win.document.querySelector("button")!.click());
    expect(located[0]).toBe(anchor);
    await act(async () => win.document.querySelector("img")!.dispatchEvent(new win.Event("error")));
    expect(win.document.querySelector("img")).toBeNull();
    expect(win.document.body.textContent).toContain("Shared knowledge makes work better.");
    const old = { ...anchor, preview: undefined };
    expect(renderToStaticMarkup(<CommentReference anchor={old} onLocate={() => {}}/>)).toContain("#knowledge-heading");
  });
  test("draft and saved references navigate without posting; nonempty threads retain Add comment", async () => {
    const located: CollaborationAnchor[] = []; let started = 0;
    await act(async () => root.render(<Comments client={client} writable canResolve draftAnchor={anchor} onCancelDraft={() => {}} onLocate={(value) => { located.push(value); }} onStart={() => { started++; }}/>));
    expect(win.document.querySelectorAll(".comment-reference")).toHaveLength(2);
    await act(async () => (win.document.querySelector(".new-thread .comment-reference") as unknown as HTMLButtonElement).click());
    expect(located[0]).toBe(anchor);
    await act(async () => button("Add comment").click());
    expect(started).toBe(1);
  });
  test("private thread forwarding stages the full thread while public and read-only views keep their boundaries", async () => {
    const forwarded: CollaborationComment[] = [];
    await act(async () => root.render(<CommentThread comment={comment} client={client} writable={false} canResolve={false} onLocate={() => {}} onForwardComment={(value) => { forwarded.push(value); }}/>));
    await act(async () => button("Send to AI").click());
    expect(forwarded[0]).toBe(comment);
    expect(button("Resolve")).toBeUndefined();
    const publicMarkup = renderToStaticMarkup(<CommentThread comment={comment} client={client} writable canResolve onLocate={() => {}}/>);
    expect(publicMarkup).not.toContain("Send to AI");
    const stale = renderToStaticMarkup(<CommentThread comment={{ ...comment, anchor: { ...anchor, revision: 2 } }} client={client} writable={false} canResolve={false} onLocate={() => {}}/>);
    expect(stale).toContain("Pinned to revision 2");
  });
  test("private chat forwarding stages exactly the selected shared message", async () => {
    const forwarded: CollaborationChatMessage[] = [];
    await act(async () => root.render(<Chat client={client} writable={false} onForwardMessage={(value) => { forwarded.push(value); }}/>));
    await act(async () => button("Send to AI").click());
    expect(forwarded[0]).toBe(message);
    expect(renderToStaticMarkup(<Chat client={client} writable={false}/>)).not.toContain("Send to AI");
  });
});
