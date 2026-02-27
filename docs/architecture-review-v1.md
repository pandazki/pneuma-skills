# Pneuma Skills 架构全景回顾 & v1.0 蓝图

> **日期**: 2026-02-27
> **版本**: 0.5.0 → v1.0 规划
> **作者**: Pandazki + Claude

---

## 一、MVP 现状盘点

### 1.1 我们已经构建了什么

```
pneuma doc --workspace ./my-project
```

一条命令启动：Bun 后端 + React 前端 + Claude Code CLI + 文件监听 + 实时预览。

**核心闭环已跑通：**

| 能力 | 实现 | 位置 |
|------|------|------|
| Agent 启动/恢复 | Bun.spawn + `--sdk-url` + `--resume` | `cli-launcher.ts` |
| 双向通信桥 | NDJSON ↔ JSON 翻译 + 序号去重 + 重连回放 | `ws-bridge*.ts` |
| 能力注入 | Skill 包复制 + CLAUDE.md 注入 | `skill-installer.ts` |
| 实时预览 | chokidar 监听 → WS 推送 → React 渲染 | `file-watcher.ts` + `MarkdownPreview.tsx` |
| 用户意图传递 | 元素选中 → 上下文注入 → user_message | `ws.ts:sendUserMessage` |
| 会话持久化 | session.json + history.json + 事件缓冲 | `bin/pneuma.ts` + `ws-bridge-replay.ts` |
| 权限管理 | permission_request → UI → permission_response | `ws-bridge-controls.ts` + `PermissionBanner.tsx` |
| 终端/进程/任务 | PTY 终端 + 后台进程监控 + Tasks 面板 | `terminal-manager.ts` + `ProcessPanel.tsx` + `ContextPanel.tsx` |

### 1.2 当前的架构形态

```
bin/pneuma.ts          ← 编排层 (启动顺序、参数解析、session 持久化)
    │
    ├── skill-installer.ts     ← 能力注入 (hardcode: doc mode)
    ├── startServer()          ← 传输层 (HTTP + WS)
    ├── CliLauncher            ← Agent 管理 (hardcode: claude code)
    ├── file-watcher           ← 文件感知 (hardcode: .md files)
    └── Vite / static          ← 前端交付 (hardcode: React SPA)
```

### 1.3 关键耦合点

将当前代码中所有的硬编码和隐式假设梳理出来——它们就是 v1.0 需要抽象的接缝：

| 硬编码 | 位置 | 抽象方向 |
|--------|------|---------|
| `mode !== "doc"` 校验 | `pneuma.ts:122` | Mode Protocol |
| `skill/doc/` 写死路径 | `skill-installer.ts:11` | Mode 自带 skill |
| `PNEUMA_CLAUDE_MD_SECTION` 写死内容 | `skill-installer.ts:16-27` | Mode 声明 claudeMd |
| `.md` 扩展名过滤 | `file-watcher.ts` | Mode 声明 watchPatterns |
| `MarkdownPreview` 写死渲染器 | `App.tsx` left panel | Mode 提供 PreviewComponent |
| `CliLauncher` 写死 claude 命令 | `cli-launcher.ts` | Agent Backend 抽象 |
| `--sdk-url` 协议假设 | `cli-launcher.ts` | Agent Protocol Adapter |
| `NDJSON` 解析 | `ws-bridge.ts` | Agent Protocol Adapter |
| `bypassPermissions` | `pneuma.ts:204` | Mode/Agent 配置化 |

---

## 二、从 MVP 到概念模型的映射

用户的核心洞察：**Pneuma 提供的是一种「能力交付」模型。**

重新审视 `Content Mode × Code Agent Backend × Editor Shell` 这个公式，我们可以看到三个可插拔的维度已经在 ADR-001/004 中被预见，但 MVP 实现中它们是铁板一块。v1.0 的核心工作就是把这些接缝切开。

### 2.1 四层抽象模型

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Mode Protocol (能力描述协议)                        │
│  "我是什么能力、需要什么配置、提供什么 UI"                       │
│  可以是本地包、远程仓库、甚至 agentic 的自配置过程               │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Content Viewer (内容查看器契约)                     │
│  "内容怎么看、怎么编辑、怎么捕捉用户交互、怎么热更新"             │
│  由 Mode 提供具体实现，Pneuma 提供契约接口                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Agent Bridge (Agent 通信抽象)                      │
│  "Agent 怎么启动、怎么通信、怎么管理生命周期"                    │
│  当前是 Claude Code，但抽象后可替换                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Runtime Shell (运行时基座)                         │
│  "WS 桥接、HTTP 服务、文件监听、会话持久化、前端交付"             │
│  通用基础设施，不依赖具体 Mode 或 Agent                       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 与当前代码的对应关系

| 抽象层 | 当前代码 | v1.0 抽象 |
|--------|----------|-----------|
| **L4 Mode Protocol** | `skill/doc/` 目录 + `skill-installer.ts` 硬编码 | `ModeManifest` 协议 + 远程加载 |
| **L3 Content Viewer** | `MarkdownPreview.tsx` + `file-watcher.ts(.md)` | `ViewerContract` 接口 |
| **L2 Agent Bridge** | `cli-launcher.ts` + `ws-bridge.ts(NDJSON)` | `AgentBackend` 接口 |
| **L1 Runtime Shell** | `server/index.ts` + `ws-bridge.ts(路由)` + `bin/pneuma.ts` | 保持，增加 plugin loader |

---

## 三、v1.0 各层详细设计

### 3.1 Layer 4: Mode Protocol — 能力描述协议

**核心理念**：Mode 是一个自包含的「能力包」，描述了 Pneuma 应该如何配置工作环境。

```typescript
// 这是 Mode 仓库的 pneuma-mode.json (或 pneuma-mode.ts)
interface ModeManifest {
  // ── 元信息 ──
  name: string;                    // "doc" | "slide" | "mindmap" | 任意
  version: string;
  displayName: string;
  description: string;

  // ── 能力注入 ──
  skill: {
    dir: string;                   // 相对于 mode 根目录的 skill 目录
    installTarget: string;         // ".claude/skills/pneuma-{name}"
  };
  claudeMd: string;                // 注入 CLAUDE.md 的内容片段

  // ── 内容容器 ──
  viewer: {
    component: string;             // 预览组件入口 (相对路径)
    watchPatterns: string[];       // ["**/*.md", "**/*.html"]
    ignorePatterns: string[];      // ["node_modules/**", ".git/**"]
    serveDir?: string;             // 需要 HTTP 服务的目录 (默认 workspace 根)
  };

  // ── Agent 偏好 ──
  agent?: {
    permissionMode?: string;       // "bypassPermissions" | "default"
    greeting?: string;             // 自动问候语模板
    systemPrompt?: string;         // 额外的系统提示
  };

  // ── 初始化 ──
  init?: {
    seedFiles?: Record<string, string>;  // 空 workspace 的初始文件
    setup?: string;                      // 初始化脚本路径 (可选的 agentic 步骤)
  };

  // ── Hooks (agentic 扩展) ──
  hooks?: {
    onInstall?: string;            // Mode 安装后执行的脚本
    onSessionStart?: string;       // 会话开始时执行
    onFileChange?: string;         // 文件变更时的自定义处理
  };
}
```

**加载方式的演进**：

```
v0.5 (现在):  pneuma doc          ← 内置硬编码
v1.0 Phase1: pneuma --mode slide  ← 内置多 mode，从 modes/ 目录加载
v1.0 Phase2: pneuma --mode ./my-mode        ← 本地路径
v1.0 Phase3: pneuma --mode github:user/repo  ← 远程仓库 (degit/clone)
```

**远程 Mode 的加载流程**：
```
pneuma --mode github:creator/awesome-pneuma-mode
  │
  ├─ 1. 解析 mode 来源 (local / github / http)
  ├─ 2. 拉取到 .pneuma/modes/{name}/ (缓存)
  ├─ 3. 读取 pneuma-mode.json
  ├─ 4. 执行 hooks.onInstall (如果有)
  ├─ 5. installSkill() ← 通用，由 manifest 驱动
  ├─ 6. 注入 claudeMd
  ├─ 7. 启动 viewer
  └─ 8. 如果有 hooks.onSessionStart，可以让 Agent 自己补充配置
```

**Agentic Hooks** 的关键场景：
- `onInstall`: Mode 需要 `npm install`、下载模板等
- `onSessionStart`: 让 Claude 根据用户偏好/记忆动态调整 skill 内容
- `onFileChange`: 自定义的文件预处理 (如 MDX → HTML 转换)

### 3.2 Layer 3: Content Viewer — 内容查看器契约

**核心理念**：查看器负责「看」「编辑」「捕捉」「更新」四个动作。

**工作区布局** — Viewer 在左，Runtime Shell 在右：

![Pneuma Workspace Layout](images/workspace-layout_1.png)

```typescript
interface ViewerContract {
  // ── 查看 ──
  /** 渲染内容的 React 组件 */
  PreviewComponent: ComponentType<PreviewProps>;

  // ── 用户直接编辑 ──
  /** 可选的行内编辑器组件 */
  InlineEditorComponent?: ComponentType<InlineEditorProps>;

  // ── 用户交互捕捉 ──
  /** 元素选中配置 */
  selector: SelectorConfig;
  /** 从选中状态提取上下文 (注入到 user_message) */
  extractContext(selection: SelectedElement, files: FileContent[]): string;

  // ── 实时热更新 ──
  /** 文件变更时的更新策略 */
  updateStrategy: "full-reload" | "incremental" | "hot-replace";
  /** 增量更新的自定义逻辑 (当 strategy = "incremental") */
  applyUpdate?(prevState: unknown, update: FileContent): unknown;
}

interface PreviewProps {
  files: FileContent[];
  selection: SelectedElement | null;
  onSelect: (element: SelectedElement | null) => void;
  mode: "view" | "edit" | "select";
  contentVersion: number;        // cache-bust
}
```

**当前 MarkdownPreview 与契约的对应**：

| 契约能力 | 当前实现 | 状态 |
|---------|---------|------|
| 查看 | `react-markdown` 渲染 | 已实现 |
| 用户直接编辑 | block-level inline editor | 已实现 (edit mode) |
| 交互捕捉 | `data-selectable` + click → SelectionContext | 已实现 (select mode) |
| 热更新 | chokidar → WS → re-render | 已实现 (full-reload) |

**未来容器示例**：

| Mode | PreviewComponent | 选中粒度 | 更新策略 |
|------|-----------------|---------|---------|
| doc | MarkdownPreview | block (h/p/list/table) | full-reload |
| slide | iframe + postMessage | element (任意 DOM) | hot-replace (单页) |
| mindmap | D3/React Flow 画布 | node (节点) | incremental |
| canvas | Excalidraw wrapper | shape (图形) | incremental |
| code-review | Monaco diff editor | hunk (代码块) | full-reload |

### 3.3 Layer 2: Agent Bridge — Agent 通信抽象

**核心理念**：只要能在文件系统上工作的 Agent，都可以接入。

```typescript
interface AgentBackend {
  name: string;                    // "claude-code" | "codex" | "aider"

  // ── 生命周期 ──
  launch(config: AgentLaunchConfig): AgentSession;
  resume(sessionId: string): AgentSession | null;
  kill(sessionId: string): Promise<void>;

  // ── 协议适配 ──
  /** 将 Agent 原始消息转为 Pneuma 标准格式 */
  parseMessage(raw: string | Buffer): StandardMessage | null;
  /** 将 Pneuma 标准消息编码为 Agent 格式 */
  encodeMessage(msg: StandardMessage): string | Buffer;

  // ── 能力声明 ──
  capabilities: {
    streaming: boolean;          // 支持 token 流式
    resume: boolean;             // 支持会话恢复
    permissions: boolean;        // 支持权限审批
    toolProgress: boolean;       // 支持工具进度
    modelSwitch: boolean;        // 支持运行时切换模型
  };
}

interface AgentLaunchConfig {
  cwd: string;
  permissionMode?: string;
  sdkUrl: string;                // WS 回连地址
  sessionId?: string;
  resumeSessionId?: string;
  env?: Record<string, string>;
}
```

**当前 Claude Code 与抽象的对应**：

| 抽象 | 当前实现 | 耦合度 |
|------|---------|-------|
| launch | `CliLauncher.launch()` | 中 — 参数构建写死 |
| parseMessage | `ws-bridge.ts` 中的 NDJSON 解析 | 高 — 散布在 bridge 各处 |
| encodeMessage | `sendToCLI()` 中的 `JSON.stringify + \n` | 低 — 已集中 |
| capabilities | 隐式全部支持 | 需要显式声明 |

**协议适配的复杂性**：

不同 Agent 的消息格式差异巨大。这一层是最复杂的抽象。务实的做法：

```
v1.0 Phase 1: 把 Claude Code 特有逻辑从 ws-bridge 中抽出，形成 adapter
v1.0 Phase 2: 定义 StandardMessage 格式，写第二个 adapter (如 Codex)
v1.0 Phase 3: 社区贡献更多 adapter
```

### 3.4 Layer 1: Runtime Shell — 运行时基座

这一层已经相当稳定，v1.0 主要做的是：

1. **Plugin Loader** — 根据 ModeManifest 动态加载容器组件和 skill
2. **Config 层** — 将 pneuma.ts 中散落的配置集中管理
3. **Hook 执行器** — 在生命周期节点触发 Mode 定义的 hooks

```typescript
// 运行时核心流程 (v1.0 重构后)
async function main() {
  const config = parseConfig(process.argv);         // L1: 解析参数
  const mode = await loadMode(config.mode);          // L4: 加载 Mode
  const agent = loadAgent(mode.agent?.backend);      // L2: 加载 Agent
  const viewer = loadViewer(mode.viewer);             // L3: 加载查看器

  await mode.hooks?.onInstall?.();                   // L4: 安装钩子
  installSkill(workspace, mode.skill, mode.claudeMd); // L4→L1: 注入能力

  const server = startServer({                       // L1: 启动基座
    workspace: config.workspace,
    port: config.port,
    viewer,                                          // L3: 注入查看器
    agent,                                           // L2: 注入 Agent 适配器
  });

  const session = agent.launch({ ... });             // L2: 启动 Agent
  startFileWatcher(workspace, mode.viewer.watchPatterns);   // L1+L4: 文件监听
  await mode.hooks?.onSessionStart?.();              // L4: 会话钩子

  serveFrontend(config, viewer);                     // L1+L3: 前端交付
}
```

---

## 四、现有代码资产评估

### 4.1 可直接复用 (L1 基座，稳定)

| 模块 | 行数 | 评估 |
|------|------|------|
| `ws-bridge.ts` + types + browser + controls + replay | ~800 | 核心价值。路由逻辑通用，需抽出协议解析 |
| `terminal-manager.ts` | ~100 | 通用，无需改动 |
| `session-types.ts` | ~120 | 需拆分为 Standard + Claude-specific |
| `server/index.ts` (路由) | ~150 | 通用，viewer 部分需参数化 |
| 前端通用组件 | ~1500 | ChatPanel, MessageBubble, PermissionBanner, 各面板等全部通用 |
| `store.ts` | ~270 | 通用。files/selection 部分可能需要泛化 |

### 4.2 需要重构 (抽象接缝)

| 模块 | 改动 | 方向 |
|------|------|------|
| `bin/pneuma.ts` | 中 | 提取 mode loader、agent launcher 为可注入依赖 |
| `skill-installer.ts` | 小 | 改为接收 ModeManifest 驱动，而非硬编码路径 |
| `file-watcher.ts` | 小 | watchPatterns 从 hardcode 改为参数传入 |
| `cli-launcher.ts` | 中 | 抽出为 `ClaudeCodeBackend` 实现 `AgentBackend` 接口 |
| `App.tsx` left panel | 小 | 从 `<MarkdownPreview>` 改为 `<mode.viewer.PreviewComponent>` |

### 4.3 新增 (v1.0 核心)

| 模块 | 说明 |
|------|------|
| `core/mode-loader.ts` | 加载 Mode (内置 / 本地路径 / 远程仓库) |
| `core/mode-manifest.ts` | ModeManifest 类型定义 + 校验 |
| `core/agent-backend.ts` | AgentBackend 接口定义 |
| `backends/claude-code/adapter.ts` | 从 ws-bridge 中提取的协议适配 |
| `modes/doc/pneuma-mode.json` | Doc Mode 的 manifest 化 |
| `modes/slide/` | Slide Mode 完整实现 (ADR-011) |

---

## 五、演进路线

### Phase 0: 当前状态 (v0.5.0) ✅

- 单一 Doc Mode，硬编码全链路
- 核心闭环已验证：Agent ↔ Bridge ↔ Preview ↔ User

### Phase 1: 内部解耦 (v0.6 ~ v0.8)

**目标**：在不改变外部行为的前提下，切开内部接缝。

- [ ] 定义 `ModeManifest` 类型，把 doc mode 的硬编码提取为 manifest
- [ ] 定义 `ViewerContract` 接口，让 MarkdownPreview 实现它
- [ ] `skill-installer.ts` 改为 manifest 驱动
- [ ] `file-watcher.ts` 改为 watchPatterns 参数化
- [ ] `App.tsx` 左面板改为动态容器加载
- [ ] 新增 `modes/doc/pneuma-mode.json`

**验证标准**：`pneuma doc` 行为完全不变，但内部已通过 manifest 驱动。

### Phase 2: 多 Mode 支持 (v0.9)

**目标**：内置第二个 Mode (slide)，验证抽象是否成立。

- [ ] 实现 Slide Mode (ADR-011)
- [ ] Mode Registry: 内置 mode 注册 + `--mode` 参数切换
- [ ] 容器组件动态加载 (React.lazy 或 dynamic import)
- [ ] Slide 的 iframe 预览 + postMessage 选中

**验证标准**：`pneuma slide` 和 `pneuma doc` 共享同一个基座，只有容器和 skill 不同。

### Phase 3: Agent 抽象 (v0.9 ~ v1.0)

**目标**：把 Claude Code 特有逻辑从 bridge 中剥离。

- [ ] 定义 `AgentBackend` 接口
- [ ] 实现 `ClaudeCodeBackend` (从现有代码提取)
- [ ] `ws-bridge.ts` 改为通过 adapter 解析消息
- [ ] 定义 `StandardMessage` 格式 (bridge 与前端之间的标准格式)

**验证标准**：替换一个 mock agent backend，前端和 bridge 不需要改动。

### Phase 4: 外部 Mode 加载 (v1.0)

**目标**：支持从本地路径和远程仓库加载 Mode。

- [ ] Mode Loader: 本地路径 (`--mode ./my-mode`)
- [ ] Mode Loader: 远程仓库 (`--mode github:user/repo`)
- [ ] Hook 执行器 (onInstall, onSessionStart)
- [ ] Agentic hooks: Mode 可以让 Agent 参与配置过程

**验证标准**：社区可以创建和分享自己的 Mode。

```
v1.0 完成版图:
pneuma --mode github:creator/awesome-slide-mode --workspace ./my-deck
  → 自动拉取 mode → 读取 manifest → 安装 skill → 启动容器 → 启动 Agent
  → 用户在浏览器中实时编辑
```

---

## 六、概念重新定义

经过这次梳理，我们可以重新定义 Pneuma Skills 的核心概念：

### Pneuma Skills 是什么

> **一个可扩展的、面向 filesystem-based Agent 的能力交付平台。**

它解决的核心问题：Agent 能编辑文件，但用户看不到、选不了、交互不了。Pneuma 填补了 Agent → User 的最后一公里。

### 三个核心契约

```
ModeManifest    = "我是什么能力" (声明式)
ViewerContract = "用户怎么交互" (组件级)
AgentBackend     = "Agent 怎么工作" (协议级)
```

任何人只要满足这三个契约中的任意一个，就可以扩展 Pneuma：
- **Mode 开发者**：定义 manifest + skill → 交付新能力
- **容器开发者**：实现 PreviewComponent → 支持新内容类型
- **Agent 开发者**：实现 AgentBackend → 接入新 Agent

### 与现有公式的关系

```
旧公式: Content Mode × Code Agent Backend × Editor Shell
新公式: ModeManifest(skill + viewer + agent_config) × AgentBackend × Runtime Shell
```

Mode 不再是一个单一维度，而是一个「能力包」，它同时声明了自己需要什么样的容器和 Agent 配置。这就是用户说的「能力描述协议」。

---

## 七、风险与取舍

### 7.1 过度抽象的风险

**结论：当前四层分层恰到好处，无需再简化。**

四层模型（Mode Protocol / Viewer / Agent Bridge / Runtime Shell）经评审确认为合理且可落地的分层。每一层都有明确的职责边界和具体的接口定义，不存在悬空的抽象。

### 7.2 Agent 适配策略

**决策：以 Claude Code 协议为事实标准。**

不设计"通用 Agent 协议"。AgentBackend 接口直接按 Claude Code 的实际协议画出来——NDJSON、`--sdk-url`、streaming、permissions、tool progress 等都是一等概念。

其他 Agent（Codex、Aider 等）通过适配层向 Claude Code 协议靠拢，而不是所有 Agent 都向一个抽象中间层靠拢。这样：
- 接口设计有据可依（不是空想）
- Claude Code 的体验不会因为泛化而打折
- 适配层的复杂度由第三方 Agent 的差异决定，不会污染核心

### 7.3 远程 Mode 的安全性

**决策：价值大于风险，通过用户确认缓解。**

远程 Mode 加载是 Pneuma 作为「能力交付平台」的核心差异化特性。安全策略：
- 维护信任列表（内置 mode + 用户显式信任的来源）
- 非信任来源的 Mode 在安装时触发**用户二次确认**（展示 manifest 摘要 + hook 列表）
- 不做沙箱化（过度工程），信任用户的判断

---

## 八、版本规划

| 版本 | 范围 | 交付物 |
|------|------|--------|
| **v1.0** | Phase 1: 内部解耦 | 契约定义 + manifest 驱动。外部行为不变，架构就位 |
| **v1.1** | Phase 2: Multi-Mode | Slide Mode 实现，验证契约，按需调整接口 |
| **v1.x** | Phase 3~4 | Agent 抽象 + 外部 Mode 加载。等真正需要时再做 |

---

## 九、总结

| 维度 | v0.5 (现在) | v1.0 (内部解耦) | 远景 |
|------|------------|----------------|------|
| Mode | 硬编码 doc | 契约化、manifest 驱动 | 可远程加载 |
| Viewer | 硬编码 MarkdownPreview | 接口化、可插拔 | 社区贡献查看器 |
| Agent | 硬编码 Claude Code | 协议显式化 (以 Claude Code 为标准) | 适配层支持其他 Agent |
| Skill 注入 | 硬编码路径和内容 | manifest 驱动 | 同左 |
| 文件监听 | 硬编码 .md | manifest 声明 | 同左 |
| 核心定位 | WYSIWYG 编辑框架 | **可扩展的 Agent 能力交付平台** | 同左 |

v1.0 的核心是「切开接缝」——代码量增加不大（大部分是重构而非新写），但架构从铁板一块变成了契约驱动的可插拔结构，为后续的多 Mode、多 Agent、远程加载打下基础。
