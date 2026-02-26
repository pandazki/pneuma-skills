# ADR-003: Claude Code Backend 集成

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-002, ADR-009

---

## 1. 背景

Claude Code Backend 是 Pneuma MVP 的唯一 Agent Backend。它需要：

1. **Spawn Claude Code CLI** — 以 headless 模式启动，通过 `--sdk-url` 连接 WebSocket
2. **NDJSON 协议适配** — 将 CLI 的原生 NDJSON 消息翻译为 Pneuma 标准消息
3. **Permission 处理** — 桥接 CLI 的 tool 审批请求到浏览器
4. **Session 恢复** — 支持 `--resume` 恢复之前的对话

### `--sdk-url` 协议 (未公开)

这是 Claude Code CLI 的一个隐藏 flag，允许 CLI 作为 WebSocket **客户端**连接到外部 server。Companion 项目通过逆向工程完整记录了此协议（`WEBSOCKET_PROTOCOL_REVERSED.md`）。

**关键事实：**
- Claude Code CLI 是 WebSocket **客户端**，不是 server
- 使用用户的 **Claude Max 订阅**，无需 API key
- 通信格式：NDJSON (Newline-Delimited JSON) over WebSocket
- 支持 streaming (`--verbose --include-partial-messages`)
- 支持 session resume (`--resume <cli-session-id>`)

### 风险

`--sdk-url` 是未公开 API，Anthropic 可能随时修改或移除。缓解措施：
- Backend 可插拔架构，协议变化只影响 `backends/claude-code/`
- Companion 社区 395+ stars，形成用户依赖，Anthropic 不太可能无替代方案直接移除
- 密切跟踪 Companion 更新

---

## 2. 决策

### 2.1 完全采用 Companion 的 CLI 启动方式

照搬 Companion 的 `cli-launcher.ts` 核心逻辑，包括：
- 完整的 CLI 参数构建
- `Bun.spawn()` 进程管理
- PATH 环境变量增强（支持 nvm/fnm 等版本管理器）
- 进程退出检测与重启

### 2.2 提取而非依赖 Companion

直接提取 Companion 的协议处理代码到 `backends/claude-code/`，标注 MIT License 来源。

---

## 3. 详细设计

### 3.1 CLI 启动命令

```bash
claude \
  --sdk-url ws://localhost:3210/ws/cli/<sessionId> \
  --print \
  --output-format stream-json \
  --input-format stream-json \
  --include-partial-messages \
  --verbose \
  --model <model> \
  --permission-mode <mode> \
  -p ""
```

**参数说明：**

| 参数 | 值 | 用途 |
|------|-----|------|
| `--sdk-url` | `ws://localhost:PORT/ws/cli/UUID` | CLI 连接的 WebSocket 地址 |
| `--print` | (flag) | Headless 模式，不启动交互 TUI |
| `--output-format` | `stream-json` | 输出 NDJSON 格式 |
| `--input-format` | `stream-json` | 输入 NDJSON 格式 |
| `--include-partial-messages` | (flag) | 启用 streaming token |
| `--verbose` | (flag) | 输出 `stream_event` 消息 |
| `--model` | e.g. `claude-sonnet-4-5-20250929` | 使用的模型 |
| `--permission-mode` | e.g. `default` | 权限模式 |
| `-p ""` | 空字符串 | 空初始 prompt，等待 WebSocket 输入 |
| `--resume` | CLI session ID (可选) | 恢复已有 session |

### 3.2 Spawner 实现

```typescript
// backends/claude-code/spawner.ts

interface SpawnOptions {
  sessionId: string;            // Server session UUID
  port: number;                 // WebSocket server port
  cwd: string;                  // 工作目录
  model?: string;               // 模型选择
  permissionMode?: string;      // 权限模式
  resumeCliSessionId?: string;  // CLI session ID (用于 resume)
  env?: Record<string, string>; // 额外环境变量
}

interface SpawnedProcess {
  proc: import("bun").Subprocess;
  sessionId: string;
  cliSessionId?: string;        // CLI 报告后填充
  state: "starting" | "connected" | "running" | "exited";
  exitCode?: number;
  spawnedAt: number;
}

async function spawnClaudeCode(options: SpawnOptions): Promise<SpawnedProcess> {
  const binary = await findClaudeBinary();

  const args = [
    "--sdk-url", `ws://localhost:${options.port}/ws/cli/${options.sessionId}`,
    "--print",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];

  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.permissionMode) {
    args.push("--permission-mode", options.permissionMode);
  }
  if (options.resumeCliSessionId) {
    args.push("--resume", options.resumeCliSessionId);
  }

  // 空 prompt 占位
  args.push("-p", "");

  const proc = Bun.spawn([binary, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      CLAUDECODE: undefined,    // 取消设置，避免 CLI 自动检测
      ...options.env,
      PATH: getEnrichedPath(),  // 增强 PATH
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const spawned: SpawnedProcess = {
    proc,
    sessionId: options.sessionId,
    state: "starting",
    spawnedAt: Date.now(),
  };

  // 监控进程退出
  proc.exited.then(exitCode => {
    spawned.state = "exited";
    spawned.exitCode = exitCode ?? undefined;

    // 快速退出且有 resume → resume 失败，清除 cliSessionId
    const uptime = Date.now() - spawned.spawnedAt;
    if (uptime < 5000 && options.resumeCliSessionId) {
      spawned.cliSessionId = undefined;
    }
  });

  return spawned;
}
```

### 3.3 查找 Claude 二进制

```typescript
async function findClaudeBinary(): Promise<string> {
  // 1. 检查 PATH 中是否有 claude
  // 2. 检查常见安装位置
  //    - ~/.claude/local/claude (npm global)
  //    - /usr/local/bin/claude
  //    - ~/.local/bin/claude
  // 3. 检查 Bun global: bun pm ls -g
  // 4. 都找不到 → 抛出友好错误

  const { exitCode, stdout } = Bun.spawnSync(["which", "claude"]);
  if (exitCode === 0) {
    return stdout.toString().trim();
  }

  // Fallback 路径
  const fallbacks = [
    `${process.env.HOME}/.claude/local/claude`,
    "/usr/local/bin/claude",
  ];

  for (const path of fallbacks) {
    if (await Bun.file(path).exists()) {
      return path;
    }
  }

  throw new Error(
    "Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code"
  );
}
```

### 3.4 PATH 环境变量增强

从 Companion 学到的关键模式 — 很多用户通过 nvm/fnm/volta 安装 Claude Code，需要增强 PATH：

```typescript
function getEnrichedPath(): string {
  const home = process.env.HOME || "";
  const currentPath = process.env.PATH || "";

  const extraPaths = [
    `${home}/.nvm/versions/node/*/bin`,      // nvm
    `${home}/.fnm/aliases/default/bin`,       // fnm
    `${home}/.volta/bin`,                     // volta
    `${home}/.local/bin`,                     // pipx / user local
    "/usr/local/bin",
    `${home}/.bun/bin`,                       // bun global
  ];

  // 解析 glob 并去重
  const resolved = extraPaths
    .flatMap(p => p.includes("*") ? Bun.$.glob(p) : [p])
    .filter(p => existsSync(p));

  return [...new Set([...resolved, ...currentPath.split(":")])].join(":");
}
```

### 3.5 Protocol Adapter (NDJSON ↔ 标准消息)

```typescript
// backends/claude-code/protocol-adapter.ts

import type {
  BrowserUserMessage,
  BrowserPermissionResponse,
  ServerStreamEvent,
  ServerAssistantMessage,
  ServerPermissionRequest,
  ServerResult,
} from "../../core/types/messages";

// ===== CLI → Server (入站翻译) =====

interface CLISystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  model: string;
  cwd: string;
  permission_mode: string;
  mcp_servers: Array<{ name: string; status: string }>;
}

interface CLIAssistant {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    content: ContentBlock[];
    stop_reason: string | null;
    usage: TokenUsage;
  };
  parent_tool_use_id: string | null;
  session_id: string;
}

interface CLIStreamEvent {
  type: "stream_event";
  event: StreamEventData;
  parent_tool_use_id: string | null;
  session_id: string;
}

interface CLIResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  num_turns: number;
  total_cost_usd: number;
  session_id: string;
}

interface CLIControlRequest {
  type: "control_request";
  request_id: string;
  request: {
    subtype: "can_use_tool";
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id: string;
    description?: string;
  };
}

interface CLIToolProgress {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  elapsed_time_seconds: number;
}

type CLIMessage =
  | CLISystemInit
  | CLIAssistant
  | CLIStreamEvent
  | CLIResult
  | CLIControlRequest
  | CLIToolProgress
  | { type: "keep_alive" };

// ===== 翻译函数 =====

/** CLI 消息 → 标准消息 */
function translateIncoming(msg: CLIMessage): ServerIncomingMessage | null {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        return {
          type: "session_init",
          session: {
            session_id: msg.session_id,
            model: msg.model,
            cwd: msg.cwd,
            tools: msg.tools,
            permission_mode: msg.permission_mode,
          },
        };
      }
      return null;  // 其他 system subtype 暂不处理

    case "assistant":
      return {
        type: "assistant",
        message: msg.message,
      };

    case "stream_event":
      return {
        type: "stream_event",
        event: msg.event,
      };

    case "result":
      return {
        type: "result",
        data: {
          subtype: msg.subtype,
          is_error: msg.is_error,
          duration_ms: msg.duration_ms,
          num_turns: msg.num_turns,
          total_cost_usd: msg.total_cost_usd,
        },
      };

    case "control_request":
      return {
        type: "permission_request",
        request: {
          request_id: msg.request_id,
          tool_name: msg.request.tool_name,
          input: msg.request.input,
          description: msg.request.description,
          tool_use_id: msg.request.tool_use_id,
        },
      };

    case "tool_progress":
      // MVP 可以忽略，或转发给浏览器显示 loading 时间
      return null;

    case "keep_alive":
      return null;  // 静默消费

    default:
      console.warn(`[protocol-adapter] Unknown CLI message type: ${(msg as any).type}`);
      return null;
  }
}

// ===== Server → CLI (出站翻译) =====

/** 用户消息 → CLI NDJSON */
function translateUserMessage(msg: BrowserUserMessage, uiContextText: string): string {
  // 将 UI 上下文注入到消息内容中
  const content = uiContextText
    ? `${uiContextText}\n\n${msg.content}`
    : msg.content;

  const cliMsg = {
    type: "user",
    message: {
      role: "user" as const,
      content: [
        { type: "text", text: content },
        // 如果有图片附件
        ...(msg.images?.map(img => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.media_type,
            data: img.data,
          },
        })) ?? []),
      ],
    },
  };

  return JSON.stringify(cliMsg);
}

/** UI 上下文 → 文本前缀 */
function formatUIContext(ctx?: UIContext): string {
  if (!ctx) return "";

  let prefix = `[Context: ${ctx.mode}`;
  prefix += `, view: ${ctx.currentView}`;

  if (ctx.selectedElement) {
    const el = ctx.selectedElement;
    const text = el.textContent.length > 50
      ? el.textContent.slice(0, 50) + "..."
      : el.textContent;
    prefix += `, selected: ${el.tagName}${el.selector} "${text}"`;
  }

  prefix += "]";
  return prefix;
}

/** 权限回复 → CLI control_response */
function translatePermissionResponse(msg: BrowserPermissionResponse): string {
  const cliMsg = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: msg.request_id,
      response: {
        behavior: msg.behavior,
        ...(msg.behavior === "allow" && msg.updated_input
          ? { updatedInput: msg.updated_input }
          : {}),
        ...(msg.behavior === "deny" && msg.message
          ? { message: msg.message }
          : {}),
      },
    },
  };

  return JSON.stringify(cliMsg);
}

/** 中断 → CLI control_request */
function translateInterrupt(): string {
  return JSON.stringify({
    type: "control_request",
    request: { subtype: "interrupt" },
  });
}
```

### 3.6 Content Block 类型

```typescript
// 与 Anthropic API 一致的 Content Block 类型

type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock;

interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}
```

### 3.7 Stream Event 类型

```typescript
// Anthropic SDK 的 streaming event 格式

type StreamEventData =
  | { type: "message_start"; message: { id: string; role: string } }
  | { type: "content_block_start"; index: number; content_block: ContentBlock }
  | { type: "content_block_delta"; index: number; delta: ContentDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string }; usage: { output_tokens: number } }
  | { type: "message_stop" };

type ContentDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "input_json_delta"; partial_json: string };
```

### 3.8 AgentBackend 接口实现

```typescript
// backends/claude-code/index.ts

import type { AgentBackend, SpawnOptions, AgentProcess } from "../../core/types/agent-backend";

export class ClaudeCodeBackend implements AgentBackend {
  name = "claude-code" as const;

  capabilities = {
    streaming: true,
    permissions: true,
    resume: true,
    subagents: true,    // Claude Code 支持 Task tool 调度子 agent
  };

  async spawn(options: SpawnOptions): Promise<AgentProcess> {
    const spawned = await spawnClaudeCode({
      sessionId: options.sessionId,
      port: options.port,
      cwd: options.cwd,
      model: options.model,
      permissionMode: options.permissionMode,
    });

    return {
      id: options.sessionId,
      spawned,
      kill: () => spawned.proc.kill(),
    };
  }

  async resume(sessionId: string, cliSessionId: string, options: SpawnOptions): Promise<AgentProcess> {
    const spawned = await spawnClaudeCode({
      ...options,
      resumeCliSessionId: cliSessionId,
    });

    return {
      id: sessionId,
      spawned,
      kill: () => spawned.proc.kill(),
    };
  }

  async kill(process: AgentProcess): Promise<void> {
    process.spawned.proc.kill();
  }

  // Protocol Adapter 方法委托给 protocol-adapter.ts
  translateIncoming = translateIncoming;
  translateUserMessage = translateUserMessage;
  translatePermissionResponse = translatePermissionResponse;
  translateInterrupt = translateInterrupt;
  formatUIContext = formatUIContext;
}
```

---

## 4. 关键设计决策

### 4.1 `CLAUDECODE` 环境变量

**必须 `unset CLAUDECODE`**（设为 `undefined`）。

Companion 代码中明确处理了这个问题：如果 `CLAUDECODE` 环境变量存在，Claude Code CLI 会认为自己已经在一个 agent 上下文中运行，行为会不同。Pneuma 需要 CLI 以独立模式运行。

### 4.2 空 Prompt 占位

使用 `-p ""` 启动 CLI，这会让 CLI：
1. 不进入交互模式
2. 不发送初始消息到 LLM
3. 等待 WebSocket 接收第一条 `user` 消息

这是 Companion 验证过的模式。

### 4.3 Permission Mode 默认值

**MVP 默认 `default` 模式**（需要审批 tool 使用）。

- `bypassPermissions` — 跳过所有审批，自动允许所有 tool
- `acceptEdits` — 自动允许文件编辑，其他 tool 仍需审批
- `default` — 所有 tool 需审批

用户可以在 UI 中切换模式。Slide Mode 的使用场景中，Claude Code 主要操作 HTML/CSS 文件，安全风险较低，未来可以默认 `acceptEdits`。

### 4.4 Resume 快速失败检测

从 Companion 学到的模式：如果 CLI 在 resume 后 5 秒内退出，说明 resume 失败（可能 session 已损坏）。此时清除 `cliSessionId`，下次会创建全新 session。

---

## 5. 被否决的方案

### 5.1 通过 API 调用 Claude (而非 CLI)

- 否决原因：需要 API key + 额外成本；CLI 自带 tool 使用（文件编辑、bash 等）无需自己实现
- `--sdk-url` 模式让 CLI 成为一个完整的 Code Agent，只需要桥接通信

### 5.2 通过 stdin/stdout 与 CLI 通信

- 否决原因：Claude Code 的 `--sdk-url` WebSocket 模式更可靠
- stdin/stdout 有缓冲问题、难以处理并发消息
- Companion 也从早期的 stdio 模式迁移到了 WebSocket

### 5.3 嵌入 Claude Code 作为 library

- 否决原因：Claude Code 不提供 library API，只提供 CLI
- 未来可能会有 SDK，但目前 CLI + WebSocket 是唯一可行方案

---

## 6. 影响

1. **用户需要安装 Claude Code CLI** — 前置条件
2. **用户需要 Claude Max 订阅** — CLI 使用订阅额度
3. **协议可能变化** — 需要跟踪 Companion 更新
4. **`--sdk-url` 是隐藏 flag** — 不在官方文档中，依赖逆向工程
5. **进程管理复杂度** — 需要处理 CLI 崩溃、超时、僵尸进程等
