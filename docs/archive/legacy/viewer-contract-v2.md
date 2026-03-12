# ViewerContract v2 — Agent-Human Alignment Protocol

> Design Document · 2026-03-02

## 1. 问题

### 1.1 根本问题：Agent-Human 对齐缺失

ViewerContract 当前的职责是"渲染"——提供 PreviewComponent、extractContext、updateStrategy。但它真正的核心职责应该是 **Agent-Human 对齐协议**：

| 对齐维度 | 含义 | 现状 |
|---------|------|------|
| **感知对齐** | Agent 能看到 User 看到的东西 | `extractContext` 只捕捉选中元素，无视窗状态、无截图 |
| **能力对齐** | Agent 能做到 User 能做到的事情 | 完全缺失。Viewer 有按钮，Agent 不知道也无法调用 |

用户看到了 slide outline 面板的折叠按钮，但 Agent 无从得知这个按钮存在。用户问 "帮我收起 outline"，Agent 无能为力——不是能力不够，而是缺少协议。

### 1.2 文件工作区模型缺失

三个内置 Mode 对"文件"的处理方式各不相同，且无标准化描述：

| Mode | 文件组织 | 导航 | 活跃文件追踪 |
|------|---------|------|-------------|
| Doc | 所有 .md 平铺 | 无 | 无 |
| Slide | manifest.json 定义顺序 | 缩略图导航 | 有 |
| Draw | 只显示第一个 .excalidraw | 无 | 无 |

### 1.3 Viewer-Skill 解耦

**Viewer 和 Skill 并非 1:1 关系。** 同一个 Slide Viewer 可以被不同 Skill 使用。Viewer 需要自描述 API，在被任何 Skill 引用时，于初始化阶段自动注入 Agent 知识库。

## 2. 设计原则

**ViewerContract = Agent-Human Alignment Protocol**

两个对齐轴，一个统一机制：

```
                    ┌──────────────────────┐
                    │   ViewerContract     │
                    │                      │
    感知对齐         │  extractContext()    │  现有：用户选中了什么
                    │  actions (query类)   │  新增：截图、视窗描述等
                    │                      │
    ──────────────  │  ────────────────    │
                    │                      │
    能力对齐         │  actions (mutate类)  │  新增：导航、UI 控制等
                    │  workspace model     │  新增：文件组织模型
                    │                      │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   执行通道            │
                    │   POST /api/viewer/   │
                    │   action              │
                    │   ↕ WS Bridge ↕       │
                    └──────────────────────┘
```

统一机制：**所有 Viewer 能力都通过 `actions[]` 声明，通过同一个执行通道调用。** 无论是 "导航到第 3 页"、"收起 outline"、还是 "给当前视图截个图"，都是 action。框架不区分感知和能力——区分是语义层面的，协议层面统一。

## 3. 类型设计

### 3.1 文件工作区模型

```typescript
/** 工作区项 — 文件导航模型中的一个逻辑单元 */
export interface WorkspaceItem {
  path: string;           // 文件路径
  label: string;          // 显示标签
  index?: number;         // 排序位置 (ordered 模式)
  metadata?: Record<string, unknown>;
}

/** Viewer 如何组织文件 */
export interface FileWorkspaceModel {
  type: "all" | "manifest" | "single";
  multiFile: boolean;
  ordered: boolean;
  hasActiveFile: boolean;
  manifestFile?: string;                       // type="manifest" 时的索引文件
  resolveItems?: (files: ViewerFileContent[]) => WorkspaceItem[];  // 前端运行时
}
```

| type | 语义 | 示例 |
|------|------|------|
| `all` | 所有匹配文件平等展示 | Doc: 每个 .md 独立 |
| `manifest` | 索引文件定义结构和顺序 | Slide: manifest.json |
| `single` | 只操作一个主文件 | Draw: 单个 .excalidraw |

### 3.2 Viewer Action

```typescript
export interface ViewerActionParam {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

/** Viewer 声明的操作 — 能力对齐的基本单元 */
export interface ViewerActionDescriptor {
  id: string;             // e.g. "navigate-to", "ui:toggle-outline", "capture-screenshot"
  label: string;          // 人类可读标签
  category: "file" | "navigate" | "ui" | "custom";
  agentInvocable: boolean;
  params?: Record<string, ViewerActionParam>;
  description?: string;
}

/** 执行通道中的请求 */
export interface ViewerActionRequest {
  requestId: string;
  actionId: string;
  params?: Record<string, unknown>;
}

/** 执行结果 */
export interface ViewerActionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}
```

### 3.3 ViewerContract 扩展

```typescript
export interface ViewerContract {
  // 现有（不变）
  PreviewComponent: ComponentType<ViewerPreviewProps>;
  extractContext(selection: ViewerSelectionContext | null, files: ViewerFileContent[]): string;
  updateStrategy: "full-reload" | "incremental";

  // 新增
  workspace?: FileWorkspaceModel;
  actions?: ViewerActionDescriptor[];
}
```

### 3.4 ViewerPreviewProps 扩展

```typescript
export interface ViewerPreviewProps {
  // 现有（不变）...

  // 新增
  workspaceItems?: WorkspaceItem[];
  actionRequest?: ViewerActionRequest | null;
  onActionResult?: (requestId: string, result: ViewerActionResult) => void;
}
```

### 3.5 ModeManifest 扩展（后端可读的纯数据版）

```typescript
export interface ModeManifest {
  // 现有字段 ...

  /** Viewer 自描述 API — 纯数据，后端 skill-installer 可读 */
  viewerApi?: {
    workspace?: Omit<FileWorkspaceModel, "resolveItems">;
    actions?: ViewerActionDescriptor[];
  };
}
```

## 4. 执行通道

### 4.1 设计

复用现有 `pendingControlRequests` 模式（`server/ws-bridge-controls.ts`）。

新建 `server/ws-bridge-viewer.ts`：

```typescript
/** 向浏览器发送 viewer action 请求，等待 viewer 执行并返回结果 */
export function sendViewerActionRequest(
  session: Session,
  actionId: string,
  params: Record<string, unknown> | undefined,
  broadcastToBrowsers: (msg: BrowserIncomingMessage) => void,
): Promise<ViewerActionResult>

/** 处理浏览器返回的 action 结果，resolve 对应的 Promise */
export function handleViewerActionResponse(
  session: Session,
  msg: { request_id: string; result: ViewerActionResult },
): void
```

### 4.2 WS 消息类型

```typescript
// Server → Browser (session-types.ts BrowserIncomingMessage)
| { type: "viewer_action_request"; request_id: string; action_id: string; params?: Record<string, unknown> }

// Browser → Server (session-types.ts BrowserOutgoingMessage)
| { type: "viewer_action_response"; request_id: string; result: ViewerActionResult }
```

### 4.3 HTTP API

```typescript
// server/index.ts — Agent 通过 Bash curl 调用
app.post("/api/viewer/action", async (c) => {
  const { actionId, params } = await c.req.json();
  const result = await sendViewerActionRequest(session, actionId, params, broadcast);
  return c.json(result);
});
```

### 4.4 完整数据流

```
Agent (Claude Code)
  │ curl POST /api/viewer/action { actionId: "navigate-to", params: { file: "slide-3.html" } }
  ▼
Server (Hono)
  │ sendViewerActionRequest() → 生成 requestId, 存入 session.pendingViewerActions
  │ broadcastToBrowsers({ type: "viewer_action_request", ... })
  ▼
Browser (ws.ts)
  │ store.setActionRequest({ requestId, actionId, params })
  ▼
PreviewComponent (React)
  │ 检测 actionRequest 变化 → 执行: navigate to slide-3.html
  │ onActionResult(requestId, { success: true })
  ▼
Browser (ws.ts)
  │ send({ type: "viewer_action_response", request_id, result })
  ▼
Server (ws-bridge-viewer.ts)
  │ handleViewerActionResponse() → resolve Promise
  ▼
HTTP Response → Agent
  │ { "success": true }
```

## 5. CLAUDE.md 自动注入

### 5.1 独立 Marker

```markdown
<!-- pneuma:start -->
## Pneuma Slide Mode
(Skill 的领域知识 — 由 Skill 拥有)
<!-- pneuma:end -->

<!-- pneuma:viewer-api:start -->
## Viewer API
(Viewer 的自描述能力 — 由 Viewer 拥有，Skill 升级不影响)
<!-- pneuma:viewer-api:end -->
```

两个 section 独立更新：
- Skill 升级 → 只改 `pneuma:start/end`
- Viewer 升级 → 只改 `pneuma:viewer-api:start/end`

### 5.2 注入内容示例

```markdown
## Viewer API

### Workspace
- Type: manifest (ordered, multi-file, active file tracking)
- Index file: manifest.json

### Actions

The viewer supports these operations. Invoke via Bash:
`curl -s -X POST http://localhost:17007/api/viewer/action -H 'Content-Type: application/json' -d '{"actionId":"<id>","params":{...}}'`

| Action | Description | Params |
|--------|-------------|--------|
| `navigate-to` | Navigate to a specific slide | file: string (required) |
```

### 5.3 实现

`server/skill-installer.ts` 新增纯函数 `generateViewerApiSection()`，`installSkill()` 签名扩展接受 `viewerApi` 参数。

## 6. 三个内置 Mode

### Slide

**manifest.ts** — 新增 `viewerApi`:
```typescript
viewerApi: {
  workspace: { type: "manifest", multiFile: true, ordered: true, hasActiveFile: true, manifestFile: "manifest.json" },
  actions: [
    { id: "navigate-to", label: "Go to Slide", category: "navigate", agentInvocable: true,
      params: { file: { type: "string", description: "Slide file path", required: true } },
      description: "Navigate to a specific slide" },
  ],
},
```

**pneuma-mode.ts** — viewer 新增 `workspace`（含 `resolveItems` 解析 manifest.json）+ `actions`。

### Doc

**manifest.ts**:
```typescript
viewerApi: {
  workspace: { type: "all", multiFile: true, ordered: false, hasActiveFile: false },
},
```

### Draw

**manifest.ts**:
```typescript
viewerApi: {
  workspace: { type: "single", multiFile: false, ordered: false, hasActiveFile: false },
},
```

## 7. 框架扩展性

本次框架天然支持以下扩展，无需改动协议——只需 Viewer 新增 action 声明并实现 handler：

| 扩展 | Action 声明 | Viewer 实现 |
|------|------------|------------|
| 截图感知 | `{ id: "capture-screenshot", category: "custom" }` | canvas/DOM → base64，返回 data URL |
| UI 控制 | `{ id: "ui:toggle-outline", category: "ui" }` | toggle React state |
| 视窗描述 | `{ id: "describe-view", category: "custom" }` | 返回当前可视内容摘要 |
| 全屏模式 | `{ id: "ui:fullscreen", category: "ui" }` | toggle fullscreen API |

这本质上提供了一个 **Agent 与人对齐的标准协议**。Viewer 声明越多，Agent 的感知和能力就越接近用户。
