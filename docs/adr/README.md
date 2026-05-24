# Architecture Decision Records

> Pneuma Skills 历史架构决策。ADR 一旦写下不再修改——只追加 supersession/deprecated 标记。

## 索引

| ADR | 标题 | 状态 | 日期 |
|-----|------|------|------|
| [ADR-001](./adr-001-overall-architecture.md) | 整体架构与技术栈选型 | Accepted | 2026-02-26 |
| [ADR-002](./adr-002-websocket-protocol.md) | WebSocket 协议与消息桥接 | Accepted | 2026-02-26 |
| [ADR-003](./adr-003-claude-code-backend.md) | Claude Code Backend 集成 | Accepted | 2026-02-26 |
| [ADR-004](./adr-004-content-mode-plugin.md) | Content Mode 插件系统 | Accepted | 2026-02-26 |
| [ADR-005](./adr-005-editor-shell-frontend.md) | Editor Shell 前端架构 | Accepted | 2026-02-26 |
| [ADR-006](./adr-006-skill-installation.md) | Skill 安装机制 | Accepted | 2026-02-26 |
| [ADR-007](./adr-007-file-watching-live-preview.md) | 文件监听与实时预览 | Accepted | 2026-02-26 |
| [ADR-008](./adr-008-session-management.md) | Session 管理与持久化 | Accepted (3.0 起 Project 层 supersede 部分) | 2026-02-26 |
| [ADR-009](./adr-009-permission-flow.md) | Permission Flow 与 Tool 审批 | Accepted | 2026-02-26 |
| [ADR-010](./adr-010-cli-entry-startup.md) | CLI 入口与启动流程 | Accepted | 2026-02-26 |
| [ADR-011](./adr-011-slide-mode-mvp.md) | Slide Mode MVP 详细设计 | Accepted | 2026-02-26 |
| [ADR-012](./adr-012-backend-runtime-abstraction.md) | Backend Registry 与运行时会话抽象 | Accepted | 2026-03-10 |
| [ADR-013](./adr-013-history-sharing-replay.md) | History 分享与重放 | Accepted (实现于 2.x，shadow-git + replay) | 2026-03-20 |
| [ADR-014](./adr-014-user-preference-analysis.md) | 用户偏好分析系统 | Accepted | 2026-03-31 |

## 约定

- 每份 ADR 独立成文：背景、决策、方案对比、影响。状态流转 `Proposed → Accepted → Deprecated/Superseded`。
- ADR 文本不再修订；新决策若推翻旧 ADR，写新 ADR 并在旧 ADR 顶部追加 supersession note。
- 历史性提案与实施计划见 [`../archive/`](../archive/)；契约层与运行时拓扑参考见 [`../reference/`](../reference/)。
