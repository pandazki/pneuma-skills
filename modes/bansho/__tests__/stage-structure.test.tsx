/** @jsxImportSource react */
/**
 * The C1 stage DOM contract, and G8-K structurally: the measure host is
 * the stage's SIBLING, never its descendant.
 *
 * Why it matters (R8, not tidiness): probe readings taken in the measure
 * host are cached and fed into canonical — align column widths enter the
 * reconcile hash, ink path lengths enter naturalDuration. If the host
 * lived inside the transformed stage, the same source would compile a
 * DIFFERENT timeline at a different zoom. So the host must sit where no
 * camera transform can ever reach it, at scale 1 forever.
 *
 * happy-dom has no layout, so what is pinned here is structure (who is
 * inside whom, in what order) plus the one observable camera effect a
 * layout-free DOM can still show: a ctrl+wheel writes a scale onto the
 * stage's transform, and onto NOTHING else.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import type { EnvCaps } from "../engine/types.js";
import { wallGrid } from "../engine/wall.js";

const SOURCE = [
  "# Stage",
  "",
  "The camera is a transform, not a scroll offset.",
  "",
].join("\n");

const ENV: EnvCaps = {
  handwritingFontActive: true,
  strokeFontCovers: () => false,
};

let win: Window;
let restore: (() => void) | undefined;

beforeAll(() => {
  win = new Window({ url: "http://localhost/" });
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const install = (key: string, value: unknown): void => {
    saved[key] = g[key];
    g[key] = value;
  };
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
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    install(key, key === "window" ? win : w[key]);
  }
  install(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  install("IS_REACT_ACT_ENVIRONMENT", true);
  restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
});

afterAll(() => restore?.());

describe("BoardCanvas — the stage DOM and the G8-K seam", () => {
  test("viewport/stage/panels/panel chain, measure layer as stage sibling", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

    const lecture = parseLecture(SOURCE, "stage-structure");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={lecture}
          view="board"
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={() => 999}
          onCompiled={() => {}}
          activeIndex={0}
          playing={false}
          follow="live"
          onSeek={() => () => {}}
          onFrame={() => () => {}}
          selectedRef={null}
        />,
      );
    });

    // The spec's target tree, exactly.
    const surface = host.querySelector(".bansho-board-surface")!;
    const viewport = surface.querySelector(":scope > .bansho-viewport")!;
    expect(viewport).not.toBeNull();
    // V1.5: the depth surface sits BETWEEN the viewport and the stage.
    // Outside the stage so `.bansho-stage` keeps wearing exactly the
    // camera and nothing else; inside the viewport so the viewport — the
    // funnel's untransformed origin — stays outside every 3D surface.
    const depth = viewport.querySelector(":scope > .bansho-depth")! as HTMLElement;
    expect(depth).not.toBeNull();
    const stage = depth.querySelector(":scope > .bansho-stage")!;
    expect(stage).not.toBeNull();
    // At rest the surface is ABSENT, not identity: no perspective, no 3D
    // rendering context over a 4300px board, and nothing that could move
    // the V1 layout baseline by a pixel.
    expect(depth.style.transform).toBe("");
    const panels = stage.querySelector(":scope > .bansho-panels")!;
    expect(panels).not.toBeNull();
    // The slot is the wall's grid cell and carries the board's furniture
    // (frame + chalk tray). On a single strip it is `display: contents` —
    // it generates NO box, so the flex chain, the offsetParent walk
    // `stageOffsetOf` makes, and the layout baseline are untouched.
    const slot = panels.querySelector(":scope > .bansho-slot")!;
    expect(slot).not.toBeNull();
    const panel = slot.querySelector(":scope > .bansho-panel.bansho-board")!;
    expect(panel).not.toBeNull();

    // Steps mount on the panel — the board is still the step host.
    expect(panel.querySelectorAll("[data-bansho-ref]").length).toBeGreaterThan(0);

    // G8-K: the measure host is OUTSIDE the stage, inside a hidden sibling
    // layer that wears .bansho-board so its type metrics match the panel.
    const measureHost = surface.querySelector(".bansho-measure-host")!;
    expect(measureHost).not.toBeNull();
    expect(measureHost.closest(".bansho-stage")).toBeNull();
    const layer = measureHost.parentElement!;
    expect(layer.classList.contains("bansho-measure-layer")).toBe(true);
    expect(layer.classList.contains("bansho-board")).toBe(true);
    expect(layer.parentElement).toBe(surface as HTMLElement);
    expect(layer.getAttribute("aria-hidden")).toBe("true");

    // The layout-baseline probe (and every ".bansho-board" query) must
    // find the PANEL first: the measure layer comes after the viewport.
    expect(surface.querySelector(".bansho-board")).toBe(panel);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  test("ctrl+wheel writes the camera scale onto the stage transform", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

    const lecture = parseLecture(SOURCE, "stage-zoom");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={lecture}
          view="board"
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={() => 999}
          onCompiled={() => {}}
          activeIndex={0}
          playing={false}
          follow="live"
          onSeek={() => () => {}}
          onFrame={() => () => {}}
          selectedRef={null}
        />,
      );
    });

    const viewport = host.querySelector(".bansho-viewport")! as HTMLElement;
    const stage = host.querySelector(".bansho-stage")! as HTMLElement;

    // At rest the camera is home — identity transform (inline or CSS).
    expect(stage.style.transform === "" || /scale\(1\)$/.test(stage.style.transform)).toBe(true);

    // happy-dom's WheelEvent drops MouseEvent init fields — patch them on.
    const wheel = new win.WheelEvent("wheel", {
      deltaY: -800,
      bubbles: true,
      cancelable: true,
    }) as unknown as Record<string, unknown>;
    Object.defineProperty(wheel, "ctrlKey", { value: true });
    Object.defineProperty(wheel, "clientX", { value: 0 });
    Object.defineProperty(wheel, "clientY", { value: 0 });
    await act(async () => {
      viewport.dispatchEvent(wheel as unknown as Event);
    });

    // deltaY -800 saturates past the max zoom -> clamped to 2.5. The
    // transform lands on the stage and ONLY on the stage (the panel and
    // the measure layer keep their layout untouched — G8-J/G8-K).
    expect(stage.style.transform).toContain("scale(2.5)");
    const panel = host.querySelector(".bansho-panel")! as HTMLElement;
    const layer = host.querySelector(".bansho-measure-layer")! as HTMLElement;
    const depth = host.querySelector(".bansho-depth")! as HTMLElement;
    expect(panel.style.transform).toBe("");
    expect(layer.style.transform).toBe("");
    // V1.5 — the camera and the depth are two surfaces. A zoom is not a
    // reason for the board to tilt, and the depth surface stays absent.
    expect(depth.style.transform).toBe("");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// V1.5 — the depth surface and the parallax probe
// ────────────────────────────────────────────────────────────────────────────

describe("BoardCanvas — parallax is a viewing pose, on its own surface", () => {
  async function mountBoard(parallax: boolean) {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");

    const lecture = parseLecture(SOURCE, "depth-surface");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let compiled: import("../viewer/BoardCanvas.js").CompiledBoard | null = null;
    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={lecture}
          view="board"
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={() => 999}
          onCompiled={(c) => {
            compiled = c;
          }}
          activeIndex={0}
          playing={false}
          follow="live"
          onSeek={() => () => {}}
          onFrame={() => () => {}}
          selectedRef={null}
          parallax={parallax}
        />,
      );
    });
    return {
      host,
      act,
      compiled: compiled as import("../viewer/BoardCanvas.js").CompiledBoard | null,
      async unmount() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  /** happy-dom's PointerEvent drops the MouseEvent coordinate fields. */
  function pointerAt(type: string, clientX: number, clientY: number): Event {
    const e = new win.Event(type, { bubbles: true }) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(e, "clientX", { value: clientX });
    Object.defineProperty(e, "clientY", { value: clientY });
    return e as unknown as Event;
  }

  test("with the switch OFF the pointer moves nothing at all", async () => {
    const m = await mountBoard(false);
    const viewport = m.host.querySelector(".bansho-viewport")! as HTMLElement;
    const depth = m.host.querySelector(".bansho-depth")! as HTMLElement;
    await m.act(async () => {
      viewport.dispatchEvent(pointerAt("pointermove", 900, 40));
    });
    expect(depth.style.transform).toBe("");
    await m.unmount();
  });

  test("with the switch ON the pointer writes the DEPTH surface — never the camera", async () => {
    const m = await mountBoard(true);
    const viewport = m.host.querySelector(".bansho-viewport")! as HTMLElement;
    const depth = m.host.querySelector(".bansho-depth")! as HTMLElement;
    const stage = m.host.querySelector(".bansho-stage")! as HTMLElement;
    const stageBefore = stage.style.transform;
    // happy-dom has no layout, so clientWidth/Height are 0 and
    // `parallaxAxes` reads centre — pin the plumbing by driving the offset
    // that DOES survive: a viewport rect of 0 puts every pointer at the
    // centre, so widen it by hand.
    Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    await m.act(async () => {
      viewport.dispatchEvent(pointerAt("pointermove", 800, 300));
    });
    // Right edge of the viewport => looking from the right => the right
    // edge of the board recedes (CSS rotateY positive).
    expect(depth.style.transform).toContain("perspective(");
    expect(depth.style.transform).toMatch(/rotateY\(4deg\)/);
    // THE constraint (brief §5.2-1): the camera is untouched. Parallax is a
    // viewing pose; letting it near the camera would let it near the fold.
    expect(stage.style.transform).toBe(stageBefore);
    await m.unmount();
  });

  test("the pointer leaving squares the board up again", async () => {
    const m = await mountBoard(true);
    const viewport = m.host.querySelector(".bansho-viewport")! as HTMLElement;
    const depth = m.host.querySelector(".bansho-depth")! as HTMLElement;
    Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    await m.act(async () => {
      viewport.dispatchEvent(pointerAt("pointermove", 800, 300));
    });
    expect(depth.style.transform).not.toBe("");
    await m.act(async () => {
      viewport.dispatchEvent(pointerAt("pointerleave", 800, 300));
    });
    expect(depth.style.transform).toBe("");
    await m.unmount();
  });

  test("the parallax pose cannot reach canonical (R8): same compile, any pose", async () => {
    // The strongest form of §5.2-1 available in a DOM test: compile the
    // same board with the pointer parked hard right, and compare the
    // canonical timeline against a compile with parallax off. Where the
    // mouse happens to be must not be able to rewrite a single duration.
    const off = await mountBoard(false);
    const flat = off.compiled!.timeline.schedule.map((s) => [
      s.start,
      s.end,
      s.step.section,
      s.step.step,
    ]);
    await off.unmount();

    const on = await mountBoard(true);
    const viewport = on.host.querySelector(".bansho-viewport")! as HTMLElement;
    Object.defineProperty(viewport, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 600, configurable: true });
    await on.act(async () => {
      viewport.dispatchEvent(pointerAt("pointermove", 800, 600));
    });
    const rocked = on.compiled!.timeline.schedule.map((s) => [
      s.start,
      s.end,
      s.step.section,
      s.step.step,
    ]);
    expect(rocked).toEqual(flat);
    await on.unmount();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// C3 — the staged board (panels, erased runs, the notes projection)
// ────────────────────────────────────────────────────────────────────────────

describe("BoardCanvas — the C3 staged DOM", () => {
  /** 甲。 (0:0) / @erase (0:1) / 乙。 (0:2) — one closed run, one open. */
  const ERASE_SOURCE = "甲。\n\n@erase\n\n乙。\n";

  async function mount(source: string, view: "board" | "notes") {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: BoardCanvas } = await import("../viewer/BoardCanvas.js");
    const { parseLecture: parse } = await import("../domain.js");

    const lecture = parse(source, "c3-staged");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let compiled: import("../viewer/BoardCanvas.js").CompiledBoard | null = null;
    await act(async () => {
      root.render(
        <BoardCanvas
          lecture={lecture}
          view={view}
          theme="light"
          fontsReady={true}
          env={ENV}
          getPlayheadT={() => 999}
          onCompiled={(c) => {
            compiled = c;
          }}
          activeIndex={0}
          playing={false}
          follow="live"
          onSeek={() => () => {}}
          onFrame={() => () => {}}
          selectedRef={null}
        />,
      );
    });
    return {
      host,
      root,
      act,
      compiled: compiled as import("../viewer/BoardCanvas.js").CompiledBoard | null,
      async unmount() {
        await act(async () => root.unmount());
        host.remove();
      },
    };
  }

  test("@board 3 stands three boards in a ROOM — two across, one below", async () => {
    const m = await mount("@board 3\n\n# 题\n\n正文。\n", "board");
    const panels = m.host.querySelector(".bansho-panels")! as HTMLElement;
    expect(panels.hasAttribute("data-bansho-multi")).toBe(true);
    const slots = panels.querySelectorAll(":scope > .bansho-slot");
    expect(slots.length).toBe(3);
    for (const slot of slots) {
      expect(
        slot.querySelectorAll(":scope > .bansho-panel.bansho-board").length,
      ).toBe(1);
    }
    // The wall is a grid, and its column count is the ONE number CSS is
    // told about it: auto-placement is row-major, which is exactly the
    // order `wallSlot` slots boards in, so the grid IS the slot function.
    expect(panels.style.getPropertyValue("--bansho-wall-cols")).toBe(
      String(wallGrid(3).cols),
    );
    // The stage direction itself draws nothing and holds no schedule time.
    expect(
      m.compiled!.timeline.schedule.some(
        (s) => s.step.section === 0 && s.step.step === 0,
      ),
    ).toBe(false);
    await m.unmount();
  });

  test("a single strip has NO wall map — the mount gate, not a hidden node", async () => {
    // The gate is what keeps the layout-baseline captures untouched: on a
    // strip the node does not exist rather than being display:none.
    const m = await mount("# 题\n\n正文。\n", "board");
    expect(m.host.querySelector('[data-testid="bansho-wall-map"]')).toBeNull();
    await m.unmount();
  });

  test("an erase closes a run: its steps move into the wrapper, later writing stays in flow", async () => {
    const m = await mount(ERASE_SOURCE, "board");
    const panel = m.host.querySelector(".bansho-panel")!;
    const wrapper = panel.querySelector(":scope > .bansho-erased-run")!;
    expect(wrapper).not.toBeNull();
    // 甲 (0:0) lives in the closed run's wrapper — same coordinates, one
    // more ancestor. 乙 (0:2) writes on the fresh run, direct in flow.
    expect(wrapper.querySelector('[data-bansho-ref="0:0"]')).not.toBeNull();
    const after = panel.querySelector(':scope > [data-bansho-ref="0:2"]');
    expect(after).not.toBeNull();
    await m.unmount();
  });

  test("the eraser owns the wrapper's clip-path: hidden past the erase, restored on scrub-back (G5/G8-L)", async () => {
    const m = await mount(ERASE_SOURCE, "board");
    const wrapper = m.host.querySelector(
      ".bansho-erased-run",
    )! as HTMLElement;
    // Mounted at t=999 (past everything): the run stands erased.
    expect(wrapper.style.clipPath).toBe("inset(0 0 0 100%)");
    // Scrub back before the erase: the content MUST reappear — the
    // eraser removes its own state and touches nothing else.
    const schedule = m.compiled!.timeline.schedule;
    const eraseEntry = schedule.find(
      (s) => s.step.section === 0 && s.step.step === 1,
    )!;
    m.compiled!.timeline.seek(eraseEntry.start - 0.01);
    expect(wrapper.style.clipPath).toBe("");
    await m.unmount();
  });

  test("the notes projection: no wrappers, no erase windows, every word on one strip", async () => {
    const m = await mount(ERASE_SOURCE, "notes");
    expect(m.host.querySelector(".bansho-erased-run")).toBeNull();
    expect(m.host.querySelectorAll(".bansho-panel").length).toBe(1);
    const schedule = m.compiled!.timeline.schedule;
    // The erase step (0:1) plans nothing; both prose steps are performed.
    expect(
      schedule.some((s) => s.step.section === 0 && s.step.step === 1),
    ).toBe(false);
    expect(
      schedule.some((s) => s.step.section === 0 && s.step.step === 0),
    ).toBe(true);
    expect(
      schedule.some((s) => s.step.section === 0 && s.step.step === 2),
    ).toBe(true);
    await m.unmount();
  });
});
