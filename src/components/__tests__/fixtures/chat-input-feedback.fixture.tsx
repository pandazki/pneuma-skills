/** @jsxImportSource react */
import { expect, mock } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
const globals = globalThis as unknown as Record<string, unknown>;
const windowGlobals = win as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "location", "HTMLElement", "HTMLTextAreaElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) globals[key] = key === "window" ? win : windowGlobals[key];
globals.IS_REACT_ACT_ENVIRONMENT = true;

type Send = { text: string; selection: unknown; files: unknown };
const sent: Send[] = [];
let response: () => Promise<boolean> = async () => true;
mock.module("../../../ws.js", () => ({
  sendUserMessage: (text: string, selection: unknown, _images: unknown, _annotations: unknown, files: unknown) => {
    sent.push({ text, selection, files });
    return response();
  },
  sendSteerMessage: () => Promise.resolve(false), sendInterrupt: () => {}, sendSetModel: () => {}, sendViewerNotification: () => false,
}));

const [{ act, createElement }, { createRoot }, { useStore }, { default: ChatInput }, { createChatFeedback }, { default: i18n }, { initReactI18next }, { default: inputStrings }] = await Promise.all([
  import("react"), import("react-dom/client"), import("../../../store.js"), import("../../ChatInput.js"), import("../../../collaboration/forward-to-agent.js"), import("i18next"), import("react-i18next"), import("../../../i18n/locales/en/chat-input.json"),
]);
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { "chat-input": inputStrings } }, interpolation: { escapeValue: false } });
useStore.setState({ sessionId: "session-a", cliConnected: true, connectionStatus: "disconnected", sessionStatus: "running", turnInProgress: false, session: null, selection: null, annotations: [], composerInsertion: null, collaborationFeedback: [], collaborationFeedbackFocus: 0, pendingMessages: [] });
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => root.render(createElement(ChatInput)));
const textarea = () => host.querySelector("textarea")!;
const updateText = async (text: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), text);
    textarea().dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  });
};
const submit = async () => {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event); });
};
const feedback = (body: string, id = "message") => createChatFeedback({ sessionId: useStore.getState().sessionId!, projectId: "project", contentSet: "en-dark", room: { id: "room", title: "Landing page", mode: "webcraft", ownerId: "owner", workspaceId: "workspace", enabled: true, revision: 8, page: "index.html", updatedAt: 0 }, message: { id, roomId: "room", authorId: "guest", authorName: "Guest", body, createdAt: 4 } });
const stage = async (body: string, id?: string) => { await act(async () => { useStore.getState().stageCollaborationFeedback(feedback(body, id)); }); };
const pasteFile = async (body: string) => {
  await act(async () => {
    const event = new win.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items: [], getData: () => body.repeat(600) } });
    textarea().dispatchEvent(event as unknown as Event);
  });
};

// Staging must preserve the editable draft, selection and file attachments.
await updateText("Please simplify the header");
await pasteFile("a");
const selection = { file: "en-dark/index.html", type: "heading" as const, content: "Header" };
await act(async () => useStore.getState().setSelection(selection));
await stage("Use less text");
expect(sent).toHaveLength(0);
expect(useStore.getState().pendingMessages).toHaveLength(0);
expect(textarea().value).toBe("Please simplify the header");
expect(host.querySelectorAll("article")).toHaveLength(1);
expect(host.querySelectorAll('[title="Remove"]')).toHaveLength(1);
expect(useStore.getState().selection).toBe(selection);
expect(document.activeElement).toBe(textarea());

// Updating a staged snapshot and editing text while send resolves must survive;
// a second submit while this request is pending must not duplicate delivery.
let finish!: (value: boolean) => void;
response = () => new Promise<boolean>((resolve) => { finish = resolve; });
await submit();
await submit();
expect(sent).toHaveLength(1);
expect(sent[0].text).toContain("Use less text");
expect(sent[0].text).toEndWith("User instructions:\nPlease simplify the header");
expect(sent[0].selection).toBe(selection);
expect(Array.isArray(sent[0].files)).toBe(true);
await updateText("Keep the footer too");
await pasteFile("b");
await stage("A newer request");
await act(async () => { finish(true); });
expect(textarea().value).toBe("Keep the footer too");
expect(useStore.getState().collaborationFeedback[0].messages[0].body).toBe("A newer request");
expect(host.querySelectorAll('[title="Remove"]')).toHaveLength(1);

// False and rejected delivery retain context and draft, and show an error.
response = async () => false;
await submit();
expect(host.querySelector('[role="alert"]')?.textContent).toContain("not sent");
expect(textarea().value).toBe("Keep the footer too");
expect(useStore.getState().collaborationFeedback).toHaveLength(1);
response = async () => { throw new Error("Enrichment unavailable"); };
await submit();
expect(host.querySelector('[role="alert"]')?.textContent).toBe("Enrichment unavailable");
expect(useStore.getState().collaborationFeedback).toHaveLength(1);

// Queueing transfers the quoted context and instructions together on explicit
// submission, even when there is no typed text.
await updateText("");
await act(async () => useStore.getState().setTurnInProgress(true));
const beforeQueue = sent.length;
await submit();
expect(sent).toHaveLength(beforeQueue);
const queued = useStore.getState().pendingMessages[0];
expect(queued.kind).toBe("user");
if (queued.kind !== "user") throw new Error("Expected user payload");
expect(queued.text).toContain("A newer request");
expect(queued.text).toEndWith("User instructions:\nPlease address this feedback in the workspace.");
expect(queued.collaborationFeedback?.[0].messages[0].authorName).toBe("Guest");
expect(useStore.getState().collaborationFeedback).toHaveLength(0);

// Feedback-only direct send clears only after confirmed transport delivery.
await act(async () => { useStore.setState({ pendingMessages: [], turnInProgress: false }); });
response = async () => true;
await stage("Make the title larger");
await submit();
expect(sent.at(-1)?.text).toContain("Make the title larger");
expect(useStore.getState().collaborationFeedback).toHaveLength(0);

// Late completion from a previous session must not consume the next session's
// attachments, and detached cards can be removed without a send.
response = () => new Promise<boolean>((resolve) => { finish = resolve; });
await stage("Old session request");
await submit();
await act(async () => useStore.getState().setSessionId("session-b"));
await stage("New session request");
await act(async () => { finish(true); });
expect(useStore.getState().collaborationFeedback[0].messages[0].body).toBe("New session request");
const beforeRemove = sent.length;
await act(async () => { (host.querySelector('[aria-label="Remove collaboration feedback"]') as HTMLButtonElement).click(); });
expect(useStore.getState().collaborationFeedback).toHaveLength(0);
expect(sent).toHaveLength(beforeRemove);

// A broken optional image falls back to the same readable text reference.
const withPreview = feedback("Preview fallback");
withPreview.preview = { label: "Selected heading", thumbnail: "data:image/png;base64,YQ==" };
await act(async () => useStore.getState().stageCollaborationFeedback(withPreview));
const image = host.querySelector("article img");
expect(image).not.toBeNull();
await act(async () => { image!.dispatchEvent(new win.Event("error") as unknown as Event); });
expect(host.querySelector("article img")).toBeNull();
expect(host.querySelector("article")?.textContent).toContain("Selected heading");
expect(host.querySelector("article")?.textContent).toContain("Preview fallback");

await act(async () => root.unmount());
host.remove();
await win.happyDOM.close();
process.stdout.write("composer feedback flow passed\n");
