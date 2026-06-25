# ADR-015: Borrow — 对等 / 往返跨模式委托

> **状态**: Accepted
> **日期**: 2026-06-25
> **决策者**: Pandazki
> **关联**: 扩展 [ADR-008](./adr-008-session-management.md) 的 session 模型与 Smart Handoff 工具调用协议（[`docs/archive/proposals/2026-04-28-handoff-tool-call.md`](../archive/proposals/2026-04-28-handoff-tool-call.md)，Approved）——**不 supersede** 它。设计全文见 [`docs/proposals/errand-peer-handoff-design.md`](../proposals/errand-peer-handoff-design.md)（草案沿用占位名 `errand`；本特性最终定名 **`borrow`**）。

---

## 1. 背景

Pneuma 今天的跨模式机制只有一种形状：**Smart Handoff**——一次*终止性*的交接，把用户从 mode A 整体搬到 mode B。源 agent A 调 `pneuma handoff`，用户确认，server kill 掉 A、带着 A 的上下文 spawn B，控制权**不再回来**。Handoff 是一次 **goto**。

但大量真实任务的形状是「A 把一个**有界子任务**委托给 B，然后**继续**」——工作的重心始终在 A。典型场景：webcraft 已经有了一个成型、有视觉风格的页面，只有文案需要 `wordtaste`（写作品味专家）的润色；webcraft 想要**拿回**打磨好的文案，然后**继续**拥有这个页面。又比如 webcraft 想要 `illustrate` 出一个 logo，然后自己**把它放进**页面。这是一次**子程序调用**，不是跳转。

我们需要第二种跨模式原语：**`borrow`**——从一个活着的 session A 里，借用另一个 mode B 的能力做一件有界的事，B 做完写出交付物 + 结构化变更说明，控制权**返回** A。A 全程不死、不离开前台。

### 命名

orchestrator 曾在 `errand` / `consult` / `excursion` / `delegate` / `borrow` / `sidequest` 之间权衡。判据：(a) 连带「有界 + 会返回」语义；(b) 既能当 CLI 动词也能当 `/cmd` 读得顺；(c) 与 `handoff` 区分；(d) 不暗示 host *离开*（排除 `excursion`/`sidequest`）。设计草案推荐 `errand`，但用户最终定名 **`borrow`**——「借用 mode B 的能力，用完归还，控制权回到借用方」精确刻画了这次往返。命名空间：CLI `pneuma borrow` / `pneuma borrow-return`；chat tags `<pneuma:request-borrow>` / `<pneuma:borrow-returned>`；磁盘 `borrow-result.json`；路由 `/api/borrows/*`；session 溯源字段 `borrow`。

---

## 2. 决策

引入 **`borrow`** 作为与 Smart Handoff 并列的跨模式原语。契约层（本任务范围）落地三个 `core/types/borrow.ts` 类型 + 纯 helper：

- **`BorrowDispatchPayload`**（A → server）——有界的 brief：`mode` + `brief`（必填），加 `inputs?` / `expects?` / `scope?` / `in_place_targets?` / `summary?` / `language?` / `return_via?`。
- **`BorrowResult`**（B → 磁盘 `<Bdir>/borrow-result.json` → A）——返回腿契约：`borrow_id` / `mode` / `status` / `produced[]`（每项带 `path` + 可选 `kind`/`role`）/ `change_notes` / `applied_in_place?` / `open_questions?` / `produced_at`。
- **`BorrowLink`**（server 内存）——`Map<borrow_id, BorrowLink>` 链接记录，磁盘是真相、它是可重建的索引/缓存。
- `isBorrowResult(value)` 运行时守卫（B 写、A 读的磁盘 JSON 不可信，需校验，镜像 `isProjectManifest`）；`normalizeBorrowScope(scope)` 把缺省/未知值收敛到安全默认 `"return"`；`MAX_CONCURRENT_BORROWS_PER_SESSION = 1` 常量编码并发默认（见下文 §3.5）。

往返协议（server/CLI 实现属后续任务，此处仅锚定契约语义）：A 调 `pneuma borrow --mode <B> --json '{...}'` → A 自己的 per-session server `/api/borrows/dispatch` → 校验 mode、mint borrow id、解析 B 的 sessionDir、原子写 `<Bdir>/.pneuma/borrow-brief.json`、记 `BorrowLink`、background spawn B。B 在后台跑完有界任务，写 `borrow-result.json`，调 `pneuma borrow-return` → B 自己的 server `/api/borrows/return`，跨服务器 loopback POST 回 A 的 server。A 的 server 把 `<pneuma:borrow-returned>` tag **排进既有的 queue-on-busy / flush-on-idle 通知管道**——A 永不被打断在某一轮中间，在下一个 idle 边界读到它，再读 `borrow-result.json`，按用户首肯把结果应用到 host 产物上。

本 ADR 锚定四个被批准的决策（§3）。这是一个跨切面、且一旦 skill 教会 agent `pneuma borrow` / `borrow-return` 约定后就难以回退的原语——故立 ADR。

---

## 3. 关键设计决策

### 3.1 决策 D1 — Borrow 是与 Smart Handoff 并列的*独立原语*，而非它的一个 flag

**决策：新增 `borrow` 作为独立的跨模式动词，与 `handoff` 并列；不在 handoff 上加返回开关。**

理由：

- Handoff 的整套 UX 是「review card → 一次 confirm → 切走」；在它上面螺栓一条「非终止 + 返回腿」会把一个干净、已发布的契约和 skill 指引搅浑。
- 两个具体的兄弟原语（`handoff` = goto，`borrow` = call）给 agent 一个清晰的心智模型，skill 可以显式教二者的分野。

**被否决的方案：**

- **(a) 给 handoff 加 `return: true` flag**（confirm 时不 kill 源）。否决：污染一个已发布的清晰契约；agent 侧的「该用哪一个」指引会变模糊。
- **(b) 现在就把两者抽象成一个统一的「cross-mode invocation」超类型**。否决为**过早抽象（YAGNI）**——先发两个具体兄弟，等出现第三个再提取超类型。

**影响**：两个清晰的动词；skill 显式教 distinction；surface 略多，但心智模型清晰得多。

### 3.2 决策 D2 — 返回腿是*磁盘文件 + 排队 chat tag*，而非同步响应

**决策：B 把交付物写进 `<Bdir>/borrow-result.json`（磁盘是真相），server 把 `<pneuma:borrow-returned>` 指针 tag 排进既有的 idle-flush 通知队列；A 在下一个安全边界读取。不阻塞 A 的 agent turn。**

理由：

- B 可能跑数分钟；阻塞住 A 的某一轮是敌意的，且直接违背「A 保持活着 / 前台」这一核心需求。
- 跨双服务器边界（A、B 各自有 server）做同步响应是脆弱的。
- 磁盘是真相 → 崩溃可幸存：server 中途重启，`BorrowLink` 内存态丢失，但 B 的 `session.json` 携 `borrow` 溯源、且 B 仍会写出 `borrow-result.json`；A 下次启动时通过 boot-reconcile 在磁盘上找回未确认的结果。直接套用 v1-handoff 复盘教训——**「done」必须是显式信号（B 调 `borrow-return`），绝不从文件出现/mtime 推断**。

**被否决的方案**：A 的 `pneuma borrow` CLI 阻塞直到 B 完成、内联返回结果。否决：见上——阻塞敌意、跨双服务器脆弱、违背非打断需求。

**影响**：异步、非打断、崩溃可幸存；代价是多一条 boot-reconcile 路径。

### 3.3 决策 D3 — 默认 `scope: "return"`（host 应用），带 opt-in `in-place`

**决策：默认 B 返回内容 + 变更说明，A 是 host 产物的唯一写者并负责应用；只有当 brief 显式点名 `in_place_targets` 时才走 opt-in 的 `scope: "in-place"` 让 B 直接改 host 文件。**

理由（按优先级）：

1. **干净的写者归属**。A 拥有 host 产物，B 拥有自己的 scratch + result 文件。没有两个进程写同一个文件——near-decomposability 原则，整类并发写 / lost-update bug 被消除。
2. **host 懂它的媒介，借用方懂它的手艺**。用户的水墨站例子点透了：润色后的文案要*同时*感觉中国风，而页面远不止文字（布局、图像意图、语气要保持统一）。`wordtaste` 是写作品味专家，应产出*用户嗓音里最好的文案*并解释取舍；`webcraft` 才是唯一懂这个页面 DOM、水墨视觉语言、以及文案长度如何与布局互动的。所以必须由 webcraft 把润色文案织回去。让写作 mode 伸手进 web mode 的 markup/JSX，正是 layer 边界要阻止的那种耦合。
3. **可审查性**。用户能把「B 的 `change_notes`」和「A 的应用」看成两个可见步骤，并在中间介入（「其实标题保留原文」）。直接 in-place 把这两步坍缩成一次不透明的 mutation。

`normalizeBorrowScope` 把任何缺省/未知 scope 值收敛到 `"return"`：brief 是磁盘 JSON，绝不能让一个游离字符串变成意外的 host 写入。

**被否决的方案**：总是 in-place（B 直接改 host 文件）。否决：跨媒介耦合 + 并发写；违反 layer 边界（写作 mode 改 web mode 的产物）。

**影响**：保住用户水墨例子要求的专长分工；两个可见、可审查的步骤；为无损场景（如重新生成一个已存在的资产文件）留 opt-in 逃生口（A 仍拿到 `change_notes`，可经 shadow-git checkpoint 审查/回滚）。

### 3.4 决策 D4 — B 默认继承 A 的 backend；单 backend 锁不破

**决策：B 作为一个新 session，其 backend 默认继承 A 的 backend，走既有的 `resolveWorkspaceBackendType` / `getDefaultBackendType` 路径；不引入任何 runtime backend 切换，不加 `if (type === ...)` 分支。**

理由：backend 在 startup 选定后 session 内锁定（既有约定）。B 是一个*独立 session*，理论上能有自己的 backend——但「让 brief 挑 B 的 backend」是一个没人要的旋钮（YAGNI）。startup-lock 是 per-session 的，B 是新 session，所以**继承 A 的 backend 是最小惊讶的默认**。

**被否决的方案**：让 brief 指定 B 的 backend。Defer——加一个没人要求的旋钮；仅当某个 mode 是 backend-specific 时才重审。

**影响**：单 backend 锁约定不被违反；零新 backend 分支。

### 3.5 并发默认（OQ-5）：每 session 一个活跃 borrow，多余的排队

**决策：`MAX_CONCURRENT_BORROWS_PER_SESSION = 1`——一个 host session 同时只有一个活跃 borrow，额外的 dispatch 排队等前一个返回。**

注：这是用户对设计草案 OQ-5（草案推荐「允许 N，cap 3」）的最终裁定。理由：borrow 是 host 正等着折叠回来的有界子任务；让一个 host 无界扇出后台子 session 会招致资源 churn 和混乱的返回腿排序。串行化保住「borrow → 拿回来 → 继续」的心智模型，并 bound 住每个 host 派生的进程数。本决策在契约层编码为一个文档化常量（单一真相），强制（排队逻辑）落在后续 server 任务。

---

## 4. 影响

1. **新增 `core/types/borrow.ts` 契约**——`BorrowDispatchPayload` / `BorrowResult` / `BorrowLink` + `isBorrowResult` / `normalizeBorrowScope` / `MAX_CONCURRENT_BORROWS_PER_SESSION`，经 `core/__tests__/borrow.test.ts` 锁定，`core/types/index.ts` 再导出，`AGENTS.md` 契约表新增一行。
2. **新增两个磁盘状态文件**（后续任务落地）——`<Bdir>/.pneuma/borrow-brief.json`（A 的 server 写、B 第一轮读后 `rm`）与 `<Bdir>/borrow-result.json`（B 写、A 读、作为审计残留保留）；B 的 `session.json` 多一个 `borrow` 溯源字段并被 stamp `internal: true`。
3. **新增两个 chat-tag 信号**——`<pneuma:request-borrow>` / `<pneuma:borrow-returned>`，加进既有的单一 chat-tag 注入管道（对齐 2026-04-28 handoff 提案 §0「新增 signal type 到同一管道，不为每个信号造 bespoke 状态机」）。
4. **新增一条跨服务器返回中继 + 一条 boot-reconcile 路径**（justified，非 incidental）——非打断 + 崩溃可幸存的往返所需最小代价；二者复用既有 pattern（loopback POST；PID/registry reconcile）。
5. **不改 `manifest.ts`**——borrow 是每个 project session 都继承的 runtime affordance，不是 per-mode 声明的能力；由共享 `pneuma-project` skill 教。三条硬规则（server/CLI 无 mode 知识；无 backend 分支；manifest 无 React）全部对齐。
6. **扩展、不 supersede** Smart Handoff 协议；不与任何已接受 ADR 冲突。

---

## 5. 范围声明

本 ADR 与同批次的契约层任务只交付 **`core/types/borrow.ts` + 测试 + 契约表 + 本 ADR**。server 路由（`/api/borrows/*`）、CLI 动词（`pneuma borrow` / `borrow-return`）、env-tag 的 `reason="borrow"` 分支、`launchPneumaChild` spawn seam 扩展、skill 集成、桌面 Background Mode 的「不 reveal」抑制、以及 e2e，均属后续任务，受本 ADR 锚定的契约语义约束。
