# ADR-009: Permission Flow 与 Tool 审批

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-002, ADR-003, ADR-005

---

## 1. 背景

Claude Code 在执行文件编辑、bash 命令等操作前，需要用户审批。这是安全模型的核心组成部分。

在 Pneuma 中，审批流程是：
```
CLI 想执行工具 → Server 转发请求到浏览器 → 用户在 UI 中 Allow/Deny → Server 转发回 CLI
```

### Companion 调研结论

Companion 实现了完整的三层权限决策管道：
1. **PreToolUse Hooks** — 本地 shell 脚本拦截
2. **Local Rules** — 基于 permission mode + allow/deny rules
3. **Remote Prompt** — WebSocket 远程审批

在 `--sdk-url` 模式下，只有通过第 1、2 层后仍需 "ask" 的请求才会发到 Server（即 Layer 3）。

关键细节：
- `control_request` 消息携带 `request_id` 用于关联响应
- 允许时 **必须** 返回 `updatedInput` 字段（即使不修改，也要回传原始 input）
- 支持 `permission_suggestions` — CLI 提供建议的权限规则更新
- 支持修改 tool input 后放行（如编辑 bash command 再允许）

---

## 2. 决策

### 2.1 完整实现 Permission Flow

**Pneuma 必须实现 permission flow** — 这是 Claude Code SDK 模式的必要组件。

如果不实现，CLI 发送 `control_request` 后会无限等待响应，导致 Agent 卡死。

### 2.2 默认 Permission Mode

**MVP 默认使用 `default` 模式**（所有 tool 需审批）。

未来可以根据 Content Mode 提供更宽松的默认值（如 Slide Mode 下自动允许文件编辑）。

### 2.3 简化 UI

**MVP 只实现 Allow/Deny 两个按钮**，不支持编辑 tool input 后放行。

---

## 3. 详细设计

### 3.1 Permission 请求-响应时序

```
┌─────────┐          ┌──────────┐          ┌──────────┐
│   CLI   │          │  Server  │          │ Browser  │
└────┬────┘          └────┬─────┘          └────┬─────┘
     │                    │                      │
     │ control_request    │                      │
     │ {                  │                      │
     │   type: "control_request",                │
     │   request_id: "uuid-1",                   │
     │   request: {                              │
     │     subtype: "can_use_tool",              │
     │     tool_name: "Edit",                    │
     │     input: {                              │
     │       file_path: "slides/slide-03.html",  │
     │       old_string: "...",                  │
     │       new_string: "..."                   │
     │     },                                    │
     │     tool_use_id: "tooluse_abc",           │
     │     description: "Edit slide 3 title"     │
     │   }                                       │
     │ }                  │                      │
     │───────────────────►│                      │
     │                    │                      │
     │                    │ permission_request    │
     │                    │ {                     │
     │                    │   type: "permission_request",
     │                    │   request: {          │
     │                    │     request_id: "uuid-1",
     │                    │     tool_name: "Edit",│
     │                    │     input: {...},     │
     │                    │     description: "..."│
     │                    │   }                   │
     │                    │ }                     │
     │                    │─────────────────────►│
     │                    │                      │
     │                    │                      │ 用户点击 "Allow"
     │                    │                      │
     │                    │ permission_response   │
     │                    │◄─────────────────────│
     │                    │ {                     │
     │                    │   type: "permission_response",
     │                    │   request_id: "uuid-1",
     │                    │   behavior: "allow"   │
     │                    │ }                     │
     │                    │                      │
     │ control_response   │                      │
     │ {                  │                      │
     │   type: "control_response",               │
     │   response: {                             │
     │     subtype: "success",                   │
     │     request_id: "uuid-1",                 │
     │     response: {                           │
     │       behavior: "allow",                  │
     │       updatedInput: {                     │
     │         file_path: "slides/slide-03.html",│
     │         old_string: "...",                │
     │         new_string: "..."                 │
     │       }                                   │
     │     }                                     │
     │   }                                       │
     │ }                  │                      │
     │◄───────────────────│                      │
     │                    │                      │
     │ (执行 Edit tool)   │                      │
```

### 3.2 Server 端处理

```typescript
// Permission 请求处理 (在 ws-bridge.ts 中)

function handleControlRequest(
  session: Session,
  msg: CLIControlRequest,
): void {
  if (msg.request.subtype !== "can_use_tool") {
    console.warn(`[permission] Unknown control_request subtype: ${msg.request.subtype}`);
    return;
  }

  const request: PermissionRequest = {
    request_id: msg.request_id,
    tool_name: msg.request.tool_name,
    input: msg.request.input,
    description: msg.request.description,
    tool_use_id: msg.request.tool_use_id,
    timestamp: Date.now(),
  };

  // 存入 pending map
  session.pendingPermissions.set(msg.request_id, request);

  // 推送给浏览器
  broadcastToBrowsers(session, {
    type: "permission_request",
    request,
  });

  // 持久化 (防止 server 重启丢失待处理的请求)
  store.save(session);
}

function handlePermissionResponse(
  session: Session,
  msg: BrowserPermissionResponse,
): void {
  const pending = session.pendingPermissions.get(msg.request_id);
  if (!pending) {
    console.warn(`[permission] Unknown request_id: ${msg.request_id}`);
    return;
  }

  // 构造 CLI control_response
  const response: any = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: msg.request_id,
      response: {
        behavior: msg.behavior,
      },
    },
  };

  if (msg.behavior === "allow") {
    // 关键: 必须回传 updatedInput (即使未修改)
    response.response.response.updatedInput =
      msg.updated_input || pending.input;
  }

  if (msg.behavior === "deny" && msg.message) {
    response.response.response.message = msg.message;
  }

  // 发送给 CLI
  sendToCLI(session, JSON.stringify(response));

  // 清除 pending
  session.pendingPermissions.delete(msg.request_id);

  // 持久化
  store.save(session);
}
```

### 3.3 前端 Permission UI

```typescript
// PermissionBanner 的完整实现

interface PermissionBannerProps {
  request: PermissionRequest;
  onRespond: (requestId: string, behavior: "allow" | "deny") => void;
}

export function PermissionBanner({ request, onRespond }: PermissionBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // 根据 tool 类型选择展示方式
  const renderInput = () => {
    switch (request.tool_name) {
      case "Bash":
        return (
          <div className="mt-2">
            <div className="text-xs text-gray-500 mb-1">Command:</div>
            <pre className="rounded bg-gray-900 text-green-400 p-2 text-xs font-mono overflow-x-auto">
              {(request.input as any).command}
            </pre>
          </div>
        );

      case "Edit":
        return (
          <div className="mt-2 space-y-1">
            <div className="text-xs text-gray-500">
              File: <code>{(request.input as any).file_path}</code>
            </div>
            {expanded && (
              <pre className="rounded bg-gray-100 dark:bg-gray-800 p-2 text-xs overflow-x-auto max-h-48">
                {JSON.stringify(request.input, null, 2)}
              </pre>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-500 hover:underline"
            >
              {expanded ? "Hide details" : "Show details"}
            </button>
          </div>
        );

      case "Write":
        return (
          <div className="mt-2">
            <div className="text-xs text-gray-500">
              File: <code>{(request.input as any).file_path}</code>
            </div>
            <div className="text-xs text-gray-500">
              Content: {((request.input as any).content?.length || 0)} chars
            </div>
          </div>
        );

      default:
        return (
          <pre className="mt-2 rounded bg-gray-100 dark:bg-gray-800 p-2 text-xs overflow-x-auto max-h-32">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        );
    }
  };

  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-300 dark:border-amber-700
                    bg-amber-50 dark:bg-amber-950/50 p-3 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 dark:text-amber-400 text-sm">
              Tool: <strong>{request.tool_name}</strong>
            </span>
          </div>

          {request.description && (
            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {request.description}
            </div>
          )}

          {renderInput()}
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            onClick={() => onRespond(request.request_id, "allow")}
            className="rounded-md px-3 py-1.5 text-xs font-medium
                       bg-green-600 text-white hover:bg-green-700
                       transition-colors"
          >
            Allow
          </button>
          <button
            onClick={() => onRespond(request.request_id, "deny")}
            className="rounded-md px-3 py-1.5 text-xs font-medium
                       bg-red-600 text-white hover:bg-red-700
                       transition-colors"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 3.4 Permission Mode 支持

```typescript
// 未来: 支持切换 permission mode

type PermissionMode =
  | "default"           // 所有 tool 需审批
  | "acceptEdits"       // 文件编辑自动允许，其他需审批
  | "bypassPermissions" // 全部自动允许
  ;

// MVP: 只支持 "default"
// Phase 2: 在 UI 中添加 mode 切换器
// Phase 2: Slide Mode 可以默认 "acceptEdits" (Agent 主要操作 HTML 文件)
```

### 3.5 Permission 快捷操作 (Phase 2)

```
Phase 2 增强:
- "Allow All" 按钮 → 切换到 bypassPermissions 模式
- "Allow File Edits" → 切换到 acceptEdits 模式
- 记住 tool 类型的选择 (如 "Always allow Read")
- 编辑 tool input 后放行 (如修改 bash command)
```

---

## 4. 关键设计决策

### 4.1 `updatedInput` 必须回传

**即使用户未修改 input，Allow 时也必须回传原始 input 作为 `updatedInput`。**

这是 Companion 代码中明确处理的协议要求。如果不传 `updatedInput`，CLI 可能不执行工具。

### 4.2 Permission 请求不超时

**Server 端不对 permission 请求设置超时。**

理由：
- 用户可能需要时间审查复杂的操作
- CLI 会一直等待直到收到响应（或连接断开）
- 如果浏览器断开，pending permission 会持久化，浏览器重连后仍可响应

### 4.3 多个 Pending Permission

**支持同时有多个待处理的 permission 请求。**

场景：Claude Code 在 subagent 模式下，可能同时有多个 tool 等待审批。

UI 上表现为 permission banner 堆叠在消息流中。

### 4.4 MVP 不支持 Input 编辑

**MVP 只有 Allow/Deny，不支持修改 tool input 后放行。**

理由：
- Input 编辑 UI 复杂（不同 tool 有不同的 input 结构）
- Slide Mode 场景下，Agent 的操作通常是合理的（编辑 HTML 文件）
- Phase 2 可以添加

---

## 5. 被否决的方案

### 5.1 自动 Allow 所有请求

- 否决原因：安全风险；Claude Code 可能执行危险操作（如 bash rm -rf）
- 即使是 Slide Mode，Agent 也可能执行 bash 命令或修改非预期文件

### 5.2 白名单模式 (只允许特定 tool)

- 否决原因：MVP 过于复杂；Claude Code 的 permission mode 系统已经提供了这个能力
- Phase 2 可以利用 `--allowedTools` 参数限制 Agent 可用的 tool

---

## 6. 影响

1. **每次 tool 使用都需要用户审批** — 频繁操作时体验不够流畅
2. **Phase 2 的 mode 切换将大幅改善体验** — `acceptEdits` 模式下文件编辑自动通过
3. **Permission 持久化增加存储** — pending permission 包含 tool input（可能很大）
4. **安全由 Claude Code 的权限模型保障** — Pneuma 不做额外的安全检查
