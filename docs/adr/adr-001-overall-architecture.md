# ADR-001: 整体架构与技术栈选型

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-002 ~ ADR-011

---

## 1. 背景

Pneuma Skills 是一个让 Code Agent 对 HTML-based 内容做所见即所得编辑的开源框架。其核心模式为：

```
Content Mode (编辑什么) × Code Agent Backend (谁来编辑) × Editor Shell (WYSIWYG 编辑器)
```

我们需要选择一个能同时支撑以下需求的技术架构：

1. **WebSocket 双通道通信** — 浏览器 ↔ Server ↔ CLI 的实时消息桥接
2. **子进程管理** — spawn / kill / resume Code Agent CLI 进程
3. **文件系统操作** — 监听内容文件变更，serve 静态文件
4. **前端 WYSIWYG 编辑器** — 实时预览 + 元素选中 + streaming 展示
5. **可插拔架构** — Content Mode 和 Agent Backend 可独立扩展

### 核心参考项目

[The-Vibe-Company/companion](https://github.com/The-Vibe-Company/companion) 是一个成熟的 Claude Code Web UI，拥有 395+ stars 和活跃维护。深度调研结论：

| 方面 | Companion 实现 |
|------|---------------|
| Runtime | Bun |
| Server Framework | Hono |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 |
| State Management | Zustand 5 |
| WebSocket | Bun 原生 WebSocket + 自定义 Bridge |
| CLI 通信 | NDJSON over WebSocket (`--sdk-url`) |
| 进程管理 | `Bun.spawn()` |
| 持久化 | JSON 文件 (session store) |

---

## 2. 决策

### 2.1 技术栈选型

**全面采用 Companion 的基础技术栈**，理由：已验证的生产级方案 + 可直接提取核心通信层。

| 层 | 选型 | 理由 |
|----|------|------|
| **Runtime** | **Bun** | 原生 TS 执行、内置 WebSocket server、`Bun.spawn()` 子进程管理、Companion 已验证 |
| **Server** | **Hono** | 轻量、Bun 原生兼容、模块化路由、中间件生态好 |
| **Frontend Framework** | **React 19** | 生态最丰富、Companion 已验证、SSR 不需要所以不引入 Next.js |
| **Build Tool** | **Vite 6** | 开发体验最佳、HMR 快、React plugin 成熟 |
| **CSS** | **Tailwind CSS 4** | utility-first、快速原型、Companion 已验证 |
| **State Management** | **Zustand 5** | 轻量无 boilerplate、TypeScript 友好、Map-based store 适合多 session |
| **包管理** | **Bun** (内置) | 统一 runtime + 包管理，减少工具链复杂度 |

### 2.2 架构分层

```
┌───────────────────────────────────────────────────────────────────┐
│  Content Modes (可插拔)              modes/slide/, modes/doc/...   │
│  每个 mode 提供: UI 组件 + Skill 包 + 文件约定                      │
├───────────────────────────────────────────────────────────────────┤
│  Editor Shell (通用)                 core/editor-shell/            │
│  React SPA: 对话输入 + streaming + tool 审批 + Mode 渲染           │
├───────────────────────────────────────────────────────────────────┤
│  Agent Bridge (通用)                 core/server/                  │
│  Bun + Hono: HTTP + WebSocket 双通道 + 消息路由 + file watcher     │
├───────────────────────────────────────────────────────────────────┤
│  Agent Backends (可插拔)             backends/claude-code/...      │
│  每个 backend 提供: Spawner + Protocol Adapter + Permission Handler│
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 Monorepo vs Single Package

**决策: MVP 阶段使用 Single Package，Phase 2 视需要转 Monorepo。**

理由：
- MVP 只有 slide + claude-code，无需包隔离
- Single package 简化构建和发布流程
- 目录结构已按 `core/`, `modes/`, `backends/` 划分，后续可无痛转 workspace

### 2.4 Companion 代码复用策略

**决策: 方案 B — 提取通信层，而非 fork 整个项目。**

| 方案 | 优点 | 缺点 | 判定 |
|------|------|------|------|
| A: Fork 整个项目 | 快速获得成熟方案 | 需大幅重构 UI + 继承不需要的复杂度（Docker、Codex、Terminal、Cron、Agent 系统等） | 否 |
| **B: 提取通信层** | 只拿需要的部分，完全掌控 | 需理解和抽取 | **选择** |
| C: 只参考协议文档 | 完全掌控 | 重复踩坑（NDJSON 边界、session 双 ID、消息排序等） | 否 |

从 Companion 提取的核心模块：
1. **WebSocket Bridge 核心逻辑** — 双通道路由、消息翻译（~500 行核心代码）
2. **CLI Launcher** — `Bun.spawn()` + `--sdk-url` 参数构建（~200 行核心代码）
3. **NDJSON 解析** — 换行分割 + JSON parse + 错误容忍
4. **Session 持久化模式** — JSON 文件存储 + debounced write
5. **Permission 请求-响应关联** — request_id 匹配 + pending map

**不提取的部分（Pneuma 不需要）：**
- Docker 容器管理 (containerManager, environments)
- Codex adapter (JSON-RPC 翻译层)
- Terminal/PTY 管理
- Cron 调度系统
- Agent executor 系统
- Linear 集成
- PR Poller
- Recording 系统
- OpenRouter 集成 (auto-naming)
- QR code 认证

---

## 3. 详细设计

### 3.1 项目目录结构

```
pneuma-skills/
├── package.json                     # single package, type: "module"
├── bun.lock
├── tsconfig.json
├── vite.config.ts                   # frontend build
│
├── bin/
│   └── pneuma.ts                    # CLI 入口: pneuma slide [options]
│
├── core/
│   ├── server/
│   │   ├── index.ts                 # Bun.serve() + Hono app + WebSocket upgrade
│   │   ├── ws-bridge.ts             # 双通道 WebSocket 消息桥接 (核心)
│   │   ├── message-router.ts        # 标准消息路由 (CLI ↔ 标准格式 ↔ Browser)
│   │   ├── file-watcher.ts          # 内容文件变更 → content_update 推送
│   │   ├── session-manager.ts       # session 生命周期 (create/resume/destroy)
│   │   ├── session-store.ts         # JSON 文件持久化 (debounced)
│   │   ├── skill-installer.ts       # Content Mode Skill → workspace 安装
│   │   └── static-server.ts         # 内容文件 + 前端 SPA 静态服务
│   │
│   ├── types/
│   │   ├── messages.ts              # 标准消息类型 (Framework ↔ Browser)
│   │   ├── protocol.ts              # CLI 协议消息类型 (NDJSON)
│   │   ├── content-mode.ts          # ContentMode 接口
│   │   └── agent-backend.ts         # AgentBackend 接口
│   │
│   └── editor-shell/                # React SPA (Vite build)
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── ChatInput.tsx         # 对话输入 (通用)
│       │   ├── StreamingResponse.tsx  # streaming 展示 (通用)
│       │   ├── PermissionDialog.tsx   # tool 审批 (通用)
│       │   └── ModeRenderer.tsx      # 动态加载 mode 渲染组件
│       ├── hooks/
│       │   ├── useWebSocket.ts       # WebSocket 连接管理
│       │   └── useSession.ts         # session 状态 hook
│       └── store/
│           └── editor-store.ts       # Zustand store
│
├── modes/
│   └── slide/
│       ├── index.ts                  # SlideMode implements ContentMode
│       ├── components/
│       │   ├── SlideNavigator.tsx     # 左侧大纲/缩略图
│       │   ├── SlidePreview.tsx       # 右侧 slide 预览 (iframe)
│       │   └── SlideSelector.ts      # 元素选中逻辑
│       ├── skill/                    # Claude Code Skill 包 (安装到 workspace)
│       │   ├── SKILL.md
│       │   ├── templates/
│       │   ├── references/
│       │   └── scripts/
│       └── file-convention.ts        # manifest.json + slides/ 约定
│
├── backends/
│   └── claude-code/
│       ├── index.ts                  # ClaudeCodeBackend implements AgentBackend
│       ├── spawner.ts                # Bun.spawn() claude --sdk-url ...
│       ├── ndjson.ts                 # NDJSON 解析/序列化
│       └── protocol-adapter.ts       # NDJSON ↔ 标准消息翻译
│
└── docs/
    └── adr/                          # 本系列 ADR
```

### 3.2 核心数据流

```
用户浏览器                    Pneuma Server (Bun)              Claude Code CLI
   │                              │                               │
   │◄─── HTTP (Vite build) ──────│                               │
   │     Editor Shell SPA         │                               │
   │                              │                               │
   │──── WS /ws/browser/:sid ───►│                               │
   │     BrowserMessage           │                               │
   │                              │──── WS /ws/cli/:sid ────────►│
   │                              │     NDJSON                    │
   │                              │     (claude --sdk-url ...)    │
   │                              │                               │
   │  user_message ──────────────►│  translate ──────────────────►│
   │                              │  { type: "user", message: {} }│
   │                              │                               │
   │                              │◄──── stream_event ────────────│
   │◄──── agent_streaming ───────│  translate                    │
   │                              │                               │
   │                              │◄──── control_request ─────────│
   │◄──── permission_request ────│  (can_use_tool)               │
   │                              │                               │
   │  permission_response ───────►│  translate ──────────────────►│
   │                              │  control_response             │
   │                              │                               │
   │                              │ ◄── file change (watcher) ───│
   │◄──── content_update ────────│                               │
   │  iframe reload               │                               │
```

### 3.3 依赖清单 (MVP)

```json
{
  "dependencies": {
    "hono": "^4.7.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "react-markdown": "^10.0.0",
    "remark-gfm": "^4.0.0",
    "react-resizable-panels": "^4.6.0",
    "chokidar": "^4.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.9.0"
  }
}
```

注意：
- **不使用 `ws` 库** — Bun 内置 WebSocket server，浏览器使用原生 WebSocket API
- **使用 `chokidar`** 而非 Bun 内置 `fs.watch` — 跨平台可靠性更好（macOS FSEvents 支持）
- **不引入路由库** — hash-based routing 手写即可（参考 Companion 模式）

### 3.4 构建与运行模式

**开发模式：**
```bash
pneuma dev slide --workspace ./my-deck
# 1. Vite dev server (HMR) → 前端
# 2. Bun server → API + WebSocket + static files
# 3. 前端 proxy → /api/* 和 /ws/* 转发到 Bun server
```

**生产模式：**
```bash
pneuma slide --workspace ./my-deck
# 1. Vite build → dist/ (已预构建)
# 2. Bun server → serve dist/ + API + WebSocket
```

### 3.5 端口分配

| 端口 | 用途 | 模式 |
|------|------|------|
| 3210 (默认) | Pneuma Server (HTTP + WS) | production |
| 3211 | Vite Dev Server | dev only |
| 用户可配 | `--port` flag | both |

---

## 4. 被否决的方案

### 4.1 Node.js + Express

- 优点：生态最大，熟悉度高
- 否决原因：需要 `ws` 库做 WebSocket、需要 `ts-node` 或 `tsx` 跑 TypeScript、子进程管理不如 Bun 原生便利
- Companion 已验证 Bun 方案足够稳定

### 4.2 Deno

- 优点：原生 TS、安全沙箱
- 否决原因：Bun.spawn() 的子进程管理更成熟、Companion 用 Bun 已验证、npm 兼容性 Bun 更好

### 4.3 Next.js / Remix

- 优点：SSR、路由约定
- 否决原因：Pneuma 是本地工具不需要 SSR、引入额外构建复杂度、WebSocket 集成不如裸 Bun

### 4.4 Vue / Svelte

- 否决原因：React 生态更丰富（CodeMirror、resizable panels 等都有 React 封装）、Companion 用 React 已验证

---

## 5. 影响

1. **团队需要 Bun runtime** — 开发环境要求 `bun >= 1.0.0`
2. **从 Companion 提取代码需标注来源** — 遵守 MIT License
3. **技术栈与 Companion 高度一致** — 可以持续跟踪 Companion 的协议更新和 bugfix
4. **单包结构 MVP 简单** — 但 Phase 2 转 monorepo 需要迁移工作

---

## 6. 参考

- [The-Vibe-Company/companion](https://github.com/The-Vibe-Company/companion) — 核心技术参考
- [Bun Documentation](https://bun.sh/docs) — Runtime
- [Hono Documentation](https://hono.dev) — Server framework
- [Zustand](https://zustand-demo.pmnd.rs/) — State management
