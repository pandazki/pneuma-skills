# User Preference Analysis System — Design Spec

> **Date**: 2026-03-31
> **ADR**: ADR-014
> **Status**: Approved

---

## Overview

为所有 Pneuma mode 赋予用户偏好分析能力。通过一个通用 Skill Dependency（`pneuma-preferences`）和一组文件约定（`~/.pneuma/preferences/`），让 agent 拥有跨 session 的用户记忆。

**核心原则：能力赋予，不是基础设施。**

---

## 1. 存储结构

### 1.1 文件位置

```
~/.pneuma/preferences/
├── profile.md              # 跨 mode 用户画像
├── mode-slide.md           # per-mode 偏好
├── mode-doc.md
├── mode-webcraft.md
└── ...                     # agent 按需创建
```

### 1.2 文件格式约定

纯 Markdown，agent 全权管理。两种系统级 marker：

**Critical（启动时注入 CLAUDE.md）：**
```markdown
<!-- pneuma-critical:start -->
- 硬性约束条目
<!-- pneuma-critical:end -->
```

**Changelog（agent 维护，支持增量刷新）：**
```markdown
<!-- changelog:start -->
## Changelog

- **2026-03-31** — 全量刷新（2026-01 ~ 2026-03，12 sessions）
  - 新增：...
  - 修正：...
  - 移除：...
<!-- changelog:end -->
```

### 1.3 前向兼容

- 目录不存在 → skill-installer 首次运行时创建空目录
- 文件不存在 → 静默跳过，不报错，不创建空文件
- Critical marker 不存在 → 不注入 preferences section
- 整个系统不存在时不影响任何现有功能

---

## 2. Skill 设计

### 2.1 位置与结构

```
modes/_shared/skills/pneuma-preferences/
├── SKILL.md                # 偏好分析策略（agent 的方法论）
└── scripts/                # 可选辅助脚本
    └── scan-history.ts     # 复用 evolve 的 _shared.ts 基础设施
```

### 2.2 SKILL.md 内容大纲

#### 能力声明

你可以管理用户偏好文件。路径：`~/.pneuma/preferences/`。

- `profile.md` — 跨 mode 画像
- `mode-{name}.md` — per-mode 偏好
- 用 `<!-- pneuma-critical:start/end -->` 标记硬性约束（下次启动时自动注入 CLAUDE.md 或 AGENTS.md）
- 用 `<!-- changelog:start/end -->` 维护更新日志

#### 三层偏好模型

**顶层：跨 Mode 显性偏好**
- 语言与表达风格（中/英、正式/口语、详略偏好）
- 审美倾向（色彩、排版、信息密度、风格调性）
- 协作模式（主导型 vs 协作型、自主度期望、确认频率）
- 认知风格（全局优先 vs 细节优先、视觉型 vs 文字型）

**中层：深度画像**
- 能力边界与知识领域
- 价值支点（效率 vs 品质、创新 vs 稳定、精确 vs 感性）
- 行为模式中的隐含偏好——恒常中的无意识选择
- 回避模式与矛盾——如实记录，不强行调和
- 需要足够样本积累，宁缺毋滥

**底层：Per-Mode 偏好**
- 操作习惯与风格选择（特定于 mode 的具体偏好）
- 区分"用户明确说过的"与"agent 观察推断的"
- Critical 红线与一般倾向分开标注

#### 写作原则

- **活文档**：每次更新是全量审视 + 重写，不是追加日志
- **自然语言置信度**："多次观察到" / "初步印象" / "用户明确要求"
- **保留矛盾**：行为自相矛盾时如实记录
- **可删除**：任何条目都可以被后续观察推翻和移除
- **临时 vs 持久**：区分项目特殊需求和长期稳定偏好
- **不标签化**：描述行为模式和选择倾向，不贴人格标签
- **中性精确**：逃避就是逃避，控制就是控制，不美化

#### 分析方法

- 关注恒常中的无意识选择——显而易见的偏爱只是深层逻辑的投影
- 逆向验证："如果结论是 X，应该看到 Y 行为，是否吻合？"
- "如果剔除 X，Y 是否仍然出现？"——定位真正的支点
- 特别关注：回避、失败、反复、情绪爆发点

#### 全量刷新指南

全量刷新是对一段时间内所有 session 的系统性回顾：

1. 列出目标时间范围内的 session（利用 `list-sessions` 脚本或直接读 `~/.pneuma/sessions.json`）
2. 对每个 session 提取摘要（利用 `session-digest` 脚本或直接读 `history.json`）
3. 综合分析，更新偏好文件
4. 在 changelog 中记录：日期、范围、变更摘要
5. 下次刷新时，通过 changelog 最后日期确定增量范围

#### 日常维护

- 在 session 中发现新的偏好信号时可以随时更新
- 不需要告知用户（但用户问起不隐瞒）
- 首次在某 mode 创作时，查阅偏好文件是一个好的起手动作
- 如果偏好文件尚不存在，可以在积累了足够观察后创建

---

## 3. Skill-installer 改动

### 3.1 改动点

在 `server/skill-installer.ts` 的 `installSkill()` 中：

**Step 0：确保偏好目录存在**
```typescript
const prefsDir = join(homedir(), ".pneuma", "preferences");
await mkdir(prefsDir, { recursive: true });
```

**Step 4.5：提取 Critical 并注入 instructions file（CLAUDE.md 或 AGENTS.md）**

```typescript
async function extractCritical(filePath: string): Promise<string | null> {
  try {
    const content = await Bun.file(filePath).text();
    const match = content.match(
      /<!-- pneuma-critical:start -->\s*([\s\S]*?)\s*<!-- pneuma-critical:end -->/
    );
    return match?.[1]?.trim() || null;
  } catch {
    return null; // 文件不存在，静默跳过
  }
}

async function injectPreferencesCritical(
  workspace: string,
  modeName: string,
  backendType: string,
): Promise<void> {
  const prefsDir = join(homedir(), ".pneuma", "preferences");

  const globalCritical = await extractCritical(join(prefsDir, "profile.md"));
  const modeCritical = await extractCritical(join(prefsDir, `mode-${modeName}.md`));

  // 使用 backend-aware 的 instructions file
  const instrFile = instructionsFile(backendType); // CLAUDE.md 或 AGENTS.md
  const instrPath = join(workspace, instrFile);

  if (!globalCritical && !modeCritical) {
    // 无 critical 内容，移除已有 marker（如果有）
    // 使用与现有 marker 管理相同的 indexOf/substring 模式
    removePneumaSection(instrPath, "pneuma:preferences");
    return;
  }

  const lines: string[] = [];
  lines.push("### User Preferences (Critical)\n");
  if (globalCritical) {
    lines.push("**Global:**");
    lines.push(globalCritical);
    lines.push("");
  }
  if (modeCritical) {
    lines.push(`**${modeName} Mode:**`);
    lines.push(modeCritical);
  }

  // 使用与现有 marker 管理相同的 indexOf/substring 模式
  injectPneumaSection(instrPath, "pneuma:preferences", lines.join("\n"));
}
```

**实现注意**：现有 skill-installer 中有多处重复的 marker 管理逻辑（indexOf/substring）。实现时建议提取通用的 `removePneumaSection` / `injectPneumaSection` helper 统一管理，但也可以按现有 inline 模式添加。

**Step 6：安装全局 Skill Dependency**

`pneuma-preferences` 从 `modes/_shared/skills/pneuma-preferences/` 复制到 workspace 的 skills 目录，并在 skills dependencies section 中列出。

**注入机制**：在 `installSkill()` 中维护一个全局 dependency 列表（初始仅 `pneuma-preferences`），在安装 mode-specific dependencies 之后追加安装。这与"不 hardcode mode 知识"的原则不冲突——这是框架级能力，类似于 skill-installer 已有的 `.gitignore` 管理。

### 3.2 注入顺序

```markdown
<!-- pneuma:start -->
...mode skill prompt...
<!-- pneuma:evolved:start/end -->
<!-- pneuma:end -->

<!-- pneuma:preferences:start -->
...critical only...
<!-- pneuma:preferences:end -->

<!-- pneuma:viewer-api:start/end -->

<!-- pneuma:skills:start -->
...includes pneuma-preferences...
<!-- pneuma:skills:end -->
```

**`pneuma:preferences` 放在 `pneuma:start/end` 外面**，这是有意为之：
- `pneuma:start/end` 是 mode-specific 的 skill prompt，evolution 的 evolved 区段嵌套其中因为它是对 skill 的增强
- `pneuma:preferences` 是跨 mode 的用户级数据，独立于任何 mode 的 skill prompt
- 放在外面确保 mode skill 更新时不会意外覆盖用户偏好

### 3.3 向前兼容保证

- `~/.pneuma/preferences/` 不存在 → 创建空目录，不创建文件
- 偏好文件不存在 → `extractCritical` 返回 null，跳过注入
- Critical marker 不存在 → 返回 null，跳过注入
- CLAUDE.md 无 pneuma:preferences marker → 不注入（无 critical 时）或新增（有 critical 时）

---

## 4. 改动文件清单

| 操作 | 文件 | 改动内容 |
|------|------|---------|
| 新增 | `modes/_shared/skills/pneuma-preferences/SKILL.md` | 偏好分析策略 |
| 新增 | `modes/_shared/skills/pneuma-preferences/scripts/scan-history.ts` | 可选：历史扫描辅助脚本 |
| 改动 | `server/skill-installer.ts` | 创建偏好目录 + 提取 critical + 注入 CLAUDE.md + 安装全局 skill dep |
| 改动 | `CLAUDE.md` | 文档更新：偏好系统说明 |
| 新增 | `docs/adr/adr-014-user-preference-analysis.md` | ADR |
| 新增 | `docs/design/2026-03-31-user-preference-analysis-design.md` | 本文档 |

---

## 5. 不改动

- 各 mode 的 `manifest.ts`
- Viewer 组件
- Server routes（无新 API）
- 前端 store
- Evolution 系统
- WebSocket bridge
