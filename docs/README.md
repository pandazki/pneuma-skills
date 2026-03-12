# Documentation Index

> Pneuma Skills v2.x 文档体系

## 核心文档（始终保持与代码同步）

| 文档 | 位置 | 说明 |
|------|------|------|
| **CLAUDE.md** | `/CLAUDE.md` | 项目主文档：架构、API、约定、结构 |
| **AGENT.md** | `/AGENT.md` | Agent 工作指引：runtime contract、feature gating、文档策略 |
| **README.md** | `/README.md` | 用户面向：安装、使用、功能介绍 |
| **CHANGELOG.md** | `/CHANGELOG.md` | 版本发布记录 |

## 架构决策记录 (ADR)

历史性文档，记录关键架构决策的背景、方案对比和影响。不随实现演进而修改。

→ [ADR 索引](./adr/README.md)

| 阶段 | ADR | 核心决策 |
|------|-----|---------|
| **v1 基础** | ADR-001 ~ 011 | 整体架构、WebSocket 协议、Mode 插件、Skill 安装、Session、权限、文件监听 |
| **v2 抽象** | ADR-012 | Backend Registry — 启动时选择 backend、能力 gating、session 标准化 |

## 设计文档（实现参考）

| 文档 | 状态 | 说明 |
|------|------|------|
| [visual-design-spec.md](./visual-design-spec.md) | **已实现** | "Ethereal Tech" 视觉设计规范 |
| [network-topology.md](./network-topology.md) | **已实现** | 端口分配、通信拓扑、环境变量 |
| [cron-protocol.md](./cron-protocol.md) | **已实现** | Claude Code Cron 协议逆向文档 |

## 提案文档（设计 → 实现追踪）

| 文档 | 状态 | 说明 |
|------|------|------|
| [proposal-v2-evolution-agent.md](./proposal-v2-evolution-agent.md) | **已实现** | Evolution Agent 设计 — CLI + API + Evolve mode viewer |
| [mode-proposals-2026.md](./mode-proposals-2026.md) | **部分实现** | 三个 Mode 提案：`webcraft`（原 site）已实现，`chart` / `flow` 待实现 |

## 工作记录

| 文档 | 说明 |
|------|------|
| [work-summary-loop-integration.md](./work-summary-loop-integration.md) | Cron/Loop 集成工作记录 |

## 归档 (archive/)

历史文档，已被后续设计替代或合并。保留作为决策演进参考。

| 文档 | 被替代为 |
|------|---------|
| `draft.md` | CLAUDE.md + ADR 系列 |
| `architecture-review-v1/v2/v3.md` | 迭代审查记录，结论已融入 CLAUDE.md |
| `companion-features-reference.md` | 初期调研参考，不再维护 |
| `phase1-internal-decoupling.md` | 已完成，结论在 ADR-004/005 |
| `proposal-v2-continuous-learning.md` | 被 `proposal-v2-evolution-agent.md` 替代 |
| `slide-skill-upgrade.md` | 已完成合并 |
| `slide-viewer-enhancements.md` | 已完成合并 |
| `viewer-contract-v2.md` | 结论在 ADR-004 + `core/types/viewer-contract.ts` |

## 2.x 里程碑总结

Pneuma 2.0 ~ 2.6 完成了从单一 Claude Code 工具到 **通用 Agent 共创基础设施** 的演进：

1. **Mode 系统成熟** — 7 个内置 Mode（webcraft, doc, slide, draw, illustrate, mode-maker, evolve），外部 Mode 支持（local/github/url/published）
2. **Backend 抽象** — 从 Claude Code 硬绑定到 startup-selectable backend，Codex 已实现
3. **Skill 演进** — Evolution Agent 实现跨会话偏好学习，propose → review → apply 工作流
4. **Launcher 市场化** — 内置/本地/已发布 Mode 浏览，最近会话一键恢复，backend 选择
5. **调度能力** — Cron/Loop 集成，Schedule Panel
6. **桌面应用** — Electron 封装，系统托盘，自动更新
7. **分发基础设施** — R2 快照、Mode 发布、npm CLI

核心架构公式不变：`ModeManifest(skill + viewer + agent_config) × AgentBackend × RuntimeShell`
