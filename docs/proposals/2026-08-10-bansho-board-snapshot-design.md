# Bansho —「抬头看一眼」板面快照 设计规格

> 2026-08-10。承接同日的意图书（`2026-08-10-bansho-board-snapshot-brief.md`）——
> 那份文件是需求本身，本文是方案。产品负责人当日的补充指示一并落实：
> **viewer API 是写作 agent 的眼睛和工具，所有内容的效果他不能光靠想象**——
> 所以本文不止设计快照一个动作，而是把整个感官面（快照 · check-board ·
> capture · navigate）组织成一个写作循环，并把 SKILL.md 的行预算当设计问题解掉。
>
> 设计依据：`engine/layout.ts`（归属折叠）、`engine/stage.ts`（舞台折叠）、
> `2026-08-09-bansho-c2-c3-tasks.md`（已定舞台设计）、
> `2026-08-10-bansho-stage-codex-review.md`（P1-1 孤儿响亮化——三问之三的硬需求来源）。
> 本文交给按字面执行的实现者：**凡是留给谁拍板的选择都显式标出，其余全部钉死。**
>
> **rev 2（2026-08-10 晚）：** 对照首位全强度使用舞台方言的作者的摩擦报告修订。
> 该报告独立造出了本设计的核心（一个逐板走 `data-bansho-ref` 的 DOM 探针，
> 每次编辑后重跑——「那个探针就是缺的功能」），验证了 §2 的有界性洞察；
> 同时暴露一个真缺陷（auto-erase 静默拆板，见 §9.1）与一个真诱惑
> （dry-run 折叠模拟器，裁决见 §7.5）。全部修订处以「（rev 2）」标出。
>
> **rev 3（同日）：** 产品负责人对原 §15 问题 6 裁定——**方言动词现在就铸，
> 入 S1，不等第二例**：它补全语义家族（strike 否定在视野里 · erase 腾地方 ·
> **turn 换话题留着前面的**），而这个缺口正是垫料战的起因。完整设计见 §7.6；
> rev 2 的 `nextOverflow` 裁决与 dry-run 的永久拒绝**原样成立**——
> 恰恰因为表达出口补上了，拒绝才从「有原则」变成「安全」。

---

## 0. 一句话方案

快照是 canonical timeline 的第三投影——**把已有的归属折叠停在一个文档位置上读出来**，
不新增任何机制、任何磁盘状态、任何 `core/types/` 契约。一个纯函数、一个 cut 参数、
两个消费者：agent 的 `glance-board` 动作（cut = 文档末尾）与人看的仪表条
（cut = playhead 所在步）。答案的大小由**板的物理块数**封顶（任意时刻每块板最多站着
一个 open run），与讲稿长度无关——200 步的课，抬头一眼仍然是十几行。
这正是「物理受限逼出抬头」在成本上的兑现。（rev 3 起本设计还含一个方言动词：
**`@turn`**——「换话题了，前面那块留着」，补全 strike / erase / turn 语义家族，
产品负责人裁定与快照同入 S1；设计在 §7.6。S1 因此从「感知包」成为「感知 + 表达包」。）

---

## §1 问题与力（用本项目的话重述）

- **这是节奏里的一个动作，不是参考资料。** 抬头看 → 决定（找空板 / 擦掉讲完的 /
  接着写）→ 落笔。老师必须抬头，**因为板面有限**；工具复现这个约束，不绕过它。
- **三问是验收标准**（brief 已钉）：① 还有空地方吗；② 哪块可以擦了；
  ③ 我刚才写的还在不在（P1-1 之后，指向已擦内容**响亮报错**——锚点是否站着
  从 nicety 变成硬需求）。
- **便宜是一等需求。** 贵了 agent 就不调，循环就死。
- **派生，绝不手写**；**零新增磁盘状态**；**同一份 timeline 的第三投影，
  一次计算两个消费者**——三条都是 brief 里已定的原则，本文不复议。
- **新增的力（产品负责人 2026-08-10 补充）：** viewer API 是 agent 的感官。
  agent 读自己的 markdown 推想板面效果，正是被禁止的行为——与本仓
  `.claude/rules/frontend.md`「视觉正确性不许靠读代码判断」是同一条纪律下沉一层。

**成功判据：** agent 在每个 append 批次前抬头一次的成本（token + 延迟）低到
它真的会这样做；三问每问都能从答案里直接读出；答案永远不撒谎
（测量没跟上时诚实说，而不是给旧账）。

---

## §2 关键洞察：答案的大小由板封顶，不由讲稿

归属折叠（`engine/layout.ts::foldBoardLayout`）的结构保证：**任意 cut 处，
每块板上站着的内容恰好是它当前的 open run**——closed run 全部隐藏。
所以站着的内容 ≤ 板数（≤ 4）个 run，每个 run 再按 section 切成少量段。
压缩不是有损近似，是**结构性事实**：板面有限 ⇒ 快照有界。

200 步 / 4 块板 / 12 个 section / 6 次擦除的课：站着的 run ≤ 4，
每 run 跨 1–3 个 section ⇒ 全部段落行 ≤ 10；渲染出来
4 行板 + 段落并入板行 + 擦除汇总 1–2 行 + 笔位 1 行 + tip 1 行 + basis 1 行
≈ **12–18 行，约 250–450 token**。计算侧是一次 O(n) 前缀折叠（微秒级），
测量高度全部命中 `foldHeight` 缓存。对照面：逐步罗列是 200+ 行——brief 明令禁止的形态。

**（rev 2）实践验证：** 首位全强度作者在没有本功能的情况下，自己搭了一个
逐板走 `data-bansho-ref` 的 DOM 探针、每次编辑后重跑，并原话说
「那个探针就是缺的功能」。探针的输出形态与本节推导的答案形态一致——
有界性不是纸上推论，是被独立复现过的工作方式。

---

## §3 投影本体：cut 参数化的前缀折叠（开放问题 #1 的解）

**一个投影，一个 cut 参数，cut 用文档位置表达，不用秒。**

```
snapshotAt(cut) = derive( foldBoardLayout(foldInputs, count, budget, cut), lecture )
```

- 折叠是纯前缀折叠（prefix-stable），所以「停在 cut 的折叠」与
  「完整折叠在 cut 处的中间状态」**恰好是同一个东西**——快照字面上就是
  把既有折叠停在半路读出来。没有新机制（这是 brief 两条 caution 里
  「不要发明机制」的正面兑现）。
- **钉死实现形态：`foldBoardLayout` 增加可选 `cutIndex` 参数，绝不在外部
  slice 输入数组。** 原因是 P1-2 的同一机制换了个面出现：折叠开头的
  `growthOf` 预扫描遍历**全部**输入，容器 frame 的 charge 是
  `height − Σ growth`，而 `height` 是今天量到的累积并集（cut 之后的图层
  已经长在里面）。slice 掉 cut 之后的输入 ⇒ `growthOf` 丢失后文图层的
  growth 申报 ⇒ frame 被多记 charge ⇒ 游标虚高、溢出判定可能翻转、
  frame 与 cut 之间的步可能被投到与它实际所站不同的板上——人视图会与
  它旁边的板自相矛盾。正确形态：**预扫描仍走全量输入，主循环只走到
  `cutIndex`**。锚定擦除与 backref 路径不受此影响（锚一律向上解析、
  落在前缀内）——实现者不要把这个修正过度推广到它们身上。
- **agent 的「现在」= 文档末尾**（完整折叠的终态）。它在时间轴末尾追加，
  决定的是下一笔落哪——与 playhead 无关。`glance-board` 动作**钉死 cut = end，
  不暴露时间参数**（YAGNI；playhead 事实已经由 `<viewer-context>` 的
  BoardMoment 携带）。
- **人的「现在」= playhead 所在步**。人看的视图把 playhead t 映射成
  activeIndex → 该 schedule entry 的 step → foldInputs 里的位置，调同一个投影。
  钉死映射规则：**窗口已开始（start ≤ t）的 fold-relevant 步计入前缀**——
  擦到一半的板读作已擦（「被擦着呢」），写到一半的步读作站着。
  这条只影响人视图（S2），不影响 agent 动作。
- 引擎因此保持无钟（G2）：cut 是文档序号，秒→步的换算发生在 viewer。

**结论（回答开放问题 #1）：同一投影的不同入参，不是两件事。**

---

## §4 答案的形状（钉死到字段）

### 4.1 `BoardSnapshot`（`viewer/board-snapshot.ts` 导出，pure）

```ts
interface SnapshotSegment {
  /** Section index (0 = the opening). */
  section: number;
  /** The section's heading text (the opening: the lecture title), ≤ 40 chars. */
  label: string;
  /** Inclusive step range of THIS segment's standing steps, e.g. [1, 6]. */
  steps: [from: number, to: number];
  /** section < tip.section — the lecture has moved past this section. */
  finished: boolean;
}

interface SnapshotBoard {
  /** 0-based; rendered as "board 1..n". */
  panel: number;
  /** null when the board has standing content. */
  blank: "fresh" | "wiped" | null;
  /** Standing = the board's open run, split per section, document order. */
  standing: SnapshotSegment[];
  /** Closed runs so far: how many, how many the ROOM closed (auto-erase —
   *  retirement the agent never expressed; rev 2), and which sections they
   *  held (deduped labels). */
  erased: { runs: number; byAuto: number; sections: string[] };
  /** Every standing segment finished AND the tip is not on this board. */
  dormant: boolean;
  /** usedPx = the open run's charged height; budgetPx null on the strip. */
  occupancy: { usedPx: number; budgetPx: number | null; fraction: number | null };
}

interface BoardSnapshot {
  boards: SnapshotBoard[];
  /** Where the NEXT stroke lands — the fold's current panel. Fact, not
   *  promise: the next step's height is unknowable, so roomSteps is a hint. */
  pen: {
    panel: number;
    roomSteps: number | null;
    /**
     * (rev 2) What the ROOM will do when the pen's board fills — the
     * fold's own three-tier overflow policy (never-used → erased-empty →
     * auto-erase earliest-filled) read out on the CURRENT panel states.
     * Deterministic, zero candidate input: this is perception of standing
     * policy, NOT a prediction about any particular block (§7.5).
     * null on the single strip (it never overflows).
     */
    nextOverflow:
      | { kind: "fresh" | "wiped"; panel: number }
      | {
          kind: "auto-erase";
          panel: number;
          wouldErase: { sections: string[]; steps: number };
        }
      | null;
  };
  /** The last CONTENT step written (never camera/erase/wait/board-config). */
  tip: { address: BoardAddress; excerpt: string; panel: number } | null;
  basis: {
    /** Fold-relevant steps this answer covers. */
    steps: number;
    /** "catching-up": the compile (or the on-disk file) is ahead of this answer. */
    measured: "complete" | "catching-up";
  };
}
```

钉死的语义（实现者不得自行改判）：

- **tip** = 折叠输入里最后一个 **content** 步。讲稿以 `@erase` 结尾时，
  tip 是它前面的内容步。空板 → `tip: null`。
- **finished** = `segment.section < tip 所在 section`（cut = end 时文档序保证
  之前的 section 已完结，这个比较就是完整定义）。
- **dormant** = 该板所有 standing segment 都 finished **且** tip 不在该板。
  skill 的教学语义：「dormant 的板就是可以擦的板」——判断仍归 agent
  （擦除是表达），快照只给事实加一个机械提示。
- **blank**：`"fresh"` = 从未开过（fold 的 `opened === false`）；
  `"wiped"` = 开过、被擦空（cursor 0 且无 members）。
- **roomSteps** = `remaining > 0 && unit > 0 ? floor(remaining / unit) : 0`，
  其中 `remaining = budgetPx − usedPx`，`unit` = 该板 standing 步 charge 的中位数
  （该板无 standing 步时取全板 standing 步的中位数；仍无则 `null`，渲染省略）。
  单条长卷（budget = Infinity）→ `roomSteps: null`，渲染说「长卷不设上限」。
- **excerpt** 复用 `board-check.ts` 的 `quote()` 纪律（折叠空白、160 上限——
  tip 用 70，与 `summarizeStep(step, 70)` 一致）。
- **nextOverflow（rev 2）** 的判定**必须**调用 `engine/layout.ts` 导出的
  `nextOverflowTarget(panelStates)`（§8）——与折叠 overflow 分支共用同一实现，
  绝不在 derive 里把三级策略抄一遍。`wouldErase` = 目标板 open run 的
  section 标签（去重）+ 步数。

### 4.2 刻意省略什么（与包含什么同等重要）

| 省略 | 理由 |
|---|---|
| 站着步骤的正文 | agent 自己持有 `board.md`；地址范围 + section 标签足以把「我要锚的那句话」映射到站/擦判定。给正文就是把 200 行问题请回来 |
| 已擦内容的正文 | 只报 section 标签 + run 计数。擦除史可无限增长，标签有界 |
| 时长 / schedule / playhead | 决定「往哪写」不需要时间；playhead 已在 viewer-context 里 |
| 镜头 / 舞台姿态 | 观看状态，不是书写状态 |
| findings（孤儿、溢出、公式错） | **那是 check-board 的答案。感知与诊断不合并**（brief 已钉）。快照说「现在是什么样」，check-board 说「有没有错」 |
| narration / 语音状态 | `narrate` 的领地 |

### 4.3 渲染模板（`renderSnapshot(snapshot) → string`，测试钉字面）

与 `board-check.ts` 的 SENTENCE / HEADLINE 同一纪律：**渲染是纯函数，
`__tests__` 钉住确切措辞**，动作的 `message` = 渲染结果，`data` = 结构体。示例：

```
The pen is on board 2 — 55% used, room for ~4 more steps like the ones standing.
If board 2 fills, writing continues on board 3 (blank, fresh).
board 1 — full · §1 "先把那句口头禅立在这里" steps 1–6 standing · finished
board 2 — 55% · §2 "换一个问法" steps 1–5 standing · current
board 3 — blank (fresh)
board 4 — blank (fresh)
Erased so far: board 1, once by the room (§0 "为什么加机器不一定更快", 4 steps).
Tip: §2 step 5 "把乘出来的东西求平均" — the last thing written.
This answers all 47 steps of board.md, measured.
```

（rev 2）第二行是 `nextOverflow` 的渲染；房间已满时替换为预警形态（纯事实，
不带劝告——劝告归 skill）：

`The room is full — its next overflow wipes board 1 (§1 "先把那句口头禅立在这里", 6 steps).`

catching-up 时末行替换为：
`The board is still catching up to board.md — this answers what is standing now; ask again in a moment for the tail.`

### 4.4 三问 → 字段（验收对照表）

| 老师的问题 | 答案在哪 |
|---|---|
| ① 还有空地方吗 | `pen.roomSteps` + 各板 `occupancy.fraction` + `blank` 板清单 |
| ② 哪块可以擦了 | 各板 `standing[].finished` + `dormant` + tip 位置 |
| ③ 我刚才写的还在不在 | `standing[].steps` 地址范围（agent 把引文所在步对进去）+ `erased.sections`（负面清单） |
| （rev 2）继续写下去，房间会怎么办 | `pen.nextOverflow` —— 空板接住，还是擦掉谁；擦掉谁的**预警在事前**，与 §9.1 的事后通知合成闭环 |

---

## §5 压缩粒度（开放问题 #3 的解）

**粒度 = (板 × section) 段落，携步骤区间。这是地板，不能再降。**

- 再往下折（只报 section 名、不报步骤区间）在**擦除或换板把一个 section 切成两半**时
  当场答不了问题 ③——agent 无从知道 §2 的前半（已擦）还是后半（站着）持有它的引文。
- 再往上加（带正文）就是 200 行问题，且 agent 不需要：正文在它自己的文件里。
- 成本核算见 §2：12–18 行 / 250–450 token / O(n) 微秒级折叠。
  **答案大小由板数封顶**，这不是优化，是结构。

---

## §6 「抬头需要板面先追上」（开放问题 #2 的解——按构造可靠，不靠自觉）

时序缺口有两段，处置不同：

**缺口 A（viewer 可检测）：** emit 已到、rebuild 未跑——`lecture.source`
与快照 basis 所出自的 source 不同。
**缺口 B（viewer 不可检测……除非去看）：** agent 刚写完盘、watcher 事件还在路上——
viewer 连文件变了都不知道。**但 viewer 可以主动看盘**：runner 用
`/api/file?path=<setKey>/board.md` 拉当前盘上内容（`probeClips` 的既有先例，
同一 API、同一路径规则），与 `lectureRef.current.source` 比对。不同 ⇒ emit 在途。

**钉死的动作时序（`runGlanceBoard`，async——`narrate` 是异步动作的先例）：**

1. best-effort 拉盘上 `board.md`（probe 失败/超时 ⇒ 跳过这一步，**绝不因 probe
   挂起答案**——探针答不上来不指控任何人，M3 的同一姿态）；
2. 若 `盘上 === lecture.source` **且** `basis.source === lecture.source`
   ⇒ 立即回答，`measured: "complete"`；
3. 否则等待后续 `onCompiled`，直到 basis 追上最新 source，
   上限 **`SNAPSHOT_WAIT_MS = 2000`**（`ws-bridge-viewer.ts` 的
   `VIEWER_ACTION_TIMEOUT_MS = 60_000`，余量充足）；
4. 超时 ⇒ 用当前 basis 回答，`measured: "catching-up"`，渲染带 §4.3 的诚实尾行。
   **答案永远不撒谎，也永远不挂起 agent。**

**第三道保险（教学面）：** 答案总是回显 tip。skill 教「刚 append 完就抬头时，
看 tip 是不是你刚写的那步；不是就再问一次」。这覆盖 2000ms 都不够的极端情况——
但它是 backstop，不是主机制。主机制是上面的按构造等待。

空板（无 lecture）⇒ 镜像 check-board：
`success: true`，message `"The board is empty — nothing is standing yet."`，
data 为空快照。

---

## §7 修改（不只是新增）时抬头看什么（开放问题 #4 的解）

**快照是状态仪表，不是模拟器——它不预测。** 预示 R4 族的下游归属平移需要
「假想编辑后的新高度」，而高度是测量值，编辑落盘前不存在。方案是节奏而非机制：

- skill 教：**中段修改之后，再抬头一次**——新折叠已经算完，
  平移的结果直接在 `standing[].steps` 里读出来；
- 锚点安全网已经存在且响亮：孤儿（P1-1）走 `inkAfterErase` → check-board /
  主动通知；快照的范围答案让 agent 在落笔**前**自查。

**否决的替代方案（记录在案）：** `movedSinceLastGlance` 差异字段——需要跨调用
状态（上一次快照），破坏纯投影与便宜性。有实证需求再议。

---

## §7.5（rev 2）「如果我追加这块，它落哪、擦不擦」——dry-run 的裁决

摩擦报告最想要的就是这个：对候选追加内容做一次干跑折叠。**裁决：拒绝模拟器，
不是搁置，是拒绝——已批原则没有缺口；但这个问题可以拆开，其中一半不需要模拟器。**

### 拆解

「如果我追加这块」问的是两件事：

- **(i) 这块落在哪** —— 只有两个可能答案：笔所在的板，或溢出目标板。
  **二选一取决于候选内容的实测高度**，而高度在落盘测量前不存在。
- **(ii) 有没有东西会被擦掉** —— 这**不是关于候选内容的问题，是关于房间的问题**：
  折叠的溢出策略（先空板 → 再擦空板 → 全满才 auto-erase 最早写满的）是
  当前板态的确定性函数，**零候选输入**。

(ii) 由 rev 2 的 `pen.nextOverflow` 直接回答（§4.1）——这是对**既定策略的感知**，
不是对候选内容的预测，不越已批边界一步。

### 为什么 (i) 的剩余部分必须拒绝

1. **原则没有缺口，报告本身就是它的证据。** 可行性稿 §1.4 钉死
  「溢出自动换板，agent 永不思考空间」。作者绕开它去打 ±1 行的填充战——
  为把标题推过折缝而给段落加垫料，垫料自己又断到下一块板、连锁平移，
  烧掉约 20 分钟。**这不是缺 dry-run 的痛，这是与物理对抗的痛**；
  dry-run API 会把这场战争工业化：agent 会拿它当 oracle 迭代垫料直到折缝
  「落对」，而垫料句是为几何而存在的句子——**坏讲稿**。工具复现约束，
  不帮人绕过约束（brief 的原话框架）。
2. **诚实的 dry-run 做不到便宜，便宜的 dry-run 做不到诚实。** 折叠的输入是
  **实测**高度；干跑必须从文本猜高度，而 ±1 行的猜测误差恰好是翻覆发生器
  ——报告里的 flip-flop 会原样转移到 API 上。要诚实就得离屏渲染 + 测量
  （隐藏 mount、双份 build），违反 factory single-shot 契约，也违反
  「便宜是一等需求」。两头都站不住。
3. **作者真正缺的两样，本设计各有归处。** 缺感知 ⇒ glance（作者的探针
  就是它的手工版，§2）；缺「新章节想上新板」的**表达出口** ⇒ 那是方言
  动词的缺口（与空间管理无关——不带数字、不带坐标，与 `@erase` 同族的
  舞台指令）。**（rev 3）产品负责人已裁定现在就铸这个动词**——
  完整设计在 §7.6（`@turn`）。出口补上之后，dry-run 的拒绝才闭合：
  作者想「换话题上新板」时有话可说，垫料战失去它唯一的动机。

### 这条裁决对应的 skill 教学（进 §10.3 第三纪律，rev 2 追加）

垫料战被显式判为反模式：折缝落得难看，不是你输了排版，是房间在告诉你
section 太长——拆 section，或先擦一块 dormant 板。原文见 §10.3。

---

## §7.6（rev 3）`@turn`——语义家族的第三员（产品负责人裁定入 S1）

```
~~划掉~~ / @strike  = 我否定它，但你得继续看见
@erase              = 它完成使命了，腾地方
@turn               = 换话题了，前面那块留着
```

一个无参数舞台指令，独立成行，与 `@erase` 同族：**永不接板号、永不接坐标**
（rev 2 §1.4 推论原样适用）。它把「溢出换板」这个本来只由物理触发的转移
变成可以在话题边界**说出来**的动作——同一个折叠操作，多一个触发者。
产品负责人七问逐条钉死如下。

### Q1 转到哪块板——**postcondition 定义 + 既有策略，零新策略面**

`@turn` 的语义后置条件：**笔站在一块干净的板前，先前的内容原样站着。**

- **笔所在板的 open run 为空**（从未用过 / 刚被擦空）⇒ 后置条件已然成立，
  `@turn` **空间上惰性**（target = 笔所在板，`cur` 不动）。这一条同时解决
  Q3 的全部边界（见下）。
- 否则 target = **`nextOverflowTarget(panelStates)`**——与溢出、与 glance 的
  `pen.nextOverflow` **同一个导出策略函数**（§8），三个消费者一个实现：
  先空板 → 再擦空板 → 全满才擦最早写满的。
- **全满时 `@turn` 会触发擦除——刻意如此，不是漏洞。** 拒绝「fresh-only、
  没空板就报错」的读法，理由有三：(a) 隐式路径（闷头写到溢出）都会擦板，
  显式路径（宣告换话题）反而报错是倒置——**表达永远不应该比漂移待遇更差**；
  (b) 报错把作者推回垫料战或误用 `@erase`，动词就白铸了；(c) 擦谁由房间的
  既定策略决定、由 rev 2 三件套全程宣告（glance 事前指名、通知事发推送）——
  作者若不同意房间的选择，出口是先 `@erase "锚"` 表达自己的选择再 `@turn`，
  这正是「擦除是表达」的本义。**产品负责人担心的「借道索要擦除」由此不成立：
  作者索要不了「擦哪块」——选板永远是房间的策略，作者能表达的只有
  「我要换话题」和（经 @erase）「它完成使命了」。**

### Q2 时间与镜头——**占独占窗口；擦不是写，turn 也不是写（P1-3 直系）**

- **`TurnStep` 进 `Step` union，占 schedule 独占时段**（G1 由串行布局构造性
  成立，与镜头步同理）。
- **计划层是 tier 盲的——钉死单一形态，不许给 plan 通 fold 判决。**
  tier 是折叠的判决，而折叠吃的是 viewer 实测高度；`planStepUnits` 只见
  Lecture，**不可能**按 tier 分支（给它通判决 = autoEraseBefore 级的新管道，
  禁止）。所以：**plan 对每个 turn 恒合成恰好一个「走位」单元**，
  `naturalDuration = DurationConstants.turn`（**新常数**，G10 族、T5 终校表
  管辖；默认值取 `---` 分隔线的那档「最长的呼吸」常数——实现者从
  `duration.ts` 读现值，不自己发明数字）。
- **tier 的分化发生在测量 seam（既有规则，零新机制）：**
  - tier-1/2 与惰性 turn：走位单元不配 revealable——`makeSeek` 现成的
    unpaired「dispatch nowhere」路径（镜头步同款），窗口照占
    （Q3 的「一拍」由此**自动**成立，不需要单独规则）；
  - tier-3：viewer 经 `composedRef` 把**那把橡皮**（既有 eraser reveal，
    既有 erase 时长常数）作为该 turn 的单元换入——1:1 对位，实测
    `naturalDuration` 按 `timeline.ts` 既有规则覆盖 plan 值。
    擦的那一下就是这个 turn 的演出。
- **镜头分类（P1-3 的教训直接适用）：turn 不是写。** `StageStepInput` 与
  `StageEntry` 各加 `kind: "turn"`，语义**与 erase 逐字相同**：绝不衰减寄存器
  （`@focus` 锁存的姿态骑过 turn 的窗口，到下一个**书写**步才衰减——
  `buildStageSchedule` 的 holdUntil 扫描只认 `"write"`，不用改）；寄存器
  沉默时，实时跟随与 `resolveCameraOps` 的模拟都走到 **target 板的板头 rect**
  （bottom == top——erase 分支的同一约定），老师走向新板、镜头跟着走。
- **不可发声**（narrate 计划排除，与 erase 同类——房间动作没有台词）。

### Q3 已空板上的 `@turn`——**惰性 + 一拍呼吸，不是坏步**

由 Q1 的后置条件定义直接导出，零特判堆叠：

| 场景 | 行为 |
|---|---|
| `@turn` 是首行内容（全板皆空） | 惰性；窗口照占（那一拍读作作者本来就要的话题呼吸） |
| 连写两个 `@turn` | 第二个惰性 + 一拍 |
| `@erase` 后紧跟 `@turn` | 惰性（板已干净，后置条件已成立）——**不会**走去别的板留下一块「被预留」的空板 |

不做 BadStep：无害的冗余表达按 `@erase` 擦空板的既有先例**软放行**；
不静默：窗口存在、讲稿行高亮照走，作者看得见它「只是一拍」。

**唯一的 BadStep：单条长卷（`@board 1` / 缺省）上的 `@turn`。** 长卷没有
「下一块板」，这是类别错误，与 `@board` 中途出现同族——parser 持有全文
（板数是文档首步），判定在 parse 层；消息教出路：
`"the single strip has no next board — stand boards with @board 2–4 first, or just keep writing; the strip never runs out."`

### Q4 笔记投影——**确认：房间动作，忽略**

notes 遍历全部**内容**步、忽略 erase 与舞台步——`@turn` 归入被忽略的
房间动作（plan 到零单元），StepRef 序不受影响（两投影地址互通原样成立）。

### Q5 与 `@erase` 相邻——**合法，不加 parser 耦合；冗余由教学点名**

- `@erase` + `@turn`：合法；turn 惰性（Q3 表第三行）——组合退化为
  「擦 + 一拍」，没有空间怪象。教学点名：**几乎从不需要连写**——
  `@erase` 独用 = 清场原地开新章；`@turn` 独用 = 留着原板去新板；
  连写多半是把两个成语混在一起了。
- `@turn` + `@erase`：合法；turn 走位后 bare erase 擦到的是刚站上的空板
  （既有「擦空板」退化路径，EraseOp targets 为空）——噪音，同样由教学点名。
  `@turn` + `@erase "锚"`（擦别的板）合法**且有意义**：上新板讲新话题、
  顺手退役一块旧板腾未来的地。
- **不做相邻性校验**：串行方言里的相邻规则是零收益复杂度，实现者不得添加。

### Q6 srcSpan / G6 / G1 / 折叠不变式——逐条钉死

- **G6：srcSpan = `@turn` 自己那一行**——tier-3 合成的橡皮单元也归它
  （**被表达的换板拥有自己那次擦除的高亮**；对照：溢出触发的 auto-erase
  srcSpan 仍归触发的内容步——两条规则并存，各自点名「逼出这次擦的那一行」）。
- **G1**：独占窗口，串行布局构造性保证（既有 property 测试自动覆盖新步类）。
- **折叠**：`LayoutStepInput` 加 `{ kind: "turn"; key }`；fold 处理 =
  Q1 的两行规则（空则惰性；否则 target = `nextOverflowTarget`，tier-3 时
  `reset(target, "auto", turnKey)` 后 `cur = target`）。**前缀稳定原样成立**
  （turn 只动 `cur`，已放置的步绝不移动）；R4 族原样适用（中途增删 turn
  会平移下游归属，与内容编辑同类同治）；**测量无关**（fold 效果不依赖任何
  高度——刚 append 的 `@turn` 立即正确折叠，R2 友好）。
- **每个 turn 必须出现在折叠输出里——`BoardLayout` 再加一个 additive 字段：**
  `turns: readonly { key: string; panel: number; inert: boolean }[]`
  （`panel` = 走位目的板；惰性 turn = 笔所在板）。理由：tier-1/2 与惰性
  turn 在 `eraseOps` 里没有任何痕迹，而 viewer 的 stage 输入映射需要每个
  turn 的**目的板**来造板头 rect（Q2 的镜头走位）——文档尾部的 turn 后面
  没有任何 assignment 可以反推目的板，缺了这个字段实现者只能把选板策略
  抄一遍重跑，正是 §4.1 明令禁止的 copy-then-drift。消费者只有 stage 映射
  （与 glance 的 derive，如它想标注 turn 位置——可选）。
- **tier-3 的 EraseOp**：`kind: "auto"`、`key = turn 步的 key`——§9.1 的
  `boardAutoErased` 通知照常触发，措辞按触发步分支：turn 触发的说
  `"to give you a clean board for @turn, the room erased board N (…)"`；
  溢出触发的维持 `"to keep writing"` 措辞。viewer 的合成路径复用
  `composedRef`（op.key 指向 turn 步，composed = `[eraser]`——turn 自身
  无 revealables，机制原样承载）。
- **退化门**：不含 `@turn` 的板编译字节相同（纯加法）；layout-baseline
  A/B 照旧零 diff。

### Q7 名字——**`@turn`，四条理由 + 三个被否决的候选**

1. 它是那个**动作**的动词——"let me turn to a clean board" 是老师的原话
   级用语；家族里的动词全是单个物理动作词（erase / focus / strike），
   turn 同register。
2. 讲稿面里独立一行的 `@turn` 读作舞台说明「（转向下一块板）」——
   在 script pane 里自解释。
3. 与 SKILL.md 既有隐喻「`##` = turn to a new part」是**亲缘不是冲突**：
   heading 翻的是**话题**的页，`@turn` 转的是**房间**——两轴同一手势，
   且它们天然在话题边界成对出现（`@turn` 紧跟 `##` 是教科书用法）。
4. 被否决的候选，理由记录在案防止重议：**`@next`**（幻灯片词汇——本 mode
   刻意不是 deck）；**`@blank` / `@fresh`**（形容词点名的是**想要的状态**
   而非动作——「索要状态」正是 Q1 拒绝的读法，名字不能自己招它回来）；
   **`@step`**（与领域术语 step 致命相撞）；**`@walk`**（与镜头的
   "walks with the pen" 描述相撞）。

**命名与 `glance-board` 同为 S1 前的最后否决点（§15）**——改名是破坏性变更。

---

## §8 计算落点与契约变动（instantiation & consumption 全表）

**动过的每一层，与不动的每一层：**

| 层 | 变动 | 性质 |
|---|---|---|
| `core/types/` | **零** | 快照全程走既有 `ViewerActionDescriptor` / `ViewerNotification` / `ViewerActionResult`，contracts 表、`docs/reference/`、`AGENTS.md` 均不动 |
| `server/` / `bin/` | **零** | 动作走既有 `ws-bridge-viewer` 派发；无 mode 知识进入 server（硬规则守住） |
| 磁盘状态 | **零** | 纯投影，brief 已钉 |
| `engine/layout.ts` | **加法**：`BoardLayout` 增 `panels: readonly { cursor: number; opened: boolean; startSeq: number; standingRun: string }[]` 与 `cur: number`（下一笔的板）。折叠内部本来就持有这些，只是返回出来（`startSeq` 镜像折叠的内部字段：当前 run 首步的序号，空板 = Infinity——**策略第三级「擦最早写满的」就是按它选板**，缺了它 `nextOverflowTarget` 的签名无法实现）。**（rev 2）溢出选板策略提为导出纯函数 `nextOverflowTarget(panelStates) → { panel; kind: "fresh" \| "wiped" \| "auto-erase" }`，折叠自己的 overflow 分支改为调用它**——一个策略、两个消费者（折叠 + 快照 derive），防止 derive 把三级策略抄一遍然后各自漂移 | mode 内部契约；property 测试：`panels[p].cursor` = 该板 open run 全体 charge 之和；`cur` 与下一个 place 落点一致；（rev 2）折叠每次真实溢出的选板 = `nextOverflowTarget` 对溢出前板态的答案 |
| `viewer/board-snapshot.ts` | **新文件**，pure、零 DOM——`board-check.ts` 的孪生：`deriveBoardSnapshot(lecture, layout, inputs, budget)` + `renderSnapshot()` | 一次计算两个消费者的那「一次计算」就在这里 |
| （rev 3）`@turn` 的足迹：`domain.ts`（parser：`TurnStep` 进 `Step` union + 长卷上判 BadStep）、`engine/inference.ts`（tier-1/2 合成走位单元）、`engine/duration.ts`（`DurationConstants.turn`）、`engine/layout.ts`（fold 的 turn 分支，Q1 两行规则）、`engine/stage.ts`（`StageStepInput` / `StageEntry` 加 `"turn"`，erase 同义）、`viewer/BoardCanvas.tsx`（foldInputs 发 turn 条目；tier-3 经 `composedRef` 复用橡皮合成；stage 输入映射）、`skill/references/board-language.md`（方言表新行 + 配对示例） | 全部是**既有 seam 的加法**——无新引擎机制：走位单元走 unpaired dispatch-nowhere（镜头步先例）、tier-3 橡皮走 auto-erase 合成（溢出先例）、镜头中立走 erase 分类（P1-3 先例）。§7.6 逐条钉死 |
| `viewer/BoardCanvas.tsx` | `BoardApi` 增 `readSnapshotBasis(): SnapshotBasis \| null`（lazy、只读、首次 build 前为 null），`SnapshotBasis = { inputs: LayoutStepInput[], count: number, budget: number, source: string }`（`source` = 本次 build 所据的 `lecture.source`，§6 的比对句柄） | **只读**：不写任何 DOM、不动几何。notes 视图或未 staged 时按需构造 foldInputs（高度走 `foldHeight` 缓存；首次会有一轮 ~n 次 `getComputedStyle` 读，之后命中缓存）。**basis 的两个数字与当前投影无关，钉死出处：`count = boardCount(lecture)` 永远读讲稿（绝不用 notes 视图强制的 `panelCount = 1`）；`budget` 一律按 `panelHeightFor(panelW) − paddings` 重算（count = 1 时为 Infinity），不管哪个投影在 mount**——否则 notes 视图下抬头会把四块板的课报成一条长卷。两投影板宽相同，px 级差异对占用率无决策影响——**接受，不修** |
| `viewer/BanshoPreview.tsx` | `runGlanceBoard` runner（§6 时序）+ action 分支 + auto-erase 通知（§9） | |
| `manifest.ts` | `viewerApi.actions` 增 `glance-board` 描述子；greeting 增一句（§10.4）；mode **0.5.0** + changelog | 按 modes 规则：bump 必带 changelog，**并 grep 旧版本串**——`server/__tests__/` 与 backend lifecycle harness 有测试硬编码 manifest version |
| `skill/SKILL.md` + `references/` | §10 的重分配 | `__tests__/skill.test.ts` 钉着 skill 验收（含 check-board code 清单对照），**同一任务内更新** |

**测过的 prior（不是继承的）：** 快照没有任何东西够格上 thin waist——它是一个 mode
对自己折叠的投影，`ViewerActionDescriptor` 原样承载。值得记一笔观察但**现在不做**的：
「动作答案携带测量 basis / staleness 标记」这个形状若在第二个测量型 mode 里再现
（diagram / draw 均有测量后编译），才是上提 `core/types/` 的时机（一处再现原则）。

**退化门重申：** glance 全链路 geometry-inert（只读折叠 + 缓存高度），
`modes/bansho/harness/layout-baseline/` 的同会话 A/B **必须零 diff**——
这条继续是「没弄坏老功能」的唯一机械证据。

---

## §9 感官系统：整个写作循环（产品负责人补充指示的落实）

快照是一个器官；这一节是神经系统。每个器官一个问题、一个节奏时刻、一个成本档：

| 器官 | 回答什么 | 什么时刻伸手 | 成本 |
|---|---|---|---|
| **`glance-board`（感知）** | 现在板上是什么样 | **每个 append 批次之前**（staged 板上）；**任何中段修改之后**；**写锚定动词（`@focus`/`@erase`/`@strike`/`@circle` 引文）之前** | 极低——按 §5 设计成每次都调得起 |
| **`check-board`（诊断）** | 有没有没演出来的 | 一批编辑落盘之后；收到主动警告之后 | 低 |
| **`capture`（观察）** | 实际像素长什么样 | **对视觉效果下任何判断之前**（构图、图表密度、theme.css 改动后）——「不能光靠想象」的字面兑现，与本仓 frontend rule 同构。（rev 2）摩擦报告的问题 5「不播放看最终墙面」= **既有能力的组合**：`navigate-to` tip + `capture`，无需新功能，写进 capture 的教学行 | 高（图像 token）——**按里程碑调，不按 append 调** |
| **`navigate-to` / `play-from`（指点）** | 让用户看到你改的 | 新增 / 修正之后（已有教学，不变） | 低 |
| **主动通知（板打断你）** | 你该抬头没抬头的时刻 | 板自己开口 | 零 |

### 9.1 新增：auto-erase 主动通知（机制补位，不只靠自觉）

auto-erase 是系统替讲稿做的擦除——agent 没写它，却改变了「什么还锚得住」。
这是「不抬头会实际损坏心智模型」的唯一事件，所以它值得一条推送。

**（rev 2）摩擦报告把这条从推断升级成实证：** 首稿触发了**三次** auto-erase，
只产出**一条** finding（且只因一个 strike 碰巧孤儿化）——「板可以被结构性拆掉
而 check-board 保持绿，它审计墨迹，不审计房间」。这正是本通知 + §4.1 的
`erased.byAuto` / `pen.nextOverflow` 三件套要关死的静默面：**事前有预警
（glance）、事发有推送（本通知）、事后可盘点（glance 的 byAuto）**。
check-board 保持绿是**对的**——拆板不是 fault，是被宣告的物理；错的从来是静默。

- **触发**：rebuild 后对 `layout.eraseOps` 中 `kind === "auto"` 的条目做
  transition 检测，去重键 `autoErase|${op.key}`（`op.key` = 触发步的 key），
  seen-set ref 与 `reportedRef` 同款；同一批多次 auto-erase 聚合成一条。
- **形状**：`ViewerNotification`，`type: "boardAutoErased"`，
  `severity: "info"`（这不是 fault，是被宣告的物理），`replaces: ["boardAutoErased"]`，
  message 点名擦了哪块板、哪些 section、几步，并以
  `"Look up (glance-board) before your next append."` 收尾。
- **硬护栏（防按字面实现走歪）：** `boardAutoErased` **绝不进 `FINDING_CODES`**、
  **绝不出现在 `check-board` 的答案里**、绝不用 `warning` 级别。
  感知与诊断不合并是 brief 钉死的边界；把它做成 finding 就是在合并。

**（rev 2）关于「auto-erase 密度进 check-board」的裁决——否，v1 不做，理由记录在案：**
密度本身不是 fault。设计自己祝福了循环擦写（「写满四块回头擦第一块」是
auto-erase 的存在理由），真实的长课**合法地**把每块板擦好几遍；任何密度阈值
都在评判讲稿的体裁，误报会把 check-board 训练成噪音（transition-dedup 的
同一论证）。报告里的痛在**静默**，上面三件套已关死。唯一 fault 形状清晰的
候选是 **「auto-erase 擦掉了 tip 还站在里面的 section」**（房间在你讲到一半的
section 里强擦——老师绝不擦自己正讲着的板；触发条件：被擦 run 含
`section === tip.section` 的步），它体裁无关、可行动（拆 section 或 `@board 4`）。
**列为 deferred 候选（§12），等 S1 实践里真的出现一次再上**——不预防性地
给诊断通道加码。

### 9.2 对「skill 文档能强制什么」的诚实账

skill 文本**不能**强制抬头。本设计里真正的机制份额：

| 机制（不靠自觉） | 覆盖 |
|---|---|
| auto-erase 通知（9.1） | 忘了抬头且板自己动了 ⇒ 板开口 |
| §6 的按构造等待 + basis 回显 | 抬了头但板没追上 ⇒ 答案不撒谎、可自验 |
| 动作 `description` 走 `pneuma:viewer-api` marker block 注入 | **零 SKILL.md 行数**的常驻教学位——节奏提示写进描述子本身（§10.4） |
| greeting 一句 | 每个 session 开场必读 |

剩下的（每批次抬头本身）只能靠 skill 文本 + 上述四个提醒面。到此为止是诚实的边界；
若实践证明还不够，下一档机制是「占用率跨阈值时通知」（§12 已列为 deferred，
先要证据再加打扰）。

---

## §10 SKILL.md：行预算当设计问题解（不是绕过的约束）

### 10.1 现状盘点（398 / 400）

| 段落 | 行 | 性质 |
|---|---|---|
| 开场框架（1–25） | 25 | 节奏 + 身份——**教学黄金位** |
| How the board reads（26–67） | 42 | **语法表 ×2——与 `references/board-language.md` 字面重复**（该文件自述「full grammar, one paired example per form」） |
| The room, the camera, the eraser（68–105） | 38 | 半语法半判断 |
| The six moves(106–236） | 131 | 手艺核心，动例教学 |
| Two disciplines（237–259） | 23 | 纪律核心 |
| Viewer protocol（260–357） | 98 | 感官面——**现状是分类学（「你可以问什么」），不是节奏（「什么时候看」）** |
| 其余（358–398） | 41 | 边界 + theme + references 表 |

### 10.2 重分配（原则：SKILL.md 载节奏与判断，references 载语法）

| 动作 | 行数 | 说明 |
|---|---|---|
| 压缩 26–67 两张语法表为一张精简表（保留六个最高频行）+ 指向 `board-language.md` | **−24** | 语法的完整版本来就在 reference 里；重复是本预算里唯一的纯冗余 |
| 「Two disciplines」→「**Three disciplines**」：新增第三纪律（10.3 给定稿文案，含 rev 2 的反垫料段） | **+13** | 纪律段是文件里权威最高的段落——「不能靠想象看板」配得上这个位置 |
| Viewer protocol 的动作表改写为**感官表**（§9 的表进 skill；`glance-board` 行 + data 形状 4 行） | **+8** | 从分类学到节奏：每行带「什么时刻伸手」 |
| 开场框架的节奏句扩一笔（10.3） | **+2** | |
| （rev 3）「The room …」段教 `@turn`（10.3 给定稿 5 行）+ 第三纪律尾句改词（+0） | **+5** | 动词的语法归房间段；判断（何时 turn vs erase）就在那 5 行里 |
| **净变化** | **+4** | 398 − 24 + 28 = **402 > 400** —— **触发 §10.2 自己的处置路径，rev 3 的推荐：把门提到 430**（见下） |

**（rev 3）门的推荐——提到 430，一次买足一个地平线：** 402 超门 2 行。
三条路：(a) 再刮 2 行——只能刮六 moves 的手艺示例，**拿手艺喂门是本末倒置**；
(b) 提门到 410——买 8 行，C3b（`@bring`）落地时还得再提，**微量连提会把门
训练成噪音**（与通知 dedup 同一论证）；(c) **提到 430**——覆盖本期 402 +
C3b 预估 8–10 行 ≈ 412，留真实余量，且 rev 1 §15-4 已预告过这个数。
推荐 (c)。**门是产品负责人的（§15-4 更新），实现者在他批准前不得动
`skill.test.ts` 里的门值；若他否决，回退路径是 (a) 并把刮掉的行列清单给他过目
（C3 先例）。**

**若实现实测超 400：** 按 C3 先例走——列出候选裁剪清单交产品负责人批准，
**不许静默溢出**。若产品负责人另行决定给 C3b（`@bring`）留教学空间，
**把门显式提到 430** 是合法出路（deliberate raise），但那是他的决定，
本设计的推荐是：**现在守住 400，靠上表的重分配**。

### 10.3 定稿文案（实现者照抄，不改写）

**第三纪律（插入「Two disciplines」段，段题改「Three disciplines」）：**

> **You cannot see the board by imagining it.** Your markdown is the score,
> not the performance — what stands on which board, how much room is left,
> whether the words you want to point at are still up: those are facts on
> the stage, not in the file. Look up before you decide: call `glance-board`
> before choosing where the next batch goes — take a blank board, wipe a
> finished one, or keep writing — and again after any mid-document edit.
> Judge visual effect with `capture`, never from source. And never keep your
> own outline of the board — the board's answer is the only map that cannot
> drift.
>
> Never pad or reshape prose to steer where the fold breaks. Pushing a
> heading onto the next board with filler is fighting physics you do not
> control — the filler moves the fold again, and a sentence that exists
> for geometry is a bad sentence. If a heading lands badly, the section is
> too long: split it, wipe a dormant board, or `@turn` to a fresh one.

**（rev 3）「The room, the camera and the eraser」段追加（`@erase` 段之后，5 行）：**

> `@turn` — the family's third member: "new topic, leave that board
> standing." It walks the pen to the next board — a blank one if the room
> has one; on a full wall the room wipes its earliest-filled board first,
> so glance before you turn. Strike negates in view, erase retires,
> turn changes the subject. On a blank board it is just a beat.

**开场节奏句（替换现第 22–24 行的节奏段首句）：**

> Write in performance rhythm: look up (`glance-board`), decide where the
> stroke lands, append one or two blocks per edit and let them play before
> the next edit lands.

**动作表新行：**

> | `glance-board` | `{}` | Look up before you write: what stands on each board (sections + step ranges), room left, where the pen is, what has been erased, and the tip. Cheap by design — call it before every append batch and after any mid-document edit. |

### 10.4 零行数的教学位（marker block + greeting）

**manifest 的动作 `description`**（经 `pneuma:viewer-api` block 注入，常驻、
不占 SKILL.md 一行）：

> "Look up at the board before you write — the teacher's glance. Answers
> what is standing on each board (sections and step ranges), how much room
> is left, which boards are blank or finished, what has been erased, what
> the room will do when the current board fills — take a blank board, or
> wipe the earliest-filled one — and the last thing written. Cheap by
> design: call it before every append batch to decide — take a blank
> board, wipe a finished one, or keep writing — and after any mid-document
> edit. Check that the tip echoes your latest append; if it does not, ask
> again."

**greeting 追加一句**（`manifest.ts` `agent.greeting` 末尾）：

> Look up before you write — the glance-board action tells you what is
> standing and where there is room, the way a teacher glances at the wall
> before the next stroke.

**（rev 3）greeting 既有句改词**：`"…and retire a finished board with an
appended @erase when it has served its purpose"` 之后补
`", or @turn to a fresh board when the subject changes"`——
两个动词在开场就是一对，误用 erase 表达换话题的路径从第一轮就被堵上。
`references/board-language.md` 的方言表同任务加 `@turn` 行 + 配对示例
（含 Q5 的两条冗余组合作为反例）。

### 10.5 为什么「教节奏」而不是「教可用性」

「困惑时可以调用」产出的 agent 永远不够困惑。本设计的教学句式全部是
**动作前置条件式**（"before choosing where the next batch goes"），
不是能力陈述式（"you may call"）。这与 brief 的原话逐字对齐
（「每次更变内容，都利用这个 viewer 的 API……再决定怎么新增/修改/擦除」）。

### 10.6（rev 2）房间的经济学——参考文档，不是运行时 API

摩擦报告的问题 6（「这段/这张图会渲染成多少行/px」）与它逆向工程出来的
高度经济学（content 预算 ≈775 board px/板、chart ≈530 ≈ 一块板的七成、
文本行 ≈45 + 步间距 ~21、每行 ~35 个 CJK 字、list 节距 ≈59、graph 74–101），
**归宿是 reference 文档，不是任何 API**——作者应当在写 chart **之前**
就知道它吃掉大半块板，这是写作素养，不是运行时查询。落点与纪律：

- **落点**：`references/board-language.md` 新增小节 **"The room's economy"**
  （房间语法本来就住在这里）；chart/graph 的占地事实在
  `references/charts.md` 交叉引用一句（占地是 evidence pacing 的一部分）。
  references 不在 400 行门内，扩充免费。
- **表达纪律（防漂移 + 防误导）**：板宽 = 视口宽（宽度早已是 canonical 输入），
  所以**绝对 px 因窗口而异**。经济学一律写成**「一块板的几成」**的近似分数
  （chart ≈ 板的 70%、一行正文 ≈ 板的 1/17……），标注「默认 seed 窗口实测的
  粗刻度，规划用；活的真相永远是 `glance-board`」。报告的原始数字作实现时
  重测的起点，**不照抄进文档**——写文档前在默认窗口复测一遍。
- **维护钩子**：排版 / factory 常数改动（T5 终校表族）时，本小节列入核对清单
  ——手写近似是本 mode 里唯一被允许的手写地图，允许它的条件就是标明近似
  并把精确性永远路由给 glance。

---

## §11 人看的视图（第二消费者）

**同一个 `deriveBoardSnapshot`，cut = playhead 所在步（§3 的映射规则）。**

**放哪——这是产品负责人的决定，本设计给推荐：**

| 选项 | 说明 | 判断 |
|---|---|---|
| **A. 板视图里的可折叠仪表条（推荐）** | 1–4 块板的示意矩形 + 占用条 + section 标签 + tip 标记，贴在板视图一角，随 playhead 更新 | 快照是**扫一眼的仪表**，不是驻留的投影——人抬头时板本身必须还在眼前（老师瞄墙，不是换教室）。也回答了 C3 验收发现的「0.245 倍缩放下字不可读」——结构感由仪表条给，不逼镜头给 |
| B. Board / Notes 开关的第三个值 | 「第三投影」的字面读法 | 切过去板就没了；快照替代不了板，只能陪着板。**不推荐**，但 brief 的「板·笔记·快照」三态措辞使它有表面合法性，故显式列出交产品负责人否决 |

v1 display-only；点板块→镜头 focus 是 v-later。实现遵守 frontend rules
（design tokens、无 emoji、chrome-devtools 视觉验证）。

**「一次计算两个消费者」在 S1 就被设计兑现**（cut 参数化的 derive 是 S1 交付物），
S2 只是给第二个消费者接上 UI——分期是发货顺序，不是设计妥协。

---

## §12 分期

| 期 | 内容 | 为什么这样切 |
|---|---|---|
| **S1（循环活起来——最小完整刀）** | `BoardLayout` 加法扩展（含 rev 2 的 `nextOverflowTarget` 策略提取）+ `viewer/board-snapshot.ts`（derive 带 cut 参数 + render，含 `nextOverflow` / `erased.byAuto`）+ `glance-board` 动作（§6 等待时序）+ auto-erase 通知（§9.1）+ **（rev 3）`@turn` 全链路（§7.6：parser + fold + plan + stage + viewer 合成 + 教学）** + SKILL.md 重分配（§10 定稿文案，含反垫料段与 room 段的 turn 5 行）+ greeting + manifest 0.5.0 + 全部测试 | 三问、节奏、机制补位、教学四者缺一循环就不成立；它们互为因果（C3「一个语义包」同款论证）。cut 参数在 S1 定型，S2 才是纯加法。**rev 2 增量的诚实账：+1 个快照字段、+1 个导出策略函数（搬家不是新逻辑）、SKILL.md +3 行。rev 3 增量的诚实账：一个方言动词的完整纵切——新 Step 种类 + 新时长常数 + 折叠分支 + 两个 stage 类型加成员，约与一个 C2 镜头动词同量级；但零新引擎机制（三条腿全踩既有先例：dispatch-nowhere / auto-erase 合成 / erase 镜头分类），且它是 dry-run 拒绝安全成立的前提，产品负责人裁定与 glance 同期。S1 从「感知包」变成「感知 + 表达包」——形状变了，这里如实记账** |
| **S2** | 人看的仪表条（§11A）+ `extractContext` 一行摘要（turn 开场的方位感，~30 token/条——**是否加、加在哪期，产品负责人拍板**，推荐加且放 S2） | 第二消费者接 UI；不 gate S1 |
| **Deferred（要证据再做）** | 占用率跨阈值通知；`movedSinceLastGlance` 差异；点板块→focus;跨 content set 快照；（rev 2）**「auto-erase 强擦 tip 所在 section」的 check-board finding**（§9.1 的裁决——fault 形状清晰但等 S1 实践里真的出现一次） | 每条都是打扰面或状态面扩张，先看 S1 实践 |
| **Rejected（不是 deferred——记录在案免得再议）** | （rev 2）候选内容的 dry-run 折叠模拟器（§7.5：原则无缺口 + 诚实与便宜不可兼得）；auto-erase **密度**类 finding（§9.1：密度是体裁判断，误报训练 agent 忽略通道） | 拒绝与搁置不同——这两条的论证已闭合，推翻需要新论据，不是新场景 |

---

## §13 验收与门禁

- `tsc --noEmit` 静默；`bun test modes/bansho` 全绿。
- **布局基线零 diff**（同会话 A/B，`harness/layout-baseline/` 纪律照旧）——
  glance 全链路 geometry-inert 的机械证据。
- `BoardLayout` 扩展 property 测试：`panels[p].cursor` = open run charge 之和；
  `cur` = 下一 place 落点；扩展前后既有字段字节不变。
- **cut 与 growth 的一致性测试（§3 blocker 的直接证据）：** graph frame 在前缀内、
  同名图层在 cut 之后——`cutIndex` 折叠的 assignments 与 cursors 必须与
  「完整折叠在该处的中间状态」**字节相同**（预扫描全量、主循环走前缀的
  实现形态就是被这条测试钉住的）。
- `board-snapshot.ts` 纯测试钉住渲染字面，场景至少覆盖：纯长卷 /
  staged 四板中场 / 全部擦空 / **一个 section 被擦除切成两半**（§5 地板的直接证据）/
  cut 中途（人视图口径）/ 空板。
- 动作时序测试：probe 不一致 ⇒ 延迟回答；超时 ⇒ `catching-up` + 诚实尾行；
  probe 失败 ⇒ 不阻塞。
- auto-erase 通知：transition 去重；聚合；**`check-board` 答案里不出现**（负向断言）。
- （rev 2）`nextOverflowTarget` 一致性 property 测试：折叠每次真实溢出的选板
  = 该函数对溢出前板态的答案（一个策略两个消费者的机械证据；rev 3 起
  **三个**消费者——**非惰性的** `@turn` 选板也必须逐字命中它；惰性 turn
  的短路**不调用**该函数，断言不要写成无条件的）。
  渲染测试覆盖 `nextOverflow` 两种形态（空板接住 / 满房预警）与
  `erased.byAuto` 的 "by the room" 措辞。
- （rev 3）`@turn` 验收（§7.6 逐条的机械对应）：
  - 折叠：tier-1/2/3 三情形 + 惰性三场景（首行 / 连写 / erase 后）各有测试；
    **前缀稳定 property 测试把 turn 纳入生成器**（turn 只动 cur，已放置步
    绝不移动）；长卷上 BadStep（措辞钉字面）。
  - 擦除回放：既有三层回放场景（C1 写 → E1 擦 → C2 同位重写 → E2 擦）
    加一层 **turn 触发的 tier-3 擦除**，回拖语义与溢出触发逐字一致。
  - 镜头：`@focus` → `@turn` → 书写——锁存姿态**骑过 turn 窗口**、在书写步
    才衰减（P1-3 家族的负向断言）；寄存器沉默时模拟与实机都走到 target
    板头（from-pose 口径一致性，P1-4 家族）。
  - G6：turn 的 srcSpan = 自己那行，tier-3 橡皮单元含在内（100% 覆盖照旧）。
  - 通知：turn 触发的 `boardAutoErased` 措辞分支（"for @turn"）有钉字测试。
  - 笔记投影忽略 turn；不含 `@turn` 的板编译字节相同（退化门）。
- `__tests__/skill.test.ts` 与 SKILL.md 同任务更新；SKILL.md 实测 ≤ **430**
  行（rev 3 §10.2 的门推荐，**以产品负责人批准为准**——未批前门值不动，
  内容按 (a) 回退路径处理）。
- S2 视觉验证走 `chrome-devtools` CLI（G7 姿态）。

---

## §14 与既定决策的对齐 / 偏离

**对齐（逐条点名）：** 板 ≠ 笔记（第三投影零 timeline 影响、零新 Step 种类、
零方言变化）；派生绝不手写 + 零磁盘状态（brief）；G2 引擎无钟（cut 用文档位置）；
G8-J（只读 layout 值 + 缓存高度）；R8（不引入任何视口依赖进 canonical）；
check-board 互补不合并（brief + §4.2 + §9.1 护栏）；P1-1 孤儿响亮化
（快照是它的**事前**面，check-board 是**事后**面）；「一处再现才上提 thin waist」
（§8 的 prior 检验）。

**（rev 2）对可行性稿 §1.4 的显式重申：** 摩擦报告最高优先的请求（dry-run）
被本设计**以该原则为据**拒绝（§7.5）——「溢出自动换板，agent 永不思考空间」
经受了第一位真实作者的正面冲撞而不需要修补；报告的垫料战恰是原则在保护
作者免于的那种战争。`pen.nextOverflow` 不是对原则的让步：它读出的是**房间
既定策略**的确定性后果，候选内容的高度自始至终不进入任何计算。

**（rev 3）`@turn` 与该原则的关系——完成它，不是松动它：** 动词不带板号、
不带坐标、不带条件；选板永远走房间自己的策略函数；作者能表达的仍然只有
**意图**（换话题），空间调度一寸未还。它同时把 C2 那条「`@focus` 与 `@bring`
在方言里分开——视觉同族、教学动作不同就分词」的词汇设计原则再执行一次：
strike / erase / turn 是三个不同的教学动作，所以是三个词。「G1 五者同轴互斥」
的清单措辞需随任务落地更新为含 turn 的表述（写、划、擦、移镜头、移板、**走位**
——机制上它复用 erase 的中立分类，不是第七种镜头行为）。

**偏离：无。** 新增判断（cut 口径、`SNAPSHOT_WAIT_MS = 2000`、粒度地板、
auto-erase 通知形状、SKILL.md 重分配、（rev 2）`nextOverflow` / `byAuto` /
经济学 reference 落点 / 两条 Rejected）全部为本文首次钉定，不与任何已批决策冲突。

---

## §15 交产品负责人的开放问题（不 gate S1 开工，除注明者）

1. **人视图放哪**（§11）——推荐 A（仪表条）；选 B 请在 S2 前说。
2. **`extractContext` 一行摘要**——推荐加、放 S2；这是每条用户消息 ~30 token 的持续成本，值得你亲自点头。
3. **动作命名**——推荐 `glance-board`（与 `check-board` 同构、动词性、含「便宜」语感）；若你有更贴「抬头看一眼」的名字，S1 开工前定（**gate S1**，改名是破坏性变更）。
4. **SKILL.md 门**——（rev 3 更新）rev 1 曾推荐守 400；`@turn` 教学入门后
   账变了，最终推荐见问题 7（提到 430）。
5. **auto-erase 通知的措辞与级别**（§9.1）——info 级、点名 section、以「抬头」收尾；请过目一次措辞。
6. **（rev 3 已裁定）「上一块新板」成为方言动词**——产品负责人拍板：
   现在就铸、入 S1、不等第二例（补全语义家族 + 垫料战的根因）。
   完整设计在 §7.6。**留给你的最后两个否决点：** (a) 名字 `@turn`
   （§7.6-Q7 的理由与被否决候选；与问题 3 的 `glance-board` 同为 S1 前
   最后可改——**gate S1**）；(b) 全满时 `@turn` 触发房间擦板的 Q1 裁决
   （「表达永远不应比漂移待遇更差」——若你倾向 fresh-only 报错的读法，
   S1 开工前说，这条改起来是折叠分支级的小改，但语义完全不同）。
7. **（rev 3）SKILL.md 门 400 → 430**——§10.2 的账：`@turn` 教学使重分配后
   仍超门 2 行；刮手艺喂门与微量连提都被论证否决。这与原问题 4 是同一个
   决定的最终形态，**gate SKILL.md 任务**（门值动在 `skill.test.ts` 里，
   你批了实现者才能改）。
