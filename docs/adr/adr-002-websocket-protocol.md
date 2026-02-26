# ADR-002: WebSocket 协议与消息桥接设计

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-003, ADR-009

---

## 1. 背景

Pneuma 的核心通信模型是 **双通道 WebSocket 桥接**：

```
Browser ←── WS (JSON) ──→ Pneuma Server ←── WS (NDJSON) ──→ Claude Code CLI
```

浏览器和 CLI 使用不同的协议格式，Server 作为消息路由器和翻译器，需要：
1. 维护两条独立的 WebSocket 连接
2. 双向翻译消息格式（标准格式 ↔ CLI 原生 NDJSON）
3. 处理连接生命周期（连接、断开、重连）
4. 消息排序与去重

### Companion 调研结论

Companion 实现了一个功能完整的 `WsBridge` 系统：
- **三类 WebSocket 端点**：`/ws/cli/:sessionId`（CLI 连接）、`/ws/browser/:sessionId`（浏览器连接）、`/ws/terminal/:id`（PTY，Pneuma 不需要）
- **事件序号系统**：每条消息有 `seq` 编号，支持断线重放
- **消息队列**：CLI 未连接时，浏览器消息排队等待
- **会话 ID 双轨**：Server 生成 UUID（路由用）+ CLI 生成 session_id（resume 用）
- **幂等性**：`client_msg_id` 去重防止重连后重复发送

---

## 2. 决策

### 2.1 双通道 WebSocket 端点

**采用 Companion 的双端点模式**，但简化为两条路由（不需要 terminal）：

| 端点 | 方向 | 协议 | 用途 |
|------|------|------|------|
| `/ws/browser/:sessionId` | Browser ↔ Server | JSON | 浏览器前端通信 |
| `/ws/cli/:sessionId` | CLI ↔ Server | NDJSON | Claude Code CLI 通信 |

### 2.2 标准消息格式

**Server 定义一套与 Agent 无关的标准消息格式**，Protocol Adapter（见 ADR-003）负责双向翻译。

### 2.3 消息排序与去重

**采用 Companion 的事件序号机制**，但简化 buffer 策略（MVP 不需要 600 条缓冲）。

---

## 3. 详细设计

### 3.1 WebSocket 端点

#### Browser WebSocket (`/ws/browser/:sessionId`)

```typescript
// 浏览器连接时
Bun.serve({
  websocket: {
    open(ws) {
      // ws.data.kind === "browser"
      // 1. 验证 sessionId 有效
      // 2. 注册到 session.browserSockets
      // 3. 发送 session_init (当前 session 状态)
      // 4. 发送缓冲的历史消息 (如果断线重连)
    },
    message(ws, raw) {
      // 解析 JSON → 路由到 handleBrowserMessage()
    },
    close(ws) {
      // 从 session.browserSockets 移除
    }
  }
});
```

#### CLI WebSocket (`/ws/cli/:sessionId`)

```typescript
// CLI 连接时 (claude --sdk-url ws://localhost:3210/ws/cli/:sessionId)
open(ws) {
  // ws.data.kind === "cli"
  // 1. 关联到 session
  // 2. 标记 CLI 已连接
  // 3. 通知浏览器: cli_connected
  // 4. 刷新排队的 pending messages
},
message(ws, raw) {
  // NDJSON 解析 → 逐行 JSON.parse → 路由到 routeCLIMessage()
},
close(ws) {
  // 标记 CLI 断开
  // 通知浏览器: cli_disconnected
}
```

### 3.2 Browser → Server 消息类型

```typescript
// ===== Browser 发送给 Server 的消息 =====

/** 用户发送编辑指令 */
interface BrowserUserMessage {
  type: "user_message";
  content: string;                    // 自然语言指令
  images?: Array<{                    // 可选图片附件
    media_type: string;
    data: string;                     // base64
  }>;
  uiContext?: UIContext;              // Editor Shell 自动附加的 UI 上下文
  client_msg_id?: string;            // 幂等性 ID
}

/** UI 上下文 (Editor Shell 自动注入) */
interface UIContext {
  mode: string;                       // "slide" | "doc" | "mindmap" | "canvas"
  currentView: string;                // mode-specific: "slide:3" | "scroll:1200" | "node:abc"
  selectedElement?: {
    selector: string;                 // CSS selector path
    tagName: string;                  // "h1", "p", "div" ...
    textContent: string;              // 元素文本内容 (截断)
    attributes?: Record<string, string>;
  };
}

/** 用户回复 tool 权限请求 */
interface BrowserPermissionResponse {
  type: "permission_response";
  request_id: string;                 // 关联 permission_request
  behavior: "allow" | "deny";
  updated_input?: Record<string, unknown>;  // 修改后的 tool 参数
  message?: string;                   // deny 时的理由
  client_msg_id?: string;
}

/** 用户中断当前操作 */
interface BrowserInterrupt {
  type: "interrupt";
  client_msg_id?: string;
}

/** 订阅 session 事件 (断线重连) */
interface BrowserSessionSubscribe {
  type: "session_subscribe";
  last_seq: number;                   // 浏览器最后收到的序号
}

/** 确认收到事件 (持久化裁剪) */
interface BrowserSessionAck {
  type: "session_ack";
  last_seq: number;
}

type BrowserOutgoingMessage =
  | BrowserUserMessage
  | BrowserPermissionResponse
  | BrowserInterrupt
  | BrowserSessionSubscribe
  | BrowserSessionAck;
```

### 3.3 Server → Browser 消息类型

```typescript
// ===== Server 发送给 Browser 的消息 =====

/** Session 初始化 (连接时发送) */
interface ServerSessionInit {
  type: "session_init";
  session: {
    session_id: string;
    model: string;
    cwd: string;
    tools: string[];
    permission_mode: string;
    mode: string;                     // Content Mode: "slide" | "doc" ...
  };
}

/** Session 状态更新 (增量) */
interface ServerSessionUpdate {
  type: "session_update";
  updates: Partial<SessionState>;
}

/** Agent streaming 事件 (token by token) */
interface ServerStreamEvent {
  type: "stream_event";
  event: StreamEventData;             // content_block_delta, message_start, etc.
  seq: number;
}

/** Agent 完整消息 (streaming 结束后) */
interface ServerAssistantMessage {
  type: "assistant";
  message: {
    id: string;
    role: "assistant";
    content: ContentBlock[];          // text | tool_use | tool_result | thinking
    stop_reason: string | null;
  };
  seq: number;
}

/** Agent 请求 tool 权限 */
interface ServerPermissionRequest {
  type: "permission_request";
  request: {
    request_id: string;
    tool_name: string;
    input: Record<string, unknown>;
    description?: string;
    tool_use_id: string;
  };
  seq: number;
}

/** 任务完成 */
interface ServerResult {
  type: "result";
  data: {
    subtype: "success" | "error_during_execution";
    is_error: boolean;
    duration_ms: number;
    num_turns: number;
    total_cost_usd: number;
  };
  seq: number;
}

/** 内容文件变更 (file watcher) */
interface ServerContentUpdate {
  type: "content_update";
  files: Array<{
    path: string;
    action: "created" | "modified" | "deleted";
  }>;
  seq: number;
}

/** CLI 连接状态 */
interface ServerCLIStatus {
  type: "cli_connected" | "cli_disconnected";
  seq: number;
}

/** 运行状态变更 */
interface ServerStatusChange {
  type: "status_change";
  status: "idle" | "running" | null;
  seq: number;
}

type ServerIncomingMessage =
  | ServerSessionInit
  | ServerSessionUpdate
  | ServerStreamEvent
  | ServerAssistantMessage
  | ServerPermissionRequest
  | ServerResult
  | ServerContentUpdate
  | ServerCLIStatus
  | ServerStatusChange;
```

### 3.4 WsBridge 核心实现

```typescript
interface BridgeSession {
  id: string;                         // Server 生成的 UUID
  cliSessionId?: string;              // CLI 报告的 session_id (用于 resume)
  cliSocket: WebSocket | null;        // CLI WebSocket 连接
  browserSockets: Set<WebSocket>;     // 多个浏览器 tab 可以同时连接
  state: SessionState;                // 当前 session 状态

  // 消息管理
  pendingMessages: string[];          // CLI 未连接时排队的消息
  pendingPermissions: Map<string, PermissionRequest>;  // 等待用户回复的权限请求

  // 事件序号 (断线重放)
  nextEventSeq: number;
  eventBuffer: Array<{ seq: number; message: ServerIncomingMessage }>;
  lastAckSeq: number;

  // 幂等性
  processedClientMsgIds: Set<string>;
}

class WsBridge {
  private sessions = new Map<string, BridgeSession>();

  // === CLI 消息处理 ===

  handleCLIOpen(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return ws.close(4004, "Session not found");

    session.cliSocket = ws;

    // 通知浏览器
    this.broadcastToBrowsers(session, { type: "cli_connected" });

    // 刷新排队消息
    this.flushPendingMessages(session);
  }

  handleCLIMessage(ws: WebSocket, sessionId: string, raw: string | Buffer): void {
    const data = typeof raw === "string" ? raw : raw.toString("utf-8");
    const lines = data.split("\n").filter(l => l.trim());

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        this.routeCLIMessage(sessionId, msg);
      } catch {
        console.warn(`[ws-bridge] Failed to parse NDJSON: ${line.slice(0, 200)}`);
      }
    }
  }

  // === Browser 消息处理 ===

  handleBrowserMessage(ws: WebSocket, sessionId: string, raw: string): void {
    const msg = JSON.parse(raw) as BrowserOutgoingMessage;

    // 幂等性检查
    if (msg.client_msg_id && this.isDuplicate(sessionId, msg.client_msg_id)) {
      return;
    }

    switch (msg.type) {
      case "user_message":
        this.handleUserMessage(sessionId, msg);
        break;
      case "permission_response":
        this.handlePermissionResponse(sessionId, msg);
        break;
      case "interrupt":
        this.handleInterrupt(sessionId);
        break;
      case "session_subscribe":
        this.handleSessionSubscribe(ws, sessionId, msg.last_seq);
        break;
      case "session_ack":
        this.handleSessionAck(sessionId, msg.last_seq);
        break;
    }
  }

  // === 消息路由 ===

  private routeCLIMessage(sessionId: string, msg: CLIMessage): void {
    // 由 Protocol Adapter 翻译为标准消息 (见 ADR-003)
    // 翻译后 broadcastToBrowsers()
  }

  // === 广播 ===

  broadcastToBrowsers(session: BridgeSession, msg: ServerIncomingMessage): void {
    // 1. 分配序号
    const seq = session.nextEventSeq++;
    const sequenced = { ...msg, seq };

    // 2. 缓冲 (用于断线重放)
    session.eventBuffer.push({ seq, message: sequenced });
    if (session.eventBuffer.length > 200) {
      session.eventBuffer.splice(0, session.eventBuffer.length - 200);
    }

    // 3. 发送给所有浏览器
    const payload = JSON.stringify(sequenced);
    for (const ws of session.browserSockets) {
      ws.send(payload);
    }
  }

  // === 发送给 CLI ===

  sendToCLI(session: BridgeSession, ndjson: string): void {
    if (!session.cliSocket) {
      // CLI 未连接，排队
      session.pendingMessages.push(ndjson);
      return;
    }
    session.cliSocket.send(ndjson + "\n");  // NDJSON 需要换行终止
  }

  private flushPendingMessages(session: BridgeSession): void {
    const pending = session.pendingMessages.splice(0);
    for (const msg of pending) {
      session.cliSocket!.send(msg + "\n");
    }
  }
}
```

### 3.5 NDJSON 解析注意事项

从 Companion 研究总结的关键边界情况：

```typescript
// 1. NDJSON = 每行一个完整 JSON 对象，以 \n 分隔
// 2. 一次 WebSocket message 可能包含多个 JSON 对象 (多行)
// 3. 空行要过滤掉
// 4. 解析失败要容忍 (warn + skip)，不能因一行错误断开整个连接
// 5. 发送时必须追加 \n 终止符: ws.send(json + "\n")

function parseNDJSON(raw: string | Buffer): unknown[] {
  const data = typeof raw === "string" ? raw : raw.toString("utf-8");
  const results: unknown[] = [];

  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      results.push(JSON.parse(trimmed));
    } catch (e) {
      console.warn(`[ndjson] Parse error: ${trimmed.slice(0, 200)}`);
    }
  }

  return results;
}
```

### 3.6 断线重连流程

```
Browser 断线后重连:

1. Browser 连接 /ws/browser/:sessionId
2. Browser 发送 { type: "session_subscribe", last_seq: 120 }
3. Server 检查 eventBuffer:
   ├─ 如果 eventBuffer 包含 seq > 120 的事件:
   │  └─ 逐个发送缺失事件 (增量重放)
   └─ 如果 eventBuffer 最早的 seq > 120 (gap 太大):
      └─ 发送完整 session_init + 消息历史 (全量重放)
4. 发送当前 status_change (修正浏览器状态)
```

### 3.7 消息流转时序图

```
┌─────────┐          ┌──────────┐          ┌──────────┐
│ Browser │          │  Server  │          │   CLI    │
│         │          │ (Bridge) │          │          │
└────┬────┘          └────┬─────┘          └────┬─────┘
     │                    │                      │
     │  [1] 连接          │                      │
     │── WS connect ─────►│                      │
     │◄── session_init ───│                      │
     │                    │                      │
     │  [2] 发送指令       │                      │
     │── user_message ───►│                      │
     │   { content,       │  translate:          │
     │     uiContext }    │  inject context      │
     │                    │── NDJSON ────────────►│
     │                    │  { type: "user",     │
     │                    │    message: {         │
     │                    │      role: "user",    │
     │                    │      content: [...]   │
     │                    │    }                  │
     │                    │  }                   │
     │                    │                      │
     │  [3] Streaming     │                      │
     │                    │◄── stream_event ──────│
     │◄── stream_event ───│                      │
     │                    │◄── stream_event ──────│
     │◄── stream_event ───│                      │
     │                    │                      │
     │  [4] 完整消息       │                      │
     │                    │◄── assistant ─────────│
     │◄── assistant ──────│                      │
     │                    │                      │
     │  [5] Tool 审批     │                      │
     │                    │◄── control_request ───│
     │◄── permission_req ─│                      │
     │                    │                      │
     │── permission_resp ►│                      │
     │                    │── control_response ──►│
     │                    │                      │
     │  [6] 文件变更       │                      │
     │                    │ (file watcher)        │
     │◄── content_update ─│                      │
     │   iframe reload    │                      │
     │                    │                      │
     │  [7] 任务完成       │                      │
     │                    │◄── result ────────────│
     │◄── result ─────────│                      │
     │                    │── status: idle ──────►│
     │◄── status_change ──│                      │
```

---

## 4. 关键设计决策

### 4.1 UI 上下文注入方式

**决策：文本前缀注入（MVP），结构化 JSON（后续）**

MVP 阶段，将 UI 上下文作为文本前缀注入用户消息：

```
[Context: Slide 3, selected: h1.title "技术方案"]
改大一点，加副标题
```

理由：
- Claude Code 原生理解自然语言上下文
- 不需要额外教 agent 解析 JSON
- SKILL.md 中已约定前缀格式
- Companion 也是将上下文拼接到用户消息中

### 4.2 事件缓冲大小

**决策：200 条（Companion 用 600 条）**

Pneuma 的场景更简单（单 session 居多），200 条足以覆盖大部分断线重连场景。超出 buffer 范围的重连走全量重放。

### 4.3 Session ID 双轨制

**决策：遵循 Companion 的双 ID 模式**

- **Server Session ID** — `crypto.randomUUID()`，用于 URL 路由和浏览器端标识
- **CLI Session ID** — CLI 在 `system/init` 消息中上报，用于 `--resume` 恢复

两个 ID 必须分开管理，因为：
- Server ID 在 CLI 启动前就需要（作为 `--sdk-url` 的路径参数）
- CLI ID 只有 CLI 连接后才知道
- `--resume` 必须用 CLI 的 ID 而非 Server 的 ID

---

## 5. 被否决的方案

### 5.1 HTTP Long Polling

- 否决原因：延迟过高，不适合 token-by-token streaming

### 5.2 Server-Sent Events (SSE)

- 否决原因：单向通信，browser→server 仍需 HTTP POST，增加复杂度
- Companion 的创建 session 用 SSE streaming，但正式通信全部用 WebSocket

### 5.3 统一 WebSocket 端点

```
# 否决: 用同一个 /ws/:sessionId 连接 browser 和 CLI
```
- 否决原因：browser 和 CLI 协议格式完全不同（JSON vs NDJSON），混用会增加解析复杂度
- Companion 也是分开的端点

---

## 6. 影响

1. **WebSocket 是 Pneuma 的命脉** — 必须保证连接稳定性和消息完整性
2. **Protocol Adapter 是核心抽象** — 不同 Agent Backend 只需替换 adapter（见 ADR-003）
3. **标准消息格式是框架契约** — Content Mode 和 Agent Backend 都依赖这套类型定义
4. **序号系统增加了少量存储开销** — 但保证了断线重连的正确性
