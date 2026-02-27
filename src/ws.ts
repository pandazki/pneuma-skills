/**
 * WebSocket client — connects to the Pneuma server and dispatches incoming
 * messages to the Zustand store.
 */

import { useStore, nextId } from "./store.js";
import type { ElementSelection } from "./store.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, ContentBlock, ChatMessage, SelectionContext, SelectionType } from "./types.js";

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeq = 0;
let streamingPhase: "thinking" | "text" | null = null;

const WS_RECONNECT_DELAY_MS = 2000;

function getWsUrl(sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev mode (Vite on 17996), connect directly to backend to avoid WS proxy issues.
  // In production, the backend serves the frontend so location.host is correct.
  const host = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_API_PORT || "17007"}`
    : location.host;
  return `${proto}//${host}/ws/browser/${sessionId}`;
}

/**
 * Parse selection context from enriched user message content.
 * Format: [User is viewing: file]\n[User selected: type "content"]\n\nactual message
 */
function parseSelectionFromContent(raw: string): { content: string; selectionContext?: SelectionContext } {
  if (!raw.startsWith("[User is viewing: ")) return { content: raw };

  const firstNl = raw.indexOf("\n");
  if (firstNl === -1) return { content: raw };

  const viewingLine = raw.slice(0, firstNl);
  const fileMatch = viewingLine.match(/^\[User is viewing: (.+)\]$/);
  if (!fileMatch) return { content: raw };

  const file = fileMatch[1];
  const rest = raw.slice(firstNl + 1);

  const secondNl = rest.indexOf("\n");
  if (secondNl === -1) return { content: raw };

  const selectedLine = rest.slice(0, secondNl);
  const userContent = rest.slice(secondNl + 1).replace(/^\n/, "");

  // [User selected text: "..."]
  const textMatch = selectedLine.match(/^\[User selected text: "(.+)"\]$/);
  if (textMatch) {
    return {
      content: userContent,
      selectionContext: { file, type: "text-range", content: textMatch[1] },
    };
  }

  // [User selected: type "..."]
  const blockMatch = selectedLine.match(/^\[User selected: (.+?) "(.+)"\]$/);
  if (blockMatch) {
    const typeStr = blockMatch[1];
    const selContent = blockMatch[2];
    let type: SelectionType = "paragraph";
    let level: number | undefined;

    const headingMatch = typeStr.match(/^h(\d) heading$/);
    if (headingMatch) {
      type = "heading";
      level = Number(headingMatch[1]);
    } else if (
      (["paragraph", "list", "code", "blockquote", "image", "table"] as SelectionType[]).includes(typeStr as SelectionType)
    ) {
      type = typeStr as SelectionType;
    }

    return {
      content: userContent,
      selectionContext: { file, type, content: selContent, level },
    };
  }

  return { content: raw };
}

// Background process detection
const pendingBackgroundBash = new Map<string, { command: string; description: string; startedAt: number }>();
const BG_RESULT_REGEX = /Command running in background with ID:\s*(\S+)\.\s*Output is being written to:\s*(\S+)/;

function extractProcessesFromBlocks(blocks: ContentBlock[]) {
  const store = useStore.getState();
  for (const block of blocks) {
    if (block.type === "tool_use" && block.name === "Bash") {
      const input = block.input as Record<string, unknown>;
      if (input.run_in_background === true) {
        pendingBackgroundBash.set(block.id, {
          command: (input.command as string) || "",
          description: (input.description as string) || "",
          startedAt: Date.now(),
        });
      }
    }
    if (block.type === "tool_result") {
      const pending = pendingBackgroundBash.get(block.tool_use_id);
      if (pending) {
        const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        const match = content.match(BG_RESULT_REGEX);
        if (match) {
          store.addProcess({
            taskId: match[1],
            toolUseId: block.tool_use_id,
            command: pending.command,
            description: pending.description,
            outputFile: match[2],
            status: "running",
            startedAt: pending.startedAt,
          });
        }
        pendingBackgroundBash.delete(block.tool_use_id);
      }
    }
  }
}

function detectFileChanges(blocks: ContentBlock[]): boolean {
  return blocks.some(
    (b) => b.type === "tool_use" && (b.name === "Edit" || b.name === "Write")
  );
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
      if (detectFileChanges(msg.content)) store.bumpChangedFilesTick();
      extractProcessesFromBlocks(msg.content);
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
      const sessionUpdates: Partial<import("./types.js").SessionState> = {
        total_cost_usd: r.total_cost_usd,
        num_turns: r.num_turns,
      };
      if (typeof r.total_lines_added === "number") {
        sessionUpdates.total_lines_added = r.total_lines_added;
      }
      if (typeof r.total_lines_removed === "number") {
        sessionUpdates.total_lines_removed = r.total_lines_removed;
      }
      if (r.modelUsage) {
        for (const usage of Object.values(r.modelUsage)) {
          if (usage.contextWindow > 0) {
            const pct = Math.round(
              ((usage.inputTokens + usage.outputTokens) / usage.contextWindow) * 100
            );
            sessionUpdates.context_used_percent = Math.max(0, Math.min(pct, 100));
          }
        }
      }
      store.updateSession(sessionUpdates);
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
      const wasWorking = store.streaming !== null || store.activity !== null;
      store.setCliConnected(false);
      store.setSessionStatus(null);
      // Clear any in-progress streaming/activity so UI doesn't get stuck
      if (store.streaming !== null) {
        store.setStreaming(null);
      }
      if (store.activity !== null) {
        store.setActivity(null);
      }
      streamingPhase = null;
      // Notify user if CLI disconnected mid-execution
      if (wasWorking) {
        store.appendMessage({
          id: nextId(),
          role: "system",
          content: "CLI disconnected while processing. The response may be incomplete.",
          timestamp: Date.now(),
        });
      }
      break;
    }

    case "cli_connected": {
      store.setCliConnected(true);
      break;
    }

    case "system_event": {
      const evt = (data as any).event;
      if (evt?.subtype === "task_notification" && evt.task_id && evt.status) {
        store.updateProcess(evt.task_id, {
          status: evt.status,
          completedAt: Date.now(),
          summary: evt.summary || undefined,
        });
      }
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
          const parsed = parseSelectionFromContent(histMsg.content);
          chatMessages.push({
            id: histMsg.id || nextId(),
            role: "user",
            content: parsed.content,
            timestamp: histMsg.timestamp,
            ...(parsed.selectionContext ? { selectionContext: parsed.selectionContext } : {}),
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

export function sendSetModel(model: string) {
  const store = useStore.getState();
  // Optimistic update
  store.updateSession({ model });
  send({ type: "set_model", model });
}

export function sendUserMessage(content: string, selection?: ElementSelection | null, images?: { media_type: string; data: string }[]) {
  const store = useStore.getState();
  // Add user message to local store immediately (show original text)
  store.appendMessage({
    id: nextId(),
    role: "user",
    content,
    timestamp: Date.now(),
    ...(selection ? { selectionContext: selection } : {}),
  });

  // Enrich with selection context for Claude Code
  let enrichedContent = content;
  if (selection) {
    const ctx: string[] = [];
    ctx.push(`[User is viewing: ${selection.file}]`);
    if (selection.type === "text-range") {
      ctx.push(`[User selected text: "${selection.content}"]`);
    } else {
      const typeLabel =
        selection.type === "heading" ? `h${selection.level || 1} heading` : selection.type;
      ctx.push(`[User selected: ${typeLabel} "${selection.content}"]`);
    }
    enrichedContent = ctx.join("\n") + "\n\n" + content;
  }

  const msg: import("./types.js").BrowserOutgoingMessage & { type: "user_message" } = {
    type: "user_message",
    content: enrichedContent,
  };
  if (images?.length) {
    msg.images = images;
  }
  send(msg);
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
