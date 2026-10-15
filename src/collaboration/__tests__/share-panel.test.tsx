import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CollaborationRoom } from "../../../core/types/collaboration.js";
import { SharePanel } from "../App.js";
import { EntryLink } from "../EntryLink.js";
import type { useCollaboration } from "../use-collaboration.js";

let win: Window; let root: Root; let restore: () => void;
const room: CollaborationRoom = { id: "room/a", title: "Shared site", mode: "webcraft", ownerId: "owner", enabled: true, revision: 1, page: "index.html", updatedAt: 1 };
beforeEach(() => {
  win = new Window({ url: "http://localhost/" });
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await win.happyDOM.close(); restore(); });
function button(label: string) { return [...win.document.querySelectorAll("button")].find((element) => element.textContent === label)!; }
function disclosure(label: string) { return [...win.document.querySelectorAll("details")].find((element) => element.querySelector("summary")?.textContent?.startsWith(label))!; }
function client(cloud = true, fail = false) {
  const requests: { path: string; options: { method: string; body?: { access: string; expiresInSeconds: number } } }[] = [];
  return { requests, value: { baseUrl: "https://authority.example/projects/project", project: { publicOrigin: cloud ? "https://authority.example" : undefined }, request: async (path: string, options: typeof requests[number]["options"]) => {
    requests.push({ path, options });
    if (fail) throw new Error("Sharing could not be updated.");
    return { token: "guest-secret", access: options.body?.access, expiresAt: Date.now() + (options.body?.expiresInSeconds || 0) * 1000 };
  } } as unknown as ReturnType<typeof useCollaboration> };
}

describe("invitation creation and management", () => {
  test("opening controls grants nothing; explicit creation retains view-only and one-hour defaults", async () => {
    const fixture = client();
    await act(async () => root.render(<SharePanel client={fixture.value} room={room}/>));
    expect(fixture.requests).toEqual([]);
    expect(button("View only").getAttribute("aria-pressed")).toBe("true");
    expect(disclosure("Link options").open).toBe(false);
    expect(disclosure("Link options").querySelector("summary")?.textContent).toContain("1 hour");
    expect(disclosure("Manage links").open).toBe(false);
    await act(async () => button("Create invitation").click());
    expect(fixture.requests).toEqual([{ path: "/api/rooms/room%2Fa/links", options: { method: "POST", body: { expiresInSeconds: 3600, access: "view" } } }]);
    const url = new URL(win.document.querySelector("input")!.value);
    expect(url.hash).toContain("invite=guest-secret"); expect(url.hash).not.toContain("token=");
    expect(win.document.querySelector(".share-link-facts")?.textContent).toContain("View only · Expires");
  });
  test("permission and expiry choices only apply when an invitation is created", async () => {
    const fixture = client();
    await act(async () => root.render(<SharePanel client={fixture.value} room={room}/>));
    await act(async () => { button("Comment & chat").click(); disclosure("Link options").open = true; button("24 hours").click(); });
    expect(fixture.requests).toEqual([]);
    await act(async () => button("Create invitation").click());
    expect(fixture.requests[0]!.options.body).toEqual({ expiresInSeconds: 86400, access: "comment" });
    expect(win.document.querySelector(".share-link-facts")?.textContent).toContain("Comment & chat · Expires");
    await act(async () => { button("View only").click(); button("15 minutes").click(); });
    expect(win.document.querySelector(".share-link-facts")?.textContent).toContain("Comment & chat · Expires");
    expect(fixture.requests).toHaveLength(1);
  });
  test("local invitations remain view only and a disabled room cannot create one", async () => {
    const fixture = client(false);
    await act(async () => root.render(<SharePanel client={fixture.value} room={{ ...room, enabled: false }}/>));
    expect(button("Comment & chat")).toBeUndefined(); expect(button("Create invitation").disabled).toBe(true);
    await act(async () => button("Create invitation").click()); expect(fixture.requests).toEqual([]);
    await act(async () => root.render(<SharePanel client={fixture.value} room={room}/>));
    await act(async () => button("Create invitation").click());
    expect(fixture.requests[0]!.options.body).toEqual({ expiresInSeconds: 3600, access: "view" });
    expect(new URL(win.document.querySelector("input")!.value).hash).toContain("token=guest-secret");
  });
  test("revocation remains explicit inside Manage links and reports success only after the request", async () => {
    const fixture = client();
    await act(async () => root.render(<SharePanel client={fixture.value} room={room}/>));
    await act(async () => button("Create invitation").click());
    await act(async () => { disclosure("Manage links").open = true; });
    expect(fixture.requests).toHaveLength(1);
    await act(async () => button("Revoke all guest links").click());
    expect(fixture.requests[1]).toEqual({ path: "/api/rooms/room%2Fa/links", options: { method: "DELETE" } });
    expect(win.document.querySelector("input")).toBeNull();
    expect(win.document.querySelector('[role="status"]')?.textContent).toContain("revoked");
  });
  test("failed sharing requests remain visible without reporting success", async () => {
    const fixture = client(true, true);
    await act(async () => root.render(<SharePanel client={fixture.value} room={room}/>));
    await act(async () => button("Create invitation").click());
    expect(win.document.querySelector('[role="alert"]')?.textContent).toBe("Sharing could not be updated.");
    expect(win.document.querySelector("input")).toBeNull();
    await act(async () => button("Revoke all guest links").click());
    expect(win.document.querySelector('[role="status"]')).toBeNull();
  });
});

describe("invitation clipboard feedback", () => {
  test("clipboard failure offers manual copying and clears when the actual URL changes", async () => {
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Denied"); } } });
    const entries = [{ kind: "lan" as const, baseUrl: "http://192.0.2.1/projects/project" }, { kind: "public" as const, baseUrl: "https://public.example/projects/project" }];
    await act(async () => root.render(<EntryLink token="guest-secret" roomId="room" invitation entries={entries}/>));
    await act(async () => button("Copy link").click());
    expect(win.document.querySelector('[role="alert"]')?.textContent).toContain("copy it manually");
    expect(button("Copied")).toBeUndefined();
    const input = win.document.querySelector("input")!; await act(async () => input.focus());
    expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(input.value.length);
    await act(async () => button("Local network").click());
    expect(win.document.querySelector('[role="alert"]')).toBeNull();
    expect(input.value).toContain("http://192.0.2.1/projects/project#invite=guest-secret&room=room");
  });
  test("a successful copy applies only to that URL, including entry changes from the server", async () => {
    let finish: (() => void) | undefined;
    const copied: string[] = [];
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText: (url: string) => { copied.push(url); return new Promise<void>((resolve) => { finish = resolve; }); } } });
    await act(async () => root.render(<EntryLink token="guest" fallback="https://first.example"/>));
    await act(async () => button("Copy link").click());
    expect(button("Copied")).toBeUndefined();
    await act(async () => { finish!(); }); expect(button("Copied")).toBeDefined();
    await act(async () => root.render(<EntryLink token="guest" fallback="https://second.example"/>));
    expect(button("Copied")).toBeUndefined();
    await act(async () => button("Copy link").click());
    await act(async () => root.render(<EntryLink token="replacement" fallback="https://third.example"/>));
    await act(async () => { finish!(); });
    expect(button("Copied")).toBeUndefined();
    expect(copied).toEqual(["https://first.example/#token=guest", "https://second.example/#token=guest"]);
  });
});
