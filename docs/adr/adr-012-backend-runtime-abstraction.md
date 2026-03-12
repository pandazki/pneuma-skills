# ADR-012: Backend Registry 与运行时会话抽象

> **状态**: Accepted
> **日期**: 2026-03-10
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-002, ADR-003, ADR-008, ADR-010

---

## 1. 背景

Pneuma 最初的运行时是深度绑定 Claude Code 的：

- CLI 入口默认直接启动 Claude backend
- session 持久化没有显式记录 backend 身份
- `WsBridge` 和前端状态默认把 Claude 视为唯一 agent
- 一些 UI 能力默认假设所有 backend 都支持 Claude 的行为，例如 model switch、Schedules

这在只有一个 backend 时可以工作，但在接入第二个 backend 前会带来三个问题：

1. **启动路径无法表达 backend 选择**
2. **resume 身份不完整**，无法区分“同一 workspace 的不同 backend”
3. **前端 feature gating 缺失**，Claude-specific 能力会泄漏成全局假设

---

## 2. 决策

### 2.1 引入 backend registry

后端实现通过统一注册表暴露：

- `type`
- `label`
- `description`
- `implemented`
- `capabilities`

CLI 和 launcher 都通过 registry 获取 backend 信息，而不是写死 Claude。

### 2.2 Backend 只允许在启动时选择

Backend 成为 session identity 的一部分：

- CLI 通过 `--backend <type>` 选择
- Launcher launch modal 传递 `backendType`
- `<workspace>/.pneuma/session.json` 持久化 `backendType`
- `~/.pneuma/sessions.json` 持久化 `backendType`

已有 workspace session 必须锁定原 backend，不允许在运行过程中切换。

### 2.3 标准化运行时 session 层

浏览器与大部分服务端逻辑不再直接依赖 backend 私有 wire protocol，而是依赖统一 session 状态：

- `backend_type`
- `agent_capabilities`
- `agent_version`

Claude-specific 字段暂时继续保留兼容，例如 `claude_code_version`，但新的 UI 逻辑优先消费通用字段。

### 2.4 能力通过 capability gating 暴露到 UI

前端不再默认所有 backend 都支持相同能力。

当前至少按 capability 或 backend 身份进行 gating：

- 运行时 model switch
- Schedules tab / SchedulePanel
- Launcher backend picker 的 implemented 状态

---

## 3. 详细设计

### 3.1 Registry 与 descriptor

新增 backend registry，负责：

- 列出所有声明过的 backend
- 标识哪些 backend 已实现
- 提供默认 backend
- 提供 capability defaults
- 统一创建 backend 实例

当前声明：

- `claude-code` — 已实现
- `codex` — 已实现（v2.6.0，JSON-RPC over stdio）

### 3.2 Session 持久化兼容

为了兼容旧 session 文件与 recent sessions 记录：

- 读取旧 `.pneuma/session.json` 时补默认 `backendType`
- 读取旧 `~/.pneuma/sessions.json` 记录时补默认 `backendType`
- 保留旧 `cliSessionId` → `agentSessionId` 迁移逻辑

### 3.3 启动流程约束

normal mode 启动时：

1. 读取已有 workspace session
2. 解析请求的 backendType
3. 如果 workspace 已有 backendType，必须与其一致
4. 创建 backend 实例
5. 启动或 resume backend
6. 在 `WsBridge` 中提前注入 backend 身份

这样浏览器在第一帧 `session_init` 就能拿到正确 backend 身份，而不是默认值。

### 3.4 Claude 路径保持零回归

本次抽象不改变 Claude 的 transport 事实：

- Claude 仍通过 `--sdk-url` 连接 `/ws/cli/:sessionId`
- Claude `system/init` 仍会更新会话模型、工具列表、版本信息
- `agent_version` 会同步自 Claude 的版本字段
- `claude_code_version` 继续保留用于兼容旧 UI / 旧逻辑

### 3.5 UI 能力降级

当前 UI 的策略是：

- 对 capability 为 `false` 的能力，降级显示或禁用交互
- 对 Claude-only 面板，直接隐藏或显示 backend-specific 提示

例如：

- `ModelSwitcher` 在不支持 runtime model switch 时渲染只读 pill
- `TopBar` 对非 Claude backend 隐藏 `Schedules`
- `SchedulePanel` 在非 Claude backend 下显示 unavailable 提示

---

## 4. 被否决的方案

### 4.1 在现有代码里继续硬加 `if backend === "codex"`

- 否决原因：会把 backend 判断散落到 CLI、server、前端各处
- 结果是第二个 backend 刚接入就会形成维护债务

### 4.2 运行时切换 backend

- 否决原因：session resume、message history、pending permissions、transport lifecycle 都会变复杂
- backend 本质上属于 session identity，而不是可热切换 UI 选项

### 4.3 先定义完整的跨-backend 标准 AST

- 否决原因：现阶段只有 Claude 真正落地，先抽完整协议 AST 容易过度设计
- 当前保留较薄的 runtime session/event 层，更适合渐进演进

---

## 5. 影响

正面：

1. 接入第二个 backend 时不需要重写启动链路
2. session resume 身份更完整
3. UI 可以按能力降级，而不是继续绑定 Claude 假设

代价：

1. 旧持久化结构需要兼容回填
2. backend 不能在运行中切换
3. Claude-specific 数据字段会有一段过渡期并存
