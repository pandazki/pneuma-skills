# ADR-014: 用户偏好分析系统

> **状态**: Accepted
> **日期**: 2026-03-31
> **决策者**: Pandazki
> **关联**: ADR-006 (Skill 安装机制)

---

## 1. 背景

Pneuma 的 agent 每次 session 都是无状态的——没有跨 session 的用户记忆。这意味着：

- 用户的审美偏好、协作风格、习惯需要每次重新沟通
- Agent 无法从过去的协作经验中学习
- 深层认知偏好（信息密度、抽象层级、表达风格）完全丢失

现有的 Evolution 系统解决的是 **Skill 层面的演化**（增强/裁剪 Skill 指令），但不涉及用户画像。我们需要一种机制让 agent 拥有关于**这个用户**的持久记忆。

### 设计哲学

这不是一个"系统"，而是一种**能力赋予**。我们不建基础设施、不加 API、不改 Viewer——我们给 agent 一个 Skill 和一组文件约定，让它自己决定何时读取、何时更新。偏好文件是 agent 的外部记忆，不是用户标签数据库。

---

## 2. 决策

### 2.1 存储：`~/.pneuma/preferences/` 纯 Markdown

偏好以 Markdown 文件存储在用户 home 目录下，跨所有 workspace 共享：

```
~/.pneuma/preferences/
├── profile.md              # 跨 mode 的用户画像
├── mode-slide.md           # slide mode 偏好
├── mode-doc.md             # doc mode 偏好
└── ...                     # agent 按需创建
```

- `profile.md`：全局偏好（认知、审美、协作风格）
- `mode-*.md`：per-mode 偏好（mode 名称作为后缀）
- 文件不存在 = 尚未建立画像，静默跳过，不报错
- 目录不存在时由 skill-installer 首次创建（空目录）

### 2.2 能力注入：全局 Skill Dependency

新增 `pneuma-preferences` 作为**全局 Skill Dependency**，由 skill-installer 无条件注入所有 mode：

- 源位置：`modes/_shared/skills/pneuma-preferences/`
- 安装到：`.claude/skills/pneuma-preferences/`（或 `.agents/skills/pneuma-preferences/`，取决于 backend）
- 包含 `SKILL.md`（分析策略）和可选的辅助脚本
- 在 instructions file（CLAUDE.md 或 AGENTS.md）的 skills dependencies section 中列出能力描述

**注入机制**：在 `installSkill()` 中硬编码全局 dependency 列表。这与"不 hardcode mode 知识"的原则不冲突——`pneuma-preferences` 是框架级能力，不是 mode 级知识。类似于 skill-installer 已经硬编码的 `.gitignore` 管理逻辑。

### 2.3 Critical 红线注入

偏好文件中可用 marker 标记硬性约束：

```markdown
<!-- pneuma-critical:start -->
- 永远不要使用深色背景
- 所有文案必须使用简体中文
<!-- pneuma-critical:end -->
```

Skill-installer 在 session 启动时：

1. 读取 `profile.md` 的 critical 区域
2. 读取 `mode-{currentMode}.md` 的 critical 区域
3. 合并后用 `<!-- pneuma:preferences:start/end -->` marker 注入 CLAUDE.md
4. 文件不存在时静默跳过

### 2.4 Agent 自治管理

- Agent 自行决定何时读取偏好文件、何时更新
- 不需要用户感知或确认（但用户问起不隐瞒）
- 偏好文件是**活文档**——全量审视 + 重写，不是追加日志
- 任何条目都可以被后续观察推翻和移除

**并发写入**：多个 session 可能同时运行，理论上可能并发写入同一偏好文件。由于偏好更新是低频操作（非实时数据），且 agent 执行全量重写，这属于可接受的风险——最后写入的版本保留。SKILL.md 中建议 agent 在更新前先读取最新内容，以降低覆盖风险。

### 2.5 全量刷新 + Changelog

偏好文件末尾维护 changelog：

```markdown
<!-- changelog:start -->
## Changelog

- **2026-03-31** — 全量刷新（2026-01 ~ 2026-03，12 sessions）
  - 新增：用户偏好信息密度低的布局
  - 修正：审美倾向从"偏好暖色"改为"偏好低饱和度"
- **2026-03-15** — 日常更新
  - 新增：用户明确要求标题不超过 8 个字
<!-- changelog:end -->
```

- 全量刷新时可利用 evolve mode 的数据脚本（`list-sessions`、`session-digest` 等）扫描历史 session。这些脚本是共享工具，偏好系统引用但不依赖 evolution 流程本身。
- Changelog 的最后日期帮助 agent 判断哪些 session 尚未处理
- 实现增量分析而非每次重复劳动

---

## 3. 详细设计

### 3.1 偏好文件格式

纯 Markdown，agent 全权管理内容结构。系统仅约定两种 marker：

**Critical marker**（启动时提取注入）：
```markdown
<!-- pneuma-critical:start -->
...硬性约束...
<!-- pneuma-critical:end -->
```

**Changelog marker**（agent 维护，用于增量判断）：
```markdown
<!-- changelog:start -->
...更新日志...
<!-- changelog:end -->
```

其余内容完全由 agent 自由组织。

### 3.2 三层偏好模型（SKILL.md 中描述）

**顶层：跨 Mode 显性偏好**
- 语言与表达风格
- 审美倾向
- 协作模式
- 认知风格

**中层：深度画像**
- 能力边界与知识领域
- 价值支点
- 行为模式中的隐含偏好
- 需要足够样本才能书写，宁缺毋滥

**底层：Per-Mode 偏好**
- 操作习惯和风格选择
- 明确指令 vs 观察推断，区分标注

### 3.3 Skill-installer 改动

在 `installSkill()` 流程中新增两步：

1. **注入全局 Skill Dependency**：安装 `pneuma-preferences` 到 skills 目录
2. **提取 Critical 注入 CLAUDE.md**：读取偏好文件 → 提取 critical → 用新 marker 注入

```
现有流程：
1. 复制 skill 文件
2. 应用模板参数
3. 生成 .env
4. 注入 CLAUDE.md（pneuma:start + viewer-api + skills）
5. 安装 MCP servers

新增：
0. 确保 ~/.pneuma/preferences/ 目录存在
4.5. 读取偏好 critical → 注入 CLAUDE.md（pneuma:preferences marker）
6. 安装 pneuma-preferences 作为 skill dependency
```

### 3.4 CLAUDE.md 注入结构

```markdown
<!-- pneuma:start -->
## Pneuma Slide Mode
...skill prompt...
<!-- pneuma:evolved:start -->
...evolved preferences (from evolution system)...
<!-- pneuma:evolved:end -->
<!-- pneuma:end -->

<!-- pneuma:preferences:start -->
### User Preferences (Critical)

**Global:**
- 永远不要使用深色背景

**Slide Mode:**
- 标题字号不小于 48px
<!-- pneuma:preferences:end -->

<!-- pneuma:viewer-api:start -->
...viewer API...
<!-- pneuma:viewer-api:end -->

<!-- pneuma:skills:start -->
...skill dependencies (includes pneuma-preferences)...
<!-- pneuma:skills:end -->
```

---

## 4. 关键设计决策

### 4.1 能力赋予而非系统构建

**决策：不增加 API、不改 Viewer、不改 Manifest。仅通过 Skill + 文件约定实现。**

理由：
- 偏好是 agent 的外部记忆，核心消费者是 agent 自己
- Agent 有完整的文件读写能力，不需要额外 API
- 最小侵入保证不影响现有功能稳定性

### 4.2 Critical 注入而非全量注入

**决策：仅将用户标记为 critical 的偏好注入 CLAUDE.md，其余 agent 按需读取。**

理由：
- 无差别注入会污染 agent 的判断空间，影响泛化性
- CLAUDE.md 上下文有限，应只放真正的硬性约束
- Agent 可以根据当前任务特征选择性地读取偏好文件

### 4.3 独立于 Evolution 系统

**决策：偏好系统与 Evolution 系统在流程上互不耦合，但可共享工具代码。**

理由：
- Evolution 改的是 Skill 文件（领域知识），偏好记录的是用户画像
- Evolution 需要用户审核 proposal，偏好由 agent 自治管理
- 两者的生命周期和管理方式不同
- 共享的是 evolve mode 的数据访问脚本（JSONL streaming、session 枚举），这些是通用工具，不构成流程耦合

### 4.4 活文档而非标签数据库

**决策：偏好文件是 agent 全量审视 + 重写的活文档，不是只增不减的标签集。**

理由：
- 用户偏好会变化——上个月喜欢深色主题，这个月可能转向浅色
- 单次对话的观察可能被后续观察推翻
- 避免"无效的标签化用户"——宁缺毋滥
- Changelog 机制确保变更可追溯

---

## 5. 被否决的方案

### 5.1 Evolution 系统集成

将偏好作为 Evolution proposal 流程的一部分。

- 否决原因：过重；Evolution 是"改 Skill"的流程，偏好是"agent 的外部记忆"，本质不同。Proposal 审核流程与 agent 自治原则冲突。

### 5.2 全量注入 CLAUDE.md

将完整偏好文件内容注入 CLAUDE.md。

- 否决原因：无差别注入影响 agent 泛化性；上下文开销过大；偏好应该按需读取、结合当前任务使用。

### 5.3 硬性门槛解锁机制

设置"至少 N 次 session 后才能写入深度画像"。

- 否决原因：过于机械；agent 应自然地从"初步印象"演化到"稳定认知"，用自然语言表达置信度，而非硬编码门槛。

### 5.4 结构化 JSON 存储

使用 JSON schema 存储偏好。

- 否决原因：限制了 agent 的表达自由度；Markdown 对 LLM 更自然；agent 管理结构化数据不如管理自然语言文档。

---

## 6. 影响

1. **所有 mode 获得偏好能力** — 通过全局 Skill Dependency 自动注入
2. **`~/.pneuma/preferences/` 成为用户数据目录** — 需要在文档中说明
3. **skill-installer 增加两步** — 目录创建 + critical 提取注入
4. **CLAUDE.md 新增 marker** — `pneuma:preferences:start/end`
5. **向前兼容** — 偏好文件不存在时完全静默，不影响现有流程
6. **Agent 质量依赖** — 偏好分析的质量取决于 SKILL.md 策略和 agent 的理解力
