/** @jsxImportSource react */
/**
 * The sticker viewer mounted whole (happy-dom) on fixture packs:
 *
 * - every state is drawn: no pack, an invalid pack, an unreadable project,
 *   and each sticker status with its reason (a failure says whether it may
 *   have been billed);
 * - read-only (`editing === false`) draws no field, no pick, no command and
 *   still plays; with editing on, a pick and a field write pack.json through
 *   the source and a command reaches the agent;
 * - `navigate-to`, `set-view` and locator navigation answer with what is on
 *   screen, and refuse unknown stickers / frames by name;
 * - nothing calls `fetch` (happy-dom has no ImageDecoder, so the frame strip
 *   says so instead of decoding — the path a browser without WebCodecs takes).
 *
 * Harness shape follows `modes/anime-series/__tests__/viewer.test.tsx`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { MemorySource } from "../../../core/sources/memory.js";
import type { ViewerActionRequest, ViewerActionResult, ViewerLocator, ViewerNotification, ViewerPreviewProps, ViewerSelectionContext } from "../../../core/types/viewer-contract.js";
import { findSticker, loadPack, type StickerPack } from "../domain.js";
import manifest from "../manifest.js";
import { filesOf, richWorkspace } from "./pack-workspace.js";

let win: Window;
let restore: () => void;
const fetchCalls: string[] = [];

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const w = win as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLMediaElement",
    "HTMLVideoElement",
    "Element",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
  ]) {
    saved[key] = g[key];
    g[key] = key === "window" ? win : w[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  saved.fetch = g.fetch;
  g.fetch = ((input: unknown) => {
    fetchCalls.push(String(input));
    return Promise.reject(new Error("the viewer must not fetch"));
  }) as typeof fetch;
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Mounted {
  host: HTMLElement;
  results: Array<{ id: string; result: ViewerActionResult }>;
  navigations: Array<ViewerActionResult | undefined>;
  writes: StickerPack[];
  notes: ViewerNotification[];
  selections: Array<ViewerSelectionContext | null>;
  request: (req: ViewerActionRequest) => Promise<void>;
  locate: (address: Record<string, unknown>) => Promise<void>;
  click: (el: Element | null | undefined) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  q: (selector: string) => Element | null;
  all: (selector: string) => Element[];
  unmount: () => Promise<void>;
}

async function mount(value: StickerPack, extra: Partial<ViewerPreviewProps> = {}): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: Preview } = await import("../viewer/StickerPreview.js");
  const source = new MemorySource<StickerPack>({ initial: value });
  const writes: StickerPack[] = [];
  const write = source.write.bind(source);
  source.write = async (next: StickerPack) => {
    writes.push(next);
    return write(next);
  };
  const host = document.createElement("div");
  host.style.height = "900px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const results: Mounted["results"] = [];
  const navigations: Mounted["navigations"] = [];
  const notes: ViewerNotification[] = [];
  const selections: Mounted["selections"] = [];
  let props: ViewerPreviewProps = {
    sources: { pack: source },
    fileChannel: {} as ViewerPreviewProps["fileChannel"],
    selection: null,
    onSelect: (s) => selections.push(s),
    mode: "view",
    imageVersion: 0,
    editing: false,
    readonly: false,
    theme: "dark",
    locale: "en",
    commands: manifest.viewerApi!.commands,
    onActionResult: (id, result) => results.push({ id, result }),
    onNavigateComplete: (result) => navigations.push(result),
    ...extra,
  };
  const render = async (next: ViewerPreviewProps) => {
    props = next;
    await act(async () => {
      root.render(createElement(Preview, props));
      await sleep(0);
    });
  };
  await render(props);
  return {
    host,
    results,
    navigations,
    writes,
    notes,
    selections,
    request: (actionRequest) => render({ ...props, actionRequest }),
    locate: (address) => render({ ...props, navigateRequest: { label: "test", address } as ViewerLocator }),
    click: async (el) => {
      expect(el).toBeTruthy();
      await act(async () => {
        (el as HTMLElement).click();
        await sleep(0);
      });
    },
    wait: async (ms) => {
      await act(async () => {
        await sleep(ms);
      });
    },
    q: (selector) => host.querySelector(selector),
    all: (selector) => Array.from(host.querySelectorAll(selector)),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
      source.destroy();
    },
  };
}

const rich = () => loadPack(richWorkspace().files);

describe("states", () => {
  test("no pack, an invalid pack, an unreadable project", async () => {
    const empty = await mount(loadPack([]));
    expect(empty.host.textContent).toContain("No sticker pack yet");
    await empty.unmount();

    const invalid = await mount(loadPack([{ path: "pack.json", content: '{ "version": 2, "platforms": [], "stickers": [] }' }]));
    expect(invalid.host.textContent).toContain("pack.json can't be drawn");
    expect(invalid.q("[data-pack-errors]")?.textContent).toContain("version: must be 1 (got 2)");
    await invalid.unmount();

    const { files } = richWorkspace();
    const broken = await mount(loadPack([files[0], { path: "project.json", content: "{" }]));
    expect(broken.q("[data-project-error]")?.textContent).toContain("project.json can't be read (not valid JSON");
    expect(new Set(broken.all("[data-sticker]").map((c) => c.getAttribute("data-status")))).toEqual(new Set(["unknown"]));
    await broken.unmount();
  });

  test("each card carries its status; a failure says whether it may have been billed", async () => {
    const m = await mount(rich());
    const status = Object.fromEntries(m.all("[data-sticker]").map((c) => [c.getAttribute("data-sticker"), c.getAttribute("data-status")]));
    expect(status).toEqual({ s01: "ready", s02: "pick", s03: "stale", s04: "generating", s05: "failed", s06: "empty", s07: "ready", s08: "failed" });
    expect(m.q('[data-sticker="s02"]')?.textContent).toContain("2 takes to pick");
    expect(m.q('[data-sticker="s05"]')?.textContent).toContain("may have been billed");
    expect(m.q('[data-sticker="s08"]')?.textContent).toContain("not billed");
    expect(m.q("[data-next-step]")?.getAttribute("data-next-step")).toBe("generate");
    expect(m.q("[data-rights]")?.getAttribute("data-rights")).toBe("original");
    await m.unmount();
  });

  test("a stale sticker's inspector says why; a failed one names the failure and the billing", async () => {
    const m = await mount(rich());
    await m.click(m.q('[data-sticker="s03"]'));
    expect(m.q("[data-stale-headline]")?.textContent).toBe("Stale — re-roll to apply");
    expect(m.all("[data-stale-reason]").map((r) => r.textContent)).toEqual(["caption changed"]);
    await m.click(m.q('[data-sticker="s05"]'));
    const failure = m.q('[data-failure="s05-take-1"]')?.textContent ?? "";
    expect(failure).toContain("upstream error");
    expect(failure).toContain("May have been billed");
    expect(m.q("[data-stage]")?.getAttribute("data-stage-take")).toBe("s05-take-1");
    await m.unmount();
  });

  test("without ImageDecoder the frame strip says so instead of decoding", async () => {
    const m = await mount(rich());
    await m.click(m.q('[data-sticker="s01"]'));
    expect(m.q('[data-frames="unsupported"]')?.textContent).toContain("no ImageDecoder");
    await m.unmount();
  });

  test("Chinese and Japanese users get their own words", async () => {
    const zh = await mount(rich(), { locale: "zh" });
    expect(zh.q('[data-sticker="s06"]')?.textContent).toContain("还没出图");
    expect(zh.q('[data-sticker="s03"]')?.textContent).toContain("待重画");
    await zh.unmount();
    const ja = await mount(rich(), { locale: "ja" });
    expect(ja.q('[data-sticker="s02"]')?.textContent).toContain("2 テイクから選択");
    await ja.unmount();
  });
});

describe("read-only and editing", () => {
  test("editing === false: no field, no pick, no command — everything still plays", async () => {
    const m = await mount(rich(), { editing: false, onNotifyAgent: () => {} });
    expect(m.host.textContent).toContain("Read-only");
    expect(m.q("[data-command]")).toBeNull();
    await m.click(m.q('[data-sticker="s02"]'));
    expect(m.all("input, textarea")).toEqual([]);
    expect(m.q('[data-action="pick-take"]')).toBeNull();
    expect(m.all("[data-stage] img").length).toBe(1);
    await m.click(m.q('[data-segment="view:submit"]'));
    expect(m.q('[data-command="export-check"]')).toBeNull();
    expect(m.all("[data-listing] input, [data-listing] textarea")).toEqual([]);
    expect(m.writes).toEqual([]);
    await m.unmount();
  });

  test("editing: picking a take and editing a caption write pack.json through the source", async () => {
    const m = await mount(rich(), { editing: true, onNotifyAgent: (n) => m.notes.push(n) });
    await m.click(m.q('[data-sticker="s02"]'));
    await m.click(m.q('[data-take="s02-take-1"]'));
    await m.click(m.q('[data-action="pick-take"]'));
    expect(m.writes.length).toBe(1);
    expect(findSticker(m.writes[0], "s02")!.sticker.take).toBe("s02-take-1");
    expect(findSticker(m.writes[0], "s02")!.state.status).toBe("ready");

    const { act } = await import("react");
    const caption = m.q('[data-field="caption"]') as HTMLInputElement;
    await act(async () => {
      caption.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(caption), "value")!.set!;
      setter.call(caption, "不想上班了");
      caption.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
      caption.blur();
      await sleep(0);
    });
    expect(m.writes.length).toBe(2);
    expect(findSticker(m.writes[1], "s02")!.sticker.caption).toBe("不想上班了");
    expect(findSticker(m.writes[1], "s02")!.state.reasons).toEqual(["caption changed"]);
    await m.unmount();
  });

  test("a command reaches the agent with the stickers it is about", async () => {
    const notes: ViewerNotification[] = [];
    const m = await mount(rich(), { editing: true, onNotifyAgent: (n) => notes.push(n) });
    await m.click(m.q('[data-command="make-missing"]'));
    expect(notes.length).toBe(1);
    expect(notes[0].type).toBe("sticker-command:make-missing");
    expect(notes[0].message).toContain("stickers with no usable take: s05 (failed), s06 (empty), s08 (failed)");
    expect(notes[0].message).toContain("billing is unknown (may have been charged): s05-take-1");
    await m.click(m.q('[data-segment="view:submit"]'));
    await m.click(m.q('[data-segment="platform:line"]'));
    await m.click(m.q('[data-command="export-check"]'));
    expect(notes[1].type).toBe("sticker-command:export-check");
    expect(notes[1].message).toContain("platform: line");
    await m.unmount();
  });
});

describe("actions and navigation", () => {
  test("navigate-to answers with what is on screen; unknown stickers and frames are refused by name", async () => {
    const m = await mount(rich());
    await m.request({ requestId: "a1", actionId: "navigate-to", params: { address: { sticker: "s03" } } });
    await m.wait(0);
    expect(m.results[0].result.success).toBe(true);
    expect((m.results[0].result.data as { address: unknown }).address).toEqual({ sticker: "s03" });
    expect(m.q("[data-inspector]")?.textContent).toContain("Stale — re-roll to apply");

    await m.request({ requestId: "a2", actionId: "navigate-to", params: { address: { sticker: "s09" } } });
    await m.wait(0);
    expect(m.results[1].result).toMatchObject({ success: false, message: 'no sticker "s09" in pack.json (has: s01, s02, s03, s04, s05, s06, s07, s08)' });

    await m.request({ requestId: "a3", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 40 } } });
    await m.wait(0);
    expect(m.results[2].result).toMatchObject({ success: false, message: "s01-take-1 has frames 0–15 (got 40)" });
    await m.unmount();
  });

  test("a frame address in a browser without ImageDecoder arrives with a note, not silence", async () => {
    const m = await mount(rich());
    await m.request({ requestId: "f1", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 3 } } });
    await m.wait(10);
    expect(m.results[0].result.success).toBe(true);
    expect(m.results[0].result.message).toContain("no ImageDecoder");
    expect(m.q("[data-stage]")?.getAttribute("data-stage-frame")).toBe("3");
    await m.unmount();
  });

  test("set-view switches view, tab and plate, and refuses a platform the pack does not ship to", async () => {
    const m = await mount(rich());
    await m.request({ requestId: "v1", actionId: "set-view", params: { view: "submit", platform: "telegram", plate: "dark" } });
    expect(m.results[0].result).toMatchObject({ success: true, data: { view: "submit", platform: "telegram", plate: "dark" } });
    expect(m.q("[data-submit]")?.getAttribute("data-submit")).toBe("telegram");
    expect(m.all('[data-checklist="telegram"] [data-check]').length).toBe(rich().platforms[1].rows.length);
    await m.request({ requestId: "v2", actionId: "set-view", params: { view: "chat" } });
    expect(m.q("[data-chat]")?.getAttribute("data-plate")).toBe("dark");
    expect(m.all("[data-message]").map((e) => e.getAttribute("data-message"))).toEqual(["s01", "s02", "s03", "s07"]);
    await m.request({ requestId: "v3", actionId: "set-view", params: { view: "submit", platform: "kakao" } });
    expect(m.results[2].result.success).toBe(false);
    await m.unmount();
  });

  test("a locator card reports its verdict through onNavigateComplete", async () => {
    const m = await mount(rich());
    await m.locate({ art: "banner", platform: "wechat" });
    await m.wait(0);
    expect(m.navigations[0]?.success).toBe(true);
    expect(m.q("[data-submit]")?.getAttribute("data-submit")).toBe("wechat");
    await m.locate({ art: "reward-guide" });
    await m.wait(0);
    expect(m.navigations[1]).toMatchObject({ success: false, message: "no reward-guide art in this pack (has: portrait, head, banner)" });
    await m.unmount();
  });

  test("the selection carries the address the agent can send back", async () => {
    const m = await mount(rich());
    await m.click(m.q('[data-sticker="s07"]'));
    await m.wait(350);
    const last = m.selections.filter(Boolean).at(-1)!;
    expect(last.address).toEqual({ sticker: "s07" });
    expect(last.label).toContain("07 · s07");
    await m.unmount();
  });

  test("nothing fetched, nothing beyond /content", async () => {
    expect(fetchCalls).toEqual([]);
    const { raw, doc } = richWorkspace();
    const m = await mount(loadPack(filesOf(raw, doc)));
    const sources = m.all("img, video").map((e) => e.getAttribute("src") ?? "");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((src) => src.startsWith("/content/"))).toBe(true);
    await m.unmount();
  });
});
