# Viewer–Agent Protocol

> Pneuma 的核心通信模型——三个角色（User / Viewer / Agent）、六个方向、四类契约（ViewerContract、Action space、Source、AgentBackend）。本篇是契约文档，每节都给出**类型形状**与**设计→实现链路**，让开发者能从这里出发顺着源码追下去。

## 基本立场

**Coding agent 直接在 workspace 文件上干活——这是它的母语，不被中介也不被替代。** Viewer 不是文件预览器，是给一个具体任务做的实时 **player**——人通过它观察 agent 工作、在需要时直接介入（拖、删、重排）或通过结构化命令提建议。

由此分出三层正交的关注点：

| 层 | 归谁 | 服务谁 | 动词 | 实现锚点 |
|---|---|---|---|---|
| **L1 文件系统** | Agent 的母语 | Claude / Codex / Kimi 通过 Read/Edit/Write 跟世界对话 | read / edit / write file by path | `backends/<name>/cli-launcher.ts` |
| **L2 传输** | Runtime 基础设施 | 把 L1 的变化变成可订阅的事件流 | chokidar → `pendingSelfWrites` → WS → event bus | `server/index.ts`（chokidar）+ `server/ws-bridge.ts` |
| **L3 Source** | Viewer 的输入/输出契约 | mode 作者只看这一层，用 domain 类型订阅 | `Source<T>.subscribe` / `.write` | `core/types/source.ts` + `core/sources/*` + `src/hooks/useSource.ts` |

本篇描述 **三方之间** 的六个方向（① ~ ⑥），Source 与六方向正交，在末尾单独展开。

## 协议总览

![Protocol Overview — 三方角色与 6 个通信方向](images/protocol-overview.png)

## 三方角色

| 角色 | 实体 | 职责 |
|------|------|------|
| **User** | 浏览器中的人类 | 观察 player、选择元素、输入消息、审批权限、按需参与 |
| **Viewer** | Mode 级 React 组件 | 把 agent 的工作以 domain 语言渲染成实时 player；捕获用户交互；执行 agent 请求的操作；主动上报观测 |
| **Agent** | Claude / Codex / Kimi 进程 | 理解意图、直接编辑 workspace 文件、调用工具、请求 viewer 操作 |

## 契约速查

每一个契约都有一份 type 定义、一处运行时实例化点、一处消费端。把这张表当 viewer-agent-protocol 的目录读。

| 契约 | 定义 | 实例化 | 消费 |
|------|------|--------|------|
| **`ViewerContract`** | `core/types/viewer-contract.ts` | 每 mode 的 `viewer/index.tsx` 默认导出 | `core/mode-loader.ts` 加载，runtime 通过 `PreviewComponent` 挂载 |
| **`ViewerPreviewProps`** | `core/types/viewer-contract.ts` | runtime 注入 props（sources / commands / actionRequest / …） | mode viewer 接收 |
| **`ViewerAddress`** | `core/types/viewer-contract.ts` | 每 mode SKILL.md 定义自己的词表 | viewer selection 产出、`<viewer-locator>` 与 `capture` 消费 |
| **`ViewerActionDescriptor`** + `ViewerActionRequest` / `Result` | `core/types/viewer-contract.ts` | mode `manifest.viewerApi.actions[]` 声明 | `server/skill-installer.ts` 注入指令文件；`server/ws-bridge-viewer.ts` 转发；`src/store/viewer-slice.ts` 派发 |
| **`ViewerCommandDescriptor`** | `core/types/viewer-contract.ts` | mode `manifest.viewerApi.commands[]` 声明 | runtime 注入 viewer props.commands；viewer 点击经 `onNotifyAgent` 上行 |
| **`ViewerSelectionContext`** + `extractContext()` | `core/types/viewer-contract.ts` | viewer 实现 `extractContext` | `server/ws-bridge.ts` 在每个 `user_message` 前缀注入 `<viewer-context>` 块 |
| **`ViewerNotification`** | `core/types/viewer-contract.ts` | viewer 调 `onNotifyAgent()` | `server/ws-bridge.ts` 在 agent 空闲时 flush 为 system message |
| **`ViewerLocator`** | `core/types/viewer-contract.ts` | agent 在 chat 输出 `<viewer-locator>` 标签 | `src/components/chat/*` 渲染卡片，点击触发 `navigateRequest` |
| **`Source<T>`** + `SourceEvent<T>` + `SourceProvider` + `SourceContext` | `core/types/source.ts` | `core/source-registry.ts` 按 `manifest.sources[kind]` 选 provider 实例化 | viewer 用 `src/hooks/useSource.ts` 订阅；`core/sources/base.ts` 强制四不变量 |
| **`FileChannel`** + `FileChangeEvent` | `core/types/source.ts` | 每 session 由 runtime 实例化一份 | file-backed provider 在 `core/sources/file-glob.ts` 等里订阅 |
| **`SourceDescriptor`** | `core/types/source.ts` | `manifest.sources` 数组每一项 | `core/source-registry.ts` |
| **`ModeManifest`** | `core/types/mode-manifest.ts` | 每 mode 的 `manifest.ts` 默认导出 | `core/mode-loader.ts::loadModeManifest()` |
| **`ModeDefinition`** = `{ manifest, viewer }` | `core/types/mode-definition.ts` | 每 mode 的 `pneuma-mode.ts` 默认导出，绑 manifest + ViewerContract | frontend `mode-loader` 动态 import（与 `manifest.ts` 分工：后者 backend + frontend 都读，前者只 frontend 读，可含 React 依赖） |
| **`ModeShowcase`** | `core/types/mode-manifest.ts` | `modes/<name>/showcase/showcase.json`（sibling 文件，**非 inline 在 manifest.ts**） | `server/index.ts` `/api/modes/:name/showcase/*` 服；launcher gallery 卡片消费 |
| **`AgentBackend`** + `AgentCapabilities` + `AgentSessionInfo` + `AgentLaunchOptions` | `core/types/agent-backend.ts` | 每 backend `manifest.ts::createBackend(port)` | `bin/pneuma.ts` 启动；`server/index.ts` 管会话 |
| **`AgentProtocolAdapter`** | `core/types/agent-backend.ts` | Codex `codex-adapter.ts` / Kimi `kimi-adapter.ts` | `server/ws-bridge-{codex,kimi}.ts` |
| **`BackendModule`** | `core/types/agent-backend.ts` | 每 backend 一份 `manifest.ts` | `backends/index.ts`（pure registry） |
| **`BridgeBackend`** | `server/ws-bridge-backend.ts` | backend `manifest.ts::createBridgeBackend()` | `server/ws-bridge.ts` 中央桥根据 backend 类型分派 |
| **`ToolFileRef`** | `backends/tool-file-ref.ts` | backend `manifest.ts::toolFileRef(name, input)` | `server/file-ref.ts::stampFileRefs` 给 tool_use 块加 `fileRef`；前端 `FilePreview` / `ToolFileActions` 消费 |
| **`PluginManifest`** | `core/types/plugin.ts` | 每 plugin 的 `manifest.ts` | `core/plugin-registry.ts` + `core/hook-bus.ts` |

---

## 六个方向

### ① User → Viewer · Interaction

**契约。** 用户操作进入 viewer 的回调入口：

```ts
// ViewerPreviewProps (core/types/viewer-contract.ts)
onSelect: (selection: ViewerSelectionContext | null) => void;
onActiveFileChange?: (file: string | null) => void;
onViewportChange?: (viewport: { file; startLine; endLine; heading? }) => void;
commands?: ViewerCommandDescriptor[];   // runtime 从 manifest 注入
```

**链路。** runtime 在挂载 viewer 时通过 `App.tsx` 把这些回调连到 `src/store/`（Zustand slice）；用户事件经回调上行后，命令触发会通过 ⑥ 通道转成 notification 发给 agent。

### ② Viewer → User · Player Rendering

主流数据流：**agent 持续编辑文件，每次编辑经 L2 变成一个带 `origin` 的 Source 事件到达 viewer，viewer 据此刷新画面、滚动、高亮变化。** Viewer 的首要人格是观察器，不是编辑器。

**契约。** Viewer 的输入是 `props.sources`，每条事件携 `origin`：

```ts
// ViewerPreviewProps
sources: Record<string, Source<unknown>>;
fileChannel: FileChannel;        // 动态写目标的逃生口
selection: ViewerSelectionContext | null;
activeFile?: string | null;
workspaceItems?: WorkspaceItem[];     // 由 runtime 经 workspace.resolveItems 计算
contentVersion?: number;
imageVersion: number;
initParams?: Record<string, number | string>;
theme: "light" | "dark";
locale: string;
```

**链路。** Source 实例化点在 `core/source-registry.ts`，viewer 通过 `src/hooks/useSource.ts` 订阅 `props.sources[id]`。Workspace 模型由 `manifest.viewer` + `core/types/viewer-contract.ts::FileWorkspaceModel` 决定（type: `"all" | "manifest" | "single"`、`resolveItems` / `resolveContentSets` / `createEmpty`）。Theme/locale 来自 `~/.pneuma/settings.json`，经 `src/hooks/useSystemPreferences.ts` 解析后注入。

### ③ User → Agent · Intent

**契约。** WebSocket `user_message` 包，body 含 text + 附件。聊天前缀里 runtime 自动注入 `<viewer-context>` 块（见 ⑥）。

**链路。** 浏览器 → `/ws/browser/:sessionId` → `server/ws-bridge.ts` → backend stdio。

### ④ Agent → User · Response

**契约。** 后端协议适配后归一化的标准 envelope，覆盖 streaming content、`tool_use` / `tool_result`、`permission_request` / `permission_response`。`tool_use` 经 `server/file-ref.ts::stampFileRefs` + `BackendModule.toolFileRef` 注入归一化 `fileRef: { path, kind }`。

聊天里 agent 还可以嵌入 **`<viewer-locator>` 标签**——可点击的导航卡片：

```ts
// core/types/viewer-contract.ts
export interface ViewerLocator {
  label: string;
  address: ViewerAddress;   // mode-defined
}
```

**链路。** Backend → adapter → `server/ws-bridge*.ts` → `/ws/browser/:sessionId` → `src/store/` → 聊天面板 `src/components/chat/*` 渲染 streaming blocks、permission banner、locator 卡片。点击 locator 触发 `navigateRequest` 走 ⑤ 通道把 viewer 移过去。

### ⑤ Agent → Viewer · Action（action space 的主舞台）

这是契约面**最大**的方向——agent 把 viewer 当成一个可调用 API 用。

#### Action Descriptor / Request / Result

```ts
// core/types/viewer-contract.ts
export interface ViewerActionDescriptor {
  id: string;
  label: string;
  category: "file" | "navigate" | "ui" | "custom";
  agentInvocable: boolean;            // false 的 action 仅供 UI 内部调用
  params?: Record<string, ViewerActionParam>;
  description?: string;
}

export interface ViewerActionParam {
  type: "string" | "number" | "boolean" | "object";  // "object" 用于 ViewerAddress 等结构化 JSON 值
  description: string;
  required?: boolean;
}

export interface ViewerActionRequest {
  requestId: string;
  actionId: string;
  params?: Record<string, unknown>;
}

export interface ViewerActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}
```

#### Action Space 的生命周期（设计→实现）

1. **声明。** Mode 在 `manifest.ts::viewerApi.actions[]` 里列出 ViewerActionDescriptor。Shape 在 `core/types/mode-manifest.ts::ViewerApiConfig` 里。
2. **注入指令文件。** `server/skill-installer.ts` 在启动时把 `agentInvocable: true` 的 actions 渲染成 markdown 表插入 `<!-- pneuma:viewer-api:start/end -->` 块——agent 据此知道有哪些 action 可调、参数是什么。
3. **Agent 发起请求。** Agent 通过 `viewer_action` 工具调用，envelope = `ViewerActionRequest`。
4. **Server 分派。** `server/ws-bridge-viewer.ts` 接收 envelope，按 `sessionId` 推给浏览器。
5. **Viewer 执行。** Runtime 把 request 设到 `ViewerPreviewProps.actionRequest`；viewer 内部消化后调 `onActionResult(requestId, result)` 回流（`src/hooks/useCaptureAction.ts` 是 capture 的实现样例）。Action 内部状态由 `src/store/viewer-slice.ts` 管理。
6. **Result 回传。** 经 ws-bridge 走回 agent 作为工具结果。

#### 内建 action：`capture`

**每个 viewer 都自带 `capture`，无需在 manifest 里声明。** Agent 通过它请求一张实时渲染的 PNG 截图——可选传 `params.address`（`ViewerAddress`）只截某对象：不传 → 整个 viewport；传 coarse 半（`page` / `slide` / `file`）→ 先 navigate-then-shoot；传 fine 半（`anchor` / `selector` / `nodeId`）→ 在当前画面就地解析。Runtime 把截图写入磁盘返回 file path，agent 用 Read 工具查看。

这让"渲染对不对、有没有溢出"的视觉自查留在 Pneuma viewer 内部完成——外部浏览器渲染的是脱离 viewer 规则的原始文件，看到的不是用户看到的画面。

`capture` 接收的对象就是用户选中元素时 ⑥ 上报的同一个 `address`——所以 **select → 拿到 address → capture 那个 address** 是一个闭环（webcraft 已验证）。`params.address` 也接受裸 `selector` 字符串以兼容旧用法。实现见 `src/hooks/useCaptureAction.ts`、`backends/tool-file-ref.ts`（capture 结果走 fileRef 通道在 chat 里显示）。

#### Well-known action 词表

每个 mode 自己定义 action id，但有约定俗成的命名：

| 典型 id | category | 含义 |
|---------|---------|------|
| `capture` | ui | 框架内建，所有 mode 都有 |
| `navigate-to` | navigate | 移到某 address |
| `goto-page` / `goto-slide` | navigate | mode 偏好的精确导航 |
| `scaffold` | file | 从空 workspace 初始化文件，由 `viewerApi.scaffold` 声明 |
| `set-content-set` | ui | 切换 active content set |
| `select` | ui | 让 viewer 进入 select mode（webcraft） |

完整词表在每个 mode 的 SKILL.md 与 manifest 里。

### ⑥ Viewer → Agent · Context & Notification

三类共享同一方向，机制不同：

**上下文增强（被动）。** Runtime 在每条 `user_message` 前调 `ViewerContract.extractContext(selection, files)`，把返回的文本插到消息前缀作 `<viewer-context>` 块。Agent 借此理解"这个按钮""这里"等指代。块里带一行 `Address:`——选中对象的 `ViewerAddress`（JSON），agent 可逐字复制回 `capture` 或 `<viewer-locator>`。

```ts
// core/types/viewer-contract.ts
extractContext(
  selection: ViewerSelectionContext | null,
  files: ViewerFileContent[],
): string;
```

实现链路：viewer 的 `index.tsx` 实现 `extractContext` 返回结构化文本；`server/ws-bridge.ts` 在 user message 经过时拼接。

**命令触发（主动 - 用户点击）。** 用户点 viewer UI 上的命令按钮（命令在 manifest 里声明），viewer 调 `onNotifyAgent(notification)` 上行。

```ts
// ViewerCommandDescriptor
export interface ViewerCommandDescriptor {
  id: string;
  label: string;
  description?: string;
}
```

**自主观测（主动 - viewer 自身判断）。** Viewer 内部逻辑检测到"agent 应该关注"的情况（fit-discipline check、render error 等），调 `onNotifyAgent` 上行。

```ts
export interface ViewerNotification {
  type: string;                     // e.g. "contentFitCheck"
  message: string;                  // 发给 agent 的系统消息
  severity: "info" | "warning";     // info 仅记录，warning 发给 agent
  summary?: string;                 // UI 一句话摘要
}
```

实现链路：viewer 调 `props.onNotifyAgent`（`src/store/viewer-slice.ts`）→ `server/ws-bridge.ts` 缓冲 → agent 进入 idle 时 flush 成 system message 注入下一条 user message 前。

---

## ViewerAddress — 「viewer 里的哪个对象」这个名词

⑤ 和 ⑥ 这两个方向都在反复问同一件事：**viewer 里的哪个对象？** Agent 要给用户指（locator 卡片）、要截（`capture`）、要导航过去；Viewer 要回报用户选中了哪个、当前在哪个位置。`ViewerAddress` 把这个名词收敛为协议层唯一的类型。

```ts
// core/types/viewer-contract.ts
export type ViewerAddress = Record<string, unknown>;
```

**它是什么。** 一个 mode 定义、可序列化的 viewer 内对象引用。**对框架不透明**——只有拥有它的 mode viewer 知道 `{slide: 3}` 或 `{page: "about.html", anchor: "#pricing"}` 是什么。协议只固定"这个槽存在、哪些动词消费/产出它"；keys 与粒度由 mode 自己拥有，记在各自 SKILL.md。

约定但不强制：一个 address 把粗粒度「where」（`page` / `slide` / `file` / `contentSet`）和可选的细粒度「within」（`anchor` / `selector` / `nodeId` / `lineRange`）配对。`contentSet` 是唯一保留键（由 store 自己解析切 active set），其余 mode-opaque。

**为什么存在。** 在这个契约前，同一个名词在 `ViewerLocator.data` / `capture.selector` / `ViewerSelectionContext.selector|file` / `navigate-to.params` 各发明一种形状。代价落在 agent 身上：每个 feature 一套寻址词表、互不通用——用户选中一个元素拿回 `selector`，agent 想截或指回，`capture` 和 `ViewerLocator` 却要不同形状，**select → view → point** 这个最自然的 QA 闭环根本无法表达。`ViewerAddress` 让交互模式不变（"拿到一个 address，然后 point / view / navigate"），只让 address 内容随 mode 变。同源思路见 `BackendModule.toolFileRef` 的 `fileRef`：一个跨切面、运行时归一化的引用类型。

**一个名词，每个动词。**

- Viewer **产出**（⑥）：`ViewerSelectionContext.address`；`<viewer-context>` 在 `Address:` 行带当前选择的 address。
- Viewer **消费**（⑤）：`ViewerLocator = { label, address }` 给用户指；`capture({ address })` 给 agent 截；`navigateRequest` 把 viewer 移过去。

同一个 `address` 既被产出又被消费，闭环成立。`<viewer-locator>` 标签的规范属性是 `address='{…json…}'`；解析器仍接受历史的 `data='{…}'`，新输出一律用 `address=`。

**每个 mode 自己定义词表。** webcraft `{ contentSet?, page, anchor?, selector? }` 深到 DOM region；slide `{ contentSet?, slide }` 停在 slide 级；doc 用 heading / lineRange；diagram 用 nodeId；draw 用 elementId。完整设计见 [`docs/archive/proposals/2026-05-20-viewer-address-contract.md`](../archive/proposals/2026-05-20-viewer-address-contract.md)。

---

## Manifest 与 Runtime

![Data Flow — Manifest 声明层 → Runtime 中枢 → 三方分发](images/protocol-dataflow.png)

**Manifest 是声明层**（`core/types/mode-manifest.ts`）——mode 通过它告诉 runtime "我有什么"：

| 字段 | 类型 | 服务方向 | 说明 |
|---|---|---|---|
| `viewerApi.actions[]` | `ViewerActionDescriptor[]` | ⑤ | Agent 可请求的 viewer 操作 |
| `viewerApi.commands[]` | `ViewerCommandDescriptor[]` | ① → ⑥ | UI 上可触发的命令 |
| `viewerApi.workspace` | `FileWorkspaceModel` | ② | 文件组织模型（`"all" / "manifest" / "single"`）。多 content set 时 `resolveContentSets` 推荐用 `core/utils/content-set-resolver.ts::createDirectoryContentSetResolver()` 一行接入。 |
| `viewerApi.scaffold` | `{ description, params, clearPatterns }` | ① | 空 workspace 初始化能力（需要用户确认） |
| `sources` | `Record<string, SourceDescriptor>` | ② | typed 数据通道声明（kind + config），runtime 按 kind 实例化注入 `props.sources` |
| `proxy` | `Record<string, ProxyRoute>` | ② | 反向代理路由——viewer fetch 外部 API 时绕开 CORS |
| `skill` | `SkillConfig` | ③④⑤⑥ | Agent 领域知识：sourceDir、installName、mdScene、envMapping、mcpServers、skillDependencies、sharedScripts |

**Runtime 是中枢**——读 manifest、分发数据、桥接所有通道。每个子系统都有源头：

| 子系统 | 文件 | 职责 |
|--------|------|------|
| **mode-loader** | `core/mode-loader.ts` | `loadModeManifest()` 把 `manifest.ts` 转为 ModeManifest 对象；frontend 端动态 import 出 ViewerContract |
| **skill-installer** | `server/skill-installer.ts` | manifest → 指令文件；把 actions / commands / proxy 描述渲染进 `<!-- pneuma:viewer-api:* -->` 块；Viewer API 段是**纯路由器**——它命名各通道，把 `ViewerAddress` 词表指向 mode 自己的 SKILL.md，框架不持有任何 mode 的 keys |
| **source-registry** | `core/source-registry.ts` | `manifest.sources` → 按 kind 选 SourceProvider 实例化；built-in provider 与 plugin 注册的 provider 同住一个 registry |
| **store + props** | `src/store/` + `src/App.tsx` | commands / actions / sources / workspace items 注入 viewer props |
| **proxy middleware** | `server/index.ts` (`/proxy/<name>/*`) | `manifest.proxy` + workspace `proxy.json` 解析；GET 默认放行，其他方法需显式 `methods`；`proxy.json` 改动 chokidar 热加载 |
| **WS bridge** | `server/ws-bridge.ts` + `server/ws-bridge-{viewer,codex,kimi}.ts` | 浏览器 JSON ↔ backend transport；非 Claude 后端经 `BridgeBackend` 接口拓展 |
| **context injection** | `server/ws-bridge.ts` | `extractContext()` 返回值 → `<viewer-context>` 块注入到 user message |

---

## Editing 状态

`editing` 是协议层的顶层布尔——当前 session 处于**创作**还是**消费**阶段。

| 角色 | `editing: true` | `editing: false` |
|------|---|---|
| **User** | 在 chat 与 agent 协作，在 viewer 中选择/拖拽/编辑 | 消费内容（阅读、使用 dashboard、浏览） |
| **Viewer** | 显示编辑 UI（拖拽手柄、网格线、Gallery 等） | 隐藏编辑 UI，但保留内容交互（tile 点击、链接跳转） |
| **Agent** | 全力工作 | 不主动修改（具体行为由 mode skill 定义） |

**Opt-in。** Mode 在 manifest 声明 `editing: { supported: true }` 才参与切换；未声明的 mode 永远是 `editing: true`，对用户和 agent 无感。

**生命周期与契约。**

- 状态持久化在 `<sessionDir>/session.json` 与 `~/.pneuma/sessions.json`，是 resume identity 的一部分。
- 服务端：`GET /api/config` 返回 `editing`；`POST /api/session/editing` 切换并广播。
- Viewer 端：通过 `ViewerPreviewProps.editing: boolean` 读，各 mode 自行适配 UI。`readonly: boolean`（replay）禁用一切交互，比 `editing: false` 更严格。
- CLI：`--viewing` flag 让 session 启动即进入 `editing: false`——此时不安装 skill、不 spawn agent；用户在 UI 切回 `true` 才触发 spawn。

---

## Sources — Viewer 的数据通道（与六方向正交）

Source 是 **Runtime ↔ Viewer 中枢-末端边界** 的数据契约，与六方向正交，但对 mode 作者的心智路径至关重要。

### 首要职责：把 agent 的工作变成 player 可渲染的 typed 流

Source **不是编辑器抽象，是 player 抽象**——首要用途是让 viewer 订阅、渲染、高亮 agent 正在对 workspace 做的事。数据流主方向：

```
Agent (Edit/Write)              ← L1 母语
      ↓ 写文件
chokidar → pendingSelfWrites    ← L2 传输（origin 在源头确定）
      ↓ origin-tagged event
WS → fileEventBus
      ↓ subscribe
Source<T>                       ← L3 Viewer 契约
(file-glob / json-file / aggregate-file / memory / 自定义 provider)
      ↓ typed + origin-aware event
useSource in Viewer React tree  ← Player 渲染
```

作为补充能力，viewer 也可通过 `Source.write()` 让人**可选参与**——直接决策（拖拽、删除、reorder）在 UI 落地；结构化建议通过 ⑥ 通道的 command notification 反馈给 agent。下文四不变量让"可选参与"不会跟 agent 持续工作打架。

### 核心契约

```ts
// core/types/source.ts

export type SourceEvent<T> =
  | { kind: "value"; value: T; origin: "initial" | "self" | "external" }
  | { kind: "error"; code: string; message: string; raw?: unknown };

export interface Source<T> {
  current(): T | null;                                             // 同步快照，render 安全
  subscribe(listener: (e: SourceEvent<T>) => void): () => void;    // 不 fire synthetic initial
  write(value: T): Promise<void>;                                  // 串行化；await 之后 current() 一定是 v
  destroy(): void;                                                 // 幂等
}

export interface SourceProvider {
  kind: string;
  create<T>(config: unknown, ctx: SourceContext): Source<T>;
}

export interface SourceContext {
  workspace: string;
  log(message: string, level?): void;
  signal: AbortSignal;
  files?: FileChannel;       // file-backed provider 才需要
}

export interface FileChannel {
  snapshot(): ReadonlyArray<ViewerFileContent>;
  subscribe(handler: (batch: FileChangeEvent[]) => void): () => void;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
}

export interface FileChangeEvent {
  path: string;
  content: string;
  origin: "initial" | "self" | "external";
}

export interface SourceDescriptor {
  kind: string;
  config?: unknown;            // provider 私有 schema
}
```

### 四条不变量（`core/sources/base.ts` 强制，不靠 viewer 自律）

1. **Single writer**——`write()` 是改变 source 状态的唯一入口；`BaseSource` 用 Promise 队列串行化。
2. **变更读订阅**——所有状态变化（含 viewer 自己 write 的结果）都以 `subscribe()` 事件回流；viewer 不持本地乐观 state，render 永远等于最近一次 value 事件。
3. **Promise 时序锁**——`await source.write(v)` 只在对应 `value` 事件已派发到所有 subscriber、`current() === v` 之后才 resolve。
4. **Origin 标签**——每个 value 事件带 `origin: "initial" | "self" | "external"`；自写不被静默吸收，external 来自 agent 或 peer writer，由服务端 `pendingSelfWrites` 识别。

第 5 条非主线：**Non-fatal errors**——parse / write / transport 失败发 `error` 事件而非 throw，source 仍 live。第 6 条：**`destroy()` 幂等**——之后 `write()` 静默 noop、`subscribe()` 返 noop unsubscribe、`current()` 返 null。

### Agent 与 Source 的关系

**Source 层不替代文件系统。** Agent 继续通过原生 Edit / Write / Read 工具直接操作 workspace——这是 Pneuma 与 coding agent 协作的基本契约。`pendingSelfWrites` 标记机制对 agent 完全透明：agent 调 Edit 产生的 chokidar 事件被标为 `origin: "external"`，viewer 的 source 订阅者据此知道"这是 agent 干的"，按需 reconcile（重挂载 store、动画高亮、prompt 用户合并）。**Source 层和 agent 的 file tools 是两条独立写路径，共享同一份磁盘状态，通过 origin 标记相互识别。** `pendingSelfWrites` 的唯一识别点在 `server/index.ts` 的 chokidar pipeline 与 `/api/files` 写路径里。

### 四类 built-in provider

| kind | 文件 | 用途 | 读写语义 |
|---|---|---|---|
| `file-glob` | `core/sources/file-glob.ts` | 多文件按 glob 聚合 | 读：`ViewerFileContent[]`；不支持 write。**domain 真的是"一组文件"** 的 mode 用（doc、mode-maker、remotion）。|
| `json-file` | `core/sources/json-file.ts` | 单文件结构化（parse/serialize） | 读：typed `T`；写：full round-trip 时序锁。**domain 是单一聚合**（ClipCraft Project）用。|
| `aggregate-file` | `core/sources/aggregate-file.ts` | 多文件聚合但 viewer 看 domain 类型 | 读：domain `T`；写：provider 把 T 拆回 file writes + deletes。**domain 是 aggregate 但散落多文件**（slide / webcraft / illustrate / kami）用。约定把 `load(files) → T \| null` / `save(next, current) → { writes, deletes }` 这对纯函数放到 mode 包根的 `domain.ts`，manifest 端 `config: { ..., load, save }` 直接引用。|
| `memory` | `core/sources/memory.ts` | 进程内状态，无持久层 | 读/写都在内存，刷新即丢失。Ephemeral session state（presence、cursor 等）。|

任何实现 `SourceProvider` 接口的对象都可通过 `PluginManifest.sources` 注册到 SourceRegistry。Plugin 注册的 provider 对所有 mode 可见；mode 私有的在 `manifest.ts` 里直接声明。典型自定义场景：Redis / Yjs / S3 / Figma / 内部 BFF——"素材从哪来、成品到哪去"的打通点。

### Mode 作者的心智路径

1. 问"我的 domain 是什么？"——定义 domain model（DDD）。
2. 问"它存在哪？"——单文件 / 多文件聚合 / 内存 / 远端服务。
3. 选 kind：单文件结构化 → `json-file`；多文件即 domain → `file-glob`；多文件拼成的 aggregate → `aggregate-file` + 写 `load`/`save` 纯函数；ephemeral → `memory`；外部介质 → 自定义 provider。
4. `manifest.sources` 声明。
5. Viewer 里 `const { value, write } = useSource(props.sources.xxx)`——viewer **只看 domain 类型，不看文件路径**。
6. 写回 `await write(v)`；await 返回后 `value` 一定是新值，不需要乐观 state 或 echo-skip ref。

### 设计 rationale

Source 抽象是 [`docs/archive/proposals/2026-03-12-pneuma-3.0-design.md`](../archive/proposals/2026-03-12-pneuma-3.0-design.md) "viewer 是整个 app 的 UI" 这一愿景的 viewer-contract 层基础设施——3.0 要求 viewer 用 domain 语言驱动 UI，这正是 `Source<T>` 里那个 `T` 的含义。完整讨论 + `fileChannel` 作为"domain 就是文件"型 mode 的逃生口，见 [`docs/archive/proposals/superpowers-plans/2026-04-13-source-abstraction.md`](../archive/proposals/superpowers-plans/2026-04-13-source-abstraction.md)。

---

## Agent backends — process-lifecycle 与 capability

虽然 backend 协议适配不属于"三方六方向"，但 viewer/agent 协议要落地必须把 agent 进程跑起来。这一层的契约同样在 `core/types/agent-backend.ts`：

```ts
export type AgentBackendType = "claude-code" | "codex" | "kimi-cli";

export interface AgentBackend {
  readonly name: AgentBackendType;
  readonly capabilities: AgentCapabilities;
  launch(options: AgentLaunchOptions): AgentSessionInfo;
  getSession(sessionId): AgentSessionInfo | undefined;
  isAlive(sessionId): boolean;
  markConnected(sessionId): void;
  setAgentSessionId(sessionId, agentSessionId): void;
  kill(sessionId): Promise<boolean>;
  killAll(): Promise<void>;
  onSessionExited(cb): void;
}

export interface AgentCapabilities {
  streaming: boolean;
  resume: boolean;
  permissions: boolean;
  toolProgress: boolean;
  modelSwitch: boolean;
  scheduling?: boolean;       // Claude Code only
  costTracking?: boolean;     // 用于 cost panel feature gate
  contextWindow?: boolean;
  extras?: Record<string, unknown>;
}

export interface AgentProtocolAdapter {
  parseIncoming(raw: string): unknown | null;
  encodeOutgoing(msg: unknown): string;
}

export interface BackendModule {           // 每 backend 一份 manifest.ts
  readonly type: AgentBackendType;
  readonly label: string;
  readonly displayLabel: string;
  readonly binary: string;
  readonly installHint: string;
  readonly skillsDir: string;              // 例 ".claude/skills" / ".agents/skills" / ".kimi-code/skills"
  readonly instructionsFile: string;       // 例 "CLAUDE.md" / "AGENTS.md"
  readonly capabilities: AgentCapabilities;
  readonly defaultModels?: ModelOption[];
  createBackend(port: number): AgentBackend;
  createBridgeBackend(deps, backend, sessionId): BridgeBackend | null;
  checkRequirements(): { ok; reason?; binaryPath? };
  toolFileRef?(toolName, input): ToolFileRef | undefined;
}
```

**实现链路。** 每个 backend 一份 `backends/<name>/manifest.ts` 实现 `BackendModule`；`backends/index.ts` 是 pure registry，按 type 取 module。WS 桥的 backend-specific 行为通过 `BridgeBackend`（定义在 `server/ws-bridge-backend.ts`）封装——`server/ws-bridge.ts` 是中央桥，不带任何 backend 知识。Browser session state 携带 `backend_type` / `agent_capabilities` / `agent_version`，前端依此 feature-gate（例：`capabilities.scheduling === false` 隐藏 Cron 面板）。

各 backend 的协议细节、生命周期 quirks 在各自 `backends/<name>/README.md`。

---

## 指令文件装配：契约的注入面

Agent 不能调用看不到的 action——所以 `<manifest, runtime>` 必须把契约信息渲染进它读的指令文件（Claude 的 `CLAUDE.md` / Codex 与 Kimi 的 `AGENTS.md`）。这块由 `server/skill-installer.ts` 完成，marker block 一一对应职责域：

| Marker | 来源 | 是否项目-only |
|--------|------|--------------|
| `<!-- pneuma:start --> ... <!-- pneuma:end -->` | Mode 的 SKILL.md 主体 | 否 |
| `<!-- pneuma:viewer-api:start/end -->` | `manifest.viewerApi` → 渲染成 action 表 / command 表 / scaffold 描述 / proxy 描述 | 否 |
| `<!-- pneuma:preferences:start/end -->` | `~/.pneuma/preferences/` 的 hard constraint 抽出 | 否 |
| `<!-- pneuma:project:start/end -->` | `<root>/.pneuma/project.json` 摘要 + 项目偏好 critical | 是 |
| `<!-- pneuma:project-atlas:start/end -->` | `<root>/.pneuma/project-atlas.md` 的 **pointer**（路径 + mtime + 摘要） | 是 |
| `<!-- pneuma:handoff:start/end -->` | `<sessionDir>/.pneuma/inbound-handoff.json` 内容 | 是 |
| `<!-- pneuma:evolved:start/end -->` | Evolution 系统学到的偏好 | 否 |
| `<!-- pneuma:resumed:start/end -->` | Replay → Continue Work 续档上下文 | 否 |

每块是独立 reader/writer 域，正交不冲突。完整磁盘状态全景见 [`controlled-state-surface.md`](./controlled-state-surface.md)。

---

## 设计原则

1. **方向明确**——六个方向各有命名与契约，不混用同一类型服务多个方向。
2. **声明式优先**——Manifest 声明能力，Runtime 注入数据，组件消费数据。
3. **Viewer 无知**——Viewer 不 import manifest，所有数据通过 props 注入。
4. **Agent 自描述**——Agent 通过指令文件了解可调用的 viewer 操作，但不知道 UI 布局。
5. **Runtime 是中枢**——所有跨角色通信都经过 Runtime Shell 中转，backend 知识封进 `BridgeBackend`。
6. **Action ≠ Command**——Action 是 Agent → Viewer（⑤），Command 是 User 经 Viewer 发给 Agent（① → ⑥），方向相反，契约分离。
7. **Files 归 agent，Domain 归 viewer**——L1 是 agent 母语，不抽象；L3 让 viewer 用 domain 类型订阅 agent 工作成果。两条独立写路径共享磁盘，通过 origin 相互识别。

---

## 创建新 mode 时

要写一个新 mode，从 `.claude/skills/create-mode/SKILL.md` 起步——它把上面这些契约组织成"discovery → design brief → 实现"三阶段流程，并把从 webcraft / slide / diagram / illustrate / remotion / kami 提炼出的实践法则写成 `references/`：

- `mode-anatomy.md` — 目录骨架 + manifest 字段填法
- `domain-and-sources.md` — Source kind 决策树 + `domain.ts` 写法
- `viewer-contract-patterns.md` — ViewerContract 五面 + Address 粒度
- `skill-md-patterns.md` — `modes/<name>/skill/SKILL.md` 的六段骨架与 evolution.directive
- `seed-and-showcase.md` — seed 策略 + `showcase/showcase.json` 规范
- `external-integrations.md` — proxy / Babel JIT / `init.params` 凭据 / `NOTICE.md`（直接转录上游内容时必标，光借鉴架构与美学不必标，`manifest.inspiredBy` 是非合规标注的轻量替代）
- `case-studies.md` — "我在纠结哪个抉择？看哪个 mode 已经做过这个选择"

## 相关文档

- [`controlled-state-surface.md`](./controlled-state-surface.md) — Pneuma 持久化状态全景（三层同心圆 + marker block 装配台）；环境变量、handoff 数据流的完整版在那里
- [`network-topology.md`](./network-topology.md) — 端口与进程拓扑
- [`docs/archive/proposals/2026-03-12-pneuma-3.0-design.md`](../archive/proposals/2026-03-12-pneuma-3.0-design.md) — 3.0 "viewer 是整个 app 的 UI" 总愿景
- [`docs/archive/proposals/2026-04-27-pneuma-projects-design.md`](../archive/proposals/2026-04-27-pneuma-projects-design.md) — Project 层完整设计
- [`docs/archive/proposals/2026-04-28-handoff-tool-call.md`](../archive/proposals/2026-04-28-handoff-tool-call.md) — Handoff 协议设计
- [`docs/archive/proposals/2026-05-20-viewer-address-contract.md`](../archive/proposals/2026-05-20-viewer-address-contract.md) — ViewerAddress 收敛背景
