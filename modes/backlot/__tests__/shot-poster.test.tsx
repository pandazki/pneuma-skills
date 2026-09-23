/** @jsxImportSource react */
/**
 * The shots rail's poster frame (`ShotsRail.tsx` → `ShotPoster.tsx`).
 *
 * Pinned by a real project (2026-09-24, the 23-shot tanka-launch film): every
 * shot was FREE, so none was ever rendered in Blender, yet each `shot.json`
 * carried the scaffolded `greybox.sheet: "greybox/sheet.png"`. The rail
 * pointed an <img> at that path for every card, 23 requests 404'd, and the
 * rail was a column of black boxes while every shot had a finished take.
 *
 *  - a card never asks for a sheet no render wrote; a free shot shows its
 *    current take, as a `#t=` media-fragment poster with `preload="metadata"`;
 *  - a recorded file that is missing on disk falls through to the next
 *    picture, and finally to the "not rendered" card — never a broken image.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseShot, type Shot } from "../domain.js";

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const w = win as unknown as Record<string, unknown>;
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "getComputedStyle"]) {
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

const SCAFFOLDED_GREYBOX = {
  revision: 0,
  preview: null,
  final: null,
  script: "greybox/scene.py",
  glb: "greybox/scene.glb",
  meta: "greybox/scene.meta.json",
  blend: "greybox/scene.blend",
  sheet: "greybox/sheet.png",
};

function shot(overrides: Record<string, unknown> = {}): Shot {
  return parseShot(
    "film/shots/s01-drop",
    "s01-drop",
    JSON.stringify({
      version: 1,
      id: "s01-drop",
      title: "A drop on still water",
      conditioning: "free",
      spec: { seconds: 6, fps: 24, width: 1280, height: 720, frames: 144 },
      beats: [],
      reference: null,
      greybox: SCAFFOLDED_GREYBOX,
      checks: [],
      takes: [{ id: "take-01", status: "done", file: "takes/take-01.mp4", selected: true }],
      ...overrides,
    }),
  )!;
}

const urlFor = (target: Shot, path: string | null, rev: number | string) =>
  path ? `/content/${target.dir}/${path}?rev=${rev}` : null;

async function mountRail(shots: Shot[]) {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ShotsRail } = await import("../viewer/ShotsRail.js");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(ShotsRail, { shots, selected: null, onSelect: () => {}, projectTitle: "Film", urlFor }),
    );
  });
  return {
    host,
    /** Fire a media element's `error`, as the browser does on a 404. */
    fail: async (el: Element) => {
      await act(async () => {
        el.dispatchEvent(new win.Event("error") as unknown as Event);
      });
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("the rail's poster frame", () => {
  test("a free shot that was never rendered shows its take, not the scaffolded sheet", async () => {
    const m = await mountRail([shot()]);
    // No request for a file no render wrote.
    expect(m.host.querySelector("img")).toBeNull();
    const video = m.host.querySelector("video")!;
    expect(video).not.toBeNull();
    expect(video.getAttribute("src")).toBe("/content/film/shots/s01-drop/takes/take-01.mp4?rev=0#t=0.6");
    expect(video.getAttribute("preload")).toBe("metadata");
    await m.unmount();
  });

  test("a free shot with no finished take says it is not rendered", async () => {
    const m = await mountRail([shot({ takes: [] })]);
    expect(m.host.querySelector("img")).toBeNull();
    expect(m.host.querySelector("video")).toBeNull();
    expect(m.host.textContent).toContain("not rendered");
    await m.unmount();
  });

  test("a sheet missing on disk falls through to the take, then to the placeholder", async () => {
    // A preview render wrote the sheet and bumped the revision — then the
    // file went away. The record cannot know; the browser's 404 does.
    const rendered = shot({
      greybox: {
        ...SCAFFOLDED_GREYBOX,
        revision: 1,
        preview: { file: "greybox/preview.mp4", revision: 1, renderedAt: 1, renderSeconds: 2 },
      },
    });
    const m = await mountRail([rendered]);
    const img = m.host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/content/film/shots/s01-drop/greybox/sheet.png?rev=1");

    await m.fail(img);
    expect(m.host.querySelector("img")).toBeNull();
    const video = m.host.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/content/film/shots/s01-drop/takes/take-01.mp4?rev=1#t=0.6");

    await m.fail(video);
    expect(m.host.querySelector("video")).toBeNull();
    expect(m.host.textContent).toContain("not rendered");
    await m.unmount();
  });
});
