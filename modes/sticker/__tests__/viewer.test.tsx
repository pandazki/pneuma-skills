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
 *   says so instead of decoding — the path a browser without WebCodecs takes);
 * - in the hosted player an upload archive is saved through `fetch`, which
 *   the content service worker answers, never by letting `<a download>`
 *   navigate past it.
 *
 * Harness shape follows `modes/anime-series/__tests__/viewer.test.tsx`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { MemorySource } from "../../../core/sources/memory.js";
import type { ViewerActionRequest, ViewerActionResult, ViewerLocator, ViewerNotification, ViewerPreviewProps, ViewerSelectionContext } from "../../../core/types/viewer-contract.js";
import { findSticker, loadPack, type StickerPack } from "../domain.js";
import manifest from "../manifest.js";
import { filesOf, finishedWorkspace, richWorkspace } from "./pack-workspace.js";
import { englishIn } from "./message-samples.js";
import { addTake, packFrom, rawPack, readyDoc } from "./sticker-fixture.js";

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
    // Nothing recorded in project.json is guessed: no "make the character",
    // no $0.00, no checklist of missing files.
    expect(broken.q("[data-next-step]")).toBeNull();
    expect(broken.q("[data-character-card]")?.textContent).toContain("project.json can't be read");
    expect(broken.q("[data-spend]")?.textContent).toBe("—");
    await broken.click(broken.q('[data-segment="view:submit"]'));
    expect(broken.q("[data-checks-unread]")?.textContent).toContain("Checks wait for project.json");
    expect(broken.all("[data-check]")).toHaveLength(0);
    expect(broken.q("[data-files]")).toBeNull();
    expect(broken.q("[data-listing]")).not.toBeNull();
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

  test("another sticker's inspector opens at its top, where its status is", async () => {
    const m = await mount(rich());
    await m.click(m.q('[data-sticker="s01"]'));
    const scroller = () => m.q("[data-inspector] .overflow-y-auto") as HTMLElement;
    scroller().scrollTop = 400;
    expect(scroller().scrollTop).toBe(400);
    await m.click(m.q('[data-sticker="s03"]'));
    expect(scroller().scrollTop).toBe(0);
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

  test("Escape cancels an edit: nothing is written and the field shows the saved text again", async () => {
    const m = await mount(rich(), { editing: true, onNotifyAgent: () => {} });
    const { act } = await import("react");
    /** Type into a field, then press Escape — the blur that follows must not save the draft. */
    const typeThenEscape = async (selector: string, text: string) => {
      const el = m.q(selector) as HTMLInputElement | HTMLTextAreaElement;
      expect(el).toBeTruthy();
      const before = el.value;
      await act(async () => {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
        setter.call(el, text);
        el.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
        el.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
        await sleep(0);
      });
      expect((m.q(selector) as HTMLInputElement).value).toBe(before);
      expect(document.activeElement).not.toBe(el);
    };
    await m.click(m.q('[data-sticker="s02"]'));
    await typeThenEscape('[data-field="caption"]', "不想上班了"); // <input>
    await typeThenEscape('[data-field="action"]', "dances wildly"); // <textarea>
    await m.click(m.q('[data-segment="view:submit"]'));
    await typeThenEscape('[data-field="listing-intro"]', "改过的介绍"); // listing <textarea>
    await typeThenEscape('[data-field="listing-name"]', "改过"); // listing <input>
    expect(m.writes).toEqual([]);
    await m.unmount();
  });

  test("a command reaches the agent with the stickers it is about", async () => {
    const notes: ViewerNotification[] = [];
    const m = await mount(rich(), { editing: true, onNotifyAgent: (n) => notes.push(n) });
    await m.click(m.q('[data-command="make-missing"]'));
    expect(notes.length).toBe(1);
    expect(notes[0].type).toBe("sticker-command:make-missing");
    // Exactly what a plain gen makes (genTargets): s05's last take may have
    // been billed, so it is named apart, as a retry only the user can ask for.
    expect(notes[0].message).toContain("make (what a plain gen makes): s06 (empty), s08 (failed)");
    expect(notes[0].message).toContain("not included — the last take failed with billing unknown, so it may have been charged; retry only if the user says so: s05 (s05-take-1: upstream error)");
    expect(notes[0].summary).toBe("/make-missing · s06, s08");
    await m.click(m.q('[data-segment="view:submit"]'));
    await m.click(m.q('[data-segment="platform:line"]'));
    await m.click(m.q('[data-command="export-check"]'));
    expect(notes[1].type).toBe("sticker-command:export-check");
    expect(notes[1].message).toContain("platform: line");
    await m.unmount();
  });
});

/** An element's text, one text node at a time — `textContent` runs "50 KB" into the next span's "s07…". */
function spoken(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) parts.push(node.textContent ?? "");
    node.childNodes.forEach(walk);
  };
  walk(el);
  return parts.join(" ");
}

describe("what the rules say, to whom", () => {
  /** Every sticker and art ready, nothing exported: every file row carries `sticker.mjs export`. */
  function unexported(): StickerPack {
    const raw = rawPack();
    return loadPack(filesOf(raw, readyDoc(packFrom(raw))));
  }

  test("read-only: rows, the next step and their tooltips say what is wrong, never what to type", async () => {
    const m = await mount(unexported(), { editing: false, onNotifyAgent: () => {} });
    expect(m.q("[data-next-step]")?.getAttribute("data-next-step")).toBe("export");
    expect(m.q("[data-next-step]")?.textContent).toContain("Export the WeChat files");
    await m.click(m.q('[data-segment="view:submit"]'));
    expect(m.q('[data-check="sticker-s01"] [data-check-detail]')?.textContent).toBe("not exported yet");
    expect(m.q('[data-check="zip"] [data-check-detail]')?.textContent).toBe("waits until every file is exported and current");
    expect(m.all("[data-check-command]")).toEqual([]);
    for (const leak of ["sticker.mjs", "--platform", "pack.json", "listing.wechat."]) expect(m.host.innerHTML).not.toContain(leak);
    await m.unmount();
  });

  test("editing: a row's command shows beside its meaning, and the step's in its tooltip", async () => {
    const m = await mount(unexported(), { editing: true, onNotifyAgent: () => {} });
    expect(m.q("[data-next-step] [title]")?.getAttribute("title")).toBe("Export the WeChat files — sticker.mjs export --platform wechat");
    await m.click(m.q('[data-segment="view:submit"]'));
    expect(m.q('[data-check="sticker-s01"] [data-check-detail]')?.textContent).toBe("not exported yetsticker.mjs export --platform wechat");
    expect(m.q('[data-check="sticker-s01"] [data-check-command]')?.textContent).toBe("sticker.mjs export --platform wechat");
    await m.unmount();
  });

  test("Chinese and Japanese: stale reasons, checklist rows, file reasons and the next step in the user's language", async () => {
    for (const [locale, stale, step] of [
      ["zh-CN", "配字改了", "补齐还没出图的：s06、s08；s05 要重画得另外确认"],
      ["ja", "文字が変わりました", "足りないスタンプを作る：s06、s08（s05 の描き直しは別に確認）"],
    ] as const) {
      const m = await mount(rich(), { locale, editing: false });
      expect(m.q("[data-next-step]")?.textContent).toContain(step);
      await m.click(m.q('[data-sticker="s03"]'));
      expect(m.all("[data-stale-reason]").map((r) => r.textContent)).toEqual([stale]);
      await m.click(m.q('[data-segment="view:submit"]'));
      for (const platform of ["wechat", "telegram", "line"]) {
        await m.click(m.q(`[data-segment="platform:${platform}"]`));
        const rows = m.all("[data-check]").filter((r) => !["rights", "listing-copyright", "listing-title", "listing-creator", "listing-description", "listing-shortName"].includes(r.getAttribute("data-check")!));
        expect(rows.length).toBeGreaterThan(5);
        for (const r of rows) expect({ row: r.getAttribute("data-check"), english: englishIn(spoken(r)) }).toEqual({ row: r.getAttribute("data-check"), english: [] });
        for (const f of m.all("[data-not-exported] [data-export], [data-files] figure")) {
          expect({ file: f.getAttribute("data-export"), english: englishIn(spoken(f)) }).toEqual({ file: f.getAttribute("data-export"), english: [] });
        }
      }
      await m.unmount();
    }
  });
});

describe("what a plain gen makes", () => {
  /** The rich pack with s06 and s08 drawn: only s05 (failed, billing unknown) has no usable take. */
  function onlyUncertain(): StickerPack {
    const { raw, doc } = richWorkspace();
    const pack = packFrom(raw);
    addTake(doc, pack, "s06", 1);
    addTake(doc, pack, "s08", 2);
    return loadPack(filesOf(raw, doc));
  }

  test("the failed sticker inspector says whether make-missing retries it or leaves it", async () => {
    const m = await mount(rich(), { editing: true, onNotifyAgent: () => {} });
    await m.click(m.q('[data-sticker="s05"]'));
    expect(m.q("[data-gen-plan]")?.getAttribute("data-gen-plan")).toBe("uncertain");
    expect(m.q("[data-gen-plan]")?.textContent).toContain("may already have been billed");
    await m.click(m.q('[data-sticker="s08"]'));
    expect(m.q("[data-gen-plan]")?.getAttribute("data-gen-plan")).toBe("target");
    await m.unmount();
  });

  test("with only an uncertain sticker left, nothing offers a silent resend", async () => {
    const value = onlyUncertain();
    expect(value.gen).toEqual({ targets: [], skipped: expect.any(Array), uncertain: [{ id: "s05", take: "s05-take-1", reason: "upstream error", requestId: null, recoverable: false }] });
    const m = await mount(value, { editing: true, onNotifyAgent: () => {} });
    expect(m.q('[data-command="make-missing"]')).toBeNull();
    expect(m.q("[data-next-step]")?.getAttribute("data-next-step")).toBe("retry");
    expect(m.q("[data-next-step]")?.textContent).not.toContain("Make the missing stickers");
    expect(m.q("[data-next-step]")?.textContent).toContain("may already have been billed");
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

  test("a frame the browser cannot decode is reported as not shown, and the stage says it plays the loop", async () => {
    // A `navigate-to` + `capture` caller screenshots whatever is on the
    // stage: a success here would hand it the playing loop as frame 3.
    const m = await mount(rich());
    await m.request({ requestId: "f1", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 3 } } });
    await m.wait(10);
    expect(m.results[0].result.success).toBe(false);
    expect(m.results[0].result.message).toContain("no ImageDecoder");
    expect(m.results[0].result.data).toMatchObject({ focus: { type: "sticker", id: "s01" }, frame: null });
    expect(m.q("[data-stage]")?.getAttribute("data-stage-frame")).toBe("");
    await m.locate({ sticker: "s01", frame: 5 });
    await m.wait(10);
    expect(m.navigations[0]).toMatchObject({ success: false });
    expect(m.navigations[0]?.message).toContain("no ImageDecoder");
    await m.unmount();
  });

  describe("with ImageDecoder", () => {
    /**
     * A stand-in for WebCodecs' ImageDecoder: `frames` frames, decoded once
     * `release()` is called (so a test can hold the decode), or a failing
     * fetch. The bitmaps are plain objects; happy-dom has no 2D context, so
     * FrameCanvas draws nothing.
     */
    function decoder(opts: { frames: number; status?: number }) {
      const g = globalThis as unknown as Record<string, unknown>;
      const saved = { ImageDecoder: g.ImageDecoder, createImageBitmap: g.createImageBitmap, fetch: g.fetch };
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      g.fetch = (async () => new Response(new Uint8Array([0x47, 0x49, 0x46]), { status: opts.status ?? 200 })) as unknown as typeof fetch;
      g.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
      g.ImageDecoder = class {
        completed = gate;
        tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: opts.frames } };
        async decode() {
          return { image: { close() {}, displayWidth: 512, displayHeight: 512 } };
        }
        close() {}
      };
      return {
        release: () => release(),
        restore: () => {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete g[key];
            else g[key] = value;
          }
        },
      };
    }

    test("success only once the requested frame is on the stage", async () => {
      const d = decoder({ frames: 16 });
      try {
        const m = await mount(rich());
        await m.request({ requestId: "g1", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 3 } } });
        await m.wait(10);
        expect(m.results).toEqual([]);
        d.release();
        await m.wait(10);
        expect(m.results[0].result.success).toBe(true);
        expect(m.results[0].result.message).toBeUndefined();
        expect(m.results[0].result.data).toMatchObject({ frame: 3 });
        expect(m.q("[data-stage]")?.getAttribute("data-stage-frame")).toBe("3");
        expect(m.q("[data-stage] canvas")).not.toBeNull();
        await m.unmount();
      } finally {
        d.restore();
      }
    });

    test("a decode failure is reported as not shown", async () => {
      const d = decoder({ frames: 16, status: 404 });
      try {
        const m = await mount(rich());
        await m.request({ requestId: "g2", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 3 } } });
        await m.wait(20);
        expect(m.results[0].result.success).toBe(false);
        expect(m.results[0].result.message).toContain("HTTP 404");
        expect(m.results[0].result.data).toMatchObject({ frame: null });
        expect(m.q("[data-stage]")?.getAttribute("data-stage-frame")).toBe("");
        await m.unmount();
      } finally {
        d.restore();
      }
    });

    test("a take that decodes to fewer frames than recorded is reported as not shown", async () => {
      const d = decoder({ frames: 2 });
      try {
        const m = await mount(rich());
        await m.request({ requestId: "g3", actionId: "navigate-to", params: { address: { sticker: "s01", frame: 3 } } });
        d.release();
        await m.wait(20);
        expect(m.results[0].result.success).toBe(false);
        expect(m.results[0].result.message).toContain("decoded to 2 frames");
        expect(m.q("[data-stage]")?.getAttribute("data-stage-frame")).toBe("");
        await m.unmount();
      } finally {
        d.restore();
      }
    });
  });

  test("the frame verdict: shown, not shown with a reason, or still waiting", async () => {
    const { frameVerdict } = await import("../viewer/view-model.js");
    const url = "/content/stickers/s01/take-1.gif?v=1";
    const bitmaps = Array.from({ length: 4 }, () => ({}) as ImageBitmap);
    expect(frameVerdict({ status: "ready", url, frames: bitmaps, width: 1, height: 1 }, url, 2)).toEqual({ done: true, shown: true });
    expect(frameVerdict({ status: "ready", url, frames: bitmaps, width: 1, height: 1 }, url, 4)).toMatchObject({ done: true, shown: false });
    expect(frameVerdict({ status: "ready", url: "/content/other.gif", frames: bitmaps, width: 1, height: 1 }, url, 2)).toEqual({ done: false });
    expect(frameVerdict({ status: "loading", url }, url, 2)).toEqual({ done: false });
    expect(frameVerdict({ status: "idle" }, url, 2)).toEqual({ done: false });
    expect(frameVerdict({ status: "unsupported" }, url, 2)).toMatchObject({ done: true, shown: false });
    expect(frameVerdict({ status: "error", url, message: "boom" }, url, 2)).toMatchObject({ done: true, shown: false });
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

describe("hosted player", () => {
  /**
   * The static player has no server: `/content/*` exists only inside the
   * content service worker. Chrome 156 and WebKit 26 hand an `<a download>`
   * click to the download manager, which never asks the worker — on the
   * player harness the click saved the static host's 9-byte 404 body
   * ("wechat.txt" in Chrome, cancelled; "line.zip.txt" in WebKit, kept). A
   * page `fetch()` does go through the worker.
   */
  interface Harness {
    fetched: string[];
    blobs: Blob[];
    clicks: Array<{ href: string; download: string | null; prevented: boolean }>;
    restore: () => void;
  }

  async function harness(staticPlayer: boolean, respond: () => Response): Promise<Harness> {
    const { useStore } = await import("../../../src/store.js");
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { fetch: g.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const h: Harness = { fetched: [], blobs: [], clicks: [], restore: () => {} };
    g.fetch = (async (input: unknown) => {
      h.fetched.push(String(input));
      return respond();
    }) as typeof fetch;
    URL.createObjectURL = (blob: Blob) => {
      h.blobs.push(blob);
      return "blob:http://localhost/archive";
    };
    URL.revokeObjectURL = () => {};
    // Runs after React's root listener, so it sees whether the viewer kept the
    // browser's own navigation; then stops happy-dom from navigating anywhere.
    const onClick = (event: Event) => {
      const a = (event.target as Element | null)?.closest?.("a");
      if (!a) return;
      h.clicks.push({ href: a.getAttribute("href") ?? "", download: a.getAttribute("download"), prevented: event.defaultPrevented });
      event.preventDefault();
    };
    document.addEventListener("click", onClick);
    useStore.setState({ staticPlayer });
    h.restore = () => {
      document.removeEventListener("click", onClick);
      useStore.setState({ staticPlayer: false });
      g.fetch = saved.fetch;
      URL.createObjectURL = saved.create;
      URL.revokeObjectURL = saved.revoke;
    };
    return h;
  }

  const finished = () => loadPack(finishedWorkspace().files);
  const zip = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200, headers: { "content-type": "application/octet-stream" } });

  /** Mount, run the steps, and always unmount before the globals come back. */
  async function inPlayer(staticPlayer: boolean, respond: () => Response, extra: Partial<ViewerPreviewProps>, run: (m: Mounted, h: Harness) => Promise<void>) {
    const h = await harness(staticPlayer, respond);
    let m: Mounted | null = null;
    try {
      m = await mount(finished(), extra);
      await run(m, h);
    } finally {
      await m?.unmount();
      h.restore();
    }
  }

  test("Download fetches the archive through the worker and saves it under its own name", async () => {
    await inPlayer(true, zip, {}, async (m, h) => {
      await m.click(m.q('[data-segment="view:submit"]'));
      const link = m.q("[data-download]");
      const href = link?.getAttribute("href") ?? "";
      expect(href).toStartWith("/content/exports/wechat.zip?r=");
      await m.click(link);
      await m.wait(20);
      expect(h.fetched).toEqual([href]);
      expect(h.clicks[0]).toEqual({ href, download: "", prevented: true });
      expect(h.blobs.length).toBe(1);
      expect(h.blobs[0].size).toBe(4);
      expect(h.clicks[1]).toEqual({ href: "blob:http://localhost/archive", download: "wechat.zip", prevented: false });
      expect(m.q("[role=status]")).toBeNull();
    });
  });

  test("a download the worker cannot answer says so instead of saving an error page", async () => {
    await inPlayer(true, () => new Response("Not found in play package", { status: 404 }), {}, async (m, h) => {
      await m.click(m.q('[data-segment="view:submit"]'));
      await m.click(m.q('[data-segment="platform:line"]'));
      await m.click(m.q("[data-download]"));
      await m.wait(20);
      expect(h.fetched.length).toBe(1);
      expect(h.blobs).toEqual([]);
      expect(h.clicks.length).toBe(1);
      expect(m.q("[role=status]")?.textContent).toBe("Download failed: HTTP 404");
    });
  });

  test("in the app the link stays a plain download link the server answers", async () => {
    await inPlayer(false, zip, { editing: true }, async (m, h) => {
      await m.click(m.q('[data-segment="view:submit"]'));
      await m.click(m.q("[data-download]"));
      await m.wait(20);
      expect(h.clicks.length).toBe(1);
      expect(h.clicks[0].prevented).toBe(false);
      expect(h.fetched).toEqual([]);
    });
  });
});
