/** @jsxImportSource react */
/**
 * The style board — step one of a course, the only place style is decided.
 *
 * What is pinned is what can be wrong without looking wrong: every preset
 * reachable, one report per learner move (a candidate is asked for, a
 * recommendation, a custom brief, an adjustment, a confirmation), the
 * confirm button gated on a landed sample, and "换一种" returning to the
 * catalog without touching the file. happy-dom has no layout engine —
 * nothing here measures pixels. (Harness shape follows
 * `modes/eli5/__tests__/rail.test.tsx`.)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

import type { CourseStyle } from "../domain.js";
import type { StyleBoardEvent } from "../viewer/StyleBoard.js";
import { parseStyleCatalog } from "../skill/scripts/segment-lib.mjs";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const w = win as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MouseEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    saved[key] = g[key];
    g[key] = key === "window" ? win : w[key];
  }
  saved.IS_REACT_ACT_ENVIRONMENT = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

interface Mounted {
  host: HTMLElement;
  events: StyleBoardEvent[];
  button: (text: string) => HTMLButtonElement | undefined;
  click: (el: Element) => Promise<void>;
  update: (style: CourseStyle | null) => Promise<void>;
  unmount: () => Promise<void>;
}

async function mountBoard(style: CourseStyle | null, topic?: string): Promise<Mounted> {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: StyleBoard } = await import("../viewer/StyleBoard.js");

  const events: StyleBoardEvent[] = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (s: CourseStyle | null) =>
    root.render(
      createElement(StyleBoard, {
        topic,
        style: s,
        prefix: "plexus",
        onEvent: (e: StyleBoardEvent) => events.push(e),
      }),
    );

  await act(async () => render(style));

  return {
    host,
    events,
    button: (text) =>
      (Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]).find((b) =>
        (b.textContent ?? "").includes(text),
      ),
    click: async (el) => {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    update: async (s) => {
      await act(async () => render(s));
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const SAMPLED: CourseStyle = {
  id: "chalkboard",
  status: "sampled",
  rationale: "过程与因果,一笔一画长出来,正合这个主题。",
  sample: { image: "style/anchor.png", video: "style/sample.mp4", hook: "为什么三条边永远绑在一个等式里?" },
};

describe("the style board mirrors the art direction", () => {
  // `skill/references/styles.md` is the authority — recipe, graphic
  // devices, narration mode, best-for/never-for — and the board's cards
  // are its mirror. Nothing enforced that before: a style added, renamed
  // or re-moded in the reference could leave the board showing a roster
  // the agent no longer recognises (and a card whose narration mode
  // contradicts the shoot).
  const STYLES_MD = join(import.meta.dir, "..", "skill", "references", "styles.md");

  test("the roster, its order and every narration mode are the reference's", async () => {
    const { STYLE_CARDS } = await import("../viewer/styleCatalog.js");
    const catalog = parseStyleCatalog(readFileSync(STYLES_MD, "utf-8"));

    expect(STYLE_CARDS.map((c) => c.id)).toEqual([...catalog.keys()]);
    for (const card of STYLE_CARDS) {
      expect(card.narration).toBe(catalog.get(card.id)!.narration);
    }
  });

  test("every card says something, short enough not to be truncated", async () => {
    const { STYLE_CARDS } = await import("../viewer/styleCatalog.js");
    for (const card of STYLE_CARDS) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.nameEn.length).toBeGreaterThan(0);
      expect(card.pitch.length).toBeGreaterThan(0);
      // One truncated line on a ~180px card at text-xs.
      expect(card.pitch.length).toBeLessThanOrEqual(13);
    }
  });
});

describe("the style board — catalog", () => {
  test("every preset is a card, no native form control, and a pick asks for a sample once", async () => {
    const board = await mountBoard(null);
    expect(board.host.querySelectorAll("img").length).toBe(18);
    expect(board.host.querySelector("select")).toBeNull();
    expect(board.button("拍一条样片看看")).toBeUndefined();

    const chalk = (Array.from(board.host.querySelectorAll("button")) as HTMLButtonElement[]).find((b) =>
      (b.textContent ?? "").includes("黑板粉笔"),
    )!;
    await board.click(chalk);
    const shoot = board.button("拍一条样片看看")!;
    expect(shoot).toBeDefined();
    await board.click(shoot);
    expect(board.events).toEqual([{ type: "candidate", id: "chalkboard", name: "黑板粉笔" }]);
    // The bar turns into a wait, and a second click is inert.
    expect(board.button("样片拍摄中")).toBeDefined();
    await board.click(board.button("样片拍摄中")!);
    expect(board.events).toHaveLength(1);
    await board.unmount();
  });

  test("为我推荐 reports once and shows the director at work", async () => {
    const board = await mountBoard(null, "傅里叶变换");
    expect(board.host.textContent).toContain("为「傅里叶变换」定一个视觉风格");
    await board.click(board.button("为我推荐")!);
    expect(board.events).toEqual([{ type: "recommend" }]);
    expect(board.host.textContent).toContain("导演正在挑风格");
    await board.click(board.button("为我推荐")!);
    expect(board.events).toHaveLength(1);
    await board.unmount();
  });

  test("我要自定义 opens a brief and 取消 closes it without reporting", async () => {
    const board = await mountBoard(null);
    expect(board.host.querySelector("textarea")).toBeNull();
    await board.click(board.button("我要自定义")!);
    expect(board.host.querySelector("textarea")).not.toBeNull();
    expect(board.button("发给导演拍样片")?.disabled).toBe(true);
    await board.click(board.button("取消")!);
    expect(board.host.querySelector("textarea")).toBeNull();
    expect(board.events).toEqual([]);
    await board.unmount();
  });
});

describe("the style board — sample confirmation", () => {
  test("a sampling candidate shows progress and cannot be confirmed yet", async () => {
    const board = await mountBoard({ id: "chalkboard", status: "sampling", sample: { hook: "h" } });
    expect(board.host.textContent).toContain("导演正在拍样片");
    expect(board.host.querySelector("video")).toBeNull();
    expect(board.button("就用这个风格")?.disabled).toBe(true);
    await board.unmount();
  });

  test("a landed sample plays, explains itself, and confirms once", async () => {
    const board = await mountBoard(SAMPLED);
    const video = board.host.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/content/plexus/style/sample.mp4");
    expect(board.host.textContent).toContain(SAMPLED.rationale!);
    expect(board.host.textContent).toContain(SAMPLED.sample!.hook!);
    expect(board.host.querySelectorAll("img").length).toBe(0);

    const confirm = board.button("就用这个风格")!;
    expect(confirm.disabled).toBe(false);
    await board.click(confirm);
    expect(board.events).toEqual([{ type: "confirm", id: "chalkboard", name: "黑板粉笔" }]);
    await board.unmount();
  });

  test("换一种 returns to the catalog without touching the file; a new candidate brings the sample view back", async () => {
    const board = await mountBoard(SAMPLED);
    await board.click(board.button("换一种")!);
    expect(board.host.querySelectorAll("img").length).toBe(18);
    expect(board.events).toEqual([]);
    await board.update({ id: "comic", status: "sampling", sample: { hook: "h" } });
    expect(board.host.textContent).toContain("手绘漫画");
    expect(board.host.textContent).toContain("导演正在拍样片");
    await board.unmount();
  });

  test("a sample that failed is said on the catalog, and the wait it answers is over", async () => {
    // The learner asked for a candidate; the sampler failed before it
    // could mark `sampling` and reset the style to pending with the reason.
    const board = await mountBoard(null);
    await board.click(board.host.querySelector("img")!.closest("button")!);
    await board.click(board.button("拍一条样片看看")!);
    expect(board.button("样片拍摄中")).toBeDefined();
    await board.update({ id: "chalkboard", status: "pending", sample: { error: "sample shoot failed: HTTP 504" } });
    const notice = board.host.querySelector("[data-style-sample-error]");
    expect(notice?.textContent).toContain("样片没拍成");
    expect(notice?.textContent).toContain("HTTP 504");
    // The catalog is still there, the pick is kept, and the shoot button
    // is a button again (the 19th image is the picked card's thumbnail
    // in the sticky bar).
    expect(board.host.querySelectorAll("img").length).toBe(19);
    expect(board.button("样片拍摄中")).toBeUndefined();
    expect(board.button("拍一条样片看看")?.disabled).toBe(false);
    await board.unmount();
  });

  test("a custom style shows its own name and recipe", async () => {
    const board = await mountBoard({
      ...SAMPLED,
      id: "custom",
      name: "黄昏手绘",
      recipe: "Hand-painted dusk tones, soft grain.",
    });
    expect(board.host.textContent).toContain("黄昏手绘");
    expect(board.host.textContent).toContain("Hand-painted dusk tones");
    await board.click(board.button("就用这个风格")!);
    expect(board.events).toEqual([{ type: "confirm", id: "custom", name: "黄昏手绘" }]);
    await board.unmount();
  });
});
