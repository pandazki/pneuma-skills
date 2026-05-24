# Documentation

Pneuma Skills 的文档分两类：**活文档**（与代码同步演进）和**取证档案**（写完就冻结，记载决策与历史）。

## Single source of truth — 根文件

`README.md` / `README.zh.md` / `CLAUDE.md` / `AGENTS.md` 是项目的事实基线，每次发版同步更新。新人按以下顺序进入：

| 顺序 | 文件 | 受众 |
|------|------|------|
| 1 | [`README.md`](../README.md) | 人类——项目是什么、怎么装、怎么用（[中文](../README.zh.md)） |
| 2 | [`CLAUDE.md`](../CLAUDE.md) | Claude Code 读取的项目指引——哲学、架构、契约、known gotchas |
| 3 | [`AGENTS.md`](../AGENTS.md) | Codex / Kimi 读取的同一份指引（手动与 `CLAUDE.md` 同步） |

`docs/` 下的所有内容都是补充材料。**实现细节让代码自己说话**——文档只在它能讲哲学、架构、契约的地方动笔。

## 目录布局

```
docs/
├── reference/     长期有效的契约层参考（持续维护）
├── adr/           历史架构决策（不可变，只追加 supersession 标记）
├── migration/     版本迁移指南（被引用即保留）
├── i18n/          翻译哲学与术语表
├── images/        README 与文档图片资源
└── archive/       已完成使命的历史文档（取证用，不删）
    ├── proposals/       已实现的设计提案 + superpowers-plans/ + superpowers-specs/
    ├── work-summaries/  已合并的里程碑工作记录
    └── legacy/          早期草稿、架构审查迭代、被替代的版本
```

## 活文档

### reference/ — 契约层参考

围绕 `core/types/` 的契约与运行时拓扑给出有 narrative 的视角；契约本身在代码里，参考文档解释为什么这样切、各角色怎么互动。

| 文档 | 说明 |
|------|------|
| [`viewer-agent-protocol.md`](reference/viewer-agent-protocol.md) | Viewer–Agent–Server 三方协议：6 个通信方向 / Sources 抽象 / ViewerAddress 对象寻址 / 注入到 instructions 的 marker blocks |
| [`network-topology.md`](reference/network-topology.md) | 端口分配 / WS 路由 / 进程拓扑 / 环境变量传递链 |
| [`controlled-state-surface.md`](reference/controlled-state-surface.md) | 3.0 受控状态的三层同心圆：global (`~/.pneuma/`) → project (`<root>/.pneuma/`) → session (`<sessionDir>/`) |

### migration/ — 跨版本迁移

| 文档 | 说明 |
|------|------|
| [`2.29-source-abstraction.md`](migration/2.29-source-abstraction.md) | Viewer 从直接消费 `files: ViewerFileContent[]` 迁到 `Source<T>` 抽象的实操指南——仍被 mode 作者引用 |

### i18n/ — 翻译

| 文档 | 说明 |
|------|------|
| [`translation-guide.md`](i18n/translation-guide.md) | 产品级翻译哲学与多语言术语表（受众：翻译者/贡献者） |

> 实现层的 i18n 工作流见 [`src/i18n/TRANSLATION_GUIDE.md`](../src/i18n/TRANSLATION_GUIDE.md)（受众：开发者）。

## 历史档案

### adr/ — 架构决策记录

14 份 ADR 覆盖 2026-02 起的关键决策——整体架构、WebSocket、Backend 集成、Skill 安装、文件监听、Session 管理、权限、CLI、Slide MVP、Backend Registry、History 重放、用户偏好。每份独立成文，状态流转 `Proposed → Accepted → Deprecated/Superseded`，**不修改正文**，只追加 supersession note。

→ [ADR 索引](adr/README.md)

### archive/ — 已完成使命

- **`archive/proposals/`** — 已实现或被取代的设计提案。包括 3.0 项目层、Handoff 协议、ClipCraft 系列计划、Kimi backend 等。
  - `archive/proposals/superpowers-plans/` — 实施层计划（已落地）
  - `archive/proposals/superpowers-specs/` — 设计层 spec（已落地）
- **`archive/work-summaries/`** — 完成的里程碑工作记录（kami、webcraft 等）
- **`archive/legacy/`** — 早期草稿、架构审查迭代（v1/v2/v3）、被替代的契约版本

## 管理规则

| 维度 | 规则 |
|------|------|
| 篇幅 | 留给概念、领域模型、架构、契约；实现细节交还给代码 |
| 维护 | reference/ 与 migration/ 与代码同步演进；ADR 写完冻结；archive/ 不再改 |
| 归档 | 设计文档落地后立刻 `git mv` 到 `archive/proposals/` |
| 删除 | 仅删除真正无价值的草稿——历史决策即便被推翻也归档而非删除 |

**新增文档前先问：**这是契约（→ `reference/`）、决策（→ `adr/`）、迁移（→ `migration/`）、还是会落地的提案（→ 完成后 `archive/proposals/`）？都不是，就别写。
