# Viewer–Agent Protocol Architecture

> Pneuma 的核心通信模型。三个参与方之间有 6 个通信方向，每个方向有明确的职责和契约。

## 协议总览

![Protocol Overview — 三方角色与 6 个通信方向](images/protocol-overview.png)

## 三方角色

| 角色 | 实体 | 职责 |
|------|------|------|
| **User** | 浏览器中的人类 | 观察预览、选择元素、输入消息、审批权限 |
| **Viewer** | Mode 级 React 组件 | 渲染工作区内容、捕获用户交互、执行 Agent 请求的操作、主动上报观测 |
| **Agent** | Claude Code / Codex 进程 | 理解意图、编辑文件、调用工具、请求 Viewer 操作 |

---

## 6 个通信方向

### ① User → Viewer: Interaction（交互输入）

用户在预览面板中的一切操作 — 选择元素、切换页面、调整视口、点击命令按钮。

**系统支撑:**
- Viewer 内部捕获用户交互事件，通过回调上报给 Runtime
- Viewer 根据 `props.commands` 渲染可触发的命令 UI，用户点击后 Viewer 经 ⑥ 通道发送给 Agent

**数据契约:**
- `onSelect(selection)` — 用户选中元素
- `onActiveFileChange(file)` — 用户切换查看文件
- `onViewportChange(viewport)` — 用户滚动/翻页时的视口变更
- `commands: ViewerCommandDescriptor[]` — 可触发的命令列表（runtime 从 manifest 注入）

---

### ② Viewer → User: Rendering（视觉呈现）

Viewer 把工作区内容渲染为用户可见的实时预览。

**系统支撑:**
- Viewer 组件根据 `files` prop 变更触发重渲染，以 Mode 特定的方式呈现内容
- Content set 切换、文件导航、视口管理等 UI 状态由 Viewer 自主管理

**数据契约:**
- `files: ViewerFileContent[]` — 工作区文件列表（runtime 注入）
- `contentVersion` / `imageVersion` — 变更信号，用于缓存失效
- `workspaceItems: WorkspaceItem[]` — 结构化的工作区项（由 workspace model 计算）

---

### ③ User → Agent: Intent（意图表达）

用户通过聊天告诉 Agent 想要什么 — 自然语言消息和附件。

**系统支撑:**
- Chat Panel 发送文本消息 + 图片/文件附件，通过 WebSocket 传输 `user_message`
- Viewer 提供的上下文信息（选中元素、视口位置等）由 ⑥ 通道注入，不属于本方向

**数据契约:**
- `user_message` — 用户消息（text + images + files）

---

### ④ Agent → User: Response（响应反馈）

Agent 的思考过程、文字回复、工具调用状态、以及需要用户审批的权限请求。

**系统支撑:**
- WebSocket streaming — Agent 输出通过 WS bridge 实时推送到浏览器
- Chat Panel 渲染 assistant messages、tool blocks、thinking blocks
- Permission Banner 渲染 `permission_request`（工具审批 + AskUserQuestion）

**数据契约:**
- `assistant_message` — Agent 文字回复（streaming content blocks）
- `tool_use` / `tool_result` — 工具调用和结果
- `permission_request` / `permission_response` — 权限审批循环
- `ViewerLocator` — Agent 消息中嵌入的可点击定位卡片（用户点击后经 ⑤ 触发 Viewer 导航）

---

### ⑤ Agent → Viewer: Action（操作指令）

Agent 请求 Viewer 执行 UI 操作 — 导航到特定位置、缩放到特定元素、切换 UI 状态。

**系统支撑:**
- skill-installer 将 `agentInvocable: true` 的 actions 写入 CLAUDE.md，Agent 知道可调用什么
- Agent 通过 `viewer_action` 工具发起请求
- Runtime 将请求通过 `actionRequest` prop 下发给 Viewer
- Viewer 执行后通过 `onActionResult` 返回结果

**数据契约:**
- `ViewerActionDescriptor` — Viewer 声明自己支持的操作（id, label, category, params）
- `ViewerActionRequest` — Agent 发来的执行请求（requestId, actionId, params）
- `ViewerActionResult` — Viewer 返回的执行结果（success, message, data）
- `ViewerLocator` + `navigateRequest` — 轻量定位（Agent 在消息中嵌入定位卡片，用户点击后 Viewer 导航）

---

### ⑥ Viewer → Agent: Context & Notification（上下文增强与通知）

Viewer 向 Agent 提供信息 — 为用户对话补充视觉上下文，以及主动发送通知。

**系统支撑:**

三类信息共享 Viewer → Agent 方向，但机制不同：

- **上下文增强:** Runtime 调用 `extractContext(selection, files)` 生成 `<viewer-context>` 块，自动注入到用户消息前缀。Agent 借此理解 "这个按钮"、"这里" 等指代。
- **命令触发:** 用户在 Viewer UI 中点击命令按钮（① → ⑥ 联动），Viewer 通过 `onNotifyAgent()` 构造通知发出。
- **自主观测:** Viewer 自身逻辑检测到需要 Agent 关注的情况，通过 `onNotifyAgent()` 主动上报。

Runtime 在 Agent 空闲时 flush notification，作为系统消息注入。

**数据契约:**
- `ViewerSelectionContext` — 选中元素信息（selector, tag, classes, thumbnail 等）
- `extractContext()` — Viewer 实现的上下文提取函数（ViewerContract 方法）
- `ViewerNotification` — 通知载体（type, message, severity）
  - `severity: "info"` — 仅记录
  - `severity: "warning"` — 发送给 Agent
- `ViewerCommandDescriptor` — 命令声明（manifest → runtime → viewer 渲染 UI → 用户点击 → notification）

---

## Manifest 与 Runtime 的角色

![Data Flow — Manifest 声明层 → Runtime 中枢 → 三方分发](images/protocol-dataflow.png)

**Manifest** 是声明层 — Mode 通过 manifest 声明自己的能力：

| Manifest 字段 | 服务于哪个方向 | 说明 |
|---------------|---------------|------|
| `viewerApi.actions[]` | ⑤ Agent → Viewer | Agent 可请求的 Viewer 操作 |
| `viewerApi.commands[]` | ① → ⑥ (User → Viewer → Agent) | UI 上可触发的命令 |
| `viewerApi.workspace` | ② Viewer → User | 工作区文件组织模型 |
| `viewerApi.scaffold` | ① User → Viewer | 工作区初始化/重置能力 |
| `viewerApi.locatorDescription` | ⑤ Agent → Viewer | 定位卡片格式说明（注入 CLAUDE.md） |
| `proxy` | ② Viewer → User | 反向代理路由，解决 Viewer fetch 外部 API 的 CORS 问题 |
| `skill` | ③④⑤⑥ | Agent 的领域知识和行为指导 |

**Runtime** 是中枢 — 读取 manifest、分发数据、桥接所有通道：

- **skill-installer**: manifest → CLAUDE.md（注入 skill prompt + action descriptions + viewer API + proxy docs）
- **store + props**: manifest → Viewer props（注入 commands、actions、files、workspace items）
- **proxy middleware**: manifest.proxy + workspace proxy.json → `/proxy/<name>/*` 反向代理（Viewer 用相对路径访问外部 API，Runtime 服务端转发）
- **WS bridge**: browser JSON ↔ backend transport（Claude NDJSON / Codex stdio JSON-RPC）
- **context injection**: `extractContext()` → `<viewer-context>` 注入到 user message

---

## Editing 状态

`editing` 是协议层的顶层布尔状态，描述当前 session 处于**创作**还是**消费**阶段。

```
editing: true    创作阶段 — Agent 在场可编辑，Viewer 显示编辑 UI
editing: false   消费阶段 — Agent 不主动编辑，Viewer 锁定编辑功能，保留内容交互
```

### 三方行为

| 角色 | `editing: true` | `editing: false` |
|------|----------------|-----------------|
| **User** | 通过 Chat 与 Agent 协作，在 Viewer 中选择/拖拽/编辑 | 消费内容（阅读文档、使用 dashboard、浏览幻灯片） |
| **Viewer** | 显示编辑 UI（拖拽手柄、网格线、Gallery 等） | 隐藏编辑 UI，保留内容交互（tile 内部点击、链接跳转等） |
| **Agent** | 全力工作 — 编辑文件、调用工具 | 不主动修改（具体行为由 mode skill 定义） |

### 数据流

- **持久化:** `editing` 存储在 `.pneuma/session.json` 和 `~/.pneuma/sessions.json`
- **Server:** `GET /api/config` 返回 `editing`，`POST /api/session/editing` 切换
- **Viewer:** 通过 `props.editing` 读取，各 mode 自行适配
- **Agent:** skill-installer 将当前 `editing` 状态注入 CLAUDE.md
- **CLI:** `--viewing` flag 启动时直接进入 `editing: false`

### Opt-in

不是所有 mode 都需要区分 editing 状态。未声明的 mode 永远处于 `editing: true`，对用户和 Agent 无感知。Mode 通过 manifest 声明支持：

```typescript
// manifest.ts
{
  editing: { supported: true }  // 启用 editing 切换
}
```

---

## 设计原则

1. **方向明确** — 6 个通信方向各有命名和契约，不混用同一类型服务多个方向
2. **声明式优先** — Manifest 声明能力，Runtime 注入数据，组件消费数据
3. **Viewer 无知** — Viewer 不 import manifest，所有数据通过 props 注入
4. **Agent 自描述** — Agent 通过 CLAUDE.md 了解可调用的 Viewer 操作，但不知道 UI 布局
5. **Runtime 是中枢** — 所有跨角色通信都经过 Runtime Shell 中转
6. **Action ≠ Command** — Action 是 Agent → Viewer（⑤ 操作指令），Command 是 User 经 Viewer 发给 Agent（① → ⑥ 命令触发），方向相反，契约分离
