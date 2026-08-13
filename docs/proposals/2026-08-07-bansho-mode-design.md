# Bansho Mode — 设计稿(rev 4 定稿,产品负责人已批准进入实现)

> 代号 `bansho`(板書/板书)。板书式讲解 live player。产品内核:**内容累积而非替换、
> 整块板承载完整思维流程、刻意不擦除**;产品重心(约束 A):**让 agent 很方便很舒服地
> 一气呵成写出内容与动画**——成功指标是 agent 写起来有多不费劲,不是动画能力有多强。
>
> **C3 修订(G5 重写,替换本稿一切「刻意不擦除」表述):板面可擦,历史不可擦。**
> 擦除(`@erase` / auto-erase)是显式追加的串行表达动作,改变板面呈现、不改
> canonical timeline、不碰讲稿文件;scrub 回拖被擦内容必须重现;课堂笔记视图遍历
> 全部内容步、忽略擦除步,永远大而全。隐式内容丢失(分页、滚动替换、被动覆盖、
> 从 board.md 删除已播文本)仍然违规。见 tasks §G5 与
> `2026-08-07-bansho-infinite-canvas-feasibility.md` §2。
>
> rev 2 相对 rev 1 的根本修正:书写面从「beats JSON + 显式 at/with 锚点」改为
> **讲稿式 Markdown 方言,内容即时间线、动画从语义推断**(约束 B);图表的语义分层
> 揭示与叙述锚定升为 schema 一等约束(约束 C);SKILL.md 重写为表达媒介而非工具箱
> (约束 D);全链路统一讲解词汇(约束 E);任务清单改为 MVP 垂直切片优先(约束 F)。
>
> rev 3 吸收视觉原型实证结论(中英双语 + 亮暗双主题截图验证):推翻 roughjs 依赖
> (手写 sketch 几何三函数约 40 行)、节奏常数换为实测值、新增 §6.4 实现硬规则。
>
> **rev 4(终审定稿,原型阶段结束):(一)产品定义级——板书是单线程的,一支笔:
> 废弃全部并行机制(原 I5 叙述-图层并行、原 I6 系列错峰整条删除),新增架构不变式
> 「canonical timeline 上任意时刻至多一个揭示单元进行中」(原型探针 4 场景 × 150
> 采样 0 帧重叠验证,M3 验收 + 自动化测试);(二)产品定义级——回指锚点机制进方言
> (回头标注前文,§4.5);(三)并列项对齐进 v1;(四)KaTeX 进 v1(仅解析器 →
> MathML 输出,渲染层依赖,不破 D5 引擎核心零依赖);(五)§6.4 追加 G–J 四条硬规则,
> 笔尖跟随(原 F)正式否决;(六)常数按串行化重校(§5.1),最终值留 M5 由产品负责人
> 用倍速试定。**
>
> 作者:pneuma-architect(DESIGN 模式)。已核对:`AGENTS.md` 契约表、
> `docs/reference/viewer-agent-protocol.md`、`.claude/rules/{modes,frontend,server,testing}.md`、
> `modes/{slide,illustrate,gridboard}` 形态、create-mode references。

---

## 0. Executive summary

Bansho 是纯 per-mode 交付:`modes/bansho/` 内自洽,**零 core/types 改动、零 server 改动、
零新增磁盘状态面**。四个核心设计判断:

1. **书写面是一份讲稿:`board.md`,一种极小的 Markdown 方言。** 文档顺序 = 播放顺序;
   `==重点==` 就是荧光笔、`~~旧说法~~` 就是写完再划掉、`((关键数字))` 就是圈选、
   `**强调**` 就是手绘下划线;图表是命名的 fenced block,可在后文**分层续写**——
   agent 从头到尾只写讲稿,一个时间词、一个动画词都不出现(约束 B,D4 的完成态);
   数学公式用标准 `$…$`/`$$…$$` 定界(rev 4:KaTeX 解析 → MathML 渲染,进 v1)。
2. **板书是单线程的:一支笔,严格串行(rev 4 产品定义)。** 产品负责人原话:「板书
   就是要有单线程的感觉,而不应该是并行动画。」圈一个数字时手不在写字,后面的话等它
   收笔。图表仍是**命名累积容器 + 语义分层**(约束 C):`chart` block 首现立框,后续
   同名 block 逐层续写,读起来是「讲一句、转身加一层、再继续讲」——绘制顺序对齐讲解
   逻辑靠**文档顺序 + 严格串行**达成,不靠并行。架构不变式:**canonical timeline 上
   任意时刻至多一个揭示单元进行中**(可测硬约束,原型探针已机械验证,M3 验收项)。
3. **canonical timeline 与 live 呈现分离。** 语义推断编译器(纯函数)把讲稿编成
   canonical timeline,服务 scrub / replay / 未来 Remotion 导出(D2);live 投影
   forward-only,追加与修改只 clamp 呈现,绝不污染 canonical 确定性。这是流式追加
   规则集(§7 R1–R8)的支柱。
4. **Revealable 引擎在 `modes/bansho/engine/`,物理隔离 React(D5/D7)。** 降级协商
   (stroke→wipe→fade)是运行时编译期纯函数;讲稿层与渲染层之间隔着推断编译器,
   agent 对 RevealKind 的存在完全无感——约束 D 落在架构上,不靠文风自律。

依赖终态(rev 4):**engine 核心零运行时依赖**——sketch 几何三函数约 40 行手写已实证;
不加 roughjs(输出形状与单路径 `getTotalLength()` + `strokeDashoffset` 模型不兼容,
为手绘感每线画两遍 → 多 `<path>`,还得写合成胶水)、不加 rough-notation(自走钟
`show()` 模型)、不加 GSAP。**渲染层唯一依赖 KaTeX**(仅用其解析器,
`output: "mathml"`;公式揭示走 clip-path 从左往右擦,恰是手写公式的顺序)。D5 边界
据此写明:「零依赖」约束的是 timeline/引擎核心层,渲染层 KaTeX 不违反(§6.3)。
讲稿方言 parser 手写(约 300 行,不引 markdown 库)。

交付顺序(约束 F):第一波是垂直切片——跑通 **NVIDIA/AMD 对比 demo**(一段带标注的
讲稿 + 一张逐步画出的折线图 + scrub 时间轴),骨架完备性(i18n、showcase、seed gallery、
evolution)全部后置。

最高风险(rev 4,并行废弃后重排):**#1 推断在真实题材上的泛化**(公式/回指/对齐是
按真实文档暴露的缺口新增的能力,组合面未全验)、**#2 流式 live/canonical 一致性**
(单线程化显著缩小危险面——严格串行下追加永远落在 timeline 尾部,「过去锚」常态路径
消失)、**#3 方言 parser 容错面扩大**(新增 `$` 定界、`@` 指令、对齐组)。
**Phase 1 无待验证开放项**;唯一留到 M5 的是常数终校(机制已定,产品负责人用倍速
试出舒服值)。详见 §16。

---

## 1. 问题与约束(用项目语言重述)

**要什么。** 一个 live player mode:agent 写一份讲稿,viewer 把它演成一场板书讲解——
文字以手写风流式浮现、关键处被手绘圈选/荧光/删除线标注、折线图沿讲解节奏逐步画出
(轴→网格→曲线沿 x 生长→数据标注→图例)。人可以旁观直播、scrub 回看任意时刻。

**产品重心(约束 A,凌驾其他):** 核心是图表动画 + 「agent 写起来不费劲」。内容和
动画一气呵成——agent 写的就是它想表达的东西,动画是表达的默认渲染,不是要学的工具箱。

**架构约束(D1–D7,已批准):**

- D1 中心抽象 `Revealable`(naturalDuration / kind / `seek(p)`),手写只是策略之一。
- D2 `seek(p)` 而非 `play()`:任何时间源可驱动(rAF / 拖拽 / 未来 `useCurrentFrame()`);
  导出要求帧渲染纯函数;人能 scrub——`play()` 模型直接放弃 live-player 核心价值。
- D3 降级链 stroke → wipe → fade,内容无关;agent 不关心底层有没有笔画数据。
- D4 `naturalDuration` 由内容量决定,agent 绝不手写时间戳——**约束 B 把它推到完成态:
  连编排也不写,内容即时间线**。
- D5 零外部 timeline 依赖;引擎可进任意宿主(浏览器 / Remotion / SSR / online-player)。
- D6 独立于 Remotion 但 Remotion-ready;与 repo `remotion` mode 是不同产品,串联走
  `borrow`(ADR-015)。
- D7 契约留 mode 内部;上提触发条件与预期形状见 §14。

**概念自洽(约束 E):** 全链路只有一套词汇——**讲解的词汇**。SKILL.md 教表达动作,
讲稿标记是表达语义,viewer 渲染成板书,ViewerAddress 是「哪一节/哪一步」。板不擦除:
无分页、无滚动替换、无 clear 动作;视口跟随(滚动/缩放)允许,内容消失不允许。

**成功判据:** (a) agent 写讲稿如写普通 Markdown,产出即带完整动画,全文零时间词汇;
(b) 图表绘制顺序与讲解逻辑对齐,且**全程单线程——任意时刻板上至多一支笔在动**;
(c) 用户拖时间轴到任意 t,画面确定性等于「t 时刻的板」;(d) agent 逐段追加时浏览器里
像直播,已播内容零重播零闪动;(e) 中文内容全程可用(走 wipe),体验不打折;
(f) 公式(`$…$`)从左向右手写般展开;讲解可以**回头**把前文写过的东西划掉/圈出,
逻辑顺序正确(先立、再驳、后划)。

---

## 2. Layer placement

| 归属判断 | 结论 |
|---|---|
| 哪一层拥有它 | **Layer 4 Mode Protocol** 下的新 builtin mode;Content Viewer 层经既有 `ViewerContract` 承载;Agent Runtime / Runtime Shell 无感知 |
| per-mode / per-backend / thin-waist | **纯 per-mode**。Revealable 依 D7 留 `modes/bansho/engine/`;零 `core/types/`、零 `server/`、零 `backends/` 改动 |
| 硬规则核对 | server/CLI 零 bansho 知识 ✓;backend 无关(三后端皆可)✓;`manifest.ts` 无 React ✓;core/types 未动 → 契约四件套传播不触发 ✓ |
| 新增磁盘状态 | **无**。板 = workspace 内容文件(`<contentSet>/board.md` + `theme.css` + `assets/`);不扩展 controlled-state-surface |
| 复用 seam | aggregate-file Source、directory content sets、viewerApi actions/commands、内建 `capture`、`ViewerNotification`、seed gallery、evolution directive——全部既有,零新 seam |

---

## 3. 领域模型与文件形态(开放问题 1)

### 决策:每 content set 一份 append-only `board.md`(讲稿),`aggregate-file` Source

**多 scene 还是单 scene:** 一个 content set = 一块板 = 一场讲解。多块板走框架现成的
directory content sets(与 slide/illustrate 同构)。板内不分页——分页即擦除的变体,
违反约束 E;板是固定逻辑宽度、向下无限生长的单列画布,live 时视口自动跟随书写位置。

**文件形态:`board.md` 而非 JSON/JSONL。** rev 1 选 JSONL 的两大理由(追加 = 追加、
错误局部隔离)Markdown 同样成立:append 只增字节、前缀不变;prose 不会 parse 失败,
唯一会失败的 chart block 天然按块隔离。而 Markdown 额外赢得约束 A/B 的全部:
**讲稿读起来是讲稿**,agent 的母语,内容与动画一气呵成。备选(JSONL beats + 显式锚点,
rev 1 方案)按约束 B 否决:那是「先写内容、再编排动画」两步走。

**Source kind:`aggregate-file`**,`patterns: ["**/board.md", "**/theme.css"]`,
配 `domain.ts::loadBoard / saveBoard`(纯函数,`byContentSet` 顶层,slide `loadDeck`
同构);`assets` 走 `file-glob`。`saveBoard` v1 stub `{ writes: [], deletes: [] }`
(illustrate 先例;可视化编辑 seam 留给 v2)。备选(`file-glob` 裸文件)否决:
讲稿方言 parse 与容错是 domain 逻辑,归 `domain.ts` 纯函数,不进 React 组件。

```ts
// modes/bansho/domain.ts(形状示意)
interface Board { byContentSet: Record<string, Lecture>; }
interface Lecture {
  title: string;                 // 首个 H1(缺省取 content set 名)
  sections: Section[];           // H2(或首个 H1 前的引言段)划分
  errors: ParseIssue[];          // 坏 chart block 等,块级隔离,不毁板
}
interface Section { heading?: Step; steps: Step[]; }
// 硬性输出要求(原型实证,重要性超预期):每个可揭示单元——含 chart block 内的
// 每一行(x:/y:/每个 + 系列行)——必须携带 srcSpan(board.md 内的精确字符区间)。
// 播放到哪个揭示单元,viewer 就精确高亮讲稿的哪一行(§6.4-E);整块共享一个区间的
// 粗粒度定位已被原型证伪(整个代码块高亮,突兀且零信息量)。
type Step =                       // 讲解的「一步」——协议与地址的基本单位
  | { kind: "prose"; inline: InlineRun[]; ... }        // 段落(含内联标记)
  | { kind: "list-item" | "aside" | "rule"; ... }
  | { kind: "chart-frame" | "chart-layer"; chart: string; ... }
  | { kind: "image"; src: string; ... }
  | { kind: "html"; ... };        // 逃生口
```

---

## 4. 讲稿方言(开放问题 2 —— 按约束 B/C 重写)

### 4.1 设计目标排序

优化目标不再是表达力最大,而是:**读起来像一段讲稿 > 局部可改 > 可 seek >
viewer 可视化编辑(v2)**。判据:把动画全部拿掉,`board.md` 仍是一篇结构良好、
可以直接发表的讲解文——动画语义完全寄生在「本来就该写」的结构标记上。

### 4.2 完整示例(NVIDIA/AMD demo,即 MVP 验收内容)

````markdown
# 为什么这轮 AI 周期不同

GPU 的故事要从 2023 年讲起。

## 需求的形状变了

英伟达的数据中心营收在 18 个月里翻了 ==三倍==。

~~这只是一次常规的周期性反弹~~ —— 这是**结构性**的需求转移。

我们把两家公司的数据中心营收放到同一张图上:

```chart revenue
x: 2023Q1 .. 2024Q4  (季度)
y: 0 .. 40  (十亿美元)
```

先看英伟达——每个季度都在加速:

```chart revenue
+ NVIDIA: 7.2 10.3 14.5 18.4 22.6 26.0 30.8 35.6
```

再看 AMD,同一时期的曲线要平得多:

```chart revenue
+ AMD: 1.3 1.3 1.5 2.3 2.3 2.8 3.5 3.9
```

差距不是常数——是一条越张越开的口子,终点停在 ((35.6B))。

```chart revenue
+ mark NVIDIA @ 2024Q4 : "35.6B"
```

---

> 供给侧的故事我们下一节再讲。
````

agent 写的就是上面这些。没有 id、没有秒数、没有动画名、没有编排。播放时(**严格
单线程,一支笔**):标题写出 → 引言浮现 → 小节标题 → 本句写完、荧光笔扫过「三倍」、
收笔 → 旧说法写出、停顿、删除线划掉、收笔 → 图表立轴(两条轴线、刻度、轴标签逐一
画出)→ 「先看英伟达」写完 → **转身画 NVIDIA 曲线,画完** → 「再看 AMD」写完 →
画 AMD 曲线 → 「35.6B」句写完、圈选落笔 → 图上 mark 落笔 → 手绘分隔线 → 旁注收束。
每一件事都等前一件事收笔。

### 4.3 方言全集(刻意极小)

**块级(= Step,讲解的一步):**

| 写法 | 讲解语义 | 默认渲染(agent 无感) |
|---|---|---|
| `# 标题` / `## 小节` | 立题 / 转段 | 大字写出 + 手绘底线;后接较长停顿 |
| 段落 | 叙述一步 | 手写字体流式浮现;句末标点带自然停顿 |
| `- 条目` | 列举 | 手绘弹点 + 逐条浮现 |
| `> 旁注` | 补充/预告 | 侧色小字 |
| `---` | 收束/换气 | 手绘横线 + 长停顿 |
| `![](assets/x.png)` | 给图 | 浮现 |
| ```` ```chart <name> ```` | 给证据(图表) | 见 §4.4 |
| ```` ```html ```` | 逃生口 | sanitize 后浮现;禁 script/iframe/事件属性 |

**内联(表达动作 → 手绘墨迹):**

| 写法 | 表达动作 | 默认渲染 |
|---|---|---|
| `==x==` | 强调(荧光) | 荧光笔扫过(写完本句后) |
| `**x**` | 强调(重读) | **手绘下划线**——板书没有粗体,教师会划线 |
| `((x))` | 点出关键值 | 手绘圈选 |
| `~~x~~` | 修正 | 先写出、停顿、删除线划掉——写错不擦,划掉再写对,这就是板书 |
| `*x*` / `` `x` `` | 轻强调 / 术语 | 变色/等宽,无墨迹动作 |
| `$…$` / `$$…$$`(块级) | 写数学(rev 4 进 v1) | KaTeX 解析 → MathML 渲染;clip-path 从左往右揭示——恰是手写公式的顺序 |

**回指标注(rev 4 新增;板书区别于打字机效果的核心动作):**

板上东西还在,所以才能回头指——回指与「内容累积、刻意不擦除」是同一件事。语法是
独立成行的 `@` 舞台指令,动词集与内联墨迹同集:

| 写法 | 语义 |
|---|---|
| `@strike "…"` | 回头把前文某段文字划掉(先立、再驳、后划的论证节奏) |
| `@circle "…"` / `@highlight "…"` / `@underline "…"` | 回头圈出/荧光/下划前文某段 |

- **目标解析:就近向上**——从指令位置向上找最近一次精确子串匹配(单块内,不跨块
  拼接);歧义时取最近者,agent 用更长的子串自然消歧,不需要新语法。找不到 → 坏步 +
  `refUnresolved` warning(⑥ 自愈回路)。
- **时序:** 回指是独立揭示单元,按文档位置严格串行(讲完理由 → 转身划掉 → 再继续);
  播放时视口滚到目标处——单线程让「镜头跟笔走」天然成立。
- **与原地标注的分工:** `~~x~~` 原地划 = 「明知故写」的修辞(写一个错误说法立即
  否定);`@strike "x"` 回头划 = 论证推进后的修正(观众先听到理由,再看见结论)。
- 默认路径(原地内联标记)不因此变啰嗦——回指是少数派语法。
- 备选方案(已否决):显式块 id + `@strike #id` 引用。精确但要求 agent 起 id,污染
  默认路径,违反「回指是少数派」的约束;字符串就近匹配在讲稿语境下歧义率天然低。

**并列对齐(rev 4 新增):** 连续列表项若都含相同类型的首个分隔符(`:` 或 ` — `),
渲染层按分隔符对齐成两列(标签列按最宽者对齐,答案列起点一致)。零新语法——agent
本来就写 `- R:自反性 — 成立`;真板书会把并列命题对齐成列,自然文本流不会,这条把它
补回来。markdown 表格语法 v1 不做。

**逃生口(少数派;默认路径零出现):**

| 写法 | 用途 |
|---|---|
| `@wait` / `@wait 2` | 显式加一拍(独立成行) |

rev 1 的 `at`/`with` 显式锚点体系在 rev 4 **彻底移除**(`@with`/`@after` 已删)——
它们存在的唯一理由是并行,而板书是单线程的;出现即坏步。

### 4.4 图表:命名累积容器 + 语义分层(约束 C,一等公民)

- **`chart <name>` 首现 = 立框**:画轴(x→y)、刻度、浅网格。frame 字段:
  `type`(v1 `line`,默认;`bar` 为 stretch)、`x:` / `y:`(范围或枚举 + 括号单位)。
- **同名块再现 = 加层**:`+ <series>: v v v …`(曲线)、`+ mark <series> @ <x> : "文本"`
  (数据点标注,落在图内)、`+ note @ <x>,<y> : "文本"`(自由标注)。图例随 series 自动。
- **空间累积**:图表停在首次声明的位置,后文图层画进**同一张图**——时间沿文档顺序推进,
  空间回到图的家。这是「板不擦除、只生长」在图表上的形态,也让「讲到哪画到哪」成立。
- **绘制语义(rev 4 全串行)**:曲线沿 x 从左向右生长(stroke 沿 path),**一条画完
  才画下一条**;系列标签在自己那条线画完后写,不与线重叠;mark 是圈点 + 短文本落笔;
  层内顺序 = 块内行序;轴两条线、每个刻度、每个轴标签逐一串行。
- **绘制顺序对齐讲解逻辑靠文档顺序 + 严格串行达成**(讲完那句 → 转身加那层 →
  再继续讲),不靠并行(§5)。

**块级容错**:chart block 语法错 → 该块标记为坏步(板上小徽标 + ⑥ warning 通知),
前后内容照常——约束 A 下 agent 会犯错,犯错的爆炸半径必须是一步而非一板。

### 4.5 Step 身份与可改性

- Step 无显式 id;**身份 = (块序号, 内容 hash)**。append-only 纪律下前缀块序稳定,
  身份天然稳定;typo 修正保持块结构 → 同序号异 hash → 按 §7 R4 处理。
- 中途插入会移动后续序号——纪律上不允许(累积 = 只在尾部生长),真发生时按 §7 R4′
  的最长公共前缀规则降级处理,不崩不重播已示内容。

### 4.6 v1 表达力边界(诚实声明)

单列自上而下(并列对齐是列表组内的两列对齐,不是双列板面);chart v1 仅 line(已决,
`type:` 字段预留 bar);无双列/分区板面。公式已进 v1(rev 4):KaTeX 解析全量 LaTeX,
无需设子集边界——实测真实文档的公式分布(单字母变量、上下标、`\mathbb`/`\mathfrak`/
`\mathsf` 字体变体、希腊字母、集合关系符)远在其覆盖内,无矩阵/积分/多行对齐需求。
方言未知标记原样按纯文本渲染——加法演进空间。

---

## 5. 语义推断编译器(新增核心组件;约束 B/C 的技术承载)

讲稿与渲染之间的独立一层:`engine/inference.ts`,纯函数
`(Lecture, measurements) → BoardTimeline`。**agent 面对讲稿,引擎面对 timeline,
两者之间只有这一个翻译点**——约束 D(agent 不感知渲染层)由这层架构保证。

### 5.1 单笔不变式 + 推断规则表(I1–I9,rev 4 全串行;常数为串行化后实测初值)

**架构不变式(产品定义级,rev 4):canonical timeline 上任意时刻至多一个揭示单元
处于进行中。** 一支笔:圈一个数字的时候手不在写字,后面的话必须等它收笔。这不是风格
建议,是可测硬约束——原型探针在 4 个场景各采样 150 个时刻机械验证,全部 0 帧重叠。
编译层(M2)保证输出 schedule 无区间重叠;引擎层(M3)配同形状的自动化测试(遍历
时间轴采样,断言并发数 ≤ 1)。**全部并行机制——rev 3 的 I5 叙述-图层并行、I6 系列
错峰——自本版整条废弃:并行在技术上成立,在产品上是错的**(产品负责人原话:「板书
就是要有单线程的感觉,而不应该是并行动画」)。

| # | 规则 |
|---|---|
| I1 | 文档顺序 = 播放顺序;**全局严格串行**(单笔不变式);间隙常数(I8):逗号 `.13s`、句末 `.30s`、段间 `.42s`;heading 与 `---` 后取段间 ×2(倍数随 M5 终校) |
| I2 | 段落内:文字流式写出;`==` `**` `(( ))` 的墨迹动作在**本句写完后**依次落笔,每个墨迹独占一拍(`annotate .44`),收笔后停 `afterAnnot .14` 再继续写字(afterAnnot 是单线程化的产物:标注收笔到继续写字之间的停顿) |
| I3 | `~~x~~`:正常写出 → 一拍停顿 → 删除线划过(「等等,不对」的节奏);回头划用 `@strike "…"`(§4.3,I6) |
| I4 | chart frame:紧随前段串行,引入停顿 `chartLead .45`;**轴的两条线、每个刻度、每个轴标签,全部逐一串行**(`axis .40 / tick .20 / label .40`) |
| I5 | chart layer:**讲完那句 → 转身加那层 → 再继续讲**(严格串行);同图多条系列**一条画完才画下一条**;系列标签在自己那条线画完后写,不与线重叠 |
| I6 | 回指指令(`@strike` / `@circle` / `@highlight` / `@underline`):独立揭示单元,按文档位置串行;播放时视口滚到目标——单线程让「镜头跟笔走」天然成立 |
| I7 | `@wait` 逃生口:显式加一拍。(`@with`/`@after` 已随并行废弃,出现即坏步) |
| I8 | naturalDuration(D4)——常数为**串行化后重新校准的实测值**(同样内容 9.0s → 13.7s,节奏偏慢是已知状态):`perChar .0195 · wordBase .052 · cjkBoost 1.5 · gap .026 · comma .13 · period .30 · paraGap .42 · annotate .44 · annotDelay .10 · afterAnnot .14 · chartLead .45 · axis .40 · tick .20 · series 1.45 · label .40`。**这是 duration.ts 初值,不是定论**——最终值在 M5 由产品负责人用倍速档位试出舒服值后回写(§18-M5 校准点)。T2 落地新增两组同归 M5 终校的校准面,同在 duration.ts 但在 `DurationConstants` 契约之外(回写=改该文件):I1 的 heading/`---` 倍数 `HEADING_GAP_MULT = 2`,与图内微节奏 `CHART_GLUE`(afterAxisLine .08 · afterSkeleton .12 · afterEntry .08 · afterSeriesLabel .15 · tail .20 · layerLeadFactor ×.6) |
| I9 | 揭示单元切分(实测,比常数更重要):**中文按 1–2 字切段**(整词/整句揭示没有「一笔一笔」的手感);英文按空格切词;跨行墨迹按行拆段,同一拍内**按长度顺序描画**——一支笔先扫完第一行再扫第二行(§6.4-B,rev 4 与单笔不变式对齐) |

规则表全部集中在 `inference.ts` + `duration.ts`,纯函数、单测直接钉——**调节奏 =
调这张表**。全部机制已定,Phase 1 无待验证项;常数是初值,唯一留到 M5 的是终校。

### 5.2 降级协商(开放问题 6):运行时编译期,agent 无感

kind 由 `(step 类型, 内容, envCaps) → RevealKind` 确定性纯函数决定,envCaps
(字体就绪、单线字体 charset)session 内固定 → scrub 与导出确定性成立:

- chart 轴/网格/曲线/墨迹动作(荧光/圈/线/删除线)/`---` → **stroke**(sketch path 天生);
- 正文/标题/列表/旁注/图片(含全部 CJK)→ **wipe**(手写显示字体 + clip-path——
  参考体验的本体);chart mark 短拉丁文本 → stroke(Hershey 单线字体,点睛);
- 公式(`$…$` → MathML DOM)→ **wipe**(clip-path 从左往右——恰是手写公式的顺序,
  这正是选 MathML 而非 KaTeX HTML 输出的理由,§6.3);
- 超碎内容、`html` 大块 → **fade**。

正文默认 wipe 而非 stroke 是刻意再平衡:单线 stroke 字体是绘图仪感,手写感来自字体 +
流式;stroke 文本只留给图内短标注。降级链完整(D3),agent 全程不知道这些词存在(约束 D)。

---

## 6. Revealable 引擎(D1–D5 落地;结构同 rev 1,书写面替换)

### 6.1 模块布局——React 隔离是物理的

```
modes/bansho/
├── manifest.ts                  # 纯数据(无 React、无 engine import)
├── pneuma-mode.ts               # ModeDefinition 绑定(仅 frontend)
├── domain.ts                    # 讲稿方言 parser / loadBoard / saveBoard(纯函数)
├── engine/                      # ★ 零 React、零 src/ import —— D7 上提切割线
│   ├── types.ts                 #   Revealable / RevealKind / RevealableFactory /
│   │                            #   MeasureContext / ScheduleContext(G3 override 落点)/
│   │                            #   StepSchedule / BoardTimeline
│   ├── text.ts                  #   stepPlainText / stepContentHash(引擎自己的
│   │                            #   offset/identity 词汇表,domain.ts 再导出)
│   ├── inference.ts             #   语义推断 I1–I7 + I9 揭示单元切分(纯)
│   ├── duration.ts              #   I8 时长模型(常数 = 原型实测值,纯)
│   ├── timeline.ts              #   (steps, measurements) → BoardTimeline + seek 分发(纯)
│   ├── strategies/{wipe,stroke,fade}.ts
│   ├── container.ts             #   命名累积容器的共用词汇(chart 与 graph 同一套)
│   ├── factories/{prose,chart,graph,ink,math,image,html,rule}.ts
│   │                            #   ink = 墨迹动作(原地 + 回指);math = KaTeX→MathML
│   │                            #   graph = ```graph 结构图(dagre 布局)
│   │                            #   (factories 是渲染层——math.ts 与 graph.ts 是全
│   │                            #    engine 仅有的两个允许 import 外部包的文件:
│   │                            #    katex / @dagrejs/dagre,各一条,不得再多)
│   ├── sketch/                  #   手绘几何:sketchPath / jitterLine / jitterEllipse
│   │                            #   / jitterRect(四边一笔 + 收笔过冲)/ jitterArrow
│   │                            #   (零依赖;轴/网格/曲线/墨迹/分隔线/框/箭头的单路径生成)
│   └── fonts/hershey-futural.json   # 单线拉丁字体(vendored;mode 根 NOTICE.md)
├── viewer/
│   ├── BanshoPreview.tsx        # player 壳、live-follow 状态机
│   ├── BoardCanvas.tsx          # step 渲染 + Revealable 挂载 + 测量层 + 视口跟随
│   ├── Timeline.tsx             # scrub 条(step 刻度、section 分节、Live 按钮、倍速)
│   └── useBoardPlayer.ts        # rAF 驱动器(浏览器宿主专属;engine 内无时钟)
├── skill/  seed/  seed-gallery/  showcase/  __tests__/  NOTICE.md
```

engine/ 纪律(任务验收项):不 import React、不 import `src/`、不持有 rAF——`seek(t)`
被外部时间源调用(浏览器时钟在 `useBoardPlayer.ts`;未来 Remotion 宿主是
`useCurrentFrame()/fps`,约 20 行胶水,D6)。**分层(rev 4):core
(types/inference/duration/timeline/strategies/sketch/container)零外部 import;
factories 是渲染层,外部依赖只有两条、各自绑死在唯一一个文件上:`factories/math.ts`
的 katex(仅解析,宿主无关纯 JS)与 `factories/graph.ts` 的 `@dagrejs/dagre`
(T12 ` ```graph ` 布局;限 factory 层,布局 seam 可换朴素实现)。grep 验收按此分层
执行,清单即穷举——第三条外部 import,或任一包出现在第二个文件里,G2 门失败。**

### 6.2 核心类型(D1 原样 + 配套)

```ts
// engine/types.ts —— D1 契约原文,mode 内部
type RevealKind = "stroke" | "wipe" | "type" | "fade";   // "type" v1 保留不实现

interface Revealable {
  naturalDuration: number;      // 秒;由内容量决定(I8)
  kind: RevealKind;             // 降级链协商结果
  seek(p: number): void;        // 纯视觉映射 0..1;无副作用、可逆、可乱序
}

interface RevealableFactory {
  kind: Step["kind"];
  // 构建 DOM/SVG 节点 + 协商 RevealKind + 测量 naturalDuration。
  // getTotalLength / 字宽测量只发生在这里 —— 引擎唯一碰 DOM 度量的点。
  build(step: Step, ctx: MeasureContext): { node: Element; revealables: Revealable[] };
  // 一个 prose step 产出多个 revealable:正文 wipe + 各墨迹动作 stroke,
  // inference 层为它们排片;chart layer 同理(曲线 + mark)。
}

interface StepSchedule { step: StepRef; unit: number; start: number; end: number; }
interface BoardTimeline {
  schedule: StepSchedule[];      // canonical 绝对秒;总时长 = max(end)。
                                 // 不变式(rev 4,单笔):区间两两不重叠——任意时刻
                                 // 至多一个揭示单元进行中(编译层保证,M3 采样测试)
  seek(t: number): void;         // 二分活动窗口;p 未变不调用;O(活动单元)每帧
}

// G3 override 的落点(T1/T2 定稿):ScheduleContext.durationOverride,
// timeline.ts 是唯一 applier。不在 MeasureContext 上——它带 Document 句柄,
// 交给 DOM-free 纯层违反分层;负空间由 engine-contract.test.ts @ts-expect-error 钉死。
// T10:hook 第三参 naturalFootprint 是 scheduler 已算好的内容推导 footprint,
// 递给宿主让 narration clamp(audio 对 natural 的 [0.6, 2.5] 区间)在宿主侧完成
// ——clamp 是 policy,不进引擎;单通道单 applier 不变。
interface ScheduleContext {
  durations: DurationConstants;
  durationOverride?(
    step: Step,
    ref: StepRef,
    naturalFootprint: number,
  ): number | undefined;
}
```

### 6.3 依赖决策(开放问题 7)

| 依赖 | 决策 | 理由 |
|---|---|---|
| `roughjs` | **不加——手写 sketch 几何(rev 3 推翻 rev 2 决策,原型实证)** | `sketchPath`(点列 → 二次贝塞尔 + 控制点抖动)/ `jitterLine`(按长度分段 + 端点抖动衰减)/ `jitterEllipse`(极坐标采样 + 半径扰动 + 首尾 overlap)三函数约 40 行,截图验证质感充分。实质理由是**形状不兼容**,不是省依赖:rough.js 为手绘感每线画两遍、输出多个 `<path>`,而引擎要**单一可描画路径**(`getTotalLength()` + `strokeDashoffset` 驱动),用它还得写多 path 合成/分别驱动的胶水;fill/hachure 一概用不上;token 颜色要走 `element.style`(§6.4-D),rough 的 options 颜色输入自成一套 |
| `rough-notation` | **不加,mode 内实现** | 硬理由:自走钟 `annotate(el).show()` 模型**与 `seek(p)` 不兼容**,且不单独暴露 path 生成。荧光/圈/下划线/删除线在 sketch 几何上直接生成单路径,统一走 stroke 策略 dashoffset。3.8kb 不是理由,模型不兼容才是 |
| Markdown parser | **手写方言 parser(~300 行)** | 方言极小且非标(`==` `(( ))` `@` 指令 chart block);通用 md 库(repo 里 react-markdown 是渲染件)带不动自定义内联+块级容错,还引入宿主耦合。行级块解析 + 正则级内联,纯函数可测 |
| `katex` | **加 npm 依赖(渲染层,rev 4 进 v1)——仅用其解析器,`output: "mathml"`** | (a) KaTeX 的 HTML 输出是大量绝对定位 span + 复杂 CSS,做揭示动画极难;MathML 输出是真实 DOM 元素树,`clip-path` 从左往右擦即可——恰是手写公式的顺序;(b) 浏览器原生渲染 MathML Core(Chrome 109+ / Safari / Firefox 全绿;Electron 41 的 Chromium 远新于此),无需加载 20+ 字体文件。用 KaTeX 解析则 LaTeX 覆盖完整,无需设子集边界。**D5 边界声明,防后人误读:「零依赖」约束的是 engine 核心层(types/inference/duration/timeline/strategies/sketch);katex 只在 `factories/math.ts`(渲染层)被 import,宿主无关纯 JS,不破 D5** |
| 单线拉丁字体 | **vendor Hershey futural JSON** + NOTICE.md | 公有领域(NIST);数据小;charset 表兼作协商输入 |
| 手写显示字体 | **系统字体栈,按主题分;seed `theme.css` 负责,引擎无关** | 实测(macOS):亮色 `'Bradley Hand','HanziPen SC',…`、暗色 `'Chalkboard SE','HanziPen SC',…`(英文字体无中文字形,中文自动落到 HanziPen)。**中文必须用 `HanziPen SC`(翩翩体),不是 `Hannotate SC`(手札体)**——后者静默 fallback 到苹方,质感悄悄消失(坑的验证方法见 §6.4-A)。非 macOS 平台退 `cursive`/楷体栈,损观感不损功能;CJK 字体文件不进 repo |
| GSAP / tween 库 | **不加**(D5 原文) | seek 模型下 tween 冗余;零 timeline 依赖 = 引擎进任意宿主 |

**净效果(rev 4 终态):engine 核心零运行时依赖(D5 完整形态,可移植性无外部条件);
渲染层唯一 npm 新增 = katex(解析器,宿主无关);不加 roughjs、不加 rough-notation、
不加 GSAP。**

### 6.4 原型实证的实现硬规则(A–I,来自截图验证与真实文档测试;M3/M4 验收项)

- **A · 字体生效必须用 canvas 测宽验证;`document.fonts.check()` 对系统字体恒真,不可信。**
  实测:`Hannotate SC` 渲染宽度与 `PingFang SC` 完全一致 = 没生效、静默 fallback 到
  苹方,中文完全不是手写体;`HanziPen SC` 宽度不同 = 真生效。坑的形态是**静默**——
  不报错,质感悄悄没了。envCaps 探测(§5.2)必须用「候选字体 vs 已知 fallback 的
  canvas 测宽差异」判定;M5 视觉验收清单含此项。
- **B · 跨行墨迹标注按行拆段。** `==…==` 跨行时取整体 bbox 会画出横跨两行的巨框——
  中文长句里是常态不是边角。按 client rect 的 `top` 分组拆成多个矩形、每行画一段,
  多段共享同一拍,**拍内按长度顺序描画**——一支笔先扫完第一行再扫第二行
  (rev 4:原「同时描画」与单笔不变式冲突,已改为顺序)。
- **C · 图表系列标签右锚。** 末点右侧摆标签必溢出画布(中文系列名尤其长,
  「英伟达 +874%」直接被裁)。一律 `text-anchor="end"` + `x = W - 4`,向左延伸,
  名字多长都不溢出。
- **D · token 颜色一律走 `element.style`,不走 SVG presentation attribute。**
  `el("path", { stroke: "var(--s1)" })` 静默失效——presentation attribute 不解析
  `var()`;且 CSS 规则优先级高于 presentation attribute(`.chart text { fill }` 会盖掉
  attribute 上的 `fill`),inline style 才盖得住。实现任务落地时把这条追加进
  `.claude/rules/frontend.md` gotchas(项目惯例:踩过的坑进 rule 文件)。
- **E · 每个揭示单元回指精确源区间(srcSpan)。** chart block 整块共用一个源区间已被
  原型证伪(播放时整个代码块高亮,突兀且零信息);`x:` 行、`y:` 行、每个系列行各自带
  偏移,播放到哪条线就精确高亮讲稿哪一行——**「内容即时间线」最强的可感证明**。
  M1 parser 的硬性输出要求(§3),M4 的讲稿高亮跟随消费它。
- **F · 笔尖跟随光标——已否决(rev 4 终审结论 J,原型试过并移除)。** 产品负责人
  评价「非常不自然、错位很严重」。根因:跟随的是元素矩形的水平插值,与真实笔尖位置
  不是一回事,换行和画图时错得更离谱;要做对必须沿真实路径 `getPointAtLength` 走,
  成本高收益不确定。**明确记为已否决,免得后人重复踩**;若将来重启,唯一可接受的
  路线是 per-path `getPointAtLength`。
- **G · 墨迹尺寸必须按字号量,不能按 span 的 bounding rect。** 原型唯一真 bug,且只
  在真实内容下暴露:span 的 bbox 高是**行高**(实测 45px),不是**字高**(约 26px);
  按行高画圈,椭圆高 62px 直接溢出到相邻行,连续几行都带标注时**必然互撞**(实测三个
  圈两两相撞)。修法:`getComputedStyle(el).fontSize` 取字号;圈的垂直半径
  `fs × 0.60`;荧光笔厚度 `min(行高, fs × 1.02) × 0.8`。验收:**多行连续标注场景
  墨迹零碰撞**(getBBox 两两相交检测,自动化)。
- **H · 每种笔有各自的速度性格;线性 progress 一眼假。** 产品负责人反馈「过于线性、
  没有手写的不匀速和顿挫」。原型实测的一组 easing:写字 `1-(1-p)^1.75`(落笔即走,
  收笔缓)、荧光笔 `1-(1-p)^2.9`(唰一下,尾巴带甩)、圈 ease-in-out 二次(起手慢,
  中段最快,收口回慢)、划掉 `1-(1-p)^3.4`(狠、快、一气呵成)、立骨架前 14% 只走 6%
  之后 `^0.88`(落笔先顿一下再拉到底)、数据曲线分 5 段每段 `1-(1-f)^1.9`(手跟着
  数字爬的顿挫)。**硬约束:所有 easing 必须严格单调递增**,否则 scrub 回拖时画面
  倒着走——M3 配自动化断言(采样检测 progress 不回退,原型同款)。
- **I · 荧光笔是填充形状,不是等宽 stroke。** 等宽 + 圆角端 = 贴纸感(产品负责人原话
  「形状太规整」)。正确做法:入笔窄 → 中段饱满 → 收笔收细(正弦包络,指数 0.34),
  整条带随机倾斜,上下边缘各自独立抖动;揭示靠一个从左往右开的 clip 窗
  (`<clipPath>` + rect 改 width)——那正是笔扫过去的动作。适用于将来任何「涂抹类」
  墨迹。

---

## 7. 流式追加协议(开放问题 5)

### 7.1 链路(全部既有管道)

```
agent Edit/append board.md → chokidar → WS(origin:"external") → aggregate-file 重跑 loadBoard
  → Board 新值 → viewer reconcile(R1–R8) → 推断编译(增量) → 画面
```

### 7.2 状态模型

- viewer 持有 **canonical playhead T** 与 **follow 模式**:`live`(默认,跟直播,
  视口跟随书写位置)| `detached`(用户 scrub/暂停后)。
- **canonical timeline**:推断编译纯产物,唯一时间真相;scrub、`navigate-to`、capture、
  未来导出只读它。
- **live 呈现**:forward-only 投影;可被 clamp,绝不回拨、绝不重播已呈现内容;
  clamp 不写回 canonical。

### 7.3 规则 R1–R8(实现与测试的验收基准)

- **R1 前缀稳定。** Step 身份 = (块序号, 内容 hash);编译与 React 渲染以 hash 为 memo 键。
  append 不动已有块 → 已示 step 的编译产物与 DOM 全命中缓存,**结构上不可能重播/闪动**。
- **R2 追加延展。** 新块出现 → canonical 尾部延展。live 下:playhead 停在内容尽头
  (hold 态)→ 自动续播;还在中途 → 无感。
- **R3 过去锚 clamp(live 专属;rev 4 降级为防御性规则)。** 全串行下追加的新 step
  **永远排在 canonical 尾部**——「过去锚」的常态路径已随并行废弃而消失(单线程化的
  架构红利);唯一残余入口是 R4/R4′ 重排使下游时间前移、越过当前 live 位置。规则保留
  作重排场景的总闸:canonical 保留真实位置,live clamp 到现在、不回拨。
- **R4 块内修改(序号同、hash 变)。** 已完全揭示 → 瞬时替换为 `seek(1)` 终态,
  origin:"external" 给一次轻脉冲;未揭示 → 静默换;揭示中 → 重测量、canonical 重编译
  (下游绝对时间平移合法,scrub 总时长更新),live 从当前视觉状态继续。
- **R4′ 结构变更降级。** 中途插入/删除块(纪律外行为)→ 按最长公共前缀重对齐:
  前缀命中照旧,首个分歧点之后重编译;已揭示的重编译 step 直接以终态呈现,不重播。
  不崩、不闪、不擦已示内容。
- **R5 引用失配容错。** chart layer 找不到同名 frame、回指指令(`@strike "…"` 等)
  就近向上匹配不到目标 → 该步降级为坏步 + `refUnresolved` warning;板其余照常。
- **R6 坏块隔离。** chart block 语法错 → 只损失该步,板上小徽标 + `stepParseError`
  warning(带 section.step 与原文摘要)——agent 下轮自愈。
- **R7 scrub 分离 / Live 回归。** 用户碰时间轴 → `detached`(playhead 归用户);追加继续
  延展 canonical 但不动 playhead;常驻 **Live 按钮**(直播回看心智)→ seek 到最后已示
  step 的 end 并回 `live`。agent 的 `navigate-to`/`play-from` 同样置 `detached`。
- **R8 确定性封线。** scrub/replay/capture/导出只读 canonical;R3/R4 的 clamp 是呈现层
  瞬态。测试断言:同一 board.md 最终态,无论以何种追加时序到达,canonical timeline
  字节级相等。

### 7.4 编译-测量流水线与直播节奏

`loadBoard`(纯 parse)→ 测量层(隐藏容器 build 新 step;`document.fonts.ready` 后首测)
→ `inference + timeline`(纯)。测量按 hash 缓存;R1 保证追加只测新块。
**agent 的写入粒度即直播节奏**:skill 教 agent 每次 Edit 追加一到两步(§12),
chokidar 事件流就是播出流。

---

## 8. ViewerAddress 词表(开放问题 3 —— 按约束 E 重写)

### 决策:讲解单位 `{ contentSet?, section?, step? }`,不暴露「第几个 beat」

| Key | Half | 含义 |
|---|---|---|
| `contentSet` | 框架保留 | 板所在 content set;store 自动切 active set |
| `section` | coarse | 小节序(1 起,H2 划分;首个 H2 前的引言是 section 0)|
| `step` | fine | 节内第几步(1 起;段落/图层/分隔线各是一步)|

**一个 address 同时是空间与时间坐标**:`navigate-to {section:2, step:3}` = seek canonical
到该步揭示终点 + 滚动进视口。`<viewer-locator>`「看这条曲线」点击即达;selection 产出
同一 address;`capture {address}` 截同一对象——select → view → point 闭环(协议既定
要求)。append-only 纪律下序号地址稳定;`<viewer-context>` 总是带 `Address:` 行 +
该步开头文字(人类可读锚),agent 逐字复制即可,无需自己数序号。

不设秒级地址(agent 不写也不该引用时间);不设步内片段地址(墨迹绑定已在方言层用
文本标记解决;v2 可视化编辑再议)。

`extractContext` 输出:`Mode: bansho`、`Address: {...}`、该步纯文本摘要、步的讲解类型
(叙述/图表/修正…用讲解词汇,不用渲染词汇)、揭示状态(`shown | showing | upcoming`)、
playhead 与 follow 模式。揭示状态让 agent 知道用户指着「还没讲到的」内容。

---

## 9. Action / Command space(开放问题 4)

边界先立(常见设计错误):**play/pause/scrub/倍速是用户本地播放器控件,不进协议**——
不是 action(agent 不抢播放器)也不是 command(无需 agent 参与)。

### Actions(⑤,`manifest.viewerApi.actions`)

| id | category | params | 语义 |
|---|---|---|---|
| `navigate-to` | navigate | `{ address: object }` | seek canonical 到该步揭示终点 + 滚动进视口;follow 置 detached。「改完带用户看结果」 |
| `play-from` | ui | `{ address?: object }` | 从某步(缺省从头)开始播放——agent「我重放一遍这段推导」的演示动词 |
| `check-board` | custom | `{}` | 结构 QA:坏块清单、chart 引用失配、回指目标失配、公式 parse 失败、已废语法(`@with`/`@after`)出现、行超宽、图表数据越界。返回结构化 issue——mode 自查回路(对标 slide `checkContentFit`) |
| `capture`(内建,不声明) | — | `{ address? }` | 带 address → seek 到该步终态、截图、**恢复原 playhead 与 follow 态**;不带 → 当前视口 |

不做 scaffold:板的起点就是写下标题,agent 自然完成;少一个工具 = 约束 D 的方向。

### Commands(①→⑥)

| id | 触发 | agent 期望响应 |
|---|---|---|
| `continue-here` | 用户 scrub 到某处/选中某步后点「从这里继续讲」 | 收到含 address 的 notification;从该步语境继续追加讲解(展开、举例、答疑) |

v1 仅此一条——「时间轴 × agent」交互的最小完整示范。

### Notifications(⑥ 自主上报,均 warning)

`stepParseError` / `refUnresolved`(chart 同名引用与回指目标共用)/ `boardOverflow`
(内容超板宽)——既有
idle-flush 管道,构成 agent 自愈回路。

---

## 10. Manifest 草案(实例化面)

```ts
// modes/bansho/manifest.ts(要点;无 React、无 engine import)
{
  name: "bansho",
  version: "0.1.0",
  displayName: { en: "Bansho", "zh-CN": "板书", "zh-TW": "板書", ja: "板書", … },
  description: {
    en: "Board-writing explainer — write a lecture in plain markdown and watch it
         perform itself: streaming handwriting, hand-drawn annotations, charts that
         draw stroke by stroke as the narration reaches them, scrubbable like a
         live lecture",
    "zh-CN": "板书式讲解——用普通 Markdown 写一份讲稿,它自己演出来:手写流式浮现、
         手绘标注、讲到哪画到哪的图表,可像回看直播一样拖动时间轴", … },
  icon: "<svg …/>",   // 板 + 粉笔笔画意象

  skill: {
    sourceDir: "skill",
    installName: "pneuma-bansho",
    mdScene: "You and the user are at a whiteboard inside Pneuma. You explain by
      writing a lecture — plain structured markdown in board.md. Everything you write
      performs itself on the user's board: handwriting flows in, your emphasis marks
      become hand-drawn ink, your charts draw themselves as the narration reaches
      them. The board only accumulates; nothing is erased. The user can scrub back
      through time like replaying a lecture.",
  },

  viewer: { watchPatterns: ["**/board.md", "**/theme.css", "**/assets/**/*"],
            ignorePatterns: [], serveDir: "." },

  sources: {
    board:  { kind: "aggregate-file",
              config: { patterns: ["**/board.md", "**/theme.css"],
                        load: loadBoard, save: saveBoard } },   // save v1 stub
    assets: { kind: "file-glob", config: { patterns: ["**/assets/**/*"] } },
  },

  viewerApi: {
    workspace: { type: "single", multiFile: false, ordered: false,
                 hasActiveFile: false, supportsContentSets: true },
    actions:  [ navigate-to / play-from / check-board — §9 ],
    commands: [ { id: "continue-here", … } ],
  },

  agent: { permissionMode: "bypassPermissions", greeting: "<system-info …>…" },

  init: { contentCheckPattern: "**/board.md",
          seedFiles: { … }, seeds: [ … — §13,MVP 阶段仅 demo 板 ], params: [] },

  editing: { supported: true },   // 「回放一场讲解」是真实消费场景(--viewing / online-player)
  evolution: { directive: … },     // §12.3(MVP 后补)
}
```

`pneuma-mode.ts`:标准绑定——`PreviewComponent: BanshoPreview`、`extractContext`(§8)、
`updateStrategy: "incremental"`、`createDirectoryContentSetResolver()`、`actions` 转引
manifest(single source of truth)。注册:`AGENTS.md` Builtin Modes 行 + `README.md`
**和 `README.zh.md`** mode 表(release checklist 双语要求)。

---

## 11. 契约三元组(每个被触及契约:定义 → 实例化 → 消费)

| 契约 | 定义(不动) | bansho 实例化 | 消费端(全部既有) |
|---|---|---|---|
| ModeManifest | `core/types/mode-manifest.ts` | `modes/bansho/manifest.ts` | `loadModeManifest` → skill-installer / source-registry / seed-installer |
| ModeDefinition | `core/types/mode-definition.ts` | `modes/bansho/pneuma-mode.ts` | frontend `mode-loader` → App.tsx 挂 `BanshoPreview` |
| ViewerContract | `core/types/viewer-contract.ts` | `pneuma-mode.ts` viewer 面 | App.tsx / store 注入 props |
| ViewerAddress | 同上(opaque) | 词表 `{contentSet?, section?, step?}` 登记在 SKILL.md | selection 产出(⑥);locator / capture / navigate-to 消费(⑤) |
| ViewerActionDescriptor | 同上 | `viewerApi.actions[]` ×3 | skill-installer 注入 `pneuma:viewer-api`;ws-bridge-viewer 分派;viewer-slice 派发 |
| ViewerCommandDescriptor | 同上 | `commands: [continue-here]` | props.commands;点击 → onNotifyAgent → ws-bridge |
| ViewerSelectionContext + extractContext | 同上 | `pneuma-mode.ts` 实现 | ws-bridge 注入 `<viewer-context>` |
| ViewerNotification | 同上 | 三类 warning(§9) | ws-bridge 缓冲、agent idle flush |
| Source(aggregate-file / file-glob) | `core/types/source.ts` | `sources.{board,assets}` + `domain.ts` | `core/sources/*` 实例化;`useSource` 订阅;四不变量 base 强制 |
| EvolutionConfig | `core/types/mode-manifest.ts` | `manifest.evolution.directive` | evolution-routes / evolve mode |
| **Revealable(新,mode 内部)** | `modes/bansho/engine/types.ts`(D7) | `engine/factories/*` | `engine/timeline.ts` 分发;`viewer/useBoardPlayer.ts` 驱动。上提见 §14 |

`core/types/` 零改动 → 契约四件套传播不触发;AGENTS.md 只动 Builtin Modes 行。

---

## 12. Skill 与 Evolution(开放问题 9、10 —— 按约束 D/E 重写)

### 12.1 定位(硬要求)

SKILL.md 是**表达媒介的说明书,不是工具箱手册**。agent 读完的第一感受必须是
「我知道怎么把这件事讲清楚了」。判据(写进 review 验收):全文出现 wipe/stroke/fade/
duration/animation-pick 类词汇即为写错;不出现「选择动画效果」的段落;方言表要像
「标点符号用法」而不像「API 参数表」。

### 12.2 结构(六段式,主体 <400 行)

- **Scene**:你在板前讲解。你写讲稿,板自己演——你的强调变成墨迹,你的图表讲到哪画到
  哪。板只增不擦;用户会拖时间轴回看你讲过的每一步。
- **How the board reads your writing**(方言 = 表达语义):§4.3 两张表的讲解化写法——
  每行的主语是表达动作(强调/修正/给证据),渲染列一句带过且不用渲染词汇
  (「荧光笔扫过」是板书词汇,允许;「wipe 动画」不允许)。
- **Expression moves(核心章,取代 rev 1 的 Core rules 大部)**——开篇一句定调
  (rev 4):**「板上只有一支笔。你写下的每一件事都会等前一件事收笔。」** 每个表达
  动作都是独占的一笔,不存在「同时」。六个动作各配一个 input→板上效果 的对照例:
  - **铺垫**:标题 + 引言段,让板先有一个问题;
  - **强调**:`==荧光==`、`**下划线**`、`((圈出关键值))`——句子写完,笔才回来划
    重点,划完再继续;一句话最多一处重笔,满板重点等于没有重点;
  - **对比**:同一张 chart 的两条曲线**一条画完再画一条**——对比感来自并置的结果,
    不来自同时的动作;并列命题用列表 + `:`/` — ` 分隔,板会自动对齐成列;
  - **修正(两种形态)**:原地划 `~~旧说法~~` = 「明知故写」的修辞(写一个错误说法
    立即否定);**回头划 `@strike "…"` = 论证推进后的修正**(先立、再驳、后划——
    观众先听到理由,再看见结论被划掉)。两者都是**写错不擦,划掉再写,思维过程本身
    是内容**——本 mode 与所有 slide 工具的根本区别;板上东西还在,所以才能回头指。
    向 agent 这样解释 `~~` 记号:CommonMark 语义(「这段是删除的」)与板书意图本来
    一致,bansho 只是**把静态语义时间化**——先写出来,再当着观众划掉;
  - **给证据**:结论段后面紧跟 chart 块——讲完那句,转身画那条线;先立框(轴),
    再逐层给线,一层配一句话;公式用 `$…$` 直接写,板会像手写一样从左往右展开;
  - **收束**:`---` + 总结段 + 圈出最终结论。
- **Two disciplines(仅两条,陈述 + why):**
  1. **你只写内容,时间不归你管。** 讲稿里没有任何时间字段——节奏由内容自然长度决定,
     这是「像人」的那一半。你的节奏杠杆是**结构本身**:句读、分段、`---`、图表分层。
     (`@wait` 是唯一的节奏逃生口,一场讲解里出现超过两三次说明结构该重排了;
     `@with`/`@after` 不存在——板书是单线程的。)
  2. **板不会忘记。** 不删已播内容、不改用户看过的段落。写错了用板书教师的方式改:
     划掉 + 写对。只允许两种行内修改:尚未播出的块(用户没看过)与 typo 级修正。
- **Working with the viewer**:ViewerAddress 词表(§8 表)、`<viewer-context>` 揭示
  状态怎么读、三个 action 何时用(改完 navigate-to 给用户看;重讲用 play-from;收尾
  check-board + capture 自查)、`continue-here` 的响应剧本、三类 warning = 自愈待办、
  **写入粒度即直播节奏**(每次追加一到两步,一次 dump 全文会把直播压成贴大字报)。
- **References**:`board-language.md`(方言完整参考 + 更多对照例)、`charts.md`
  (图表分层叙事的节奏设计:先框后线、一层一句、mark 收口)、`voice-and-pacing.md`
  (讲解文风:句子短、每段一个意思、何时分节)、`themes.md`(theme.css token、字体栈)。

### 12.3 Evolution directive(三段式;MVP 后补入 manifest)

> Learn the user's lecturing style from session history and the boards they kept:
> expression-move habits (how often they highlight vs circle vs strike-and-correct),
> structural rhythm (section length, chart density, aside usage), chart storytelling
> preferences (layer-per-sentence vs all-at-once, mark usage), language and tone of
> board text, and preferred board themes. Augment the skill so the main agent adopts
> these as defaults while always yielding to explicit instructions.

---

## 13. Seed 策略(开放问题 8 —— 按约束 F 重排)

**MVP 阶段交付两块板**(rev 4):`demo/board.md` = §4.2 的 NVIDIA/AMD 讲解(图表主
路径的验收样张);`argument/board.md` = 形式化论证板(真实测试文档改编——公式
`$\mathfrak{E}$` / `$R_j \subseteq A \times B$`、回指划掉(先立、再驳、后划)、并列
命题对齐三项新能力的验收样张)。两块板同时兼任 agent 的 few-shot 范文与 skill 活例。

骨架完备阶段补齐四卡(与 slide 同构,显式 `init.seeds[]`):

| id | 内容 | 展示什么 |
|---|---|---|
| `en-paper` | NVIDIA/AMD demo(打磨版) | 白板纸感;全部表达动作 + staged chart |
| `zh-paper` | 「复利的直觉」中文板 | **CJK 全 wipe 路径旗舰演示**——中文体验不打折 |
| `en-chalk` / `zh-chalk` | 深色黑板 + 粉笔 token | theme.css 换肤;黑板是 bansho 直觉意象 |

每 seed = `<id>/board.md + theme.css (+ assets/)`;`contentCheckPattern: "**/board.md"`。

---

## 14. D7:Revealable 上提 thin waist 的触发条件与预期形状

**现状**:`engine/types.ts` 持有 Revealable/RevealKind/RevealableFactory/BoardTimeline;
engine/ 零 React、零 src/ 依赖,已是物理隔离的候选包。

**上提触发(任一即启动,需人批准 + 新 ADR):**
1. 第二个 mode 真实需要渐进揭示(doc 的讲解回放、diagram 的逐步成图);
2. online-player 要在 mode bundle 外回放 bansho session——引擎须成为可独立打包单元;
3. Remotion 导出落地且要共享引擎宿主胶水。

**预期形状**:`core/types/revealable.ts`(Revealable / RevealKind / RevealableFactory /
MeasureContext)+ `core/reveal/`(strategies)。**inference / 讲稿方言 / BoardTimeline
不上提**——讲解编排是 bansho 的 domain,不是协议。届时走完整四件套(core/types +
core/__tests__ + docs/reference + AGENTS.md 契约表)。

---

## 15. 决议记录(rev 4 终审后全部收口;Phase 1 无待验证开放项)

| # | 事项 | 终态 |
|---|---|---|
| Q1 | 推断常数 | 机制全部已定(全串行);常数 = 串行化实测初值(§5.1-I8);**最终值在 M5 由产品负责人用倍速档位试出后回写**——参数调校,不是机制验证 |
| Q2 | 数学公式 | **进 v1**(产品负责人要求,rev 3 的「推 v2」作废):KaTeX 解析 → MathML 渲染(§6.3) |
| Q3 | chart v1 种类 | 仅 line;`type:` 字段预留 bar |
| Q4 | `~~` 与 CommonMark 撞语义 | 接受——把静态语义时间化;表述已进 §12.2 |
| Q5 | 倍速控件 | 做;档位 0.75 / 1 / 1.25 / 1.5;**只改播放速率不动 canonical**(`t += dt × rate`) |
| Q6 | 并行动画 | **废弃**(产品定义:板书单线程,一支笔)——原 I5/I6 整条删除,单笔不变式立为可测架构硬约束(§5.1) |
| Q7 | 回指标注 | 进 v1:`@strike "…"` 指令家族,就近向上匹配(§4.3);备选(显式块 id 引用)已否决——污染默认路径 |
| Q8 | 笔尖跟随光标 | **已否决**(§6.4-F,原型试过并移除);重启唯一路线 = per-path `getPointAtLength` |
| Q9 | mode 文案 | `bansho` /「板书」(zh)/「Bansho」(en);launch 前定稿 |

(双列板面、真笔迹中文、可视化编辑、bar 图——明确 v2+。旁白/TTS 已随 T10 进入 v1
基础层——`narrate`/`subtitles` action、manifest 配速、§6.3 的 G3 hook;音频播放
conductor + clock gate 是 T10-4。)

---

## 16. 风险清单(按严重度排序)

1. **★最高:推断与新能力在真实题材上的泛化(§5)。** 约束 B 把编排权从 agent 手里
   拿走——推断表就是产品体验本身。已实测部分(常数、单线程节奏)「对不对」已解;
   残余是公式/回指/对齐三项按真实文档新增的能力与既有机制的**组合面**未全验(公式内
   带墨迹?回指跨 section?对齐组内含公式?),以及新题材(长段落、密集图表)上推断
   规则是否成立。缓解:规则与常数集中两个纯函数文件、双板样张(demo + 论证板)作基准
   回归、M5 真 agent 走查、`@wait` 逃生口保底。**这是把 rev 1 的「schema 表达力
   天花板」风险换来的形态,方向正确但要认账。**
2. **流式追加的 live/canonical 一致性(§7;rev 4 危险面显著缩小)。** 单线程化后
   追加永远落在 canonical 尾部,「过去锚」常态路径消失(R3 降级为防御性规则)——
   废并行的架构红利。残余危险角:块中途修改下游平移(R4)、无显式 id 的身份对齐
   (R4′)。缓解:前缀不变量 + canonical 纯函数 + clamp 只在呈现层 + **R1–R8 与单笔
   不变式逐条钉进 test-suite**(canonical 字节级确定性断言是核心)。
3. **方言 parser 容错面扩大(rev 4)。** 新增 `$` 定界(**与货币符号歧义:金融题材
   demo 板里 `$100` 必然出现而它不是公式**——需成对定界 + 边界启发式,如 opening `$`
   后非空白、closing `$` 后非数字)、`@` 指令、对齐组识别;agent 还会写边缘 Markdown
   (嵌套标记、断裂 fence)。缓解:方言仍极小、未知标记按纯文本渲染、块级隔离
   (R6)、parser 纯函数高密度单测含歧义样例(M1 验收)。
4. **测量稳定性与字体静默 fallback。** 字体晚到/视口变化改测量 → canonical 漂移;
   更阴险的是系统字体**静默 fallback**(`Hannotate SC` 事件,§6.4-A)——不报错,
   手写质感直接消失。缓解:固定逻辑板宽(缩放走 transform 不 reflow)、`fonts.ready`
   后首测 + **canvas 测宽验证字体真生效**、按 hash 缓存、session 内 canonical 不因
   视口重算;非 macOS 字体栈降级在 M5 视觉验收中显式核查。跨机器差异接受
   (canonical per-session 确定;导出场景 v2 再加字体嵌入)。
5. **长板性能。** 数百 step 的 DOM/SVG 体量与每帧分发。缓解:活动窗口分发、p 不变
   不调用、已示 step 是静态 DOM、视口外 content-visibility;v1 设计目标 ~200 step,
   超限 `check-board` 提示。
6. **agent 纪律依从性。**「小批量追加」「划掉不删」是 skill 层约束。缓解:check-board +
   三类 warning 自愈回路;R4′/R5/R6 保证违纪只降级不崩坏;evolution 长期把用户实际
   节奏学回默认。

---

## 17. 与 ADR / 惯例的对齐声明

- **对齐** ADR-004(mode 即插件、manifest 驱动、server 零 mode 知识)、ADR-006(skill
  安装与 marker block,零新 block)、ADR-007(chokidar → WS 流式管道,直播建在其上)、
  viewer-agent-protocol 六方向(全走既有通道)、Source 四不变量(aggregate-file 标准
  用法)、ViewerAddress 收敛提案(单一词表、locator/capture/navigate 闭环)。
- **对齐** ADR-015(borrow):与 remotion 的将来串联走 borrow,不融合(D6)。
- **对齐惯例**:Bun API、英文源码(seed/showcase 中文豁免)、design token(viewer
  chrome 用 `cc-*`;板面由 theme.css 主题化,slide deck 主题同一先例)、conventional
  commits、frontend 视觉验证纪律、`bun:test` 共置(`modes/bansho/__tests__/`,kami 先例)。
- **无偏离项。** 唯一新契约 Revealable 依 D7 留 mode 内;上提之日再走四件套 + 新 ADR。

---

## 18. 任务清单(dev-master-orchestrator 输入;MVP 垂直切片优先,约束 F)

> taskKind ∈ contract / feature / viewer / test-suite。viewer 任务受
> `.claude/rules/frontend.md` 约束(chrome-devtools-mcp 视觉验证必做);测试共置
> `modes/bansho/__tests__/`;实现前按域读 `.claude/rules/` 对应文件。
> **rev 4:全部机制已定,Phase 1 无待验证开放项;唯一后置的是 M5 常数终校(参数
> 调校,非机制验证)。Phase 1 五个任务合起来 = 两块可看的板(NVIDIA/AMD demo +
> 形式化论证板),可 scrub、可倍速、可流式直播。**

### Phase 1 — MVP 垂直切片(验收:demo 板端到端可看可 scrub)

| ID | 任务 | taskKind | 依赖 | 验收要点 |
|----|------|----------|------|----------|
| **M1** | 讲稿方言 parser + domain:`domain.ts` + `engine/types.ts` 类型定稿。块级/内联解析(rev 4 全集:`$…$`/`$$…$$` 数学定界、`@strike\|@circle\|@highlight\|@underline "…"` 回指指令、`@wait`、列表对齐组识别)、chart 累积容器、块级容错、Step 身份 hash、srcSpan(§6.4-E)+ 单测 | contract | —(W1 独占,Phase 1 首任务) | §4.3 方言全集单测覆盖;**`$` 定界与货币符号消歧**(`$100` 非公式:成对 + 边界规则,金融 demo 板即测例);回指就近向上匹配语义单测(歧义取最近、找不到出坏步);已废语法 `@with`/`@after` 出现 → 坏步;坏块隔离;未知标记按纯文本;**srcSpan 覆盖率 100%(含 chart 块内每一行)**;类型定稿供 M2/M3 并行 |
| **M2** | 串行推断编译器 + 时长模型:`engine/{inference,duration,timeline}.ts` 纯函数 + 单测 | contract | M1(与 M3 并行) | I1–I9(rev 4 全串行)实现;常数 = §5.1-I8 串行化实测初值(集中一处,M5 终校后回写);**单笔不变式:输出 schedule 区间两两不重叠 + property 测试(随机讲稿采样,断言任意时刻并发 ≤ 1)**;R8 确定性(同 Lecture + 同测量 → 字节级同 schedule);I9 切分(中文 1–2 字 / 英文按词)专项测试;测量 mock 注入不碰 DOM |
| **M3** | Reveal 引擎:strategies(wipe/stroke/fade)+ **手写 sketch 几何(sketchPath/jitterLine/jitterEllipse,零依赖)** + factories(prose/chart/ink/math/rule)+ **KaTeX→MathML(`factories/math.ts`,`katex` 入 package.json)** + Hershey vendor + 降级协商 + §6.4 硬规则 A–D/G/H/I;NOTICE.md | feature | M1(与 M2 并行) | **engine 核心零外部 import(grep 验收;唯一例外 `factories/math.ts` import katex)**;seek(p) 纯映射可乱序;**运行时单笔采样测试(遍历时间轴采样断言进行中单元 ≤ 1——原型探针同款,4 场景 × 150 采样形状)**;**easing 严格单调递增自动化断言(§6.4-H)**;**多行连续标注墨迹零碰撞(getBBox 两两相交自动化,§6.4-G)**;荧光笔为填充形状 + clip 窗(§6.4-I);§6.4-D 追加进 `.claude/rules/frontend.md` gotchas;image/html factory 可延后到 P2 |
| **M4** | mode 壳 + player 核心:最小 `manifest.ts`/`pneuma-mode.ts`(board+assets sources、watchPatterns;actions/commands/seeds 留空)+ `BanshoPreview/BoardCanvas/useBoardPlayer` + 流式 R1/R2/R4/R4′(R3 防御性)+ scrub `Timeline.tsx`(step 刻度 / section 分节 / Live 按钮 / **倍速 0.75/1/1.25/1.5,只改 `dt × rate` 不动 canonical**)+ 视口跟随(**含回指墨迹播放时滚到目标**)+ 并列对齐渲染 + **讲稿行级高亮跟随播放(消费 srcSpan,§6.4-E)**(笔尖跟随已否决,不做,§6.4-F) | viewer | M2, M3 | 双板逐段追加像直播、已播零重播(截图验证);scrub 确定性(任意 t 画面 = t 时刻的板);倍速切换 canonical 不变;回指播放时视口滚到目标;对齐组两列对齐;播放到哪个单元精确高亮讲稿哪一行;chrome-devtools-mcp 视觉验证 |
| **M5** | 双板 + 端到端 + 常数终校:`seed/demo/board.md`(§4.2 NVIDIA/AMD)+ `seed/argument/board.md`(形式化论证板:公式 / 回指 / 对齐三项能力的验收样张)+ `theme.css`(亮 `'Bradley Hand','HanziPen SC',…` / 暗 `'Chalkboard SE','HanziPen SC',…`,§6.4-A)+ 真 agent 流式写入走查 + **常数校准点:产品负责人用倍速档位试出舒服值,终值回写 duration.ts** | feature | M4 | 双板 × 双语 × 双主题截图;单线程手感(一支笔,每件事等前一件收笔)经产品负责人确认;公式从左往右手写式展开;回指顺序正确(先立、再驳、后划);多行标注零碰撞实景确认;字体真生效 canvas 测宽核查;对齐列实景确认;**常数终值回写完成——Phase 1 唯一后置项(参数调校,非机制验证)** |

**Phase 1 wave 编排:** `W1: M1` → `W2: M2 ∥ M3` → `W3: M4` → `W4: M5`。
关键路径 M1→M2→M4→M5;M4 最重,若需再切按「player 核心(流式 R 规则 + 引擎挂载)」/
「Timeline + 倍速 + 对齐 + 源高亮」二分,严格串行。M5 结束 = 两块可看的板 + 常数
终值,直接进 Phase 2——无 gate 条件(机制无待验证项)。

### Phase 2 — 协议面与加固

| ID | 任务 | taskKind | 依赖 | 验收要点 |
|----|------|----------|------|----------|
| **P1** | 交互面:selection + `extractContext`(§8)+ actions(navigate-to / play-from / check-board)+ capture(seek-shoot-restore)+ `continue-here` 命令 + 三类 notification(`stepParseError` / `refUnresolved` / `boardOverflow`)+ manifest 补全(actions/commands/editing) | viewer | M5(与 P2/P3 并行) | address 闭环实测:select → `Address:` 行逐字回投 capture/locator 成立;R7 scrub 与直播并发;check-board 覆盖 §9 全部检查项(含回指失配、公式 parse 失败、已废语法检出) |
| **P2** | 流式 & 推断 test-suite:R1–R8 逐条回归(追加/块中途改/结构变更 R4′/坏块/scrub 并发的模拟 FileChangeEvent 序列)+ canonical 确定性 property 测试 + **单笔不变式回归** + 公式/回指/对齐组合面边缘样例(§16-1)+ image/html factory 补全 | test-suite | M2(编译器半可先行), M5(与 P1/P3 并行) | §16 前三大风险各有专项样例;不依赖真 chokidar |
| **P3** | SKILL.md + references ×4(§12)+ mdScene 定稿 | feature | M5(与 P1/P2 并行,终稿在 P1 后小修) | 约束 D 验收:全文零渲染词汇(wipe/stroke/fade/duration)、零「选择动画效果」段落;**「板上只有一支笔」纪律 + 回指/公式/对齐教学落位**;review 出现工具箱笔法即打回 |

`W5: P1 ∥ P2 ∥ P3(P3 可与 P1 并行,终稿在 P1 后小修)`

### Phase 3 — 骨架完备(全部后置,约束 F)

| ID | 任务 | taskKind | 依赖 | 说明 |
|----|------|----------|------|------|
| **S1** | Seeds ×4(en/zh × paper/chalk;demo 板与论证板打磨进 seed)+ seed-gallery 缩略图 + `init.seeds[]` 文案 + i18n displayName/description 补全 | feature | P3 | zh 板验证 CJK 全链路;seed 即 few-shot 范文;gallery 卡片文案双语自然(非翻译腔) |
| **S2** | evolution directive 入 manifest + mode 注册(AGENTS.md Builtin 行、README/README.zh 表)+ changelog | feature | S1 | 双语 README 同步是 release checklist 硬要求 |
| **S3** | Showcase(`/showcase`:showcase.json + hero + 3-4 highlight) | feature | S1(与 S2 并行) | 高光:一支笔的单线程书写、讲完那句画那条线、回头划掉(先立再驳后划)、公式手写展开、scrub 回看 |

`W6: S1` → `W7: S2 ∥ S3`。版本 bump 走 `/bump`,不在本清单。

**关键路径:** M1 → M2 → M4 → M5(→ 常数校准)→ P1。最重任务是 M4;若需再切,按
「player 核心(R1–R4)」与「scrub/Timeline + 视口跟随」二分,严格串行。

---

*完 — 本稿为 DRAFT(rev 2);Phase 1 验收样张即 §4.2 demo 板。批准后按 §18 切分实施。*
