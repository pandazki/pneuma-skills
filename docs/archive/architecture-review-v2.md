# Pneuma Skills 架构回顾 v2 — 从 v0.5 到 v1.6

> **日期**: 2026-03-02
> **版本**: v1.6.2
> **范围**: 全面回顾当前架构、已完成的演进、未来最有价值的深入方向

---

## 一、演进回顾：v0.5 → v1.6 的实现路径

v1 架构蓝图（`docs/archive/architecture-review-v1.md`）提出了四阶段演进计划。以下是实际交付情况：

| 蓝图阶段 | 计划 | 实际交付 | 状态 |
|----------|------|---------|------|
| Phase 0 (v0.5) | 单一 Doc Mode，硬编码全链路 | — | ✅ 完成 |
| Phase 1 (v0.6~v0.8) | 内部解耦 — 切开接缝 | ModeManifest / ViewerContract / AgentBackend 三个核心契约定义并实现 | ✅ 完成 |
| Phase 2 (v0.9) | 多 Mode 支持 | Doc + Slide + Draw 三个内置 Mode | ✅ 完成 |
| Phase 3 (v0.9~v1.0) | Agent 抽象 | ClaudeCodeBackend 实现 AgentBackend 接口，协议适配器分离 | ✅ 完成 |
| Phase 4 (v1.0) | 外部 Mode 加载 | 本地路径 + GitHub 仓库 + 缓存，完整实现 | ✅ 完成 |

**所有四个阶段的核心目标均已达成。** 蓝图中预见的每一个抽象接缝都已切开。

### 1.1 超出蓝图的额外交付

| 特性 | 版本 | 说明 |
|------|------|------|
| Draw Mode (Excalidraw) | v1.6.0 | 蓝图未规划，作为第三个 Mode 验证了架构的扩展性 |
| Snapshot 分发 (R2) | v1.3.0 | push/pull 命令，workspace 快照通过 Cloudflare R2 分享 |
| 元素缩略图捕获 | v1.4.0 | 选中元素 SVG 快照，富上下文传递 |
| HTML 自包含导出 | v1.5.0 | 资产内联 + CJK 字体修复 |
| AskUserQuestion UI | v1.6.0 | 交互式选项卡 |
| Init 参数系统 | v1.2.0+ | 交互式参数收集 + 派生参数 + 持久化 |
| 敏感参数保护 | v1.3.0 | snapshot push 时自动清除 sensitive 字段 |

---

## 二、当前架构评估

### 2.1 架构健康度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **契约完整性** | ⭐⭐⭐⭐⭐ | 三个核心契约（ModeManifest / ViewerContract / AgentBackend）定义清晰，类型安全 |
| **关注点分离** | ⭐⭐⭐⭐⭐ | 四层分层严格遵守，无跨层耦合。Manifest 可后端加载、Viewer 可前端加载 |
| **可扩展性** | ⭐⭐⭐⭐⭐ | 三个 Mode 已验证。外部 Mode 加载支持本地/GitHub |
| **代码质量** | ⭐⭐⭐⭐ | TypeScript strict，169 测试（core 64 + server 105）。测试集中在 server 层，前端测试缺失 |
| **通信协议** | ⭐⭐⭐⭐ | Dual WS + NDJSON 翻译 + 序号去重 + 重连回放。成熟可靠 |
| **开发体验** | ⭐⭐⭐⭐ | `bun run dev <mode>` 一行启动。已知的 stale dist/ 和 Vite WS 问题有文档记录 |
| **产品成熟度** | ⭐⭐⭐ | 核心闭环稳定，但缺少错误恢复、多会话、协作等生产级特性 |
| **生态就绪度** | ⭐⭐⭐ | 外部 Mode 加载已实现，但缺少 Mode 开发文档、脚手架、注册表 |

### 2.2 已验证的设计决策

以下决策经过三个 Mode 的实践，被证明是正确的：

**1. Manifest 作为 SSOT（单一事实来源）**

Mode 的所有行为由 `manifest.ts` 声明。CLI 不需要知道具体 Mode 的细节。从 Doc（极简，无 init params）到 Slide（复杂，有 6 个 init params + 派生逻辑 + 条件模板）都能用同一套机制表达。

**2. 以 Claude Code 协议为事实标准**

v1 蓝图的决策——不设计通用 Agent 协议，直接以 Claude Code 为准——被证明完全正确。避免了过早抽象，同时 `AgentBackend` 接口足够薄，未来接入其他 Agent 不会很困难。

**3. Viewer 的三模式设计（view / edit / select）**

三种交互模式的抽象恰到好处：
- `view`: 默认只读预览
- `select`: 点击元素 → 捕获上下文 → 注入用户消息
- `edit`: 行内编辑（目前只有 Doc Mode 实现）

这一抽象成功覆盖了 Markdown 块级编辑、Slide 元素选择、Excalidraw 图形选择三种差异巨大的交互模式。

**4. 文件系统作为通信媒介**

Agent 写文件 → chokidar 监听 → WS 推送 → Viewer 渲染。这个简单直接的 data flow 是整个项目的灵魂。不需要 Agent 理解 UI API，不需要 RPC 调用，不需要状态同步——Agent 只需编辑文件。

### 2.3 待改进的设计问题

#### 问题 1：Manifest 版本化策略缺失

**现状**: Doc Mode v1.0.0，Slide Mode v1.2.0，Draw Mode v1.0.0。三个 Mode 各自定义版本号，但 ModeManifest 接口本身没有版本。

**风险**: 当 ModeManifest 接口新增必填字段时，旧版本的外部 Mode 会在类型检查时通过、运行时崩溃。

**建议**: 在 ModeManifest 中添加 `manifestVersion: number` 字段（不是 mode 版本，是协议版本），Runtime 检查并做兼容性处理。

#### 问题 2：前端状态管理的膨胀

**现状**: `src/store.ts` 单一 Zustand store 管理 30+ 个顶层 key（session, connectionStatus, cliConnected, messages, streaming, activity, files, selection, previewMode, activeFile, modeViewer, gitAvailable, tasks, processes...）。

**风险**: store 已成为 God Object。类型推断变慢，任何状态变化都可能触发不必要的 re-render。

**建议**: 按功能域拆分为独立 store（参考 Zustand 官方的 slice pattern），通过 `useShallow` 优化选择器。优先拆分高频变化的 `messages` 和 `streaming` 状态。

#### 问题 3：错误恢复机制不完整

**现状**: Agent 崩溃 (exit code ≠ 0/143) → 广播错误消息 → 用户手动重启。
文件监听中断 → 静默失败。
WS 断连 → 2s 自动重连，但重连失败无退避策略。

**建议**:
- Agent 崩溃后自动重启（带指数退避 + 最大重试次数）
- 文件监听器添加 error handler + 自动重建
- WS 重连使用指数退避（2s → 4s → 8s → max 30s）

#### 问题 4：模板引擎限制

**现状**: 只支持 `{{key}}` 简单替换和 `{{#key}}...{{/key}}` 单层条件块。没有循环、嵌套条件、表达式。

**影响**: Slide Mode 的 SKILL.md 模板因为不支持嵌套条件，使用了较笨拙的方式处理功能开关。

**建议**: 当前够用。如果未来 Mode 需要更复杂的模板逻辑，考虑引入 Mustache（与当前 `{{}}` 语法兼容）。但不要过早引入。

#### 问题 5：没有 Mode 热切换

**现状**: 每次启动固定一个 Mode。切换 Mode 需要停止进程、重启。

**影响**: 在同一个 workspace 中需要不同 Mode 时（如在 doc 中嵌入 chart），必须启动多个 Pneuma 实例。

**建议**: 这是一个架构决定而非 bug。当前的 Mode = Session 的 1:1 模型是正确的简化。后续如需支持，可考虑多 Tab 模型（每个 Tab 独立 Mode 和 Agent 会话），但代价很高。

---

## 三、后续最有价值的深入方向

### 方向 A：Mode 生态基建 ⭐⭐⭐⭐⭐

**当前状态**: 外部 Mode 加载机制已完整实现（本地 + GitHub），但缺少开发者工具链。

**具体工作**:

1. **Mode 开发脚手架 (`pneuma create-mode <name>`)**
   - 生成标准目录结构：`manifest.ts` + `pneuma-mode.ts` + `viewer/Preview.tsx` + `skill/SKILL.md`
   - 包含类型定义和开发指引
   - 开发服务器：`pneuma dev-mode ./my-mode` 实时预览模式开发

2. **Mode 注册表**
   - `pneuma search <keyword>` 搜索社区 Mode
   - `pneuma install <mode>` 安装到 `~/.pneuma/modes/`
   - 注册表可以是一个简单的 GitHub repo (JSON registry)

3. **Mode 开发文档**
   - ModeManifest 各字段详细说明 + 示例
   - ViewerContract 实现指南
   - Skill 编写最佳实践
   - 从零开发一个 Mode 的教程

**价值**: 这是 Pneuma 从"工具"变为"平台"的关键一步。架构已经就位，缺的是让他人参与的入口。

---

### 方向 B：Agent 多模型支持 ⭐⭐⭐⭐

**当前状态**: 前端有 ModelSwitcher 组件，但底层绑定 Claude Code CLI 的 `--model` 参数。

**具体工作**:

1. **Claude Agent SDK 接入**
   - Claude 官方提供的 Agent SDK (`@anthropic-ai/claude-agent-sdk`) 是更直接的集成路径
   - 绕过 CLI 进程管理，直接 WebSocket 连接
   - 支持更细粒度的能力控制

2. **多 Agent 后端**
   - 实现一个轻量的 `DirectAPIBackend`——直接调用 Anthropic API
   - 对不需要完整 Claude Code 能力（编辑文件、运行命令）的只读 Mode（如 chart 的数据分析）
   - 降低使用门槛（不需要安装 Claude Code CLI）

3. **Agent 能力协商**
   - 不同 Mode 可以声明需要的最小 Agent 能力
   - Runtime 匹配可用的 Backend
   - 示例：Draw Mode 只需要文件编辑 → 轻量 API 调用即可

**价值**: 降低门槛 + 拓宽适用场景。目前 Pneuma 依赖用户安装 Claude Code CLI，这是一个不小的门槛。

---

### 方向 C：Viewer 交互深化 ⭐⭐⭐⭐

**当前状态**: select mode 可以捕获元素并注入上下文，但交互是单向的（选中 → 告诉 Agent）。

**具体工作**:

1. **Agent → Viewer 指令**
   - Agent 生成 `viewer_command`（如 "高亮第 3 页的标题"、"滚动到代码块"）
   - Viewer 执行指令，提供视觉反馈
   - 实现"Agent 能指给你看"的双向交互

2. **协作标注层**
   - Agent 和用户都可以在预览上画标注（圈选、箭头、文字）
   - 标注作为临时覆盖层，不修改源文件
   - 用于讨论设计意图、指出修改位置

3. **实时差异预览**
   - Agent 修改文件时，Viewer 显示 before/after diff overlay
   - 用户可以 approve/reject 局部修改
   - 比当前的"整页刷新"更精细

**价值**: 让 Agent ↔ 用户 的交互从"文字对话"升级为"视觉协作"。这是 Pneuma 相比纯 CLI 的核心差异化。

---

### 方向 D：会话与工作流增强 ⭐⭐⭐

**具体工作**:

1. **会话分支**
   - 从任意消息创建分支（fork point）
   - 支持 A/B 比较不同的 Agent 方案
   - 分支可合并回主干

2. **工作流预设**
   - 定义 Mode 级别的工作流步骤（如 Slide Mode: "创建结构 → 填充内容 → 优化设计"）
   - 每个步骤有预定义的 prompt 和成功条件
   - 引导新用户逐步完成复杂任务

3. **多会话/多 Tab**
   - 同一个浏览器实例管理多个 workspace / mode
   - 每个 Tab 独立的 Agent 会话
   - 支持跨 Tab 的文件引用

**价值**: 提升日常使用效率，适合重度用户。

---

### 方向 E：性能与稳定性 ⭐⭐⭐

**具体工作**:

1. **前端性能优化**
   - 消息列表虚拟化（当前在长会话中滚动卡顿）
   - Streaming 状态细粒度更新（避免整个消息列表 re-render）
   - Store 拆分 + useShallow

2. **大文件处理**
   - 文件内容增量传输（当前每次推送完整文件内容）
   - 二进制文件跳过 WS 传输（只推送路径 + metadata）

3. **错误恢复**
   - Agent 自动重启（带退避）
   - WS 断连指数退避
   - 文件监听器自动重建

4. **端到端测试**
   - Playwright 测试覆盖核心用户路径
   - CI 集成

**价值**: 稳定性是平台信任的基础。当前 186 测试主要覆盖 server 层，前端和 E2E 测试缺失。

---

### 方向排序与建议路径

| 优先级 | 方向 | 理由 |
|-------|------|------|
| **1** | A: Mode 生态基建 | 架构已就绪，缺的是让他人参与的入口。杠杆最大。 |
| **2** | 新 Mode 开发 | 用新 Mode 验证生态工具链，同时扩展产品价值（详见 mode-proposals-2026.md） |
| **3** | C: Viewer 交互深化 | 核心差异化。Agent ↔ 用户 视觉协作是 Pneuma 的独特价值。 |
| **4** | E: 性能与稳定性 | 随用户增长，此项优先级会上升。目前可接受。 |
| **5** | B: Agent 多模型支持 | 降低门槛，但需要等 Claude Agent SDK 稳定。 |
| **6** | D: 会话与工作流 | 锦上添花，优先级可后置。 |

---

## 四、架构健全性自检清单

以下是保持架构健康的持续检查项：

- [ ] **新 Mode 不触碰 server/**：所有 Mode 特定逻辑在 `modes/<name>/` 内闭合
- [ ] **ModeManifest 向后兼容**：新增字段一律可选，带合理默认值
- [ ] **ViewerContract 不依赖运行时**：提取 context 是纯函数，不依赖浏览器 API
- [ ] **AgentBackend 可替换**：ws-bridge 不直接解析 NDJSON，通过 adapter
- [ ] **Store 拆分**：当前 30+ 顶层 key，应按功能域拆分
- [ ] **测试覆盖新增功能**：每个新文件至少有对应测试
- [ ] **Known Gotchas 持续更新**：CLAUDE.md 的 gotchas 随新发现更新

---

## 五、结论

Pneuma Skills 从 v0.5 的"硬编码单 Mode 原型"发展到 v1.6 的"契约驱动、三 Mode、可外部扩展"的平台，完成了一次干净的架构演进。最值得称赞的是：

1. **蓝图兑现率极高** — 四个阶段全部按设计交付，没有半途而废的抽象
2. **三次 Mode 验证** — Doc → Slide → Draw，每次都验证了契约的弹性
3. **无过度工程** — 没有引入不需要的框架、中间件或抽象层
4. **文件系统即协议** — 这个核心设计直觉从 v0.1 保持至今，被证明是正确的

下一阶段的核心命题是从"一个好的工具"变为"一个好的平台"。技术基础已经具备，需要的是生态工具链和更多高价值 Mode 来驱动增长。
