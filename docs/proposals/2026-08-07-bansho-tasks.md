# Bansho Mode — 实现任务规格

> 本文是 `dev-master-orchestrator` 的 specDoc。每个任务有一对 anchor：
> `## T<n>-impl`（实现者读）与 `## T<n>-review`（评审者读，验收 bar 更完整）。
>
> **设计依据**：`docs/proposals/2026-08-07-bansho-mode-design.md`（rev 4 定稿，902 行）
> **参考实现**：`docs/proposals/2026-08-07-bansho-prototype.html`（862 行，vanilla JS 原型；
> 全部质感与节奏结论均由它实证得出，实现时以它为准而非凭空发挥）

---

## G — 全局约束（每个任务开工前必读）

这些约束来自产品负责人的直接决策，**优先级高于任何技术便利**。违反其中任何一条都是 blocker。

### G1. 单笔不变式（产品定义级）

> **板上只有一支笔，舞台一次只做一件事。写、划、擦、移镜头、移板，五者同轴、互斥。你写下的每一件事都会等前一件事收笔。**

（表述随 C1 合并——测试形状不变，全部是 schedule 上的独占条目；C1 尚无镜头指令，C2 起才有可测的镜头条目。）

canonical timeline 上**任意时刻至多一个揭示单元处于进行中**。没有任何并行动画——圈一个数字时手不在写字，后面的话必须等它收笔；两条数据线一条画完才画下一条；坐标轴、刻度、轴标签逐一串行。

这条是**可测**的，不是风格建议：
- 编译层：`schedule` 区间两两零重叠（property 测试）
- 运行时：遍历时间轴采样，断言任意时刻 `进行中单元数 ≤ 1`

历史注记：并行方案曾被实现并验证「技术上成立」，随后被产品负责人否决——**不要重新引入**。方言中的 `@with` / `@after` 已彻底移除，出现即坏步。

### G2. engine 零运行时依赖

`modes/bansho/engine/` 下**不 import React、不 import `src/`、不持有 rAF**。允许的外部 import 只有两条，各自绑死在唯一一个文件上（渲染层，宿主无关纯 JS）：

| 包 | 唯一允许的文件 | 用途 |
|---|---|---|
| `katex` | `engine/factories/math.ts` | 公式解析 → MathML |
| `@dagrejs/dagre` | `engine/factories/graph.ts` | ` ```graph ` 布局（T12；限 factory 层，布局 seam 可换朴素实现） |

grep 验收按此分层，且**这张表就是清单本身**——多出第三条、或任一包出现在第二个文件里，`__tests__/reveal.test.ts` 的 G2 门直接失败。三处（本表、设计稿 §6.3、grep 门）同步修订。

`seek(p)` 是纯映射：无副作用、可逆、可乱序调用。时钟在宿主（`viewer/useBoardPlayer.ts`）。

### G3. duration 必须可被外部测量覆盖

时长模型**不能写死成"只从内容量算"**。要允许外部注入某个 step 的实测时长（Phase 2 的语音旁白会用音频时长覆盖 `naturalDuration`）。现在留好接口，否则后面回头改核心。

> 实现落点（T1/T2 定稿）：override 钩子在 **`ScheduleContext.durationOverride`**（`timeline.ts` 是唯一 applier），**不在** `MeasureContext` 上——`MeasureContext` 带 `Document` 句柄，交给 DOM-free 的纯层会违反 T2 自己的分层规则；`engine-contract.test.ts` 用 `@ts-expect-error` 钉死了这个负空间。

### G4. `manifest.ts` 无 React

它被 Bun 后端和前端同时读取。React 绑定只在 `pneuma-mode.ts`。

### G5. 板面可擦，历史不可擦（C3 重写——整条替换，非追加）

> **板面可擦，历史不可擦。** 擦除是显式的、串行的表达动作，**只能以追加擦除指令的方式
> 发生**；它改变板面此刻的呈现，不改变 canonical timeline，也不触碰讲稿文件。
> scrub 回拖到擦除之前，被擦内容**必须重现**。课堂笔记遍历全部内容步、忽略擦除步，
> 永远大而全。任何**隐式**的内容丢失仍然违规——分页、滚动替换、被动覆盖，
> 以及**从 `board.md` 删除已播文本**（那是删历史，不是擦板）。

原 G5 的「不要假设永不擦」写于擦除还没设计的时候；C3 兑现了擦除
（`@erase` / auto-erase / 笔记视图），所以整条替换而不是追加。语义配对保留：

| 动作 | 语义 |
|---|---|
| `~~划掉~~` / `@strike` | 我**否定**它，但留着给你看 |
| `@erase` / auto-erase | 它**完成使命**了，放下，腾地方（内容本身没有错） |

**板 ≠ 笔记，一份数据两种呈现**：板（播放态）面积有限、会擦、镜头引导；课堂笔记
（导出态）无限、什么都不丢——同一份 canonical timeline 的两种投影。笔记投影通过
`ScheduleContext.stage.omitStageSteps` 把镜头步与擦除步计划为零单元，**中和而不移除**
——移除会重排 StepRef，打断 agent 地址。

### G6. srcSpan 覆盖率 100%

每个揭示单元——**包括 chart 块内每一行**（`x:` 行 / `y:` 行 / 每个系列行）——必须携带精确的源区间，供播放时讲稿行级高亮回指。整块共享一个区间已被原型证伪（左边整个代码块高亮，突兀且零信息）。

### G7. 视觉验证（仅 viewer/feature 任务）

改动 viewer、CSS 或任何 UI-facing 代码后，**必须**用 `chrome-devtools-mcp` 截图验证，并在输出中留下证据。不允许只靠读代码判断视觉正确性。见 `.claude/rules/frontend.md`。

### G8. 实现硬规则（原型实证，违反即视觉 bug）

| | 规则 | 根因 |
|---|---|---|
| **A** | 字体生效必须用 canvas 测宽验证 | `document.fonts.check()` 对系统字体恒返回 true，不可信。`Hannotate SC` 会**静默 fallback 到苹方**，中文手写质感悄悄消失。中文用 **`HanziPen SC`** |
| **B** | 跨行墨迹按 `top` 分组拆段，**拍内按长度顺序描画** | 取整体 bbox 会画出横跨两行的巨框。注意：段之间也是串行（G1） |
| **C** | 图表系列标签 `text-anchor="end"` + `x = W - 4` | 放末点右侧会溢出画布，中文系列名尤其 |
| **D** | token 颜色一律走 `element.style` | SVG presentation attribute **不解析 `var()`**（静默失效，颜色全丢）；且 CSS 规则优先级高于 attribute，inline style 才盖得住。**本条实现后追加进 `.claude/rules/frontend.md` gotchas** |
| **G** | 墨迹尺寸按**字号**量，不按 span 的 bounding rect | bbox 高度是**行高**不是**字高**；按行高画圈会溢出到相邻行，连续多行带标注时必然互撞（实测三个圈两两相撞）。圈垂直半径 `fs × 0.60`，荧光厚度 `min(行高, fs × 1.02) × 0.8` |
| **H** | 每种笔有各自的 easing 性格，且**严格单调递增** | 线性 progress 一眼假。不单调会导致 scrub 回拖时画面倒退 |
| **I** | 荧光笔是**填充形状**，不是等宽 stroke | 等宽 + 圆角端看着像贴纸。入笔窄→中段饱满→收笔收细（正弦包络指数 0.34）+ 随机倾斜 + 上下边缘独立抖动 + 从左往右开的 clip 窗 |
| **F** | **不做跟随笔尖的光标** —— 已否决 | 试过，"错位很严重、非常不自然"。根因是跟随元素矩形的水平插值≠真实笔尖位置。唯一重启路线是 per-path `getPointAtLength`，成本高收益不确定 |

### G8-J. rect 读数必须除以同帧实测缩放（C1 起，硬规则）

舞台施加 CSS transform 之后，`getBoundingClientRect()` 返回渲染后坐标，而
`offset*` / `client*` / `scroll*` / `getComputedStyle` 仍是布局值。**同一个算式里混用两类
读数，zoom = 1 时完全正确、zoom ≠ 1 时必然错位**——开发中不暴露，用户第一次缩放才炸。
规则：任何要落回板坐标的 rect 读数，必须除以**同一帧实测**的累积缩放
（`el.getBoundingClientRect().width / el.offsetWidth`，分子分母同一瞬间，不读 React state）。

结构化守卫：所有 rect 读数走唯一漏斗 `viewer/stage-measure.ts`，
`__tests__/stage-measure.test.ts` 的源码扫描门把 `getBoundingClientRect(` 钉死在
漏斗文件 + 显式豁免名单（Timeline 的 track、prose.ts 的 measureHost 读数）。
完整推导见 `2026-08-09-bansho-c1-tasks.md` §G 增补。

### G8-K. 测量宿主永远在舞台之外，缩放恒为 1（C1 起，硬规则）

`measureHost` 必须是**舞台的兄弟节点，而不是后代**（`.bansho-measure-layer` 挂在
surface 下、viewport 之外）。理由是 R8：探针读数会被缓存并喂进 canonical——对齐列宽进
reconcile hash，墨迹路径长度进 `naturalDuration`——宿主若随镜头缩放，同一份讲稿在不同
zoom 下会编译出不同的 canonical timeline。宿主在舞台之外，`engine/` 对镜头零感知、零改动；
漏斗只剩一个舞台内调用点（`BoardCanvas::measureBackRef`，回指必须量已挂载的目标节点）。
结构由 `__tests__/stage-structure.test.tsx` 钉死。完整推导见 `2026-08-09-bansho-c1-tasks.md` §G 增补。

### G8-L. 擦除必须独占一条视觉通道（C3 起，硬规则）

擦除目标**集合**不相交只保证了 erase 单元彼此不打架，**还必须保证 erase 的样式通道与
所有揭示策略的通道不相交**。反例（会真的发生）：fade 策略驱动 `opacity`。若 erase 也用
`opacity` 隐藏——C 步在 fade 揭示中被 E 擦掉，用户回拖进 C 自己的揭示窗口，
`makeSeek` 按索引升序分发：`C.seek(0.5)` 写 `opacity: 0.5`，紧接着 `E.seek(0)`
「恢复」`opacity: 1`——**C 变成全显，而不是半透**。wipe 的 `clip-path` 同理。

**修法（已实现为结构性约束）：erase 独占一个宿主专属的 run wrapper 元素，只写该
wrapper 的 `clip-path`；`seek(0)` 只移除自己的状态，绝不写任何策略拥有的属性。**
策略只碰 factory 建出的节点（wrapper 内部），两个状态族编译期不相交。
`__tests__/erase-replay.test.ts` 用真实 fade/wipe + 真实 makeSeek 分发顺序钉死。
与 G8-D 同族的坑：只在特定组合下暴露、不报错、悄悄坏。

### G9. easing 性格表（原型实测值）

| 笔 | 曲线 |
|---|---|
| 写字 | `1-(1-p)^1.75` |
| 荧光笔 | `1-(1-p)^2.9` |
| 圈 | ease-in-out 二次 |
| 划掉 | `1-(1-p)^3.4` |
| 立骨架 | 前 14% 只走 6%，之后 `^0.88` |
| 数据曲线 | 分 5 段，每段 `1-(1-f)^1.9` |

### G10. 时长常数（原型实测初值，非定论）

```
perChar .0195   wordBase .052   cjkBoost 1.5
gap .026        comma .13       period .30    paraGap .42
annotate .44    annotDelay .10  afterAnnot .14
chartLead .45   axis .40        tick .20      series 1.45   label .40
```

`gap` 是**词间隙**（每个词揭示完后的停顿），不是单元间隙。中文按 1–2 字切成揭示单元，英文按空格切词——**这条比常数本身更重要**。

常数在 T5 由产品负责人用倍速试出终值后回写。

T2 落地后新增两组校准面，同样归 T5 终校。初值原型实测，都在 `duration.ts`（模块级常量 `HEADING_GAP_MULT` / `CHART_GLUE`），但**不在** `DurationConstants` 契约内——宿主注入的 `durations` 碰不到它们，回写 = 直接改 `duration.ts`：

```
headingGapMult 2               # I1 — heading / --- 之后的段间倍数（×2）
chart glue（图内微节奏，秒）:
  afterAxisLine .08    afterSkeleton .12    afterEntry .08
  afterSeriesLabel .15   tail .20    layerLeadFactor ×.6
```

---

## T1-impl

**任务**：讲稿方言 parser + 领域模型 + `engine/types.ts` 定稿。taskKind: `contract`。

先读设计稿 §3（领域模型与文件形态）、§4（讲稿方言全集）、§6.2（核心类型）。

**交付**：
- `modes/bansho/domain.ts` — `loadBoard(files) → Lecture | null` / `saveBoard(value, current) → { writes, deletes }` 纯函数对
- `modes/bansho/engine/types.ts` — `Revealable` / `RevealKind` / `RevealableFactory` / `MeasureContext` / `ScheduleContext`（G3 override 的落点）/ `StepSchedule` / `BoardTimeline` / `Step` / `Lecture`
- `modes/bansho/__tests__/domain.test.ts`

**方言要点**（完整定义见设计稿 §4.3）：
- 行内：`==高亮==` · `**关键**`（圈出）· `~~划掉~~` · `$公式$`
- 回指：独立成行的 `@strike "子串"` / `@circle` / `@highlight` / `@underline`，**就近向上**精确子串匹配，歧义取最近
- 并列对齐：**零新语法**——连续列表项含相同首个分隔符（`:` 或 ` — `）即成对齐组
- chart：` ```chart <名字> ` 块，同名可在后文续写（累积容器）
- `@with` / `@after` 出现即坏步（G1）

**必须处理**：`$` 定界与货币符号歧义——金融题材里 `$100` 必然出现，不能被当成公式开界。

**验收**：方言全集单测通过；坏块隔离（一个坏块不影响其余）；未知标记按纯文本；**srcSpan 覆盖率 100%（含 chart 块每一行）**；`bun run typecheck` 干净。

## T1-review

除 T1-impl 全部要求外，额外审这些：

- **类型定稿质量**：`engine/types.ts` 是 T2/T3 并行的前提，一旦定错两个任务都返工。检查 `Revealable` 是否严格符合 G2（`seek(p)` 纯映射）、**G3（duration 可被外部覆盖）**是否有落点——这是最容易漏的一条。（定稿：落在 `ScheduleContext.durationOverride`，见 G3 注。）
- **G6 srcSpan**：不只是"有字段"，而是每个揭示单元都填了**精确**区间。chart 块内逐行是硬要求，整块共享区间是已被证伪的做法。
- **纯函数性**：`domain.ts` / parser 不碰 DOM、不碰全局状态，可在 Bun 测试环境直接跑。
- **容错**：坏块是否真的隔离？畸形 chart 块、未闭合 `==`、`@strike` 找不到目标（应产生 `refUnresolved` warning 而非崩溃）。
- **G1**：方言里不能有任何表达"同时"的语法。
- 契约变更是否需要同步 `core/__tests__` / `docs/reference` / AGENTS.md 契约表（本任务在 mode 内部，通常**不需要**——但要确认没有意外泄漏到 `core/`）。

---

## T2-impl

**任务**：串行语义推断编译器 + 时长模型。taskKind: `contract`。依赖 T1。

先读设计稿 §5（语义推断编译器，I1–I9 规则表）。

**交付**：
- `modes/bansho/engine/inference.ts` — 语义推断 I1–I9（纯函数）
- `modes/bansho/engine/duration.ts` — 时长模型，常数用 G10
- `modes/bansho/engine/timeline.ts` — `(steps, measurements) → BoardTimeline`，含 `seek(t)` 分发
- `modes/bansho/__tests__/inference.test.ts` · `timeline.test.ts`

**硬约束**：
- **G1 单笔不变式**：这是本任务的核心验收。schedule 排程必须严格串行，区间两两零重叠。
- **G3**：`duration.ts` 必须接受外部注入的实测时长覆盖计算值。
- **G10**：常数按表，中文 1–2 字切分 / 英文按空格切词要有专项测试。
- 确定性：同 Lecture + 同 measurements → **字节级相同**的 schedule。
- 测量通过 mock 注入，本层**不碰 DOM**。

**验收**：`schedule` 零重叠 property 测试；确定性测试；I9 切分专项测试；`bun run typecheck` 干净。

## T2-review

除 T2-impl 全部要求外：

- **G1 是本任务的生死线**。不要只看有没有测试，要看测试是否真的能抓到重叠：property 测试应当在**随机生成的 Lecture** 上断言零重叠，而不是只测几个手写样例。运行时采样测试在 T3。
- **G3**：检查覆盖机制是否真的可用——不是留个 optional 字段就算数，要能让调用方对**某一个 step** 指定实测时长而其余照常计算。
- **确定性**：`Math.random()` / `Date.now()` / 遍历顺序依赖（对象 key 顺序）都会破坏它。检查有没有这类隐患。
- **纯度**：inference/duration/timeline 三个文件都不应 import 任何 DOM API 或 React。
- 常数是否集中在 `duration.ts` 一处（G10 说了 T5 要回写终值，散落各处会导致校准时漏改）。
- 边界：空 Lecture、单 step、超长 step、只有 chart 没有正文。

---

## T3-impl

**任务**：Reveal 引擎——策略、手绘几何、factories（含公式）。taskKind: `feature`。依赖 T1，与 T2 不冲突（改不同文件）。

先读设计稿 §6（Revealable 引擎），**并精读参考实现** `docs/proposals/2026-08-07-bansho-prototype.html` —— 手绘几何、easing、荧光笔形状、clip 揭示的做法全在里面，照它实现，别自己发明。

**交付**：
- `modes/bansho/engine/strategies/{wipe,stroke,fade}.ts`
- `modes/bansho/engine/sketch/index.ts` — `sketchPath` / `jitterLine` / `jitterEllipse`（约 40 行，零依赖）
- `modes/bansho/engine/factories/{prose,ink,chart,math,rule}.ts`
- `modes/bansho/__tests__/sketch.test.ts` · `easing.test.ts` · `reveal.test.ts`

**硬约束**：G2（零依赖，唯一例外 `factories/math.ts` 的 katex）· G8 全部 A/B/C/D/G/H/I · G9 easing 表。

**公式**：KaTeX **仅作解析器**，`output: "mathml"`。揭示走 clip-path 从左往右（那恰是手写公式的顺序）。不要用 KaTeX 的 HTML 输出——它是一堆绝对定位 span，做揭示动画极难。

**确定性**：手绘抖动必须用**定种子伪随机**（原型用 mulberry32）。用 `Math.random()` 会导致 scrub 回拖时线条跳动。

**验收**：
- grep 验收 engine 核心层零外部 import
- **easing 严格单调断言**（自动化）
- **运行时单笔采样测试**：遍历时间轴，断言并发数 ≤ 1
- **多行连续标注 getBBox 零碰撞**（自动化，用 G8-G 的字号基准）
- G8-D 实现后追加进 `.claude/rules/frontend.md` gotchas

## T3-review

除 T3-impl 全部要求外：

- **G8-G 是最容易复发的 bug**：只在"连续多行都带标注"时才暴露，单行样例测不出来。检查测试是否覆盖了这个场景，以及圈的尺寸基准到底取自字号还是 bbox。
- **G8-D**：grep 所有 SVG 元素创建处，确认 token 颜色走 `element.style` 而非 `setAttribute`。这是静默失效——颜色丢了不报错。
- **G8-I**：荧光笔是不是真的填充形状？等宽 stroke + 圆角端会被产品负责人一眼看出"像贴纸"。
- **G8-F**：确认**没有**实现笔尖跟随光标（已否决）。
- **easing 单调性**：不只是有断言，要看断言是否覆盖了全部六种笔，且采样密度足够（原型用 150 点）。
- **G2 分层**：`factories/math.ts` 是唯一可 import katex 的文件——检查 katex 有没有泄漏到 strategies / sketch / types。
- **确定性**：种子从哪来？同一份内容重新渲染，抖动是否完全一致？
- 视觉证据：本任务产出的是可渲染物，**要求 impl 留下截图证据**（G7）。

---

## T4-impl

**任务**：mode 壳 + player 核心。taskKind: `viewer`。依赖 T2 + T3。

先读设计稿 §6.1（模块布局）、§7（流式追加协议 R1–R8）、§10（manifest 草案）。

**交付**：
- `modes/bansho/manifest.ts`（G4：无 React）· `pneuma-mode.ts`
- `modes/bansho/viewer/BanshoPreview.tsx` · `BoardCanvas.tsx` · `Timeline.tsx` · `useBoardPlayer.ts`
- 流式追加 R1–R4；scrub 时间轴（step 刻度、section 分节、Live 按钮）；**倍速**（`t += dt × rate`，档位 0.75/1/1.25/1.5，**不动 canonical timeline**）
- 视口跟随（G5：内容累积不擦除，只移动镜头）
- 回指标注播放时滚到目标
- 并列对齐渲染
- **讲稿行级高亮跟随播放**（消费 G6 的 srcSpan）
- 偏移→DOM 映射按 `stepPlainText` 口径（`engine/text.ts`）：**math run 贡献零字符**——公式在 plain-text 偏移词汇里不存在，`BackRefTarget`/`AlignInfo.at` 的偏移恢复必须把公式节点按零宽处理（T1-r2 F7）

**明确不做**：笔尖跟随光标（G8-F 已否决）。

**验收**：demo 板逐段追加像直播、**已播部分零重播**（截图证明）；scrub 确定性；倍速不改总时长；**G7 视觉验证必做**。

## T4-review

除 T4-impl 全部要求外：

- **G7**：先确认 impl 输出里**真的有** chrome-devtools 截图证据。没有证据 = 未验证 = blocker。
- **零重播**是流式的核心体验：新内容追加时，已经写出来的部分绝不能重新播一遍。这是最容易出错的地方。
- **G5**：检查有没有任何分页/替换/clear 逻辑偷偷进来。视口跟随 ≠ 内容消失。
- **倍速不动 canonical**：`rate` 只能影响时钟推进速率，不能改 `schedule`。否则 scrub 位置和导出会全乱。
- **G2 边界**：`useBoardPlayer.ts` 是唯一持有 rAF 的地方；`engine/` 里不能出现时钟。
- **G4**：`manifest.ts` 有没有意外 import React 或 viewer 组件。
- 设计 token：viewer 是否用了 `cc-*` 自定义属性而非硬编码颜色（`.claude/rules/frontend.md`）。
- 交互状态：加载中、空板、坏块、公式渲染失败——有没有合理的降级表现。
- **G6 消费**：播放到哪一步，讲稿左侧是否精确高亮那一行（chart 块要精确到系列行，不是整块）。

---

## T5-impl

**任务**：两块 demo 板 + 主题字体 + 端到端走查。taskKind: `feature`。依赖 T4。

**交付**：
- `modes/bansho/seed/tech-zh/board.md` — 技术/学术讲解范文：拆概念 + **公式** + **回头划掉**错误提法
- `modes/bansho/seed/pitch-zh/board.md` — 方案讲解范文：**并列三点** + 对比 + **箭头串联** + **框起结论**

  > **交付偏差记录（round-3 补记，非事后改写验收）**：「框起结论」实际交付为 `@circle`
  > 圈起——T1 方言只有 highlight / underline / strike / circle 四个墨迹动作，**没有
  > box/框 原语**，框不可实现。`seeds.test.ts` 的 describe 名随交付写成了「圈起结论」。
  > 「框」在此立为**方言缺口**：若产品要真正的方框强调，需为方言新增 box 动作
  > （T1 契约扩展，须产品负责人批准），届时本条回改。
- `modes/bansho/seed/*/theme.css` — 字体栈（G8-A）：亮色 `'Bradley Hand','HanziPen SC',…` / 暗色 `'Chalkboard SE','HanziPen SC',…`
- 视觉验证报告

**验收**：
- 双板 × 双主题截图
- **单笔手感**成立（全程无并行动画）
- 公式左→右展开
- 回指"先立、再驳、后划"的时序正确
- **多行标注零碰撞实景**
- 字体经 canvas 测宽核查真生效（G8-A）
- 常数残差微调（终值由产品负责人定，本任务只做明显偏差的修正）

## T5-review

除 T5-impl 全部要求外：

- 这是**产品负责人验收的直接对象**，标准按"能不能给人看"来判。
- **题材泛化**：两块板题材不同（技术论证 vs 方案讲解），检查推断规则在两者上都成立——原型阶段的教训是自编题材会漏掉真实内容才有的问题。
- **G8-A 字体**：不能只看截图"像手写"，要有 canvas 测宽的核查证据（`Hannotate SC` 的静默 fallback 就是这么漏掉的）。
- 截图是否覆盖了**双板 × 双主题**四个组合（英文板是 T8 的交付，双语那一半归 T8-review）。
- seed 内容本身的质量：它是用户打开 mode 看到的第一印象，也是 agent 的 few-shot 范文。文字是否自然、讲解是否真的循序渐进。
- G1 手感：截图无法证明"无并行"，要求有采样测试或逐帧证据。

---

## T6-impl

**任务**：交互面——selection、actions、commands、notifications。taskKind: `viewer`。依赖 T5。

先读设计稿 §8（ViewerAddress 词表）、§9（Action / Command space）、`docs/reference/viewer-agent-protocol.md`。

**产品语境**：产品负责人明确选择了「**板上点选提要求**」作为核心交互——用户不写方言，只对话或直接点板上某处提要求。所以 selection + `extractContext` 是这个 mode 的核心契约，不是可选装饰。

**交付**：
- `ViewerAddress` = `{ contentSet?, section?, step? }`（**全程只用讲解词汇**，不暴露"第几个 beat"）
- `extractContext` 实现 —— 点选任意一处 → `<viewer-context>` 给 agent
- actions：`navigate-to` · `play-from` · `check-board`
- commands：继续往下讲 / 这段重讲 / 换个讲法
- 三类 notification
- manifest 补全 actions/commands/editing

**验收**：address 闭环实测（select → Address → 回投 capture/locator 成立）；**G7 视觉验证**。

## T6-review

除 T6-impl 全部要求外：

- **词汇纯度**：`ViewerAddress` 和 notification 文案里出现任何渲染词汇（beat / wipe / stroke / frame）都是 blocker。只能用讲解词汇。
- **闭环真的闭上了吗**：用户点一句话 → agent 收到的 context 是否足以让它知道"用户指的是哪句"？光有 index 不够，要有可读的内容摘要。
- action 是否都 `agentInvocable` 得当；有没有把 UI 操作误当成 action（应该是 command）。
- 与 T4 的 scrub / 直播并发：点选发生在播放中时行为是否合理。

---

## T7-impl

**任务**：SKILL.md + references。taskKind: `feature`。依赖 T5（方言与行为稳定后写）。

先读设计稿 §12、`.claude/skills/create-mode/references/skill-md-patterns.md`。

**定位（硬要求，来自产品负责人原话）**：

> bansho skill 要让 agent 一读就知道，**这是帮我传递我想表达的东西的**，而不是一个设计负担——我有一堆工具要使用，帮用户做一个像板书的播放动画。

- **不要写成 API 手册**。agent 读完的第一感受必须是"我知道怎么把这件事讲清楚了"，而不是"我要学会 12 个参数"。
- **教讲解法，不教动画类型**。核心章是六个**表达动作**：铺垫 / 强调 / 对比 / 修正 / 给证据 / 收束。**不要出现** `wipe` / `stroke` / `fade` 这类渲染词汇。
- 两条纪律：**「时间不归你管」**（绝不手写时间戳）、**「板不会忘记」**（内容累积不擦除）。
- 开篇定调句原文写入：**「板上只有一支笔。你写下的每一件事都会等前一件事收笔。」**
- 原地划 vs 回头划的分工：原地 `~~x~~` = 明知故写的修辞；`@strike` = 先立、再驳、后划。
- 诚实边界必须点名公式：回指的目标子串**不能包含或跨越 `$…$` 公式**——公式在 plain-text 口径里是零字符，回指匹配对它不可见，教了就是教一个静默失败的手势（软降级为 `refUnresolved`；T1-r2 F7）。

**交付**：`modes/bansho/skill/SKILL.md`（主体 < 400 行）+ `skill/references/*.md` ×4 + manifest 的 `mdScene`

**验收**：全文出现渲染词汇或"选择动画效果"段落即打回。

## T7-review

**本任务的评审标准与常规代码任务不同**，按下面这条判：

- 把自己当成**第一次接手这个 mode 的 agent**。读完 SKILL.md 后，你是感觉"我知道怎么讲清楚一件事了"，还是感觉"我得先学会一套工具"？后者即 blocker。
- grep 全文：`wipe` / `stroke` / `fade` / `beat` / `easing` / `clip-path` / "动画效果" 出现即 blocker。
- 六个表达动作是否都有**可直接照抄的例子**，而不是抽象描述。
- 两条纪律是否落位且给了理由（不只是"不要写时间戳"，而是"为什么写了会更糟"）。
- 是否诚实交代了 v1 表达边界（结构框图、柱状/饼图不支持）——让 agent 知道边界比让它撞墙好。
- 主体是否 < 400 行，深度内容是否下沉到 `references/`。

---

## T8-impl

**任务**：seeds 完整化 + i18n。taskKind: `feature`。依赖 T7。

- 在 T5 两块板基础上补齐英文版：`tech-en` / `pitch-en`
- `init.seeds[]` 文案（gallery card）
- `manifest.displayName` / `description` 七语种补全（en / zh-CN / zh-TW / ja / ko / es / de）
- seed-gallery 缩略图

注意 `.claude/rules/modes.md` 的 gotcha：**没声明 `init.seeds[]` 时 gallery 只认 directory-shaped `seedFiles`**，单文件条目会被丢弃。本 mode 的 seed 是目录形态，但仍显式声明 `init.seeds[]` 更稳。

## T8-review

- 中英文板的**讲解质量对等**——英文版不能是中文的机翻，措辞要自然（项目有"自然中文"的先例教训，反向同理）。
- 七语种 displayName/description 是否都填了，有没有把英文直接塞进 zh-TW。
- gallery card 文案能否让人在 3 秒内明白这个 seed 讲的是什么。
- `init.seeds[]` 是否显式声明。
- 截图是否覆盖了**双语 × 双主题**四个组合——T5 只可能覆盖双板 × 双主题（那时英文板还不存在），英文板的视觉证据在这一轮补齐。

---

## T9-impl

**任务**：注册 + evolution directive + 文档。taskKind: `feature`。依赖 T8。

**三处注册缺一不可**（`.claude/skills/create-mode/SKILL.md` Step 3）：
1. `core/mode-loader.ts` — `builtinModes` 加 `bansho` 条目（缺了会 "Unknown mode"）
2. `server/index.ts` — `builtinNames` 数组加 `"bansho"`（**缺了 launcher gallery 里静默看不到**，这是最常见的漏项）
3. `CLAUDE.md` + `AGENTS.md` 的 `**Builtin Modes:**` 行（两文件必须字节一致）+ `README.md` **和 `README.zh.md`** 的 Built-in Modes 表

**evolution directive** 入 manifest：

> 学这个用户怎么讲东西：讲解节奏的快慢、习惯强调什么、偏好先给结论还是先铺垫、图表和公式用得多不多、中英文措辞习惯。

**验收**：`curl -s localhost:<port>/api/registry | jq '.builtins[].name'` 包含 `bansho`；`bun run dev bansho` 能起。

## T9-review

- **三处注册逐一核对**，不要相信"我加了"——实际 grep 三个文件。
- `CLAUDE.md` 与 `AGENTS.md` 是否**字节一致**（release contract 要求）。
- README 中英**两个版本**都改了吗？项目有过 zh 版落后两个月的教训，没有自动化守卫。
- evolution directive 是否是"学什么"而不是"做什么"。
- 有没有意外把 mode 名硬编码进 `server/` 或 `bin/` 的逻辑分支（G-boundary：那两层必须 ModeManifest 驱动）。

---

## T10-impl

**任务**：语音旁白 + 字幕导出。taskKind: `feature`。依赖 T9。

**背景**：产品负责人要求"根据时间轴调用 AI 工具合成语音和字幕"，并指出**不能整段合成**（对不上节奏）。选型未定，先用 clipcraft 现成方案验证链路。

**架构（关键）**：
- **逐 step 合成**，一句一个音频片段。因为 G1 单笔不变式让时间轴严格串行，音频片段一个接一个播即天然对齐——**不需要任何全局对齐算法**。
- 音频时长是**又一种测量**，走 G3 的 `ScheduleContext.durationOverride` 覆盖路径注入 `timeline.ts`。引擎结构不改。
- 有语音时书写速度由音频时长反推（边说边写），加 clamp 防刷屏：`clamp(audio, natural × 0.6, natural × 2.5)`，超出用停顿补。
- **音频缓存 key = step hash**：改哪句重合成哪句，其余不动不花钱。
- **字幕几乎免费**：每个 step 已有 `{ start, end, text }`，遍历 schedule 导出 SRT/VTT，并借 srcSpan 回指讲稿原文。

**选型隔离**（因为产品负责人还在想）：
```ts
interface VoiceSynthesizer {
  synthesize(text, opts): Promise<{ path: string; duration: number }>
}
```
引擎只消费 `{ path, duration }`。换供应商只换实现。

**交付**：
- 把 `modes/clipcraft/skill/scripts/generate-tts.mjs` 提到 `modes/_shared/scripts/`，bansho 经 `SkillConfig.sharedScripts` 引用（按 `.claude/rules/modes.md`：**共享脚本源，不共享 SKILL.md**）
- `VoiceSynthesizer` 接口 + fal.ai 实现
- 字幕导出（SRT / VTT）
- `init.params` 加 `FAL_KEY`（`sensitive: true` + `envMapping`）
- action `narrate`

**降级**：**语音是可选层**——没有 `FAL_KEY` 或未配音时，板书按 `naturalDuration` 正常播，不降级、不报错。

**验收**：一块板配音后音画对齐；改一句只重合成一句；无 key 时正常播放；SRT 时间轴与 schedule 一致。

## T10-review

- **G3 是否被正确使用**：音频时长应该走已有的测量覆盖通道，而不是在 timeline 里开一条新路径。开新路径 = 引入第二条时间线 = blocker（scrub 和未来的视频导出都会崩）。
- **降级路径**：无 `FAL_KEY` 时是否真的静默正常播放，而不是抛错或卡住。这是最可能被忽略的分支。
- **缓存 key**：改一句话是否真的只重合成那一句？检查 hash 的输入是否只含该 step 的内容。
- clamp 边界：极短句配长音频、极长句配短音频，两端行为是否合理。
- 脚本提到 `_shared/` 后，**clipcraft 是否仍然工作**（它原来引用的是自己 skill 下的路径）。
- `FAL_KEY` 是否标了 `sensitive: true`，有没有意外打进日志。

---

## T11-impl

**任务**：完整 e2e 测试。taskKind: `test-suite`。依赖 T10。

**产品负责人明确要求**"完整 e2e 测试"。

**覆盖**：
1. **流式 R1–R8 逐条回归**——追加 / 块中途改 / 结构变更 / 坏块 / scrub 与直播并发（用模拟 `FileChangeEvent` 序列，**不依赖真 chokidar**）
2. **G1 单笔不变式回归**——编译层零重叠 + 运行时采样并发 ≤ 1，在**全部 seed 板**上跑
3. **推断层 property 测试**——canonical 确定性（同输入字节级同输出）
4. 方言组合面边缘样例：公式 × 回指 × 对齐组 × chart 续写的两两组合
5. **端到端**：从 `board.md` 到可播放 timeline 的完整链路，含 `bun run dev bansho` 冒烟

**验收**：`bun test` 全绿；e2e 覆盖上述五类；测试不依赖网络（TTS 用 mock）。

**断言必须钉在 canonical / schedule 层**（来自无限画布可行性调研的结论）：断言区间零重叠、字节级确定性、R1–R8 的**语义结果**。**不要**断言 `scrollTop`、视口滚动位置或任何镜头机制的实现细节——无限画布落地时，滚动式镜头会被替换成 camera step，届时那类断言是**唯一会被整批扔掉**的。同一个行为要断言"第 N 步在时间轴上的位置和它的揭示进度"，而不是"页面滚到了多少像素"。

## T11-review

- **测试是否真的会失败**：对每个关键断言，反向验证一次——故意破坏实现，测试应该红。永远绿的测试等于没有测试。
- **G1 回归是否跑在全部 seed 板上**，而不是只在一个手写样例上。
- e2e 是否真的端到端（从文件到可播放 timeline），还是只是单元测试的堆叠。
- 网络依赖：TTS 必须 mock，否则 CI 会因为没有 `FAL_KEY` 而红。
- 断言质量：有没有 `expect(x).toBeDefined()` 这种近乎无意义的断言充数。
- 是否覆盖了**已知踩过的坑**：多行标注碰撞、字体静默 fallback、`$` 与货币符号歧义、SVG `var()` 失效。

---

## T12-impl

**任务**：` ```graph ` 结构图块。taskKind: `feature`。依赖 T6。**必须排在 T7（SKILL.md）与 T8（seeds）之前**——那两个要教它、要用它。

**为什么它不依赖无限画布**：可行性调研的结论是 graph 与 chart **完全同构**——都是「命名累积容器」。所以它落在今天的线性板上就能交付，是纯加法。

**服务场景**：产品负责人选的两个主场景之一是「产品/方案讲解」，那个场景要的是**结构、对比、箭头串联、框起强调**，不是趋势曲线。没有结构图，这个场景明显弱。

**参考实现**：`docs/proposals/2026-08-07-bansho-prototype.html` 的 sketch 几何，以及本轮验证过的两个新函数（照抄，别自己发明）：
- `jitterRect(x,y,w,h,rnd,amp)` — 四条边连成一笔 + **收笔过冲**（手画的框从来收不齐，这个细节是"像手绘"的主要来源）
- `jitterArrow(x1,y1,x2,y2,rnd,amp)` — 杆 + 两撇头合成**单一路径**，从起点描到终点，方向感来自路径方向

**推荐语法**（要点是「读下来像讲稿」，实现前请自行验证这一条）：

````
```graph 数据流
讲稿 → 推断 → 时间轴 → 播放
推断 → 语音合成
语音合成 → 播放
```
````

- 一行一条链，`→`（也接受 `->`）分隔，链式自动建节点与边
- 同名 graph 可在后文续写（累积容器，与 chart 同构）
- 节点名即节点身份，重复出现即同一节点
- 可选节点说明：`推断: 把讲稿变成串行 step`

**布局**：用 `@dagrejs/dagre`（**已在 package.json**，无需新增依赖）。

**G2 例外清单要同步修订三处**（调研的明确要求）：engine 核心层零外部 import 的**唯一例外**从「`factories/math.ts` 的 katex」扩展为「`factories/math.ts` 的 katex + `factories/graph.ts` 的 dagre」。三处同步：grep 验收测试、本文件 §G2、设计稿 §6.3。**漏改任何一处都会让 grep 门禁误报或漏报。**

**描画顺序（单笔串行，G1）**：先画框 → 再写框内的字 → 最后连箭头。跟人在板上画流程图的顺序一致。

**硬约束**：
- G1 全程串行，零并行
- G6 srcSpan 逐行（每个节点、每条边都要能回指源文本的哪一行）
- **确定性**：dagre 的布局确定性是**测试门，不是既成事实**——同一份 graph 输入必须产出字节级相同的布局。请写测试钉死它（调研的明确提醒）。
- 手绘抖动用定种子伪随机
- G8-D：token 颜色走 `element.style`

**验收**：语法读起来像讲稿（自评并说明理由）；同名续写复用同一张画布；布局确定性测试；描画顺序正确；srcSpan 100%；`bun run typecheck` + `bun test` 全绿。

## T12-review

除 T12-impl 全部要求外：

- **「读起来像讲稿」是产品级验收，不是文风偏好**。把 graph 块单独抽出来读一遍——它像一段话，还是像一份配置？后者即 blocker。参照物：`x: 2021 → 2026` 这种明显是配置的写法在早期原型里被产品负责人点名过。
- **确定性**：不要相信 dagre 天然确定。实际跑两次同样输入，diff 布局输出。dagre 内部有 Map/Set 遍历，**输入顺序或对象 key 顺序的变化可能改变结果**。
- **G2 三处同步**：逐一 grep 核对，漏一处就是隐患。
- **同构性**：graph 与 chart 应该共享累积容器的机制，而不是各写一套。如果实现里出现了两套平行的"命名容器"逻辑，说明抽象没提对。
- **手绘质感**：`jitterRect` 的收笔过冲有没有保留？没有的话框会显得太规整（产品负责人对荧光笔提过同类意见："形状太规整"）。
- 边的路由：dagre 给的是折线点，抖动之后箭头是否还能正确指向目标节点边缘（而不是插进节点内部或悬空）。
- 视觉证据：G7 必做，要求 impl 留下截图。
