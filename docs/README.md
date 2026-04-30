# Documentation

## 阅读顺序

**新人从这里开始：**

1. **[README.md](../README.md)** — 项目是什么、怎么安装、怎么用（面向人类）
2. **[CLAUDE.md](../CLAUDE.md)** — Agent 项目指引（Claude Code 读取）
3. **[AGENT.md](../AGENT.md)** — Agent 项目指引（Codex / 其他 coding agent 读取）

`CLAUDE.md` 和 `AGENT.md` 是同一角色（agent 项目指引），分别给不同 backend 的 agent 读。三个根文件是 Pneuma 的 **single source of truth**，始终与代码同步。`docs/` 下的所有内容都是补充材料。

## 目录结构

```
docs/
├── design/        正在设计或即将实施的功能
├── reference/     长期有效的技术参考（持续维护）
├── adr/           架构决策记录（历史性，不修改）
└── archive/       完成使命的历史文档
    ├── proposals/       已实现的设计提案
    ├── work-summaries/  已合并的工作记录
    └── legacy/          早期草稿、调研、被替代的文档
```

## 管理规则

| 目录 | 放入时机 | 移出时机 |
|------|---------|---------|
| `design/` | 开始设计一个新功能或新版本 | 功能发布后 → `archive/proposals/` |
| `reference/` | 文档内容长期有效，需要持续维护 | 过时后重写或删除 |
| `adr/` | 做出架构决策时 | 不移动，只标 Deprecated/Superseded |
| `archive/` | 文档完成使命后 | 不移动 |

**关键原则：**
- 根文件（README / CLAUDE.md / AGENT.md）是活文档，每次发版同步更新
- `design/` 里只放当前或下一版在做的东西，不堆积
- 已实现的提案不删除，移入 `archive/proposals/` 保留决策历史
- 工作记录合并后移入 `archive/work-summaries/`，不留在顶层

## 当前活跃文档

### design/

| 文档 | 说明 |
|------|------|
| [pneuma-3.0-design.md](design/pneuma-3.0-design.md) | 3.0 layout 维度：AI-native 微应用平台（`app` 布局 + Agent Bubble）— 独立计划，未启动 |
| [history-sharing-replay.md](design/history-sharing-replay.md) | History 分享 + Replay 整体设计（关联 ADR-013） |
| [2026-03-20-history-export-replay-plan.md](design/2026-03-20-history-export-replay-plan.md) | 上述设计的 Phase 2-4 实现计划：Replay player UI + Continue conversation |
| [2026-04-30-project-onboard.md](design/2026-04-30-project-onboard.md) | Project Onboarding 模式设计（PR #99，合并后归档） |

### reference/

| 文档 | 说明 |
|------|------|
| [viewer-agent-protocol.md](reference/viewer-agent-protocol.md) | Viewer–Agent 协议架构：三方角色、6 个通信方向、契约类型 |
| [network-topology.md](reference/network-topology.md) | 端口分配、通信拓扑、环境变量 |
| [cron-protocol.md](reference/cron-protocol.md) | Claude Code Cron 协议逆向文档 |

### adr/

→ [ADR 索引](adr/README.md) — 12 个架构决策记录（ADR-001 ~ 012）

### archive/

已实现提案：
- [proposal-v2-evolution-agent.md](archive/proposals/proposal-v2-evolution-agent.md) — Evolution Agent 设计（已实现）
- [mode-proposals-2026.md](archive/proposals/mode-proposals-2026.md) — Mode 提案（webcraft 已实现，chart/flow 待定）
- [visual-design-spec.md](archive/proposals/visual-design-spec.md) — Ethereal Tech 视觉规范（已实现）
- [2026-03-20-shadow-git-checkpoints-plan.md](archive/proposals/2026-03-20-shadow-git-checkpoints-plan.md) — Shadow Git Checkpoints（Phase 1，已实现 in 2.x）
- [2026-03-31-user-preference-analysis-design.md](archive/proposals/2026-03-31-user-preference-analysis-design.md) — User Preference Analysis（已实现，对应 ADR-014）
- [2026-04-27-pneuma-projects-design.md](archive/proposals/2026-04-27-pneuma-projects-design.md) — Pneuma 3.0 Project 层（已实现 in 2.41.0）
- [2026-04-28-pneuma-projects-pivot.md](archive/proposals/2026-04-28-pneuma-projects-pivot.md) — Project as in-shell component UX pivot（已实现 in 2.41.0）
- [2026-04-28-handoff-tool-call.md](archive/proposals/2026-04-28-handoff-tool-call.md) — Smart Handoff v2 tool-call protocol（已实现 in 2.41.0）

工作记录：
- [work-summary-loop-integration.md](archive/work-summaries/work-summary-loop-integration.md) — Cron/Loop 集成（已合并）

早期文档：
- `archive/legacy/` — 初期草稿、架构审查迭代、被替代的提案
