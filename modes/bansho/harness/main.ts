/**
 * bansho render harness host (see index.html for how to run it).
 *
 * A ~150-line stand-in for the T4 host: builds every step through the real
 * factories in document order, registers chart homes, resolves back
 * references by span search, compiles the canonical timeline and drives it
 * with a rAF clock (rate scales dt only — canonical stays untouched).
 * Deliberately NOT the streaming viewer: no chokidar, no reconcile (R1–R8),
 * one static board per page load.
 */

import { parseLecture } from "../domain.js";
import { containerKeyOf, isContainerFrame } from "../engine/container.js";
import { DEFAULT_DURATIONS } from "../engine/duration.js";
import { factoryFor, probeEnvCaps } from "../engine/factories/index.js";
import { groupRowRects, type RectLike } from "../engine/factories/ink.js";
import { baselineOffset } from "../engine/factories/type-metrics.js";
import { flattenSteps } from "../engine/inference.js";
import { stepPlainText } from "../engine/text.js";
import type {
  BackRefTarget,
  ContainerHome,
  InkTargetMeasure,
  MeasureContext,
  Revealable,
  StepRef,
} from "../engine/types.js";
import { buildTimeline } from "../engine/timeline.js";

// §4.2-flavoured demo — every T3 factory on one board.
const SOURCE = `# 为什么这轮 AI 周期不同

GPU 的故事要从 2023 年讲起,数据中心营收翻了 ==三倍==,达到 874 亿。

~~这只是常规反弹~~ —— 这是**结构性**转移,核心是 ((供给约束))。

- 需求: 三倍
- 供给: 受限

> 旁注:质能方程 $E=mc^2$ 也上板。

$$a^2 + b^2 = c^2$$

---

\`\`\`chart revenue
x: 2023Q1 .. 2024Q4  (季度)
y: 0 .. 40  (十亿美元)
+ 英伟达: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
\`\`\`

再看 AMD,同一时期平得多。

\`\`\`chart revenue
+ AMD: 1.3 1.3 1.5 2.3 2.3 2.8 3.5 3.9
+ mark 英伟达 @ 2024Q4 : "35.6B"
\`\`\`

@circle "874"

@highlight "结构性"

## 这套东西是怎么串起来的

\`\`\`graph 数据流
讲稿 → 推断 → 时间轴 → 播放
推断 → 语音合成
语音合成 → 播放
推断: 把讲稿变成串行 step
\`\`\`

后面还能往同一张图上接着画。

\`\`\`graph 数据流
播放 → 导出
\`\`\`
`;

const board = document.getElementById("board")!;
const measureHost = document.getElementById("measure-host")!;
const refKey = (ref: StepRef): string => `${ref.section}:${ref.step}`;

const lecture = parseLecture(SOURCE);
if (lecture.errors.length > 0) console.warn("[harness] parse issues:", lecture.errors);
const stepByRef = new Map(flattenSteps(lecture).map((e) => [refKey(e.ref), e.step]));
const nodesByRef = new Map<string, Element>();
const builtByRef = new Map<string, Revealable[]>();
const containers = new Map<string, ContainerHome>();

/**
 * Back-reference seam: map the target's `stepPlainText` range onto the
 * mounted `.bansho-w` spans (two monotone cursors — span text occurs in
 * plain-text order), measure the hit spans relative to the BOARD (the
 * coordinate space backref overlays are mounted into), group per line.
 */
function backRef(target: BackRefTarget): InkTargetMeasure | undefined {
  const node = nodesByRef.get(refKey(target.step));
  const step = stepByRef.get(refKey(target.step));
  if (!node || !step) return undefined;
  const plain = stepPlainText(step);
  const spans = Array.from(node.querySelectorAll<HTMLElement>(".bansho-w"));
  const hits: HTMLElement[] = [];
  let cursor = 0;
  for (const span of spans) {
    const text = span.textContent ?? "";
    const at = plain.indexOf(text, cursor);
    if (at === -1) continue;
    if (at < target.end && target.start < at + text.length) hits.push(span);
    cursor = at + text.length;
  }
  if (hits.length === 0) return undefined;
  const base = board.getBoundingClientRect();
  const rects: RectLike[] = hits.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - base.left,
      top: r.top - base.top,
      right: r.right - base.left,
      bottom: r.bottom - base.top,
    };
  });
  const fontSize = Number.parseFloat(getComputedStyle(hits[0]!).fontSize);
  return { rows: groupRowRects(rects, baselineOffset(document, hits[0]!)), fontSize };
}

async function main(): Promise<void> {
  await document.fonts.ready;
  const ctx: MeasureContext = {
    durations: DEFAULT_DURATIONS,
    document,
    measureHost,
    env: probeEnvCaps(document),
    container: (key) => containers.get(key),
    backRef,
  };

  // Build + mount in document order (frames register before their layers;
  // backrefs measure targets that are already mounted).
  for (const { ref, step } of flattenSteps(lecture)) {
    const factory = factoryFor(step.kind);
    if (!factory) continue;
    const { node, revealables } = factory.build(step, ctx);
    if (isContainerFrame(step)) containers.set(containerKeyOf(step)!, { frame: step, node });
    nodesByRef.set(refKey(ref), node);
    builtByRef.set(refKey(ref), revealables);
    board.appendChild(node);
  }

  const timeline = buildTimeline(
    lecture,
    { durations: DEFAULT_DURATIONS },
    { unitsFor: (ref) => builtByRef.get(refKey(ref)) },
  );
  timeline.seek(0);

  // ── Transport: rAF clock; rate scales dt only (canonical untouched) ──────
  const play = document.getElementById("play") as HTMLButtonElement;
  const scrub = document.getElementById("scrub") as HTMLInputElement;
  const clock = document.getElementById("clock") as HTMLSpanElement;
  const rateSel = document.getElementById("rate") as HTMLSelectElement;
  const themeBtn = document.getElementById("theme") as HTMLButtonElement;

  let t = 0;
  let playing = false;
  let last = 0;
  const render = (): void => {
    timeline.seek(t);
    scrub.value = String(Math.round((t / Math.max(timeline.duration, 1e-9)) * 1000));
    clock.textContent = `${t.toFixed(1)} / ${timeline.duration.toFixed(1)}s`;
  };
  const tick = (now: number): void => {
    if (!playing) return;
    t = Math.min(t + ((now - last) / 1000) * Number(rateSel.value), timeline.duration);
    last = now;
    render();
    if (t >= timeline.duration) {
      playing = false;
      play.textContent = "Replay";
      return;
    }
    requestAnimationFrame(tick);
  };
  play.addEventListener("click", () => {
    if (playing) {
      playing = false;
      play.textContent = "Play";
      return;
    }
    if (t >= timeline.duration) t = 0;
    playing = true;
    play.textContent = "Pause";
    last = performance.now();
    requestAnimationFrame(tick);
  });
  scrub.addEventListener("input", () => {
    playing = false;
    play.textContent = "Play";
    t = (Number(scrub.value) / 1000) * timeline.duration;
    render();
  });
  themeBtn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeBtn.textContent = dark ? "Light" : "Dark";
  });
  render();
}

void main();
