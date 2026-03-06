# Pneuma 2.0: Evolution Agent — AI-Native Skill 演进

> **日期**: 2026-03-06
> **基于**: v1.18.9 → Implemented in v2.0.0
> **状态**: Implemented (merged in PR #41)
> **替代**: `proposal-v2-continuous-learning.md`（已归档至 `archive/`）

---

## 核心命题

前一版 proposal 把 skill 演进设计成一个人写的 ETL 管道：规则引擎检测纠正信号 → 提取 trait → 写 preferences.md → 注入 CLAUDE.md。每一步都是确定性代码，扩展方式是改代码加新 extractor。

**这不是 AI-Native 的做法。**

AI-Native 的做法是：**定义一个 Agent 过程，给它目标和工具，让它自己决定怎么增强 skill。**

```
旧方案: history.json → 规则引擎 → user-profile.json → preferences.md → CLAUDE.md
新方案: Evolution Agent(context + directive + tools) → 自主修改 .claude/ 和 CLAUDE.md
```

---

## 设计

### 顶层抽象

Evolution Agent 是框架内置的一个 Agent 过程。它不是一个函数，不是一个 pipeline，而是一个真正的 Agent session，拥有：

| 要素 | 内容 | 来源 |
|------|------|------|
| **Context** | "你是 Pneuma 的 Skill Evolution Agent" — 解释 Pneuma 是什么，为什么需要通过外部信息增强 skill | 框架内置 |
| **Directive** | 演进的目标和方向 — "这个 Mode 的 skill 应该朝什么方向演进" | Mode manifest 定义 |
| **Tools** | 获取数据的工具集 — Agent 用来收集信息、做出判断的手段 | 框架内置 + Mode 声明 + 用户扩展 |
| **Target** | 可写范围 — `.claude/` 整个目录 + `CLAUDE.md` | 框架约束 |

### 工作流：Propose → Review → Apply

**关键设计决策：Evolution Agent 不直接修改文件。** 它输出一个结构化 proposal（附带证据和引用），用户审核后决定 apply 或 discard。已 apply 的 proposal 支持 rollback。

```
pneuma evolve [--mode <mode>] [--workspace <path>]
  │
  ├─ 1. 加载 Mode manifest → 获取 evolution.directive
  │
  ├─ 2. 组装 Agent prompt（context + directive + data sources + output format）
  │
  ├─ 3. 启动 Agent session（借用 Claude Code CLI，--print 模式）
  │     └─ Agent 分析 CC 对话历史 → 产出 JSON proposal
  │
  ├─ 4. 解析 Agent 输出 → 保存 proposal 到 .pneuma/evolution/proposals/
  │
  └─ 5. 打印 proposal 摘要，提示用户 apply 或 rollback

pneuma evolve apply [--workspace <path>]
  │
  ├─ 1. 显示最近的 pending proposal（含证据和内容预览）
  ├─ 2. 用户确认
  ├─ 3. 备份受影响的文件到 .pneuma/evolution/backups/<proposal-id>/
  └─ 4. 执行文件修改

pneuma evolve rollback [--workspace <path>]
  │
  ├─ 1. 找到最近的 applied proposal
  ├─ 2. 用户确认
  └─ 3. 从备份恢复所有文件
```

### 触发方式

第一版：**独立 CLI 命令**，不自动触发。

```bash
# 分析历史并生成 proposal
pneuma evolve
pneuma evolve --workspace ~/my-slides --mode slide

# 查看 proposal 详情
pneuma evolve show

# 列出所有 proposals
pneuma evolve list

# 审核并应用
pneuma evolve apply

# 回滚
pneuma evolve rollback
```

为什么不在启动时自动触发：
- Agent 过程本身较慢（需要读取历史、分析、生成 proposal）
- 自动触发会延迟每次启动
- 用户应该有意识地选择"现在演进我的 skill"

后续可以加的触发方式（不影响核心抽象）：
- Launcher UI 按钮
- 每 N 个会话后提示
- `--evolve` flag 在 pneuma 启动命令中

---

## Manifest 扩展

```typescript
// core/types/mode-manifest.ts

export interface ModeManifest {
  // ... 现有字段 ...

  /**
   * Skill 演进配置。
   * 定义 Evolution Agent 的目标方向和可用工具。
   * 如果未定义，`pneuma evolve` 仍可执行，使用框架默认 directive。
   */
  evolution?: EvolutionConfig;
}

export interface EvolutionConfig {
  /**
   * 演进方向 — 给 Evolution Agent 的目标描述。
   * 告诉 Agent 这个 Mode 的 skill 应该朝什么方向个性化。
   *
   * @example
   * "Learn the user's presentation style preferences: typography choices,
   *  color palette tendencies, layout density, slide structure patterns.
   *  Augment the skill to guide the main agent toward these preferences
   *  as defaults while respecting explicit user instructions."
   */
  directive: string;

  /**
   * 额外的数据获取工具。
   * 框架已内置基础工具（读取 CC 历史等），这里声明 Mode 特有的。
   *
   * 第一版暂不实现，预留接口。
   */
  tools?: EvolutionTool[];
}

/**
 * Evolution Agent 可用的外部数据获取工具（预留）。
 * 第一版不实现，框架内置工具足够。
 */
export interface EvolutionTool {
  /** 工具名称 */
  name: string;
  /** 工具描述（给 Agent 看的） */
  description: string;
  /** 实现方式：CLI 命令 / HTTP endpoint / MCP server */
  type: "command" | "http" | "mcp";
  /** 具体配置 */
  config: Record<string, unknown>;
}
```

---

## 框架内置工具（第一版）

Evolution Agent 运行在 workspace 目录下，以 Claude Code 作为 backend。Claude Code 自带文件读写能力（Read, Edit, Write, Bash 等），因此 Agent 天然可以：

- 读取 `.claude/skills/` 下的所有 skill 文件
- 修改/创建 skill 文件
- 修改 `CLAUDE.md`

**需要额外提供的能力是「读取 Claude Code 对话历史」。** 这是第一版的核心工具。

### 方案：直接读取 CC 历史文件

Claude Code 的对话历史存储在 `~/.claude/projects/<encoded-path>/` 下：

```
~/.claude/projects/-Users-pandazki-Codes-pneuma-skills/
  ├─ <session-uuid>.jsonl          # 每个会话一个文件
  ├─ <session-uuid>/
  │   ├─ subagents/                # 子 Agent 对话
  │   └─ tool-results/             # 工具输出
  └─ ...
```

JSONL 格式，每行一个 JSON 对象，`type` 字段区分消息类型：

| type | 说明 | 对演进有用的信息 |
|------|------|-----------------|
| `user` | 用户消息 | `message.content` — 用户请求和反馈 |
| `assistant` | Agent 回复 | `message.content` — Agent 的选择和输出 |
| `system` | 系统事件 | hook 信息、停止原因 |
| `progress` | 工具执行进度 | 工具使用模式 |

**关键字段**：
- `message.content` — 用户指令、纠正、偏好表达
- `message.model` — 使用的模型
- `timestamp` — 时间线
- `sessionId` — 会话关联

### 实现方式

由于 Evolution Agent 就是一个 Claude Code session，它可以直接用 Bash 工具读取这些 JSONL 文件。**不需要我们封装任何 MCP 或工具。**

在 Agent prompt 中告知历史文件的位置和格式即可：

```
## 可用数据源

### Claude Code 对话历史
位置: ~/.claude/projects/<project-path>/
格式: JSONL，每行一个消息对象
- type=user 的 message.content 包含用户的请求、反馈和偏好表达
- type=assistant 的 message.content 包含 Agent 的回复
- 文件按会话分割，文件名为 session UUID

当前 workspace 对应的项目路径: <computed-path>

你可以用 Bash 工具读取和分析这些文件。重点关注：
1. 用户的纠正和修改请求（最强的偏好信号）
2. 用户的显式偏好声明
3. 重复出现的请求模式
```

这就是"用工具获取数据"的最简实现 —— 告诉 Agent 数据在哪、格式是什么，让它自己用已有能力去读。

---

## Agent Prompt 设计

Evolution Agent 的 system prompt 由三部分组成：

### Part 1: Context（框架内置，所有 Mode 共享）

```markdown
# Pneuma Skill Evolution Agent

你是 Pneuma 的 Skill Evolution Agent。你的任务是分析用户的使用历史，
然后增强 workspace 中的 skill 文件，使主 Agent 在未来的会话中更好地
匹配这个用户的风格和偏好。

## 什么是 Pneuma

Pneuma 是人和 Code Agent 共创内容的基础设施。它通过 Mode 系统为
Agent 注入领域知识（Skill），使 Agent 在特定领域（文档、演示文稿、
画布等）中表现更好。

## 为什么需要演进

Skill 是 Mode 预置的静态知识。但每个用户都有自己的风格偏好、
工作习惯和审美取向。通过分析用户的历史交互，你可以发现这些个性化
特征，并将它们补充到 skill 中，使 Agent 的输出更符合用户期望。

## 你的职责

1. 通过可用的数据源了解用户的使用模式和偏好
2. 基于分析结果，修改或补充 skill 文件
3. 你的修改应该是「默认偏好」而非「硬规则」— 用户的显式指令永远优先
4. 如果数据不足以得出有价值的结论，不修改任何文件是完全可以的

## 输出边界

你可以修改 workspace 中的以下内容：
- `.claude/skills/` 目录下的所有文件（核心 skill 文件）
- `CLAUDE.md`（项目级 Agent 指引）

不要修改 workspace 中的其他文件。

## 修改原则

- **增量增强**：在现有 skill 基础上补充，不要重写
- **可追溯**：用 `<!-- evolved: YYYY-MM-DD -->` 标记你添加的内容
- **可逆**：用户应该能轻松识别和删除你添加的内容
- **克制**：只增强有充分证据支持的偏好，不要过度推断
```

### Part 2: Directive（Mode 提供）

来自 `manifest.evolution.directive`，例如 Slide Mode 的：

```markdown
## 演进方向

学习用户的演示文稿风格偏好：字体选择、配色倾向、布局密度、
每页文字量、标题层级偏好、代码块使用习惯。
将这些偏好作为默认建议补充到 skill 中。
```

如果 Mode 没有定义 `evolution`，使用通用 directive：

```markdown
## 演进方向

分析用户的使用模式，提取有意义的风格偏好和工作习惯，
将它们作为个性化指引补充到 skill 中。
```

### Part 3: 数据源描述（框架计算后注入）

```markdown
## 可用数据源

### Claude Code 对话历史

项目历史路径: ~/.claude/projects/-Users-pandazki-Codes-pneuma-skills/
会话文件数: 34
总数据量: 约 263MB

格式: 每个文件是 JSONL，每行一个 JSON 对象。关键字段：
- type: "user" | "assistant" | "system" | "progress"
- message.content: 消息内容（用户消息是字符串，Agent 消息是 content blocks 数组）
- timestamp: ISO 时间戳
- sessionId: 会话 ID

分析建议：
- 优先分析最近的 5-10 个会话（按文件修改时间排序）
- 重点提取 type=user 的消息，寻找：
  - 纠正/修改请求（"太大了"、"换个颜色"、"不要用这个"）
  - 显式偏好声明（"我喜欢..."、"我偏好..."）
  - 反复出现的请求模式
- 数据量大，使用 Bash 工具高效处理（grep, jq, head/tail）

### 当前 Skill 文件

已安装的 skill 目录: .claude/skills/<installName>/
项目指引: CLAUDE.md

先阅读当前 skill 内容，理解现有的领域知识，再决定如何增强。
```

---

## 实现（已完成）

### 新增/修改文件

```
server/
  ├─ evolution-agent.ts        # Evolution Agent 入口：prompt 组装、Agent 执行、proposal 解析
  ├─ evolution-proposal.ts     # Proposal 数据模型、存储、apply/rollback/discard
  └─ __tests__/
      └─ evolution-proposal.test.ts  # 13 个单元测试
core/types/
  └─ mode-manifest.ts          # 扩展：EvolutionConfig, EvolutionTool
bin/
  └─ pneuma.ts                 # 扩展：evolve 子命令（propose/apply/rollback/show/list）
modes/
  ├─ slide/manifest.ts         # 添加 evolution.directive
  ├─ doc/manifest.ts           # 添加 evolution.directive
  └─ draw/manifest.ts          # 添加 evolution.directive
```

### Proposal 数据模型

proposal 存储在 `.pneuma/evolution/proposals/<id>.json`，备份存储在 `.pneuma/evolution/backups/<id>/`。

```typescript
interface EvolutionProposal {
  id: string;                    // e.g. "evo-1741234567890-a1b2c3d4"
  createdAt: string;
  mode: string;
  workspace: string;
  status: "pending" | "applied" | "rolled_back" | "discarded";
  summary: string;
  changes: ProposedChange[];
  appliedAt?: string;
}

interface ProposedChange {
  file: string;                  // 相对路径，限制在 .claude/ 和 CLAUDE.md
  action: "modify" | "create";
  description: string;
  evidence: Evidence[];          // 每个 change 必须有证据
  content: string;               // 要添加的内容
  insertAt?: string;             // "append" | "section:<heading>"
}

interface Evidence {
  sessionFile: string;           // CC 历史文件名
  quote: string;                 // 用户原话引用
  reasoning: string;             // 为什么这是偏好证据
}
```

### `server/evolution-agent.ts`

```typescript
/**
 * Evolution Agent — AI-native skill 演进。
 *
 * 启动一个独立的 Agent session，分析用户历史并增强 skill 文件。
 * 借用 AgentBackend 执行，但不依赖其具体实现。
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { ModeManifest, EvolutionConfig } from "../core/types/mode-manifest.js";

export interface EvolutionOptions {
  /** 用户 workspace 路径 */
  workspace: string;
  /** Mode manifest */
  manifest: ModeManifest;
  /** Mode 源文件目录（用于定位 skill 源） */
  modeSourceDir: string;
  /** Agent 后端端口（借用 AgentBackend） */
  backendPort?: number;
}

/**
 * 组装 Evolution Agent 的完整 prompt。
 */
export function buildEvolutionPrompt(options: EvolutionOptions): string {
  const { workspace, manifest } = options;
  const parts: string[] = [];

  // Part 1: Context（框架内置）
  parts.push(EVOLUTION_CONTEXT);

  // Part 2: Directive（Mode 定义 or 默认）
  const directive = manifest.evolution?.directive ?? DEFAULT_DIRECTIVE;
  parts.push(`## 演进方向\n\n${directive}`);

  // Part 3: 数据源（框架计算）
  const dataSourceSection = buildDataSourceSection(workspace);
  parts.push(dataSourceSection);

  return parts.join("\n\n---\n\n");
}

/**
 * 构建数据源描述：扫描 CC 历史目录，计算统计信息。
 */
function buildDataSourceSection(workspace: string): string {
  const ccProjectsDir = join(homedir(), ".claude", "projects");
  // CC 用 workspace 绝对路径编码为目录名（/ → -）
  const encodedPath = workspace.replace(/\//g, "-");
  const ccHistoryDir = join(ccProjectsDir, encodedPath);

  const lines: string[] = ["## 可用数据源", ""];

  if (existsSync(ccHistoryDir)) {
    const files = readdirSync(ccHistoryDir).filter(f => f.endsWith(".jsonl"));
    const totalSize = files.reduce((sum, f) => {
      try { return sum + statSync(join(ccHistoryDir, f)).size; } catch { return sum; }
    }, 0);
    const sizeMB = (totalSize / 1024 / 1024).toFixed(1);

    // 按修改时间排序，最近的在前
    const sorted = files
      .map(f => ({ name: f, mtime: statSync(join(ccHistoryDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    lines.push("### Claude Code 对话历史");
    lines.push("");
    lines.push(`项目历史路径: ${ccHistoryDir}/`);
    lines.push(`会话文件数: ${files.length}`);
    lines.push(`总数据量: 约 ${sizeMB}MB`);
    lines.push("");
    lines.push("最近 10 个会话文件（按时间倒序）:");
    for (const f of sorted.slice(0, 10)) {
      const date = new Date(f.mtime).toISOString().slice(0, 10);
      const size = (statSync(join(ccHistoryDir, f.name)).size / 1024).toFixed(0);
      lines.push(`- ${f.name} (${date}, ${size}KB)`);
    }
    lines.push("");
    lines.push("格式: JSONL，每行一个 JSON 对象。关键字段：");
    lines.push("- `type`: \"user\" | \"assistant\" | \"system\" | \"progress\"");
    lines.push("- `message.content`: 消息正文");
    lines.push("- `timestamp`: ISO 时间戳");
    lines.push("");
    lines.push("分析建议：");
    lines.push("- 优先分析最近的会话");
    lines.push("- 重点提取 type=user 的消息中的偏好信号");
    lines.push("- 数据量大，用 Bash + grep/jq 高效处理，不要逐行读取整个文件");
  } else {
    lines.push("### Claude Code 对话历史");
    lines.push("");
    lines.push("未找到该 workspace 的 Claude Code 历史。");
    lines.push(`预期路径: ${ccHistoryDir}/`);
    lines.push("");
    lines.push("如果是首次使用，跳过历史分析，仅阅读当前 skill 并评估是否有改进空间。");
  }

  lines.push("");
  lines.push("### 当前 Skill 文件");
  lines.push("");
  lines.push(`Skill 目录: .claude/skills/${manifest.skill.installName}/`);
  lines.push("项目指引: CLAUDE.md");
  lines.push("");
  lines.push("先阅读当前 skill 内容，理解现有领域知识，再决定增强策略。");

  return lines.join("\n");
}

/**
 * 执行 Evolution Agent。
 *
 * 借用 Claude Code CLI 作为 Agent backend：
 * - 启动一次性 session（不 resume，不持久化）
 * - 将组装好的 prompt 作为 -p 参数传入
 * - Agent 完成任务后自动退出
 */
export async function runEvolution(options: EvolutionOptions): Promise<{
  success: boolean;
  summary: string;
}> {
  const prompt = buildEvolutionPrompt(options);

  // 使用 Bun.spawn 直接运行 Claude Code CLI
  // 不走完整的 AgentBackend 流程（不需要 WS bridge、不需要 UI）
  const args = [
    "claude",
    "--print",
    "--output-format", "text",
    "--permission-mode", "bypassPermissions",
    "-p", prompt,
  ];

  const proc = Bun.spawn(args, {
    cwd: options.workspace,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CLAUDECODE: undefined, // 避免循环
    },
  });

  // 流式输出 Agent 的执行过程
  const decoder = new TextDecoder();
  let output = "";

  if (proc.stdout && typeof proc.stdout !== "number") {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      output += text;
      process.stdout.write(text); // 实时输出
    }
  }

  const exitCode = await proc.exited;

  return {
    success: exitCode === 0,
    summary: output.slice(-500), // 最后 500 字符作为摘要
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const EVOLUTION_CONTEXT = `# Pneuma Skill Evolution Agent

你是 Pneuma 的 Skill Evolution Agent。你的任务是分析用户的使用历史，
然后增强 workspace 中的 skill 文件，使主 Agent 在未来的会话中更好地
匹配这个用户的风格和偏好。

## 什么是 Pneuma

Pneuma 是人和 Code Agent 共创内容的基础设施。它通过 Mode 系统为
Agent 注入领域知识（Skill），使 Agent 在特定领域（文档、演示文稿、
画布等）中表现更好。Skill 文件安装在 workspace 的 .claude/skills/ 目录下，
CLAUDE.md 作为项目级 Agent 指引。

## 为什么需要演进

Skill 是 Mode 预置的静态知识。但每个用户都有自己的风格偏好、工作习惯
和审美取向。通过分析用户的历史交互，你可以发现这些个性化特征，并将它们
补充到 skill 中，使 Agent 的输出更符合用户期望。

## 你的职责

1. 阅读当前 skill 文件，理解现有领域知识
2. 通过可用的数据源分析用户的使用模式和偏好
3. 基于分析结果，修改或补充 skill 文件
4. 如果数据不足以得出有价值的结论，不做任何修改

## 输出边界

你可以修改以下内容：
- \`.claude/skills/\` 目录下的所有文件
- \`CLAUDE.md\`

**不要修改 workspace 中的任何其他文件。**

## 修改原则

- **增量增强**：在现有 skill 基础上补充，不要重写原有内容
- **可追溯**：用 \`<!-- evolved: YYYY-MM-DD -->\` 标记你添加的内容块
- **可逆**：让用户能轻松识别和删除你添加的个性化内容
- **克制**：只增强有充分证据支持的偏好。宁可少改，不要过度推断
- **默认而非规则**：你的增强是「默认偏好」，用户的显式指令永远优先

## 工作流程

1. 读取 .claude/skills/ 下的当前 skill 文件
2. 读取 CLAUDE.md 了解现有指引
3. 使用数据源分析用户历史
4. 识别有价值的偏好信号（纠正、显式声明、重复模式）
5. 在 skill 文件中增加个性化内容（如补充一个 "User Preferences" section）
6. 打印修改摘要`;

const DEFAULT_DIRECTIVE = `分析用户的使用模式，提取有意义的风格偏好和工作习惯，
将它们作为个性化指引补充到 skill 中。重点关注：
- 用户反复纠正 Agent 的行为模式
- 用户显式表达的偏好
- 用户的工作风格和内容偏好`;
```

### `bin/pneuma.ts` 扩展

在 `main()` 的子命令路由中添加 `evolve`：

```typescript
// bin/pneuma.ts — evolve 子命令

if (rawArgs[0] === "evolve") {
  const { workspace, mode } = parseArgs(process.argv);
  const effectiveWorkspace = workspace || process.cwd();

  // 1. 确定 mode（从 .pneuma/session.json 或 CLI 参数）
  let modeName = mode;
  if (!modeName) {
    const session = loadSession(effectiveWorkspace);
    if (session?.mode) {
      modeName = session.mode;
    } else {
      p.cancel("No mode specified and no .pneuma/session.json found. Use --mode <mode>.");
      process.exit(1);
    }
  }

  // 2. 加载 manifest
  const resolved = await resolveModeSource(modeName, PROJECT_ROOT);
  if (resolved.type !== "builtin") {
    registerExternalMode(resolved.name, resolved.path);
  }
  const manifest = await loadModeManifest(resolved.name);

  // 3. 运行 Evolution Agent
  p.log.step(`Evolving skill for ${manifest.displayName} mode...`);
  const { runEvolution } = await import("../server/evolution-agent.js");
  const result = await runEvolution({
    workspace: effectiveWorkspace,
    manifest,
    modeSourceDir: resolved.path,
  });

  if (result.success) {
    p.log.success("Skill evolution complete.");
  } else {
    p.log.error("Evolution agent exited with error.");
  }
  return;
}
```

---

## 各 Mode 的 Directive 示例

### Slide Mode

```typescript
evolution: {
  directive: `学习用户的演示文稿风格偏好：
- 字体选择和排版习惯（字号、行高、字重）
- 配色倾向（明暗、色调、是否偏好渐变）
- 布局密度（每页文字量、留白偏好）
- 内容结构（标题层级、列表 vs 段落、代码块使用）
- 视觉元素偏好（图片使用频率、emoji 使用、图标风格）

将这些偏好作为风格指引补充到 skill 文件中。`,
}
```

### Doc Mode

```typescript
evolution: {
  directive: `学习用户的文档写作风格：
- 语言和语气（正式/随意、简洁/详细）
- Markdown 使用习惯（标题层级、列表偏好、代码块语言标注）
- 文档结构模式（章节划分、目录偏好）
- 内容组织偏好（先结论还是先背景、是否喜欢表格）

将这些写作风格指引补充到 skill 文件中。`,
}
```

### Draw Mode

```typescript
evolution: {
  directive: `学习用户的绘图偏好：
- 常用的图形类型和布局风格
- 颜色使用习惯
- 标注和文字样式
- 连线和箭头偏好

将这些视觉风格指引补充到 skill 文件中。`,
}
```

---

## 扩展路线

第一版刻意简单：一个 CLI 命令、一个 Agent session、读 CC 原生历史。但这个抽象天然支持扩展：

### 近期（v2.1）

1. **Launcher UI 集成**：在 Launcher 中加"Evolve"按钮，调用 `/api/evolve` endpoint
2. **多数据源**：除 CC 历史外，支持读取 Pneuma 自己的 `.pneuma/history.json`
3. **用户手工 profile**：支持用户在 `~/.pneuma/preferences.md` 手工维护偏好，作为 Agent 的参考输入

### 中期（v2.2）

4. **Mode 自定义工具**：实现 `evolution.tools` 声明，Mode 可以提供特定的数据获取工具（MCP server、HTTP endpoint 等）
5. **增量演进**：记录上次演进的时间点，只分析新增的会话
6. **演进历史**：在 `.pneuma/evolution-log.json` 中记录每次演进的修改摘要

### 远期

7. **第三方记忆系统集成**：通过工具声明对接外部记忆系统
8. **跨 workspace 演进**：全局用户画像（同一用户在不同项目间的偏好迁移）
9. **自动触发**：基于会话数量或偏好变化检测的智能触发

---

## 与前一版 Proposal 的关系

| 维度 | 前 proposal (ETL Pipeline) | 本设计 (Evolution Agent) |
|------|--------------------------|------------------------|
| 核心抽象 | `preference-extractor.ts` 函数 | Agent 过程 |
| 增强逻辑 | 人写规则引擎 + 硬编码合并策略 | Agent 自主判断 |
| 数据源 | 只看 Pneuma history.json | CC 原生历史（更丰富）+ 可扩展 |
| 输出格式 | 固定的 `preferences.md` | Agent 自由决定怎么改 skill |
| 扩展方式 | 改代码加 extractor | 加 directive / 加工具 |
| Mode 参与度 | 零 | Mode 定义演进方向 |
| 代码量 | ~7 个新文件，800+ 行 | 1 个核心文件，~200 行 |
| 信号检测 | 正则匹配（中/英双语） | Agent 理解语义 |

前一版 proposal 中仍有价值的部分：
- **数据基础分析**（§1.1）— 对现有数据源的梳理仍然有效
- **隐私原则**（§6.1）— 本地优先、透明可控、不存原文
- **成功指标**（§9）— 纠正率下降、会话效率提升等衡量标准仍适用

被替代的部分：
- §2-§5 的整个实现设计（三层模型、规则引擎、画像合并、衰减公式）
- 所有具体的数据结构（`UserProfile`、`UserTrait`、`ModePreferences`）
- CLAUDE.md 第四个 marker 区段（Agent 自己决定怎么改，不需要固定格式）

---

## 影响的文件（已实现）

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server/evolution-agent.ts` | **新增** | Evolution Agent 核心：prompt 组装 + CC CLI 执行 + proposal 解析 |
| `server/evolution-proposal.ts` | **新增** | Proposal 数据模型、存储、apply/rollback/discard + 格式化显示 |
| `server/__tests__/evolution-proposal.test.ts` | **新增** | 13 个单元测试覆盖 save/load/apply/rollback/discard |
| `core/types/mode-manifest.ts` | **修改** | 新增 `EvolutionConfig`、`EvolutionTool` 类型 |
| `core/types/index.ts` | **修改** | Re-export `EvolutionConfig`、`EvolutionTool` |
| `bin/pneuma.ts` | **修改** | 新增 `evolve` 子命令 + `handleEvolveCommand()` |
| `modes/slide/manifest.ts` | **修改** | 添加 `evolution.directive` |
| `modes/doc/manifest.ts` | **修改** | 添加 `evolution.directive` |
| `modes/draw/manifest.ts` | **修改** | 添加 `evolution.directive` |
