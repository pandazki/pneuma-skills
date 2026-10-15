import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InternetAccessPanel } from "../InternetAccessPanel.js";
import { EntryLink } from "../EntryLink.js";
import type { SessionCollaborationStatus } from "../../../core/types/collaboration-session.js";

let root: Root; let win: Window; let restore: () => void;
beforeEach(() => {
  win = new Window({ url: "http://localhost/?session=fixture" });
  const globals = globalThis as unknown as Record<string, unknown>; const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) { saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key]; }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await win.happyDOM.close(); restore(); });
function button(text: string) { return [...win.document.querySelectorAll("button")].find((button) => button.textContent === text)!; }
function status(phase: NonNullable<SessionCollaborationStatus["internetAccess"]>["status"] = "off"): SessionCollaborationStatus {
  return { projectAvailable: true, supported: true, sharing: true, publisherStatus: "Sharing", connection: { projectId: "project-a", workspaceId: "workspace-a", ownerId: "owner", token: "private-member", authorityBaseUrl: "http://192.0.2.1/projects/project-a", authorityKind: "lan" }, canManageInternetAccess: true,
    internetAccess: { status: phase, provider: { kind: "quick" }, publicOrigin: phase === "active" ? "https://temporary.example" : null, publicClients: 0, idleDeadline: Date.now() + 600000, idleTimeoutMs: 600000 } };
}

describe("private public access controls", () => {
  test("free temporary access is the default command and the runtime owns the displayed state", async () => {
    const commands: unknown[] = []; const command = async (path: string, body?: unknown) => { commands.push({ path, body }); };
    await act(async () => root.render(<InternetAccessPanel status={status()} pending={false} command={command}/>));
    expect(button("Free temporary address").getAttribute("aria-pressed")).toBe("true");
    const options = [...win.document.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Connection options")!;
    expect(options).toBeDefined(); expect(options.open).toBe(false);
    expect(commands).toEqual([]);
    await act(async () => button("Enable public access").click());
    expect(commands).toEqual([{ path: "internet-access", body: { enabled: true, provider: { kind: "quick" } } }]);
    // A successful HTTP request does not imply runtime cleanup or startup completion.
    expect(win.document.querySelector('[role="status"]')?.textContent).toBe("Off");
    await act(async () => root.render(<InternetAccessPanel status={status("stopping")} pending={false} command={command}/>));
    expect(button("Stopping public access…").disabled).toBe(true);
    expect(win.document.body.textContent).toContain("Stopping…");
  });
  test("named Tunnel configuration remains explicit when custom access fails", async () => {
    const commands: unknown[] = []; const command = async (_path: string, body?: unknown) => { commands.push(body); };
    await act(async () => root.render(<InternetAccessPanel status={status()} pending={false} command={command}/>));
    await act(async () => button("Your own Tunnel").click());
    expect(button("Enable public access").disabled).toBe(true);
    expect(win.document.querySelector("details")?.open).toBe(true);
    const inputs = win.document.querySelectorAll("input");
    const values = ["https://fixed.example", "11111111-2222-3333-4444-555555555555", "/private/tunnel.json"];
    await act(async () => { inputs.forEach((input, index) => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(input, values[index]); input.dispatchEvent(new win.Event("input", { bubbles: true })); }); });
    // React's value tracker listens to change in this lightweight DOM.
    await act(async () => { inputs.forEach((input) => input.dispatchEvent(new win.Event("change", { bubbles: true }))); });
    const failed = status("failed"); failed.internetAccess!.error = "Named Tunnel could not start.";
    await act(async () => root.render(<InternetAccessPanel status={failed} pending={false} command={command}/>));
    expect(win.document.body.textContent).toContain("Named Tunnel could not start.");
    expect(button("Your own Tunnel").getAttribute("aria-pressed")).toBe("true");
    expect(commands).toEqual([]);
    expect(button("Enable public access")).toBeUndefined();
    await act(async () => button("Retry stopping public access").click());
    expect(commands).toEqual([{ enabled: false }]);
    expect(win.document.body.textContent).toContain("hostname already routed to that Tunnel");
  });
  test("failure recovery remains visible with options closed and only explicit recovery sends a command", async () => {
    const failed = status("failed"); failed.internetAccess!.error = "Stop did not finish.";
    const commands: unknown[] = [];
    await act(async () => root.render(<InternetAccessPanel status={failed} pending={false} command={async (_path, body) => { commands.push(body); }}/>));
    const options = win.document.querySelector("details")!;
    expect(options.open).toBe(false);
    expect(win.document.querySelector('[role="alert"]')?.closest("details")).toBeNull();
    expect(button("Retry stopping public access").closest("details")).toBeNull();
    expect(commands).toEqual([]);
    await act(async () => options.querySelector("summary")!.click());
    expect(commands).toEqual([]);
    await act(async () => button("Retry stopping public access").click());
    expect(commands).toEqual([{ enabled: false }]);
  });
  test("incomplete persisted named settings open for completion without enabling access", async () => {
    const incomplete = status(); incomplete.internetAccess!.provider = { kind: "named", tunnelId: "saved-id", credentialsFile: "", publicOrigin: "https://fixed.example" };
    const commands: unknown[] = [];
    await act(async () => root.render(<InternetAccessPanel status={incomplete} pending={false} command={async (_path, body) => { commands.push(body); }}/>));
    expect(win.document.querySelector("details")?.open).toBe(true);
    expect(button("Enable public access").disabled).toBe(true);
    expect(win.document.querySelectorAll("input")[1]!.value).toBe("saved-id");
    expect(commands).toEqual([]);
  });
  test("persisted named settings survive reload, failed startup, and idle expiry", async () => {
    const named = status(); named.internetAccess!.provider = { kind: "named", tunnelId: "11111111-2222-3333-4444-555555555555", credentialsFile: "/private/tunnel.json", publicOrigin: "https://fixed.example" };
    const commands: unknown[] = []; const command = async (_path: string, body?: unknown) => { commands.push(body); };
    await act(async () => root.render(<InternetAccessPanel status={named} pending={false} command={command}/>));
    expect(button("Your own Tunnel").getAttribute("aria-pressed")).toBe("true");
    expect(win.document.querySelectorAll("input")[0]!.value).toBe("https://fixed.example");
    expect(win.document.querySelector("details")?.open).toBe(false);
    for (const phase of ["failed", "idleexpired"] as const) {
      named.internetAccess!.status = phase;
      await act(async () => root.render(<InternetAccessPanel status={{ ...named }} pending={false} command={command}/>));
      expect(button("Your own Tunnel").getAttribute("aria-pressed")).toBe("true");
    }
    await act(async () => button("Enable public access").click());
    expect(commands).toEqual([{ enabled: true, provider: named.internetAccess!.provider }]);
  });
  test("attached members and cloud authorities have no host-machine access controls", async () => {
    const remote = status(); remote.canManageInternetAccess = false;
    await act(async () => root.render(<InternetAccessPanel status={remote} pending={false} command={async () => { throw new Error("Must not be called"); }}/>));
    expect(win.document.querySelectorAll("button")).toHaveLength(0);
    expect(win.document.body.textContent).toContain("host machine controls public access");
    const cloud = status(); cloud.connection!.authorityKind = "cloud";
    await act(async () => root.render(<InternetAccessPanel status={cloud} pending={false} command={async () => {}}/>));
    expect(win.document.querySelectorAll("button")).toHaveLength(0);
    expect(win.document.body.textContent).toContain("cloud authority");
  });
  test("active public Project URL contains no credential and supports manual copy on plain HTTP", async () => {
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: undefined });
    const active = status("active");
    await act(async () => root.render(<InternetAccessPanel status={active} pending={false} command={async () => {}}/>));
    expect(win.document.querySelector("details")?.open).toBe(false);
    const input = win.document.querySelector('input[aria-label="Public Project URL"]')! as unknown as HTMLInputElement;
    expect(input.value).toBe("https://temporary.example/projects/project-a");
    expect(input.closest("details")?.textContent).toContain("New members need an invitation from Share");
    expect(input.value).not.toContain(active.connection!.token); expect(new URL(input.value).hash).toBe("");
    await act(async () => button("Copy Project URL").click());
    expect(win.document.querySelector('[role="alert"]')?.textContent).toBe("Copy failed. Select the Project URL and copy it manually.");
    expect(button("Copied Project URL")).toBeUndefined();
    await act(async () => input.focus()); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(input.value.length);
    const moved = status("active"); moved.internetAccess!.publicOrigin = "https://reopened.example";
    await act(async () => root.render(<InternetAccessPanel status={moved} pending={false} command={async () => {}}/>));
    expect(input.value).toBe("https://reopened.example/projects/project-a");
    expect(win.document.querySelector('[role="alert"]')).toBeNull();
  });
  test("active access reports authenticated public participants and the runtime idle deadline", async () => {
    const active = status("active"); active.internetAccess!.idleDeadline = Date.now() + 90000;
    await act(async () => root.render(<InternetAccessPanel status={active} pending={false} command={async () => {}}/>));
    expect(win.document.body.textContent).toContain("0 public participants"); expect(win.document.body.textContent).toContain("Stops in 1:30");
    expect(win.document.body.textContent).toContain("Temporary addresses change each time");
    expect(button("Stop public access")).toBeDefined();
  });
});

describe("same-authority share entry picker", () => {
  test("plain HTTP without the Clipboard API offers manual copy and keeps the link selectable", async () => {
    Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: undefined });
    await act(async () => root.render(<EntryLink token="member-token" entries={[{ kind: "lan", baseUrl: "http://192.0.2.1/projects/project-a" }]}/>));
    await act(async () => button("Copy link").click());
    expect(win.document.querySelector('[role="alert"]')?.textContent).toBe("Copy failed. Select the link and copy it manually.");
    expect(button("Copied")).toBeUndefined();
    const input = win.document.querySelector("input")!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe("http://192.0.2.1/projects/project-a#token=member-token");
    await act(async () => input.focus());
    expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(input.value.length);
  });
  test("switching LAN/public changes only entry origin and preserves room and invitation permissions", async () => {
    await act(async () => root.render(<EntryLink token="guest-permission-token" invitation roomId="room-a" entries={[{ kind: "lan", baseUrl: "http://192.0.2.1:4000/projects/project-a" }, { kind: "public", baseUrl: "https://temporary.example/projects/project-a" }]}/>));
    let url = new URL(win.document.querySelector("input")!.value); expect(url.origin).toBe("https://temporary.example");
    expect(new URLSearchParams(url.hash.slice(1)).get("invite")).toBe("guest-permission-token");
    await act(async () => button("Local network").click());
    url = new URL(win.document.querySelector("input")!.value); expect(url.origin).toBe("http://192.0.2.1:4000");
    expect(url.pathname).toBe("/projects/project-a"); expect(new URLSearchParams(url.hash.slice(1)).get("room")).toBe("room-a"); expect(new URLSearchParams(url.hash.slice(1)).get("invite")).toBe("guest-permission-token");
    expect(new URLSearchParams(url.hash.slice(1)).has("token")).toBe(false);
  });
  test("a removed temporary entry no longer offers a stale public link", async () => {
    await act(async () => root.render(<EntryLink token="member-token" entries={[{ kind: "lan", baseUrl: "http://192.0.2.1/projects/project-a" }]}/>));
    expect(button("Internet")).toBeUndefined(); expect(win.document.querySelector("input")!.value).toContain("http://192.0.2.1/projects/project-a#token=member-token");
  });
});
