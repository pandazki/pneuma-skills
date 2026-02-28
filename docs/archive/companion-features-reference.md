# Companion 功能模块参考文档

> 本文档梳理 [The Companion](https://github.com/The-Vibe-Company/companion) 的完整功能模块，
> 作为 Pneuma Skills 后续实现的参考。每个模块包含：背景、功能目的、细项清单、Companion 源码参考。
>
> Companion 源码位置：`/tmp/companion-research/`

---

## 领域概念

### Pneuma vs Companion 的定位差异

| | Pneuma Skills | The Companion |
|---|---|---|
| **定位** | 内容编辑工具（WYSIWYG） | 通用开发工具 |
| **核心公式** | Content Mode × Code Agent × Editor Shell | Agent Sessions × Tool Inspection |
| **Session 模型** | 单 session / workspace | 多 session 并行 |
| **Workspace** | 绑定 mode，所有 session 共享 | 每 session 独立 cwd |
| **Preview** | 核心功能（实时渲染内容） | 无（纯代码工具） |
| **任务粒度** | 较小（内容编辑指令） | 较大（功能开发） |

### 核心概念映射

```
Pneuma 概念             Claude Code 概念           说明
─────────────────────────────────────────────────────────────────
Workspace               cwd                       用户的工作目录
Mode                    -                         内容类型（doc/slide），决定渲染器和 Skill
Session                 Session                   一次编辑会话（CLI 进程 + WS 连接）
sessionId               -                         Server UUID，用于 WS 路由
cliSessionId            session_id                CLI 内部 ID，用于 --resume
Skill                   Skill (.claude/skills/)   注入给 Agent 的领域知识
Preview                 -                         实时渲染内容（Pneuma 独有）
Element Selection       -                         用户选中元素发指令（Pneuma 独有）
```

### 状态归属

```
全局 (Server 实例级)          单 Session 级
──────────────────────────────────────────────
workspace 路径                 消息历史 (messages)
mode (doc/slide)               streaming 文本
files (文件内容)               activity (thinking/tool)
preview theme                  permissions (待审批)
previewMode (view/edit/select) connectionStatus (WS)
selection (元素选择)            cliConnected
                               sessionStatus (idle/running)
                               session state (model, cost, turns)
```

### 存储位置

```
<workspace>/
├── .pneuma/
│   └── session.json          # Session 元信息（sessionId, cliSessionId, mode）
├── .claude/
│   └── skills/pneuma-doc/    # Skill 文件
├── CLAUDE.md                 # Claude Code 项目配置
└── *.md                      # 用户内容
```

---

## 目录

- [T1: Session 持久化与恢复](#t1-session-持久化与恢复)
- [T2: Tab 系统 + TopBar](#t2-tab-系统--topbar)
- [T3: Diff 查看器](#t3-diff-查看器)
- [T4: 内嵌终端](#t4-内嵌终端)
- [T5: Context Panel（右侧边栏）](#t5-context-panel右侧边栏)
- [T6: Composer 增强](#t6-composer-增强)
- [T7: Prompts 系统](#t7-prompts-系统)
- [T8: Settings 页面](#t8-settings-页面)
- [T9: 后台进程追踪](#t9-后台进程追踪)
- [T10: Session 自动命名](#t10-session-自动命名)
- [S1: Git 集成（高级）](#s1-git-集成高级)
- [S2: Authentication](#s2-authentication)
- [S3: Docker / Containers](#s3-docker--containers)
- [S4: Agents 系统](#s4-agents-系统)
- [S5: Cron Jobs](#s5-cron-jobs)
- [S6: Integrations (Linear / GitHub)](#s6-integrations-linear--github)
- [S7: Recording / Replay](#s7-recording--replay)
- [S8: Update Checker](#s8-update-checker)
- [S9: Service Mode](#s9-service-mode)

> **T = Target（计划实现）**，按优先级排序
> **S = Skipped（暂不实现）**，记录以备后用

---

## T1: Session 持久化与恢复

### 背景

当前 Pneuma 每次启动都创建全新的 CLI session，浏览器刷新或服务器重启后丢失所有对话历史。
Session ID 也没有持久化，无法利用 Claude Code 的 `--resume` 恢复上下文。

### 功能目的

让 session 在浏览器刷新和服务器重启后能自动恢复，用户不丢失对话上下文。
采用单 session 模型，状态存储在 workspace 本地（`.pneuma/session.json`）。

### 细项清单

#### Server 端

- [ ] **Session 元信息持久化**
  - 在 `<workspace>/.pneuma/session.json` 存储最小元信息
  - 数据：`{ sessionId, cliSessionId, mode, createdAt }`
  - CLI 连接后从 `system/init` 消息提取 `cliSessionId`，更新文件
- [ ] **启动时 Resume 逻辑**
  - `bin/pneuma.ts` 启动时检查 `.pneuma/session.json`
  - 如果存在且有 `cliSessionId`：用 `--resume <cliSessionId>` spawn CLI
  - 如果不存在或 resume 失败：创建新 session，写入 `session.json`
- [ ] **`.pneuma/` 目录管理**
  - 启动时自动创建 `.pneuma/` 目录
  - skill-installer 将 `.pneuma/` 加入 `.gitignore`（如有）

#### Frontend 端

- [ ] **浏览器刷新恢复**
  - 当前已通过 WsBridge event buffer 支持（`handleBrowserOpen` replay）
  - 确认 `?session=<sessionId>` 在刷新后仍能正确重连
  - Resume 场景下 CLI 发送 `message_history` 事件，前端正确渲染

### 不做的事项

- ~~多 Session 管理~~ — 单 session 模型，未来用 `/clear` 替代
- ~~Session 列表 / Sidebar~~ — 不需要（单 session）
- ~~消息历史持久化~~ — Claude Code `--resume` 自动恢复
- ~~Store 改为 Map-based~~ — 保持扁平结构

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/cli-launcher.ts` | `--resume` 参数传递方式 |
| `web/server/ws-bridge.ts` | Event buffer + replay 机制 |
| `web/server/session-store.ts` | JSON 持久化模式参考（Pneuma 大幅简化） |

---

## T2: Tab 系统 + TopBar

### 背景

当前 Pneuma 的 Session 页面是固定的两栏布局（Preview + Chat），没有 Tab 切换。
用户无法查看 diff、打开终端、查看进程等，功能扩展受限。

### 功能目的

在每个 Session 工作区内提供 Tab 系统，让用户在不同视图间切换。
TopBar 显示 Session 信息和状态，提供快捷操作。

### 细项清单

- [ ] **TopBar 组件**
  - 左侧：Sidebar 切换按钮
  - 中间：Tab 切换（Session / Diffs / Shell / Processes）
  - Session 名称 + 编辑
  - 连接状态指示（CLI connected / disconnected）
  - 右侧：Quick Terminal 按钮（Ctrl/Cmd+J）、Context Panel 切换、设置图标
  - Changed files 数量徽章（在 Diffs tab 上）
  - Running processes 数量徽章（在 Processes tab 上）
- [ ] **Tab 状态管理**
  - Store: `activeTab: "chat" | "diff" | "terminal" | "processes"`
  - Tab 切换联动（切回 chat 时自动滚到底部）
- [ ] **Session 工作区布局**
  - Tab 内容区域根据 activeTab 条件渲染
  - 保持非活跃 Tab 状态（切换回来不丢失状态）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/src/components/TopBar.tsx` | TopBar 完整实现 |
| `web/src/store.ts` | activeTab、chatTabReentryTick 状态 |
| `web/src/App.tsx` | Session 工作区布局，Tab 内容路由 |

---

## T3: Diff 查看器

### 背景

当 Claude Code 编辑文件时，用户目前只能通过实时预览看到结果，
无法清楚地看到"改了什么"。Diff 视图让用户可以审查所有文件变更。

### 功能目的

提供 Git diff 视图，显示工作区中所有文件的变更状态和具体 diff 内容。

### 细项清单

#### Server 端

- [ ] **Git Changed Files API**
  - `GET /api/git/changed-files?cwd=...&base=...` — 调用 `git status --porcelain`
  - 返回文件列表及状态（Created / Modified / Deleted）
  - 支持两种 diff base：last-commit（默认）、default-branch
- [ ] **Git Diff API**
  - `GET /api/git/diff?cwd=...&path=...&base=...` — 获取单文件 unified diff
  - 调用 `git diff` 或 `git diff HEAD` 获取内容

#### Frontend 端

- [ ] **DiffPanel 组件**
  - 左侧文件列表：文件名 + 状态徽章（Created 绿色 / Modified 黄色 / Deleted 红色）
  - 右侧 diff 内容：unified diff 格式渲染
  - diff base 切换（last-commit / default-branch）
  - 自动选中第一个文件
  - 变更文件数量更新到 TopBar 徽章
- [ ] **DiffViewer 组件**
  - 行级 diff 渲染（增加行绿色、删除行红色）
  - 行号显示
  - 可考虑用 `diff2html` 库简化实现

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/routes/git-routes.ts` | Git API 路由 |
| `web/server/git-utils.ts` | Git 命令封装 |
| `web/src/components/DiffPanel.tsx` | Diff 面板主组件 |
| `web/src/components/DiffViewer.tsx` | Diff 内容渲染 |
| `web/src/store.ts` | diffBase、diffPanelSelectedFile、gitChangedFilesCount |

---

## T4: 内嵌终端

### 背景

用户经常需要在工作区里运行命令（安装依赖、git 操作、调试等），
目前需要切换到外部终端。内嵌终端让用户在应用内直接操作。

### 功能目的

提供基于 xterm.js 的内嵌终端，支持完整的 PTY shell 交互。

### 细项清单

#### Server 端

- [ ] **TerminalManager**
  - `spawn(cwd, cols, rows)` — 使用 Bun PTY API 创建终端进程
  - `kill(id)` — 终止终端
  - `addBrowserSocket(id, ws)` / `removeBrowserSocket(id, ws)` — 管理浏览器连接
  - PTY 输出转发到所有连接的浏览器
  - 浏览器输入转发到 PTY stdin
  - 支持 resize（cols/rows 变化时同步到 PTY）
  - 孤儿终端清理（5 秒无浏览器连接后自动 kill）
  - TERM 环境变量设为 `xterm-256color`
- [ ] **Terminal WebSocket 端点**
  - `/ws/terminal/:terminalId` — 二进制帧传输
  - 消息类型：`input`（用户输入）、`resize`（终端大小）、`exit`（进程退出）
- [ ] **Terminal API**
  - `POST /api/terminal/spawn` — 创建终端
  - `POST /api/terminal/kill` — 关闭终端

#### Frontend 端

- [ ] **TerminalView 组件**
  - xterm.js 终端渲染
  - xterm-addon-fit（自动适配容器大小）
  - WebSocket 连接管理
  - 输入/输出双向绑定
- [ ] **Shell Tab**
  - Tab 内嵌入 TerminalView
  - 使用当前 session 的 cwd 启动
- [ ] **Quick Terminal（可选）**
  - Ctrl/Cmd+J 快速打开/关闭
  - 底部 Dock 布局
  - 多 Tab 终端支持

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/terminal-manager.ts` | TerminalManager 类，PTY 管理 |
| `web/src/components/TerminalView.tsx` | xterm.js 集成 |
| `web/src/components/SessionTerminalDock.tsx` | Session 内 Dock 终端 |
| `web/src/components/TerminalPage.tsx` | 独立终端页面 |
| `web/src/terminal-ws.ts` | 终端 WebSocket 客户端 |
| `web/src/store.ts` | terminalOpen、quickTerminalOpen 等状态 |

---

## T5: Context Panel（右侧边栏）

### 背景

用户在使用过程中需要查看 API 用量、MCP 服务器状态、Git 分支信息、
Claude 任务列表等上下文信息。当前这些信息没有显示。

### 功能目的

提供可折叠的右侧面板，模块化显示各种上下文信息。

### 细项清单

- [ ] **TaskPanel 容器**
  - 可折叠/展开的右侧面板
  - 模块化 Section 系统（可启用/禁用/排序）
  - 每个 Section 独立的错误边界
  - Section 配置持久化到 localStorage
- [ ] **Usage Limits Section**
  - 显示 5 小时 / 7 天 API 用量
  - 进度条（绿/黄/红色根据用量比例变化）
  - 额外用量显示
  - 重置倒计时
  - 从 CLI 的 `system` 消息中提取用量数据
- [ ] **MCP Servers Section**
  - 显示已配置的 MCP 服务器列表
  - 状态指示（Connected / Connecting / Failed / Disabled）
  - 启用/禁用切换
  - 重连按钮
  - 可展开查看 tools 列表
  - 通过 WebSocket 控制（`mcp_get_status` / `mcp_toggle` / `mcp_reconnect`）
- [ ] **Tasks Section**
  - 显示 Claude Code 的 task 列表
  - 任务状态（pending / in_progress / completed）
  - 从 CLI 的 `system` 消息（`subtype: task`）中提取
- [ ] **Git Section（基础）**
  - 当前分支名称
  - 可选：ahead/behind 计数
  - 可选：worktree 状态

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/src/components/TaskPanel.tsx` | 右侧面板主组件 |
| `web/src/components/task-panel-sections.ts` | Section 定义和配置 |
| `web/src/components/McpPanel.tsx` | MCP 服务器面板 |
| `web/server/usage-limits.ts` | 用量限额获取 |
| `web/src/store.ts` | taskPanelOpen、taskPanelConfig、sessionTasks、mcpServers |

---

## T6: Composer 增强

### 背景

当前的 ChatInput 只是一个简单的 textarea + 发送按钮。Companion 的 Composer
提供了模型切换、图片附件、Slash 命令等丰富功能。

### 功能目的

增强消息输入体验，让用户能切换模型、附带图片、快速使用命令和保存的提示词。

### 细项清单

- [ ] **模型切换器**
  - Dropdown 显示可用模型（Opus / Sonnet / Haiku）
  - 切换模型通过 WebSocket 发送 `set_model` 消息
  - 显示当前使用的模型
- [ ] **图片附件**
  - 粘贴图片（Ctrl/Cmd+V）
  - 拖拽图片到输入框
  - 文件选择按钮（"+"）
  - Base64 内联编码
  - 图片预览缩略图
  - 删除已附加的图片
- [ ] **Slash 命令菜单**
  - 输入 `/` 触发自动完成菜单
  - 列出 session 可用的 slash commands 和 skills
  - 方向键导航 + Enter 选择
  - 模糊匹配过滤
- [ ] **@Mention 菜单**
  - 输入 `@` 触发提示词引用菜单
  - 列出保存的 prompts
  - 选择后插入 prompt 内容
- [ ] **Save Prompt 对话框**
  - 从当前输入内容保存为 prompt
  - 设置名称和作用域（global / project）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/src/components/Composer.tsx` | Composer 完整实现 |
| `web/src/components/ModelSwitcher.tsx` | 模型选择器 |
| `web/src/utils/image.ts` | 图片处理工具 |
| `web/src/ws.ts` | sendToSession()，发送带图片的消息 |

---

## T7: Prompts 系统

### 背景

用户经常重复使用相同的指令模式（如"重构这个函数"、"添加测试"等）。
Prompts 系统让用户保存和快速复用这些指令。

### 功能目的

提供提示词的 CRUD 管理，支持全局和项目级别的作用域，
可通过 Composer 的 @mention 快速引用。

### 细项清单

#### Server 端

- [ ] **PromptManager**
  - `SavedPrompt` 数据结构：id, name, content, scope (global|project), projectPath, createdAt, updatedAt
  - `listPrompts(cwd?, scope?)` — 列出匹配的 prompts
  - `getPrompt(id)` — 获取单个
  - `createPrompt(data)` — 创建
  - `updatePrompt(id, data)` — 更新
  - `deletePrompt(id)` — 删除
  - 存储位置：`~/.pneuma/prompts.json`
- [ ] **Prompt Routes**
  - `GET /api/prompts` — 列出（可选 cwd、scope 过滤）
  - `POST /api/prompts` — 创建
  - `PUT /api/prompts/:id` — 更新
  - `DELETE /api/prompts/:id` — 删除

#### Frontend 端

- [ ] **PromptsPage 组件**
  - Prompt 列表（搜索/过滤）
  - 创建/编辑/删除操作
  - Scope 选择器（Global / Project）
  - 从 Sidebar 导航进入
- [ ] **Composer 集成**
  - `@` 触发 prompt 引用菜单
  - 选择后将 prompt 内容插入输入框

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/prompt-manager.ts` | PromptManager，CRUD + 存储 |
| `web/server/routes/prompt-routes.ts` | Prompt API 路由 |
| `web/src/components/PromptsPage.tsx` | Prompts 管理页面 |
| `web/src/components/Composer.tsx` | @mention 集成部分 |

---

## T8: Settings 页面

### 背景

用户需要一个集中的地方来管理应用偏好设置，包括主题、通知、默认模型等。

### 功能目的

提供统一的设置页面，持久化用户偏好。

### 细项清单

#### Server 端

- [ ] **SettingsManager**
  - `PneumaSettings` 数据结构：theme, defaultModel, defaultPermissionMode, ...
  - `getSettings()` / `updateSettings(partial)`
  - 存储位置：`~/.pneuma/settings.json`
- [ ] **Settings Routes**
  - `GET /api/settings` — 获取
  - `PUT /api/settings` — 更新

#### Frontend 端

- [ ] **SettingsPage 组件**
  - 分区导航（IntersectionObserver 滚动定位）
  - **General**：全局主题切换（dark/light）
  - **Notifications**：通知声音开关、桌面通知开关
  - **Defaults**：默认模型、默认权限模式
  - 从 Sidebar 导航进入

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/settings-manager.ts` | SettingsManager |
| `web/server/routes/settings-routes.ts` | Settings API 路由 |
| `web/src/components/SettingsPage.tsx` | Settings 页面 UI |
| `web/src/store.ts` | darkMode、notificationSound 等状态 |

---

## T9: 后台进程追踪

### 背景

Claude Code 的 Bash 工具可以启动后台进程（`run_in_background`），
用户需要知道有哪些进程在运行，以及它们的状态。

### 功能目的

追踪 Claude Code 启动的后台任务，提供进程列表和管理操作。

### 细项清单

- [ ] **Process 数据提取**
  - 从 CLI 的 `tool_progress` 和 `stream_event` 消息中提取后台进程信息
  - `ProcessItem` 数据结构：id, taskId, toolUseId, status, command, cwd, startedAt, duration
  - 进程状态：pending → running → completed / failed
- [ ] **Processes Tab**
  - 进程列表：命令、状态、运行时长、工作目录
  - Kill 进程操作
  - Kill All 操作
  - 系统进程扫描（可选，15 秒轮询）
- [ ] **Server API**
  - `GET /api/sessions/:id/processes/system` — 系统进程列表
  - `POST /api/sessions/:id/processes/:taskId/kill` — 杀进程

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/src/components/ProcessPanel.tsx` | 进程面板 UI |
| `web/src/store.ts` | sessionProcesses Map，addProcess/updateProcess actions |
| `web/src/types.ts` | ProcessItem 类型 |

---

## T10: Session 自动命名

### 背景

新建 Session 默认只有 UUID，用户很难区分多个 Session。
根据第一轮对话内容自动生成有意义的名称可以大大改善体验。

### 功能目的

在用户发送第一条消息并收到回复后，自动给 Session 生成一个简短的描述性名称。

### 细项清单

- [ ] **Auto-Namer 服务**
  - 在第一轮对话完成（result 消息到达）后触发
  - 使用 LLM API 生成 3-5 词的 session 标题
  - 提示词：从首条用户消息截取 500 字符，要求生成简短标题
  - 超时 15 秒，静默失败
  - 输出清理：去除引号，最长 100 字符
- [ ] **触发机制**
  - `wsBridge.onFirstTurnCompleted()` 回调
  - 跳过已手动重命名的 session
- [ ] **简化方案（备选）**
  - 不依赖外部 API，直接截取首条消息前 30 个字符作为名称
  - 或使用 session 内的 Claude 来生成名称

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/auto-namer.ts` | 自动命名逻辑（OpenRouter 调用） |
| `web/server/session-names.ts` | 随机名称生成（形容词 + 名词） |
| `web/src/utils/names.ts` | 前端名称工具 |

---

## S1: Git 集成（高级）

### 背景

Companion 提供了完整的 Git 集成，包括分支管理、worktree 操作、GitHub PR 追踪等。
基础的 Git diff 功能在 T3 中实现；这里记录更高级的 Git 功能。

### 功能目的

深度集成 Git 工作流，让用户在应用内完成分支管理和代码审查。

### 细项清单

- [ ] Branch picker（分支切换）
- [ ] Git fetch / pull 操作
- [ ] Worktree 创建/管理
- [ ] GitHub PR 状态追踪（检查状态、review 状态）
- [ ] PR 状态轮询（pr-poller）
- [ ] Context Panel 中的 Git 信息（ahead/behind、行变更统计）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/git-utils.ts` | Git 命令封装（branch, fetch, pull, worktree） |
| `web/server/routes/git-routes.ts` | Git API 路由 |
| `web/server/worktree-tracker.ts` | Worktree 追踪 |
| `web/server/session-git-info.ts` | Session Git 信息解析 |
| `web/server/github-pr.ts` | GitHub PR 状态获取 |
| `web/server/pr-poller.ts` | PR 状态轮询 |
| `web/src/components/BranchPicker.tsx` | 分支选择器 UI |

---

## S2: Authentication

### 背景

Companion 支持远程访问（局域网或公网），因此需要认证机制。
Pneuma 目前只支持本地使用，暂不需要认证。

### 功能目的

保护应用访问安全，支持 Token 认证、QR 码登录等。

### 细项清单

- [ ] Token 生成和存储（`~/.pneuma/auth.token`）
- [ ] Token 验证中间件（Bearer header + httpOnly cookie）
- [ ] Localhost 自动认证（免 token）
- [ ] QR 码生成（局域网地址 + token 编码）
- [ ] 登录页面
- [ ] Token 管理（查看、重新生成）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/auth-manager.ts` | Token 管理 |
| `web/src/components/LoginPage.tsx` | 登录页面 |
| `web/src/components/SettingsPage.tsx` | Token 管理（Authentication 区域） |

---

## S3: Docker / Containers

### 背景

Companion 支持在 Docker 容器中运行 Claude Code，提供工作区隔离和可复现的环境。

### 功能目的

提供容器化的 Claude Code 执行环境，支持自定义镜像、端口映射、卷挂载等。

### 细项清单

- [ ] Docker daemon 状态检测
- [ ] 容器生命周期管理（创建/启动/停止/删除）
- [ ] Environment 配置（Dockerfile、端口、卷、init 脚本）
- [ ] 镜像拉取管理（进度追踪）
- [ ] 容器内 CLI 执行（docker exec）
- [ ] 认证信息注入（~/.claude 挂载）
- [ ] 容器状态持久化（重启后恢复）
- [ ] EnvManager UI（创建/编辑/删除环境）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/container-manager.ts` | ContainerManager 类 |
| `web/server/image-pull-manager.ts` | 镜像拉取管理 |
| `web/server/env-manager.ts` | 环境配置 |
| `web/server/routes/env-routes.ts` | 环境 API |
| `web/server/claude-container-auth.ts` | 容器认证 |
| `web/src/components/EnvManager.tsx` | 环境管理 UI |

---

## S4: Agents 系统

### 背景

Companion 支持定义自动化 Agent，可以通过定时任务、Webhook 或手动触发来执行预定义的 prompt。

### 功能目的

让用户定义可重复执行的 Agent 配置，支持自动化工作流。

### 细项清单

- [ ] Agent 配置存储（`~/.pneuma/agents/{id}.json`）
- [ ] Agent CRUD API
- [ ] Agent 执行器（创建 session、发送 prompt、追踪结果）
- [ ] 触发方式：定时（cron）、Webhook、手动
- [ ] MCP 服务器配置（每 Agent 独立）
- [ ] Skill 分配
- [ ] 执行历史追踪（最近 50 条）
- [ ] Agent 导入/导出
- [ ] AgentsPage UI

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/agent-store.ts` | Agent 配置存储 |
| `web/server/agent-executor.ts` | Agent 执行器 |
| `web/server/routes/agent-routes.ts` | Agent API |
| `web/src/components/AgentsPage.tsx` | Agent 管理 UI |

---

## S5: Cron Jobs

### 背景

在 Agents 系统之前，Companion 有独立的 Cron Jobs 功能。现已部分迁移到 Agents。

### 功能目的

定时执行 Claude Code 任务。

### 细项清单

- [ ] Cron 作业存储
- [ ] Cron 调度器（croner 库）
- [ ] 作业启用/禁用
- [ ] 执行历史
- [ ] 连续失败自动禁用（5 次）
- [ ] CronManager UI

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/cron-store.ts` | Cron 存储 |
| `web/server/cron-scheduler.ts` | 调度执行 |
| `web/server/routes/cron-routes.ts` | Cron API |
| `web/src/components/CronManager.tsx` | Cron 管理 UI |

---

## S6: Integrations (Linear / GitHub)

### 背景

Companion 集成了 Linear（项目管理）和 GitHub（PR 追踪），
让用户可以在会话中关联任务和代码审查。

### 功能目的

将外部工具的上下文引入 Claude Code 工作流。

### 细项清单

- [ ] Linear API 集成（搜索 Issue、获取详情、状态转换）
- [ ] Linear Issue 关联到 Session
- [ ] Session 完成后自动转换 Issue 状态
- [ ] GitHub PR 状态获取（via git branch 匹配）
- [ ] PR 状态轮询
- [ ] Context Panel 中显示 Linear Issue 和 PR 信息
- [ ] IntegrationsPage / LinearSettingsPage UI

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/routes/linear-routes.ts` | Linear API |
| `web/server/linear-cache.ts` | Linear 数据缓存 |
| `web/server/linear-project-manager.ts` | 项目映射 |
| `web/server/session-linear-issues.ts` | Session-Issue 关联 |
| `web/server/github-pr.ts` | GitHub PR |
| `web/server/pr-poller.ts` | PR 轮询 |
| `web/src/components/LinearSettingsPage.tsx` | Linear 设置 |
| `web/src/components/IntegrationsPage.tsx` | 集成概览 |

---

## S7: Recording / Replay

### 背景

Companion 可以录制 Session 的完整消息流，用于调试和回放。

### 功能目的

录制和回放 Session 的所有通信，用于调试协议问题或演示。

### 细项清单

- [ ] RecorderManager（每 session 录制器）
- [ ] JSONL 格式录制（方向、通道、时间戳、原始消息）
- [ ] 录制上限（全局 100k 行，单 session 10k 行）
- [ ] 回放系统（重新注入录制的消息）
- [ ] API：开始/停止录制、列出录制

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/recorder.ts` | RecorderManager + SessionRecorder |
| `web/server/replay.ts` | 回放逻辑 |
| `web/server/ws-bridge-replay.ts` | WsBridge replay 集成 |

---

## S8: Update Checker

### 背景

发布到 npm 后，需要通知用户有新版本可用。

### 功能目的

检查 npm registry 是否有新版本，提供更新安装功能。

### 细项清单

- [ ] 定期检查 npm registry（1 小时缓存）
- [ ] 版本比较（semver）
- [ ] UpdateBanner 组件（显示可更新提示）
- [ ] 一键更新（`bun install -g pneuma-skills`）
- [ ] UpdateOverlay 组件（更新进度）

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/update-checker.ts` | 版本检查 + 安装 |
| `web/src/components/UpdateBanner.tsx` | 更新提示条 |
| `web/src/components/UpdateOverlay.tsx` | 更新进度 |

---

## S9: Service Mode

### 背景

Companion 可以作为系统服务运行（macOS launchd / Linux systemd），
实现开机自启和后台常驻。

### 功能目的

让应用以守护进程方式运行，不需要保持终端窗口打开。

### 细项清单

- [ ] launchd plist 生成和安装（macOS）
- [ ] systemd unit 生成和安装（Linux）
- [ ] 服务启动/停止/重启
- [ ] 日志管理（`~/.pneuma/logs/`）
- [ ] 更新后自动重启

### Companion 源码参考

| 文件 | 作用 |
|------|------|
| `web/server/update-checker.ts` | Service mode 检测和重启逻辑 |

---

## 附录：Companion 关键架构模式

### 双 WebSocket 通道

```
Browser ──JSON──► WsBridge ──NDJSON──► Claude Code CLI
Browser ◄──JSON── WsBridge ◄──NDJSON── Claude Code CLI
```

- CLI 消息格式：NDJSON（每条消息以 `\n` 结尾）
- Browser 消息格式：标准 JSON
- WsBridge 负责格式转换和路由

### Session 双 ID 系统

- **Server Session ID**（UUID）：路由用，WsBridge 和 API 使用
- **CLI Session ID**：Claude Code 内部 session ID，用于 `--resume`

### 状态持久化策略

| 数据 | 存储位置 | 策略 |
|------|----------|------|
| Session 状态 | `~/.pneuma/sessions/` | 150ms debounced write |
| CLI 进程信息 | `launcher.json` | 每次变更立即写入 |
| 设置 | `settings.json` | 每次变更立即写入 |
| Prompts | `prompts.json` | 每次变更立即写入 |
| Agents | `agents/{id}.json` | 每次变更立即写入 |
| UI 状态 | localStorage | Zustand persist |

### Event Buffer + Replay

- 每个 session 维护最多 600 条 event buffer
- 每条 event 有 sequence number
- 浏览器重连时通过 `session_subscribe(lastSeq)` 请求重放
- 浏览器通过 `session_ack(seq)` 确认已收到
- 历史消息通过 session store 的 messageHistory 恢复

### Message Dedup

- 浏览器消息携带 `clientMsgId`
- WsBridge 缓存最近 1000 个已处理的 clientMsgId
- 重复消息静默丢弃

### 进程恢复

1. 服务器启动 → 从磁盘加载 session 和 launcher 状态
2. 检查每个 PID 是否存活（`process.kill(pid, 0)`）
3. 存活的标记为 "starting"（等待 WebSocket 重连）
4. 30 秒内未重连的标记为 "exited"
5. 浏览器连接时检测到 CLI 已断线 → 自动 relaunch
