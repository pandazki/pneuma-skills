# Bansho 舞台层 — C1 任务规格

> 承接 `2026-08-07-bansho-tasks.md`（§G 全局约束仍然全部适用，本文只增补）。
> 设计依据：`2026-08-07-bansho-infinite-canvas-feasibility.md`（rev 2）§3 / §9.2 / §11。
> 当前状态与交接：`2026-08-09-bansho-status.md`。
>
> **分期位置：** C-graph ✅ 已交付 → **C1（本文）** → C2 舞台指令 → C3（`@board`+擦除+笔记）→ C3b `@bring`。

---

## §G 增补（本期落地，写入 tasks §G）

### G1 合并新表述（替换原 G1 首句的动作清单）

> **板上只有一支笔，舞台一次只做一件事。写、划、擦、移镜头、移板，五者同轴、互斥。**

测试形状不变——全部是 schedule 上的独占条目。C1 尚无镜头指令，所以这条本期只是**措辞落地**，
不引入新断言；C2 起才有可测的镜头条目。

### G8-J. rect 读数必须除以同帧实测缩放（新增硬规则）

舞台一旦施加 CSS transform，两类读数就分家了，而且**分得很安静**：

| 读数 | 受 transform 影响？ |
|---|---|
| `getBoundingClientRect()` | **是**——返回渲染后坐标 |
| `offsetTop/offsetLeft/offsetWidth/offsetHeight` | 否——布局值 |
| `clientWidth/clientHeight/scrollWidth` | 否——布局值 |
| `getComputedStyle(el).fontSize` | 否——计算值 |

**在同一个算式里混用两类读数，在 zoom ≠ 1 时必然错位**，而在 zoom = 1 时完全正确——
所以它不会在开发中暴露，只会在用户第一次缩放时炸。

规则：**任何要落回板坐标的 rect 读数，必须除以同一帧实测的累积缩放。**

缩放**当场实测**，不从 React state 读：

```ts
const scale = el.getBoundingClientRect().width / el.offsetWidth;
```

分子分母来自同一瞬间，所以镜头过渡途中（transform 正在插值）它依然自洽；
读 state 的版本会跟渲染差一帧。

**结构化守卫（不是"记得除"）：** 所有 rect 读数走唯一漏斗，并由源码扫描测试钉死——
`getBoundingClientRect(` 在 `modes/bansho/` 下**只允许**出现在漏斗文件与显式豁免名单里。
先例是 `engine/factories/svg.ts::el()` 把 G8-D 做成 throw：**规则要有牙齿**。

### G8-K. 测量宿主永远在舞台之外，缩放恒为 1（新增硬规则）

`measureHost` 必须是**舞台的兄弟节点，而不是后代**。理由不是整洁，是 R8：

> 探针读数会被缓存并喂进 canonical——对齐列宽进 reconcile hash，
> 墨迹路径长度进 `naturalDuration`。**如果它随镜头缩放而变，同一份讲稿在不同 zoom 下
> 会编译出不同的 canonical timeline**，R8（同一份源永远编译出同一条时间轴）当场破裂。

这条同时是本期最大的**成本红利**：`engine/` 的所有测量都发生在 measureHost 里
（`prose.ts:256` 先 `ctx.measureHost.appendChild(node)` 再量，对齐探针
`BoardCanvas.tsx:327` 同理），所以宿主一旦搬出舞台，**`engine/` 对镜头零感知、零改动**。

漏斗因此只剩**一个调用点**：`BoardCanvas::measureBackRef`——回指必须量**已挂载**的
目标节点（那是它的定义），是唯一躲不开舞台的测量。

---

## C1-impl

**任务**：舞台基座——把 viewport 从原生滚动容器换成 transform 镜头。taskKind: `viewer`。
**零方言、零 engine 语义变化。**

### 为什么先做这个、并且单独做

产品负责人的排程指示是「先把舞台层整体实现，再统一调细节」，原因是**镜头一旦接管，
现有滚动跟随行为整个被替换，先调细节会白做**。而 C1 又是整层里风险最集中的一步：
它不新增任何用户可见能力，却重写了板的定位基座。所以它单独走完、单独验收，
**不与 C2/C3 混在一个 PR 里**。

### 目标 DOM 结构

```
.bansho-board-surface
├─ .bansho-viewport            ← viewportRef；overflow: hidden（不再滚动）；position: relative
│  └─ .bansho-stage            ← stageRef；transform-origin: 0 0
│     │                           transform: translate(Npx, Npx) scale(z)
│     └─ .bansho-panels        ← 板容器；C1 恒为一块
│        └─ .bansho-panel.bansho-board   ← boardRef（步骤节点挂这儿）
└─ .bansho-measure-layer.bansho-board    ← 舞台的**兄弟**（G8-K）
   └─ .bansho-measure-host     ← measureRef
```

- **`.bansho-panels` 现在就要有**，哪怕只装一块板。C3 的 `@board 2–4` 因此是纯加法，
  不必再动一次基座。这是契约先行原则的本期形态。
- **`.bansho-measure-layer` 复用 `.bansho-board` 类**，所以排版上下文（字体、行高、
  padding）与真板逐字节一致；宽度显式设成与 panel 相同。它 `position: absolute;
  visibility: hidden; pointer-events: none; aria-hidden`，不参与布局也不可点。
- `.bansho-panel` 在 C1 是**向下生长的长条**（D11：单块 = 现行线性模式），高度由内容决定，
  宽度 = viewport 内容宽度。**这个宽度必须与今天的 `.bansho-board` clientWidth 完全相等**，
  否则换行变了、基线门直接红。

### 镜头模型

```ts
interface Camera { x: number; y: number; z: number }   // (x,y) = 视口左上角的板坐标；z = 缩放
```

变换：`translate(${-x * z}px, ${-y * z}px) scale(${z})`，`transform-origin: 0 0`。
校验：板点 `(bx,by)` 落到屏幕 `((bx-x)*z, (by-y)*z)`——相机在 `(x,y)` 时板点 `(x,y)` 正好在视口原点。

**把镜头做成纯模块 `viewer/camera.ts`（零 DOM）**：输入
`{ panelW, panelH, viewW, viewH }` + 当前 camera + 一个动作，输出新 camera。
钳位、缩放锚点、跟随目标计算全在里面。理由很实际：**happy-dom 没有布局引擎**，
镜头逻辑如果长在 BoardCanvas 里就一行测不了；抽成纯函数则全部可测。

- **钳位**：`y ∈ [0, max(0, panelH - viewH/z)]`，`x` 同理。z=1 且 panelW == viewW 时 x 恒为 0。
- **缩放钳位**：`z ∈ [0.4, 2.5]`。
- **锚点缩放**：`zoomAt(camera, clientPoint, dz)` 保持光标下的板点不动。

### 输入（明确定死，别自己发挥）

| 输入 | 行为 |
|---|---|
| `wheel`（含触控板双指） | 纵向平移镜头；**触发 detach** |
| `shift + wheel` | 横向平移（z=1 时无效果，但要正确） |
| `ctrl + wheel` / 触控板捏合 | 以光标为锚点缩放；**触发 detach** |
| 单击 | **绝不 detach**——它是 T6 的「点板提要求」 |
| ~~拖拽平移~~ | ~~**C1 不做**。与点选、与文本选中复制都冲突~~ —— **已被推翻，见下方 C1′** |

- **原生滚动条消失**，这是本期**被接受的损失**。恢复手段：Live 按钮、Timeline 拖拽、滚轮
  （C1′ 之后再加一条：直接用手拖）。在报告里明说，别让它成为静默退化。
- ~~**真触屏平移是本期公开的缺口**（`overflow: hidden` 之后没有原生触摸平移了）~~
  —— **C1′ 已补上**：pointer events 同时覆盖鼠标、笔和手指，单指拖动即平移。
  仍然开着的只剩**双指捏合缩放**（`touch-action: none` 之后浏览器原生捏合也让位了；
  桌面端由 `ctrl + wheel` 覆盖）。

#### C1′：拖拽平移（2026-08-10，产品负责人推翻上面那一行）

原话：「整个 board 我也无法操作呀～ 至少拖拽的时候可以让我像无限画布一样去操作。。
**你可以拖拽时暂停部分。。继续的时候回到之前的位置**～」。第二句不是抱怨、是设计，
它就是本条的需求本身。C1 那一行提的两个冲突是真的，所以是**解决**、不是**豁免**：

| 输入 | 行为 |
|---|---|
| 按下但没走位（< 阈值） | **绝不 detach**，仍然是 T6 的单击 |
| 按下并走位（> 阈值） | **grab**：跟手平移；**触发 detach**；**暂停播放** |
| `alt + 拖拽` | 文本选中（复制的逃生口，不平移） |
| 单指拖动（触屏） | 同 grab —— 关掉了原来那个公开缺口 |

- **阈值**：鼠标/笔 4 px、手指 10 px（`camera.ts::GRAB_SLOP_PX`）。手指在一次普通点击里
  本来就会漂移几个 px，用鼠标的阈值只是把「点不中」从鼠标搬到触屏。
- **点选冲突**：靠阈值收口。低于阈值 click 原样送达 `onSelectStep`；高于阈值时，
  结束这次拖拽的那一下 click 被吞掉（拖完松手不是「点板」）。
- **文本复制冲突**：左键拖拽在**整块板上**都平移——只能在（看不见的）留白里拖的板
  等于不能拖。复制保留两条**原生**路径：双击/三击选词选段（配 shift+click 扩选）、
  以及 `alt + 拖拽` 选任意范围。实现里刻意不对 pointerdown 调 `preventDefault`，
  这两条才活得下来。
- **暂停/继续**：抓住板 = 暂停（手底下在动的板没法读）；**松手不恢复播放**——用户是
  为了看某处才抓的，一松手就把画面拽回去正是 `camera-latch.ts` 头注释里记的那类
  「静默扼杀」。**继续播放**才是显式动作，它的**效果**就是镜头回到笔尖（走 `reset`，
  和 Live / 显式 seek 同一个门）。副作用要说清楚：这让**所有** resume 都重新挂上跟随，
  滚轮 detach → 暂停 → 播放 也会拉回笔尖。这是把负责人的规则**一致地**应用，
  而不是给拖拽开一个只有它认识的特例。

### camera-latch 的重推导（这是删除，不是移植）

**transform 写入不产生任何 `scroll` 事件**，所以 `camera-latch.ts` 里整条回声抑制通道
——`cameraWrite(top)` / `scroll(top)` / `ECHO_TOLERANCE_PX` / `pointerDown/Up/Cancel`
——**全部删除**，不要移植。

原文件存在的理由是一个真 bug：「直播时一次单击就锁死了跟随，板继续在折线以下书写，
看起来像 agent 停了」。C1 之后**只有 wheel 会 detach**，那个 bug 在结构上不可能再发生。
这是增强，不是回退——但**测试必须保留它的意图**：`camera-latch.test.ts` 重写为
`camera.test.ts` 时，「单击不 detach」这条断言要以新形态活下来。

`follow === "live"` 与显式 seek 仍然 reset detach（现有语义原样保留）。

### 逐个测量点的处置（一个都不许漏）

| 位置 | 处置 |
|---|---|
| `BoardCanvas:226-228` `measureBackRef` | **走漏斗**（唯一的舞台内 rect 读数） |
| `BoardCanvas:334-335` 对齐探针 | 天然安全——在 measureHost 里，G8-K 保证 scale 1 |
| `prose.ts:269,273` 原地墨迹 | 天然安全——`ctx.measureHost.appendChild` 后才量 |
| `prose.ts:281-282` `clientWidth/clientHeight` | 布局值，transform 不影响 |
| `rule.ts:79` `measureHost.clientWidth` | 布局值 + 在宿主里，双重安全 |
| `BoardCanvas:458-459` `scrollWidth/clientWidth` | 布局值，`boardOverflow` 判定原样 |
| `BoardCanvas:546,549` ResizeObserver `clientWidth` | 布局值；**观察对象改为 viewport**（panel 宽由它派生） |
| `BoardCanvas:629-630` `offsetTop/offsetHeight` | 布局值，`showStep` 继续用 |
| `BoardCanvas:634-637` `scrollTop/clientHeight` | **删除**，改为 camera.y + `viewH / z` |
| `BoardCanvas:502-510,531` `pendingScrollRestore` | **删除**——camera 是 React 侧状态，重建时本来就不丢 |
| `BoardCanvas:611-615` `cameraScrollTo` | **删除**，由 camera 模块 + transform 写入取代 |
| `Timeline.tsx:97` track rect | **不在舞台内**，原样不动；漏斗豁免名单里点名它 |

### 硬约束

- **G8-J / G8-K**（本文 §G 增补）——两条都要有测试，不只是注释
- **G7 视觉验证**：必须用 `chrome-devtools` 截图，报告里留证据
- **G5**：内容永不消失，一帧都不行。现有「wipe 与 rebuild 在同一个 task 里完成」的纪律
  原样保留——`invalidateMeasurements` 的契约不能破
- **`.bansho-aside` 的 `padding-left: 22px` 与 `prose.ts::ASIDE_BAR_X = 6` 是耦合对**
  （`beb59e1` 的交接说明），改 CSS 时同步看另一处
- **不碰 `engine/`、不碰 `domain.ts`**——本期的退化门之一就是这两处零 diff

### 验收门（四道，全绿才算完）

1. **布局基线零 diff**（本期的核心门）
   ```bash
   bun bin/pneuma.ts bansho --dev --no-open --no-prompt --workspace ~/bansho-boards/_all
   # chrome-devtools 页面 resize 到 1600×1100，打开打印出来的 session URL
   modes/bansho/harness/capture-layout.sh /tmp/after
   diff -r /tmp/after modes/bansho/harness/layout-baseline
   ```
   **必须完全为空。** 噪声底已实测为 0（同一份代码两次采集字节相同），
   所以**任何 diff 都是真回归，不许加容差、不许刷新基线来让它过**。
   详见 `modes/bansho/harness/layout-baseline/README.md`。

2. **缩放不变性**（G8-J/K 在 scale = 1 时测不出来，必须单独造场景）
   端到端脚本：跳到板尾 → 记录全部墨迹的板坐标 → 把镜头缩放设成 1.5 →
   强制 `invalidateMeasurements` 重建 → 再记录 → **两次必须相等**。
   这一条直接证明「缩放不污染测量」；没有它，C1 能带着坏漏斗通过第 1 门，
   然后在 C2 才炸。

3. **canonical 零漂移**：`git diff --stat` 在 `modes/bansho/engine/` 与
   `modes/bansho/domain.ts` 下**零改动**（结构性地证明 parser/schedule 字节等价）。

4. **常规门**：`bun run typecheck` 静默；`bun test modes/bansho` 全绿
   （基线 **745 pass / 0 fail**，含 `beb59e1` 新增的 8 条）；
   新增 camera 纯模块测试；`camera-latch.test.ts` 的意图在新测试里存活。

### 回退触发器（rev 2 §8 保留，本期是唯一可能触发它的一期）

若第 1 门——「不写位置的板逐帧与现状一致」——**在合理努力后仍守不住**，
不要靠放宽基线通过。停下来，把证据交回协调者：改判为**两个 mode + 把 `Revealable`
上提到 `core/types/`**。这个判断是人类闸门，不是实现者可以自行决定的。

### 报告要求

除常规实现报告外，必须明说三件事：**（a）** 原生滚动条这个已接受的损失
（真触屏平移原本也在这一条里，C1′ 已补上；现在只剩双指捏合缩放开着）；
**（b）** 第 2 门缩放不变性的实测数据（不是"我实现了"，是"我量到的两组数一致"）；
**（c）** 任何你为了守住基线而做的妥协——尤其是 CSS 上的。

## C1-review

标准 review 维度（`taskKind: viewer`），外加三条本期专属：

1. **漏斗是否真的收口**——源码扫描门是不是能真的拦住新增的 `getBoundingClientRect`，
   还是只是一条注释。
2. **camera-latch 的删除是否丢了意图**——那个"单击锁死跟随"的真 bug，
   新结构里是否仍有测试为它站岗。
3. **基线是否被"通过"而不是"守住"**——检查 `git log` 有没有偷偷刷新
   `harness/layout-baseline/`。
