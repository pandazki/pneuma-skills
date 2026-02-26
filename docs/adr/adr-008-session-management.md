# ADR-008: Session 管理与持久化

> **状态**: Accepted (Revised)
> **日期**: 2026-02-26 (初版) / 2026-02-27 (修订)
> **决策者**: Pandazki
> **关联**: ADR-002, ADR-003

---

## 1. 背景

Session 是 Pneuma 中一次编辑会话的上下文，包括与 Claude Code CLI 的连接、消息历史、
权限请求等。需要决定 session 的生命周期模型和持久化策略。

### 修订说明

初版设计参照 Companion 的多 session 模型（`~/.pneuma/sessions/`，SessionStore 类等）。
经过讨论，确认 Pneuma 的使用场景与 Companion 有本质区别：

- Pneuma 是 **内容编辑工具**，每个 workspace 绑定一个 mode（如 doc），任务生命周期较短
- Companion 是 **通用开发工具**，需要并行多个 session 处理不同分支/功能
- 多个 session 同时操作同一批文件容易冲突
- 用户真正需要的是"刷新不丢对话"和"重启能恢复"，不是并行多会话

因此修订为 **单 session 模型 + workspace 本地存储**。

---

## 2. 决策

### 2.1 单 Session 模型

**Pneuma 始终维护单个活跃 session。** 不支持并行多 session。

未来通过 Claude Code 的 `/clear` 命令支持"清空上下文，重新开始"。

### 2.2 Workspace 本地存储

**Session 元信息存储在 `<workspace>/.pneuma/` 目录下**，而非全局 `~/.pneuma/`。

理由：
- 打开一个 workspace 就自动加载该 workspace 的会话状态
- 每个 workspace 自包含，不依赖全局状态
- 与现有的 `.claude/skills/` 模式一致

### 2.3 Session Resume

**支持通过 Claude Code 的 `--resume <cliSessionId>` 恢复会话。**

启动时检查 `.pneuma/session.json`，如果存在且合法，尝试恢复。

---

## 3. 详细设计

### 3.1 存储结构

```
<workspace>/
├── .pneuma/
│   └── session.json          # Session 元信息
├── .claude/
│   └── skills/pneuma-doc/    # Skill 文件（已有）
├── CLAUDE.md                 # Claude Code 配置（已有）
└── *.md                      # 用户内容文件
```

### 3.2 Session 元信息

```typescript
interface PersistedSession {
  sessionId: string;          // Server UUID，用于 WebSocket 路由
  cliSessionId?: string;      // Claude Code 内部 session ID，用于 --resume
  mode: string;               // Content Mode 名称 ("doc")
  createdAt: number;          // 创建时间戳
}
```

只存最少必要的信息。消息历史不持久化——Claude Code 的 `--resume` 会自动恢复
对话上下文（message_history 事件），不需要我们自己存。

### 3.3 启动流程

```
pneuma-skills doc --workspace ~/my-notes
      │
      ▼
[检查 .pneuma/session.json]
      │
      ├─ 存在且有 cliSessionId
      │   └─ claude --resume <cliSessionId> --sdk-url ws://...
      │   └─ 复用 sessionId（WebSocket 路由不变）
      │
      └─ 不存在 / 无 cliSessionId
          └─ claude --sdk-url ws://...（全新 session）
          └─ 生成 sessionId，写入 session.json
      │
      ▼
[CLI 连接后]
      │
      └─ CLI 发送 system/init 消息
         └─ 提取 cliSessionId，更新 session.json
         └─ 如果是 resume，CLI 会自动发送 message_history
      │
      ▼
[运行中]
      │
      └─ 浏览器刷新 → 重连 WebSocket（同一 sessionId）
         └─ WsBridge 自动 replay event buffer
```

### 3.4 浏览器刷新恢复

浏览器刷新时：
1. 从 URL（`?session=<sessionId>`）获取 sessionId
2. 重新建立 WebSocket 连接到 `/ws/browser/<sessionId>`
3. WsBridge 的 `handleBrowserOpen` 自动 replay 缓存的事件
4. 不需要做任何特殊处理

### 3.5 服务器重启恢复

服务器重启时：
1. 读取 `.pneuma/session.json`
2. 用 `--resume <cliSessionId>` 重新 spawn CLI
3. CLI 自动恢复对话上下文
4. 浏览器重连后收到 message_history 事件

### 3.6 Session 失效

以下情况 session 视为失效，需要创建新 session：
- `session.json` 不存在
- `cliSessionId` 不存在（CLI 从未连接成功）
- Claude Code 的 `--resume` 失败（session 过期等）

---

## 4. 关键设计决策

### 4.1 单 Session vs 多 Session

**决策：单 session。**

理由：
- Pneuma 是内容编辑工具，任务生命周期小
- 同 workspace + 同 mode 下，多 session 场景弱
- 多 session 操作同一批文件易冲突
- 未来用 `/clear` 替代"开新 session"的需求

### 4.2 Workspace 本地 vs 全局存储

**决策：存储在 `<workspace>/.pneuma/`。**

理由：
- Workspace 自包含，直接打开即恢复
- 与 `.claude/skills/` 模式一致
- 不需要管理全局状态目录

### 4.3 最小化持久化内容

**决策：只存 sessionId + cliSessionId + mode + createdAt。**

理由：
- 消息历史由 Claude Code 的 `--resume` 自动恢复
- WsBridge 的 event buffer 处理浏览器刷新场景
- 减少存储复杂度，不需要 debounced write

### 4.4 Resume 失败回退

**决策：Resume 失败时静默创建新 session。**

理由：
- 用户不需要关心 resume 的技术细节
- 新 session 的唯一代价是丢失对话历史
- 文件内容不受影响（在磁盘上）

---

## 5. 被否决的方案

### 5.1 多 Session 管理

- 否决原因：Pneuma 的内容编辑场景不需要并行 session
- 替代：单 session + `/clear` 命令

### 5.2 全局存储 (`~/.pneuma/sessions/`)

- 否决原因：需要额外逻辑匹配 workspace → session
- 替代：workspace 本地 `.pneuma/`

### 5.3 完整消息历史持久化

- 否决原因：Claude Code `--resume` 已处理历史恢复
- 减少实现复杂度

---

## 6. 影响

1. **Workspace 下新增 `.pneuma/` 目录** — 需加入 `.gitignore`
2. **单 session** — 不能并行多个编辑任务
3. **Resume 依赖 Claude Code** — 如果 Claude Code 改变 `--resume` 行为需要适配
4. **浏览器刷新无感** — 依赖 WsBridge event buffer（已实现）
