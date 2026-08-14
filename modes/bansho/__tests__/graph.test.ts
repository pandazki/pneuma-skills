/**
 * ```graph``` structure blocks (T12) — the chart's sibling.
 *
 * A graph is the SAME primitive as a chart: a named accumulating container
 * (§4.4). First block for a name declares the container, later same-name
 * blocks accumulate into it, one pen at a time (G1), every node and every
 * edge naming its own source range (G6).
 *
 * The one thing a graph cannot borrow from a chart is the coordinate
 * system: a chart's author declares the axes up front, a graph's layout is
 * computed. So the layout authority is the FRAME, and the frame carries the
 * container's accumulated union — `graphLayout(frame)` is the exact analogue
 * of `chartScales(frame)`. Because the union grows, appending a block
 * re-runs layout over the whole union and rebuilds the whole container —
 * already-drawn boxes MOVE (pinned below); only a chart's declared axes buy
 * append-stability.
 */

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

import { graphNoteWrites, parseLecture } from "../domain.js";
import { containerKeyOf } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor } from "../engine/factories/index.js";
import {
  arrowEndpoints,
  arrowKey,
  graphFillWidth,
  graphLayout,
  graphPrefixFlowHeights,
} from "../engine/factories/graph.js";
import { BOARD_BODY_FS, BOARD_H2_FS } from "../engine/layout.js";
import { planLecture, planStepUnits } from "../engine/inference.js";
import { BOARD_BASE_CSS } from "../viewer/board-css.js";
import {
  planReconcile,
  toEntries,
  type BuiltStepState,
  type ReconcileEntry,
} from "../viewer/reconcile.js";
import type {
  ContainerHome,
  GraphFrameStep,
  GraphLayerStep,
  MeasureContext,
  Revealable,
  Step,
} from "../engine/types.js";

const D = DEFAULT_DURATIONS;

/** The spec's own example board (T12) — one chain per line. */
const FLOW = [
  "```graph 数据流",
  "讲稿 → 推断 → 时间轴 → 播放",
  "推断 → 语音合成",
  "语音合成 → 播放",
  "推断: 把讲稿变成串行 step",
  "```",
].join("\n");

function stepsOf(src: string): Step[] {
  const lecture = parseLecture(src);
  return lecture.sections.flatMap((s) => s.steps);
}

function frameOf(src: string): GraphFrameStep {
  const step = stepsOf(src).find((s) => s.kind === "graph-frame");
  if (!step || step.kind !== "graph-frame") {
    throw new Error(`no graph frame parsed from:\n${src}`);
  }
  return step;
}

describe("dialect — ```graph <name> reads like a script, not a config", () => {
  test("a chain line builds nodes and edges in reading order", () => {
    const frame = frameOf(FLOW);
    expect(frame.graph).toBe("数据流");
    expect(frame.nodes.map((n) => n.name)).toEqual([
      "讲稿",
      "推断",
      "时间轴",
      "播放",
      "语音合成",
    ]);
    expect(frame.edges.map((e) => `${e.from}→${e.to}`)).toEqual([
      "讲稿→推断",
      "推断→时间轴",
      "时间轴→播放",
      "推断→语音合成",
      "语音合成→播放",
    ]);
  });

  test("`->` is the same arrow as `→`", () => {
    const frame = frameOf("```graph f\na -> b\n```");
    expect(frame.edges.map((e) => `${e.from}→${e.to}`)).toEqual(["a→b"]);
  });

  test("the node name IS the node — repeating it is the same node", () => {
    const frame = frameOf(FLOW);
    // 推断 and 播放 each appear on several lines; the union holds one of each.
    expect(frame.layout.nodes.filter((n) => n.name === "推断")).toHaveLength(1);
    expect(frame.layout.nodes.filter((n) => n.name === "播放")).toHaveLength(1);
  });

  test("a `名字: 说明` line annotates the node without inventing a second one", () => {
    const frame = frameOf(FLOW);
    const inferred = frame.layout.nodes.find((n) => n.name === "推断");
    expect(inferred?.note).toBe("把讲稿变成串行 step");
    expect(frame.nodes.map((n) => n.name)).not.toContain("把讲稿变成串行 step");
  });

  test("a bare line is a lone node — a thing mentioned with nothing hanging off it", () => {
    const frame = frameOf("```graph f\n孤岛\n```");
    expect(frame.nodes.map((n) => n.name)).toEqual(["孤岛"]);
    expect(frame.edges).toHaveLength(0);
  });

  test("G6 — every node and every edge names its own source range", () => {
    const src = FLOW;
    const frame = frameOf(src);
    for (const node of frame.nodes) {
      expect(src.slice(node.srcSpan.start, node.srcSpan.end)).toBe(node.name);
    }
    for (const edge of frame.edges) {
      const slice = src.slice(edge.srcSpan.start, edge.srcSpan.end);
      expect(slice.startsWith(edge.from)).toBe(true);
      expect(slice.endsWith(edge.to)).toBe(true);
      // The span is the arrow's own segment, never the whole block (G6:
      // 整块共享一个区间已被原型证伪).
      expect(edge.srcSpan.end - edge.srcSpan.start).toBeLessThan(
        frame.srcSpan.end - frame.srcSpan.start,
      );
    }
  });

  test("R6 — a broken row fails exactly one block, and says what it expected", () => {
    const src = "前言\n\n```graph f\na → → b\n```\n\n后话";
    const lecture = parseLecture(src);
    const kinds = lecture.sections[0]!.steps.map((s) => s.kind);
    expect(kinds).toEqual(["prose", "bad", "prose"]);
    expect(lecture.errors).toHaveLength(1);
    expect(lecture.errors[0]!.message).toContain("empty");
  });

  test("a graph block with no name is one bad step, like a chart with none", () => {
    const lecture = parseLecture("```graph\na → b\n```");
    expect(lecture.sections[0]!.steps[0]!.kind).toBe("bad");
    expect(lecture.errors[0]!.message).toContain("name");
  });
});

describe("accumulation — the same container, written twice", () => {
  const SRC = [
    "```graph 流程",
    "取材 → 起稿",
    "```",
    "",
    "中间说点别的。",
    "",
    "```graph 流程",
    "起稿 → 定稿",
    "```",
  ].join("\n");

  test("the second block accumulates as a layer into the first", () => {
    const steps = stepsOf(SRC);
    expect(steps.map((s) => s.kind)).toEqual([
      "graph-frame",
      "prose",
      "graph-layer",
    ]);
    const layer = steps[2] as GraphLayerStep;
    expect(layer.graph).toBe("流程");
    // Only what is NEW is this block's to draw: 起稿 already stands.
    expect(layer.nodes.map((n) => n.name)).toEqual(["定稿"]);
    expect(layer.edges.map((e) => `${e.from}→${e.to}`)).toEqual(["起稿→定稿"]);
  });

  test("the frame carries the whole container's union — the layout authority", () => {
    const frame = stepsOf(SRC)[0] as GraphFrameStep;
    expect(frame.layout.nodes.map((n) => n.name)).toEqual([
      "取材",
      "起稿",
      "定稿",
    ]);
    expect(frame.layout.edges.map((e) => `${e.from}→${e.to}`)).toEqual([
      "取材→起稿",
      "起稿→定稿",
    ]);
  });

  test("a repeated edge is drawn once — first appearance owns it", () => {
    const steps = stepsOf(
      "```graph g\na → b\n```\n\n```graph g\na → b\nb → c\n```",
    );
    const layer = steps[1] as GraphLayerStep;
    expect(layer.edges.map((e) => `${e.from}→${e.to}`)).toEqual(["b→c"]);
  });

  test("chart and graph share ONE container vocabulary, namespaced by kind", () => {
    const steps = stepsOf(
      "```chart 同名\nx: a b\ny: 0 .. 10\n```\n\n```graph 同名\na → b\n```",
    );
    // Same name, different container kinds — never the same home.
    expect(containerKeyOf(steps[0]!)).toBe("chart:同名");
    expect(containerKeyOf(steps[1]!)).toBe("graph:同名");
    expect(steps[1]!.kind).toBe("graph-frame");
  });
});

describe("streaming — what an appended block invalidates (§7 R1/R4)", () => {
  const build = (src: string) => {
    const entries = toEntries(parseLecture(src));
    return { entries, prev: entries.map(stateOf) };
  };
  const stateOf = (e: ReconcileEntry): BuiltStepState => ({
    hash: e.hash,
    ...(containerKeyOf(e.step) !== undefined
      ? { container: containerKeyOf(e.step)! }
      : {}),
  });

  test("appending a graph block rebuilds its whole container — the frame owns the layout", () => {
    const { prev } = build("```graph g\na → b\n```");
    const next = toEntries(
      parseLecture("```graph g\na → b\n```\n\n```graph g\nb → c\n```"),
    );
    const plan = planReconcile(prev, next);
    // The frame is rebuilt even though its own bytes never moved: its union
    // — and with it the layout every block draws against — just grew.
    expect(plan.rebuild).toEqual([0, 1]);
  });

  test("appending a CHART layer still accumulates — declared axes earn that", () => {
    const { prev } = build("```chart c\nx: a b\ny: 0 .. 10\n+ 甲: 1 2\n```");
    const next = toEntries(
      parseLecture(
        "```chart c\nx: a b\ny: 0 .. 10\n+ 甲: 1 2\n```\n\n```chart c\n+ 乙: 3 4\n```",
      ),
    );
    const plan = planReconcile(prev, next);
    expect(plan.rebuild).toEqual([1]);
    expect(plan.reuse).toEqual([0]);
  });

  test("prose appended after a graph leaves the graph alone (R1 zero replay)", () => {
    const { prev } = build("```graph g\na → b\n```");
    const next = toEntries(parseLecture("```graph g\na → b\n```\n\n后面一句话。"));
    const plan = planReconcile(prev, next);
    expect(plan.rebuild).toEqual([1]);
    expect(plan.reuse).toEqual([0]);
  });
});

describe("plan — one pen, boxes then their names, arrows last (G1)", () => {
  test("a block plans box → label per node, then every edge", () => {
    const frame = frameOf("```graph g\na → b\n```");
    const units = planStepUnits(frame, D);
    expect(units.map((u) => u.kind)).toEqual([
      "graph-node",
      "graph-label",
      "graph-node",
      "graph-label",
      "graph-edge",
    ]);
    // Every unit carries a source range (G6) and positive time.
    for (const u of units) {
      expect(u.srcSpan.end).toBeGreaterThan(u.srcSpan.start);
      expect(u.duration).toBeGreaterThan(0);
    }
  });

  test("an annotated node writes its note in the same hand as its name", () => {
    const bare = planStepUnits(frameOf("```graph g\na\n```"), D);
    const noted = planStepUnits(
      frameOf("```graph g\na: 一句解释\n```"),
      D,
    );
    const bareLabel = bare.find((u) => u.kind === "graph-label")!;
    const notedLabel = noted.find((u) => u.kind === "graph-label")!;
    expect(notedLabel.duration).toBeGreaterThan(bareLabel.duration);
  });

  test("a graph gets the same turn-to-the-board lead-in as a chart", () => {
    const plans = planLecture(parseLecture("一句话。\n\n```graph g\na → b\n```"), D);
    const graph = plans.find((p) => p.step.kind === "graph-frame")!;
    expect(graph.leadIn).toBeCloseTo(D.paraGap + D.chartLead, 10);
    const layerPlans = planLecture(
      parseLecture("```graph g\na → b\n```\n\n```graph g\nb → c\n```"),
      D,
    );
    const layer = layerPlans.find((p) => p.step.kind === "graph-layer")!;
    expect(layer.leadIn).toBeLessThan(graph.leadIn);
  });
});

describe("layout — dagre is a test gate, not a promise", () => {
  const frame = frameOf(FLOW);

  test("determinism: the same graph lays out byte-identically, twice", () => {
    const a = graphLayout(frame);
    const b = graphLayout(frame);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("determinism survives a re-parse of the same source", () => {
    const a = graphLayout(frame);
    const b = graphLayout(frameOf(FLOW));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("every node in the union gets a box, and boxes never overlap", () => {
    const layout = graphLayout(frame);
    expect(layout.boxes.size).toBe(frame.layout.nodes.length);
    const boxes = [...layout.boxes.values()];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps).toBe(false);
      }
    }
  });

  test("an explanation widens its box before it wraps, and never splits a word", () => {
    // Both halves come from the first G7 pass: a name-sized box broke one
    // clause into three cramped lines, and the greedy wrap cut "step" into
    // "ste" + "p" — which reads as a rendering fault, not a line break.
    const layout = graphLayout(
      frameOf("```graph g\n推断\n推断: 把讲稿变成串行 step\n```"),
    );
    const box = layout.boxes.get("推断")!;
    expect(box.noteLines).toEqual(["把讲稿变成串行 step"]);
    expect(box.w).toBeGreaterThan(150);
  });

  test("a long explanation wraps at a CJK glyph and NOTHING is cut", () => {
    // A three-line budget used to discard the rest, with no badge, no
    // degraded beat and no finding — the board silently editing the
    // lecture, findable only by counting glyphs on a photograph. Now the
    // box grows to hold what was written, which is a consequence the
    // author can see.
    const long =
      "这是一句相当长的说明文字用来把方框的宽度顶到上限并且继续往下换行直到超过预算为止再继续写下去还要更长一些才够";
    const layout = graphLayout(frameOf(`\`\`\`graph g\n节点: ${long}\n\`\`\``));
    const box = layout.boxes.get("节点")!;
    expect(box.noteLines.length).toBeGreaterThan(3);
    // Every glyph the author wrote is on the board, in order.
    expect(box.noteLines.join("")).toBe(long);
    // The box stays inside the declared maximum WIDTH however long the text
    // is — it grows downward, the direction a board has room in. The
    // maximum is eleven glyphs of the board's own hand, so it is written
    // that way rather than as a number that has to be chased when the
    // board's type scale moves (it just did: 260 was eleven glyphs of a
    // 24px hand nobody had tied to anything).
    expect(box.w).toBeLessThanOrEqual(BOARD_BODY_FS * 11);
    // Deeper than a name plus three explanation lines, whatever the scale:
    // padding + one name line + more than three note lines.
    const noteFs = Math.round((BOARD_BODY_FS * 2) / 3);
    expect(box.h).toBeGreaterThan(
      Math.round(BOARD_BODY_FS * 0.58) * 2 +
        Math.round(BOARD_BODY_FS * 1.25) +
        3 * Math.round(noteFs * 1.31),
    );
  });


  const onEdge = (
    x: number,
    y: number,
    b: { x: number; y: number; w: number; h: number },
  ): boolean => {
    const dx = Math.min(Math.abs(x - b.x), Math.abs(x - (b.x + b.w)));
    const dy = Math.min(Math.abs(y - b.y), Math.abs(y - (b.y + b.h)));
    const inside =
      x >= b.x - 0.02 &&
      x <= b.x + b.w + 0.02 &&
      y >= b.y - 0.02 &&
      y <= b.y + b.h + 0.02;
    return inside && Math.min(dx, dy) < 0.02;
  };

  test("an arrow lands ON the target box's edge — never inside, never floating", () => {
    const layout = graphLayout(frame);
    for (const edge of frame.layout.edges) {
      const from = layout.boxes.get(edge.from)!;
      const to = layout.boxes.get(edge.to)!;
      const route = layout.arrows.get(arrowKey(edge.from, edge.to))!;
      const [x1, y1] = route[0]!;
      const [x2, y2] = route[route.length - 1]!;
      expect(onEdge(x2, y2, to)).toBe(true);
      expect(onEdge(x1, y1, from)).toBe(true);
    }
    // The straight two-box case answers the same question by construction.
    const a = layout.boxes.get("讲稿")!;
    const b = layout.boxes.get("推断")!;
    const straight = arrowEndpoints(a, b);
    expect(onEdge(straight.x2, straight.y2, b)).toBe(true);
  });

  test("an arrow that skips a rank goes AROUND the boxes, not through them", () => {
    // Straight centre-to-centre routing put a→d clean through b (measured
    // before the fix). The layout reserves a corridor for a skipping edge;
    // the arrow has to travel it.
    const skipping = frameOf("```graph g\na → b → c → d\na → d\nb → d\n```");
    const layout = graphLayout(skipping);
    for (const edge of skipping.layout.edges) {
      const route = layout.arrows.get(arrowKey(edge.from, edge.to))!;
      for (const box of layout.boxes.values()) {
        if (box.name === edge.from || box.name === edge.to) continue;
        for (let s = 1; s < route.length; s++) {
          const [ax, ay] = route[s - 1]!;
          const [bx, by] = route[s]!;
          for (let i = 1; i < 40; i++) {
            const t = i / 40;
            const x = ax + (bx - ax) * t;
            const y = ay + (by - ay) * t;
            const inside =
              x > box.x + 1 &&
              x < box.x + box.w - 1 &&
              y > box.y + 1 &&
              y < box.y + box.h - 1;
            expect(`${edge.from}→${edge.to} at ${box.name}: ${inside}`).toBe(
              `${edge.from}→${edge.to} at ${box.name}: false`,
            );
          }
        }
      }
    }
  });
});

describe("the drawn board — hand-drawn, seeded, serial", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const homes = new Map<string, ContainerHome>();
  const ctx: MeasureContext = {
    durations: D,
    document: doc,
    measureHost: doc.createElement("div"),
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: (key) => homes.get(key),
  };

  function build(step: Step): { node: Element; revealables: Revealable[] } {
    const factory = factoryFor(step.kind)!;
    const built = factory.build(step, ctx);
    const key = containerKeyOf(step);
    if (step.kind === "graph-frame" && key) {
      homes.set(key, { frame: step, node: built.node });
    }
    return built;
  }

  test("the factory builds 1:1 with the plan (T2↔T3 seam)", () => {
    const frame = frameOf("```graph g\na → b\n```");
    const { revealables } = build(frame);
    const plan = planStepUnits(frame, D);
    expect(revealables).toHaveLength(plan.length);
    plan.forEach((u, i) => expect(revealables[i]!.srcSpan).toEqual(u.srcSpan));
  });

  test("box before its name, arrows last — the order a person draws in", () => {
    const frame = frameOf("```graph g\na → b\n```");
    const { revealables } = build(frame);
    expect(revealables.map((r) => r.kind)).toEqual([
      "stroke", // a's box
      "wipe", // a's name
      "stroke", // b's box
      "wipe", // b's name
      "stroke", // the arrow between them
    ]);
    expect(revealables.some((r) => r.degraded)).toBe(false);
  });

  test("every line the layout wrapped is a line the board writes", () => {
    // The other half of "nothing is cut": `boxShape` sizing a box for N
    // lines while the renderer draws three of them would put the silent
    // truncation back, one layer down. Both ends read `box.noteLines`, and
    // this is what says so.
    const long =
      "这是一句相当长的说明文字用来把方框的宽度顶到上限并且继续往下换行直到超过预算为止再继续写下去还要更长一些才够";
    const frame = frameOf(`\`\`\`graph 长说明\n节点: ${long}\n\`\`\``);
    const { node } = build(frame);
    const box = graphLayout(frame).boxes.get("节点")!;
    expect(box.noteLines.length).toBeGreaterThan(3);
    const spans = Array.from(node.querySelectorAll("tspan")).map(
      (s) => s.textContent ?? "",
    );
    // The name line, then every wrapped explanation line, in order.
    expect(spans).toEqual(["节点", ...box.noteLines]);
    expect(spans.slice(1).join("")).toBe(long);
  });

  test("a box is ONE closed stroke that overshoots its own start (hand-drawn)", () => {
    const frame = frameOf("```graph g\n只有一个\n```");
    const { node } = build(frame);
    const box = node.querySelector("[data-bansho-graph-node]")!;
    const d = box.getAttribute("d")!;
    // Single drawable path — the stroke strategy drives one dashoffset.
    expect(d.match(/M /g)).toHaveLength(1);
    const layout = graphLayout(frame);
    const rect = layout.boxes.get("只有一个")!;
    // 收笔过冲: the pen keeps going past where it started.
    const start = d.match(/^M ([-\d.]+) ([-\d.]+)/)!;
    const tail = [...d.matchAll(/([-\d.]+) ([-\d.]+)(?:\s|$)/g)].at(-1)!;
    const travelled = Number(tail[1]) - Number(start[1]);
    expect(travelled).toBeGreaterThan(0.5);
    expect(travelled).toBeLessThan(rect.w / 2);
  });

  test("determinism — the same block draws byte-identical geometry twice", () => {
    const first = build(frameOf("```graph 同一份\nа → б → в\n```"));
    const dsA = [...first.node.querySelectorAll("path")].map((p) =>
      p.getAttribute("d"),
    );
    homes.clear();
    const second = build(frameOf("```graph 同一份\nа → б → в\n```"));
    const dsB = [...second.node.querySelectorAll("path")].map((p) =>
      p.getAttribute("d"),
    );
    expect(dsB).toEqual(dsA);
    expect(dsA.length).toBeGreaterThan(3);
  });

  test("a layer draws into the frame's own canvas — space returns home", () => {
    const src =
      "```graph 累积\n取材 → 起稿\n```\n\n```graph 累积\n起稿 → 定稿\n```";
    const steps = stepsOf(src);
    const frame = build(steps[0]!);
    const before = frame.node.querySelectorAll("[data-bansho-graph-node]").length;
    const layer = build(steps[1]!);
    // The layer occupies no space of its own.
    expect(layer.node.querySelectorAll("path")).toHaveLength(0);
    const after = frame.node.querySelectorAll("[data-bansho-graph-node]").length;
    expect(before).toBe(2);
    expect(after).toBe(3);
  });

  test("G8-D — no color ever rides an SVG presentation attribute", () => {
    const { node } = build(frameOf("```graph 颜色\na → b\n```"));
    for (const child of node.querySelectorAll("*")) {
      for (const attr of ["fill", "stroke", "color", "opacity"]) {
        expect(child.getAttribute(attr)).toBeNull();
      }
    }
  });
});

describe("prefix flow heights — the growth behind LayoutStepInput.growth (review P1-2)", () => {
  const src = `\`\`\`graph 演化
甲 → 乙
\`\`\`

过渡段落。

\`\`\`graph 演化
乙 → 丙
乙 → 丁
\`\`\`

\`\`\`graph 演化
丁: 这一行只写说明,没有新节点也没有新箭头,说明落在最高的那一列上,把那列撑得更高
\`\`\`
`;

  function blocksOf(source: string) {
    const lecture = parseLecture(source);
    const steps = lecture.sections.flatMap((s) => s.steps);
    const frame = steps.find((s) => s.kind === "graph-frame") as GraphFrameStep;
    const layers = steps.filter((s) => s.kind === "graph-layer");
    return {
      frame,
      blocks: [frame, ...layers].map((step) => ({
        nodes: (step as GraphFrameStep).nodes,
        edges: (step as GraphFrameStep).edges,
        notes: graphNoteWrites(source, step.srcSpan),
      })),
    };
  }

  test("each layer's growth is the flow-height delta of its prefix — the final prefix IS the union", () => {
    const { frame, blocks } = blocksOf(src);
    const heights = graphPrefixFlowHeights(frame.layout, blocks, 0);
    expect(heights.length).toBe(3);
    // Adding branches under 乙 deepens the canvas: positive growth.
    expect(heights[1]!).toBeGreaterThan(heights[0]!);
    // The full prefix reproduces the union's own layout height exactly —
    // the invariant (frame measurement = own + Σ growth) the fold's
    // prefix stability stands on.
    expect(heights[heights.length - 1]!).toBe(graphLayout(frame).height);
  });

  test("a NOTE-only layer still grows its prefix — notes mutate the union in place, so the replay must see them", () => {
    const { frame, blocks } = blocksOf(src);
    const heights = graphPrefixFlowHeights(frame.layout, blocks, 0);
    // The third block adds no node and no edge, only 甲's note — the box
    // holding the note is taller, so the canvas may regrow. It MUST at
    // least reproduce the union when it is the last block (above); here we
    // pin that the note is seen at all: dropping the note history flattens
    // the delta to zero AND breaks the union-reproduction invariant.
    const blind = blocks.map((b) => ({ ...b, notes: [] }));
    const blindHeights = graphPrefixFlowHeights(frame.layout, blind, 0);
    expect(blindHeights[blindHeights.length - 1]!).not.toBe(
      graphLayout(frame).height,
    );
    expect(heights[2]!).toBeGreaterThanOrEqual(heights[1]!);
  });

  test("graphNoteWrites recovers exactly the rows a block wrote, in order", () => {
    const lecture = parseLecture(src);
    const steps = lecture.sections.flatMap((s) => s.steps);
    const noteLayer = steps.filter((s) => s.kind === "graph-layer")[1]!;
    expect(graphNoteWrites(src, noteLayer.srcSpan)).toEqual([
      {
        name: "丁",
        note: "这一行只写说明,没有新节点也没有新箭头,说明落在最高的那一列上,把那列撑得更高",
      },
    ]);
    // Arrow rows and fences are never notes.
    const frame = steps.find((s) => s.kind === "graph-frame")!;
    expect(graphNoteWrites(src, frame.srcSpan)).toEqual([]);
  });

  test("the width mirror follows the shell BOTH ways — it grows to the cap and shrinks by the aspect", () => {
    // The mirror exists so the fold charges the same height the browser
    // will lay out, and it used to model a shell that could only shrink.
    // Now that the shell grows into its region, a mirror that still tops
    // out at the natural width would under-charge every graph that fills
    // — the board would think a figure it grew by 1.47 was still its own
    // size, and the column cursor under it would be wrong by half a face.
    const { frame, blocks } = blocksOf(src);
    const layout = graphLayout(frame);
    const layoutW = layout.width;
    const roomier = graphPrefixFlowHeights(frame.layout, blocks, 10000);
    expect(roomier[roomier.length - 1]!).toBeCloseTo(
      (layout.height * graphFillWidth(layout)) / layoutW,
      6,
    );
    const narrowW = Math.round(layoutW / 2);
    const narrow = graphPrefixFlowHeights(frame.layout, blocks, narrowW);
    expect(narrow[narrow.length - 1]!).toBeCloseTo(
      (layout.height * narrowW) / layoutW,
      6,
    );
    // No box width at all still means "the union's own size" — the basis
    // the union-reproduction invariant above is written against.
    const blind = graphPrefixFlowHeights(frame.layout, blocks, 0);
    expect(blind[blind.length - 1]!).toBe(layout.height);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A figure grows into its room, and its hand is the board's (2026-08-14)
//
// Reported as "the figure came out a postage stamp beside the handwriting",
// and it was two independent defects with one symptom:
//
//  1. the type was a HARDCODED 24/16 px, chosen against nothing. The board's
//     body is 34px, so a box's name was written at 0.71 of the prose beside
//     it and its explanation at 0.47 — smaller than the board's own smallest
//     voice (the 27px aside), for content that is the section's centrepiece;
//  2. the svg carried `width: 100%` AND `max-width: <natural layout width>`,
//     so it could only ever SHRINK. A graph narrower than its region — which
//     after (1) was most of them — sat at its own small size while a chart in
//     the same slot filled the face. Measured on the shipped seeds: the
//     pitch-zh pipeline laid out at 742px on a 1154px face (64%), and a
//     three-box CJK chain at 452px (39%).
//
// Both halves are fixed here, and they have to be fixed TOGETHER, because
// under a filling svg the rendered hand is `NAME_FS × region / layout` — a
// pure ratio, so raising the font alone would have changed nothing about a
// filled figure, and filling alone would have magnified a two-box graph's
// 24px hand to ~98px, past the board's own h1. So: the type comes from the
// board (`BOARD_BODY_FS`), which makes the layout board px; and the clamp
// stops being "never grow" and becomes "grow until the hand reaches the
// board's h2" — a figure fills its room, and never shouts louder than the
// section titles it sits between.
// ────────────────────────────────────────────────────────────────────────────

describe("the graph's hand and the room it fills", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const ctx: MeasureContext = {
    durations: D,
    document: doc,
    measureHost: doc.createElement("div"),
    env: { handwritingFontActive: true, strokeFontCovers: () => false },
    container: () => undefined,
  };
  const buildFrame = (src: string): Element =>
    factoryFor("graph-frame")!.build(frameOf(src), ctx).node;

  /** The `font-size` of one rule in the board's own stylesheet. */
  function cssFontSize(selector: string): number {
    const rule = new RegExp(
      `${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`,
    ).exec(BOARD_BASE_CSS);
    expect(rule, `no ${selector} rule in BOARD_BASE_CSS`).not.toBeNull();
    const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule![1]!);
    expect(size, `${selector} declares no font-size`).not.toBeNull();
    return Number(size![1]);
  }

  test("the engine's copy of the board's type scale is the CSS's copy", () => {
    // The engine may not import the viewer (G2), so the body size is
    // RESTATED in engine/layout.ts and pinned here by reading the
    // declaration back. Without this the two drift silently and the whole
    // "legible next to the prose" argument quietly stops being true — which
    // is the state the 24px constant was already in.
    expect(BOARD_BODY_FS).toBe(cssFontSize(".bansho-board"));
    expect(BOARD_H2_FS).toBe(cssFontSize(".bansho-heading-2"));
  });

  test("a box's name is written in the board's own hand, its note at two thirds", () => {
    // Read off the drawn element, not off a constant: the viewBox is board
    // px (the layout is sized in the same units the board writes in), so
    // this attribute IS the rendered size wherever the figure is not scaled.
    const node = buildFrame("```graph g\n甲: 一句说明\n```");
    const name = node.querySelector("text")!;
    expect(Number(name.getAttribute("font-size"))).toBe(BOARD_BODY_FS);
    const note = node.querySelectorAll("tspan")[1]!;
    expect(Number(note.getAttribute("font-size"))).toBe(
      Math.round((BOARD_BODY_FS * 2) / 3),
    );
  });

  test("the svg FILLS its region — the clamp is a growth ceiling, not a natural-size lid", () => {
    const src = "```graph g\n甲 → 乙 → 丙\n```";
    const layout = graphLayout(frameOf(src));
    const svg = buildFrame(src).querySelector("svg") as SVGElement;
    // Same shell a chart wears: it takes the width it is given.
    expect(svg.style.width).toBe("100%");
    // …and the only limit left is the growth cap, which is STRICTLY
    // greater than the natural width — the old lid was equal to it.
    expect(svg.style.maxWidth).toBe(`${graphFillWidth(layout)}px`);
    expect(graphFillWidth(layout)).toBeGreaterThan(layout.width);
  });

  test("at full growth the hand is exactly the board's h2 — the ceiling is a real one", () => {
    // The cap is not a taste number: `MAX_GROW = h2 / body`, so a figure
    // magnified all the way writes its box names at section-title size and
    // stops. This is the assertion that fails if someone "just raises the
    // cap a bit".
    const layout = graphLayout(frameOf("```graph g\n甲 → 乙\n```"));
    const grown = graphFillWidth(layout) / layout.width;
    expect(BOARD_BODY_FS * grown).toBeCloseTo(BOARD_H2_FS, 1);
    expect(BOARD_BODY_FS * grown).toBeLessThanOrEqual(BOARD_H2_FS + 0.5);
  });

  test("the shipped pitch pipeline stops being a postage stamp on its own face", () => {
    // The regression in the units the complaint was made in. A bounded
    // board's face is 1154px (PANEL_WIDTH less its paddings) and the strip's
    // is the same width; the pitch seeds' four-box pipeline used to draw at
    // 742px of it with a 24px hand. It must now cover most of the face and
    // write at no less than the prose beside it.
    const FACE = 1154;
    const layout = graphLayout(
      frameOf("```graph 流水线\n提交 → 自动测试 → 灰度 10% → 全量\n灰度 10%: 先放给十分之一的人\n```"),
    );
    const drawnW = Math.min(FACE, graphFillWidth(layout));
    expect(drawnW / FACE).toBeGreaterThan(0.85);
    // The hand it lands at: the layout is board px, scaled by what it got.
    const hand = BOARD_BODY_FS * (drawnW / layout.width);
    expect(hand).toBeGreaterThanOrEqual(BOARD_BODY_FS * 0.8);
    expect(hand).toBeLessThanOrEqual(BOARD_H2_FS);
  });
});
