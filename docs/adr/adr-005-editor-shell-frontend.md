# ADR-005: Editor Shell 前端架构

> **状态**: Accepted
> **日期**: 2026-02-26
> **决策者**: Pandazki
> **关联**: ADR-001, ADR-002, ADR-004

---

## 1. 背景

Editor Shell 是 Pneuma 的通用前端层，提供：
1. **Content Mode 渲染框架** — 加载不同 Mode 的 Navigator + Preview 组件
2. **对话交互** — 输入编辑指令 + streaming 响应展示
3. **Tool 审批** — 展示 Agent 的 tool 使用请求，用户 allow/deny
4. **WebSocket 通信** — 连接 Pneuma Server，收发消息
5. **元素选中** — 与 iframe 内容交互，选中元素提供上下文

### Companion 调研结论

Companion 前端特征：
- React 19 + Vite 6 + Tailwind CSS 4 + Zustand 5
- hash-based routing（无 router 库）
- Zustand Map-based store（高效多 session 管理）
- 三层 streaming 状态：streaming draft → final message → committed
- 代码分割 (lazy loading) + PWA
- react-resizable-panels 用于面板分割
- 79 个 React 组件，生产级

Pneuma Editor Shell 比 Companion 简单很多 — 不需要终端、文件编辑器、Git 集成、多 session 等。核心是 **内容预览 + 对话 + tool 审批**。

---

## 2. 决策

### 2.1 技术栈

| 选型 | 理由 |
|------|------|
| React 19 | Companion 验证、生态最佳 |
| Vite 6 | 开发 HMR、构建快 |
| Tailwind CSS 4 | utility-first、无需设计系统 |
| Zustand 5 | 轻量 store、无 boilerplate |
| 原生 WebSocket | 浏览器内置、不需要 socket.io 等封装 |
| react-resizable-panels | 面板分割 (Navigator | Preview)、Companion 验证 |

### 2.2 单 Session 设计

**MVP 只支持单 session** — 一个浏览器 tab 对应一个 session。

理由：
- Pneuma 是本地工具，不需要多 session 管理
- 简化 store 设计（不需要 Map-based session 分离）
- Phase 2 可以支持多 tab 多 session

### 2.3 无路由

**MVP 不需要 router** — 只有一个页面（编辑器）。

---

## 3. 详细设计

### 3.1 组件结构

```
App
├── TopBar
│   ├── 项目标题 (from manifest)
│   ├── Mode 标识 ("Slide")
│   └── 工具栏 (演示模式 / 主题切换 / 导出)
│
├── MainLayout (react-resizable-panels)
│   ├── Panel: ModeRenderer
│   │   ├── NavigatorComponent (由 ContentMode 提供)
│   │   └── PreviewComponent (由 ContentMode 提供)
│   │
│   └── Panel: ChatPanel (可折叠/调整大小)
│       ├── StatusBar (CLI 连接状态 / running / idle)
│       ├── MessageList
│       │   ├── UserMessage
│       │   ├── AssistantMessage (支持 streaming)
│       │   └── PermissionBanner (嵌入消息流中)
│       └── ChatInput
│
└── ConnectionOverlay (CLI 未连接时的 loading 状态)
```

### 3.2 面板布局

```
┌─────────────────────────────────────────────────────────┐
│  TopBar: [Logo] Pneuma · Slide  │  [演示] [主题] [导出]  │
├─────────────┬───────────────────────────────┬───────────┤
│             │                               │           │
│  Navigator  │     Content Preview           │   Chat    │
│  (列表/大纲) │     (iframe / 渲染器)          │   Panel   │
│             │                               │           │
│  ■ 1. 封面  │  ┌─────────────────────────┐  │  Messages │
│    2. 背景  │  │                         │  │  ........  │
│    3. 方案  │  │   Slide Content         │  │  ........  │
│    4. 数据  │  │   (可选中元素)            │  │           │
│             │  │                         │  │  [Input]  │
│  [+ 新页]   │  └─────────────────────────┘  │  [Send]   │
│             │                               │           │
├─────────────┴───────────────────────────────┴───────────┤
│  StatusBar: 🟢 Connected · Claude Sonnet 4.5 · Idle      │
└─────────────────────────────────────────────────────────┘

宽度比例 (可调):
  Navigator: ~15% (min 120px)
  Preview: ~55% (flex)
  ChatPanel: ~30% (min 280px, collapsible)
```

### 3.3 Zustand Store

```typescript
// core/editor-shell/store/editor-store.ts

import { create } from "zustand";

interface EditorState {
  // === 连接状态 ===
  sessionId: string | null;
  connectionStatus: "connecting" | "connected" | "disconnected";
  cliConnected: boolean;
  sessionStatus: "idle" | "running" | null;

  // === Session 信息 ===
  model: string | null;
  cwd: string | null;
  tools: string[];

  // === Content Mode ===
  modeName: string;                    // "slide"
  contentStructure: ContentStructure | null;
  activeItem: string;                  // e.g. "slide-01"
  contentBaseUrl: string;              // e.g. "http://localhost:3210/content/"
  contentVersion: number;              // 递增计数器，触发 iframe reload

  // === 元素选中 ===
  selectedElement: SelectedElement | null;

  // === 消息 ===
  messages: ChatMessage[];
  streamingText: string | null;        // 当前 streaming 中的文本
  streamingStartedAt: number | null;

  // === 权限 ===
  pendingPermissions: Map<string, PermissionRequest>;

  // === Actions ===
  setConnectionStatus: (status: EditorState["connectionStatus"]) => void;
  setCLIConnected: (connected: boolean) => void;
  setSessionStatus: (status: EditorState["sessionStatus"]) => void;
  setContentStructure: (structure: ContentStructure) => void;
  setActiveItem: (itemId: string) => void;
  setSelectedElement: (element: SelectedElement | null) => void;
  incrementContentVersion: () => void;

  // 消息管理
  addMessage: (msg: ChatMessage) => void;
  updateStreamingText: (text: string) => void;
  finalizeStreaming: (message: ChatMessage) => void;
  clearStreaming: () => void;

  // 权限管理
  addPermission: (request: PermissionRequest) => void;
  removePermission: (requestId: string) => void;
}

type ChatMessage = {
  id: string;
  timestamp: number;
} & (
  | { role: "user"; content: string }
  | { role: "assistant"; content: ContentBlock[]; isStreaming?: boolean }
  | { role: "system"; content: string; subtype: "error" | "info" }
);

export const useEditorStore = create<EditorState>((set, get) => ({
  // 初始状态
  sessionId: null,
  connectionStatus: "connecting",
  cliConnected: false,
  sessionStatus: null,
  model: null,
  cwd: null,
  tools: [],
  modeName: "slide",
  contentStructure: null,
  activeItem: "",
  contentBaseUrl: "",
  contentVersion: 0,
  selectedElement: null,
  messages: [],
  streamingText: null,
  streamingStartedAt: null,
  pendingPermissions: new Map(),

  // Actions
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCLIConnected: (connected) => set({ cliConnected: connected }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setContentStructure: (structure) => set({ contentStructure: structure }),
  setActiveItem: (itemId) => set({ activeItem: itemId }),
  setSelectedElement: (element) => set({ selectedElement: element }),
  incrementContentVersion: () => set(s => ({ contentVersion: s.contentVersion + 1 })),

  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),

  updateStreamingText: (text) => set({
    streamingText: text,
    streamingStartedAt: get().streamingStartedAt ?? Date.now(),
  }),

  finalizeStreaming: (message) => set(s => ({
    messages: [...s.messages, message],
    streamingText: null,
    streamingStartedAt: null,
  })),

  clearStreaming: () => set({
    streamingText: null,
    streamingStartedAt: null,
  }),

  addPermission: (request) => set(s => {
    const next = new Map(s.pendingPermissions);
    next.set(request.request_id, request);
    return { pendingPermissions: next };
  }),

  removePermission: (requestId) => set(s => {
    const next = new Map(s.pendingPermissions);
    next.delete(requestId);
    return { pendingPermissions: next };
  }),
}));
```

### 3.4 WebSocket Hook

```typescript
// core/editor-shell/hooks/useWebSocket.ts

import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "../store/editor-store";

interface UseWebSocketOptions {
  sessionId: string;
  onContentUpdate?: (files: Array<{ path: string; action: string }>) => void;
}

export function useWebSocket({ sessionId, onContentUpdate }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const store = useEditorStore;

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws/browser/${sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    store.getState().setConnectionStatus("connecting");

    ws.onopen = () => {
      store.getState().setConnectionStatus("connected");

      // 如果是重连，发送 session_subscribe 恢复事件流
      if (lastSeqRef.current > 0) {
        ws.send(JSON.stringify({
          type: "session_subscribe",
          last_seq: lastSeqRef.current,
        }));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      // 更新序号
      if (msg.seq != null) {
        lastSeqRef.current = Math.max(lastSeqRef.current, msg.seq);
      }

      handleMessage(msg, store, onContentUpdate);
    };

    ws.onclose = () => {
      store.getState().setConnectionStatus("disconnected");

      // 自动重连 (2 秒延迟)
      setTimeout(() => {
        // reconnect 逻辑
      }, 2000);
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const send = useCallback((msg: BrowserOutgoingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        ...msg,
        client_msg_id: crypto.randomUUID(),
      }));
    }
  }, []);

  return { send };
}

function handleMessage(
  msg: ServerIncomingMessage,
  store: typeof useEditorStore,
  onContentUpdate?: (files: any[]) => void,
) {
  const state = store.getState();

  switch (msg.type) {
    case "session_init":
      // 初始化 session 状态
      state.setCLIConnected(true);
      break;

    case "stream_event":
      handleStreamEvent(msg.event, store);
      break;

    case "assistant":
      state.finalizeStreaming({
        id: msg.message.id,
        role: "assistant",
        content: msg.message.content,
        timestamp: Date.now(),
      });
      break;

    case "permission_request":
      state.addPermission(msg.request);
      break;

    case "result":
      state.setSessionStatus("idle");
      break;

    case "content_update":
      // 文件变更 → 刷新预览
      state.incrementContentVersion();
      onContentUpdate?.(msg.files);
      break;

    case "cli_connected":
      state.setCLIConnected(true);
      break;

    case "cli_disconnected":
      state.setCLIConnected(false);
      break;

    case "status_change":
      state.setSessionStatus(msg.status);
      break;
  }
}

function handleStreamEvent(event: StreamEventData, store: typeof useEditorStore) {
  const state = store.getState();

  switch (event.type) {
    case "content_block_delta":
      if (event.delta.type === "text_delta") {
        const current = state.streamingText ?? "";
        state.updateStreamingText(current + event.delta.text);
      }
      break;

    case "message_start":
      state.updateStreamingText("");
      state.setSessionStatus("running");
      break;
  }
}
```

### 3.5 核心 UI 组件

#### ChatInput

```typescript
// core/editor-shell/components/ChatInput.tsx

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-3">
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={placeholder || "描述你想要的修改..."}
          disabled={disabled}
          className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-800 px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500
                     disabled:opacity-50"
          rows={2}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !input.trim()}
          className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm text-white
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

#### StreamingResponse

```typescript
// core/editor-shell/components/StreamingResponse.tsx

interface StreamingResponseProps {
  text: string | null;
  startedAt: number | null;
}

export function StreamingResponse({ text, startedAt }: StreamingResponseProps) {
  if (text == null) return null;

  const elapsed = startedAt
    ? Math.floor((Date.now() - startedAt) / 1000)
    : 0;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="text-xs text-gray-500 mt-1">Agent</span>
        <div className="flex-1">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {text}
            </ReactMarkdown>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            <span className="animate-pulse">Generating...</span>
            <span>{elapsed}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### PermissionBanner

```typescript
// core/editor-shell/components/PermissionBanner.tsx

interface PermissionBannerProps {
  request: PermissionRequest;
  onAllow: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}

export function PermissionBanner({ request, onAllow, onDeny }: PermissionBannerProps) {
  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Tool: {request.tool_name}
          </div>
          {request.description && (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {request.description}
            </div>
          )}
          <pre className="mt-2 rounded bg-amber-100 dark:bg-amber-900 p-2 text-xs overflow-x-auto">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onAllow(request.request_id)}
            className="rounded px-3 py-1 text-xs font-medium bg-green-600 text-white hover:bg-green-700"
          >
            Allow
          </button>
          <button
            onClick={() => onDeny(request.request_id)}
            className="rounded px-3 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-700"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 3.6 iframe 内元素选中机制

Slide Mode 的内容在 iframe 中渲染，需要通过 postMessage 实现元素选中：

```typescript
// 注入 iframe 的选中脚本 (由 SlidePreview 注入)
const SELECTOR_SCRIPT = `
<script>
(function() {
  const SELECTABLE = 'h1, h2, h3, h4, p, img, svg, ul, ol, table, blockquote, figure';
  let selected = null;

  // Hover 高亮
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest(SELECTABLE);
    if (el && el !== selected) {
      el.style.outline = '1px dashed #93c5fd';
      el.style.outlineOffset = '2px';
    }
  });

  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest(SELECTABLE);
    if (el && el !== selected) {
      el.style.outline = '';
      el.style.outlineOffset = '';
    }
  });

  // 点击选中
  document.addEventListener('click', (e) => {
    const el = e.target.closest(SELECTABLE);

    // 清除旧选中
    if (selected) {
      selected.style.outline = '';
      selected.style.outlineOffset = '';
      selected.style.backgroundColor = '';
    }

    if (el) {
      selected = el;
      el.style.outline = '2px solid #3b82f6';
      el.style.outlineOffset = '2px';
      el.style.backgroundColor = 'rgba(59, 130, 246, 0.05)';

      // 通知父窗口
      window.parent.postMessage({
        type: 'pneuma:element_selected',
        element: {
          selector: getCSSPath(el),
          tagName: el.tagName.toLowerCase(),
          textContent: el.textContent?.slice(0, 200) || '',
          attributes: Object.fromEntries(
            Array.from(el.attributes).map(a => [a.name, a.value])
          ),
        },
      }, '*');
    } else {
      selected = null;
      window.parent.postMessage({
        type: 'pneuma:element_deselected',
      }, '*');
    }
  });

  function getCSSPath(el) {
    const parts = [];
    while (el && el !== document.body) {
      let part = el.tagName.toLowerCase();
      if (el.id) {
        part += '#' + el.id;
      } else if (el.className && typeof el.className === 'string') {
        part += '.' + el.className.trim().split(/\\s+/).join('.');
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
})();
</script>
`;
```

### 3.7 深色模式

**决策：跟随系统 (prefers-color-scheme) + 手动切换。**

```typescript
// 通过 Tailwind dark mode class 实现
// <html class="dark"> 切换

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("pneuma:dark-mode");
    if (saved !== null) return saved === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("pneuma:dark-mode", String(dark));
  }, [dark]);

  return [dark, setDark] as const;
}
```

---

## 4. 关键设计决策

### 4.1 ChatPanel 位置

**决策：右侧固定面板（而非底部 dock）。**

理由：
- 内容预览是主角，需要最大面积
- 对话面板垂直空间更充足，适合 streaming 长文本
- Companion 也是侧面板模式
- 用户可以拖拽调整宽度

### 4.2 消息列表 vs 单轮对话

**决策：保留完整消息历史（对话列表模式）。**

理由：
- 用户可以回顾之前的修改指令
- Agent 的 streaming 响应和 tool 使用对调试有价值
- 简单实现 — 只是 array append

### 4.3 Streaming 渲染方式

**决策：采用 Companion 的 draft message 模式。**

三层状态：
1. `streamingText` — 累积 delta 文本（高频更新）
2. `StreamingResponse` 组件 — 实时渲染 streamingText
3. `finalizeStreaming()` — streaming 完成后，替换为完整 ChatMessage

这避免了每个 delta 都创建新 message 对象的性能问题。

### 4.4 Markdown 渲染

**决策：使用 react-markdown + remark-gfm。**

Agent 的响应通常包含 markdown 格式（代码块、列表、标题等），Companion 验证了这个组合的可靠性。

---

## 5. 被否决的方案

### 5.1 Electron / Tauri

- 否决原因：Pneuma 已经通过 CLI 启动，浏览器足够；额外的桌面壳增加打包和分发复杂度

### 5.2 Shadcn/UI

- 否决原因：MVP 组件很少，Tailwind 直接写更快；Phase 2 如果组件增多可以引入

### 5.3 Socket.io

- 否决原因：浏览器原生 WebSocket 足够；Socket.io 增加 bundle 大小，不需要其 fallback 能力

---

## 6. 影响

1. **前端 bundle 小** — 核心只有 React + Zustand + Tailwind + react-markdown + resizable-panels
2. **开发体验好** — Vite HMR + Tailwind 即时预览
3. **单 session 限制** — Phase 2 需要改造 store 支持多 session
4. **iframe 选中复杂度** — postMessage 通信需要仔细处理跨域和安全问题
