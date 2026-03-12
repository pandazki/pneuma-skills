# Pneuma Skills 架构回顾 v3 — 从 v0.5 到 v1.11

> **日期**: 2026-03-03
> **版本**: v1.11.0
> **范围**: 全面回顾当前架构、v1.7→v1.11 演进、已验证设计、改进方向

---

## 一、演进全景：v0.5 → v1.11

### 1.1 蓝图兑现

v1 架构蓝图（`docs/archive/architecture-review-v1.md`）四阶段演进计划全部完成：

| 蓝图阶段 | 交付 | 状态 |
|----------|------|------|
| Phase 0 (v0.5) | 单一 Doc Mode，硬编码全链路 | ✅ |
| Phase 1 (v0.6~v0.8) | ModeManifest / ViewerContract / AgentBackend 三核心契约 | ✅ |
| Phase 2 (v0.9) | Doc + Slide + Draw 三内置 Mode | ✅ |
| Phase 3 (v0.9~v1.0) | ClaudeCodeBackend 实现 AgentBackend | ✅ |
| Phase 4 (v1.0) | 外部 Mode 加载（本地 + GitHub） | ✅ |

### 1.2 v1.7 → v1.11 新增交付

蓝图之外，v1.7~v1.11 带来了大量超出原始设计的特性：

| 特性 | 版本 | 说明 |
|------|------|------|
| **ViewerContract v2** | v1.7.0 | Agent-Human 对齐协议：FileWorkspaceModel、ViewerAction 执行通道、Viewer 自描述 API |
| **Viewer 四模式** | v1.10~v1.11 | view / edit / select / annotate，三个 Mode 全部实现 |
| **Annotate mode** | v1.10~v1.11 | Slide: iframe popover; Doc: markdown 元素 popover; Draw: Excalidraw 元素 popover |
| **Inline edit mode** | v1.10.0 | Slide: iframe contentEditable 双击编辑 + 自动保存; Doc: CodeMirror 编辑 |
| **User action tracking** | v1.10.0 | pushUserAction() + `<user-actions>` XML 注入 agent 消息 |
| **Workspace scaffold** | v1.10.0 | Mode 声明初始化 action + 确认 UI + 模板创建 |
| **Viewer → Agent 通知** | v1.10.0 | onNotifyAgent + ViewerNotification（如 slide 内容溢出告警） |
| **Slide auto-fit** | v1.10.0 | CSS transform scaling 自动适配溢出 |
| **Shared iframe selection** | v1.10.0 | `core/iframe-selection/` 模块化选择脚本 |
| **@clack/prompts TUI** | v1.8.0 | CLI 现代终端 UI |
| **Auto-update check** | v1.9.0 | npm registry 版本检查 + bunx 自动更新 |
| **`--dev` flag** | v1.10.0 | 强制 dev 模式，避免 stale dist/ |

### 1.3 累计超出蓝图的交付（v1.0~v1.6）

| 特性 | 版本 | 说明 |
|------|------|------|
| Draw Mode (Excalidraw) | v1.6.0 | 第三个 Mode，验证架构扩展性 |
| Snapshot 分发 (R2) | v1.3.0 | push/pull workspace 快照 |
| 元素缩略图捕获 | v1.4.0 | SVG/PNG 快照 + 富上下文 |
| HTML 自包含导出 | v1.5.0 | 资产内联 + CJK 修复 |
| AskUserQuestion UI | v1.6.0 | 交互式选项卡 |
| Init 参数系统 | v1.2.0+ | 交互式参数收集 + 持久化 |
| 敏感参数保护 | v1.3.0 | snapshot 时清除 sensitive 字段 |

---

## 二、当前架构评估

### 2.1 架构健康度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **契约完整性** | ⭐⭐⭐⭐⭐ | 三核心契约 + ViewerContract v2 全部落地，类型安全 |
| **关注点分离** | ⭐⭐⭐⭐⭐ | 四层分层严格遵守，无跨层耦合 |
| **可扩展性** | ⭐⭐⭐⭐⭐ | 三个内置 Mode + 外部 Mode 加载已验证 |
| **交互模型完备度** | ⭐⭐⭐⭐⭐ | View / Edit / Select / Annotate 四模式三个 Mode 全覆盖 |
| **代码质量** | ⭐⭐⭐⭐ | TypeScript strict，208 测试（core 64 + server 144）。前端测试缺失 |
| **通信协议** | ⭐⭐⭐⭐ | Dual WS + NDJSON + 序号去重 + 回放 + Action 执行通道 + Notification 通道 |
| **开发体验** | ⭐⭐⭐⭐ | 一行启动 + auto-update + --dev flag + debug mode |
| **产品成熟度** | ⭐⭐⭐½ | 交互闭环成熟（四模式），缺少错误恢复、E2E 测试 |
| **生态就绪度** | ⭐⭐⭐ | 外部 Mode 加载完整，缺 Mode 开发文档/脚手架/注册表 |

### 2.2 已验证的设计决策

**1. Manifest 作为 SSOT（单一事实来源）** — 经三个 Mode 验证。从极简 Doc（无 init params）到复杂 Slide（6 个 init params + workspace scaffold），同一套机制表达。

**2. 以 Claude Code 协议为事实标准** — `AgentBackend` 接口足够薄，未来接入其他 Agent 无需大改。

**3. Viewer 四模式设计（view / edit / select / annotate）** — 从 v2 的三模式演进为四模式：
- `view`: 只读预览（Excalidraw 支持 pan/zoom）
- `edit`: 行内编辑（Slide iframe contentEditable，Doc CodeMirror，Draw 原生编辑）
- `select`: 元素选择 → 富上下文注入（CSS selector、缩略图、label、nearby text）
- `annotate`: 多元素批注 + popover 评论

四模式抽象成功覆盖了 iframe HTML、CodeMirror markdown、Excalidraw canvas 三种差异巨大的渲染技术。

**4. 文件系统作为通信媒介** — Agent 写文件 → chokidar 监听 → WS 推送 → Viewer 渲染。项目灵魂。

**5. User Action 事件流** — `pushUserAction()` 以 `<user-actions>` XML 形式注入 agent 消息，使 Agent 感知用户操作意图。这补全了"用户 → Agent"的操作感知通道，与 `extractContext` 的"用户视觉焦点 → Agent"互补。

**6. ViewerContract v2 双向对齐** — 感知对齐（extractContext + viewport + screenshot）+ 能力对齐（actions + workspace model）+ 通知通道（ViewerNotification）。三个方向都已有实现。

### 2.3 待改进的设计问题

#### 问题 1：Manifest 版本化策略缺失

**现状**: ModeManifest 接口无版本号。外部 Mode 可能与新版 Runtime 不兼容。

**建议**: 添加 `manifestVersion: number` 字段，Runtime 做兼容性检查。优先级：低（当前无外部 Mode 用户）。

#### 问题 2：前端 Store 膨胀

**现状**: `src/store.ts` 389 行，30+ 顶层 key。

**建议**: 按功能域拆分（session / messages / viewer / files），使用 Zustand slice pattern + useShallow。优先级：中（影响性能和维护性）。

#### 问题 3：错误恢复机制不完整

- Agent 崩溃 → 手动重启（无自动恢复）
- 文件监听中断 → 静默失败
- WS 断连 → 2s 固定重试（无退避）

**建议**: 指数退避 + 自动重启 + error handler。优先级：中。

#### 问题 4：前端 + E2E 测试缺失

**现状**: 208 测试全部在 core/ 和 server/ 层。前端组件无测试。

**建议**: Playwright E2E 覆盖核心路径。优先级：中（随功能增长，回归风险上升）。

---

## 三、核心契约当前状态

### 3.1 三核心契约

| 契约 | 文件 | 版本 | 状态 |
|------|------|------|------|
| ModeManifest | `core/types/mode-manifest.ts` | — | 稳定。skill/viewer/agent/init 四大配置块 |
| ViewerContract | `core/types/viewer-contract.ts` | v2 | 已实现 v2 全部设计：workspace model + action channel + notification |
| AgentBackend | `core/types/agent-backend.ts` | — | 稳定。单一 ClaudeCodeBackend 实现 |

### 3.2 ViewerContract v2 实现清单

| 设计项 | 状态 | 说明 |
|--------|------|------|
| FileWorkspaceModel | ✅ | all (Doc) / manifest (Slide) / single (Draw) |
| ViewerActionDescriptor + 执行通道 | ✅ | POST /api/viewer/action, WS bridge |
| Viewer 自描述 → CLAUDE.md 注入 | ✅ | `<!-- pneuma:viewer-api:start/end -->` |
| ViewerNotification（Viewer → Agent） | ✅ | onNotifyAgent prop, WS 通知消息 |
| viewport tracking | ✅ | onViewportChange prop |
| captureViewport（截图） | ✅ | Slide + Draw 实现 |

### 3.3 ViewerSelectionContext 字段

| 字段 | 添加版本 | Slide | Doc | Draw |
|------|---------|-------|-----|------|
| type, content, file | v1.0 | ✅ | ✅ | ✅ |
| tag, classes, selector | v1.4~v1.10 | ✅ | ✅ | — |
| thumbnail | v1.4 | ✅ | — | ✅ |
| label, nearbyText, accessibility | v1.10 | ✅ | ✅ | ✅ |
| viewport | v1.7 | — | ✅ | — |
| annotations[] | v1.10~v1.11 | ✅ | ✅ | ✅ |

### 3.4 四模式实现矩阵

| Mode | View | Edit | Select | Annotate |
|------|------|------|--------|----------|
| Slide | ✅ 缩放/导航 | ✅ contentEditable + 删除 slide | ✅ CSS selector + 缩略图 | ✅ popover 批注 |
| Doc | ✅ markdown 渲染 | ✅ CodeMirror 编辑 | ✅ 块级选择 + selector | ✅ popover 批注 |
| Draw | ✅ Excalidraw pan/zoom | ✅ 原生编辑 | ✅ 元素选择 + 缩略图 | ✅ popover 批注 |

---

## 四、项目数据

| 指标 | 数值 |
|------|------|
| 版本 | v1.11.0 |
| 内置 Mode | 3（doc, slide, draw）|
| 测试数 | 208（13 个文件）|
| expect() 调用 | 397 |
| Store 行数 | 389 |
| 前端组件 | 17 个 .tsx |
| Server 模块 | 12 个 .ts |
| Mode 源文件 | 13 个 .ts/.tsx |
| ADR 文档 | 11 篇 |

---

## 五、后续方向排序

基于当前架构成熟度和产品阶段，更新后的方向排序：

### 方向 A：新 Mode 开发 ⭐⭐⭐⭐⭐

**理由**: 三个内置 Mode 已经充分验证架构和四模式交互模型。新 Mode 是扩展产品价值的最直接路径。

**优先顺序**（详见 `mode-proposals-2026.md`）：
1. **`site` mode** — Web 原型设计。复用 Slide iframe 基础设施，Agent 写 HTML/CSS/JS 是最自然的场景。~5 天。
2. **`chart` mode** — 数据可视化仪表盘。声明式 JSON + Recharts。~7 天。
3. **`flow` mode** — 工作流/架构图。React Flow + 自动布局。~9 天。

### 方向 B：Mode 生态基建 ⭐⭐⭐⭐

**理由**: 外部 Mode 加载已实现，但缺少让他人参与的入口。

1. `pneuma create-mode <name>` 脚手架
2. Mode 开发文档（ModeManifest 字段说明 + ViewerContract 实现指南 + 从零教程）
3. Mode 注册表（GitHub JSON registry）

**建议**: 与新 Mode 开发交替推进。每做完一个新 Mode，提取通用模式写入文档。

### 方向 C：Viewer 交互深化 ⭐⭐⭐⭐

v1.10~v1.11 已经大幅深化了 Viewer 交互（四模式、user action tracking、notification channel）。下一步：

1. **Agent → Viewer 视觉指令** — Agent 高亮特定元素、滚动到指定位置
2. **实时差异预览** — Agent 修改时显示 before/after overlay
3. **多选支持** — Shift+Click 批量选择

### 方向 D：性能与稳定性 ⭐⭐⭐

1. 消息列表虚拟化（长会话卡顿）
2. Store 拆分 + useShallow
3. 错误恢复（Agent 自动重启、WS 指数退避）
4. Playwright E2E 测试

### 方向 E：Agent 多模型支持 ⭐⭐⭐

1. Claude Agent SDK 接入（绕过 CLI）
2. 轻量 DirectAPIBackend（不需要 Claude Code CLI 的只读场景）
3. Agent 能力协商（Mode 声明最小能力需求）

### 方向 F：会话与工作流 ⭐⭐

1. 会话分支（A/B 比较）
2. 工作流预设（步骤引导）
3. 多 Tab / 多会话

---

## 六、建议下一步

综合当前状态和投入产出比：

**近期（1~2 周）**: site mode 开发
- 复用 Slide iframe 技术栈，最低开发成本
- Web 原型是 Agent 最擅长的输出格式（HTML/CSS/JS）
- 验证新 Mode 的四模式交互模板

**中期（3~4 周）**: chart mode + Mode 开发文档
- chart mode 扩展到数据可视化场景
- 同步输出 Mode 开发指南，为外部贡献者铺路

**持续**: 性能和稳定性改进
- Store 拆分、E2E 测试、错误恢复随迭代推进

---

## 七、结论

Pneuma Skills v1.11 完成了从"单 Mode 原型"到"契约驱动、三 Mode、四交互模式"平台的蜕变。v1.7~v1.11 的核心突破是 **交互模型的完善**：

1. **ViewerContract v2** — 从"渲染契约"升级为"Agent-Human 对齐协议"
2. **四模式交互** — View / Edit / Select / Annotate 三个 Mode 全覆盖
3. **双向感知** — User actions → Agent（pushUserAction）+ Agent → Viewer（notification）
4. **富上下文** — label、nearbyText、accessibility、annotations 全面提升 Agent 理解

下一阶段的核心命题是 **横向扩展**：用新 Mode 验证架构弹性、扩展产品价值、吸引外部贡献者。技术债务可控，架构健康。
