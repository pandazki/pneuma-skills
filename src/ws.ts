/**
 * WebSocket client — connects to the Pneuma server and dispatches incoming
 * messages to the Zustand store.
 */

import { useStore, nextId } from "./store.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, ContentBlock, ChatMessage } from "./types.js";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeq = 0;
let streamingPhase: "thinking" | "text" | null = null;

const WS_RECONNECT_DELAY_MS = 2000;

function getWsUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev mode (Vite on 5173), connect directly to backend to avoid WS proxy issues.
  // In production, the backend serves the frontend so location.host is correct.
  const host = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_API_PORT || "3210"}`
    : location.host;
  return `${proto}//${host}/ws/browser/${sessionId}`;
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "thinking") return b.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function handleParsedMessage(data: BrowserIncomingMessage) {
  const store = useStore.getState();

  // Track sequence numbers
  if (typeof data.seq === "number") {
    if (data.seq <= lastSeq) return;
    lastSeq = data.seq;
    // Ack
    send({ type: "session_ack", last_seq: data.seq });
  }

  switch (data.type) {
    case "session_init": {
      store.setSession(data.session);
      store.setCliConnected(true);
      store.setSessionStatus("idle");
      break;
    }

    case "session_update": {
      store.updateSession(data.session);
      break;
    }

    case "assistant": {
      const msg = data.message;
      const textContent = extractTextFromBlocks(msg.content);
      const chatMsg: ChatMessage = {
        id: msg.id,
        role: "assistant",
        content: textContent,
        contentBlocks: msg.content,
        timestamp: data.timestamp || Date.now(),
        parentToolUseId: data.parent_tool_use_id,
        model: msg.model,
        stopReason: msg.stop_reason,
      };
      // Replace streaming draft or append
      store.appendMessage(chatMsg);
      store.setStreaming(null);
      streamingPhase = null;
      store.setSessionStatus("running");
      // Don't clear activity here — agent is still working (tools to run, more thinking).
      // Activity is only cleared on "result".
      break;
    }

    case "stream_event": {
      const evt = data.event as Record<string, unknown>;
      if (evt && typeof evt === "object") {
        if (evt.type === "message_start") {
          streamingPhase = null;
          store.setStreaming("");
          store.setActivity({ phase: "thinking", startedAt: Date.now() });
        }

        if (evt.type === "content_block_delta") {
          const delta = evt.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            let current = store.streaming || "";
            if (streamingPhase === "thinking") {
              current += "\n\n";
            }
            streamingPhase = "text";
            store.setStreaming(current + delta.text);
            store.setActivity({ phase: "responding", startedAt: store.activity?.startedAt || Date.now() });
          }
          if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            const current = store.streaming || "";
            const prefix = streamingPhase !== "thinking" ? "*Thinking:* " : "";
            streamingPhase = "thinking";
            store.setStreaming(current + prefix + delta.thinking);
            if (!store.activity || store.activity.phase !== "thinking") {
              store.setActivity({ phase: "thinking", startedAt: store.activity?.startedAt || Date.now() });
            }
          }
        }
      }
      break;
    }

    case "result": {
      const r = data.data;
      store.updateSession({
        total_cost_usd: r.total_cost_usd,
        num_turns: r.num_turns,
      });
      store.setStreaming(null);
      store.setActivity(null);
      streamingPhase = null;
      store.setSessionStatus("idle");

      if (r.is_error && r.errors?.length) {
        store.appendMessage({
          id: nextId(),
          role: "system",
          content: `Error: ${r.errors.join(", ")}`,
          timestamp: Date.now(),
        });
      }
      break;
    }

    case "permission_request": {
      store.addPermission(data.request);
      break;
    }

    case "permission_cancelled": {
      store.removePermission(data.request_id);
      break;
    }

    case "tool_progress": {
      store.setActivity({
        phase: "tool",
        toolName: data.tool_name,
        startedAt: store.activity?.startedAt || Date.now(),
      });
      break;
    }

    case "tool_use_summary": {
      store.appendMessage({
        id: nextId(),
        role: "system",
        content: data.summary,
        timestamp: Date.now(),
      });
      break;
    }

    case "status_change": {
      store.setSessionStatus(data.status);
      break;
    }

    case "error": {
      store.appendMessage({
        id: nextId(),
        role: "system",
        content: data.message,
        timestamp: Date.now(),
      });
      break;
    }

    case "cli_disconnected": {
      store.setCliConnected(false);
      store.setSessionStatus(null);
      break;
    }

    case "cli_connected": {
      store.setCliConnected(true);
      break;
    }

    case "content_update": {
      store.updateFiles(data.files);
      break;
    }

    case "message_history": {
      const chatMessages: ChatMessage[] = [];
      for (const histMsg of data.messages) {
        if (histMsg.type === "user_message") {
          chatMessages.push({
            id: histMsg.id || nextId(),
            role: "user",
            content: histMsg.content,
            timestamp: histMsg.timestamp,
          });
        } else if (histMsg.type === "assistant") {
          const msg = histMsg.message;
          chatMessages.push({
            id: msg.id,
            role: "assistant",
            content: extractTextFromBlocks(msg.content),
            contentBlocks: msg.content,
            timestamp: histMsg.timestamp || Date.now(),
            parentToolUseId: histMsg.parent_tool_use_id,
            model: msg.model,
            stopReason: msg.stop_reason,
          });
        } else if (histMsg.type === "result") {
          const r = histMsg.data;
          if (r.is_error && r.errors?.length) {
            chatMessages.push({
              id: nextId(),
              role: "system",
              content: `Error: ${r.errors.join(", ")}`,
              timestamp: Date.now(),
            });
          }
        }
      }
      if (chatMessages.length > 0) {
        store.setMessages(chatMessages);
      }
      break;
    }

    case "event_replay": {
      for (const evt of data.events) {
        if (evt.seq <= lastSeq) continue;
        lastSeq = evt.seq;
        handleParsedMessage(evt.message as BrowserIncomingMessage);
      }
      break;
    }
  }
}

export function connect(sessionId: string) {
  if (socket) return;

  const store = useStore.getState();
  store.setConnectionStatus("connecting");
  store.setSessionId(sessionId);

  const ws = new WebSocket(getWsUrl(sessionId));
  socket = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "session_subscribe", last_seq: lastSeq }));
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    let data: BrowserIncomingMessage;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    // Promote to connected on first valid message
    const store = useStore.getState();
    if (store.connectionStatus === "connecting") {
      store.setConnectionStatus("connected");
    }

    handleParsedMessage(data);
  };

  ws.onclose = () => {
    socket = null;
    useStore.getState().setConnectionStatus("disconnected");
    scheduleReconnect(sessionId);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function scheduleReconnect(sessionId: string) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(sessionId);
  }, WS_RECONNECT_DELAY_MS);
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
}

export function send(msg: BrowserOutgoingMessage) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

export function sendUserMessage(content: string) {
  const store = useStore.getState();
  // Add user message to local store immediately
  store.appendMessage({
    id: nextId(),
    role: "user",
    content,
    timestamp: Date.now(),
  });
  send({ type: "user_message", content });
}

export function sendPermissionResponse(
  requestId: string,
  behavior: "allow" | "deny",
  updatedInput?: Record<string, unknown>,
) {
  useStore.getState().removePermission(requestId);
  send({
    type: "permission_response",
    request_id: requestId,
    behavior,
    updated_input: updatedInput,
  });
}

export function sendInterrupt() {
  send({ type: "interrupt" });
}
