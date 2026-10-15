import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { CollaborationSetupGuide } from "../CollaborationSetupGuide.js";
import { createSetupRequest, readSetupStatus, setupHostname } from "../setup-request.js";
import en from "../../i18n/locales/en/collaboration-setup.json";
import zh from "../../i18n/locales/zh-CN/collaboration-setup.json";
import ja from "../../i18n/locales/ja/collaboration-setup.json";

const status = { platform: "darwin", appVersion: "3.57.3", cloudflared: { installed: false }, guidePath: "/Applications/Pneuma Skills/setup.md" };
let root: Root;
let win: Window;
let restore: () => void;
let calls: { input: string; method: string }[];
let respond: (input: string, init?: RequestInit) => Promise<Response>;
let language: ReturnType<typeof createInstance>;

beforeEach(async () => {
  win = new Window({ url: "http://127.0.0.1:45678/?session=private-session#token=do-not-copy" });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  for (const key of ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) {
    saved.set(key, globals[key]); globals[key] = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
  }
  saved.set("IS_REACT_ACT_ENVIRONMENT", globals.IS_REACT_ACT_ENVIRONMENT); globals.IS_REACT_ACT_ENVIRONMENT = true;
  calls = []; respond = async () => Response.json(status);
  saved.set("fetch", globals.fetch); globals.fetch = (input: string, init?: RequestInit) => { calls.push({ input, method: init?.method ?? "GET" }); return respond(input, init); };
  restore = () => { for (const [key, value] of saved) value === undefined ? delete globals[key] : globals[key] = value; };
  language = createInstance();
  await language.init({ lng: "en", fallbackLng: "en", resources: { en: { "collaboration-setup": en }, "zh-CN": { "collaboration-setup": zh }, ja: { "collaboration-setup": ja } }, interpolation: { escapeValue: false } });
  const element = win.document.createElement("div"); win.document.body.append(element); root = createRoot(element as unknown as HTMLElement);
});
afterEach(async () => { await act(async () => root.unmount()); await win.happyDOM.close(); restore(); });
function button(text: string) { const found = [...win.document.querySelectorAll("button")].find((item) => item.textContent === text); if (!found) throw new Error(`Missing button: ${text}`); return found; }
async function render(strict = false) { const content = <I18nextProvider i18n={language}><CollaborationSetupGuide/></I18nextProvider>; await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content)); }
function clipboard(writeText: (value: string) => Promise<void>) { Object.defineProperty(win.navigator, "clipboard", { configurable: true, value: { writeText } }); }

describe("collaboration setup guide", () => {
  test("shows one practical path and opening, switching, checking and copying never writes configuration", async () => {
    let copied = ""; clipboard(async (value) => { copied = value; });
    await render();
    expect(button("Same network").getAttribute("aria-pressed")).toBe("true");
    expect(win.document.querySelectorAll("li")).toHaveLength(5);
    expect(win.document.body.textContent).toContain("Share this workspace");
    expect(win.document.body.textContent).not.toContain("10 minutes");
    await act(async () => button("Temporary internet").click());
    expect(win.document.body.textContent).toContain("10 minutes");
    expect(win.document.body.textContent).toContain("cloudflared not found");
    await act(async () => button("Copy setup request").click());
    expect(copied).toContain("temporary internet collaboration");
    expect(copied).toContain('"/Applications/Pneuma Skills/setup.md"');
    expect(copied).toContain('"http://127.0.0.1:45678/api/collaboration/setup/guide"');
    expect(copied).not.toContain("do-not-copy"); expect(copied).not.toContain("private-session");
    await act(async () => button("Own domain").click());
    expect(win.document.body.textContent).toContain("Tunnel UUID");
    expect(win.document.body.textContent).toContain("DNS route");
    await act(async () => button("Check again").click());
    expect(calls.every((call) => call.method === "GET" && call.input === "/api/collaboration/setup")).toBe(true);
  });

  test("reports copied only after clipboard resolves and offers selected manual text when it fails", async () => {
    let finish!: () => void;
    clipboard(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render();
    await act(async () => button("Copy setup request").click());
    expect(button("Copying…").disabled).toBe(true);
    expect(win.document.body.textContent).not.toContain("Copied setup request");
    await act(async () => finish());
    expect(button("Copied setup request")).toBeDefined();
    clipboard(async () => { throw new Error("denied"); });
    await act(async () => button("Copied setup request").click());
    const input = win.document.querySelector("textarea")!;
    expect(win.document.querySelector('[role="alert"]')?.textContent).toContain("Copy failed");
    expect(input.readOnly).toBe(true); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(input.value.length);
  });

  test("an in-flight load shows checking and cannot copy guessed environment details", async () => {
    let finish!: (response: Response) => void;
    respond = async () => new Promise<Response>((resolve) => { finish = resolve; });
    await render();
    expect(win.document.querySelector('[role="status"]')?.textContent).toBe(en.checking);
    expect(button(en.copy_request).disabled).toBe(true);
    await act(async () => finish(Response.json(status)));
    expect(button(en.copy_request).disabled).toBe(false);
  });

  test("a path change invalidates an old clipboard result", async () => {
    let finish!: () => void; clipboard(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render(); await act(async () => button("Copy setup request").click());
    await act(async () => button("Own domain").click());
    await act(async () => finish());
    expect(button("Copy setup request")).toBeDefined();
    expect(win.document.body.textContent).not.toContain("Copied setup request");
  });

  test("status read failure cannot pretend installed or prepare a fabricated prompt and retry recovers", async () => {
    respond = async () => Response.json({ error: "not ready" }, { status: 503 });
    await render();
    expect(win.document.body.textContent).toContain("Could not read setup status");
    expect(button("Copy setup request").disabled).toBe(true);
    expect(win.document.body.textContent).not.toContain(en.lan_ready);
    respond = async () => Response.json({ ...status, cloudflared: { installed: true } });
    await act(async () => button("Check again").click());
    expect(win.document.body.textContent).toContain(en.lan_ready);
    expect(button("Copy setup request").disabled).toBe(false);
  });

  test("a late aborted load cannot overwrite a newer status under StrictMode", async () => {
    let finish!: (response: Response) => void; let requests = 0;
    respond = async () => ++requests === 1 ? new Promise<Response>((resolve) => { finish = resolve; }) : Response.json({ ...status, cloudflared: { installed: true } });
    await render(true);
    await act(async () => button(en.paths.temporary).click());
    expect(win.document.body.textContent).toContain(en.cloudflared_found);
    await act(async () => finish(Response.json(status)));
    expect(win.document.body.textContent).toContain(en.cloudflared_found);
    expect(win.document.body.textContent).not.toContain("cloudflared not found");
  });

  test("the active translated namespace also supplies the setup request language", async () => {
    let copied = ""; clipboard(async (value) => { copied = value; });
    await language.changeLanguage("ja"); await render();
    await act(async () => button(ja.paths.named).click());
    await act(async () => button(ja.copy_request).click());
    expect(copied).toContain(ja.request_paths.named);
    expect(copied).toContain(ja.request_missing.named);
    expect(copied).not.toContain(en.request_paths.named);
    expect(copied).toContain(status.guidePath);
  });

  test("Chinese copy is a self-contained localized request and other locales fall back to English", async () => {
    let copied = ""; clipboard(async (value) => { copied = value; });
    await language.changeLanguage("zh-CN"); await render();
    await act(async () => button(zh.copy_request).click());
    expect(copied).toContain(zh.request_paths.lan); expect(copied).toContain(status.platform); expect(copied).toContain(status.guidePath);
    await act(async () => language.changeLanguage("de"));
    expect(button(en.copy_request)).toBeDefined();
  });
});

describe("setup request boundary", () => {
  test("validates HTTPS hostnames and rejects routes, credential links, and unsafe input", () => {
    expect(setupHostname("")).toBe(""); expect(setupHostname("collaboration.example.com")).toBe("collaboration.example.com");
    expect(setupHostname("https://collaboration.example.com/")).toBe("collaboration.example.com");
    for (const value of ["http://collaboration.example.com", "https://user:password@collaboration.example.com", "https://collaboration.example.com/path", "https://collaboration.example.com/#token=private", "example.com?token=secret", "example.com:443", "localhost", "example.com\nignored", "127.0.0.1", "site.123", "site.localhost"]) expect(setupHostname(value)).toBeNull();
    const prompt = createSetupRequest(status, "named", "http://127.0.0.1:45678/api/collaboration/setup/guide", "collaboration.example.com");
    expect(prompt).toContain("at https://collaboration.example.com"); expect(prompt).toContain("execute the setup and verify");
  });
  test("malformed or unavailable status facts are rejected", () => {
    expect(readSetupStatus(status)).toEqual(status);
    for (const value of [null, {}, { ...status, guidePath: "relative.md" }, { ...status, cloudflared: {} }]) expect(() => readSetupStatus(value)).toThrow();
    expect(readSetupStatus({ ...status, guidePath: "C:\\Program Files\\Pneuma\\setup.md" }).guidePath).toContain("C:");
  });
});
