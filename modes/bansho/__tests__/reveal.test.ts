/**
 * Reveal engine (T3) — strategies, factories, layering, and the runtime
 * single-pen invariant.
 *
 * Bar (T3-impl 验收 + T3-review):
 *  - G2 layering grep, automated: engine core has ZERO external imports;
 *    `factories/math.ts` is the ONLY file importing katex.
 *  - Runtime single-pen sampling: real factory-built revealables driven by
 *    the compiled timeline — at any sampled instant at most ONE unit is in
 *    progress.
 *  - G8-G multi-line consecutive-annotation zero collision, on the
 *    font-size basis (the bug ONLY shows with several consecutive marked
 *    lines — single-line samples cannot catch it).
 *  - G8-B / G8-C / G8-D / G8-F / G8-I pins.
 *  - Determinism: identical content (even at shifted offsets) re-renders
 *    with byte-identical jitter.
 *
 * DOM host: happy-dom (no layout engine — client rects are zeros, so
 * in-place ink degrades to inert units here; ink GEOMETRY is pinned via
 * the pure `inkRowShapes` path and the synthetic `backRef` seam, and the
 * browser-truth is the G7 visual pass).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";

import { parseLecture } from "../domain.js";
import { containerKeyOf } from "../engine/container.js";
import { Ease } from "../engine/easing.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { flattenSteps, planStepUnits } from "../engine/inference.js";
import { mulberry32 } from "../engine/sketch/index.js";
import { fadeReveal } from "../engine/strategies/fade.js";
import { strokeReveal } from "../engine/strategies/stroke.js";
import { clipWipe, rectWipe } from "../engine/strategies/wipe.js";
import { buildTimeline } from "../engine/timeline.js";
import type {
  ContainerHome,
  MeasureContext,
  Revealable,
  RowRect,
  StepRef,
} from "../engine/types.js";
import { chartScales } from "../engine/factories/chart.js";
import {
  factoryFor,
  probeEnvCaps,
  readHandStacks,
} from "../engine/factories/index.js";
import {
  groupRowRects,
  inkRowShapes,
  paintInk,
  type InkShape,
} from "../engine/factories/ink.js";
import { buildMathNode } from "../engine/factories/math.js";
import { el, inertRevealable } from "../engine/factories/svg.js";
import { MACOS_LIKE, fakeFontMachine } from "./fake-font-machine.js";
// Viewer-side, imported deliberately: the math host's shrink-wrap (engine)
// and its centering (stylesheet) are two halves of one geometry decision, so
// the test that pins one pins the other. The G2 layering rule constrains
// `engine/` source, not the tests that hold it to account.
import { BOARD_BASE_CSS } from "../viewer/board-css.js";

const ENGINE_DIR = join(import.meta.dir, "..", "engine");

// ── DOM harness ─────────────────────────────────────────────────────────────

interface Host {
  doc: Document;
  ctx: MeasureContext;
  containers: Map<string, ContainerHome>;
}

function makeHost(backRefRows?: RowRect[]): Host {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const measureHost = doc.createElement("div");
  doc.body.appendChild(measureHost);
  const containers = new Map<string, ContainerHome>();
  const ctx: MeasureContext = {
    durations: DEFAULT_DURATIONS,
    document: doc,
    measureHost,
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: (key: string) => containers.get(key),
    ...(backRefRows
      ? { backRef: () => ({ rows: backRefRows, fontSize: 26 }) }
      : {}),
  };
  return { doc, ctx, containers };
}

const refKey = (ref: StepRef): string => `${ref.section}:${ref.step}`;

/** Build every performable step of a lecture through the real factories. */
function buildAll(source: string, host: Host) {
  const lecture = parseLecture(source);
  const built = new Map<string, Revealable[]>();
  const nodes = new Map<string, Element>();
  for (const { ref, step } of flattenSteps(lecture)) {
    const factory = factoryFor(step.kind);
    if (!factory) continue;
    const { node, revealables } = factory.build(step, host.ctx);
    if (step.kind === "chart-frame") {
      host.containers.set(containerKeyOf(step)!, { frame: step, node });
    }
    built.set(refKey(ref), revealables);
    nodes.set(refKey(ref), node);
  }
  return { lecture, built, nodes };
}

// §4.2-flavoured demo exercising every T3 factory (` becomes ``` below).
const DEMO = `# 为什么这轮 AI 周期不同

GPU 的故事要从 2023 年讲起,数据中心营收翻了 ==三倍==,达到 874 亿。

~~这只是常规反弹~~ —— 这是**结构性**转移,核心是 ((供给约束))。

- 需求: 三倍
- 供给: 受限

> 旁注:质能方程 $E=mc^2$ 也上板。

$$a^2 + b^2 = c^2$$

---

'''chart revenue
x: 2023Q1 .. 2024Q4  (季度)
y: 0 .. 40  (十亿美元)
+ 英伟达: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
'''

再看 AMD,同一时期平得多。

'''chart revenue
+ AMD: 1.3 1.3 1.5 2.3 2.3 2.8 3.5 3.9
+ mark 英伟达 @ 2024Q4 : "35.6B"
'''

@circle "874"

@wait 1.5
`.replaceAll("'''", "\`\`\`");

// ── G2 — layering grep, automated ───────────────────────────────────────────

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+["']([^"']+)["']/g)) {
    specs.push(m[1]!);
  }
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    specs.push(m[1]!);
  }
  return specs;
}

describe("G2 — engine layering (grep acceptance)", () => {
  const files = tsFilesUnder(ENGINE_DIR);

  test("engine core has ZERO external imports", () => {
    const core = files.filter((f) => !f.includes("/factories/"));
    expect(core.length).toBeGreaterThan(8);
    for (const file of core) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(spec.startsWith("./") || spec.startsWith("../")).toBe(true);
      }
    }
  });

  /**
   * The G2 exception list, in full and in one place. Two entries, each
   * pinned to the ONE file allowed to carry it:
   *  - `katex` in `factories/math.ts` — a parser, host-agnostic pure JS;
   *  - `@dagrejs/dagre` in `factories/graph.ts` — graph layout, likewise
   *    host-agnostic, and confined to the render layer so the layout seam
   *    stays swappable for a plain implementation.
   * A third external import anywhere in the engine, or either of these
   * appearing in a second file, fails here. The same list is stated in the
   * task spec's §G2 and the design doc's §6.3 — all three move together.
   */
  const EXTERNAL_IMPORT_EXCEPTIONS: ReadonlyArray<[string, string]> = [
    ["katex", "factories/math.ts"],
    ["@dagrejs/dagre", "factories/graph.ts"],
  ];

  test("factories import nothing external except the two-entry exception list", () => {
    const factories = files.filter((f) => f.includes("/factories/"));
    expect(factories.length).toBeGreaterThan(5);
    for (const file of factories) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const exception = EXTERNAL_IMPORT_EXCEPTIONS.find(([pkg]) => pkg === spec);
        if (exception) {
          expect(file.endsWith(exception[1])).toBe(true);
        } else {
          expect(spec.startsWith("./") || spec.startsWith("../")).toBe(true);
        }
      }
    }
  });

  test("each exception is actually used by its one owner (the list is not stale)", () => {
    for (const [pkg, owner] of EXTERNAL_IMPORT_EXCEPTIONS) {
      const file = files.find((f) => f.endsWith(owner));
      expect(file).toBeDefined();
      expect(importSpecifiers(readFileSync(file!, "utf8"))).toContain(pkg);
    }
  });

  test("no React, no src/ imports, no rAF anywhere in the engine", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(src)) {
        expect(spec).not.toMatch(/^react/);
        expect(spec).not.toContain("/src/");
      }
      expect(src).not.toContain("requestAnimationFrame");
    }
  });

  test("G8-F — no pen-tip cursor: getPointAtLength never appears (已否决)", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("getPointAtLength");
    }
  });

  test("G8-D — no color ever set as an SVG presentation attribute", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(
        /setAttribute\(\s*["'](?:fill|stroke|color|opacity|stop-color)["']/,
      );
    }
  });

  test("determinism — no entropy or wall-clock source anywhere in the engine", () => {
    // sketch/index.ts bans Math.random in a doc comment; this makes the
    // ban executable — and extends it to the clocks. All jitter flows from
    // the caller-seeded PRNG and all time from the host transport, so a
    // nondeterministic call ANYWHERE in the engine (an id, a tiebreak) is
    // a scrub/export determinism bug even outside the jitter path.
    // Comment-only lines are skipped so the ban's own prose never trips it.
    const BANNED = [/\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n");
      for (const banned of BANNED) {
        expect(code).not.toMatch(banned);
      }
    }
  });
});

// ── Strategies ──────────────────────────────────────────────────────────────

describe("strategies — built state is unrevealed; seek is pure & scrubbable", () => {
  const span = { start: 0, end: 4 };

  test("clipWipe ltr: hidden at build, opens with write easing, scrubs back", () => {
    const { doc } = makeHost();
    const elx = doc.createElement("span") as HTMLElement;
    const r = clipWipe(elx, { duration: 1, srcSpan: span, ease: Ease.write });
    expect(r.kind).toBe("wipe");
    expect(elx.style.clipPath).toBe("inset(0 100.00% 0 0)");
    r.seek(1);
    expect(elx.style.clipPath).toBe("inset(0 0.00% 0 0)");
    r.seek(0.5);
    const mid = elx.style.clipPath;
    r.seek(1);
    r.seek(0.5); // out-of-order re-seek lands on the identical state
    expect(elx.style.clipPath).toBe(mid);
  });

  test("clipWipe rtl (series label): clips from the left side + opacity ramp", () => {
    const { doc } = makeHost();
    const elx = doc.createElement("span") as HTMLElement;
    const r = clipWipe(elx, {
      duration: 1,
      srcSpan: span,
      ease: Ease.write,
      side: "rtl",
      opacityRamp: 2.4,
    });
    expect(elx.style.clipPath).toBe("inset(0 0 0 100.00%)");
    expect(elx.style.opacity).toBe("0");
    r.seek(0.25);
    expect(elx.style.opacity).toBe("0.6");
    r.seek(1);
    expect(elx.style.clipPath).toBe("inset(0 0 0 0.00%)");
    expect(elx.style.opacity).toBe("1");
  });

  test("strokeReveal: pathLength-normalized dashoffset, hidden at build", () => {
    const { doc } = makeHost();
    const path = el(doc, "path", { d: "M 0 0 L 10 0" });
    const r = strokeReveal([{ path, length: 10 }], {
      duration: 1,
      srcSpan: span,
      ease: Ease.steady,
    });
    expect(r.kind).toBe("stroke");
    expect(path.getAttribute("pathLength")).toBe("1");
    expect(path.style.strokeDasharray).toBe("1");
    expect(path.style.strokeDashoffset).toBe("1");
    // Round line caps paint a zero-length dash DOT even at full offset —
    // the built state must be visibility-hidden until the pen arrives.
    expect(path.style.visibility).toBe("hidden");
    r.seek(1);
    expect(path.style.strokeDashoffset).toBe("0");
    expect(path.style.visibility).toBe("visible");
    r.seek(0.14); // steady pen: 14% of time = 6% of the line
    expect(Number.parseFloat(path.style.strokeDashoffset)).toBeCloseTo(0.94, 10);
    r.seek(0); // scrub back to the start — the dot must not reappear
    expect(path.style.visibility).toBe("hidden");
  });

  test("multi-segment stroke: segments run strictly one after another (G8-B)", () => {
    const { doc } = makeHost();
    const a = el(doc, "path", { d: "M 0 0 L 100 0" });
    const b = el(doc, "path", { d: "M 0 10 L 50 10" });
    const r = strokeReveal(
      [
        { path: a, length: 100 },
        { path: b, length: 50 },
      ],
      { duration: 1, srcSpan: span, ease: Ease.strike },
    );
    r.seek(0.5); // 0.5 < 100/150 — the pen is still on the first row
    expect(Number.parseFloat(a.style.strokeDashoffset)).toBeGreaterThan(0);
    expect(b.style.strokeDashoffset).toBe("1"); // untouched second row
    r.seek(100 / 150);
    expect(a.style.strokeDashoffset).toBe("0"); // first row finished…
    expect(b.style.strokeDashoffset).toBe("1"); // …before the second starts
    r.seek(1);
    expect(b.style.strokeDashoffset).toBe("0");
    // Scrub back: state is a function of p alone.
    r.seek(0.5);
    expect(b.style.strokeDashoffset).toBe("1");
  });

  test("fadeReveal: opacity 0 at build, linear by default", () => {
    const { doc } = makeHost();
    const g = el(doc, "g", {});
    const r = fadeReveal(g, { duration: 0.2, srcSpan: span });
    expect(r.kind).toBe("fade");
    expect(g.style.opacity).toBe("0");
    r.seek(0.5);
    expect(g.style.opacity).toBe("0.5");
    r.seek(1);
    expect(g.style.opacity).toBe("1");
  });

  test("rectWipe: windows open row by row, width from the eased sweep", () => {
    const { doc } = makeHost();
    const r1 = el(doc, "rect", { x: 0, y: 0, width: 0, height: 10 });
    const r2 = el(doc, "rect", { x: 0, y: 45, width: 0, height: 10 });
    const r = rectWipe(
      [
        { rect: r1, span: 200 },
        { rect: r2, span: 100 },
      ],
      { duration: 0.44, srcSpan: span, ease: Ease.swipe },
    );
    expect(r1.getAttribute("width")).toBe("0");
    r.seek(200 / 300); // first row's slice fully swept
    expect(r1.getAttribute("width")).toBe("200.00");
    expect(r2.getAttribute("width")).toBe("0.00");
    r.seek(1);
    expect(r2.getAttribute("width")).toBe("100.00");
  });
});

// ── Degradation is legible — inert units carry the discriminator ────────────

describe("degraded units are legible — never disguised as genuine fades", () => {
  const unit = {
    kind: "ink" as const,
    action: "circle" as const,
    srcSpan: { start: 0, end: 3 },
    duration: 0.4,
    gapBefore: 0,
    gapAfter: 0,
  };

  test("inertRevealable sets degraded: true (kind is only a placeholder)", () => {
    const r = inertRevealable(unit);
    expect(r.degraded).toBe(true);
    expect(r.naturalDuration).toBe(0.4); // parity held
  });

  test("genuine strategy units never carry the discriminator", () => {
    const { doc } = makeHost();
    const span = { start: 0, end: 4 };
    const g = el(doc, "g", {});
    expect(fadeReveal(g, { duration: 0.2, srcSpan: span }).degraded).toBeUndefined();
    const p = el(doc, "path", { d: "M 0 0 L 10 0" });
    expect(
      strokeReveal([{ path: p, length: 10 }], {
        duration: 1,
        srcSpan: span,
        ease: Ease.steady,
      }).degraded,
    ).toBeUndefined();
    const s = doc.createElement("span") as HTMLElement;
    expect(
      clipWipe(s, { duration: 1, srcSpan: span, ease: Ease.write }).degraded,
    ).toBeUndefined();
  });
});

// ── Measure-mount hygiene — a throw mid-materialization leaks nothing ───────

describe("measure host stays clean even when materialization throws", () => {
  test("buildTextStep unmounts its node from the measure host on a throw", () => {
    const host = makeHost();
    const win = host.doc.defaultView!;
    const orig = win.getComputedStyle;
    // Simulate an exotic environment failure inside the mounted window —
    // fontSizeOf (G8-G) consults getComputedStyle on the ink target.
    win.getComputedStyle = () => {
      throw new Error("synthetic getComputedStyle failure");
    };
    try {
      const lecture = parseLecture("有 ==标注== 的一行。\n");
      const entry = flattenSteps(lecture).find(
        ({ step }) => step.kind === "prose",
      )!;
      expect(() => factoryFor("prose")!.build(entry.step, host.ctx)).toThrow(
        "synthetic getComputedStyle failure",
      );
      // The invariant is structural (try/finally), not positional: the
      // hidden measure host is left EMPTY — the throw never returns the
      // node to the caller, so nothing else could have cleaned it up and
      // successive builds would silently accumulate orphans.
      expect(host.ctx.measureHost.childNodes.length).toBe(0);
    } finally {
      win.getComputedStyle = orig;
    }
  });
});

// ── §7 R1 — unrevealed is the DEFAULT (creation-time) state, fail closed ────

describe("R1 — text/math nodes are created pre-clipped (degradation fails closed)", () => {
  // An unrevealed clip in either form: creation-time writes "100%", a
  // clipWipe apply(0) overwrites with "100.00%" — both are fully hidden.
  const UNREVEALED = /^inset\(0 100(?:\.00)?% 0 0\)$/;

  test("buildMathNode: the host is clipped AT CREATION, before any strategy", () => {
    const { doc } = makeHost();
    // Direct call — no clipWipe ever runs, so this pins the creation-time
    // write alone: if the plan↔DOM mirror drifts and the unit goes inert,
    // the formula must stay hidden, never paint at t=0.
    for (const display of [true, false]) {
      const host = buildMathNode(doc, "E=mc^2", display) as HTMLElement;
      expect(host.style.clipPath).toMatch(UNREVEALED);
    }
  });

  test("every .bansho-w span and inline math host is clipped at build time", () => {
    const host = makeHost();
    const { nodes } = buildAll(DEMO, host);
    let spans = 0;
    let maths = 0;
    for (const node of nodes.values()) {
      for (const w of Array.from(node.querySelectorAll(".bansho-w"))) {
        expect((w as HTMLElement).style.clipPath).toMatch(UNREVEALED);
        spans++;
      }
      // The block-math step's node IS the host itself — include the root.
      const mathHosts = Array.from(node.querySelectorAll(".bansho-math"));
      if (node.classList.contains("bansho-math")) mathHosts.push(node);
      for (const m of mathHosts) {
        expect((m as HTMLElement).style.clipPath).toMatch(UNREVEALED);
        maths++;
      }
    }
    expect(spans).toBeGreaterThan(20); // the demo is not a toy
    expect(maths).toBeGreaterThan(1); // inline $E=mc^2$ + block $$…$$
  });
});

// ── 禁则 — no line begins with a mark, and no mark loses its own span ───────

describe("禁则 — a mark is never a box that can start a line", () => {
  /** Every `.bansho-w` of the one step this source builds. */
  const spansOf = (source: string): HTMLElement[] => {
    const host = makeHost();
    const { nodes } = buildAll(source, host);
    const node = [...nodes.values()][0]!;
    return Array.from(node.querySelectorAll(".bansho-w")) as HTMLElement[];
  };

  test("inside a run the mark is folded into the word — no box of its own", () => {
    const spans = spansOf("你测了，阳性。你有病");
    expect(spans.map((s) => s.textContent)).toEqual([
      "你测",
      "了，",
      "阳性。",
      "你有",
      "病",
    ]);
    // Nothing to weld: the segmenter already removed the stranded box.
    expect(spans.some((s) => s.parentElement?.className === "bansho-nobr"))
      .toBe(false);
  });

  test("a mark whose whole RUN is punctuation keeps its span and is WELDED", () => {
    // `**…**。` — the residue the segmenter structurally cannot reach:
    // merging across the run boundary would make the unit's srcSpan
    // swallow the `**` markers (G6). The mark therefore stays ONE span for
    // ONE reveal unit, and rides a nowrap group with the word before it.
    const spans = spansOf("一句话：**先验 × 似然 → 后验**。");
    const mark = spans[spans.length - 1]!;
    expect(mark.textContent).toBe("。");
    const group = mark.parentElement!;
    expect(group.className).toBe("bansho-nobr");
    // EXACTLY the two boxes — a nowrap group any wider would stop the
    // marked phrase itself from wrapping (measured, Chrome 151).
    expect(Array.from(group.children).map((c) => c.textContent)).toEqual([
      "后验",
      "。",
    ]);
    // The weld happens INSIDE the ink wrapper, so document order — which
    // is what script-sync reads — is untouched.
    expect(group.parentElement!.className).toContain("bansho-ink");
  });

  test("the plan and the DOM still agree unit for unit, span for span", () => {
    // The reveal contract: one span per reveal unit. A weld regroups
    // boxes; it must never merge, drop or mint one.
    const source = "一句话：**先验 × 似然 → 后验**。";
    const host = makeHost();
    const { built, nodes } = buildAll(source, host);
    const key = [...nodes.keys()][0]!;
    const node = nodes.get(key)!;
    const units = built.get(key)!;
    const textUnits = planStepUnits(
      parseLecture(source).sections[0]!.steps[0]!,
      DEFAULT_DURATIONS,
    ).filter((u) => u.kind === "text");
    expect(node.querySelectorAll(".bansho-w").length).toBe(textUnits.length);
    expect(units.length).toBeGreaterThan(textUnits.length); // + the ink
  });

  test("a mark NEVER jumps a space to reach a word", () => {
    // Whitespace between them is written text the reader can see; welding
    // across it would delete the gap. The mark keeps its own box here.
    const spans = spansOf("完 。");
    expect(spans.map((s) => s.textContent)).toEqual(["完", "。"]);
    expect(spans[1]!.parentElement!.className).not.toContain("bansho-nobr");
  });

  test("an opening mark is welded FORWARD, to the word it opens", () => {
    const spans = spansOf("看**（**例如");
    const open = spans.find((s) => s.textContent === "（")!;
    const group = open.parentElement!;
    expect(group.className).toBe("bansho-nobr");
    expect(Array.from(group.children).map((c) => c.textContent)).toEqual([
      "（",
      "例如",
    ]);
  });
});

// ── The clip box must hug the formula (measured, T5 walkthrough) ────────────

describe("math host geometry — the wipe window has no dead air", () => {
  // `clipWipe` insets a PERCENTAGE of the host's own box, so every pixel of
  // slack around the glyphs is time the pen spends writing nothing. Measured
  // on the running tech-zh board before this was pinned: a `$$…$$` host was
  // 994px wide (a block-level `<math display="block">` fills its line) around
  // a 229px formula — the sweep spent 38% of the beat left of the first glyph
  // and 38% right of the last, and the formula visibly wrote during ~18% of
  // its own reveal. There is no layout engine here, so the pin is the box
  // declaration itself; the pixel evidence lives in
  // `harness/screenshots/t5-seeds/` (frames 05 / 05b).
  test("a block formula's host shrink-wraps; the inline one already did", () => {
    const { doc } = makeHost();
    const block = buildMathNode(doc, "S(n) = \\frac{1}{(1-p) + \\frac{p}{n}}", true) as HTMLElement;
    expect(block.style.display).toBe("block");
    expect(block.style.width).toBe("fit-content");

    const inline = buildMathNode(doc, "E=mc^2", false) as HTMLElement;
    expect(inline.style.display).toBe("inline-block");
    // An inline-block already hugs its content — a width would only be able
    // to make it wrong.
    expect(inline.style.width).toBe("");
  });

  test("the board stylesheet centers the shrunk block", () => {
    // Paired with the `fit-content` above: without auto inline margins the
    // shrink-wrapped block would jump to the left padding edge. The two
    // halves live in different files, so the coupling is asserted here.
    const rule = BOARD_BASE_CSS.match(/\.bansho-math-block\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/margin:\s*[^;]*\bauto\b/);
  });
});

// ── G8-D — structural enforcement ───────────────────────────────────────────

describe("G8-D — token colors go through element.style", () => {
  test("el() rejects color-bearing presentation attributes at build time", () => {
    const { doc } = makeHost();
    expect(() => el(doc, "path", { stroke: "var(--s1)" })).toThrow(/G8-D/);
    expect(() => el(doc, "path", { fill: "red" })).toThrow(/G8-D/);
    expect(() => el(doc, "text", { opacity: "0.5" })).toThrow(/G8-D/);
  });

  test("el() writes colors handed as style onto element.style", () => {
    const { doc } = makeHost();
    const p = el(doc, "path", { d: "M 0 0" }, { stroke: "var(--s1, green)" });
    expect(p.style.stroke).toContain("var(--s1");
    expect(p.getAttribute("stroke")).toBeNull();
  });
});

// ── Ink geometry (pure) — G8-B / G8-G ───────────────────────────────────────

/** Conservative bbox over every path coordinate (curve ⊂ control hull). */
function pathBBox(d: string, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]!);
    x1 = Math.max(x1, nums[i]!);
    y0 = Math.min(y0, nums[i + 1]!);
    y1 = Math.max(y1, nums[i + 1]!);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

const intersects = (
  a: ReturnType<typeof pathBBox>,
  b: ReturnType<typeof pathBBox>,
): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function shapeBBox(shape: InkShape): ReturnType<typeof pathBBox> {
  return pathBBox(shape.d, shape.render === "stroke" ? shape.width / 2 : 0);
}

describe("G8-G — ink sized by FONT SIZE; consecutive marked lines never collide", () => {
  // The real-world numbers that exposed the prototype's only true bug:
  // font size 26px, line height 45px — the span bbox height is the LINE
  // height. Sizing from it made three consecutive circles collide pairwise.
  const FS = 26;
  const LINE_H = 45;
  const lineRow = (line: number): RowRect => ({
    x0: 60,
    y0: line * LINE_H,
    x1: 260,
    y1: (line + 1) * LINE_H,
  });

  for (const action of ["circle", "highlight", "underline", "strike"] as const) {
    test(`${action}: three consecutive marked lines — zero pairwise collisions`, () => {
      const boxes = [0, 1, 2].map((line) => {
        const shapes = inkRowShapes(action, [lineRow(line)], FS, mulberry32(7 + line));
        expect(shapes).toHaveLength(1);
        return shapeBBox(shapes[0]!);
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(intersects(boxes[i]!, boxes[j]!)).toBe(false);
        }
      }
    });

    // The same claim on the path a BROWSER takes (G8-M): with a baseline the
    // marks move off the box centre, and a rule that only held for the
    // fallback geometry would be a rule about a code path nobody sees.
    test(`${action}: still zero collisions once the rows carry a baseline`, () => {
      const boxes = [0, 1, 2].map((line) => {
        const row = { ...lineRow(line), baseline: line * LINE_H + 30 };
        const shapes = inkRowShapes(action, [row], FS, mulberry32(7 + line));
        return shapeBBox(shapes[0]!);
      });
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(intersects(boxes[i]!, boxes[j]!)).toBe(false);
        }
      }
    });
  }

  test("circle: horizontal overshoot scales with the font size — never a fixed 14px", () => {
    // A fixed ±14px overshoot at the board's 26px CJK font landed the tip
    // squarely on the glyph AFTER the circled span — CJK punctuation
    // (；，。) puts its ink exactly where the opaque 2px tip crosses, and
    // both flagship seed boards visibly lost punctuation next to ((…))
    // targets. Same error class as G8-G: ink geometry derives from the
    // FONT SIZE, never from fixed pixels that only fit one size.
    const row: RowRect = { x0: 60, y0: 0, x1: 260, y1: 45 };
    const overshootAt = (fs: number): number => {
      const [shape] = inkRowShapes("circle", [row], fs, mulberry32(5));
      const box = shapeBBox(shape!);
      return Math.max(box.x1 - row.x1, row.x0 - box.x0);
    };
    // Scales with the font: half the font size, visibly less overshoot.
    expect(overshootAt(13)).toBeLessThan(overshootAt(26) - 2);
    // At the board's 26px the tip stays out of an adjacent fullwidth
    // punctuation glyph's ink (the old fixed value measured ≈ 16px here).
    expect(overshootAt(26)).toBeLessThan(10);
  });

  test("circle: vertical radius derives from fs × 0.60, not the line box", () => {
    const [shape] = inkRowShapes("circle", [lineRow(0)], FS, mulberry32(3));
    const box = shapeBBox(shape!);
    // Line-height-based sizing gives ry = 27 → height 54+ (overruns the
    // 45px line); fs-based gives ry ≈ 15.9 → comfortably inside.
    expect(box.y1 - box.y0).toBeLessThan(LINE_H);
    expect(box.y1 - box.y0).toBeGreaterThan(FS * 0.6); // it IS a circle, not a dash
  });

  test("highlight: band thickness bounded by the nib budget", () => {
    const [shape] = inkRowShapes("highlight", [lineRow(0)], FS, mulberry32(4));
    const box = shapeBBox(shape!);
    expect(box.y1 - box.y0).toBeLessThan(FS * 1.2 * 1.5);
  });
});

// ── G8-M — ink meets the WRITING, and the writing is found by its baseline ──
//
// The bug this pins, measured on the running board (Chalkboard SE / HanziPen
// SC, 34px, line-height 1.5): the row box is the LINE box, so its centre sits
// (A − D) / 2 = 14.5px above the baseline while a CJK glyph's ink centre sits
// 0.32em = 10.9px above it. Every mark centred on the box therefore rode
// 3.6px high. Latin never showed it — its x-height ink is half the band's
// height, so the band swallowed the error — while CJK ink is 1.04em, as tall
// as the band itself, so the whole error landed on the glyph bottoms: median
// per-column coverage 0.90, and 0.62 once the taper and tilt are averaged in.
//
// The em-box constants below are the measured ink extent of full-square CJK
// glyphs in the board's hand stack, and they are what the marks must clear:
// ink top = baseline − 0.84em, ink bottom = baseline + 0.20em.
describe("G8-M — marks derive their vertical position from the BASELINE", () => {
  const FS = 34;
  const LINE_H = 51; // 34px × 1.5, the board's own leading
  const BASELINE = 40; // measured: (51 − (38.5 + 9.49)) / 2 + 38.5
  const CJK_INK_TOP = BASELINE - FS * 0.84;
  const CJK_INK_BOTTOM = BASELINE + FS * 0.2;
  const row = (line = 0): RowRect => ({
    x0: 60,
    y0: line * LINE_H,
    x1: 460,
    y1: (line + 1) * LINE_H,
    baseline: line * LINE_H + BASELINE,
  });
  /** Band thickness in a window around `targetX` — one column of glyphs. */
  const spanAt = (
    shape: InkShape,
    targetX: number,
  ): { top: number; bottom: number } => {
    const nums = shape.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Math.abs(nums[i]! - targetX) < 14) ys.push(nums[i + 1]!);
    }
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };

  test("highlight: the band's belly covers the CJK em box, top AND bottom", () => {
    // Every seed, because the lift/tilt draw is what used to push the tail
    // off the glyphs — a single lucky seed proved nothing.
    for (let seed = 1; seed <= 12; seed++) {
      const [shape] = inkRowShapes("highlight", [row()], FS, mulberry32(seed));
      const belly = spanAt(shape!, 260);
      expect(belly.top).toBeLessThanOrEqual(CJK_INK_TOP);
      expect(belly.bottom).toBeGreaterThanOrEqual(CJK_INK_BOTTOM);
    }
  });

  test("highlight: the band overshoots the em box — a marker, not a stencil", () => {
    const [shape] = inkRowShapes("highlight", [row()], FS, mulberry32(4));
    const belly = spanAt(shape!, 260);
    const over = CJK_INK_TOP - belly.top + (belly.bottom - CJK_INK_BOTTOM);
    expect(over).toBeGreaterThan(FS * 0.06);
    expect(over).toBeLessThan(FS * 0.5); // still a stroke, not a block
  });

  test("underline: the pen passes BELOW the writing, never through it", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const [shape] = inkRowShapes("underline", [row()], FS, mulberry32(seed));
      const box = shapeBBox(shape!);
      // Stroke width and hand-jitter included: not one pixel of the pen
      // touches the CJK em box. The old `cy + h × 0.58` put the line at
      // 45.6 — 1.2px INSIDE the bottom of every character.
      expect(box.y0).toBeGreaterThan(CJK_INK_BOTTOM);
      // …but still belongs to the line it underlines: clear of the next
      // line's own writing, which starts at LINE_H + BASELINE − 0.84em.
      expect(box.y1).toBeLessThan(LINE_H + BASELINE - FS * 0.84);
    }
  });

  test("circle: the ring encloses the CJK em box with room on both sides", () => {
    const [shape] = inkRowShapes("circle", [row()], FS, mulberry32(3));
    const box = shapeBBox(shape!);
    expect(box.y0).toBeLessThan(CJK_INK_TOP);
    expect(box.y1).toBeGreaterThan(CJK_INK_BOTTOM);
    // Symmetric about the writing, ±2px — the old ring cleared the top by
    // 6.7px and the bottom by 0.5px, which is what "off centre" looks like.
    const slackTop = CJK_INK_TOP - box.y0;
    const slackBottom = box.y1 - CJK_INK_BOTTOM;
    expect(Math.abs(slackTop - slackBottom)).toBeLessThan(2);
  });

  test("strike: stays on the box mid-line — the product owner's ruling", () => {
    // Measured 0.107em above the CJK ink centre and judged close to right;
    // it is the ONE mark deliberately left on the line box, so a future
    // baseline sweep does not quietly take it too.
    const [shape] = inkRowShapes("strike", [row()], FS, mulberry32(6));
    const boxMid = LINE_H / 2;
    const ys = shape!.d
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number)
      .filter((_, i) => i % 2 === 1);
    // The pen crosses the box's mid-line, not the writing's (which is
    // 3.6px lower): every point of it stays within the hand's own jitter
    // of that line, and the whole stroke sits ABOVE the ink centre.
    for (const y of ys) expect(Math.abs(y - boxMid)).toBeLessThan(4);
    const inkCentre = (CJK_INK_TOP + CJK_INK_BOTTOM) / 2;
    expect(Math.max(...ys)).toBeLessThan(inkCentre);
    // …and it is not reading the baseline at all: same seed, same stroke,
    // with the baseline present and absent.
    const { baseline: _drop, ...boxOnly } = row();
    expect(shape!.d).toBe(inkRowShapes("strike", [boxOnly], FS, mulberry32(6))[0]!.d);
  });

  test("highlight: the clip window contains the band it reveals (G8-I)", () => {
    // The window is what the wipe animates, and it moved with the band.
    // A window that clipped would only show mid-reveal — a finished board
    // looks perfect — so the containment is pinned here rather than in a
    // screenshot of a band that has already finished being drawn.
    for (let seed = 1; seed <= 12; seed++) {
      const [shape] = inkRowShapes("highlight", [row()], FS, mulberry32(seed));
      if (shape!.render !== "fill") throw new Error("expected a filled band");
      const box = shapeBBox(shape!);
      expect(shape!.window.y).toBeLessThan(box.y0);
      expect(shape!.window.y + shape!.window.height).toBeGreaterThan(box.y1);
    }
  });

  test("no baseline (layout-free host) → the row-box centre, exactly as before", () => {
    const { baseline: _drop, ...boxOnly } = row();
    for (const action of ["highlight", "circle", "underline"] as const) {
      const fallback = inkRowShapes(action, [boxOnly], FS, mulberry32(2));
      const anchored = inkRowShapes(action, [row()], FS, mulberry32(2));
      // Same shape, moved down by exactly the box-centre → writing-centre
      // correction; the fallback must not throw or degrade to nothing.
      expect(fallback[0]!.d).not.toBe(anchored[0]!.d);
      expect(fallback[0]!.d.length).toBeGreaterThan(20);
    }
  });
});

describe("G8-B — cross-line marks split per line, top-first", () => {
  test("client rects on two lines group into two rows", () => {
    const rows = groupRowRects([
      { left: 200, top: 45, right: 260, bottom: 90 }, // second line first —
      { left: 60, top: 0, right: 260, bottom: 45 }, //   order must not matter
      { left: 60, top: 47, right: 180, bottom: 90 }, //   (±6px top tolerance)
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.y0).toBe(0);
    expect(rows[1]!.y0).toBe(45);
    expect(rows[1]!.x0).toBe(60);
    expect(rows[1]!.x1).toBe(260);
  });

  test("two-line highlight yields one band per line, none spanning both", () => {
    const rows = groupRowRects([
      { left: 60, top: 0, right: 260, bottom: 45 },
      { left: 60, top: 45, right: 200, bottom: 90 },
    ]);
    const shapes = inkRowShapes("highlight", rows, 26, mulberry32(9));
    expect(shapes).toHaveLength(2);
    const [a, b] = shapes.map((s) => shapeBBox(s));
    // Each band hugs its own line — no giant frame across both (G8-B).
    expect(a!.y1).toBeLessThan(b!.y0 + 10);
    expect(a!.y1 - a!.y0).toBeLessThan(45);
    expect(b!.y1 - b!.y0).toBeLessThan(45);
  });

  test("zero-size rects (layout-free host) are dropped, not drawn", () => {
    expect(groupRowRects([{ left: 0, top: 0, right: 0, bottom: 0 }])).toEqual([]);
  });
});

// ── In-place ink under synthetic layout (plan↔DOM integration) ──────────────
//
// happy-dom has no layout engine: every client rect is zeros, so the whole
// in-place ink pipeline (inkKey lookup → relRect → groupRowRects → paintInk)
// degrades to inert units in the other suites — a wrong inkKey lookup and a
// wrong rect computation collapse into the SAME inert unit the parity test
// cannot tell from success. Here we stub getBoundingClientRect with a
// deterministic flow layout so the path lights up, and assert the units are
// NOT inert: right RevealKind per action + a painted path per row.

describe("in-place ink resolves under synthetic layout — never silently inert", () => {
  const CHAR_W = 20;
  const WRAP_W = 240;
  const LINE_H = 45;
  let restore: (() => void) | undefined;

  beforeAll(() => {
    // happy-dom Window instances share one Element class from the module
    // cache — patch the prototype for THIS describe only and restore after,
    // or every other suite's zero-rect assumptions break.
    const win = new Window();
    const proto = (win.Element as unknown as { prototype: Element }).prototype;
    const orig = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: Element): DOMRect {
      const rect = (x0: number, y0: number, x1: number, y1: number): DOMRect =>
        ({
          left: x0,
          top: y0,
          right: x1,
          bottom: y1,
          x: x0,
          y: y0,
          width: x1 - x0,
          height: y1 - y0,
        }) as DOMRect;
      if (this.classList.contains("bansho-step")) return rect(0, 0, 720, 400);
      if (this.classList.contains("bansho-w")) {
        // Deterministic flow layout: spans place sequentially in document
        // order, CHAR_W px per character, wrapping at WRAP_W.
        const root = this.closest(".bansho-step");
        const spans = root
          ? Array.from(root.querySelectorAll(".bansho-w"))
          : [this];
        let x = 0;
        let line = 0;
        for (const s of spans) {
          const w = Math.max((s.textContent ?? "").length, 1) * CHAR_W;
          if (x + w > WRAP_W && x > 0) {
            x = 0;
            line++;
          }
          if (s === this) {
            return rect(x, line * LINE_H, x + w, (line + 1) * LINE_H);
          }
          x += w;
        }
      }
      return rect(0, 0, 0, 0);
    };
    restore = () => {
      proto.getBoundingClientRect = orig;
    };
  });

  afterAll(() => restore?.());

  /** The ink revealable of a step + the layers it painted into. */
  function buildInkStep(source: string) {
    const host = makeHost();
    const { lecture, built, nodes } = buildAll(source, host);
    expect(lecture.errors).toEqual([]);
    const entry = flattenSteps(lecture).find(({ step }) => step.kind === "prose")!;
    const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
    const inkIndex = plan.findIndex((u) => u.kind === "ink");
    expect(inkIndex).toBeGreaterThanOrEqual(0);
    const revealable = built.get(refKey(entry.ref))![inkIndex]!;
    const node = nodes.get(refKey(entry.ref))!;
    const svgs = Array.from(node.querySelectorAll("svg")) as SVGElement[];
    const under = svgs.find((s) => s.style.zIndex === "0")!;
    const over = svgs.find((s) => s.style.zIndex === "2")!;
    return { revealable, under, over };
  }

  // Three consecutive annotated lines — the T3-review bar's warning shape
  // ("只在连续多行都带标注时才暴露"): each action must resolve to its real
  // strategy, never the inert fallback.
  test("strike on line 1 → stroke gesture painted in the over layer", () => {
    const { revealable, over } = buildInkStep("第一行有 ~~删除线标注~~ 收尾。\n");
    expect(revealable.kind).toBe("stroke");
    expect(over.querySelectorAll("path").length).toBeGreaterThanOrEqual(1);
  });

  test("highlight on line 2 → clipped fill band painted in the under layer", () => {
    const { revealable, under } = buildInkStep("第二行有 ==荧光标注== 收尾。\n");
    expect(revealable.kind).toBe("wipe");
    const band = under.querySelector("path")!;
    expect(band).toBeDefined();
    expect((band as SVGElement).style.fill).toContain("var(--hl");
    expect(band.getAttribute("clip-path")).toMatch(/^url\(#bansho-hl-/);
  });

  test("underline on line 3 → stroke gesture painted in the over layer", () => {
    const { revealable, over } = buildInkStep("第三行有 **下划线标注** 收尾。\n");
    expect(revealable.kind).toBe("stroke");
    expect(over.querySelectorAll("path").length).toBeGreaterThanOrEqual(1);
  });

  test("a wrapping ink span paints one gesture path PER ROW (G8-B end-to-end)", () => {
    // 12 CJK chars ≈ 6 two-char segments × 40px = 240px — forces a wrap at
    // WRAP_W, so the mark must split into one shape per line.
    const { revealable, over } = buildInkStep(
      "前缀 ~~这一条删除线标注足够长会换行~~ 后缀。\n",
    );
    expect(revealable.kind).toBe("stroke");
    expect(over.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  test("a bordered step anchors ink to the PADDING box (clientLeft/clientTop folded in)", () => {
    // The overlay SVGs are absolutely-positioned children — user space
    // starts at the step's padding box — while getBoundingClientRect
    // measures the border box. On a bordered step an uncompensated relRect
    // drew every gesture offset by the border width. Same content, same
    // seed: adding a 3px border must shift the painted stroke by exactly
    // (−3, −3) in overlay space.
    // No SHIPPED step carries a border since `.bansho-aside`'s border-left
    // became a drawn margin bar, so the border is synthesized here — the
    // correction still guards every content set that styles the board via
    // its own theme.css.
    const source = "边框行有 ~~删除线标注~~ 收尾。\n";
    const firstPoint = (over: SVGElement): [number, number] => {
      const nums = over
        .querySelector("path")!
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!;
      return [Number.parseFloat(nums[0]!), Number.parseFloat(nums[1]!)];
    };
    const [x0, y0] = firstPoint(buildInkStep(source).over);
    // Shared prototype across Window instances (same gotcha as beforeAll).
    const win = new Window();
    const proto = (win.HTMLElement as unknown as { prototype: HTMLElement })
      .prototype;
    const leftDesc = Object.getOwnPropertyDescriptor(proto, "clientLeft")!;
    const topDesc = Object.getOwnPropertyDescriptor(proto, "clientTop")!;
    const bordered = (px: number) => ({
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList.contains("bansho-step") ? px : 0;
      },
    });
    Object.defineProperty(proto, "clientLeft", bordered(3));
    Object.defineProperty(proto, "clientTop", bordered(3));
    try {
      const [x1, y1] = firstPoint(buildInkStep(source).over);
      expect(x1).toBeCloseTo(x0 - 3, 6);
      expect(y1).toBeCloseTo(y0 - 3, 6);
    } finally {
      Object.defineProperty(proto, "clientLeft", leftDesc);
      Object.defineProperty(proto, "clientTop", topDesc);
    }
  });
});

// ── §4.3 旁注 — the aside's margin bar is DRAWN, never a CSS border ─────────
//
// Every other line on this board is a jittered path; a `border-left` is the
// one mechanically straight, uniformly thick, perfectly round-capped line on
// it — the tell a viewer spots instantly. The bar is now the aside's first
// reveal unit (G1: its own beat), drawn with the same `drawHandLine` helper
// that serves `---` and the heading baseline, down instead of across.
//
// happy-dom has no layout engine, so the measured height the bar spans is
// stubbed here (`clientHeight` — the very property the factory reads); the
// browser truth lands on the G7 visual pass.

describe("aside margin bar — one hand-drawn stroke, spanning the measured note", () => {
  /** Build an aside step with a stubbed measured height (padding box). */
  function buildAside(source: string, clientHeight: number) {
    // happy-dom Window instances share one HTMLElement class from the module
    // cache (same gotcha as the bordered-step test) — patch, use, restore.
    const win = new Window();
    const proto = (win.HTMLElement as unknown as { prototype: HTMLElement })
      .prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "clientHeight")!;
    Object.defineProperty(proto, "clientHeight", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList.contains("bansho-aside") ? clientHeight : 0;
      },
    });
    try {
      const host = makeHost();
      const { lecture, built, nodes } = buildAll(source, host);
      expect(lecture.errors).toEqual([]);
      const entry = flattenSteps(lecture).find(({ step }) => step.kind === "aside")!;
      const revealables = built.get(refKey(entry.ref))!;
      const node = nodes.get(refKey(entry.ref))!;
      const over = (Array.from(node.querySelectorAll("svg")) as SVGElement[]).find(
        (s) => s.style.zIndex === "2",
      )!;
      return {
        lecture,
        step: entry.step,
        plan: planStepUnits(entry.step, DEFAULT_DURATIONS),
        revealables,
        node,
        over,
        bar: over.querySelector("path") as SVGElement,
      };
    } finally {
      Object.defineProperty(proto, "clientHeight", desc);
    }
  }

  /** Every coordinate pair of a path's `d` (M/Q both take x y pairs). */
  function points(path: SVGElement): Array<[number, number]> {
    const nums = (path.getAttribute("d") ?? "")
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number.parseFloat);
    const out: Array<[number, number]> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
    return out;
  }

  const ONE_LINE = "> 旁注一句。\n";
  const TWO_LINES = "> 旁注第一句，\n> 还有第二句。\n";

  test("the bar is the aside's FIRST unit and it is a real pen stroke", () => {
    const { plan, revealables, over } = buildAside(ONE_LINE, 38);
    expect(revealables).toHaveLength(plan.length);
    expect(plan[0]!.kind).toBe("rule");
    // Not the inert degradation: a stroke revealable over one painted path.
    expect(revealables[0]!.kind).toBe("stroke");
    expect(revealables[0]!.degraded).toBeUndefined();
    expect(revealables[0]!.srcSpan).toEqual(plan[0]!.srcSpan);
    expect(over.querySelectorAll("path")).toHaveLength(1);
  });

  test("it runs DOWN the left gutter, not across (a vertical hand line)", () => {
    const H = 38;
    const { bar } = buildAside(ONE_LINE, H);
    const pts = points(bar);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // x barely moves (jitter only); y spans the note.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(6);
    expect(Math.min(...ys)).toBeLessThan(6);
    expect(Math.max(...ys)).toBeGreaterThan(H - 8);
    // It sits in the gutter the stylesheet reserves, left of the text.
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(14);
  });

  test("a WRAPPED note gets a taller bar — the span is the measured height", () => {
    const yExtent = (h: number): number => {
      const ys = points(buildAside(TWO_LINES, h).bar).map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    const one = yExtent(38);
    const two = yExtent(76);
    expect(one).toBeGreaterThan(30);
    expect(two).toBeGreaterThan(66);
    // Two rendered lines ⇒ about twice the bar. (Same content, same seed —
    // the only input that moved is the measurement.)
    expect(two / one).toBeGreaterThan(1.8);
    expect(two / one).toBeLessThan(2.2);
  });

  test("identical content + identical measurement ⇒ byte-identical jitter", () => {
    const a = buildAside(TWO_LINES, 76).bar.getAttribute("d");
    const b = buildAside(TWO_LINES, 76).bar.getAttribute("d");
    expect(a).toBe(b);
    // …and it is genuinely jittered, not a straight `M x y L x y`.
    expect(a).toContain("Q");
  });

  test("G8-D — the pen colour rides element.style, never an attribute", () => {
    const { bar } = buildAside(ONE_LINE, 38);
    expect(bar.style.stroke).toContain("var(--board-fg");
    expect(bar.style.fill).toBe("none");
    expect(bar.getAttribute("stroke")).toBeNull();
    expect(bar.style.strokeLinecap).toBe("round");
  });

  test("the stylesheet no longer draws it: no border on .bansho-aside", () => {
    const rule = BOARD_BASE_CSS.match(/\.bansho-aside\s*\{([^}]*)\}/)![1]!;
    expect(rule).not.toContain("border");
    // The gutter the drawn bar lives in is still reserved.
    expect(rule).toMatch(/padding-left:\s*\d+px/);
  });

  // ── 悬挂缩进 — a wrapped bullet hangs (W2b, 2026-08-12) ─────────────────
  // On a board the indent under a bullet is the whole signal for "still the
  // same item"; a column narrow enough to be a measure wraps items often
  // enough for a continuation line flush at the bullet to read as a new one.
  test("a wrapped item hangs by EXACTLY the bullet's own advance", () => {
    const host = makeHost();
    const { lecture, nodes } = buildAll("- 一个会换行的条目\n", host);
    const entry = flattenSteps(lecture).find(
      ({ step }) => step.kind === "list-item",
    )!;
    const bullet = nodes
      .get(refKey(entry.ref))!
      .querySelector(".bansho-bullet")!;
    /** The glyph box the FACTORY mints — the CSS's assumption about it. */
    const glyph = Number(bullet.getAttribute("width"));
    expect(glyph).toBeGreaterThan(0);

    const advance = Number(
      /--bansho-bullet-advance:\s*(\d+(?:\.\d+)?)px/.exec(BOARD_BASE_CSS)![1],
    );
    const text = BOARD_BASE_CSS.match(
      /\.bansho-list-item \.bansho-text\s*\{([^}]*)\}/,
    )![1]!;
    // The text column moves right by the advance; the bullet is pulled back
    // to where it always sat. NOT `text-indent`: that is inherited and every
    // written word here is an inline-block, so a negative indent would land
    // on each of them and shred the line (measured, 2026-08-12).
    expect(text).toMatch(/padding-left:\s*var\(--bansho-bullet-advance\)/);
    expect(text).not.toContain("text-indent");
    // The bullet's NET advance is zero — pull-back + glyph + gutter — which
    // is what keeps line one's measure, its wrapping and the ink drawn for
    // it exactly what they were before the hang existed. And the gutter is
    // quoted from the glyph the FACTORY actually mints, so a bullet resized
    // in `factories/prose.ts` cannot silently misalign the hang: this is the
    // only place the two halves meet.
    // `\n}` as the terminator, not `[^}]`: this rule carries a comment with
    // a brace in it (`svg { display: block }`).
    const bulletRule = BOARD_BASE_CSS.match(
      /\.bansho-list-item \.bansho-bullet\s*\{([\s\S]*?)\n\}/,
    )![1]!;
    expect(bulletRule).toMatch(
      /margin-left:\s*calc\(-1 \* var\(--bansho-bullet-advance\)\)/,
    );
    const gutter = Number(
      /margin-right:\s*calc\(var\(--bansho-bullet-advance\) - (\d+(?:\.\d+)?)px\)/.exec(
        bulletRule,
      )![1],
    );
    expect(gutter).toBe(glyph);
    expect(-advance + glyph + (advance - gutter)).toBe(0);
    expect(advance).toBeGreaterThan(glyph);
  });

  test("the heading's baseline is untouched — still horizontal, still last", () => {
    const host = makeHost();
    const { lecture, built, nodes } = buildAll("# 大标题\n", host);
    const entry = flattenSteps(lecture).find(({ step }) => step.kind === "heading")!;
    const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
    expect(plan[plan.length - 1]!.kind).toBe("rule");
    expect(built.get(refKey(entry.ref))![plan.length - 1]!.kind).toBe("stroke");
    const node = nodes.get(refKey(entry.ref))!;
    const over = (Array.from(node.querySelectorAll("svg")) as SVGElement[]).find(
      (s) => s.style.zIndex === "2",
    )!;
    const ys = points(over.querySelector("path") as SVGElement).map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(6); // flat
  });
});

// ── G8-I — the highlighter is a filled shape behind a clip window ───────────

describe("G8-I — highlighter: filled shape + left-to-right clip window", () => {
  test("paintInk(highlight) mounts a fill path (no stroke) clipped by a rect", () => {
    const { doc } = makeHost();
    const svg = el(doc, "svg");
    const defs = el(doc, "defs");
    svg.appendChild(defs);
    const r = paintInk({
      doc,
      fillLayer: svg,
      strokeLayer: svg,
      defs,
      action: "highlight",
      rows: [{ x0: 50, y0: 100, x1: 250, y1: 145 }],
      fontSize: 26,
      rnd: mulberry32(0xb005),
      duration: 0.44,
      srcSpan: { start: 0, end: 5 },
    });
    expect(r.kind).toBe("wipe");
    const path = svg.querySelector("path")!;
    expect(path.getAttribute("d")!.trim().endsWith("Z")).toBe(true); // filled outline
    expect((path as SVGElement).style.fill).toContain("var(--hl");
    expect((path as SVGElement).style.stroke).toBe(""); // NOT a uniform stroke
    expect(path.getAttribute("clip-path")).toMatch(/^url\(#bansho-hl-/);

    const rect = defs.querySelector("clipPath rect")!;
    expect(rect.getAttribute("width")).toBe("0"); // window closed at build
    r.seek(1);
    expect(Number.parseFloat(rect.getAttribute("width")!)).toBeCloseTo(230, 5);
    r.seek(0); // scrub back — the window closes again
    expect(rect.getAttribute("width")).toBe("0.00");
  });

  test("strike paints a stroked gesture with board-fg via element.style", () => {
    const { doc } = makeHost();
    const svg = el(doc, "svg");
    const defs = el(doc, "defs");
    svg.appendChild(defs);
    const r = paintInk({
      doc,
      fillLayer: svg,
      strokeLayer: svg,
      defs,
      action: "strike",
      rows: [{ x0: 50, y0: 100, x1: 250, y1: 145 }],
      fontSize: 26,
      rnd: mulberry32(1),
      duration: 0.44,
      srcSpan: { start: 0, end: 5 },
    });
    expect(r.kind).toBe("stroke");
    const path = svg.querySelector("path") as SVGElement;
    expect(path.style.stroke).toContain("var(--board-fg");
    expect(path.style.fill).toBe("none");
  });
});

// ── Factories ↔ plan parity + runtime single-pen sampling ───────────────────

describe("factories build 1:1 with planStepUnits (T2↔T3 seam)", () => {
  const host = makeHost([{ x0: 40, y0: 100, x1: 180, y1: 145 }]);
  const { lecture, built } = buildAll(DEMO, host);

  test("demo parses cleanly", () => {
    expect(lecture.errors).toEqual([]);
  });

  test("every performed step: same unit count, same srcSpan per index (G6)", () => {
    let checked = 0;
    for (const { ref, step } of flattenSteps(lecture)) {
      const revealables = built.get(refKey(ref));
      if (!revealables) continue;
      const plan = planStepUnits(step, DEFAULT_DURATIONS);
      expect(revealables).toHaveLength(plan.length);
      plan.forEach((unit, i) => {
        expect(revealables[i]!.srcSpan).toEqual(unit.srcSpan);
        expect(revealables[i]!.naturalDuration).toBeCloseTo(unit.duration, 10);
      });
      checked += plan.length;
    }
    expect(checked).toBeGreaterThan(40); // the demo is not a toy
  });

  test("runtime single-pen sampling: at most ONE unit in progress, ever (G1)", () => {
    const tracked: Array<{ p: number }> = [];
    const wrapped = new Map<string, Revealable[]>();
    for (const [key, revealables] of built) {
      wrapped.set(
        key,
        revealables.map((r) => {
          const state = { p: -1 };
          tracked.push(state);
          return {
            ...r,
            seek(p: number) {
              state.p = p;
              r.seek(p);
            },
          };
        }),
      );
    }
    const timeline = buildTimeline(
      lecture,
      { durations: DEFAULT_DURATIONS },
      { unitsFor: (ref) => wrapped.get(refKey(ref)) },
    );
    expect(timeline.duration).toBeGreaterThan(10);

    for (let t = 0; t <= timeline.duration + 0.1; t += 0.02) {
      timeline.seek(t);
      const inProgress = tracked.filter((s) => s.p > 0 && s.p < 1).length;
      expect(inProgress).toBeLessThanOrEqual(1);
    }
    // After the final seek every unit has been fully performed.
    timeline.seek(timeline.duration + 1);
    expect(tracked.every((s) => s.p === 1)).toBe(true);
  });
});

describe("chart factory — G8-C anchoring + accumulation into the frame", () => {
  const host = makeHost();
  const { lecture, built, nodes } = buildAll(DEMO, host);

  const frameEntry = flattenSteps(lecture).find(
    ({ step }) => step.kind === "chart-frame",
  )!;
  const frameNode = nodes.get(refKey(frameEntry.ref))!;
  const svg = frameNode.querySelector("svg")!;

  test("series labels: text-anchor=end at x = W − 4 (long names extend left)", () => {
    const labels = Array.from(svg.querySelectorAll("text")).filter((t) =>
      t.textContent!.includes("英伟达"),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.getAttribute("text-anchor")).toBe("end");
      expect(label.getAttribute("x")).toBe("896");
      // Color through style, never attribute (G8-D).
      expect((label as SVGElement).style.fill).toContain("var(--s");
      expect(label.getAttribute("fill")).toBeNull();
    }
  });

  test("a later same-name block draws INTO the frame's svg (accumulation)", () => {
    const series = svg.querySelectorAll("[data-bansho-series]");
    expect(series).toHaveLength(2); // 英伟达 (frame) + AMD (layer)
    expect(series[1]!.getAttribute("data-bansho-series")).toBe("AMD");
    // The layer's own node is an empty out-of-flow marker.
    const layerEntry = flattenSteps(lecture).find(
      ({ step }) => step.kind === "chart-layer",
    )!;
    const marker = nodes.get(refKey(layerEntry.ref)) as HTMLElement;
    expect(marker.style.display).toBe("none");
    expect(marker.querySelector("svg")).toBeNull();
  });

  test("mark row lands as accent text BELOW its series point", () => {
    const mark = Array.from(svg.querySelectorAll("text")).find(
      (t) => t.textContent === "35.6B",
    )!;
    expect(mark).toBeDefined();
    expect((mark as SVGElement).style.fill).toContain("var(--accent");
    // Below the point: the series label owns the space above the line end.
    const label = Array.from(svg.querySelectorAll("text")).find((t) =>
      t.textContent!.includes("英伟达"),
    )!;
    expect(Number.parseFloat(mark.getAttribute("y")!)).toBeGreaterThan(
      Number.parseFloat(label.getAttribute("y")!) + 20,
    );
  });

  test("axis skeleton: first two paths are the x → y hand-drawn lines", () => {
    const frame = flattenSteps(lecture).find(
      ({ step }) => step.kind === "chart-frame",
    )!;
    const revealables = built.get(refKey(frame.ref))!;
    // Plan order: axis, axis, ticks…, labels…, series, series-label.
    const plan = planStepUnits(frame.step, DEFAULT_DURATIONS);
    expect(plan[0]!.kind).toBe("axis");
    expect(plan[1]!.kind).toBe("axis");
    expect(revealables[0]!.kind).toBe("stroke");
    expect(revealables[1]!.kind).toBe("stroke");
  });

  test("a mark row BEFORE its series row in the same block still resolves (model-first)", () => {
    // §4.4 imposes no ordering between rows; builders run in row order, so
    // a DOM-only series lookup would find nothing and silently drop the
    // mark while its beat still spent d.label seconds.
    const orderHost = makeHost();
    const { lecture: lec, built: b, nodes: n } = buildAll(
      '```chart 顺序\nx: 1 .. 4\ny: 0 .. 10\n+ mark 系列 @ 4 : "顶点"\n+ 系列: 2 4 6 9\n```\n',
      orderHost,
    );
    expect(lec.errors).toEqual([]);
    const entry = flattenSteps(lec).find(({ step }) => step.kind === "chart-frame")!;
    const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
    const markIndex = plan.findIndex((u) => u.kind === "chart-mark");
    expect(markIndex).toBeGreaterThanOrEqual(0);
    // The mark unit is NOT inert: it wipes in as accent text.
    expect(b.get(refKey(entry.ref))![markIndex]!.kind).toBe("wipe");
    const mark = Array.from(
      n.get(refKey(entry.ref))!.querySelectorAll("text"),
    ).find((t) => t.textContent === "顶点");
    expect(mark).toBeDefined();
    expect((mark as unknown as SVGElement).style.fill).toContain("var(--accent");
  });

  test("a non-numeric interior x on a range axis is refused AND reported (R5)", () => {
    // `x: 2023Q1 .. 2024Q4` — parseFloat used to read 2023/2024/2023 out of
    // the endpoints and the reference, collapsing every non-endpoint quarter
    // to t=0 or 1: the mark mounted ON the y axis (or the far right edge)
    // with no warning. Whole-string parsing must refuse "2023Q3" and mount
    // nothing — a wrong answer is never preferred to an admitted failure.
    //
    // M4: refusing was only half of it. This test used to accept a
    // `console.warn` as proof the degradation was "loud", and console
    // output reaches neither the user nor the agent: `check-board` went on
    // answering ok:true about a board that had silently lost a label. The
    // proof is the channel the agent actually reads — a reported issue,
    // which `check-board` turns into a finding (board-check.test.ts pins
    // that end of it).
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const qHost = makeHost();
      const { lecture: lec, built: b, nodes: n } = buildAll(
        '```chart 季度\nx: 2023Q1 .. 2024Q4\ny: 0 .. 40\n+ 系列: 7 10 14 18 22 26 30 35\n+ mark 系列 @ 2023Q3 : "拐点"\n```\n',
        qHost,
      );
      const entry = flattenSteps(lec).find(({ step }) => step.kind === "chart-frame")!;
      // The board says WHICH row it could not write, and where it sits —
      // and the block itself stays healthy (the chart still draws).
      expect(lec.errors).toHaveLength(1);
      expect(lec.errors[0]).toMatchObject({
        code: "refUnresolved",
        step: entry.ref,
      });
      expect(lec.errors[0]!.excerpt).toContain("2023Q3");
      expect(lec.errors[0]!.message).toContain("x axis");
      expect(flattenSteps(lec).some(({ step }) => step.kind === "bad")).toBe(false);
      const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
      const markIndex = plan.findIndex((u) => u.kind === "chart-mark");
      expect(markIndex).toBeGreaterThanOrEqual(0);
      // The beat keeps parity but is legibly degraded…
      expect(b.get(refKey(entry.ref))![markIndex]!.degraded).toBe(true);
      // …and nothing is mounted at a lying position.
      const mark = Array.from(
        n.get(refKey(entry.ref))!.querySelectorAll("text"),
      ).find((t) => t.textContent === "拐点");
      expect(mark).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  test("range-axis endpoints and numeric interiors still resolve to real marks", () => {
    // Endpoint on the same non-numeric quarter axis — exact match, t=0.
    const eHost = makeHost();
    const { lecture: el1, built: b1, nodes: n1 } = buildAll(
      '```chart 端点\nx: 2023Q1 .. 2024Q4\ny: 0 .. 40\n+ 系列: 7 10 14 18 22 26 30 35\n+ mark 系列 @ 2023Q1 : "起点"\n```\n',
      eHost,
    );
    expect(el1.errors).toEqual([]);
    const e1 = flattenSteps(el1).find(({ step }) => step.kind === "chart-frame")!;
    const p1 = planStepUnits(e1.step, DEFAULT_DURATIONS);
    const m1 = p1.findIndex((u) => u.kind === "chart-mark");
    expect(b1.get(refKey(e1.ref))![m1]!.kind).toBe("wipe");
    expect(b1.get(refKey(e1.ref))![m1]!.degraded).toBeUndefined();
    expect(
      Array.from(n1.get(refKey(e1.ref))!.querySelectorAll("text")).some(
        (t) => t.textContent === "起点",
      ),
    ).toBe(true);

    // Numeric interior on a numeric range axis — interpolates at t = 1/3.
    const iHost = makeHost();
    const { lecture: el2, built: b2, nodes: n2 } = buildAll(
      '```chart 数轴\nx: 1 .. 4\ny: 0 .. 10\n+ 系列: 2 4 6 9\n+ mark 系列 @ 2 : "中点"\n```\n',
      iHost,
    );
    expect(el2.errors).toEqual([]);
    const e2 = flattenSteps(el2).find(({ step }) => step.kind === "chart-frame")!;
    const p2 = planStepUnits(e2.step, DEFAULT_DURATIONS);
    const m2 = p2.findIndex((u) => u.kind === "chart-mark");
    expect(b2.get(refKey(e2.ref))![m2]!.kind).toBe("wipe");
    const mark = Array.from(
      n2.get(refKey(e2.ref))!.querySelectorAll("text"),
    ).find((t) => t.textContent === "中点")!;
    expect(mark).toBeDefined();
    // x = PL + (1/3) × (W − PL − PR) = 96 + 704/3 — a real interior spot.
    expect(Number.parseFloat(mark.getAttribute("x")!)).toBeCloseTo(330.67, 0);
  });

  test("categorical y axis: parity holds and no empty tick <g> is ever mounted", () => {
    const catHost = makeHost();
    const { lecture: lec, built: b, nodes: n } = buildAll(
      "```chart 等级\nx: A .. B\ny: 低 .. 高\n+ s: 1 2\n```\n",
      catHost,
    );
    expect(lec.errors).toEqual([]);
    const entry = flattenSteps(lec).find(({ step }) => step.kind === "chart-frame")!;
    const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
    expect(plan.filter((u) => u.kind === "tick")).toHaveLength(0);
    expect(b.get(refKey(entry.ref))!).toHaveLength(plan.length);
    // No fade beat over an empty group: every mounted <g> has children.
    const chartSvg = n.get(refKey(entry.ref))!.querySelector("svg")!;
    for (const g of Array.from(chartSvg.querySelectorAll("g"))) {
      expect(g.childNodes.length).toBeGreaterThan(0);
    }
  });

  test("a y axis that names a single point is REFUSED, on the channel the agent reads", () => {
    // Three versions of this test, and the middle one is the lesson.
    //  1. Unguarded, `y: 0 .. 0` divided by 0×1.16: every path `d` carried
    //     literal NaN, the browser dropped the paths, and the beats still
    //     spent their seconds — a silently blank chart.
    //  2. Guarded with a data-peak fallback and a `console.warn`, and this
    //     test called that LOUD. It is not: console output reaches neither
    //     the reader nor the agent (the same M4 correction the range-axis
    //     test above carries), so the board drew a real line between two
    //     axis labels that both read 0 and `check-board` answered ok:true.
    //  3. Refused where every other unreadable row is refused — the parser.
    //     One badge, neighbours fine, and the block quoted back.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const decl of ["y: 0 .. 0", "y: 0 ..", "y: 7 .. 7"]) {
        const zHost = makeHost();
        const { lecture: lec, nodes: n } = buildAll(
          `\`\`\`chart 零\nx: 1 .. 4\n${decl}\n+ 系列: 2 4 6 9\n\`\`\`\n`,
          zHost,
        );
        // The board says WHICH row it could not read, and quotes it.
        expect(lec.errors).toHaveLength(1);
        expect(lec.errors[0]!.code).toBe("stepParseError");
        expect(lec.errors[0]!.excerpt).toBe(decl);
        expect(lec.errors[0]!.message).toContain("not an interval");
        // Nothing is drawn against a substituted scale — the block is bad,
        // so there is no chart frame and no svg at all.
        const entry = flattenSteps(lec).find(
          ({ step }) => step.kind === "chart-frame",
        );
        expect(entry).toBeUndefined();
        const bad = flattenSteps(lec).find(({ step }) => step.kind === "bad");
        expect(bad).toBeDefined();
        expect(
          Array.from(n.values()).some((node) => node.querySelector("svg")),
        ).toBe(false);
      }
      // And the console is no longer pretending to be a channel.
      expect(warn.mock.calls.length).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  test("a chart's floor is the DECLARED lower end, not an assumed zero", () => {
    // `y: -3 .. 3` used to scale off the peak alone: the plot ran 0..3.48,
    // so the axis's own lower endpoint mapped to y ≈ 655 in a 420-tall
    // viewBox — the tick, its label and the whole negative half of the data
    // drawn off the canvas, with no parse issue and no finding anywhere.
    const host = makeHost();
    const { lecture: lec, nodes: n } = buildAll(
      '```chart 波\nx: 1 .. 3\ny: -3 .. 3\n+ 振幅: -3 0 3\n```\n',
      host,
    );
    expect(lec.errors).toEqual([]);
    const entry = flattenSteps(lec).find(
      ({ step }) => step.kind === "chart-frame",
    )!;
    const svg = n.get(refKey(entry.ref))!.querySelector("svg")!;
    const viewBox = svg.getAttribute("viewBox")!.split(/\s+/).map(Number);
    const height = viewBox[3]!;

    // Every y tick the axis declares stands INSIDE the canvas… (a y tick
    // label is the one written to the LEFT of the axis line, x = PL − 15.)
    const ticks = Array.from(svg.querySelectorAll("text")).filter(
      (t) => Number.parseFloat(t.getAttribute("x") ?? "0") === 81,
    );
    expect(ticks.map((t) => t.textContent)).toEqual(["-3", "3"]);
    for (const tick of ticks) {
      const y = Number.parseFloat(tick.getAttribute("y")!);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(height);
    }
    // …the declared floor sits ON the baseline, the way 0 always has…
    const low = ticks.find((t) => t.textContent === "-3")!;
    const high = ticks.find((t) => t.textContent === "3")!;
    expect(Number.parseFloat(low.getAttribute("y")!)).toBeGreaterThan(
      Number.parseFloat(high.getAttribute("y")!),
    );
    // …and the series drawn between them stays inside the canvas too.
    const series = svg.querySelector("[data-bansho-series]")!;
    const ys = Array.from(
      series.getAttribute("d")!.matchAll(/[-\d.]+\s+([-\d.]+)/g),
    ).map((m) => Number.parseFloat(m[1]!));
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(height);
    }
  });

  test("a floor of zero scales exactly as it always did", () => {
    // The regression guard for the change above: `y: 0 .. 240` is the
    // declaration every shipped seed uses, and `lo + span × 1.16` must be
    // the same arithmetic as `peak × 1.16` when `lo` is 0 — or the fix
    // re-bases every chart in the corpus for nothing.
    const frame = {
      kind: "chart-frame" as const,
      chart: "c",
      chartType: "line" as const,
      y: { from: "0", to: "240", srcSpan: { start: 0, end: 1 } },
      rows: [],
      srcSpan: { start: 0, end: 1 },
    };
    const { Y } = chartScales(frame as never);
    const H = 420;
    const PT = 26;
    const PB = 56;
    const peakOnly = (v: number): number =>
      H - PB - (v / (240 * 1.16)) * (H - PT - PB);
    for (const v of [0, 1, 60, 120, 240, 300]) {
      expect(Y(v)).toBeCloseTo(peakOnly(v), 10);
    }
  });

  test("a note row's partial-numeric y is refused AND reported (R5)", () => {
    // The x side was hardened to whole-string parsing; the note branch kept
    // prefix parseFloat, so `+ note @ 2 : 40abc : "…"` placed the note at
    // y=40 — the same silent-misplacement class, one line from its fix.
    // Same M4 correction as the mark above: refusing to draw is only half,
    // the row that was not written has to reach the agent's own report.
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const nHost = makeHost();
      const { lecture: lec, built: b, nodes: n } = buildAll(
        '```chart 注\nx: 1 .. 4\ny: 0 .. 50\n+ 系列: 2 4 6 9\n+ note @ 2 , 40abc : "假高度"\n```\n',
        nHost,
      );
      const entry = flattenSteps(lec).find(
        ({ step }) => step.kind === "chart-frame",
      )!;
      expect(lec.errors).toHaveLength(1);
      expect(lec.errors[0]).toMatchObject({
        code: "refUnresolved",
        step: entry.ref,
      });
      expect(lec.errors[0]!.excerpt).toContain("40abc");
      const plan = planStepUnits(entry.step, DEFAULT_DURATIONS);
      const noteIndex = plan.findIndex((u) => u.kind === "chart-note");
      expect(noteIndex).toBeGreaterThanOrEqual(0);
      expect(b.get(refKey(entry.ref))![noteIndex]!.degraded).toBe(true);
      expect(
        Array.from(n.get(refKey(entry.ref))!.querySelectorAll("text")).find(
          (t) => t.textContent === "假高度",
        ),
      ).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  test("mark/note text near the LEFT edge anchors start so it cannot clip (G8-C mirror)", () => {
    // A mark at t≈0 sits at x = PL = 96 with text-anchor=middle, so a long
    // CJK label (~190px at font-size 19) extended past x=0 and clipped at
    // the viewBox edge — the mirrored side of the overflow G8-C prevents.
    const lHost = makeHost();
    const { lecture: lec, nodes: n } = buildAll(
      '```chart 左\nx: 1 .. 4\ny: 0 .. 10\n+ 系列: 2 4 6 9\n+ mark 系列 @ 1 : "很长的左边缘注释文本"\n```\n',
      lHost,
    );
    expect(lec.errors).toEqual([]);
    const entry = flattenSteps(lec).find(
      ({ step }) => step.kind === "chart-frame",
    )!;
    const mark = Array.from(
      n.get(refKey(entry.ref))!.querySelectorAll("text"),
    ).find((t) => t.textContent === "很长的左边缘注释文本")!;
    expect(mark).toBeDefined();
    expect(mark.getAttribute("text-anchor")).toBe("start");
  });

  test("rebuilding the same layer is idempotent — no duplicate series, no color shift (R4′)", () => {
    const rebuildHost = makeHost();
    const { lecture: lec } = buildAll(DEMO, rebuildHost);
    const layerEntry = flattenSteps(lec).find(
      ({ step }) => step.kind === "chart-layer",
    )!;
    const rebuildSvg = rebuildHost.containers.get("chart:revenue")!.node.querySelector("svg")!;
    const amdColor = () =>
      (
        Array.from(rebuildSvg.querySelectorAll("[data-bansho-series]")).find(
          (p) => p.getAttribute("data-bansho-series") === "AMD",
        ) as SVGElement
      ).style.stroke;
    expect(rebuildSvg.querySelectorAll("[data-bansho-series]")).toHaveLength(2);
    const colorBefore = amdColor();
    expect(colorBefore).toContain("var(--s2"); // second mounted series
    // A same-content rebuild (R4' recompile) clears the layer's own tagged
    // contribution first — series count and seriesColor index both hold.
    factoryFor("chart-layer")!.build(layerEntry.step, rebuildHost.ctx);
    expect(rebuildSvg.querySelectorAll("[data-bansho-series]")).toHaveLength(2);
    expect(amdColor()).toBe(colorBefore);
    // The mark text is re-mounted once, not accumulated.
    const marks = Array.from(rebuildSvg.querySelectorAll("text")).filter(
      (t) => t.textContent === "35.6B",
    );
    expect(marks).toHaveLength(1);
  });

  test("rebuilding a NON-last layer shifts seriesColor — the R4′ cascade is required", () => {
    // The idempotence boundary the factory JSDoc names: series index is a
    // live DOM count at build time, so a lone rebuild of layer A (with
    // layer B mounted after it) re-appends A's nodes at the end — count
    // stays right (no duplicates) but A's color flips. This is exactly why
    // the host MUST honour the cascade (rebuild frame, re-run all layers
    // in order); if this test ever fails because the color held, the
    // factory became truly idempotent — update the JSDoc boundary with it.
    const host2 = makeHost();
    const twoLayers =
      "```chart c\nx: 1 .. 4\ny: 0 .. 10\n```\n\n" +
      "```chart c\n+ 甲: 1 2 3 4\n```\n\n" +
      "```chart c\n+ 乙: 2 3 4 5\n```\n";
    const { lecture: lec } = buildAll(twoLayers, host2);
    expect(lec.errors).toEqual([]);
    const layers = flattenSteps(lec).filter(({ step }) => step.kind === "chart-layer");
    expect(layers).toHaveLength(2);
    const svg = host2.containers.get("chart:c")!.node.querySelector("svg")!;
    const colorOf = (name: string) =>
      (
        Array.from(svg.querySelectorAll("[data-bansho-series]")).find(
          (p) => p.getAttribute("data-bansho-series") === name,
        ) as SVGElement
      ).style.stroke;
    expect(colorOf("甲")).toContain("var(--s1"); // first mounted
    expect(colorOf("乙")).toContain("var(--s2"); // second mounted
    // Lone rebuild of the FIRST layer (not last-mounted): no duplicates…
    factoryFor("chart-layer")!.build(layers[0]!.step, host2.ctx);
    expect(svg.querySelectorAll("[data-bansho-series]")).toHaveLength(2);
    // …but 甲 re-appends after 乙 and its index — hence color — shifts.
    expect(colorOf("甲")).toContain("var(--s2");
  });

  test("orphan layer (no frame in ctx) degrades to inert parity, no throw", () => {
    const lonely = parseLecture(
      "```chart 有frame\nx: 1 .. 2\ny: 0 .. 10\n```\n\n```chart 有frame\n+ 系列: 1 2\n```\n",
    );
    const bare = makeHost(); // deliberately never registers the frame
    const layer = flattenSteps(lonely).find(({ step }) => step.kind === "chart-layer")!;
    const { revealables } = factoryFor("chart-layer")!.build(layer.step, bare.ctx);
    const plan = planStepUnits(layer.step, DEFAULT_DURATIONS);
    expect(revealables).toHaveLength(plan.length);
    for (const r of revealables) expect(() => r.seek(0.5)).not.toThrow();
  });
});

describe("backref factory — the pen turns back through the host seam", () => {
  const source = '写下 874 这个数字。\n\n@circle "874"\n';

  test("with the seam: one gesture path over the measured rows", () => {
    const host = makeHost([{ x0: 40, y0: 100, x1: 180, y1: 145 }]);
    const { lecture, built, nodes } = buildAll(source, host);
    expect(lecture.errors).toEqual([]);
    const backref = flattenSteps(lecture).find(({ step }) => step.kind === "backref")!;
    const revealables = built.get(refKey(backref.ref))!;
    expect(revealables).toHaveLength(1);
    expect(revealables[0]!.kind).toBe("stroke"); // circle gesture
    const node = nodes.get(refKey(backref.ref))!;
    expect(node.querySelectorAll("path")).toHaveLength(1);
  });

  test("@highlight: the band lands in the UNDER layer, never over the glyphs", () => {
    const host = makeHost([{ x0: 40, y0: 100, x1: 180, y1: 145 }]);
    const { lecture, nodes } = buildAll('写下 874 这个数字。\n\n@highlight "874"\n', host);
    expect(lecture.errors).toEqual([]);
    const backref = flattenSteps(lecture).find(({ step }) => step.kind === "backref")!;
    const node = nodes.get(refKey(backref.ref))!;
    const under = node.querySelector(".bansho-backref-under") as SVGElement;
    const over = node.querySelector(".bansho-backref-over") as SVGElement;
    expect(under.style.zIndex).toBe("0");
    expect(over.style.zIndex).toBe("2");
    // The filled band (and its clip defs) live under; nothing strokes over.
    expect(under.querySelectorAll("path")).toHaveLength(1);
    expect((under.querySelector("path") as SVGElement).style.fill).toContain("var(--hl");
    expect(under.querySelectorAll("defs clipPath rect")).toHaveLength(1);
    expect(over.querySelectorAll("path")).toHaveLength(0);
  });

  test("@circle: the stroke gesture lands in the OVER layer", () => {
    const host = makeHost([{ x0: 40, y0: 100, x1: 180, y1: 145 }]);
    const { lecture, nodes } = buildAll(source, host);
    const backref = flattenSteps(lecture).find(({ step }) => step.kind === "backref")!;
    const node = nodes.get(refKey(backref.ref))!;
    expect(node.querySelectorAll(".bansho-backref-over path")).toHaveLength(1);
    expect(node.querySelectorAll(".bansho-backref-under path")).toHaveLength(0);
  });

  test("without the seam: inert unit, parity kept, nothing drawn", () => {
    const host = makeHost(); // no backRef seam
    const { built, nodes, lecture } = buildAll(source, host);
    const backref = flattenSteps(lecture).find(({ step }) => step.kind === "backref")!;
    const revealables = built.get(refKey(backref.ref))!;
    expect(revealables).toHaveLength(1);
    // The degradation is legible end-to-end: the unit says so itself.
    expect(revealables[0]!.degraded).toBe(true);
    const node = nodes.get(refKey(backref.ref))!;
    expect(node.querySelectorAll("path")).toHaveLength(0);
    expect(() => revealables[0]!.seek(0.7)).not.toThrow();
  });
});

// ── Determinism — content-derived seeds (T3-review: "种子从哪来?") ──────────

describe("determinism — same content, byte-identical jitter", () => {
  const geometry = (source: string): string[] => {
    const host = makeHost([{ x0: 40, y0: 100, x1: 180, y1: 145 }]);
    const { nodes } = buildAll(source, host);
    const ds: string[] = [];
    for (const node of nodes.values()) {
      for (const path of Array.from(node.querySelectorAll("path"))) {
        ds.push(path.getAttribute("d")!);
      }
    }
    return ds;
  };

  const body = '# 标题\n\n---\n\n```chart c\nx: 1 .. 4\ny: 0 .. 10\n+ 系列: 1 5 3 9\n```\n\n@strike "标题"\n';

  test("rebuilding the same board reproduces every path byte-for-byte", () => {
    expect(geometry(body)).toEqual(geometry(body));
  });

  test("a prefix edit shifts offsets but not the jitter (content seeds)", () => {
    const shifted = "前面插入了一段新的话。\n\n" + body;
    const a = geometry(body);
    const b = geometry(shifted);
    // The shifted board has the same drawable steps plus a prose step
    // (which contributes no paths of its own in a layout-free host).
    expect(b).toEqual(a);
  });
});

// ── G8-A — env probe: canvas RASTER comparison, never fonts.check() ─────────

/**
 * The probe compares what the declared stack DRAWS against what the known
 * fallback draws. It used to compare advance widths, and on 2026-08-17 that
 * cost the board three simultaneous false alarms: Han is full-width in every
 * CJK face, so a `slate-cursive` board drawing `Xingkai SC` measured exactly
 * what 苹方 measures and reported its own hand inactive. The machine below
 * ties every CJK advance on purpose (see `fake-font-machine.ts`), so a width
 * probe cannot pass these tests and a raster probe can.
 */
describe("G8-A — handwriting font probe compares rasters on canvas", () => {
  test("drawing something other than the known fallback → font is ACTIVE", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(probeEnvCaps(m.document).handwritingFontActive).toBe(true);
  });

  test("identical ink = silent fallback (the Hannotate trap) → NOT active", () => {
    // The candidate is not on this machine, so naming it draws 苹方 — which
    // is precisely what the comparison is against.
    const faces = { ...MACOS_LIKE.faces };
    delete (faces as Record<string, unknown>)["HanziPen SC"];
    const m = fakeFontMachine({ ...MACOS_LIKE, faces });
    expect(probeEnvCaps(m.document).handwritingFontActive).toBe(false);
  });

  test("no canvas 2d context → degrades to inactive, never throws", () => {
    const doc = {
      createElement: () => ({ getContext: () => null }),
    } as unknown as Document;
    expect(probeEnvCaps(doc).handwritingFontActive).toBe(false);
  });

  test("stroke font (Hershey) is not vendored yet — covers nothing", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(probeEnvCaps(m.document).strokeFontCovers("abc")).toBe(false);
  });

  // §6.3 makes the `--hand` stack the SEED's property, so probing a
  // hardcoded face answers the wrong question in both directions.
  test("the DECLARED stack is what gets measured, verbatim", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    const caps = probeEnvCaps(m.document, {
      stacks: [`"Comic Relief", "HanziPen SC", cursive`],
    });
    expect(caps.handwritingFontActive).toBe(true);
    // The whole list reaches `ctx.font` — quoting it as one family name
    // would make every declared stack measure as the fallback.
    expect(m.fontsDrawn).toContain(
      `28px "Comic Relief", "HanziPen SC", cursive`,
    );
  });

  test("a seed stack with NO handwriting face fails the check, not passes it", () => {
    // The trap the chip exists to catch, arriving through a seed instead of
    // through a missing system font.
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      probeEnvCaps(m.document, {
        stacks: [`"PingFang SC", sans-serif`],
      }).handwritingFontActive,
    ).toBe(false);
    // Positive control on the SAME machine: a valid handwriting stack
    // passes — proving the assertion above fails for the right reason.
    expect(
      probeEnvCaps(m.document, {
        stacks: [`"HanziPen SC", cursive`],
      }).handwritingFontActive,
    ).toBe(true);
  });

  test("a stack that degrades in only ONE theme still raises the chip", () => {
    // EnvCaps is session-fixed (§5.2) — the probe cannot re-run when the
    // user flips the theme, so both declared variants must hold now.
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      probeEnvCaps(m.document, {
        stacks: [`"HanziPen SC", cursive`, `"Chalkboard SE", sans-serif`],
      }).handwritingFontActive,
    ).toBe(false);
    expect(
      probeEnvCaps(m.document, {
        stacks: [`"HanziPen SC", cursive`, `"Bradley Hand", "HanziPen SC"`],
      }).handwritingFontActive,
    ).toBe(true);
  });

  test("nothing declared → the hardcoded candidate, quoted as one family", () => {
    const m = fakeFontMachine(MACOS_LIKE);
    expect(
      probeEnvCaps(m.document, { stacks: [] }).handwritingFontActive,
    ).toBe(true);
    expect(m.fontsDrawn).toContain(`28px "HanziPen SC"`);
  });
});

// `readHandStacks` reads a real computed style — happy-dom, not the fake
// canvas doc above.
describe("G8-A — the declared --hand stack is read off the board surface", () => {
  const docWith = (css: string): Document => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    const style = doc.createElement("style");
    style.textContent = css;
    doc.head.appendChild(style);
    return doc;
  };

  test("both theme variants are collected", () => {
    const stacks = readHandStacks(
      docWith(`
        .bansho-board-surface { --hand: "Bradley Hand", cursive; }
        .bansho-board-surface[data-bansho-theme="dark"] { --hand: "Chalkboard SE", cursive; }
      `),
    );
    expect(stacks).toEqual([`"Bradley Hand", cursive`, `"Chalkboard SE", cursive`]);
  });

  test("a seed's theme.css override is what comes back, not the base stack", () => {
    // Same selectors, injected after the base sheet — equal specificity,
    // later wins. This is the whole mechanism §6.3 hands the seed.
    const stacks = readHandStacks(
      docWith(`
        .bansho-board-surface { --hand: "Bradley Hand", cursive; }
        .bansho-board-surface { --hand: "Comic Relief", cursive; }
      `),
    );
    expect(stacks).toEqual([`"Comic Relief", cursive`]);
  });

  test("a LIGHT-scoped seed override is measured — the attribute is never absent", () => {
    // BoardCanvas renders `data-bansho-theme={theme}` with theme forced to
    // "light" | "dark" (ViewerPreviewProps) — the attribute is ALWAYS
    // present. Probing an attribute-less element measured a DOM state the
    // board is never in: a seed that scopes its light override as
    // [data-bansho-theme="light"] (the natural mirror of the dark rule)
    // escaped the G8-A check entirely and got a clean bill of health.
    const stacks = readHandStacks(
      docWith(`
        .bansho-board-surface { --hand: "Bradley Hand", cursive; }
        .bansho-board-surface[data-bansho-theme="light"] { --hand: "Hannotate SC", cursive; }
        .bansho-board-surface[data-bansho-theme="dark"] { --hand: "Chalkboard SE", cursive; }
      `),
    );
    expect(stacks).toContain(`"Hannotate SC", cursive`);
    expect(stacks).toContain(`"Chalkboard SE", cursive`);
  });

  test("one stack for both themes is reported once", () => {
    const stacks = readHandStacks(
      docWith(`.bansho-board-surface { --hand: "Bradley Hand", cursive; }`),
    );
    expect(stacks).toEqual([`"Bradley Hand", cursive`]);
  });

  test("no board styles attached → nothing declared (never throws)", () => {
    expect(readHandStacks(docWith(""))).toEqual([]);
  });

  test("the probe element is removed again", () => {
    const doc = docWith(`.bansho-board-surface { --hand: cursive; }`);
    readHandStacks(doc);
    expect(doc.querySelectorAll(".bansho-board-surface").length).toBe(0);
  });

  // T7-review F6 — against the REAL base sheet, in the REAL injection order
  // (BanshoPreview renders <style data-bansho-base> and then <style
  // data-bansho-theme-css> as siblings).
  describe("a theme.css written the way references/themes.md teaches wins", () => {
    const THEME_ONE_RULE = `.bansho-board-surface { --hand: "Papyrus", "HanziPen SC", cursive; }`;
    const base = (extra = "") => docWith(`${BOARD_BASE_CSS}\n${extra}`);

    test("with no theme, each board keeps its own default hand", () => {
      const stacks = readHandStacks(base());
      expect(stacks).toHaveLength(2);
      expect(stacks[0]).toContain("Bradley Hand");
      expect(stacks[1]).toContain("Chalkboard SE");
    });

    test("ONE declaration reaches both boards — not just the light one", () => {
      // The whole finding: the dark default used to be written
      // `[data-bansho-theme="dark"]` (0,2,0) and silently beat this rule
      // (0,1,0), so the board wrote in Chalkboard SE in the dark while the
      // §6.4-A chip stayed green — the declared face was simply not the
      // face. `:where()` drops the default to the same weight, and later
      // wins. Measured in a real browser too: canvas measureText on the
      // dark board reads the theme's width, not Chalkboard's.
      const stacks = readHandStacks(base(THEME_ONE_RULE));
      expect(stacks).toEqual([`"Papyrus", "HanziPen SC", cursive`]);
    });

    test("a theme that wants a different dark hand can still say so", () => {
      const stacks = readHandStacks(
        base(
          `${THEME_ONE_RULE}\n.bansho-board-surface[data-bansho-theme="dark"] { --hand: "Marker Felt", cursive; }`,
        ),
      );
      expect(stacks).toEqual([
        `"Papyrus", "HanziPen SC", cursive`,
        `"Marker Felt", cursive`,
      ]);
    });

    test("the colors do NOT follow: light-only stays light-only", () => {
      // Deliberate asymmetry, and the reason `:where()` is on the --hand
      // rule alone: a parchment board must not stay parchment in the dark,
      // so a theme that declares only the light palette still inherits the
      // stock dark one.
      const doc = base(`.bansho-board-surface { --board: #f6f1e7; }`);
      const probe = doc.createElement("div");
      probe.className = "bansho-board-surface";
      probe.setAttribute("data-bansho-theme", "dark");
      doc.body.appendChild(probe);
      const board = doc.defaultView!.getComputedStyle(probe)
        .getPropertyValue("--board")
        .trim();
      expect(board).toBe("#22302a");
    });
  });
});
